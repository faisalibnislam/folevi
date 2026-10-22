// "Sync with Dropbox" and "Sync with Google Drive" as library kinds: setup (and a second Mac adopting the same
// library), the page's calls, encryption around the provider's LocalFs, change batches with the page's names,
// attachments through /_files, and moving between a folder and a provider. On WP9b's fake providers, through
// its real CloudLibrary.
import { createHash } from "node:crypto";
import { afterAll, afterEach, describe, expect, test } from "vitest";
import { CloudLibrary } from "./cloud/shared/library";
import type { CloudConnections } from "./cloud/shared/connection";
import { FakeDropbox } from "../../test/cloud/fakeDropbox";
import { FakeDrive } from "../../test/cloud/fakeDrive";
import { dropboxDevice, driveDevice, SMALL_UPLOADS } from "../../test/cloud/harness";
import { cleanupTemps, fakeSealer, tempDir, text, utf8 } from "../../test/library-kit";
import { createAppHandler } from "../protocol";
import { isEnvelope } from "./crypto";
import { LibraryService } from "./service";
import type { LibraryChange, LibraryFs } from "./types";

const services: LibraryService[] = [];
afterEach(() => {
  for (const s of services.splice(0)) s.dispose();
});
afterAll(cleanupTemps);

const DOC = "01J9ZDOC000000000000000001";

/** A connection to a fake provider, as CloudLibrary sees CloudConnections (the sign-in itself is WP9b's). */
function connection(provider: "dropbox" | "googleDrive", fs: LibraryFs | null) {
  let emit: ((c: { path: string; kind: "changed" | "removed" }[]) => void) | null = null;
  const connections = {
    get fs() {
      return fs;
    },
    status: () => ({ available: [provider], provider: fs ? provider : null, state: fs ? "connected" : "none", account: null }),
    watch: (cb: (c: { path: string; kind: "changed" | "removed" }[]) => void) => {
      emit = cb;
      return () => (emit = null);
    },
  } as unknown as CloudConnections;
  return { library: new CloudLibrary(connections), emit: (c: { path: string; kind: "changed" | "removed" }[]) => emit?.(c) };
}

function make(cloud: CloudLibrary | null, o: { pick?: string; userData?: string; home?: string } = {}) {
  const userData = o.userData ?? tempDir("folevi-support-");
  const home = o.home ?? tempDir("folevi-home-");
  const s = new LibraryService({
    userData,
    home,
    helperPath: null,
    coordinator: null,
    cloud,
    chooseFolder: async () => o.pick ?? null,
    sealer: fakeSealer,
    iterations: 1000,
    watch: { useFsEvents: false, scanIntervalMs: 3_600_000 },
  });
  services.push(s);
  return { s, userData, home };
}

const dropbox = () => {
  const fake = new FakeDropbox();
  return { fake, device: () => dropboxDevice(fake, SMALL_UPLOADS.dropbox).fs as unknown as LibraryFs };
};
const drive = () => {
  const fake = new FakeDrive({ chunkMultiple: 1024 });
  return { fake, device: () => driveDevice(fake, SMALL_UPLOADS.drive).fs as unknown as LibraryFs };
};

describe("Dropbox and Google Drive libraries", () => {
  test("not connected: setup says to connect first", async () => {
    await expect(make(null).s.setup({ kind: "dropbox" })).rejects.toMatchObject({ code: "unavailable", path: "not_connected" });
    await expect(make(connection("dropbox", null).library).s.setup({ kind: "dropbox" })).rejects.toMatchObject({ code: "unavailable" });
    // Connected to Dropbox isn't connected to Google Drive.
    const d = dropbox();
    await expect(make(connection("dropbox", d.device()).library).s.setup({ kind: "gdrive" })).rejects.toMatchObject({ code: "unavailable" });
  });

  test.each([
    ["dropbox", "dropbox", dropbox, "Dropbox › Apps › Folevi"],
    ["gdrive", "googleDrive", drive, "Google Drive › Folevi"],
  ] as const)("%s: set up, used, and adopted by a second Mac", async (kind, provider, makeFake, shown) => {
    const p = makeFake();
    const a = make(connection(provider, p.device()).library);
    expect(await a.s.setup({ kind })).toEqual({ kind, displayPath: shown, available: true, encrypted: false, locked: false, configured: true });
    await a.s.write(`notes/${DOC}.fnote`, utf8("from mac A"), { ifMatch: null });
    await a.s.journal().append(utf8("edit"));
    const b = make(connection(provider, p.device()).library);
    await b.s.setup({ kind });
    const r = await b.s.read(`notes/${DOC}.fnote`);
    expect("bytes" in r && text(r.bytes)).toBe("from mac A");
    const idA = JSON.parse(text((await a.s.read("folevi-library.json") as { bytes: Uint8Array }).bytes)).libraryId;
    const idB = JSON.parse(text((await b.s.read("folevi-library.json") as { bytes: Uint8Array }).bytes)).libraryId;
    expect(idB).toBe(idA);
    expect(await b.s.journal().readAll()).toEqual([]); // the journal is each Mac's own
  });

  test("encrypted on Dropbox: envelopes under HMAC names there, plain names for the page and its changes", async () => {
    const p = dropbox();
    const conn = connection("dropbox", p.device());
    const { s } = make(conn.library);
    await s.setup({ kind: "dropbox" });
    const noteBody = utf8(JSON.stringify({ id: DOC, words: "secret" }));
    await s.write(`notes/${DOC}.fnote`, noteBody, {});
    const sha = createHash("sha256").update("picture").digest("hex");
    await s.write(`files/${sha.slice(0, 2)}/${sha}`, utf8("picture"), {});
    await s.setPassphrase("pass");
    expect(await s.info()).toMatchObject({ kind: "dropbox", encrypted: true, locked: false });
    // What the provider holds.
    const raw = p.device();
    const onCloud = (await raw.list("")).map((e) => e.path).sort();
    expect(onCloud.some((x) => x.includes(DOC))).toBe(false);
    const note = onCloud.find((x) => x.startsWith("notes/"))!;
    expect(isEnvelope((await raw.read(note) as { bytes: Uint8Array }).bytes)).toBe(true);
    // What the page sees.
    expect((await s.list("")).map((e) => e.path).sort()).toEqual([`files/${sha.slice(0, 2)}/${sha}`, "folevi-library.json", `notes/${DOC}.fnote`]);
    // A change from another device arrives under the HMAC name and goes to the page under the note's.
    const batches: LibraryChange[][] = [];
    s.watch((c) => batches.push(c));
    conn.emit([{ path: note, kind: "changed" }]);
    await new Promise((r) => setTimeout(r, 20));
    expect(batches).toEqual([[{ path: `notes/${DOC}.fnote`, kind: "changed" }]]);
    // Attachments are read through the provider and decrypted.
    const handle = createAppHandler({ root: tempDir(), mode: () => "local", csp: { serviceOrigin: "https://app.folevi.com" }, files: s.files });
    const res = await handle(new Request(`app://folevi/_files/${sha}`, { headers: { range: "bytes=1-3" } }));
    expect(res.status).toBe(206);
    expect(await res.text()).toBe("ict");
  });

  test("moves between a folder on this Mac and Google Drive, both ways", async () => {
    const p = drive();
    const folder = tempDir();
    const { s } = make(connection("googleDrive", p.device()).library, { pick: folder });
    await s.setup({ kind: "device" });
    for (let i = 0; i < 3; i++) await s.write(`notes/01J9ZDOC00000000000000000${i}.fnote`, utf8(`note ${i}`), {});
    expect(await s.move({ kind: "gdrive" })).toMatchObject({ kind: "gdrive", available: true });
    const r = await s.read("notes/01J9ZDOC000000000000000002.fnote");
    expect("bytes" in r && text(r.bytes)).toBe("note 2");
    expect((await p.device().list("notes")).length).toBe(3);
    await s.write("notes/01J9ZDOC000000000000000009.fnote", utf8("written on Drive"), {});
    expect(await s.move({ kind: "folder" })).toMatchObject({ kind: "folder" });
    const back = await s.read("notes/01J9ZDOC000000000000000009.fnote");
    expect("bytes" in back && text(back.bytes)).toBe("written on Drive");
  });

  test("a provider holding another library isn't overwritten by a move", async () => {
    const p = dropbox();
    const other = make(connection("dropbox", p.device()).library);
    await other.s.setup({ kind: "dropbox" });
    const { s } = make(connection("dropbox", p.device()).library);
    await s.setup({ kind: "device" });
    await expect(s.move({ kind: "dropbox" })).rejects.toMatchObject({ code: "target_has_library" });
  });
});
