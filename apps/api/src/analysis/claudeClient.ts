import Anthropic from "@anthropic-ai/sdk";
import { stripLoneSurrogates } from "@financial-adviser/shared";
import { recordUsage, type UsagePurpose } from "./usageRecording";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { CLAUDE_API_KEY, CLAUDE_MODEL } from "./config";

// The SDK already retries 429/5xx/connection errors internally with backoff
// (default max_retries: 2). This is a scheduled batch job, not a live chat --
// there's no user waiting on a spinner -- so it's worth being more patient
// than the interactive default before an error ever reaches our own code (C6).
let cachedClient: Anthropic | undefined;

/** Built on first use, so code paths that never call Claude (the free rules engine) run without a key. */
function getClient(): Anthropic {
  if (!CLAUDE_API_KEY) {
    throw new Error("CLAUDE_API_KEY is not set. Add one to use Claude, or leave it out to use the free rules engine.");
  }
  cachedClient ??= new Anthropic({ apiKey: CLAUDE_API_KEY, maxRetries: 5 });
  return cachedClient;
}

// A5's required output schema (direction/confidence/rationale/citations).
// Structured outputs (output_config.format) enforce this shape at the API
// level -- far more reliable than C1's old plain-text "respond with JSON"
// instruction, and directly serves C3's "malformed output triggers a retry"
// requirement (a schema violation now can't happen; only a bad *citation ID*
// can, which is checked separately against the prompt's citation map).
export const SignalSchema = z.object({
  direction: z.enum(["bullish", "bearish", "neutral"]),
  confidence: z.number().int().min(0).max(100),
  rationale: z.string(),
  // Added 2026-07-19 -- a deliberate scope change (see A1/A3 doc updates)
  // toward actionable trading guidance, not just a directional read.
  entryGuidance: z.string(),
  targetPrice: z.number().nullable(),
  stopLossPrice: z.number().nullable(),
  citations: z.array(z.string()),
});

export type Signal = z.infer<typeof SignalSchema>;

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export type ClaudeCallResult =
  | { status: "ok"; signal: Signal; usage: TokenUsage }
  | { status: "auth_error"; message: string }
  | { status: "billing_error"; message: string }
  | { status: "rate_limit_error"; message: string }
  | { status: "connection_error"; message: string }
  | { status: "other_error"; message: string };

// An empty prepaid balance has arrived both as a typed billing_error and as a
// plain 400 invalid_request_error whose only tell is this wording. Either way
// it is not transient and not the key's fault -- it needs a top-up.
const OUT_OF_CREDIT_PATTERN = /credit balance/i;

function classifyError(err: unknown): ClaudeCallResult {
  if (err instanceof Anthropic.AuthenticationError) {
    return { status: "auth_error", message: err.message };
  }
  if (err instanceof Anthropic.APIError && (err.type === "billing_error" || OUT_OF_CREDIT_PATTERN.test(err.message))) {
    return { status: "billing_error", message: err.message };
  }
  if (err instanceof Anthropic.RateLimitError) {
    return { status: "rate_limit_error", message: err.message };
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return { status: "connection_error", message: err.message };
  }
  if (err instanceof Anthropic.APIError) {
    return { status: "other_error", message: `${err.status} ${err.message}` };
  }
  return { status: "other_error", message: err instanceof Error ? err.message : String(err) };
}

/**
 * Generates a real signal from an already-assembled prompt (C1's output).
 * No sampling params (temperature/top_p/top_k) -- Sonnet 5 rejects non-default
 * values with a 400. Adaptive thinking and effort:"high" (both defaults) are
 * left as-is: this is a scheduled batch call, not latency-sensitive, and
 * A5's task (detecting genuine signal conflicts) benefits from full reasoning
 * rather than trading it away for determinism we can't achieve anyway.
 */
export async function generateSignal(
  promptText: string,
  opts: { tickerId?: string | null; purpose?: UsagePurpose } = {}
): Promise<ClaudeCallResult> {
  // A single unpaired surrogate anywhere in the prompt makes the whole request
  // body invalid JSON, and the API rejects the entire call with a 400 that
  // names neither the ticker nor the character (see packages/shared/src/text.ts).
  // Sanitising here means no caller can poison a request by accident.
  const safePrompt = stripLoneSurrogates(promptText);

  try {
    const response = await getClient().messages.parse({
      model: CLAUDE_MODEL,
      max_tokens: 2048,
      messages: [{ role: "user", content: safePrompt }],
      output_config: { format: zodOutputFormat(SignalSchema) },
    });

    const usage = {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };

    // Recorded HERE rather than in a caller, so no path can spend money without
    // it being counted. This also fires when parsing fails below: the tokens
    // were still bought and billed, and a failed call that costs money and
    // records nothing is exactly the blind spot this moved to fix.
    //
    // Deliberately never throws -- a recording failure must not turn a
    // successful, already-paid-for generation into an error.
    await recordUsage(usage, { tickerId: opts.tickerId, purpose: opts.purpose }).catch((e) =>
      console.error("[C4] Failed to record usage (call still succeeded):", e instanceof Error ? e.message : e)
    );

    if (!response.parsed_output) {
      return { status: "other_error", message: "Structured output parsing returned null" };
    }

    return { status: "ok", signal: response.parsed_output, usage };
  } catch (err) {
    return classifyError(err);
  }
}

// --- Message Batches (half price) -----------------------------------------
//
// Nothing here is latency-sensitive: the daily job and backtests can wait
// minutes for a result, and batching halves every token's price. Results
// usually land within minutes; the API's own ceiling is 24h, but a GitHub
// Actions job can't wait that long, so give up (and cancel) well before.
const BATCH_POLL_INTERVAL_MS = 30_000;
const BATCH_MAX_WAIT_MS = 4 * 60 * 60 * 1000;

export interface BatchSignalRequest {
  /** Must match ^[a-zA-Z0-9_-]{1,64}$ and be unique within the batch. */
  customId: string;
  promptText: string;
  tickerId?: string | null;
  purpose?: UsagePurpose;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function classifyBatchError(type: string, message: string): ClaudeCallResult {
  if (type === "authentication_error") return { status: "auth_error", message };
  if (type === "billing_error" || OUT_OF_CREDIT_PATTERN.test(message)) return { status: "billing_error", message };
  if (type === "rate_limit_error" || type === "overloaded_error") return { status: "rate_limit_error", message };
  return { status: "other_error", message: `${type}: ${message}` };
}

/**
 * Batch counterpart of generateSignal: same model, prompt handling, output
 * schema and usage recording, at half the price. Always returns one result per
 * request -- if the batch can't even be submitted (bad key, no credit), every
 * request carries that same error, so callers handle one shape either way.
 */
export async function generateSignalsBatch(requests: BatchSignalRequest[]): Promise<Map<string, ClaudeCallResult>> {
  const results = new Map<string, ClaudeCallResult>();
  if (requests.length === 0) return results;

  const format = zodOutputFormat(SignalSchema);
  let batchId: string;
  try {
    const batch = await getClient().messages.batches.create({
      requests: requests.map((r) => ({
        custom_id: r.customId,
        params: {
          model: CLAUDE_MODEL,
          max_tokens: 2048,
          messages: [{ role: "user", content: stripLoneSurrogates(r.promptText) }],
          output_config: { format: { type: format.type, schema: format.schema } },
        },
      })),
    });
    batchId = batch.id;
  } catch (err) {
    const failure = classifyError(err);
    for (const r of requests) results.set(r.customId, failure);
    return results;
  }

  console.log(`[Batch] Submitted ${batchId} with ${requests.length} request(s), waiting for results...`);
  const deadline = Date.now() + BATCH_MAX_WAIT_MS;
  let canceled = false;
  for (;;) {
    const batch = await getClient().messages.batches.retrieve(batchId);
    if (batch.processing_status === "ended") break;
    if (!canceled && Date.now() > deadline) {
      // Cancelling still bills whatever already finished; those results are
      // read and recorded below like any other, so the spend isn't lost.
      console.warn(`[Batch] ${batchId} still running after ${BATCH_MAX_WAIT_MS / 60000} min, cancelling`);
      await getClient().messages.batches.cancel(batchId);
      canceled = true;
    }
    await sleep(BATCH_POLL_INTERVAL_MS);
  }

  const byId = new Map(requests.map((r) => [r.customId, r]));
  for await (const entry of await getClient().messages.batches.results(batchId)) {
    const request = byId.get(entry.custom_id);
    const { result } = entry;

    if (result.type === "succeeded") {
      const usage = { inputTokens: result.message.usage.input_tokens, outputTokens: result.message.usage.output_tokens };
      // Same rule as generateSignal: record before parsing, because the
      // tokens were billed whether or not the output turns out usable.
      await recordUsage(usage, { tickerId: request?.tickerId, purpose: request?.purpose, batch: true }).catch((e) =>
        console.error("[C4] Failed to record usage (call still succeeded):", e instanceof Error ? e.message : e)
      );
      const text = result.message.content.find((b) => b.type === "text")?.text ?? "";
      try {
        results.set(entry.custom_id, { status: "ok", signal: format.parse(text), usage });
      } catch (e) {
        results.set(entry.custom_id, {
          status: "other_error",
          message: `Structured output parsing failed (stop_reason=${result.message.stop_reason}): ${e instanceof Error ? e.message : e}`,
        });
      }
    } else if (result.type === "errored") {
      results.set(entry.custom_id, classifyBatchError(result.error.error.type, result.error.error.message));
    } else {
      results.set(entry.custom_id, { status: "other_error", message: `batch request ${result.type}` });
    }
  }

  for (const r of requests) {
    if (!results.has(r.customId)) results.set(r.customId, { status: "other_error", message: "missing from batch results" });
  }
  return results;
}

/**
 * Counts tokens for a prompt without generating a response -- this is a free
 * operation (no inference run), used by C4 to build a real pre-run cost
 * estimate before spending an actual generation call.
 */
export async function countPromptTokens(promptText: string): Promise<number> {
  const result = await getClient().messages.countTokens({
    model: CLAUDE_MODEL,
    messages: [{ role: "user", content: stripLoneSurrogates(promptText) }],
  });
  return result.input_tokens;
}

/**
 * Validates the BYO API key once, at setup/key-change (A4 Q8) -- against the
 * real model the analysis engine uses (A4 Q11), not a cheap throwaway model.
 * A key can authenticate but lack access to a specific model; this confirms
 * both facts in one minimal call.
 */
export async function validateApiKey(): Promise<ClaudeCallResult> {
  try {
    const response = await getClient().messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 16,
      messages: [{ role: "user", content: "Reply with only the word OK." }],
    });
    // Tiny (16 max_tokens) but still billed, and "no path spends money without
    // being counted" only holds if it applies to the small paths too.
    await recordUsage(
      { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
      { purpose: "adhoc" }
    ).catch(() => {
      /* key validation must not fail because bookkeeping did */
    });

    const text = response.content.find((b) => b.type === "text")?.text ?? "";
    return {
      status: "ok",
      signal: { direction: "neutral", confidence: 0, rationale: text, entryGuidance: "", targetPrice: null, stopLossPrice: null, citations: [] },
      usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
    };
  } catch (err) {
    return classifyError(err);
  }
}
