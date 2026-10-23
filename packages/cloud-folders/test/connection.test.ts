// The connection end to end on the fake providers: the sign-in in a "browser" that follows the redirect to the
// listener the host gives (here an in-memory one; the Mac and Android hosts have their own), tokens in the host's
// store, the status the page sees, restoring after a restart, "Reconnect" after revocation, one provider per
// library, signing out (revoked, tokens deleted, the device copy kept), the library file and the config.
import { describe, expect, test } from "vitest";
import { availableProviders, readCloudConfig } from "../src/config";
import { CloudConnections, type ConnectionDeps, type ConnectionStatus, type RedirectListener, type SavedConnection } from "../src/connection";
import { CloudLibrary } from "../src/library";
import { MemoryMirror } from "../src/mirror";
import { MemoryTokenStore } from "../src/oauth";
import type { CloudProvider } from "../src/types";
import { FakeDropbox } from "./fakeDropbox";
import { FakeDrive } from "./fakeDrive";
import { noSleep } from "./harness";

class SignInCancelled extends Error {
  override name = "SignInCancelled";
}

/**
 * The end of a sign-in, in memory: the "browser" hands the redirect URL straight to it. Like a host's own
 * listener, it checks `state`, takes the code once, and a refusal or close() cancels the sign-in.
 */
function memoryListener(state: string, deliveries: Map<string, (url: string) => void>): RedirectListener {
  let settle: { resolve(r: { code: string }): void; reject(e: Error): void } | null = null;
  const result = new Promise<{ code: string }>((resolve, reject) => (settle = { resolve, reject }));
  result.catch(() => undefined);
  const redirectUri = `http://127.0.0.1:${40000 + deliveries.size}/`;
  let done = false;
  const finish = (error: Error | null, code?: string) => {
    if (done) return;
    done = true;
    deliveries.delete(redirectUri);
    if (error) settle!.reject(error);
    else settle!.resolve({ code: code! });
  };
  deliveries.set(redirectUri, (url) => {
    const params = new URL(url).searchParams;
    if (params.get("state") !== state) return;
    const code = params.get("code");
    if (params.get("error") || !code) finish(new SignInCancelled(params.get("error") === "access_denied" ? "You cancelled the sign-in." : "No code."));
    else finish(null, code);
  });
  return { redirectUri, result, close: () => finish(new SignInCancelled("The sign-in was stopped.")) };
}

const enc = (s: string) => new TextEncoder().encode(s);
const NOTE = "notes/01J9ZDOC000000000000000001.fnote";

function setup(o: { browser?: "approve" | "deny" | "ignore" } = {}) {
  const dropbox = new FakeDropbox();
  const drive = new FakeDrive();
  const dbxFetch = dropbox.fetchFor();
  const driveFetch = drive.fetchFor();
  const savedFile = { value: null as SavedConnection | null };
  const mirrors = new Map<CloudProvider, MemoryMirror>();
  const opened: string[] = [];
  const tokens = new MemoryTokenStore();
  const deliveries = new Map<string, (url: string) => void>();
  const log: string[] = [];
  const deps: ConnectionDeps = {
    config: { dropboxAppKey: dropbox.oauth.clientId.replace(/-/g, "") + "abcdef", googleClientId: "1234-abc.apps.googleusercontent.com" },
    fetch: (url, init) => (/dropbox/.test(url) ? dbxFetch(url, init) : driveFetch(url, init)),
    tokens,
    saved: { load: async () => savedFile.value, save: async (s) => void (savedFile.value = s) },
    mirrorFor: (p) => {
      if (!mirrors.has(p)) mirrors.set(p, new MemoryMirror());
      return mirrors.get(p)!;
    },
    openBrowser: async (url) => {
      opened.push(url);
      if (o.browser === "ignore") return;
      const u = new URL(url);
      const fake = u.host === "www.dropbox.com" ? dropbox.oauth : drive.oauth;
      let back: string;
      if (o.browser === "deny") {
        const r = new URL(u.searchParams.get("redirect_uri")!);
        r.searchParams.set("error", "access_denied");
        r.searchParams.set("state", u.searchParams.get("state")!);
        back = r.toString();
      } else back = fake.authorize(url, u.host);
      // The browser follows the redirect to the listener on this device.
      const target = new URL(back);
      setTimeout(() => deliveries.get(`${target.origin}/`)?.(back), 0);
    },
    listen: async (_provider, state) => memoryListener(state, deliveries),
    log: (m) => log.push(m),
    sleep: noSleep,
  };
  // The fakes know their client ids; the config must match them.
  (dropbox.oauth as { clientId: string }).clientId = deps.config.dropboxAppKey!;
  (drive.oauth as { clientId: string }).clientId = deps.config.googleClientId!;
  return { dropbox, drive, deps, savedFile, mirrors, opened, tokens, log };
}

describe("connecting", () => {
  test("Dropbox: browser sign-in, tokens kept by the host, account shown, files work", async () => {
    const env = setup();
    const c = new CloudConnections(env.deps);
    const seen: ConnectionStatus[] = [];
    c.onStatus((s) => seen.push(s));
    expect(c.status()).toEqual({ available: ["dropbox", "googleDrive"], provider: null, state: "none", account: null });
    const s = await c.connect("dropbox");
    expect(s).toMatchObject({ provider: "dropbox", state: "connected", account: "faisal@example.com" });
    expect(seen.map((x) => x.state)).toEqual(["connecting", "connected"]);
    const url = new URL(env.opened[0]!);
    expect(url.searchParams.get("redirect_uri")).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    // Tokens in the host's store.
    expect(env.tokens.tokens.get("dropbox")?.refreshToken).toContain("dbx-r");
    await c.fs!.write(NOTE, enc("hi"), { ifMatch: null });
    expect(env.dropbox.file(NOTE)).toEqual(enc("hi"));
    expect(env.savedFile.value).toMatchObject({ provider: "dropbox", account: "faisal@example.com" });
  });

  test("Google Drive: the same, with drive.file and the account from about.get", async () => {
    const env = setup();
    const c = new CloudConnections(env.deps);
    expect(await c.connect("googleDrive")).toMatchObject({ provider: "googleDrive", state: "connected", account: "faisal@example.com" });
    expect(new URL(env.opened[0]!).searchParams.get("scope")).toBe("https://www.googleapis.com/auth/drive.file");
    await c.fs!.write(NOTE, enc("hi"), { ifMatch: null });
    expect(env.drive.file(NOTE)).toEqual(enc("hi"));
  });

  test("a cancelled sign-in leaves nothing behind", async () => {
    const env = setup({ browser: "deny" });
    const c = new CloudConnections(env.deps);
    const error = await c.connect("dropbox").catch((e) => e);
    expect(error).toBeInstanceOf(SignInCancelled);
    expect(c.status().state).toBe("none");
    expect(env.tokens.tokens.size).toBe(0);
    expect(env.savedFile.value).toBeNull();
  });

  test("cancelling while the browser is open", async () => {
    const env = setup({ browser: "ignore" });
    const c = new CloudConnections(env.deps);
    const pending = c.connect("googleDrive");
    await new Promise((r) => setTimeout(r, 20));
    c.cancelConnect();
    expect(await pending.catch((e) => e)).toBeInstanceOf(SignInCancelled);
    expect(c.status().state).toBe("none");
  });

  test("one provider per library", async () => {
    const env = setup();
    const c = new CloudConnections(env.deps);
    await c.connect("dropbox");
    const error = await c.connect("googleDrive").catch((e) => e);
    expect(error.name).toBe("OneConnectionOnly");
    expect(error.message).toBe("This library syncs with Dropbox. Sign out of Dropbox first.");
    expect(c.status().provider).toBe("dropbox");
  });

  test("restart: restored from the saved connection and tokens, without the network", async () => {
    const env = setup();
    const first = new CloudConnections(env.deps);
    await first.connect("dropbox");
    await first.fs!.write(NOTE, enc("x"), { ifMatch: null });
    const again = new CloudConnections(env.deps);
    expect(await again.restore()).toMatchObject({ provider: "dropbox", state: "connected", account: "faisal@example.com" });
    expect((await again.fs!.list("notes")).map((e) => e.path)).toEqual([NOTE]);
  });

  test("revoked: Reconnect Dropbox, then connecting again keeps the library", async () => {
    const env = setup();
    const c = new CloudConnections(env.deps);
    await c.connect("dropbox");
    await c.fs!.write(NOTE, enc("x"), { ifMatch: null });
    env.dropbox.oauth.revokeAll();
    await c.fs!.write(NOTE, enc("y"), {}).catch(() => undefined);
    expect(c.status()).toMatchObject({ provider: "dropbox", state: "reconnect" });
    expect(env.tokens.tokens.size).toBe(0);
    // After a restart it still says so.
    const restarted = new CloudConnections(env.deps);
    expect((await restarted.restore()).state).toBe("reconnect");
    // Reconnect.
    expect((await restarted.connect("dropbox")).state).toBe("connected");
    expect("mismatch" in (await restarted.fs!.write(NOTE, enc("y"), {}))).toBe(false);
  });

  test("offline shows as offline and clears when the provider answers again", async () => {
    const env = setup();
    const c = new CloudConnections(env.deps);
    await c.connect("dropbox");
    await c.fs!.list("");
    env.dropbox.injectors.forEach((i) => (i.offline = true));
    await c.fs!.write(NOTE, enc("x"), {}).catch(() => undefined);
    expect(c.status().state).toBe("offline");
    env.dropbox.injectors.forEach((i) => (i.offline = false));
    await c.fs!.list("");
    expect(c.status().state).toBe("connected");
  });

  test("signing out: revoked at the provider, tokens deleted, sync stopped, the copy on the Mac kept", async () => {
    const env = setup();
    const c = new CloudConnections(env.deps);
    await c.connect("googleDrive");
    await c.fs!.write(NOTE, enc("keep me"), { ifMatch: null });
    const stop = c.watch(() => undefined);
    const s = await c.signOut();
    stop();
    expect(s).toEqual({ available: ["dropbox", "googleDrive"], provider: null, state: "none", account: null });
    expect(c.fs).toBeNull();
    expect(env.tokens.tokens.size).toBe(0);
    expect(env.savedFile.value).toBeNull();
    expect(env.drive.oauth.refresh.size).toBe(0); // the grant was revoked
    expect(new TextDecoder().decode((await env.mirrors.get("googleDrive")!.readFile(NOTE))!.bytes)).toBe("keep me");
  });

  test("the library file: made on first connect, adopted on the second device", async () => {
    const env = setup();
    const a = new CloudConnections(env.deps);
    await a.connect("dropbox");
    const libA = new CloudLibrary(a, () => "01J9ZLIB000000000000000001", () => 5);
    const m = await libA.prepare();
    expect(m).toMatchObject({ format: "folevi-library", libraryId: "01J9ZLIB000000000000000001", encryption: null });
    const env2 = { ...env.deps, mirrorFor: () => new MemoryMirror(), saved: { load: async () => null, save: async () => undefined } };
    const b = new CloudConnections(env2);
    await b.connect("dropbox");
    const libB = new CloudLibrary(b, () => "01J9ZLIB000000000000000002");
    expect((await libB.prepare()).libraryId).toBe("01J9ZLIB000000000000000001");
    expect(await libB.info()).toMatchObject({ kind: "dropbox", displayPath: "Dropbox › Apps › Folevi", available: true, libraryId: "01J9ZLIB000000000000000001" });
    await libA.fs()!.write(NOTE, enc("n"), { ifMatch: null });
    expect(await libB.downloadAll()).toBe(2);
  });
});

describe("pieces", () => {
  test("config: environment over the build's file; malformed ids ignored; missing ones hidden with a log line", () => {
    const file = { dropboxAppKey: "abcd1234efgh", googleClientId: "1-x.apps.googleusercontent.com" };
    expect(readCloudConfig({}, file)).toEqual(file);
    expect(readCloudConfig({ FOLEVI_DROPBOX_APP_KEY: "zzzz9999yyyy" }, file).dropboxAppKey).toBe("zzzz9999yyyy");
    expect(readCloudConfig({ FOLEVI_GOOGLE_DESKTOP_CLIENT_ID: "not an id" }, {})).toEqual({});
    const log: string[] = [];
    expect(availableProviders(readCloudConfig({}, null), (m) => log.push(m))).toEqual([]);
    expect(log.length).toBe(2);
    expect(log[0]).toContain("FOLEVI_DROPBOX_APP_KEY");
    expect(log[1]).toContain("FOLEVI_GOOGLE_DESKTOP_CLIENT_ID");
    expect(log.join("")).not.toContain(String.fromCharCode(0x2014)); // the house rule: no em dashes
    expect(availableProviders({ googleClientId: "1-x.apps.googleusercontent.com" })).toEqual(["googleDrive"]);
  });
});
