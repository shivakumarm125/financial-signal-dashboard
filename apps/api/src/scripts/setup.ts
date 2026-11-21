import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

/**
 * First-time setup for your own copy: `npm run setup` from the repo root.
 *
 * Asks for each key, checks it works (free calls only), writes the env files,
 * creates the database tables, sets up your watchlist, loads the first data
 * and, optionally, copies the keys into GitHub so updates run on a schedule.
 * Safe to re-run: press Enter to keep any value already set.
 *
 * Modules that read env vars at import time (ingestion configs, the Prisma
 * client) are imported dynamically, only after process.env is filled in.
 */

// Anchored to the repo root, so setup works from any directory.
const ROOT = resolve(__dirname, "..", "..", "..", "..");
const API_ENV = resolve(ROOT, "apps/api/.env");
const WEB_ENV = resolve(ROOT, "apps/web/.env.local");
const SCHEMA = resolve(ROOT, "packages/shared/prisma/schema.prisma");
const MAX_TICKERS = 10;
const SYMBOL_PATTERN = /^[A-Z]{1,6}([.-][A-Z]{1,2})?$/;

// --- terminal helpers --------------------------------------------------------

let muted = false;
const output = new Writable({
  write(chunk, _enc, done) {
    if (!muted) process.stdout.write(chunk);
    done();
  },
});
const rl = createInterface({ input: process.stdin, output, terminal: process.stdin.isTTY === true });

// Lines are queued rather than read with rl.question(): with piped input
// (scripted installs, CI) readline emits every line at once and then closes,
// and question() would miss them all.
const lines: string[] = [];
const waiting: ((line: string | null) => void)[] = [];
let inputClosed = false;
rl.on("line", (line) => (waiting.length ? waiting.shift()!(line) : lines.push(line)));
rl.on("close", () => {
  inputClosed = true;
  while (waiting.length) waiting.shift()!(null);
});

function nextLine(): Promise<string | null> {
  if (lines.length) return Promise.resolve(lines.shift()!);
  if (inputClosed) return Promise.resolve(null);
  return new Promise((res) => waiting.push(res));
}

async function ask(question: string, opts: { secret?: boolean; current?: string } = {}): Promise<string> {
  const hint = opts.current ? ` [${opts.secret ? mask(opts.current) : opts.current}]` : "";
  process.stdout.write(`${question}${hint}: `);
  muted = Boolean(opts.secret);
  const line = await nextLine();
  muted = false;
  if (line === null && !opts.current) throw new Error("input ended before setup finished");
  const answer = (line ?? "").trim();
  if (opts.secret) process.stdout.write("\n");
  return answer || opts.current || "";
}

async function confirm(question: string, defaultYes: boolean): Promise<boolean> {
  const answer = (await ask(`${question} ${defaultYes ? "(Y/n)" : "(y/N)"}`)).toLowerCase();
  return answer === "" ? defaultYes : answer.startsWith("y");
}

function mask(value: string): string {
  return value.length <= 8 ? "****" : `${value.slice(0, 4)}…${value.slice(-4)}`;
}

const ok = (msg: string) => console.log(`  ✓ ${msg}`);
const fail = (msg: string) => console.log(`  ✗ ${msg}`);
const step = (n: number, title: string) => console.log(`\n${n}. ${title}\n`);

// --- env files ---------------------------------------------------------------

function readEnv(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const env: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
  }
  return env;
}

/** Updates or appends keys, keeping every other line (comments, extra keys) as it was. */
function writeEnv(path: string, values: Record<string, string>): void {
  const lines = existsSync(path) ? readFileSync(path, "utf8").split(/\r?\n/) : [];
  const pending = { ...values };
  const out = lines.map((line) => {
    const key = line.match(/^\s*([A-Z0-9_]+)\s*=/)?.[1];
    if (key && key in pending) {
      const v = pending[key];
      delete pending[key];
      return `${key}="${v}"`;
    }
    return line;
  });
  for (const [k, v] of Object.entries(pending)) out.push(`${k}="${v}"`);
  writeFileSync(path, out.join("\n").replace(/\n*$/, "\n"));
}

/**
 * The website runs on serverless functions, which need Supabase's transaction
 * pooler (port 6543) and one connection each -- the session pooler's 15-client
 * cap is what took production down on 2026-08-02 (see packages/shared/src/client.ts).
 */
function webDatabaseUrl(url: string): string {
  const u = new URL(url);
  if (u.hostname.endsWith("pooler.supabase.com") && u.port === "5432") u.port = "6543";
  if (u.hostname.endsWith("pooler.supabase.com")) u.searchParams.set("pgbouncer", "true");
  u.searchParams.set("connection_limit", "1");
  return u.toString();
}

/** Keeps a website URL the user already set if it points at the same database; otherwise derives one. */
function webUrlFor(apiUrl: string, existing: string | undefined): string {
  if (existing) {
    try {
      const [a, b] = [new URL(apiUrl), new URL(existing)];
      if (a.hostname === b.hostname && a.username === b.username) return existing;
    } catch {
      /* unparseable: fall through and derive a fresh one */
    }
  }
  return webDatabaseUrl(apiUrl);
}

// --- checks (all free) -------------------------------------------------------

async function checkDatabase(url: string): Promise<string | null> {
  process.env.DATABASE_URL = url;
  const { PrismaClient } = await import("@prisma/client");
  const client = new PrismaClient({ datasources: { db: { url } } });
  try {
    await client.$queryRaw`SELECT 1`;
    return null;
  } catch (e) {
    return e instanceof Error ? e.message.split("\n").filter(Boolean).slice(-1)[0] : String(e);
  } finally {
    await client.$disconnect();
  }
}

async function checkTwelveData(key: string): Promise<string | null> {
  // /api_usage reports quota without spending any of it.
  const res = await fetch(`https://api.twelvedata.com/api_usage?apikey=${encodeURIComponent(key)}`);
  const body = (await res.json().catch(() => ({}))) as { status?: string; message?: string };
  return body.status === "error" ? body.message ?? "rejected" : null;
}

async function checkFinnhub(key: string): Promise<string | null> {
  const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=AAPL&token=${encodeURIComponent(key)}`);
  return res.ok ? null : `HTTP ${res.status}`;
}

async function checkClaude(key: string): Promise<string | null> {
  // countTokens needs a valid key but runs no model, so it's not billed.
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const { CLAUDE_MODEL } = await import("../analysis/config");
  try {
    await new Anthropic({ apiKey: key, maxRetries: 0 }).messages.countTokens({
      model: CLAUDE_MODEL,
      messages: [{ role: "user", content: "hi" }],
    });
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/** Asks until the check passes (or, for optional values, until left blank). */
async function askChecked(
  question: string,
  current: string | undefined,
  check: (v: string) => Promise<string | null>,
  opts: { secret?: boolean; optional?: boolean } = {}
): Promise<string> {
  for (;;) {
    const value = await ask(question, { secret: opts.secret, current });
    if (!value && opts.optional) return "";
    if (!value) {
      fail("This one is required.");
      continue;
    }
    const problem = await check(value);
    if (!problem) {
      ok("Works.");
      return value;
    }
    fail(`That didn't work: ${problem}`);
    current = undefined;
  }
}

// --- main --------------------------------------------------------------------

async function main() {
  console.log(`
Stock Signals setup
===================
This sets up your own copy. You'll need (all free to sign up):

  • A Postgres database. Supabase works well: supabase.com → New project →
    Connect → "Session pooler" connection string (port 5432).
  • A Twelve Data key: twelvedata.com (free plan) → API keys.
  • A Finnhub key: finnhub.io (free plan) → Dashboard.
  • Optional: a Claude API key from console.anthropic.com. Without one, calls
    are made by simple free rules instead of AI.

Press Enter at any question to keep the value shown in [brackets].`);

  const env = readEnv(API_ENV);
  const webEnv = readEnv(WEB_ENV);

  step(1, "Keys");
  const databaseUrl = await askChecked("Database connection string", env.DATABASE_URL, checkDatabase, { secret: true });
  const twelve = await askChecked("Twelve Data API key", env.TWELVE_DATA_API_KEY, checkTwelveData, { secret: true });
  const finnhub = await askChecked("Finnhub API key", env.FINNHUB_API_KEY, checkFinnhub, { secret: true });
  const edgar = await askChecked(
    'Your name and email, sent to the SEC with each request (e.g. "Ana Silva ana@example.com")',
    env.EDGAR_USER_AGENT,
    async (v) => (/\S+\s+\S+@\S+\.\S+/.test(v) ? null : "needs a name followed by a real email address")
  );
  console.log("\nClaude writes the reasoning behind each call. It costs about $0.01–0.02 per stock per update.");
  console.log("Leave it blank to use the free rules instead; you can add a key later by re-running setup.");
  const claude = await askChecked("Claude API key (optional)", env.CLAUDE_API_KEY, checkClaude, {
    secret: true,
    optional: true,
  });
  const managePassword = webEnv.MANAGE_PASSWORD || randomBytes(9).toString("base64url");

  writeEnv(API_ENV, {
    DATABASE_URL: databaseUrl,
    TWELVE_DATA_API_KEY: twelve,
    FINNHUB_API_KEY: finnhub,
    EDGAR_USER_AGENT: edgar,
    CLAUDE_API_KEY: claude,
  });
  writeEnv(WEB_ENV, { DATABASE_URL: webUrlFor(databaseUrl, webEnv.DATABASE_URL), MANAGE_PASSWORD: managePassword });
  ok(`Saved to apps/api/.env and apps/web/.env.local (both are git-ignored).`);
  Object.assign(process.env, {
    DATABASE_URL: databaseUrl,
    TWELVE_DATA_API_KEY: twelve,
    FINNHUB_API_KEY: finnhub,
    EDGAR_USER_AGENT: edgar,
    CLAUDE_API_KEY: claude,
  });

  step(2, "Database tables");
  const migrate = spawnSync("npx", ["prisma", "migrate", "deploy", "--schema", `"${SCHEMA}"`], {
    cwd: ROOT,
    stdio: "inherit",
    shell: true,
    env: process.env,
  });
  if (migrate.status !== 0) throw new Error("Creating the database tables failed -- see the output above.");
  ok("Tables are up to date.");

  step(3, "Your stocks");
  const { prisma } = await import("@financial-adviser/shared");
  const existing = (await prisma.ticker.findMany({ orderBy: { symbol: "asc" } })).map((t) => t.symbol);
  if (existing.length) console.log(`  Already following: ${existing.join(", ")}`);
  const room = MAX_TICKERS - existing.length;
  let added: string[] = [];
  if (room > 0) {
    for (;;) {
      const raw = await ask(
        existing.length
          ? `Add more? Comma-separated, up to ${room} (Enter to skip)`
          : `Which US stocks? Comma-separated ticker symbols, up to ${MAX_TICKERS} (e.g. AAPL, MSFT, NVDA)`
      );
      const symbols = [...new Set(raw.toUpperCase().split(/[\s,]+/).filter(Boolean))].filter((s) => !existing.includes(s));
      const bad = symbols.filter((s) => !SYMBOL_PATTERN.test(s));
      if (bad.length) fail(`Not ticker symbols: ${bad.join(", ")}`);
      else if (symbols.length > room) fail(`That's ${symbols.length}; there's room for ${room}.`);
      else if (!symbols.length && !existing.length) fail("Add at least one stock.");
      else {
        added = symbols;
        break;
      }
    }
    for (const symbol of added) await prisma.ticker.create({ data: { symbol } });
    if (added.length) ok(`Added ${added.join(", ")}.`);
  }
  const watchlist = [...existing, ...added];

  step(4, "First data");
  console.log(`  Loads a year of prices plus recent news, insider filings and earnings dates.
  The data providers' free plans are rate-limited, so allow a few minutes per stock
  the first time (insider filings are the slow part). Later updates are quick.`);
  if (await confirm("Load it now?", true)) {
    const { ingestPrices } = await import("../ingestion/twelvedata/ingestPrices");
    const { ingestFilings } = await import("../ingestion/edgar/ingestFilings");
    const { ingestNews } = await import("../ingestion/finnhub/ingestNews");
    const { ingestEarnings } = await import("../ingestion/finnhub/ingestEarnings");
    const { ingestSocial } = await import("../ingestion/stocktwits/ingestSocial");
    console.log("  Prices...");
    await ingestPrices(watchlist);
    console.log("  News...");
    await ingestNews(watchlist);
    console.log("  Earnings dates...");
    await ingestEarnings(watchlist);
    console.log("  Forum posts...");
    await ingestSocial(watchlist);
    console.log("  Insider filings (the slow one)...");
    await ingestFilings(watchlist);
    ok("Data loaded.");

    step(5, "First calls");
    if (claude) {
      console.log(`  Claude will make one call per stock: about $${(watchlist.length * 0.015).toFixed(2)} in total, from your Anthropic credit.`);
      if (await confirm("Make the first calls now?", false)) {
        const { generateSignalsWithRetry } = await import("../analysis/signalRetry");
        for (const o of await generateSignalsWithRetry(watchlist)) {
          if (o.status === "ok") ok(`${o.tickerSymbol}: ${o.signal.direction}`);
          else fail(`${o.tickerSymbol}: ${o.actionableMessage}`);
        }
      } else console.log("  Skipped. The first scheduled update will make them.");
    } else {
      const { generateRuleSignals } = await import("../baseline/rulesSignals");
      for (const r of await generateRuleSignals(watchlist)) {
        if (r.status === "ok") ok(`${r.symbol}: ${r.direction}`);
        else fail(`${r.symbol}: ${r.reason}`);
      }
    }
  } else {
    console.log("  Skipped. The first scheduled update will load it.");
  }
  await prisma.$disconnect();

  step(6, "Automatic updates (GitHub)");
  const ghReady = spawnSync("gh", ["auth", "status"], { shell: true, stdio: "ignore" }).status === 0;
  const secrets: Record<string, string> = {
    DATABASE_URL: databaseUrl,
    TWELVE_DATA_API_KEY: twelve,
    FINNHUB_API_KEY: finnhub,
    EDGAR_USER_AGENT: edgar,
    ...(claude ? { CLAUDE_API_KEY: claude } : {}),
  };
  if (ghReady && (await confirm("Copy your keys into this GitHub repo's secrets so updates run Mon/Wed/Fri?", true))) {
    for (const [name, value] of Object.entries(secrets)) {
      const r = spawnSync("gh", ["secret", "set", name], { input: value, shell: true });
      if (r.status === 0) ok(name);
      else fail(`${name}: ${r.stderr.toString().trim()}`);
    }
    if (!claude) {
      console.log("  (No Claude key, so CLAUDE_API_KEY isn't set; if an old one is there, delete it to use the free rules.)");
    }
    console.log("  On a fork, also open the Actions tab once and enable workflows: GitHub turns them off on forks.");
  } else {
    console.log(`  In your GitHub repo: Settings → Secrets and variables → Actions, add these
  (values are in apps/api/.env): ${Object.keys(secrets).join(", ")}.
  On a fork, also open the Actions tab once and enable workflows.`);
  }

  console.log(`
Done.

  See it on your computer:   npm run dev --workspace=@financial-adviser/web
                             then open http://localhost:3000

  Put it online (Vercel):    import this repo at vercel.com/new, set the root
                             directory to apps/web, and add these environment
                             variables (values are in apps/web/.env.local):
                             DATABASE_URL, MANAGE_PASSWORD

  Your Manage password:      in apps/web/.env.local (MANAGE_PASSWORD)
`);
}

main()
  .catch((err) => {
    console.error(`\nSetup stopped: ${err instanceof Error ? err.message : err}`);
    process.exitCode = 1;
  })
  .finally(() => rl.close());
