// The connection end to end on the fake providers: the sign-in in a "browser" that follows the redirect to
// the real loopback listener, tokens through the safeStorage store (a fake cipher), the status the page sees,
// restoring after a restart, "Reconnect" after revocation, one provider per library, signing out (revoked,
// tokens deleted, the device copy kept), the cloud:* IPC, the library file, config and the device copy folder.
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { availableProviders, readCloudConfig } from "../../src/library/cloud/config";
import { CloudConnections, type ConnectionDeps, type ConnectionStatus, type SavedConnection } from "../../src/library/cloud/connection";
import { CLOUD_STATUS_CHANNEL, registerCloudIpc, type CloudIpcEvent } from "../../src/library/cloud/ipc";
import { CloudLibrary } from "../../src/library/cloud/library";
import { SignInCancelled, startLoopback } from "../../src/library/cloud/loopback";
import { MemoryMirror } from "../../src/library/cloud/mirror";
import { NodeMirror } from "../../src/library/cloud/nodeMirror";
import { SafeStorageTokenStore, TokenStorageUnavailable, type Cipher } from "../../src/library/cloud/tokenStore";
import type { CloudProvider } from "../../src/library/cloud/types";
import { FakeDropbox } from "./fakeDropbox";
import { FakeDrive } from "./fakeDrive";
import { noSleep } from "./harness";

const temps: string[] = [];
const temp = () => {
  const d = mkdtempSync(join(tmpdir(), "folevi-cloud-"));
  temps.push(d);
  return d;
};
afterAll(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});

/** XOR "encryption": enough to prove nothing is written in plain text. */
function fakeCipher(available = { on: true }): Cipher {
  return {
    isEncryptionAvailable: () => available.on,
    encryptString: (s) => Buffer.from(Buffer.from(s, "utf8").map((b) => b ^ 0x5a)),
    decryptString: (b) => Buffer.from(b.map((x) => x ^ 0x5a)).toString("utf8"),
  };
}

const enc = (s: string) => new TextEncoder().encode(s);
const NOTE = "notes/01J9ZDOC000000000000000001.fnote";

function setup(o: { browser?: "approve" | "deny" | "ignore" } = {}) {
  const dropbox = new FakeDropbox();
  const drive = new FakeDrive();
  const dbxFetch = dropbox.fetchFor();
  const driveFetch = drive.fetchFor();
  const dir = temp();
  const savedFile = { value: null as SavedConnection | null };
  const mirrors = new Map<CloudProvider, MemoryMirror>();
  const opened: string[] = [];
  const cipher = fakeCipher();
  const tokenFile = join(dir, "cloud-tokens.bin");
  const log: string[] = [];
  const deps: ConnectionDeps = {
    config: { dropboxAppKey: dropbox.oauth.clientId.replace(/-/g, "") + "abcdef", googleClientId: "1234-abc.apps.googleusercontent.com" },
    fetch: (url, init) => (/dropbox/.test(url) ? dbxFetch(url, init) : driveFetch(url, init)),
    tokens: new SafeStorageTokenStore(tokenFile, cipher),
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
      // The browser follows the redirect to the listener on this Mac (a real HTTP request).
      void fetch(back).then((r) => r.text());
    },
    listen: (provider, state) => startLoopback({ ports: [0], state, providerName: provider, timeoutMs: 5000 }),
    log: (m) => log.push(m),
    sleep: noSleep,
  };
  // The fakes know their client ids; the config must match them.
  (dropbox.oauth as { clientId: string }).clientId = deps.config.dropboxAppKey!;
  (drive.oauth as { clientId: string }).clientId = deps.config.googleClientId!;
  return { dropbox, drive, deps, savedFile, mirrors, opened, cipher, tokenFile, log };
}

describe("connecting", () => {
  test("Dropbox: browser sign-in, tokens kept encrypted, account shown, files work", async () => {
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
    // Tokens on disk: present, not readable as text.
    const raw = readFileSync(env.tokenFile);
    expect(raw.toString("utf8")).not.toContain("dbx-");
    expect(env.cipher.decryptString(raw)).toContain("dbx-r");
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
    expect(existsSync(env.tokenFile)).toBe(false);
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
    expect(existsSync(env.tokenFile)).toBe(false);
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
    expect(existsSync(env.tokenFile)).toBe(false);
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

describe("cloud:* IPC", () => {
  function fakeIpc() {
    const handlers = new Map<string, (e: CloudIpcEvent, ...a: unknown[]) => unknown>();
    return { handlers, handle: (c: string, l: (e: CloudIpcEvent, ...a: unknown[]) => unknown) => void handlers.set(c, l), removeHandler: (c: string) => void handlers.delete(c) };
  }
  const sender = () => {
    const sent: unknown[][] = [];
    return { sent, s: { id: 1, send: (...a: unknown[]) => void sent.push(a), isDestroyed: () => false, once: () => undefined } };
  };

  test("status, connect, sign out and pushed status; strangers and bad arguments refused", async () => {
    const env = setup();
    const c = new CloudConnections(env.deps);
    const ipc = fakeIpc();
    const off = registerCloudIpc(ipc, c, (e) => e.senderFrame?.url === "app://folevi/");
    const { sent, s } = sender();
    const ok = { sender: s, senderFrame: { url: "app://folevi/" } };
    const call = (ch: string, e: CloudIpcEvent, ...a: unknown[]) => ipc.handlers.get(`cloud:${ch}`)!(e, ...a) as Promise<{ ok: boolean; value?: unknown; error?: { code: string } }>;
    expect(await call("status", { sender: s, senderFrame: { url: "https://evil.example/" } })).toEqual({ ok: false, error: { code: "invalid_argument", message: "Not from Folevi." } });
    expect((await call("connect", ok, "onedrive")).error!.code).toBe("invalid_argument");
    await call("subscribe", ok);
    expect((await call("connect", ok, "dropbox")).value).toMatchObject({ state: "connected", provider: "dropbox" });
    expect(sent.filter((a) => a[0] === CLOUD_STATUS_CHANNEL).map((a) => (a[1] as ConnectionStatus).state)).toEqual(["connecting", "connected"]);
    // Nothing secret in what the page gets.
    expect(JSON.stringify(sent)).not.toMatch(/dbx-[ar]/);
    expect((await call("connect", ok, "googleDrive")).error!.code).toBe("one_connection");
    expect((await call("sign-out", ok)).value).toMatchObject({ state: "none" });
    off();
    expect(ipc.handlers.size).toBe(0);
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

  test("token store: never plain text; refuses without safeStorage; a damaged file reads as signed out", async () => {
    const dir = temp();
    const on = { on: true };
    const store = new SafeStorageTokenStore(join(dir, "t.bin"), fakeCipher(on));
    const t = { accessToken: "a", refreshToken: "r", expiresAt: 1 };
    await store.save("dropbox", t);
    await store.save("googleDrive", { ...t, accessToken: "g" });
    expect(await store.load("dropbox")).toEqual(t);
    await store.clear("dropbox");
    expect(await store.load("dropbox")).toBeNull();
    expect((await store.load("googleDrive"))!.accessToken).toBe("g");
    on.on = false;
    await expect(store.save("dropbox", t)).rejects.toBeInstanceOf(TokenStorageUnavailable);
    expect(await store.load("googleDrive")).toBeNull();
    on.on = true;
    const other = new SafeStorageTokenStore(join(dir, "t.bin"), { ...fakeCipher(), decryptString: () => "{broken" });
    expect(await other.load("googleDrive")).toBeNull();
    await store.clear("googleDrive");
    expect(existsSync(join(dir, "t.bin"))).toBe(false);
  });

  test("loopback: only 127.0.0.1, wrong state ignored, the code taken once", async () => {
    const l = await startLoopback({ ports: [0], state: "good", providerName: "Dropbox", timeoutMs: 3000 });
    expect(l.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    const wrong = await fetch(`${l.redirectUri}?code=evil&state=bad`);
    expect(wrong.status).toBe(400);
    expect((await fetch(`${l.redirectUri}elsewhere`)).status).toBe(404);
    const good = await fetch(`${l.redirectUri}?code=c1&state=good`);
    expect(await good.text()).toContain("Folevi is connected to Dropbox");
    expect(await l.result).toEqual({ code: "c1" });
  });

  test("loopback: a taken fixed port moves to the next one", async () => {
    const first = await startLoopback({ ports: [0], state: "a", providerName: "x" });
    const port = Number(new URL(first.redirectUri).port);
    const second = await startLoopback({ ports: [port, 0], state: "b", providerName: "x" });
    expect(second.redirectUri).not.toBe(first.redirectUri);
    first.close();
    second.close();
    await expect(first.result).rejects.toBeInstanceOf(SignInCancelled);
  });

  test("the device copy as a folder: a library layout plus .folevi-cloud", async () => {
    const root = temp();
    const m = new NodeMirror(root);
    await m.writeFile(NOTE, enc("n"), "rev1");
    await m.writeFile("files/ab/ab0123456789abcdef", enc("f"), "rev2");
    await m.saveState({ v: 1 });
    expect(await m.paths()).toEqual(["files/ab/ab0123456789abcdef", NOTE]);
    expect(readFileSync(join(root, "notes", "01J9ZDOC000000000000000001.fnote"), "utf8")).toBe("n");
    const again = new NodeMirror(root);
    expect(await again.readFile(NOTE)).toEqual({ bytes: enc("n"), etag: "rev1" });
    expect(await again.loadState()).toEqual({ v: 1 });
    await again.deleteFile(NOTE);
    expect(await new NodeMirror(root).readFile(NOTE)).toBeNull();
    await expect(m.writeFile("../escape", enc("x"), "e")).rejects.toMatchObject({ code: "invalid_path" });
  });
});
