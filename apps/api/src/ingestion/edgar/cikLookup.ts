import { promises as fs } from "fs";
import path from "path";
import { edgarFetch } from "./httpClient";
import { EDGAR_URLS, CIK_CACHE_MAX_AGE_MS } from "./config";

const CACHE_PATH = path.join(__dirname, "..", "..", "..", ".cache", "company-tickers.json");

interface RawCompanyTickerEntry {
  cik_str: number;
  ticker: string;
  title: string;
}

interface Cache {
  fetchedAt: number;
  bySymbol: Record<string, { cik: string; name: string }>;
}

let memoryCache: Cache | null = null;

function padCik(cikNumber: number): string {
  return String(cikNumber).padStart(10, "0");
}

async function readCacheFile(): Promise<Cache | null> {
  try {
    const raw = await fs.readFile(CACHE_PATH, "utf-8");
    return JSON.parse(raw) as Cache;
  } catch {
    return null;
  }
}

async function writeCacheFile(cache: Cache): Promise<void> {
  await fs.mkdir(path.dirname(CACHE_PATH), { recursive: true });
  await fs.writeFile(CACHE_PATH, JSON.stringify(cache), "utf-8");
}

async function fetchFreshCache(): Promise<Cache> {
  const res = await edgarFetch(EDGAR_URLS.companyTickers);
  const raw = (await res.json()) as Record<string, RawCompanyTickerEntry>;

  const bySymbol: Cache["bySymbol"] = {};
  for (const entry of Object.values(raw)) {
    bySymbol[entry.ticker.toUpperCase()] = {
      cik: padCik(entry.cik_str),
      name: entry.title,
    };
  }

  const cache: Cache = { fetchedAt: Date.now(), bySymbol };
  await writeCacheFile(cache);
  return cache;
}

async function getCache(): Promise<Cache> {
  if (memoryCache && Date.now() - memoryCache.fetchedAt < CIK_CACHE_MAX_AGE_MS) {
    return memoryCache;
  }

  const fileCache = await readCacheFile();
  if (fileCache && Date.now() - fileCache.fetchedAt < CIK_CACHE_MAX_AGE_MS) {
    memoryCache = fileCache;
    return fileCache;
  }

  memoryCache = await fetchFreshCache();
  return memoryCache;
}

/** Resolves a ticker symbol (e.g. "AAPL") to its zero-padded 10-digit SEC CIK, or null if unknown. */
export async function getCikForSymbol(symbol: string): Promise<{ cik: string; name: string } | null> {
  const cache = await getCache();
  return cache.bySymbol[symbol.toUpperCase()] ?? null;
}
