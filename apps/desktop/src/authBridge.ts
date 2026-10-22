// Signed-in mode for the built-in interface (docs/LOCAL_MODE_PLAN.md §1 and §4.2, WP4): `foleviShell.auth`.
//
// The page lives on app://folevi, where a cookie session for the website can't work. So the Mac app signs in
// the way native apps do (Authorization Code with PKCE, convex/lib/nativeAuth.ts, client "folevi-shell"):
//   1. signIn() opens the website's /connect page in the default browser; the person signs in there as usual
//      and presses Continue;
//   2. the browser hands back folevi://auth/callback?code=…&state=… (main.ts openLink → handleCallback);
//   3. the app trades the code and its PKCE verifier for a session of its own at /api/auth/native/token, and
//      keeps that bearer token in secrets.ts (safeStorage). It never reaches the page.
// Afterwards the page's Better Auth client sends every request through fetch() here: only the website's
// /api/auth/*, with `Authorization: Bearer`, no cookies (Better Auth's origin check bites requests that carry
// cookies), `Origin` set to the website all the same (docs/LOCAL_MODE.md S4: a shipped app must not depend on
// how strict that check is), a rotated `set-auth-token` kept, and the token scrubbed from anything handed back. convexToken() gets the page its short-lived Convex JWT.
//
// Everything Electron-specific (net.fetch, shell.openExternal, safeStorage) is passed in, so this loads in
// plain Node: the unit tests (authBridge.test.ts) and the web app's e2e FakeShell run this same code.
import { createHash, randomBytes } from "node:crypto";
import { accountSessionName, type SecretName, type SecretStore } from "./secrets";

export const SHELL_CLIENT_ID = "folevi-shell";
export const SHELL_REDIRECT_URI = "folevi://auth/callback";
const TOKEN: "auth.session" = "auth.session";
const SIGN_IN_TIMEOUT_MS = 10 * 60_000;

/** The page's request: plain values (it came over IPC). */
export type BridgeResponse = { status: number; headers: Record<string, string>; body: string };

export interface AuthBridgeDeps {
  /** The website (SERVICE_URL), where /connect and /api/auth live. */
  serviceUrl: URL;
  /** net.fetch in the app; Node's fetch in tests. */
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  /** Opens a URL in the default browser. */
  openExternal: (url: string) => Promise<void>;
  store: Pick<SecretStore, "get" | "set" | "delete">;
  /** This Mac's name, for Settings → Devices ("Folevi app (Studio Mac)"). */
  deviceName: () => string;
  random?: (bytes: number) => Uint8Array;
  signInTimeoutMs?: number;
}

/** Who a session belongs to, as Better Auth says (after signing in; never the token). */
export interface SessionUser {
  userId: string;
  name: string;
  email: string;
  avatarUrl: string | null;
}

/**
 * The calls below take an optional `slot`: the account's user id (several places, docs/MULTI_ACCOUNT_PLAN.md
 * §2.2; its token is `auth.session.<user id>`). Without one they use the single session older builds kept.
 */
export interface AuthBridge {
  signIn(): Promise<boolean>;
  /** Signs in to one more account: its user, or null when it didn't finish. The same person again replaces their old session. */
  signInAccount(): Promise<SessionUser | null>;
  /** The single session an older build kept, moved to its account's slot: that account, or null (none, or ended). */
  adoptLegacy(): Promise<SessionUser | null>;
  signOut(slot?: string): Promise<void>;
  fetch(path: unknown, init: unknown, slot?: string): Promise<BridgeResponse>;
  convexToken(slot?: string): Promise<string | null>;
  /** A folevi://auth/callback link from the browser: true when it was one (whether or not it was expected). */
  handleCallback(url: string): boolean;
  /** Whether a session token is stored (for main's logs and tests; never sent to the page). */
  signedIn(slot?: string): boolean;
}

/** Whether a link is the end of a sign-in in the browser: folevi://auth/callback?… */
export function isAuthCallback(raw: string): boolean {
  if (typeof raw !== "string" || raw.length > 2000) return false;
  try {
    const url = new URL(raw);
    return url.protocol === "folevi:" && url.hostname === "auth" && url.pathname === "/callback";
  } catch {
    return false;
  }
}

const b64url = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");

/** RFC 7636: a 43-character verifier from 32 random bytes, and its S256 challenge. */
export function pkcePair(random: (n: number) => Uint8Array = randomBytes): { verifier: string; challenge: string } {
  const verifier = b64url(random(32));
  return { verifier, challenge: b64url(createHash("sha256").update(verifier).digest()) };
}

const METHODS = new Set(["GET", "POST"]);
/** Request headers the page may set; everything else (Authorization, Cookie, Origin, Host…) is the app's. */
const PAGE_HEADERS = new Set(["accept", "accept-language", "content-type", "cache-control", "pragma"]);
/** Response headers the page never sees. */
const HIDDEN_HEADERS = new Set(["set-cookie", "set-cookie2", "set-auth-token"]);
const MAX_BODY = 1_000_000;
const MAX_PATH = 4096;
const TOKEN_RE = /^[A-Za-z0-9._~+/=-]{16,1024}$/;

/**
 * The page's path as a URL on the website's /api/auth, or null. Plain paths only: no other host, no
 * traversal (the URL parser resolves dot segments, encoded or not, so the prefix check sees the real path),
 * no encoded slashes or backslashes, no control characters.
 */
export function authUrl(service: URL, path: unknown): URL | null {
  if (typeof path !== "string" || path.length > MAX_PATH || !path.startsWith("/api/auth/")) return null;
  if (/[\u0000-\u001f\u007f\\]/.test(path) || /%(2f|5c|00)/i.test(path)) return null;
  let url: URL;
  try {
    url = new URL(path, service.origin);
  } catch {
    return null;
  }
  if (url.origin !== service.origin || !url.pathname.startsWith("/api/auth/") || url.username || url.password) return null;
  url.hash = "";
  return url;
}

/** The request the page asked for, cleaned: an allowed method, its own harmless headers, a text body. */
export function cleanInit(init: unknown): { method: string; headers: Record<string, string>; body?: string } | null {
  const i = (init && typeof init === "object" ? init : {}) as Record<string, unknown>;
  const method = typeof i.method === "string" ? i.method.toUpperCase() : "GET";
  if (!METHODS.has(method)) return null;
  const headers: Record<string, string> = {};
  if (i.headers && typeof i.headers === "object" && !Array.isArray(i.headers)) {
    for (const [k, v] of Object.entries(i.headers as Record<string, unknown>)) {
      const key = k.toLowerCase();
      if (PAGE_HEADERS.has(key) && typeof v === "string" && v.length <= 1000 && !/[\r\n]/.test(v)) headers[key] = v;
    }
  }
  let body: string | undefined;
  if (i.body != null) {
    if (typeof i.body !== "string" || i.body.length > MAX_BODY || method === "GET") return null;
    body = i.body;
  }
  return body === undefined ? { method, headers } : { method, headers, body };
}

/** Removes every form of the session token (signed "raw.signature" and raw) from text bound for the page. */
export function scrub(text: string, tokens: (string | null | undefined)[]): string {
  const forms = new Set<string>();
  for (const token of tokens) {
    if (!token) continue;
    for (const form of [token, encodeURIComponent(token), token.split(".")[0] ?? ""]) if (form.length >= 16) forms.add(form);
  }
  // Longest first, so a signed token goes whole rather than leaving its signature behind.
  let out = text;
  for (const form of [...forms].sort((a, b) => b.length - a.length)) out = out.split(form).join("");
  return out;
}

export function createAuthBridge(deps: AuthBridgeDeps): AuthBridge {
  const service = new URL(deps.serviceUrl.origin);
  const random = deps.random ?? ((n: number) => randomBytes(n));
  let pending: { state: string; resolve: (url: string | null) => void } | null = null;
  /** Ends the sign-in on its way, if any: it answers false. */
  const cancelPending = () => {
    const p = pending;
    pending = null;
    p?.resolve(null);
  };

  const nameOf = (slot?: string | null): SecretName => (slot ? accountSessionName(slot) : TOKEN);
  const token = (slot?: string) => deps.store.get(nameOf(slot));

  /** A request to the website with the bearer, as native code sends it. A rotated token goes back to `slot`. */
  const send = async (url: URL, init: { method: string; headers?: Record<string, string>; body?: string }, bearer = token(), slot?: string | null) => {
    const headers: Record<string, string> = { ...(init.headers ?? {}), origin: service.origin };
    if (bearer) headers.authorization = `Bearer ${bearer}`;
    const res = await deps.fetch(url.toString(), { method: init.method, headers, body: init.body, credentials: "omit", redirect: "manual", cache: "no-store" });
    // A refreshed session comes back as a new token (Better Auth's bearer plugin): keep it.
    const rotated = res.headers.get("set-auth-token");
    // (`slot` null: a token being checked, kept nowhere yet.)
    if (bearer && rotated && rotated !== bearer && TOKEN_RE.test(rotated) && slot !== null) deps.store.set(nameOf(slot), rotated);
    return { res, rotated };
  };

  /** Who a token's session belongs to (null: no live session, or no answer). */
  const userOf = async (bearer: string): Promise<SessionUser | null> => {
    try {
      const { res } = await send(new URL("/api/auth/get-session", service), { method: "GET" }, bearer, null);
      if (!res.ok) return null;
      const body = (await res.json()) as { user?: { id?: unknown; name?: unknown; email?: unknown; image?: unknown } } | null;
      const u = body?.user;
      if (!u || typeof u.id !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(u.id)) return null;
      return { userId: u.id, name: typeof u.name === "string" ? u.name.slice(0, 120) : "", email: typeof u.email === "string" ? u.email.slice(0, 254) : "", avatarUrl: typeof u.image === "string" && /^https:\/\//.test(u.image) ? u.image.slice(0, 2000) : null };
    } catch {
      return null;
    }
  };

  const endSession = async (bearer: string) => {
    try {
      await send(new URL("/api/auth/sign-out", service), { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }, bearer);
    } catch {
      // Offline: the session expires on its own, and Settings → Devices can end it from anywhere.
    }
  };

  return {
    signedIn: (slot) => token(slot) !== null,

    handleCallback(url) {
      if (!isAuthCallback(url)) return false;
      let state = "";
      try {
        state = new URL(url).searchParams.get("state") ?? "";
      } catch {
        state = "";
      }
      // Only the sign-in this app started (its state): a link someone else crafted signs nobody in.
      if (pending && state && state === pending.state) {
        const p = pending;
        pending = null;
        p.resolve(url);
      }
      return true;
    },

    async signIn() {
      const access = await obtain();
      if (!access) return false;
      const previous = token();
      deps.store.set(TOKEN, access);
      // Signing in again (another account, or after a stale session) ends the session this Mac held before.
      if (previous && previous !== access) await endSession(previous);
      return true;
    },

    async signInAccount() {
      const access = await obtain();
      if (!access) return null;
      const user = await userOf(access);
      if (!user) {
        await endSession(access);
        return null;
      }
      const previous = token(user.userId);
      deps.store.set(nameOf(user.userId), access);
      // The same person signing in again: their old session here ends. Other accounts keep theirs.
      if (previous && previous !== access) await endSession(previous);
      return user;
    },

    async adoptLegacy() {
      const legacy = token();
      if (!legacy) return null;
      const user = await userOf(legacy);
      if (!user) {
        // Ended (or the server can't say right now: then it's tried again next launch).
        return null;
      }
      if (!token(user.userId)) deps.store.set(nameOf(user.userId), legacy);
      deps.store.delete(TOKEN);
      return user;
    },

    async signOut(slot) {
      cancelPending();
      const bearer = token(slot);
      if (bearer) await endSession(bearer);
      deps.store.delete(nameOf(slot));
    },

    async fetch(path, init, slot) {
      const url = authUrl(service, path);
      const clean = cleanInit(init);
      if (!url || !clean) throw new Error("Folevi only sends the website's /api/auth requests from here.");
      const bearer = token(slot);
      const { res, rotated } = await send(url, clean, bearer, slot);
      const headers: Record<string, string> = {};
      res.headers.forEach((value, key) => {
        if (!HIDDEN_HEADERS.has(key.toLowerCase())) headers[key.toLowerCase()] = value;
      });
      const body = scrub(await res.text(), [bearer, rotated, token(slot)]);
      return { status: res.status, headers, body };
    },

    async convexToken(slot) {
      const bearer = token(slot);
      if (!bearer) return null;
      const { res } = await send(new URL("/api/auth/convex/token", service), { method: "GET" }, bearer, slot);
      if (res.status === 401) {
        // The session ended (signed out from Settings → Devices, expired): forget it.
        deps.store.delete(nameOf(slot));
        return null;
      }
      if (res.status === 403) return null;
      if (!res.ok) throw new Error(`Folevi couldn't get a sync token (${res.status}).`);
      const jwt = ((await res.json()) as { token?: unknown }).token;
      return typeof jwt === "string" && jwt ? jwt : null;
    },
  };

  /** The PKCE sign-in in the browser, ending with a new session's token (or null). */
  async function obtain(): Promise<string | null> {
    {
      // A new attempt replaces the one before it.
      cancelPending();
      const { verifier, challenge } = pkcePair(random);
      const state = b64url(random(24));
      const connect = new URL("/connect", service);
      connect.search = new URLSearchParams({ client_id: SHELL_CLIENT_ID, redirect_uri: SHELL_REDIRECT_URI, code_challenge: challenge, code_challenge_method: "S256", state }).toString();

      let timer: ReturnType<typeof setTimeout> | undefined;
      const answer = new Promise<string | null>((resolve) => {
        const entry = { state, resolve: (u: string | null) => resolve(u) };
        pending = entry;
        timer = setTimeout(() => {
          if (pending === entry) pending = null;
          resolve(null);
        }, deps.signInTimeoutMs ?? SIGN_IN_TIMEOUT_MS);
      });
      try {
        await deps.openExternal(connect.toString());
      } catch {
        cancelPending();
      }
      const callback = await answer;
      clearTimeout(timer);
      if (!callback) return null;
      const params = new URL(callback).searchParams;
      const code = params.get("code");
      if (params.get("error") || !code || code.length > 128) return null;

      let access: unknown;
      try {
        const res = await deps.fetch(new URL("/api/auth/native/token", service).toString(), {
          method: "POST",
          headers: { "content-type": "application/json", origin: service.origin },
          body: JSON.stringify({ grant_type: "authorization_code", code, code_verifier: verifier, client_id: SHELL_CLIENT_ID, redirect_uri: SHELL_REDIRECT_URI, device_name: deps.deviceName().slice(0, 60) }),
          credentials: "omit",
          redirect: "manual",
          cache: "no-store",
        });
        if (res.status !== 200) return null;
        access = ((await res.json()) as { access_token?: unknown }).access_token;
      } catch {
        return null;
      }
      if (typeof access !== "string" || !TOKEN_RE.test(access)) return null;
      return access;
    }
  }
}

/** The four calls preload.ts makes, answered only for the built-in interface's own pages. */
export const AUTH_CHANNELS = {
  signIn: "shell:auth-sign-in",
  signOut: "shell:auth-sign-out",
  fetch: "shell:auth-fetch",
  convexToken: "shell:auth-convex-token",
} as const;

type Handle = (channel: string, listener: (event: unknown, ...args: unknown[]) => unknown) => void;

/**
 * Registers the IPC handlers (ipcMain.handle). `allowed` checks the call came from the app's own page. With several
 * places, `slot` names the account the calling page is bound to (its user id; undefined: the single session of
 * older builds), and `signIn` replaces the plain sign-in (main adds the account to the places).
 */
export function registerAuthIpc(
  handle: Handle,
  bridge: () => AuthBridge | null,
  allowed: (event: unknown) => boolean,
  o: { slot?: (event: unknown) => string | undefined; signIn?: (event: unknown, b: AuthBridge) => Promise<boolean>; signOut?: (event: unknown, b: AuthBridge) => Promise<void> } = {},
) {
  const guard =
    <T>(fn: (b: AuthBridge, event: unknown, ...args: unknown[]) => Promise<T>, refused: T) =>
    async (event: unknown, ...args: unknown[]) => {
      const b = bridge();
      if (!b || !allowed(event)) return refused;
      return fn(b, event, ...args);
    };
  const slot = (event: unknown) => o.slot?.(event);
  handle(AUTH_CHANNELS.signIn, guard((b, e) => (o.signIn ? o.signIn(e, b) : b.signIn()), false));
  handle(AUTH_CHANNELS.signOut, guard((b, e) => (o.signOut ? o.signOut(e, b) : b.signOut(slot(e))), undefined));
  handle(
    AUTH_CHANNELS.fetch,
    guard((b, e, path, init) => b.fetch(path, init, slot(e)), null),
  );
  handle(AUTH_CHANNELS.convexToken, guard((b, e) => b.convexToken(slot(e)), null));
}
