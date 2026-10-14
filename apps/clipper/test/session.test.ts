// Token handling: fresh tokens are used as they are, stale ones refreshed (once, however many ask), a 401
// refreshes and retries, and a refused refresh signs out. Tokens are never logged.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { Session, SignedOutError } from "../src/lib/session";
import { json, memoryStore, scriptedFetch } from "./fakes";

const ORIGIN = "https://app.folevi.com";
const client = { clientId: "c1", redirectUri: "https://x.chromiumapp.org/" };

function signedIn(fetch: typeof globalThis.fetch, access: { token: string; expiresAt: number } | null, now = 1_000_000) {
  const local = memoryStore({ client, refreshToken: "fvrt_1" });
  const memory = memoryStore(access ? { accessToken: access } : {});
  return { session: new Session({ origin: ORIGIN, local, memory, fetch, now: () => now }), local, memory };
}

const ok = () => json(200, { result: {} });

describe("Session", () => {
  test("a fresh access token is sent as is", async () => {
    const fetch = scriptedFetch((req) => {
      expect(req.headers.get("authorization")).toBe("Bearer fvat_live");
      return ok();
    });
    const { session } = signedIn(fetch, { token: "fvat_live", expiresAt: 1_000_000 + 600_000 });
    expect((await session.fetch(`${ORIGIN}/mcp`, { method: "POST" })).status).toBe(200);
    expect(fetch.sent).toHaveLength(1);
  });

  test("one about to expire is refreshed first, and the new refresh token kept", async () => {
    const fetch = scriptedFetch(
      (req) => {
        expect(req.url).toBe(`${ORIGIN}/api/auth/oauth2/token`);
        return json(200, { access_token: "fvat_new", refresh_token: "fvrt_2", expires_in: 3600 });
      },
      (req) => {
        expect(req.headers.get("authorization")).toBe("Bearer fvat_new");
        return ok();
      },
    );
    const { session, local, memory } = signedIn(fetch, { token: "fvat_old", expiresAt: 1_000_000 + 30_000 });
    await session.fetch(`${ORIGIN}/mcp`);
    expect(local.data.refreshToken).toBe("fvrt_2");
    expect(memory.data.accessToken).toEqual({ token: "fvat_new", expiresAt: 1_000_000 + 3_600_000 });
  });

  test("a 401 refreshes once and retries", async () => {
    const fetch = scriptedFetch(
      () => json(401, { error: { message: "expired" } }),
      () => json(200, { access_token: "fvat_new", expires_in: 3600 }),
      (req) => {
        expect(req.headers.get("authorization")).toBe("Bearer fvat_new");
        return ok();
      },
    );
    const { session, local } = signedIn(fetch, { token: "fvat_revoked", expiresAt: 9_999_999_999 });
    expect((await session.fetch(`${ORIGIN}/mcp`)).status).toBe(200);
    // No new refresh token came: the old one stays.
    expect(local.data.refreshToken).toBe("fvrt_1");
  });

  test("a refused refresh signs out", async () => {
    const fetch = scriptedFetch(() => json(400, { error: "invalid_grant" }));
    const { session, local, memory } = signedIn(fetch, null);
    await expect(session.fetch(`${ORIGIN}/mcp`)).rejects.toBeInstanceOf(SignedOutError);
    expect(local.data.refreshToken).toBeUndefined();
    expect(memory.data.accessToken).toBeUndefined();
    // The registration stays, so signing in again reuses it.
    expect(local.data.client).toEqual(client);
    expect(await session.signedIn()).toBe(false);
  });

  test("a 401 after a successful refresh signs out instead of looping", async () => {
    const fetch = scriptedFetch(() => json(401, {}), () => json(200, { access_token: "fvat_new", expires_in: 3600 }), () => json(401, {}));
    const { session } = signedIn(fetch, { token: "fvat_a", expiresAt: 9_999_999_999 });
    await expect(session.fetch(`${ORIGIN}/mcp`)).rejects.toThrow(/no longer accepts/);
    expect(await session.signedIn()).toBe(false);
  });

  test("a network failure during refresh keeps the tokens", async () => {
    const fetch = scriptedFetch(() => Promise.reject(new TypeError("Failed to fetch")));
    const { session, local } = signedIn(fetch, null);
    await expect(session.accessToken()).rejects.toBeInstanceOf(TypeError);
    expect(local.data.refreshToken).toBe("fvrt_1");
  });

  test("requests that need a refresh at the same time share one", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const fetch = scriptedFetch(async () => {
      await gate;
      return json(200, { access_token: "fvat_new", expires_in: 3600 });
    });
    const { session } = signedIn(fetch, null);
    const both = Promise.all([session.accessToken(), session.accessToken()]);
    release();
    expect(await both).toEqual(["fvat_new", "fvat_new"]);
    expect(fetch.sent).toHaveLength(1);
  });

  test("signed out with no refresh token: asks to sign in, without a request", async () => {
    const fetch = scriptedFetch();
    const session = new Session({ origin: ORIGIN, local: memoryStore(), memory: memoryStore(), fetch });
    expect(await session.signedIn()).toBe(false);
    await expect(session.accessToken()).rejects.toBeInstanceOf(SignedOutError);
  });
});

test("nothing in the extension logs (so no token can end up in a console)", async () => {
  const dir = join(import.meta.dirname, "../src");
  const files: string[] = [];
  const walk = async (d: string) => {
    for (const e of await readdir(d, { withFileTypes: true })) {
      if (e.isDirectory()) await walk(join(d, e.name));
      else if (e.name.endsWith(".ts")) files.push(join(d, e.name));
    }
  };
  await walk(dir);
  for (const f of files) expect(await readFile(f, "utf8"), f).not.toMatch(/\bconsole\./);
});
