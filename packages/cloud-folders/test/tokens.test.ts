// Tokens: PKCE sign-in against the fake servers, refresh before expiry and after a 401, one refresh for many
// requests at once, the "Reconnect" state when access is revoked, and a fresh sign-in recovering from it.
import { describe, expect, test } from "vitest";
import { RetryingHttp } from "../src/http";
import { AuthedHttp, createPkce, DropboxOAuth, GoogleOAuth, MemoryTokenStore, TokenManager, type AuthState } from "../src/oauth";
import { isCloudError } from "../src/types";
import { FakeDropbox } from "./fakeDropbox";
import { FakeDrive } from "./fakeDrive";
import { dropboxDevice, driveDevice, noSleep } from "./harness";

const enc = (s: string) => new TextEncoder().encode(s);
const NOTE = "notes/01J9ZDOC000000000000000001.fnote";

describe("PKCE", () => {
  test("RFC 7636 appendix B", async () => {
    const p = await createPkce("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk");
    expect(p.challenge).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    const fresh = await createPkce();
    expect(fresh.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  test("Dropbox: offline access, S256, no secret; the code exchange checks the verifier", async () => {
    const fake = new FakeDropbox();
    const http = new RetryingHttp(fake.fetchFor(), { sleep: noSleep });
    const client = new DropboxOAuth(fake.oauth.clientId, http);
    const pkce = await createPkce();
    const url = new URL(client.authorizeUrl({ redirectUri: "http://127.0.0.1:53682/", state: "s1", challenge: pkce.challenge }));
    expect(url.origin + url.pathname).toBe("https://www.dropbox.com/oauth2/authorize");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ token_access_type: "offline", code_challenge_method: "S256", response_type: "code", state: "s1" });
    expect(url.searchParams.has("client_secret")).toBe(false);
    const back = new URL(fake.oauth.authorize(url.toString(), "www.dropbox.com"));
    const code = back.searchParams.get("code")!;
    // A wrong verifier is refused (as revoked: connect again).
    const wrong = await client.exchange({ code, verifier: (await createPkce()).verifier, redirectUri: "http://127.0.0.1:53682/" }).catch((e) => e);
    expect(isCloudError(wrong, "reconnect")).toBe(true);
    const again = new URL(fake.oauth.authorize(url.toString(), "www.dropbox.com")).searchParams.get("code")!;
    const tokens = await client.exchange({ code: again, verifier: pkce.verifier, redirectUri: "http://127.0.0.1:53682/" });
    expect(tokens.refreshToken).toMatch(/^dbx-r/);
    expect(tokens.expiresAt).toBeGreaterThan(Date.now());
  });

  test("Google: drive.file only, consent for a refresh token, loopback redirect; the secret only if the build has one", async () => {
    const fake = new FakeDrive();
    const http = new RetryingHttp(fake.fetchFor(), { sleep: noSleep });
    const url = new URL(new GoogleOAuth(fake.oauth.clientId, http).authorizeUrl({ redirectUri: "http://127.0.0.1:49152/", state: "s", challenge: "c" }));
    expect(url.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/drive.file");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:49152/");
    const bodies: string[] = [];
    const spy = new RetryingHttp(async (u, init) => {
      bodies.push(String(init?.body));
      return fake.fetchFor()(u, init);
    });
    await new GoogleOAuth(fake.oauth.clientId, spy).refresh("nope").catch(() => undefined);
    await new GoogleOAuth(fake.oauth.clientId, spy, Date.now, "not-really-secret").refresh("nope").catch(() => undefined);
    expect(bodies[0]).not.toContain("client_secret");
    expect(bodies[1]).toContain("client_secret=not-really-secret");
  });
});

describe("refresh and revocation", () => {
  for (const [name, setup] of [
    ["Dropbox", () => {
      const clock = { now: 1_000_000 };
      const fake = new FakeDropbox({ now: () => clock.now, accessTtlMs: 300_000 });
      return { clock, fake, device: dropboxDevice(fake, { now: () => clock.now }) };
    }],
    ["Google Drive", () => {
      const clock = { now: 1_000_000 };
      const fake = new FakeDrive({ now: () => clock.now, accessTtlMs: 300_000 });
      return { clock, fake, device: driveDevice(fake, { now: () => clock.now }) };
    }],
  ] as const) {
    test(`${name}: refreshes a minute before expiry, and once for many requests`, async () => {
      const { clock, fake, device } = setup();
      await device.fs.write(NOTE, enc("a"), { ifMatch: null });
      expect(fake.oauth.refreshes).toBe(0);
      clock.now += 250_000; // inside the last minute
      await Promise.all([device.fs.list(""), device.fs.read(NOTE), device.fs.list("notes")]);
      expect(fake.oauth.refreshes).toBe(1);
      expect(device.tokens.state).toBe("connected");
      // The refreshed tokens were stored.
      expect((await device.store.load(device.tokens.client.provider))!.accessToken).toBe(device.tokens.current()!.accessToken);
    });

    test(`${name}: a 401 refreshes and retries (the provider expired the token early)`, async () => {
      const { fake, device } = setup();
      await device.fs.write(NOTE, enc("a"), { ifMatch: null });
      fake.oauth.access.clear(); // every access token dropped, refresh tokens still good
      const r = await device.fs.read("notes/01J9ZDOC000000000000000002.fnote").catch((e) => e);
      expect((r as { code?: string }).code).toBe("not_found");
      expect(fake.oauth.refreshes).toBe(1);
      expect(device.tokens.state).toBe("connected");
    });

    test(`${name}: revoked access means "Reconnect", nothing is written, a new sign-in recovers`, async () => {
      const { fake, device } = setup();
      const states: AuthState[] = [];
      device.tokens.onState((s) => states.push(s));
      await device.fs.write(NOTE, enc("a"), { ifMatch: null });
      fake.oauth.revokeAll(); // the person removed Folevi in their account settings
      const error = await device.fs.write(NOTE, enc("b"), {}).catch((e) => e);
      expect(isCloudError(error, "reconnect")).toBe(true);
      expect((error as { code?: string }).code).toBe("io"); // local-store treats it as "try later"
      expect(device.tokens.state).toBe("reconnect");
      expect(states.at(-1)).toBe("reconnect");
      expect(await device.store.load(device.tokens.client.provider)).toBeNull();
      expect(new TextDecoder().decode(fake.file(NOTE)!)).toBe("a");
      // Every further call fails fast, without a request.
      const before = [...fake.injectors].reduce((n, i) => n + i.stats.requests, 0);
      expect(isCloudError(await device.fs.list("").catch((e) => e), "reconnect")).toBe(true);
      expect([...fake.injectors].reduce((n, i) => n + i.stats.requests, 0)).toBe(before);
      // Reconnect: new tokens from a new sign-in.
      const issued = fake.oauth.issue();
      await device.tokens.set({ accessToken: issued.access_token, refreshToken: issued.refresh_token, expiresAt: Date.now() * 2 });
      expect(device.tokens.state).toBe("connected");
      expect("mismatch" in (await device.fs.write(NOTE, enc("b"), {}))).toBe(false);
    });
  }

  test("a refused refresh token at startup", async () => {
    const fake = new FakeDropbox();
    const store = new MemoryTokenStore();
    await store.save("dropbox", { accessToken: "old", refreshToken: "gone", expiresAt: 0 });
    const tm = new TokenManager(new DropboxOAuth(fake.oauth.clientId, new RetryingHttp(fake.fetchFor(), { sleep: noSleep })), store);
    expect(await tm.load()).toBe(true);
    const api = new AuthedHttp(new RetryingHttp(fake.fetchFor(), { sleep: noSleep }), tm);
    expect(isCloudError(await api.send("https://api.dropboxapi.com/2/users/get_current_account", { method: "POST" }).catch((e) => e), "reconnect")).toBe(true);
    expect(tm.state).toBe("reconnect");
  });

  test("offline during a refresh is offline, not a revocation", async () => {
    const clock = { now: 0 };
    const fake = new FakeDropbox({ now: () => clock.now, accessTtlMs: 120_000 });
    const device = dropboxDevice(fake, { now: () => clock.now });
    clock.now += 100_000;
    device.injector.offline = true;
    expect(isCloudError(await device.fs.list("").catch((e) => e), "offline")).toBe(true);
    expect(device.tokens.state).toBe("connected");
    device.injector.offline = false;
    expect(await device.fs.list("")).toEqual([]);
  });
});
