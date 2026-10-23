import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { SIGNED_IN_CHECK_SCRIPT, SIGNED_IN_PATH, isSignedInAnswer, signedInCheckScriptHash, signedInCors, signedInPreflight } from "@/lib/auth/signedInCheck";
import { buildContentSecurityPolicy } from "@/lib/security/csp";

const SITE = "https://folevi.com";
const APP = "https://app.folevi.com";

describe("/api/signed-in CORS", () => {
  it("lets the marketing site read the answer with credentials", () => {
    const { allowed, headers } = signedInCors(SITE, SITE, APP);
    expect(allowed).toBe(true);
    expect(headers["access-control-allow-origin"]).toBe(SITE);
    expect(headers["access-control-allow-credentials"]).toBe("true");
    expect(headers["cache-control"]).toBe("private, no-store");
    expect(headers.vary).toBe("Origin");
  });

  it("answers the app itself without CORS headers", () => {
    for (const origin of [null, APP]) {
      const { allowed, headers } = signedInCors(origin, SITE, APP);
      expect(allowed).toBe(true);
      expect(headers["access-control-allow-origin"]).toBeUndefined();
    }
  });

  it("refuses every other origin, lookalikes included", () => {
    for (const origin of ["https://evil.example", "https://folevi.com.evil.example", "http://folevi.com", "https://www.folevi.com", "null"]) {
      const { allowed, headers } = signedInCors(origin, SITE, APP);
      expect(allowed).toBe(false);
      expect(headers["access-control-allow-origin"]).toBeUndefined();
      expect(headers["access-control-allow-credentials"]).toBeUndefined();
    }
  });

  it("preflights GET for the marketing site only", () => {
    expect(signedInPreflight(SITE, SITE, APP)["access-control-allow-methods"]).toBe("GET");
    expect(signedInPreflight("https://evil.example", SITE, APP)["access-control-allow-methods"]).toBeUndefined();
  });

  it("leaves the page only on an explicit yes", () => {
    expect(isSignedInAnswer({ signedIn: true })).toBe(true);
    for (const body of [{ signedIn: false }, { signedIn: "true" }, {}, null, "yes", true]) expect(isSignedInAnswer(body)).toBe(false);
  });

  it("is allowed by the policy the landing page is served with", () => {
    const policy = buildContentSecurityPolicy({ dev: false, convexUrl: "https://x.convex.cloud", convexSiteUrl: "https://x.convex.site", appUrl: APP });
    expect(policy.split("; ").find((d) => d.startsWith("connect-src"))).toContain(APP);
  });
});

/** Runs the head script against a fake page and reports what it did. */
async function run(opts: { host?: string; path?: string; search?: string; answer?: unknown; fails?: boolean; seen?: boolean; persisted?: boolean } = {}) {
  const store = new Map<string, string>(opts.seen ? [["folevi:signed-in-here", "1"]] : []);
  const visibility: string[] = [];
  const fetches: { url: string; init: unknown }[] = [];
  let replaced: string | null = null;
  const listeners: Record<string, ((e: unknown) => void)[]> = {};
  const style = {
    set visibility(v: string) {
      visibility.push(v);
    },
  };
  const ctx = {
    location: {
      host: opts.host ?? "folevi.com",
      pathname: opts.path ?? "/",
      search: opts.search ?? "",
      replace: (u: string) => {
        replaced = u;
      },
    },
    document: { documentElement: { style }, prerendering: false, addEventListener: () => undefined },
    localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) },
    fetch: (url: string, init: unknown) => {
      fetches.push({ url, init });
      return opts.fails ? Promise.reject(new TypeError("Load failed")) : Promise.resolve({ ok: true, json: () => Promise.resolve(opts.answer) });
    },
    addEventListener: (type: string, fn: (e: unknown) => void) => {
      (listeners[type] ??= []).push(fn);
    },
    URLSearchParams,
    setTimeout: () => 1,
    clearTimeout: () => undefined,
  };
  runInNewContext(SIGNED_IN_CHECK_SCRIPT, ctx);
  await new Promise((r) => setTimeout(r, 0));
  if (opts.persisted) {
    for (const fn of listeners.pageshow ?? []) fn({ persisted: true });
    await new Promise((r) => setTimeout(r, 0));
  }
  return { fetches, replaced: replaced as string | null, visibility, store };
}

describe("the landing page's signed-in check", () => {
  it("asks the app host with the browser's cookies and opens the notes on yes", async () => {
    const r = await run({ answer: { signedIn: true } });
    expect(r.fetches).toHaveLength(1);
    expect(r.fetches[0]!.url).toBe(`${APP}${SIGNED_IN_PATH}`);
    expect(r.fetches[0]!.init).toMatchObject({ credentials: "include", cache: "no-store" });
    expect(r.replaced).toBe(`${APP}/documents`);
    expect(r.store.get("folevi:signed-in-here")).toBe("1");
  });

  it("stays on the page on no, or when the request fails", async () => {
    expect((await run({ answer: { signedIn: false } })).replaced).toBeNull();
    expect((await run({ fails: true })).replaced).toBeNull();
    expect((await run({ answer: null })).replaced).toBeNull();
  });

  it("hides the page while asking only for a browser found signed in here before, and always shows it again", async () => {
    expect((await run({ answer: { signedIn: false } })).visibility).toEqual([]);
    const no = await run({ seen: true, answer: { signedIn: false } });
    expect(no.visibility).toEqual(["hidden", ""]);
    expect(no.store.has("folevi:signed-in-here")).toBe(false);
    expect((await run({ seen: true, fails: true })).visibility).toEqual(["hidden", ""]);
    // On yes the page stays hidden while the notes open.
    expect((await run({ seen: true, answer: { signedIn: true } })).visibility).toEqual(["hidden"]);
  });

  it("does nothing on /?home, other pages or the app host", async () => {
    for (const o of [{ search: "?home" }, { search: "?utm_source=x&home=1" }, { path: "/pricing" }, { host: "app.folevi.com" }]) {
      expect((await run({ ...o, answer: { signedIn: true } })).fetches).toHaveLength(0);
    }
  });

  it("asks again when the page comes back from the back/forward cache", async () => {
    const r = await run({ answer: { signedIn: false }, persisted: true });
    expect(r.fetches).toHaveLength(2);
  });

  it("has a stable hash for the nonce policy", async () => {
    expect(await signedInCheckScriptHash()).toMatch(/^'sha256-[A-Za-z0-9+/]+=*'$/);
  });
});
