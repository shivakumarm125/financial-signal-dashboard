const userAgent = process.env.EDGAR_USER_AGENT;
if (!userAgent) {
  throw new Error(
    "EDGAR_USER_AGENT is not set. SEC EDGAR requires a real, descriptive User-Agent " +
      '(e.g. "Your Name your@email.com") on every request or it will throttle/block us.'
  );
}

export const EDGAR_USER_AGENT = userAgent;

export const EDGAR_URLS = {
  companyTickers: "https://www.sec.gov/files/company_tickers.json",
  submissions: (cik: string) => `https://data.sec.gov/submissions/CIK${cik}.json`,
  archiveDocument: (cikNoPadding: string, accessionNoDashes: string, primaryDocument: string) =>
    `https://www.sec.gov/Archives/edgar/data/${cikNoPadding}/${accessionNoDashes}/${primaryDocument}`,
};

// SEC's fair-access policy caps automated traffic at 10 requests/second.
// 120ms keeps us comfortably under that even accounting for jitter.
export const MIN_REQUEST_INTERVAL_MS = 120;

// Re-check company_tickers.json at most this often — ticker/CIK mappings change rarely.
export const CIK_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
