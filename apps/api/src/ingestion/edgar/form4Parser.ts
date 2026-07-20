import { XMLParser } from "fast-xml-parser";

export interface ParsedTransaction {
  insiderName: string;
  insiderIsDirector: boolean;
  insiderIsOfficer: boolean;
  insiderOfficerTitle: string | null;
  insiderIsTenPercentOwner: boolean;
  transactionCode: string;
  transactionDate: Date;
  sharesTransacted: number;
  pricePerShare: number | null;
}

const parser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false, // keep everything as strings; we convert explicitly below
});

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function isTrue(value: unknown): boolean {
  // SEC's Form 4 XML is inconsistent across filings/years: booleans show up as
  // "1", "true", or the actual boolean depending on which tool generated the filing.
  if (typeof value === "string") return value === "1" || value.toLowerCase() === "true";
  return value === 1 || value === true;
}

/** Digs the SEC XML's common `<field><value>x</value></field>` wrapper down to the raw string. */
function unwrapValue(node: unknown): string | undefined {
  if (node == null) return undefined;
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (typeof node === "object" && "value" in (node as Record<string, unknown>)) {
    return String((node as Record<string, unknown>).value);
  }
  return undefined;
}

/**
 * Parses a Form 4 (or 4/A) primary XML document into one record per
 * non-derivative transaction line item. Derivative transactions (options,
 * RSUs, etc.) are out of scope for MVP — a documented simplification, not an
 * oversight; non-derivative (direct stock) transactions are what B1's AC
 * asks for (insider name/role, transaction type, shares, date).
 *
 * If a filing has multiple joint reporting owners, all transactions are
 * attributed to the first-listed owner — another documented MVP
 * simplification rather than modeling joint-filer attribution.
 */
export function parseForm4Xml(xml: string): ParsedTransaction[] {
  const doc = parser.parse(xml);
  const root = doc.ownershipDocument;
  if (!root) return [];

  const owners = asArray(root.reportingOwner);
  const primaryOwner = owners[0];
  if (!primaryOwner) return [];

  const relationship = primaryOwner.reportingOwnerRelationship ?? {};
  const insiderName: string =
    primaryOwner.reportingOwnerId?.rptOwnerName ?? "Unknown";
  const insiderIsDirector = isTrue(relationship.isDirector);
  const insiderIsOfficer = isTrue(relationship.isOfficer);
  const insiderIsTenPercentOwner = isTrue(relationship.isTenPercentOwner);
  const officerTitle = relationship.officerTitle;
  const insiderOfficerTitle =
    typeof officerTitle === "string" && officerTitle.trim().length > 0 ? officerTitle.trim() : null;

  const transactions = asArray(root.nonDerivativeTable?.nonDerivativeTransaction);

  return transactions.map((txn): ParsedTransaction => {
    const dateStr = unwrapValue(txn.transactionDate);
    const code = unwrapValue(txn.transactionCoding?.transactionCode) ?? "";
    const shares = unwrapValue(txn.transactionAmounts?.transactionShares);
    const price = unwrapValue(txn.transactionAmounts?.transactionPricePerShare);

    return {
      insiderName,
      insiderIsDirector,
      insiderIsOfficer,
      insiderOfficerTitle,
      insiderIsTenPercentOwner,
      transactionCode: code,
      transactionDate: new Date(dateStr ?? ""),
      sharesTransacted: Number(shares ?? 0),
      pricePerShare: price != null && price !== "" ? Number(price) : null,
    };
  });
}
