import { edgarFetch } from "./httpClient";
import { EDGAR_URLS } from "./config";

export interface FilingRef {
  accessionNumber: string;
  filingDate: string; // ISO date string, e.g. "2026-07-10"
  primaryDocument: string;
  isAmendment: boolean;
}

interface SubmissionsResponse {
  filings: {
    recent: {
      form: string[];
      accessionNumber: string[];
      filingDate: string[];
      primaryDocument: string[];
    };
  };
}

/**
 * Returns Form 4 / Form 4/A filings for a CIK, newest first, stopping once
 * `sinceAccessionNumber` is reached (exclusive) so only genuinely new filings
 * are returned. Pass `null` to get everything in EDGAR's "recent" window —
 * full historical backfill beyond that window is B8's job, not B1's.
 */
export async function getNewForm4Filings(
  cik: string,
  sinceAccessionNumber: string | null
): Promise<FilingRef[]> {
  const res = await edgarFetch(EDGAR_URLS.submissions(cik));
  const data = (await res.json()) as SubmissionsResponse;
  const { form, accessionNumber, filingDate, primaryDocument } = data.filings.recent;

  const result: FilingRef[] = [];
  for (let i = 0; i < form.length; i++) {
    if (accessionNumber[i] === sinceAccessionNumber) break;
    if (form[i] !== "4" && form[i] !== "4/A") continue;

    result.push({
      accessionNumber: accessionNumber[i],
      filingDate: filingDate[i],
      primaryDocument: primaryDocument[i],
      isAmendment: form[i] === "4/A",
    });
  }

  return result;
}
