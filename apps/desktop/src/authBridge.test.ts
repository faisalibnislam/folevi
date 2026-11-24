import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { AUTH_CHANNELS, authUrl, cleanInit, createAuthBridge, isAuthCallback, pkcePair, registerAuthIpc, scrub, SHELL_CLIENT_ID, SHELL_REDIRECT_URI, type AuthBridgeDeps } from "./authBridge";
import { createSecretStore, type Cipher } from "./secrets";

const SERVICE = new URL("https://app.folevi.com");
const TOKEN = "Sessiontoken0123456789abcdefABCD";
const JWT = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ4In0.sig";

type Sent = { url: string; init: RequestInit & { headers: Record<string, string> } };

function memoryStore(initial: string | null = null) {
  const map = new Map<string, string>();
  if (initial) map.set("auth.session", initial);
  return {
    map,
    get: (n: string) => map.get(n) ?? null,
    set: (n: string, v: string) => void map.set(n, v),
    delete: (n: string) => void map.delete(n),
  };
}

function harness(opts: { token?: string | null; respond?: (url: URL, init: RequestInit) => Response | Promise<Response>; timeoutMs?: number } = {}) {
  const sent: Sent[] = [];
  const opened: string[] = [];
  const store = memoryStore(opts.token === undefined ? TOKEN : opts.token);
  const respond = opts.respond ?? (() => new Response("{}", { status: 200, headers: { "content-type": "application/json" } }));
  const deps: AuthBridgeDeps = {
    serviceUrl: SERVICE,
    fetch: vi.fn(async (url: string, init: RequestInit) => {
      sent.push({ url, init: init as Sent["init"] });
      return respond(new URL(url), init);
    }),
    openExternal: vi.fn(async (url: string) => {
      opened.push(url);
    }),
    store,
    deviceName: () => "Studio Mac",
    signInTimeoutMs: opts.timeoutMs,
  };
  return { bridge: createAuthBridge(deps), deps, sent, opened, store };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("the path allowlist", () => {
  test("only the website's /api/auth/*", () => {
    expect(authUrl(SERVICE, "/api/auth/get-session")?.toString()).toBe("https://app.folevi.com/api/auth/get-session");
    expect(authUrl(SERVICE, "/api/auth/get-session?disableCookieCache=true")?.search).toBe("?disableCookieCache=true");
    for (const bad of [
      "/api/authx",
      "/api/auth",
      "/api/files/x",
      "/api/auth/../admin",
      "/api/auth/..%2fadmin",
      "/api/auth/%2e%2e/%2e%2e/admin",
      "/api/auth/%2E%2E/x",
      "/api/auth/a%5cb",
      "/api/auth/\\..\\x",
      "/api/auth/a%00",
      "/api/auth/\nx",
      "//evil.example/api/auth/get-session",
      "https://evil.example/api/auth/get-session",
      "https://app.folevi.com/api/auth/get-session",
      "api/auth/get-session",
      `/api/auth/${"a".repeat(5000)}`,
      42,
      null,
      undefined,
      { toString: () => "/api/auth/get-session" },
    ]) {
      expect(authUrl(SERVICE, bad), String(bad).slice(0, 60)).toBeNull();
    }
  });

  test("a refused path or method never leaves the app", async () => {
    const { bridge, sent } = harness();
    await expect(bridge.fetch("/api/admin/users", { method: "GET" })).rejects.toThrow(/only sends/);
    await expect(bridge.fetch("https://evil.example/api/auth/get-session", {})).rejects.toThrow();
    await expect(bridge.fetch("/api/auth/get-session", { method: "PUT" })).rejects.toThrow();
    await expect(bridge.fetch("/api/auth/get-session", { method: "GET", body: "x" })).rejects.toThrow();
    await expect(bridge.fetch("/api/auth/sign-out", { method: "POST", body: new Uint8Array(4) })).rejects.toThrow();
    expect(sent).toEqual([]);
  });

  test("cleanInit keeps a method, harmless headers and a text body", () => {
    expect(cleanInit(undefined)).toEqual({ method: "GET", headers: {} });
    expect(cleanInit({ method: "post", headers: { "Content-Type": "application/json", Cookie: "a=b" }, body: "{}" })).toEqual({ method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(cleanInit({ method: "DELETE" })).toBeNull();
    expect(cleanInit({ headers: { accept: "a\r\nx-evil: 1" } })).toEqual({ method: "GET", headers: {} });
  });
});

describe("requests the page makes", () => {
  test("carry the bearer and the website's origin, and nothing the page tried to add", async () => {
    const { bridge, sent } = harness();
    await bridge.fetch("/api/auth/two-factor/verify-totp", {
      method: "POST",
      headers: { authorization: "Bearer someone-elses", cookie: "folevi.session=x", origin: "app://folevi", host: "evil.example", "x-forwarded-for": "1.2.3.4", "content-type": "application/json" },
      body: '{"code":"123456"}',
    });
    expect(sent).toHaveLength(1);
    const { url, init } = sent[0]!;
    expect(url).toBe("https://app.folevi.com/api/auth/two-factor/verify-totp");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ authorization: `Bearer ${TOKEN}`, origin: "https://app.folevi.com", "content-type": "application/json" });
    expect(init.credentials).toBe("omit");
    expect(init.redirect).toBe("manual");
    expect(init.body).toBe('{"code":"123456"}');
  });

  test("signed out: no Authorization at all", async () => {
    const { bridge, sent } = harness({ token: null });
    await bridge.fetch("/api/auth/get-session", { method: "GET" });
    expect(sent[0]!.init.headers.authorization).toBeUndefined();
    expect(sent[0]!.init.headers.origin).toBe("https://app.folevi.com");
  });
});

describe("the token never reaches the page", () => {
  test("it's scrubbed from bodies, and the headers that carry it are dropped", async () => {
    const rotated = "Rotatedtoken0123456789abcdefWXYZ";
    const { bridge, store } = harness({
      respond: () =>
        json(
          { session: { id: "s1", token: TOKEN, userId: "u1" }, user: { email: "a@example.com" }, echo: `${TOKEN}.signature`, next: rotated },
          200,
          { "set-auth-token": rotated, "set-cookie": `folevi.session_token=${TOKEN}; HttpOnly`, "x-request-id": "r1" },
        ),
    });
    const res = await bridge.fetch("/api/auth/get-session", { method: "GET" });
    expect(res.status).toBe(200);
    expect(res.body).not.toContain(TOKEN);
    expect(res.body).not.toContain(rotated);
    expect(JSON.parse(res.body).user.email).toBe("a@example.com");
    expect(JSON.parse(res.body).session.token).toBe("");
    expect(Object.keys(res.headers)).not.toContain("set-auth-token");
    expect(Object.keys(res.headers)).not.toContain("set-cookie");
    expect(res.headers["x-request-id"]).toBe("r1");
    expect(JSON.stringify(res)).not.toContain(TOKEN);
    // The rotated token is kept for the next request.
    expect(store.get("auth.session")).toBe(rotated);
  });

  test("scrub removes the signed form, the raw form and the URL-encoded form", () => {
    const signed = `${TOKEN}.c2lnbmF0dXJlK3NpZw==`;
    const text = `a ${signed} b ${TOKEN} c ${encodeURIComponent(signed)} d`;
    const out = scrub(text, [signed]);
    expect(out).not.toContain(TOKEN);
    expect(out).toBe("a  b  c  d");
    expect(scrub("short abc", ["abc"])).toBe("short abc");
  });

  test("a rotated value that isn't a token is ignored", async () => {
    const { bridge, store } = harness({ respond: () => json({}, 200, { "set-auth-token": "x y" }) });
    await bridge.fetch("/api/auth/get-session", {});
    expect(store.get("auth.session")).toBe(TOKEN);
  });
});

describe("signing in", () => {
  test("PKCE in the browser, the code exchanged for a session the app keeps", async () => {
    const issued = "Newsessiontoken0123456789abcdefgh";
    const { bridge, opened, sent, store } = harness({
      token: null,
      respond: (url) => (url.pathname === "/api/auth/native/token" ? json({ access_token: issued, token_type: "Bearer" }) : json({})),
    });
    const done = bridge.signIn();
    await tick();
    expect(opened).toHaveLength(1);
    const connect = new URL(opened[0]!);
    expect(connect.origin + connect.pathname).toBe("https://app.folevi.com/connect");
    const q = connect.searchParams;
    expect(q.get("client_id")).toBe(SHELL_CLIENT_ID);
    expect(q.get("redirect_uri")).toBe(SHELL_REDIRECT_URI);
    expect(q.get("code_challenge_method")).toBe("S256");
    expect(q.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const state = q.get("state")!;
    expect(state.length).toBeGreaterThanOrEqual(32);

    // A link with someone else's state is swallowed and changes nothing.
    expect(bridge.handleCallback(`folevi://auth/callback?code=forged&state=other`)).toBe(true);
    await tick();
    expect(sent).toHaveLength(0);

    expect(bridge.handleCallback(`folevi://auth/callback?code=thecode&state=${encodeURIComponent(state)}`)).toBe(true);
    expect(await done).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe("https://app.folevi.com/api/auth/native/token");
    const body = JSON.parse(String(sent[0]!.init.body)) as Record<string, string>;
    expect(body).toMatchObject({ grant_type: "authorization_code", code: "thecode", client_id: SHELL_CLIENT_ID, redirect_uri: SHELL_REDIRECT_URI, device_name: "Studio Mac" });
    // The verifier is the one behind the challenge the browser saw.
    expect(createHash("sha256").update(body.code_verifier!).digest("base64url")).toBe(q.get("code_challenge"));
    expect(sent[0]!.init.credentials).toBe("omit");
    expect(store.get("auth.session")).toBe(issued);
    expect(bridge.signedIn()).toBe(true);
  });

  test("a refusal, a failed exchange or a timeout signs nobody in", async () => {
    const refused = harness({ token: null });
    const a = refused.bridge.signIn();
    await tick();
    const state = new URL(refused.opened[0]!).searchParams.get("state")!;
    refused.bridge.handleCallback(`folevi://auth/callback?error=access_denied&state=${state}`);
    expect(await a).toBe(false);
    expect(refused.sent).toHaveLength(0);
    expect(refused.store.get("auth.session")).toBeNull();

    const failing = harness({ token: null, respond: () => json({ error: "invalid_grant" }, 400) });
    const b = failing.bridge.signIn();
    await tick();
    failing.bridge.handleCallback(`folevi://auth/callback?code=c&state=${new URL(failing.opened[0]!).searchParams.get("state")}`);
    expect(await b).toBe(false);
    expect(failing.store.get("auth.session")).toBeNull();

    const slow = harness({ token: null, timeoutMs: 20 });
    expect(await slow.bridge.signIn()).toBe(false);
  });

  test("a second attempt replaces the first", async () => {
    const { bridge, opened } = harness({ token: null, respond: () => json({ access_token: "Anothertoken0123456789abcdefghij" }) });
    const first = bridge.signIn();
    await tick();
    const second = bridge.signIn();
    expect(await first).toBe(false);
    await tick();
    const oldState = new URL(opened[0]!).searchParams.get("state");
    bridge.handleCallback(`folevi://auth/callback?code=c&state=${oldState}`);
    await tick();
    bridge.handleCallback(`folevi://auth/callback?code=c&state=${new URL(opened[1]!).searchParams.get("state")}`);
    expect(await second).toBe(true);
  });

  test("signing in again ends the session held before", async () => {
    const fresh = "Freshsessiontoken0123456789abcdef";
    const { bridge, opened, sent, store } = harness({ respond: (url) => (url.pathname === "/api/auth/native/token" ? json({ access_token: fresh }) : json({ success: true })) });
    const done = bridge.signIn();
    await tick();
    bridge.handleCallback(`folevi://auth/callback?code=c&state=${new URL(opened[0]!).searchParams.get("state")}`);
    expect(await done).toBe(true);
    expect(store.get("auth.session")).toBe(fresh);
    const out = sent.find((s) => s.url.endsWith("/api/auth/sign-out"))!;
    expect(out.init.headers.authorization).toBe(`Bearer ${TOKEN}`);
  });

  test("only folevi://auth/callback is a sign-in return", () => {
    expect(isAuthCallback("folevi://auth/callback?code=a&state=b")).toBe(true);
    expect(isAuthCallback("folevi://auth/google?code=a")).toBe(false);
    expect(isAuthCallback("folevi://d/01ABC")).toBe(false);
    expect(isAuthCallback("https://auth/callback")).toBe(false);
    expect(isAuthCallback(`folevi://auth/callback?x=${"a".repeat(3000)}`)).toBe(false);
  });

  test("pkcePair makes a verifier the server accepts", () => {
    const { verifier, challenge } = pkcePair();
    expect(verifier).toMatch(/^[A-Za-z0-9._~-]{43,128}$/);
    expect(challenge).toBe(createHash("sha256").update(verifier).digest("base64url"));
  });
});

describe("Convex tokens and signing out", () => {
  test("convexToken: the JWT, null when signed out, the token forgotten when the session ended", async () => {
    const ok = harness({ respond: () => json({ token: JWT }) });
    expect(await ok.bridge.convexToken()).toBe(JWT);
    expect(ok.sent[0]!.url).toBe("https://app.folevi.com/api/auth/convex/token");
    expect(ok.sent[0]!.init.headers.authorization).toBe(`Bearer ${TOKEN}`);

    const none = harness({ token: null });
    expect(await none.bridge.convexToken()).toBeNull();
    expect(none.sent).toHaveLength(0);

    const ended = harness({ respond: () => json({ code: "UNAUTHORIZED" }, 401) });
    expect(await ended.bridge.convexToken()).toBeNull();
    expect(ended.store.get("auth.session")).toBeNull();

    // A server error isn't "signed out": it rejects, and the page carries on offline.
    const down = harness({ respond: () => new Response("busy", { status: 503 }) });
    await expect(down.bridge.convexToken()).rejects.toThrow();
    expect(down.store.get("auth.session")).toBe(TOKEN);
  });

  test("signOut ends the session with the bearer and the website's origin, then forgets it, online or not", async () => {
    const { bridge, sent, store } = harness();
    await bridge.signOut();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe("https://app.folevi.com/api/auth/sign-out");
    expect(sent[0]!.init.method).toBe("POST");
    expect(sent[0]!.init.headers).toMatchObject({ authorization: `Bearer ${TOKEN}`, origin: "https://app.folevi.com" });
    expect(store.get("auth.session")).toBeNull();

    const offline = harness({ respond: () => Promise.reject(new TypeError("fetch failed")) });
    await offline.bridge.signOut();
    expect(offline.store.get("auth.session")).toBeNull();
  });
});

describe("IPC", () => {
  test("only the app's own pages get answers", async () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    const { bridge, sent } = harness({ respond: () => json({ token: JWT }) });
    registerAuthIpc((channel, fn) => handlers.set(channel, fn), () => bridge, (e) => (e as { ok?: boolean }).ok === true);
    expect([...handlers.keys()].sort()).toEqual(Object.values(AUTH_CHANNELS).sort());
    expect(await handlers.get(AUTH_CHANNELS.convexToken)!({ ok: false })).toBeNull();
    expect(await handlers.get(AUTH_CHANNELS.signIn)!({ ok: false })).toBe(false);
    expect(await handlers.get(AUTH_CHANNELS.fetch)!({ ok: false }, "/api/auth/get-session", {})).toBeNull();
    expect(sent).toHaveLength(0);
    expect(await handlers.get(AUTH_CHANNELS.convexToken)!({ ok: true })).toBe(JWT);
  });

  test("the preload calls exactly these channels and has no way to the token", () => {
    const preload = readFileSync(join(__dirname, "preload.ts"), "utf8");
    for (const channel of Object.values(AUTH_CHANNELS)) expect(preload).toContain(`"${channel}"`);
    expect(preload).not.toMatch(/safeStorage|auth\.session|secrets\.ts|authorization/i);
  });
});

describe("secrets", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const scratch = () => {
    const d = mkdtempSync(join(tmpdir(), "folevi-secrets-"));
    dirs.push(d);
    return d;
  };
  // Stands in for safeStorage: reversible, and never the plain text.
  const cipher = (available = true): Cipher => ({
    isEncryptionAvailable: () => available,
    encryptString: (s) => Buffer.from(`enc:${Buffer.from(s).toString("base64").split("").reverse().join("")}`),
    decryptString: (b) => Buffer.from(b.toString().slice(4).split("").reverse().join(""), "base64").toString(),
  });

  test("encrypted at rest, one file each, readable back only by the app", () => {
    const dir = scratch();
    const store = createSecretStore(dir, cipher());
    expect(store.get("auth.session")).toBeNull();
    store.set("auth.session", TOKEN);
    expect(store.get("auth.session")).toBe(TOKEN);
    expect(store.has("auth.session")).toBe(true);
    expect(readdirSync(dir)).toEqual(["auth.session.bin"]);
    expect(readFileSync(join(dir, "auth.session.bin"), "utf8")).not.toContain(TOKEN);
    store.delete("auth.session");
    expect(store.get("auth.session")).toBeNull();
    expect(() => store.set("../evil" as never, "x")).toThrow();
  });

  test("never written in the clear when this Mac can't encrypt", () => {
    const dir = scratch();
    const store = createSecretStore(dir, cipher(false));
    expect(() => store.set("auth.session", TOKEN)).toThrow(/can't encrypt/);
    expect(readdirSync(dir)).toEqual([]);
  });
});

describe("several accounts (docs/MULTI_ACCOUNT_PLAN.md §2.2)", () => {
  /** A server whose sessions belong to people: get-session answers who a bearer is. */
  function server(people: Record<string, { id: string; email: string }>, issue: () => string) {
    return (url: URL, init: RequestInit) => {
      if (url.pathname === "/api/auth/native/token") return json({ access_token: issue() });
      const bearer = ((init.headers as Record<string, string>).authorization ?? "").replace(/^Bearer /, "");
      if (url.pathname === "/api/auth/get-session") return people[bearer] ? json({ session: { token: bearer }, user: { ...people[bearer], name: people[bearer]!.email.split("@")[0] } }) : json(null);
      if (url.pathname === "/api/auth/convex/token") return people[bearer] ? json({ token: `jwt-for-${people[bearer]!.id}` }) : json({}, 401);
      return json({ success: true });
    };
  }
  const finish = async (h: ReturnType<typeof harness>, n: number) => {
    await tick();
    h.bridge.handleCallback(`folevi://auth/callback?code=c${n}&state=${new URL(h.opened[n]!).searchParams.get("state")}`);
  };

  test("each account keeps its own session; the same person signing in again replaces only theirs", async () => {
    const ana1 = "Anasessiontoken0123456789abcdefA";
    const ben1 = "Bensessiontoken0123456789abcdefB";
    const ana2 = "Anasessiontoken0123456789abcde2A";
    const queue = [ana1, ben1, ana2];
    const people = { [ana1]: { id: "userAna", email: "ana@example.com" }, [ben1]: { id: "userBen", email: "ben@example.com" }, [ana2]: { id: "userAna", email: "ana@example.com" } };
    const h = harness({ token: null, respond: server(people, () => queue.shift()!) });
    let p = h.bridge.signInAccount();
    await finish(h, 0);
    expect(await p).toMatchObject({ userId: "userAna", email: "ana@example.com" });
    p = h.bridge.signInAccount();
    await finish(h, 1);
    expect(await p).toMatchObject({ userId: "userBen" });
    expect(h.store.get("auth.session.userAna")).toBe(ana1);
    expect(h.store.get("auth.session.userBen")).toBe(ben1);
    expect(h.store.get("auth.session")).toBeNull();
    // Requests go with the named account's bearer.
    expect(await h.bridge.convexToken("userBen")).toBe("jwt-for-userBen");
    expect(await h.bridge.convexToken("userAna")).toBe("jwt-for-userAna");
    // Ana again: her old session ends, Ben's stays.
    h.sent.length = 0;
    p = h.bridge.signInAccount();
    await finish(h, 2);
    expect(await p).toMatchObject({ userId: "userAna" });
    expect(h.store.get("auth.session.userAna")).toBe(ana2);
    expect(h.store.get("auth.session.userBen")).toBe(ben1);
    const signOuts = h.sent.filter((x) => x.url.endsWith("/api/auth/sign-out"));
    expect(signOuts.map((x) => x.init.headers.authorization)).toEqual([`Bearer ${ana1}`]);
    // Signing out of Ben leaves Ana.
    await h.bridge.signOut("userBen");
    expect(h.store.get("auth.session.userBen")).toBeNull();
    expect(h.bridge.signedIn("userAna")).toBe(true);
  });

  test("an older build's single session moves to its account's slot; an ended one stays for the next try", async () => {
    const people = { [TOKEN]: { id: "userOld", email: "old@example.com" } };
    const h = harness({ respond: server(people, () => "x") });
    expect(await h.bridge.adoptLegacy()).toMatchObject({ userId: "userOld" });
    expect(h.store.get("auth.session")).toBeNull();
    expect(h.store.get("auth.session.userOld")).toBe(TOKEN);
    const ended = harness({ respond: server({}, () => "x") });
    expect(await ended.bridge.adoptLegacy()).toBeNull();
    expect(ended.store.get("auth.session")).toBe(TOKEN);
  });

  test("the IPC answers each page as its own account (main says which), never one the page names", async () => {
    const people = { [TOKEN]: { id: "userAna", email: "a@example.com" } };
    const h = harness({ token: null, respond: server(people, () => "x") });
    h.store.set("auth.session.userAna", TOKEN);
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    registerAuthIpc((c, l) => void handlers.set(c, l), () => h.bridge, () => true, { slot: (e) => (e as { place: string }).place });
    expect(await handlers.get(AUTH_CHANNELS.convexToken)!({ place: "userAna" })).toBe("jwt-for-userAna");
    expect(await handlers.get(AUTH_CHANNELS.convexToken)!({ place: "userBen" })).toBeNull();
  });
});
