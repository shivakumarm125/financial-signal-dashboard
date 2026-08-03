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
const client = new Anthropic({ apiKey: CLAUDE_API_KEY, maxRetries: 5 });

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
  | { status: "rate_limit_error"; message: string }
  | { status: "connection_error"; message: string }
  | { status: "other_error"; message: string };

function classifyError(err: unknown): ClaudeCallResult {
  if (err instanceof Anthropic.AuthenticationError) {
    return { status: "auth_error", message: err.message };
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
    const response = await client.messages.parse({
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

/**
 * Counts tokens for a prompt without generating a response -- this is a free
 * operation (no inference run), used by C4 to build a real pre-run cost
 * estimate before spending an actual generation call.
 */
export async function countPromptTokens(promptText: string): Promise<number> {
  const result = await client.messages.countTokens({
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
    const response = await client.messages.create({
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
