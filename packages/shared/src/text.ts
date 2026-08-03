/**
 * Text helpers for anything that gets truncated on its way into a prompt.
 *
 * Background (2026-08-03): COIN's signal failed for the day with an opaque
 * `non_retryable_error`. The cause was a StockTwits post ending in a 🇮🇷 flag,
 * which is a pair of astral characters. promptAssembly's `body.slice(0, 260)`
 * cut it between a surrogate pair's two halves, leaving a lone high surrogate
 * (U+D83C) in the prompt. A lone surrogate is not valid Unicode, so the JSON
 * request body containing it was unserializable and the Anthropic API rejected
 * the ENTIRE request with `400 ... unexpected end of hex escape`.
 *
 * Worth noting how badly this failed: one stray character in one forum post
 * silently cost a whole ticker its signal, and the failure looked like a
 * generic API error rather than a data bug.
 */

/**
 * Truncates to at most `maxLength` UTF-16 code units without splitting a
 * surrogate pair. Use this instead of `.slice(0, n)` on any user- or
 * vendor-supplied text -- emoji, flags, and non-BMP scripts are all pairs.
 */
export function truncateSafely(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  const cut = text.slice(0, maxLength);
  const lastUnit = cut.charCodeAt(maxLength - 1);
  // A trailing high surrogate means its low half is exactly what we just
  // chopped off, so drop it too rather than emit half a character.
  const isDanglingHighSurrogate = lastUnit >= 0xd800 && lastUnit <= 0xdbff;
  return isDanglingHighSurrogate ? cut.slice(0, -1) : cut;
}

/**
 * Strips any unpaired surrogate from a string.
 *
 * Belt-and-braces for text assembled out of stored data we didn't truncate
 * ourselves: rows ingested before `truncateSafely` existed can already hold a
 * broken character, and a single one anywhere fails the whole request. Applied
 * at the API boundary so no upstream producer has to be trusted to get this
 * right.
 */
export function stripLoneSurrogates(text: string): string {
  return text.replace(
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
    ""
  );
}
