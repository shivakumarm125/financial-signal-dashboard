import { fmtPrice } from "../lib/plain";

/**
 * The call as a picture: a line from the price that would make it wrong to the
 * price it points to, with where the price is now. Prices always run low to
 * high, left to right, so "down" calls aim left and "up" calls aim right -- the
 * same way a reader already imagines a price moving.
 *
 * Renders nothing for a call without both levels; the page says "no call" in
 * words instead.
 */
export function PriceTrack({
  direction,
  target,
  stop,
  entry,
  current,
  large = false,
}: {
  direction: string;
  target: number | null;
  stop: number | null;
  entry: number | null;
  current: number | null;
  large?: boolean;
}) {
  if ((direction !== "bullish" && direction !== "bearish") || target === null || stop === null) return null;

  // Literal class names: Tailwind only generates classes it can find verbatim.
  const tone =
    direction === "bullish"
      ? { bar: "bg-bullish/35", dot: "bg-bullish", text: "text-bullish" }
      : { bar: "bg-bearish/35", dot: "bg-bearish", text: "text-bearish" };
  const values = [target, stop, ...(entry !== null ? [entry] : []), ...(current !== null ? [current] : [])];
  const span = Math.max(...values) - Math.min(...values) || 1;
  const lo = Math.min(...values) - span * 0.06;
  const hi = Math.max(...values) + span * 0.06;
  const pos = (x: number) => ((x - lo) / (hi - lo)) * 100;

  const tPos = pos(target);
  const sPos = pos(stop);
  const left = Math.min(tPos, sPos);
  const width = Math.abs(tPos - sPos);
  const from = entry ?? current;

  // Labels hug the edge they're near so they never spill off the sheet.
  const align = (p: number) => (p < 18 ? "left-0" : p > 82 ? "right-0" : "-translate-x-1/2");
  const at = (p: number) => (p < 18 || p > 82 ? undefined : { left: `${p}%` });

  const nowLabel =
    current === null
      ? null
      : (direction === "bullish" ? current >= target : current <= target)
        ? "Target reached"
        : (direction === "bullish" ? current <= stop : current >= stop)
          ? "Past the wrong line"
          : "Now";

  return (
    <figure
      className={large ? "pt-8" : "pt-7"}
      aria-label={`Target ${fmtPrice(target)}, wrong past ${fmtPrice(stop)}${current !== null ? `, now ${fmtPrice(current)}` : ""}`}
    >
      <div className={`relative ${large ? "h-3" : "h-2"}`}>
        {/* the whole range of the call */}
        <div className="absolute inset-y-0 rounded-full bg-line" style={{ left: `${left}%`, width: `${width}%` }} />
        {/* the stretch the call expects the price to travel */}
        {from !== null && (
          <div
            className={`absolute inset-y-0 rounded-full ${tone.bar}`}
            style={{ left: `${Math.min(pos(from), tPos)}%`, width: `${Math.abs(tPos - pos(from))}%` }}
          />
        )}
        {/* target end */}
        <div
          className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full ${tone.dot} ${large ? "h-4 w-4" : "h-3 w-3"}`}
          style={{ left: `${tPos}%` }}
        />
        {/* wrong-if end */}
        <div
          className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 bg-muted ${large ? "h-5 w-[3px]" : "h-4 w-[2px]"}`}
          style={{ left: `${sPos}%` }}
        />
        {/* price now */}
        {current !== null && (
          <>
            <div
              className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-white bg-ink shadow-[0_0_0_1px_#17302A] ${
                large ? "h-5 w-5" : "h-4 w-4"
              }`}
              style={{ left: `${pos(current)}%` }}
            />
            <div
              className={`absolute bottom-full mb-2 whitespace-nowrap text-sm font-medium ${align(pos(current))}`}
              style={at(pos(current))}
            >
              {nowLabel} {fmtPrice(current)}
            </div>
          </>
        )}
      </div>
      <div className={`relative mt-2 ${large ? "h-11" : "h-10"} text-sm`}>
        <div className={`absolute whitespace-nowrap ${align(tPos)} ${tPos > sPos ? "text-right" : ""}`} style={at(tPos)}>
          <div className={`font-medium ${tone.text}`}>{fmtPrice(target)}</div>
          <div className="text-muted">If right</div>
        </div>
        <div className={`absolute whitespace-nowrap ${align(sPos)} ${sPos > tPos ? "text-right" : ""}`} style={at(sPos)}>
          <div className="font-medium">{fmtPrice(stop)}</div>
          <div className="text-muted">Wrong past here</div>
        </div>
      </div>
    </figure>
  );
}
