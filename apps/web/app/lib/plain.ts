/**
 * Plain-language wording for people who don't trade. One place for it, so
 * "bullish", "stop-loss" and "direction confidence" can't creep back into one
 * page while the others say it simply.
 */

export const HORIZON_DAYS = 7;

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** e.g. "Fri 20 Nov". Dates are stored as UTC calendar days; built by hand so server and locale can't change it. */
export function fmtDay(d: Date): string {
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** The week at a glance, e.g. "4 of your 5 stocks are leaning down this week." */
export function weekHeadline(directions: string[]): string {
  const n = directions.length;
  const up = directions.filter((d) => d === "bullish").length;
  const down = directions.filter((d) => d === "bearish").length;
  if (n === 0) return "No calls yet this week.";
  const of = (k: number) => (k === n ? (n === 1 ? "Your stock is" : `All ${n} of your stocks are`) : `${k} of your ${n} stocks ${k === 1 ? "is" : "are"}`);
  if (down > up) return `${of(down)} leaning down this week.`;
  if (up > down) return `${of(up)} leaning up this week.`;
  if (up === 0) return "No clear direction for any of your stocks this week.";
  return "A mixed week: as many stocks leaning up as down.";
}

export function fmtPrice(n: number): string {
  return `$${n.toFixed(2)}`;
}

export function addDays(d: Date, n: number): Date {
  const copy = new Date(d);
  copy.setUTCDate(copy.getUTCDate() + n);
  return copy;
}

export interface Verdict {
  label: string;
  symbol: string;
  tone: string; // text colour class
  bg: string; // soft background class for the badge
}

export function verdictFor(direction: string): Verdict {
  if (direction === "bullish") return { label: "Leaning up this week", symbol: "▲", tone: "text-bullish", bg: "bg-bullish/10" };
  if (direction === "bearish") return { label: "Leaning down this week", symbol: "▼", tone: "text-bearish", bg: "bg-bearish/10" };
  return { label: "No clear direction", symbol: "●", tone: "text-neutralSignal", bg: "bg-neutralSignal/10" };
}

/** Confidence as words. The numbers have never been calibrated, so a precise percentage would overstate them. */
export function surenessFor(confidence: number): string {
  if (confidence >= 65) return "Fairly sure";
  if (confidence >= 50) return "Somewhat sure";
  return "Not very sure";
}

/** What the target and stop mean, in a sentence each. Null when the call set none. */
export function levelsInWords(
  direction: string,
  target: number | null,
  stop: number | null,
  issued: Date
): { ifRight: string; ifWrong: string } | null {
  if ((direction !== "bullish" && direction !== "bearish") || target === null || stop === null) return null;
  const by = fmtDay(addDays(issued, HORIZON_DAYS));
  return direction === "bullish"
    ? {
        ifRight: `If this plays out, the price could rise to about ${fmtPrice(target)} by ${by}.`,
        ifWrong: `If it falls below ${fmtPrice(stop)} instead, this call was wrong.`,
      }
    : {
        ifRight: `If this plays out, the price could fall to about ${fmtPrice(target)} by ${by}.`,
        ifWrong: `If it rises above ${fmtPrice(stop)} instead, this call was wrong.`,
      };
}

export interface PlainOutcome {
  text: string;
  mark: string;
  tone: string;
}

export function outcomeInWords(outcome: string | null): PlainOutcome {
  switch (outcome) {
    case "hit_target":
      return { text: "Went as expected", mark: "✓", tone: "text-bullish" };
    case "hit_stop":
      return { text: "Went the other way", mark: "✗", tone: "text-bearish" };
    case "expired_direction_correct":
      return { text: "Moved the right way, but only a little", mark: "~", tone: "text-muted" };
    case "expired_direction_wrong":
      return { text: "Moved the wrong way, but only a little", mark: "~", tone: "text-muted" };
    case "ambiguous_same_day":
      return { text: "Unclear — big swings both ways", mark: "?", tone: "text-muted" };
    case "no_evaluation":
      return { text: "No call made", mark: "–", tone: "text-muted" };
    default:
      return { text: "Still waiting to see", mark: "…", tone: "text-muted" };
  }
}

/** Below this many checked calls, any percentage is mostly luck. */
export const MIN_CALLS_FOR_A_VERDICT = 20;

/**
 * One honest sentence about reliability. Calls are only counted when the price
 * clearly reached one of the two levels -- the cleanest test available.
 */
export function reliabilityInWords(right: number, wrong: number): string {
  const n = right + wrong;
  if (n < MIN_CALLS_FOR_A_VERDICT) {
    return `Too early to tell how reliable these calls are — only ${n} ${n === 1 ? "has" : "have"} been checked so far.`;
  }
  const rate = right / n;
  const tally = `${right} of ${n} went as expected`;
  if (rate < 0.4) return `So far these calls have been wrong more often than right (${tally}).`;
  if (rate <= 0.6) return `So far these calls have been right about as often as a coin flip (${tally}).`;
  return `So far these calls have been right more often than not (${tally}) — but that may not last.`;
}

export interface MarketFacts {
  price: number | null;
  weekChangePct: number | null;
  trend: "up" | "down" | "mixed" | null;
  insiderBuys: number;
  daysToEarnings: number | null;
}

/** Short plain sentences about what the data shows -- facts, not the call itself. */
export function factsInWords(f: MarketFacts): string[] {
  const out: string[] = [];
  if (f.daysToEarnings !== null && f.daysToEarnings <= HORIZON_DAYS) {
    const when = f.daysToEarnings <= 0 ? "today" : f.daysToEarnings === 1 ? "tomorrow" : `in ${f.daysToEarnings} days`;
    out.push(`Earnings report due ${when} — prices can jump sharply either way.`);
  }
  if (f.trend === "up") out.push("The price has been trending up over recent months.");
  else if (f.trend === "down") out.push("The price has been trending down over recent months.");
  else if (f.trend === "mixed") out.push("No clear trend in the price over recent months.");
  if (f.insiderBuys > 0) out.push("Company insiders recently bought shares with their own money.");
  return out;
}

export function weekChangeInWords(pct: number | null): { text: string; tone: string } | null {
  if (pct === null) return null;
  const rounded = Math.abs(pct) < 0.05 ? 0 : pct;
  if (rounded === 0) return { text: "flat this week", tone: "text-muted" };
  return {
    text: `${rounded > 0 ? "up" : "down"} ${Math.abs(rounded).toFixed(1)}% this week`,
    tone: rounded > 0 ? "text-bullish" : "text-bearish",
  };
}
