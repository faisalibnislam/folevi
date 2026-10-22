// Several accounts in one browser (docs/MULTI_ACCOUNT_PLAN.md §2.1): the proxy's cookie arithmetic, the pin a tab
// decides at load, the registry of places, and the lock that keeps one background runner per account.
import { beforeEach, describe, expect, test, vi } from "vitest";
import { decodeMap, encodeMap, expireCookie, hasAnySession, isPrivateAuthPath, multiFor, multiSetCookie, placesSetCookie, readJar, tokenHash, tokenOfValue, withSessionValue } from "@/lib/auth/placesCookies";
import { answeredSignedOut, checkPinnedSession, pinRequest, type Forward } from "@/lib/auth/places";
import { resolvePin } from "@/lib/places/pin";
import { accountPlaceId, forgetAccount, knownAccounts, lastPlace, parseStored, reconcileAccounts, rememberAccount, userIdOf } from "@/lib/places/registry";
import { holdPlaceOpen, runWhileNotOpen } from "@/lib/places/locks";

vi.mock("server-only", () => ({}));

const signed = (token: string) => encodeURIComponent(`${token}.c2lnbmF0dXJl+/=`);
const ANA = "anaToken1234567890abcdefABCDEF12";
const BEN = "benToken1234567890abcdefABCDEF12";

describe("cookies", () => {
  test("reads the active session, the kept ones and the map; finds an account's cookie through the map", async () => {
    const map = { userAna: await tokenHash(ANA), userBen: await tokenHash(BEN) };
    const header = [`folevi.session_token=${signed(ANA)}`, `folevi.session_token_multi-${ANA.toLowerCase()}=${signed(ANA)}`, `folevi.session_token_multi-${BEN.toLowerCase()}=${signed(BEN)}`, `folevi.places=${encodeMap(map)}`, "other=1"].join("; ");
    const jar = readJar(header);
    expect(jar.session?.value).toBe(signed(ANA));
    expect(jar.multi.map((m) => m.token)).toEqual([ANA.toLowerCase(), BEN.toLowerCase()]);
    expect(jar.map).toEqual(map);
    expect((await multiFor(jar, "userBen"))?.value).toBe(signed(BEN));
    expect(await multiFor(jar, "nobody")).toBeNull();
    // The request as Ben's: only the session cookie changes.
    const asBen = withSessionValue(jar, signed(BEN), "folevi.session_token");
    expect(readJar(asBen).session?.value).toBe(signed(BEN));
    expect(asBen).toContain("other=1");
    expect(readJar(withSessionValue(jar, null, "folevi.session_token")).session).toBeNull();
    expect(hasAnySession(header)).toBe(true);
    expect(hasAnySession(`folevi.session_token_multi-${BEN.toLowerCase()}=${signed(BEN)}`)).toBe(true);
    expect(hasAnySession("folevi_signed_in=1")).toBe(false);
  });

  test("https names: __Secure- session and multi cookies, __Host- map", async () => {
    const jar = readJar(`__Secure-folevi.session_token=${signed(ANA)}; __Secure-folevi.session_token_multi-${BEN.toLowerCase()}=${signed(BEN)}; __Host-folevi.places=${encodeMap({ u: await tokenHash(BEN) })}`);
    expect(jar.session?.name).toBe("__Secure-folevi.session_token");
    expect(jar.multi).toHaveLength(1);
    expect(jar.map.u).toBeDefined();
    expect(placesSetCookie({}, { secure: true, maxAge: 10 })).toMatch(/^__Host-folevi\.places=.*; Path=\/; Max-Age=10; HttpOnly; SameSite=Lax; Secure$/);
    expect(multiSetCookie("__Secure-folevi.session_token", signed(ANA), { secure: true, maxAge: 60 })).toMatch(new RegExp(`^__Secure-folevi\\.session_token_multi-${ANA.toLowerCase()}=`));
    expect(expireCookie("x", false)).toContain("Max-Age=0");
  });

  test("the map holds hashes, never tokens, and survives junk", async () => {
    const h = await tokenHash(ANA);
    expect(h).toHaveLength(16);
    expect(h).not.toContain(ANA.slice(0, 8));
    expect(await tokenHash(ANA.toUpperCase())).toBe(h);
    expect(decodeMap(encodeMap({ good: h, "bad id!": h, short: "x" }))).toEqual({ good: h });
    expect(decodeMap("%%%")).toEqual({});
    expect(tokenOfValue(signed(ANA))).toBe(ANA);
    expect(tokenOfValue("nodot")).toBeNull();
  });

  test("the plugin's own endpoints are never reachable from a browser", () => {
    expect(isPrivateAuthPath("/api/auth/multi-session/list-device-sessions")).toBe(true);
    expect(isPrivateAuthPath("/api/auth/multi-session/revoke")).toBe(true);
    expect(isPrivateAuthPath("/api/auth/get-session")).toBe(false);
  });
});

describe("the proxy's pin", () => {
  const sessions: Record<string, { id: string; token: string }> = { [ANA]: { id: "userAna", token: ANA }, [BEN]: { id: "userBen", token: BEN } };
  /** Better Auth as the proxy reaches it: get-session answers for the session cookie it's given. */
  const forward: Forward = async (req) => {
    const jar = readJar(req.headers.get("cookie"));
    const token = jar.session ? tokenOfValue(jar.session.value) : null;
    const s = token ? sessions[token] : undefined;
    return new Response(JSON.stringify(s ? { session: { token: s.token, userId: s.id, expiresAt: new Date(Date.now() + 86_400_000).toISOString() }, user: { id: s.id, name: s.id, email: `${s.id}@example.com` } } : null), { headers: { "content-type": "application/json" } });
  };
  const browserCookies = `folevi.session_token=${signed(ANA)}; folevi.session_token_multi-${ANA.toLowerCase()}=${signed(ANA)}; folevi.session_token_multi-${BEN.toLowerCase()}=${signed(BEN)}`;

  test("a tab naming Ben reaches Better Auth as Ben while the browser's active session is Ana's, and learns the map", async () => {
    const req = new Request("http://app.test/api/auth/convex/token", { headers: { cookie: browserCookies, "x-folevi-account": "userBen" } });
    const pinned = await pinRequest(req, forward, false);
    expect(pinned.pinned).toBe("userBen");
    expect(pinned.request.headers.get("x-folevi-account")).toBeNull();
    expect(readJar(pinned.request.headers.get("cookie")).session?.value).toBe(signed(BEN));
    const mapCookie = pinned.setCookies.find((c) => c.startsWith("folevi.places="))!;
    const map = decodeMap(mapCookie.split(";")[0]!.slice("folevi.places=".length));
    expect(Object.keys(map).sort()).toEqual(["userAna", "userBen"]);
    // With the map, no lookups at all.
    const lookups = vi.fn(forward);
    const again = await pinRequest(new Request(req.url, { headers: { cookie: `${browserCookies}; folevi.places=${encodeMap(map)}`, "x-folevi-account": "userBen" } }), lookups, false);
    expect(lookups).not.toHaveBeenCalled();
    expect(readJar(again.request.headers.get("cookie")).session?.value).toBe(signed(BEN));
  });

  test("an account the browser doesn't hold runs signed out; no pin passes through untouched", async () => {
    const stranger = await pinRequest(new Request("http://app.test/api/auth/get-session", { headers: { cookie: browserCookies, "x-folevi-account": "userCyd" } }), forward, false);
    expect(readJar(stranger.request.headers.get("cookie")).session).toBeNull();
    const plain = new Request("http://app.test/api/auth/get-session", { headers: { cookie: browserCookies } });
    expect((await pinRequest(plain, forward, false)).request).toBe(plain);
  });

  test("a session from before the jar is kept for its account (it gets a multi cookie)", async () => {
    const pinned = await pinRequest(new Request("http://app.test/api/auth/get-session", { headers: { cookie: `folevi.session_token=${signed(ANA)}`, "x-folevi-account": "userAna" } }), forward, false);
    expect(readJar(pinned.request.headers.get("cookie")).session?.value).toBe(signed(ANA));
    expect(pinned.setCookies.some((c) => c.startsWith(`folevi.session_token_multi-${ANA.toLowerCase()}=${signed(ANA)}`))).toBe(true);
  });

  test("a kept session that has ended is dropped, and a signed-out answer is recognised (the proxy then looks again)", async () => {
    const dead = "deadToken1234567890abcdefABCDEF1";
    const pinned = await pinRequest(new Request("http://app.test/api/auth/get-session", { headers: { cookie: `${browserCookies}; folevi.session_token_multi-${dead.toLowerCase()}=${signed(dead)}`, "x-folevi-account": "userAna" } }), forward, false);
    expect(pinned.setCookies.some((c) => c.startsWith(`folevi.session_token_multi-${dead.toLowerCase()}=;`) && c.includes("Max-Age=0"))).toBe(true);
    expect(await answeredSignedOut(new Response("", { status: 401 }), "/api/auth/convex/token")).toBe(true);
    expect(await answeredSignedOut(new Response("null", { status: 200 }), "/api/auth/get-session")).toBe(true);
    expect(await answeredSignedOut(new Response('{"user":{}}', { status: 200 }), "/api/auth/get-session")).toBe(false);
  });

  test("a get-session answer naming anyone but the pinned account is answered as no session", async () => {
    const answer = new Response(JSON.stringify({ session: { token: "t" }, user: { id: "userAna" } }), { headers: { "content-type": "application/json" } });
    expect(await (await checkPinnedSession(answer.clone(), "userBen", "/api/auth/get-session")).json()).toBeNull();
    expect(await (await checkPinnedSession(answer.clone(), "userAna", "/api/auth/get-session")).json()).toMatchObject({ user: { id: "userAna" } });
    expect(await checkPinnedSession(answer, null, "/api/auth/get-session")).toBe(answer);
  });
});

describe("a tab's pin", () => {
  const base = { search: "", tab: null, last: null, shell: false };
  test("the runner's URL, then the tab's own, then adopt, then the last place; sign-in pages and apps never pin", () => {
    expect(resolvePin({ ...base, pathname: "/place-sync", search: "?place=acct:userBen", tab: "acct:userAna" })).toBe("userBen");
    expect(resolvePin({ ...base, pathname: "/documents", tab: "acct:userAna", last: "acct:userBen" })).toBe("userAna");
    expect(resolvePin({ ...base, pathname: "/documents", tab: "adopt", last: "acct:userBen" })).toBeNull();
    expect(resolvePin({ ...base, pathname: "/d/x", last: "acct:userBen" })).toBe("userBen");
    expect(resolvePin({ ...base, pathname: "/signin", tab: "acct:userAna" })).toBeNull();
    expect(resolvePin({ ...base, pathname: "/oauth/consent", tab: "acct:userAna" })).toBeNull();
    expect(resolvePin({ ...base, pathname: "/documents", tab: "acct:userAna", shell: true })).toBeNull();
    expect(resolvePin({ ...base, pathname: "/documents", last: "library" })).toBeNull();
  });
});

describe("the registry", () => {
  beforeEach(() => localStorage.clear());
  test("remembers what each account's page says, the last place, and forgets on sign-out", () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1000);
    rememberAccount({ userId: "userAna", profileId: "pAna", name: "Ana", email: "ana@example.com", workspaces: [{ id: "w1", name: "Acme", logoUrl: null }] }, { open: true });
    now.mockReturnValue(2000);
    rememberAccount({ userId: "userBen", name: "Ben", email: "ben@example.com", unread: 3 }, { open: true });
    now.mockRestore();
    expect(lastPlace()).toBe(accountPlaceId("userBen"));
    expect(knownAccounts().map((a) => a.userId)).toEqual(["userBen", "userAna"]);
    expect(knownAccounts()[1]!.workspaces[0]!.name).toBe("Acme");
    forgetAccount("userBen");
    expect(lastPlace()).toBe(accountPlaceId("userAna"));
    expect(knownAccounts().map((a) => a.userId)).toEqual(["userAna"]);
  });
  test("keeps only what the server says is signed in, adding what it didn't know", () => {
    rememberAccount({ userId: "userAna", name: "Ana" }, { open: true });
    rememberAccount({ userId: "userOld", name: "Old" });
    reconcileAccounts([{ userId: "userAna", name: "Ana", email: "ana@example.com", image: null }, { userId: "userNew", name: "New", email: "new@example.com", image: null }]);
    expect(knownAccounts().map((a) => a.userId).sort()).toEqual(["userAna", "userNew"]);
    expect(knownAccounts().find((a) => a.userId === "userAna")!.email).toBe("ana@example.com");
  });
  test("junk in storage is ignored; ids are checked", () => {
    expect(parseStored("{")).toEqual({ v: 1, accounts: [], last: null });
    expect(parseStored(JSON.stringify({ accounts: [{ userId: "bad id" }, { userId: "ok" }], last: "acct:bad id" })).accounts.map((a) => a.userId)).toEqual(["ok"]);
    expect(userIdOf("acct:abc")).toBe("abc");
    expect(userIdOf("library")).toBeNull();
  });
});

describe("one runner per account", () => {
  /** A tiny Web Locks: shared and exclusive, queued in order. */
  function fakeLocks() {
    type Req = { name: string; mode: "shared" | "exclusive"; fn: () => Promise<unknown>; resolve: (v: unknown) => void };
    const held: { name: string; mode: string }[] = [];
    const queue: Req[] = [];
    const pump = () => {
      for (const r of [...queue]) {
        const others = held.filter((h) => h.name === r.name);
        const ok = r.mode === "shared" ? others.every((h) => h.mode === "shared") && !queue.slice(0, queue.indexOf(r)).some((q) => q.name === r.name && q.mode === "exclusive") : others.length === 0 && queue.findIndex((q) => q.name === r.name) === queue.indexOf(r);
        if (!ok) continue;
        queue.splice(queue.indexOf(r), 1);
        const lock = { name: r.name, mode: r.mode };
        held.push(lock);
        void r.fn().finally(() => {
          held.splice(held.indexOf(lock), 1);
          r.resolve(undefined);
          pump();
        });
      }
    };
    return {
      request: (name: string, opts: { mode: "shared" | "exclusive"; signal?: AbortSignal }, fn: () => Promise<unknown>) =>
        new Promise((resolve, reject) => {
          const r: Req = { name, mode: opts.mode, fn, resolve };
          opts.signal?.addEventListener("abort", () => {
            const i = queue.indexOf(r);
            if (i >= 0) {
              queue.splice(i, 1);
              reject(new DOMException("aborted", "AbortError"));
            }
          });
          queue.push(r);
          pump();
        }),
      query: async () => ({ held: held.map((h) => ({ ...h })), pending: queue.map((q) => ({ name: q.name, mode: q.mode })) }),
    } as unknown as Pick<LockManager, "request" | "query">;
  }

  test("runs while no tab shows the account, steps aside when one opens it, and runs again when it closes", async () => {
    vi.useFakeTimers();
    const manager = fakeLocks();
    let running = 0;
    const stop = runWhileNotOpen("userBen", () => {
      running++;
      return () => running--;
    }, { manager, checkMs: 100 });
    await vi.advanceTimersByTimeAsync(10);
    expect(running).toBe(1);
    const release = holdPlaceOpen("userBen", manager);
    await vi.advanceTimersByTimeAsync(150);
    expect(running).toBe(0);
    release();
    await vi.advanceTimersByTimeAsync(1200);
    expect(running).toBe(1);
    stop();
    await vi.advanceTimersByTimeAsync(200);
    expect(running).toBe(0);
    vi.useRealTimers();
  });
});
