import { NextResponse, type NextRequest } from "next/server";

/**
 * HTTP Basic auth over /manage.
 *
 * /manage can permanently delete a ticker's entire price history, filings,
 * news, signals and track record, with no undo and no backup. It was shipped
 * onto a publicly reachable URL: an anonymous request returned 200 and the real
 * page. The project has ssoProtection configured as
 * "all_except_custom_domains", which was not in fact applying to the production
 * alias -- the appearance of protection without the fact of it.
 *
 * This is a stopgap sized to a ~10-user friends-and-family tool, not a
 * replacement for Epic E's real auth. It covers the destructive surface now;
 * E1-E3 supersede it.
 *
 * FAILS CLOSED. With MANAGE_PASSWORD unset the route is denied outright rather
 * than left open, so a missing env var can never silently republish the delete
 * button to the internet.
 */

const REALM = 'Basic realm="Financial Signal Dashboard", charset="UTF-8"';

function unauthorized(message: string) {
  return new NextResponse(message, {
    status: 401,
    headers: { "WWW-Authenticate": REALM, "Content-Type": "text/plain" },
  });
}

/** Length-constant comparison -- avoids leaking the password a character at a time via timing. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function middleware(request: NextRequest) {
  const expected = process.env.MANAGE_PASSWORD;
  if (!expected) {
    return unauthorized("Management is disabled: MANAGE_PASSWORD is not configured.");
  }

  const header = request.headers.get("authorization");
  if (!header?.startsWith("Basic ")) {
    return unauthorized("Authentication required.");
  }

  let decoded: string;
  try {
    decoded = atob(header.slice(6));
  } catch {
    return unauthorized("Malformed credentials.");
  }

  // Everything after the first colon is the password, so colons in it are fine.
  const separator = decoded.indexOf(":");
  const password = separator === -1 ? "" : decoded.slice(separator + 1);

  if (!safeEqual(password, expected)) {
    return unauthorized("Invalid credentials.");
  }

  return NextResponse.next();
}

export const config = {
  // Covers the page AND its server actions, which POST back to this same path.
  matcher: ["/manage", "/manage/:path*"],
};
