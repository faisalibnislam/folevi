// Several accounts in one browser (docs/MULTI_ACCOUNT_PLAN.md §2.1): the cookie arithmetic behind the /api/auth
// proxy's pin. Pure, so it runs in the unit tests and on the server alike.
//
// Better Auth's multi-session plugin gives every session a cookie `<session cookie>_multi-<token, lowercased>`
// whose value is the session cookie's own signed value. A tab sends `x-folevi-account: <user id>`; the proxy
// swaps the request's session cookie for that account's multi cookie, found through `folevi.places`, a map of
// user id to a hash of the token (never the token) that only the server writes.

/** The header a tab names its account with. */
export const PIN_HEADER = "x-folevi-account";

/** Better Auth's session cookie, with or without the `__Secure-` prefix it gets on https. */
const SESSION = "folevi.session_token";
const MULTI = `${SESSION}_multi-`;
/** Folevi's map of the accounts in the jar (HTTP-only; `__Host-` on https). */
export const PLACES_COOKIE = "folevi.places";

export interface CookieJar {
  /** Every cookie, in the order sent. */
  all: { name: string; value: string }[];
  /** The browser's active session cookie (name as sent), if any. */
  session: { name: string; value: string } | null;
  /** The multi-session cookies: `token` is the lowercased session token from the cookie's name. */
  multi: { name: string; value: string; token: string }[];
  /** Folevi's map: user id to token hash. */
  map: Record<string, string>;
}

export function parseCookieHeader(header: string | null | undefined): { name: string; value: string }[] {
  if (!header) return [];
  const out: { name: string; value: string }[] = [];
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    if (name) out.push({ name, value: part.slice(eq + 1).trim() });
  }
  return out;
}

const isSessionName = (name: string) => name === SESSION || name === `__Secure-${SESSION}`;
const multiToken = (name: string) => {
  const at = name.indexOf(MULTI);
  if (at < 0 || (at !== 0 && name.slice(0, at) !== "__Secure-")) return null;
  const token = name.slice(at + MULTI.length);
  return token ? token.toLowerCase() : null;
};
const isPlacesName = (name: string) => name === PLACES_COOKIE || name === `__Host-${PLACES_COOKIE}`;

export function readJar(header: string | null | undefined): CookieJar {
  const all = parseCookieHeader(header);
  let session: CookieJar["session"] = null;
  const multi: CookieJar["multi"] = [];
  let map: Record<string, string> = {};
  for (const c of all) {
    if (isSessionName(c.name) && c.value) session = c;
    const token = multiToken(c.name);
    if (token && c.value) multi.push({ ...c, token });
    if (isPlacesName(c.name)) map = decodeMap(c.value);
  }
  return { all, session, multi, map };
}

/** The session token inside a signed cookie value (`encodeURIComponent("<token>.<signature>")`). */
export function tokenOfValue(value: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return null;
  }
  const dot = decoded.lastIndexOf(".");
  const token = dot > 0 ? decoded.slice(0, dot) : "";
  return /^[A-Za-z0-9_-]{8,256}$/.test(token) ? token : null;
}

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** What the map keeps for a session: 16 characters of the lowercased token's SHA-256 (it can't give the token back). */
export async function tokenHash(token: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`folevi-place:${token.toLowerCase()}`)));
  return b64url(digest).slice(0, 16);
}

const USER_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function encodeMap(map: Record<string, string>): string {
  const clean = Object.fromEntries(Object.entries(map).filter(([k, v]) => USER_ID.test(k) && /^[A-Za-z0-9_-]{16}$/.test(v)));
  return b64url(new TextEncoder().encode(JSON.stringify(clean)));
}

export function decodeMap(value: string): Record<string, string> {
  try {
    const b64 = value.replace(/-/g, "+").replace(/_/g, "/");
    const json = new TextDecoder().decode(Uint8Array.from(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)), (c) => c.charCodeAt(0)));
    const raw = JSON.parse(json) as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    return Object.fromEntries(Object.entries(raw as Record<string, unknown>).filter((e): e is [string, string] => USER_ID.test(e[0]) && typeof e[1] === "string" && /^[A-Za-z0-9_-]{16}$/.test(e[1])));
  } catch {
    return {};
  }
}

/** The multi cookie the map names for a user, if it's still in the jar. */
export async function multiFor(jar: CookieJar, userId: string): Promise<CookieJar["multi"][number] | null> {
  const want = jar.map[userId];
  if (!want) return null;
  for (const m of jar.multi) if ((await tokenHash(m.token)) === want) return m;
  return null;
}

/**
 * The Cookie header with the session cookie's value replaced (or added, under `sessionName`): the request then
 * reaches Better Auth as that account's. `null` drops the session cookie (the pinned account isn't here).
 */
export function withSessionValue(jar: CookieJar, value: string | null, sessionName: string): string {
  const out: string[] = [];
  let placed = false;
  for (const c of jar.all) {
    if (isSessionName(c.name)) {
      if (value !== null && !placed) out.push(`${c.name}=${value}`);
      placed = true;
      continue;
    }
    out.push(`${c.name}=${c.value}`);
  }
  if (!placed && value !== null) out.push(`${sessionName}=${value}`);
  return out.join("; ");
}

/** The session cookie's name for this origin. */
export function sessionCookieName(secure: boolean): string {
  return secure ? `__Secure-${SESSION}` : SESSION;
}

export interface CookieAttrs {
  secure: boolean;
  /** Seconds; 0 removes the cookie. */
  maxAge: number;
}

function attrs(a: CookieAttrs, path = "/"): string {
  return [`Path=${path}`, `Max-Age=${Math.max(0, Math.floor(a.maxAge))}`, "HttpOnly", "SameSite=Lax", ...(a.secure ? ["Secure"] : [])].join("; ");
}

/** Sets (or, with maxAge 0, removes) Folevi's map. */
export function placesSetCookie(map: Record<string, string>, a: CookieAttrs): string {
  const name = a.secure ? `__Host-${PLACES_COOKIE}` : PLACES_COOKIE;
  return `${name}=${a.maxAge > 0 ? encodeMap(map) : ""}; ${attrs(a)}`;
}

/**
 * A multi cookie for the active session, for a session made before the plugin was on (it has none, and would
 * otherwise be forgotten when the browser signs in to another account). Same value as the session cookie.
 */
export function multiSetCookie(sessionName: string, sessionValue: string, a: CookieAttrs): string | null {
  const token = tokenOfValue(sessionValue);
  if (!token) return null;
  const prefix = sessionName.startsWith("__Secure-") ? "__Secure-" : "";
  return `${prefix}${MULTI}${token.toLowerCase()}=${a.maxAge > 0 ? sessionValue : ""}; ${attrs(a)}`;
}

/** Removes a multi cookie by its name as sent. */
export function expireCookie(name: string, secure: boolean): string {
  return `${name}=; ${attrs({ secure, maxAge: 0 })}`;
}

/** Whether a Cookie header holds any session, active or kept for another account. */
export function hasAnySession(header: string | null | undefined): boolean {
  const jar = readJar(header);
  return jar.session !== null || jar.multi.length > 0;
}

/** /api/auth paths a browser may never call itself: the plugin's, which take raw session tokens. */
export function isPrivateAuthPath(pathname: string): boolean {
  return /^\/api\/auth\/multi-session(\/|$)/.test(pathname);
}
