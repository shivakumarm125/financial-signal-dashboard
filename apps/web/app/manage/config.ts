// Plain module, deliberately NOT "use server": a server-action file may only
// export async functions, so shared constants and types live here instead.

/** A1's locked product decision: 10 tickers per user for MVP. */
export const MAX_TICKERS = 10;

export interface ActionResult {
  ok: boolean;
  message: string;
}
