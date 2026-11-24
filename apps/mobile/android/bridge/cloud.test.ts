// The Android bridge's cloud layer (bridge/cloud.ts: requests through the app, the copy kept by the app) under
// the same LocalFs contract the providers pass in packages/cloud-folders (test/contract.ts), with the package's
// fake providers (imported from the package, so their types are the same). What's Android's own: the bridge never sets the Authorization header, base64
// crosses both ways, a provider's 401 after the app's refresh is "reconnect", the library file is joined.
import { describe, expect, test } from "vitest";
import { DriveFs, driveClassifier } from "../../../packages/cloud-folders/src/drive";
import { DropboxFs } from "../../../packages/cloud-folders/src/dropbox";
import { RetryingHttp } from "../../../packages/cloud-folders/src/http";
import { MemoryMirror } from "../../../packages/cloud-folders/src/mirror";
import { runContract } from "../../../packages/cloud-folders/test/contract";
import { FaultInjector, NO_FAKE_FAULTS, seeded } from "../../../packages/cloud-folders/test/fakeCommon";
import { FakeDropbox } from "../../../packages/cloud-folders/test/fakeDropbox";
import { FakeDrive } from "../../../packages/cloud-folders/test/fakeDrive";
import { SMALL_UPLOADS } from "../../../packages/cloud-folders/test/harness";
import { copyLibrary, nativeFetch, nativeMirror, prepareLibrary, type Call } from "./cloud";
import { bytes, fakeNative } from "./fakeNative";

const noSleep = async () => undefined;

function apiOf(call: Call, provider: "dropbox" | "googleDrive") {
  const http = new RetryingHttp(nativeFetch(call, bytes, provider, true), { sleep: noSleep }, provider === "googleDrive" ? driveClassifier : undefined);
  return { send: (u: string, i?: RequestInit) => http.send(u, i) };
}

function dropboxOnAndroid(fake: FakeDropbox, mirror = new MemoryMirror()) {
  const injector = new FaultInjector(seeded(Math.floor(fake.random() * 2 ** 31)));
  const issued = fake.oauth.issue();
  const n = fakeNative({ fetch: fake.fetchFor(injector), token: () => issued.access_token, refresh: () => fake.oauth.issue().access_token, mirror });
  const fs = new DropboxFs(apiOf(n.call, "dropbox"), new RetryingHttp(nativeFetch(n.call, bytes, "dropbox", false), { sleep: noSleep }), nativeMirror(n.call, bytes, "dropbox"), { sleep: noSleep, ...SMALL_UPLOADS.dropbox });
  return { fs, mirror, injector, native: n };
}

function driveOnAndroid(fake: FakeDrive, mirror = new MemoryMirror()) {
  const injector = new FaultInjector(seeded(Math.floor(fake.random() * 2 ** 31)));
  const issued = fake.oauth.issue();
  const n = fakeNative({ fetch: fake.fetchFor(injector), token: () => issued.access_token, refresh: () => fake.oauth.issue().access_token, mirror });
  const fs = new DriveFs(apiOf(n.call, "googleDrive"), nativeMirror(n.call, bytes, "googleDrive"), { sleep: noSleep, ...SMALL_UPLOADS.drive });
  return { fs, mirror, injector, native: n };
}

runContract("Dropbox through the Android bridge", () => {
  const fake = new FakeDropbox({ seed: 5, pageSize: 2 });
  return {
    device: (mirror) => dropboxOnAndroid(fake, mirror),
    cloudFile: (p) => fake.file(p),
    setFaults: (f) => (fake.faults = { ...NO_FAKE_FAULTS, ...f }),
    settle: () => fake.settle(),
    downloads: () => fake.routes.get("/2/files/download") ?? 0,
  };
});

runContract("Google Drive through the Android bridge", () => {
  const fake = new FakeDrive({ seed: 5, pageSize: 2, chunkMultiple: 1024 });
  return {
    device: (mirror) => driveOnAndroid(fake, mirror),
    cloudFile: (p) => fake.file(p),
    setFaults: (f) => (fake.faults = { ...NO_FAKE_FAULTS, ...f }),
    settle: () => fake.settle(),
    downloads: () => fake.routes.get("GET www.googleapis.com/drive/v3/files/:id?alt=media") ?? 0,
  };
});

const enc = (s: string) => new TextEncoder().encode(s);

describe("Android's own rules", () => {
  test("the bridge never holds or sends a token; the app adds it", async () => {
    const fake = new FakeDropbox();
    const { fs, native } = dropboxOnAndroid(fake);
    await fs.write("notes/01J9ZDOC000000000000000001.fnote", enc("a"), { ifMatch: null });
    await fs.list("");
    expect(native.seen.length).toBeGreaterThan(0);
    for (const r of native.seen) expect(Object.keys(r.headers).map((k) => k.toLowerCase())).not.toContain("authorization");
  });

  test("a library file there is joined; an empty place gets one; a move copies everything once", async () => {
    const fake = new FakeDropbox();
    const a = dropboxOnAndroid(fake);
    const made = await prepareLibrary(a.fs);
    const b = dropboxOnAndroid(fake);
    expect((await prepareLibrary(b.fs)).libraryId).toBe(made.libraryId);

    const other = new FakeDrive();
    const target = driveOnAndroid(other);
    await a.fs.write("notes/01J9ZDOC000000000000000001.fnote", enc("note"), { ifMatch: null });
    await a.fs.write("files/9f/9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08", enc("file"), { ifMatch: null });
    expect(await copyLibrary(a.fs, target.fs)).toBe(3);
    expect(new TextDecoder().decode(other.file("notes/01J9ZDOC000000000000000001.fnote"))).toBe("note");
    expect((await prepareLibrary(target.fs)).libraryId).toBe(made.libraryId);
  });

  test("hosts other than the provider's are refused by the app", async () => {
    const n = fakeNative({ fetch: fetch, token: () => "t", refresh: () => "t", mirror: new MemoryMirror() });
    await expect(nativeFetch(n.call, bytes, "dropbox", true)("https://example.com/2/files/list_folder", { method: "POST" })).rejects.toThrow();
    await expect(nativeFetch(n.call, bytes, "dropbox", false)("https://api.dropboxapi.com/2/files/list_folder", { method: "POST" })).rejects.toThrow();
  });
});
