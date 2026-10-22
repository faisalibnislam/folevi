// Sign in with Apple's return (convex/auth.ts appleSignIn). Apple answers with a form it posts from
// appleid.apple.com to https://app.folevi.com/api/auth/callback/apple ("form_post"): a cross-site POST, so the
// browser leaves out Folevi's SameSite=Lax cookies, including the one that ties the sign-in to this browser.
// Better Auth's own answer to that POST is to send the browser on to a GET of the same callback, which is a
// top-level navigation and does carry the cookies; it checks the state and finishes there.
//
// This does the same here, in the web app, before anything reaches the backend: the POST never gets to
// Better Auth, so there's no cross-site POST for its origin check to judge and no reason to trust Apple's
// origin for anything else. Apple's `user` field (the name, sent only the first time, and the address) is
// kept out of the address bar and the logs: it rides in a short-lived HttpOnly cookie on the redirect and is
// put back on the GET only on its way to the backend.

export const APPLE_CALLBACK_PATH = "/api/auth/callback/apple";
export const APPLE_USER_COOKIE = "folevi.apple_user";

/** Apple's `user` field is a small JSON object; anything bigger isn't Apple's. */
const USER_MAX = 2048;
const FIELD_MAX = 4096;
const USER_COOKIE_SECONDS = 10 * 60;

const isAppleCallback = (request: Request) => new URL(request.url).pathname === APPLE_CALLBACK_PATH;

function userCookie(value: string, secure: boolean): string {
  const parts = [`${APPLE_USER_COOKIE}=${value}`, `Path=${APPLE_CALLBACK_PATH}`, `Max-Age=${value ? USER_COOKIE_SECONDS : 0}`, "HttpOnly", "SameSite=Lax"];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

/** Apple's `user` field when it's what Apple sends ({ name?: { firstName, lastName }, email? }), else null. */
function appleUser(raw: string): string | null {
  if (!raw || raw.length > USER_MAX) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? JSON.stringify(parsed) : null;
  } catch {
    return null;
  }
}

/**
 * Apple's form post to the callback, as a 303 to the same callback by GET with its code and state (or its
 * error). Null for any other request, which goes to Better Auth as usual.
 */
export async function appleFormPost(request: Request, secure: boolean): Promise<Response | null> {
  if (request.method !== "POST" || !isAppleCallback(request)) return null;
  let form: URLSearchParams;
  try {
    form = new URLSearchParams(await request.text());
  } catch {
    form = new URLSearchParams();
  }
  const query = new URLSearchParams();
  for (const key of ["code", "state", "error"]) {
    const value = form.get(key);
    if (value && value.length <= FIELD_MAX) query.set(key, value);
  }
  // Nothing Folevi can use (a stray post): Better Auth turns a callback without code or state into an error.
  const headers = new Headers({ location: `${APPLE_CALLBACK_PATH}${query.size ? `?${query}` : ""}`, "cache-control": "no-store", "referrer-policy": "no-referrer" });
  const user = appleUser(form.get("user") ?? "");
  if (user) headers.append("set-cookie", userCookie(encodeURIComponent(user), secure));
  return new Response(null, { status: 303, headers });
}

function cookieValue(request: Request, name: string): string | null {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

/**
 * The GET that finishes the sign-in, with Apple's `user` field put back from its cookie (Better Auth reads the
 * name from it) and the cookie cleared. Other requests pass through unchanged, with nothing to clear.
 */
export function withAppleUser(request: Request, secure: boolean): { request: Request; clear: string | null } {
  if (request.method !== "GET" || !isAppleCallback(request)) return { request, clear: null };
  const stored = cookieValue(request, APPLE_USER_COOKIE);
  if (stored === null) return { request, clear: null };
  const clear = userCookie("", secure);
  let user: string | null;
  try {
    user = appleUser(decodeURIComponent(stored));
  } catch {
    user = null;
  }
  const url = new URL(request.url);
  if (!user || url.searchParams.has("user")) return { request, clear };
  url.searchParams.set("user", user);
  return { request: new Request(url, { method: "GET", headers: request.headers }), clear };
}
