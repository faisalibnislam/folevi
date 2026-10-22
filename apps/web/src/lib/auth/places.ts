import "server-only";
// Several accounts in one browser, on the server (docs/MULTI_ACCOUNT_PLAN.md §2.1). Each tab names its account
// (`x-folevi-account`); `pinRequest` makes the request reach Better Auth as that account's, whatever session the
// browser's active cookie holds, so one tab switching never changes what another tab is signed in as. The
// accounts in the jar and signing out of one go through here too, server to server: the multi-session plugin's
// own endpoints take raw session tokens, and browsers are never let near them.
import { PIN_HEADER, expireCookie, multiFor, multiSetCookie, placesSetCookie, readJar, sessionCookieName, tokenHash, withSessionValue, type CookieJar } from "./placesCookies";

/** Sends a request on to Better Auth (the /api/auth proxy's own forwarding, with the signed client IP). */
export type Forward = (request: Request) => Promise<Response>;

export interface JarAccount {
  userId: string;
  name: string;
  email: string;
  image: string | null;
  /** The session's token (server side only: never sent to a page). */
  token: string;
  expiresAt: number;
  /** The browser's active session. */
  active: boolean;
}

const FOURTEEN_DAYS = 60 * 60 * 24 * 14;
const USER_ID = /^[A-Za-z0-9_-]{1,64}$/;

function authRequest(base: Request, path: string, init: { method?: string; cookie: string; body?: string }): Request {
  const headers = new Headers();
  for (const name of ["user-agent", "x-real-ip", "x-forwarded-for", "origin", "referer", "accept-language"]) {
    const v = base.headers.get(name);
    if (v) headers.set(name, v);
  }
  headers.set("cookie", init.cookie);
  headers.set("accept", "application/json");
  if (init.body !== undefined) headers.set("content-type", "application/json");
  if (!headers.has("origin") && init.method === "POST") headers.set("origin", new URL(base.url).origin);
  return new Request(new URL(path, base.url), { method: init.method ?? "GET", headers, ...(init.body !== undefined ? { body: init.body } : {}) });
}

async function json(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

type SessionRow = { session?: { token?: unknown; userId?: unknown; expiresAt?: unknown }; user?: { id?: unknown; name?: unknown; email?: unknown; image?: unknown } };

function accountOf(row: SessionRow, active: boolean): JarAccount | null {
  const token = row.session?.token;
  const userId = row.user?.id ?? row.session?.userId;
  if (typeof token !== "string" || typeof userId !== "string" || !USER_ID.test(userId)) return null;
  const expires = typeof row.session?.expiresAt === "string" || typeof row.session?.expiresAt === "number" ? new Date(row.session.expiresAt as string).getTime() : Date.now() + FOURTEEN_DAYS * 1000;
  return {
    userId,
    name: typeof row.user?.name === "string" ? row.user.name : "",
    email: typeof row.user?.email === "string" ? row.user.email : "",
    image: typeof row.user?.image === "string" && row.user.image ? row.user.image : null,
    token,
    expiresAt: Number.isFinite(expires) ? expires : Date.now() + FOURTEEN_DAYS * 1000,
    active,
  };
}

/**
 * Every account this browser holds a live session for: the multi-session cookies, and the active session (a
 * session made before the plugin was on has no multi cookie of its own). One get-session per cookie, side by
 * side (the plugin's list-device-sessions takes seconds on Convex's adapter).
 */
export async function jarAccounts(request: Request, forward: Forward, jar: CookieJar = readJar(request.headers.get("cookie"))): Promise<JarAccount[]> {
  if (!jar.session && !jar.multi.length) return [];
  const sessionName = jar.session?.name ?? sessionCookieName(false);
  const ask = (value: string) =>
    forward(authRequest(request, "/api/auth/get-session?disableCookieCache=true", { cookie: withSessionValue(jar, value, sessionName) }))
      .then(json)
      .catch(() => null);
  const activeValue = jar.session?.value ?? null;
  const others = jar.multi.filter((m) => m.value !== activeValue);
  const [current, ...listed] = await Promise.all([activeValue ? ask(activeValue) : Promise.resolve(null), ...others.map((m) => ask(m.value))]);
  const out: JarAccount[] = [];
  const active = current && typeof current === "object" ? accountOf(current as SessionRow, true) : null;
  if (active) out.push(active);
  for (const row of listed) {
    const a = row && typeof row === "object" ? accountOf(row as SessionRow, false) : null;
    if (a && !out.some((x) => x.userId === a.userId)) out.push(a);
  }
  return out;
}

/** The map cookie for these accounts, and a multi cookie for an active session that has none. */
async function rememberJar(jar: CookieJar, accounts: JarAccount[], secure: boolean): Promise<string[]> {
  const map: Record<string, string> = {};
  for (const a of accounts) map[a.userId] = await tokenHash(a.token);
  const out = [placesSetCookie(map, { secure, maxAge: accounts.length ? FOURTEEN_DAYS : 0 })];
  // A kept session that has ended (replaced by turning on two-step verification, a new password): its cookie goes.
  const live = new Set(accounts.map((a) => a.token.toLowerCase()));
  for (const m of jar.multi) if (!live.has(m.token)) out.push(expireCookie(m.name, secure));
  const active = accounts.find((a) => a.active);
  if (active && jar.session && !jar.multi.some((m) => m.token === active.token.toLowerCase())) {
    const adopt = multiSetCookie(jar.session.name, jar.session.value, { secure, maxAge: Math.max(60, (active.expiresAt - Date.now()) / 1000) });
    if (adopt) out.push(adopt);
  }
  return out;
}

/** The cookie value that signs a request in as `account` (its multi cookie, or the active session's). */
function valueFor(jar: CookieJar, account: Pick<JarAccount, "token">): string | null {
  const lower = account.token.toLowerCase();
  const multi = jar.multi.find((m) => m.token === lower);
  if (multi) return multi.value;
  return jar.session && decodeURIComponent(jar.session.value).startsWith(`${account.token}.`) ? jar.session.value : null;
}

/**
 * The request as the pinned account's (or as it came, when nothing is pinned), and the cookies to set on the
 * answer (the map, when it had to be looked up). A pinned account this browser doesn't hold runs signed out.
 */
export async function pinRequest(request: Request, forward: Forward, secure: boolean, o: { fresh?: boolean } = {}): Promise<{ request: Request; setCookies: string[]; pinned: string | null; fromMap?: boolean }> {
  const raw = request.headers.get(PIN_HEADER);
  const headers = new Headers(request.headers);
  headers.delete(PIN_HEADER);
  const rebuild = async (cookie: string | null) => {
    if (cookie === null) headers.delete("cookie");
    else headers.set("cookie", cookie);
    const init: RequestInit = { method: request.method, headers };
    if (request.method !== "GET" && request.method !== "HEAD") init.body = await request.arrayBuffer();
    return new Request(request.url, init);
  };
  if (!raw || !USER_ID.test(raw)) return { request: raw ? await rebuild(request.headers.get("cookie")) : request, setCookies: [], pinned: null };
  const jar = readJar(request.headers.get("cookie"));
  const name = jar.session?.name ?? sessionCookieName(secure);
  const known = o.fresh ? null : await multiFor(jar, raw);
  if (known) return { request: await rebuild(withSessionValue(jar, known.value, name)), setCookies: [], pinned: raw, fromMap: true };
  const accounts = await jarAccounts(request, forward, jar);
  const setCookies = await rememberJar(jar, accounts, secure);
  const mine = accounts.find((a) => a.userId === raw);
  const value = mine ? valueFor(jar, mine) : null;
  const cookie = withSessionValue(jar, value, name);
  return { request: await rebuild(cookie || null), setCookies, pinned: raw };
}

/**
 * A pinned get-session answer that names someone else is answered as "no session": the one thing a pin must
 * never do is show one account's tab another account's session.
 */
export async function checkPinnedSession(response: Response, pinned: string | null, pathname: string): Promise<Response> {
  if (!pinned || !pathname.endsWith("/get-session") || !response.ok) return response;
  const body = (await json(response.clone())) as SessionRow | null;
  const id = body?.user?.id;
  if (body === null || id === undefined || id === pinned) return response;
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.delete("set-cookie");
  return new Response("null", { status: 200, headers });
}

/**
 * Whether an answer says the pinned account has no session: then a request sent with the map's cookie is sent
 * again with the accounts looked up afresh (the map can name a session that was just replaced).
 */
export async function answeredSignedOut(response: Response, pathname: string): Promise<boolean> {
  if (response.status === 401) return true;
  if (!pathname.endsWith("/get-session") || !response.ok) return false;
  return (await json(response.clone())) === null;
}

export interface PlaceListEntry {
  userId: string;
  name: string;
  email: string;
  image: string | null;
  active: boolean;
}

/** GET /api/places: the accounts this browser is signed in to (no tokens), and the map refreshed. */
export async function listPlaces(request: Request, forward: Forward, secure: boolean): Promise<Response> {
  const jar = readJar(request.headers.get("cookie"));
  const accounts = await jarAccounts(request, forward, jar);
  const setCookies = await rememberJar(jar, accounts, secure);
  const body = { accounts: accounts.map(({ userId, name, email, image, active }) => ({ userId, name, email, image, active }) satisfies PlaceListEntry) };
  const headers = new Headers({ "content-type": "application/json", "cache-control": "no-store" });
  for (const c of setCookies) headers.append("set-cookie", c);
  return new Response(JSON.stringify(body), { status: 200, headers });
}

/**
 * POST /api/places/sign-out: ends one account's session in this browser (the plugin's revoke, server to server)
 * and leaves every other account signed in. Better Auth's own /sign-out would end all of them.
 */
export async function signOutPlace(request: Request, forward: Forward, secure: boolean): Promise<Response> {
  let userId: unknown;
  try {
    userId = ((await request.json()) as { userId?: unknown }).userId;
  } catch {
    userId = undefined;
  }
  const headers = new Headers({ "content-type": "application/json", "cache-control": "no-store" });
  // Only Folevi's own pages sign anyone out (SameSite cookies already keep other sites' posts away from the jar).
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers });
  if (typeof userId !== "string" || !USER_ID.test(userId)) return new Response(JSON.stringify({ error: "invalid_argument" }), { status: 400, headers });
  const jar = readJar(request.headers.get("cookie"));
  const accounts = await jarAccounts(request, forward, jar);
  const target = accounts.find((a) => a.userId === userId);
  const rest = accounts.filter((a) => a.userId !== userId);
  const sessionName = jar.session?.name ?? sessionCookieName(secure);
  const setCookies: string[] = [];
  let revoked = false;
  if (target) {
    const value = valueFor(jar, target);
    if (value) {
      // Revoking needs a live session to ask with. The browser's active one, when it's alive, so Better Auth
      // leaves the active cookie alone unless it's the one going; else the target's own.
      const asActive = jar.session !== null && accounts.some((a) => a.active);
      const cookie = asActive ? (request.headers.get("cookie") ?? "") : withSessionValue(jar, value, sessionName);
      const res = await forward(authRequest(request, "/api/auth/multi-session/revoke", { method: "POST", cookie, body: JSON.stringify({ sessionToken: target.token }) }));
      revoked = res.ok;
      if (revoked) for (const c of res.headers.getSetCookie()) setCookies.push(c);
    }
  }
  if (!revoked) {
    // Already gone (ended elsewhere, expired): forget its cookies here all the same.
    for (const m of jar.multi) if (target && m.token === target.token.toLowerCase()) setCookies.push(expireCookie(m.name, secure));
  }
  // The browser's active session is whichever account is left (or none): the website's own pages use it.
  const activeLeft = rest.find((a) => a.active) ?? rest[0] ?? null;
  const activeGone = (target?.active === true && !revoked) || (jar.session !== null && !accounts.some((a) => a.active));
  if (activeGone && !setCookies.some((c) => c.startsWith(`${sessionName}=`))) {
    const next = activeLeft ? valueFor(jar, activeLeft) : null;
    setCookies.push(next ? `${sessionName}=${next}; Path=/; Max-Age=${FOURTEEN_DAYS}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}` : expireCookie(sessionName, secure));
  }
  const map: Record<string, string> = {};
  for (const a of rest) map[a.userId] = await tokenHash(a.token);
  setCookies.push(placesSetCookie(map, { secure, maxAge: rest.length ? FOURTEEN_DAYS : 0 }));
  for (const c of setCookies) headers.append("set-cookie", c);
  return new Response(JSON.stringify({ ok: true, left: rest.map((a) => a.userId) }), { status: 200, headers });
}
