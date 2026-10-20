// The library service: setting up each kind of place, iCloud Drive being off, the page's file calls and
// journal, encryption on (files become envelopes under HMAC names that local-store's reference reads), locked
// and unlocked, the passphrase changed and encryption off; moving the library, resuming a move that stopped;
// and attachments through protocol.ts's /_files handler, plain and encrypted, by Range.
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, test } from "vitest";
import { EncryptedFs, MemoryFs, unlockMasterKey as refUnlock } from "../../../../packages/local-store/src";
import { cleanupTemps, fakeSealer, helperBinary, tempDir, text, utf8, waitFor } from "../../test/library-kit";
import { FilesHelper, type Coordinator } from "./helper";
import { createAppHandler } from "../protocol";
import { isEnvelope, sealStream } from "./crypto";
import { NodeFs } from "./fs";
import { defaultLocation, iCloudDriveRoot } from "./locations";
import { decodeManifest, LibraryService } from "./service";
import type { LibraryChange } from "./types";

const services: LibraryService[] = [];
afterEach(() => {
  for (const s of services.splice(0)) s.dispose();
});
afterAll(cleanupTemps);

function make(o: { home?: string; userData?: string; pick?: string | null; icloud?: boolean } = {}) {
  const home = o.home ?? tempDir("folevi-home-");
  if (o.icloud) mkdirSync(iCloudDriveRoot(home), { recursive: true });
  const userData = o.userData ?? tempDir("folevi-support-");
  const s = new LibraryService({
    userData,
    home,
    helperPath: null,
    coordinator: null,
    chooseFolder: async () => (o.pick === undefined ? null : o.pick),
    sealer: fakeSealer,
    iterations: 1000,
    watch: { useFsEvents: false, scanIntervalMs: 3_600_000 },
  });
  services.push(s);
  return { s, home, userData };
}

const DOC = "01J9ZDOC000000000000000001";
const SHA = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";

describe("setting up a library", () => {
  test("before setup: not configured, and file calls say so", async () => {
    const { s } = make();
    await s.open();
    expect(await s.info()).toEqual({ kind: "device", displayPath: "", available: false, encrypted: false, locked: false, configured: false });
    await expect(s.list("")).rejects.toMatchObject({ code: "not_set_up" });
    expect(() => s.journal()).toThrow(expect.objectContaining({ code: "not_set_up" }));
  });

  test("This device only: ~/Documents/Folevi Library with a new library file", async () => {
    const { s, home, userData } = make();
    const info = await s.setup({ kind: "device" });
    expect(info).toEqual({ kind: "device", displayPath: "~/Documents/Folevi Library", available: true, encrypted: false, locked: false, configured: true });
    const m = decodeManifest(readFileSync(join(defaultLocation("device", home), "folevi-library.json")));
    expect(m.libraryId).toMatch(/^[0-9A-Z]{26}$/);
    expect(JSON.parse(readFileSync(join(userData, "library.json"), "utf8"))).toMatchObject({ kind: "device", libraryId: m.libraryId });
    // Opening again (the next launch) finds it.
    const again = make({ home, userData }).s;
    await again.open();
    expect((await again.info()).configured).toBe(true);
  });

  test("Sync with iCloud: refused while iCloud Drive is off, then its Folevi folder", async () => {
    const off = make();
    await expect(off.s.setup({ kind: "icloud" })).rejects.toMatchObject({ code: "unavailable", path: "drive_off" });
    const on = make({ icloud: true });
    const info = await on.s.setup({ kind: "icloud" });
    expect(info).toMatchObject({ kind: "icloud", displayPath: "iCloud Drive › Folevi", available: true });
    expect(existsSync(join(defaultLocation("icloud", on.home), "folevi-library.json"))).toBe(true);
  });

  test("Choose a folder: cancelled is null; an empty folder is used, a full one gets a Folevi Library inside", async () => {
    expect(await make().s.setup({ kind: "folder" })).toBeNull();
    const empty = tempDir();
    const a = make({ pick: empty });
    expect(await a.s.setup({ kind: "folder" })).toMatchObject({ kind: "folder", available: true });
    expect(existsSync(join(empty, "folevi-library.json"))).toBe(true);
    const busy = tempDir();
    writeFileSync(join(busy, "Taxes.pdf"), "x");
    const b = make({ pick: busy });
    await b.s.setup({ kind: "folder" });
    expect(existsSync(join(busy, "Folevi Library", "folevi-library.json"))).toBe(true);
    // A folder that already holds a library (from another Mac) is joined, not replaced.
    const c = make({ pick: empty });
    await c.s.setup({ kind: "folder" });
    expect(decodeManifest(readFileSync(join(empty, "folevi-library.json"))).libraryId).toBe(JSON.parse(readFileSync(join(a.userData, "library.json"), "utf8")).libraryId);
  });

  test("the folder going away makes it unavailable, not broken", async () => {
    const dir = tempDir();
    const { s } = make({ pick: dir });
    await s.setup({ kind: "folder" });
    chmodSync(dir, 0o000);
    const fresh = make({ userData: (s as unknown as { o: { userData: string } }).o.userData, home: (s as unknown as { o: { home: string } }).o.home }).s;
    await fresh.open();
    expect(await fresh.info()).toMatchObject({ configured: true, available: false });
    chmodSync(dir, 0o755);
  });
});

describe("the page's calls", () => {
  test("files, the journal and change batches", async () => {
    const { s, home } = make();
    await s.setup({ kind: "device" });
    const batches: LibraryChange[][] = [];
    s.watch((c) => batches.push(c));
    const w = await s.write(`notes/${DOC}.fnote`, utf8("hello"), { ifMatch: null });
    expect("etag" in w).toBe(true);
    expect((await s.list("notes")).map((e) => e.path)).toEqual([`notes/${DOC}.fnote`]);
    await s.journal().append(utf8("edit 1"));
    expect((await s.journal().readAll()).map(text)).toEqual(["edit 1"]);
    await expect(s.remove("folevi-library.json")).rejects.toMatchObject({ code: "invalid_path" });
    // Our own write isn't echoed; another app's is.
    writeFileSync(join(defaultLocation("device", home), "notes", "01J9ZDOC000000000000000002.fnote"), "theirs");
    await s.rescan();
    expect(batches).toEqual([[{ path: "notes/01J9ZDOC000000000000000002.fnote", kind: "changed" }]]);
  });
});

describe("a library in iCloud Drive", () => {
  const binary = helperBinary();
  test.skipIf(!binary)("goes through folevi-files, and an upload finishing is reported as 'uploaded'", async () => {
    const files = new FilesHelper(binary!);
    let uploaded = false;
    const writes: string[] = [];
    // The real helper, with iCloud's upload state played by the test (a temporary folder isn't in iCloud).
    const coordinator: Coordinator = {
      read: (p) => files.read(p),
      write: (p, b, c) => (writes.push(p), files.write(p, b, c)),
      remove: (p, c) => files.remove(p, c),
      startDownload: (ps) => files.startDownload(ps),
      watch: (r, cb) => files.watch(r, cb),
      conflictVersions: (p) => files.conflictVersions(p),
      resolveConflicts: (p, ids) => files.resolveConflicts(p, ids),
      status: async (ps) => {
        const s = await files.status(ps);
        for (const p of ps) if (s[p]) Object.assign(s[p]!, { ubiquitous: true, uploaded });
        return s;
      },
    };
    const home = tempDir("folevi-home-");
    mkdirSync(iCloudDriveRoot(home), { recursive: true });
    const s = new LibraryService({ userData: tempDir(), home, helperPath: null, coordinator, chooseFolder: async () => null, sealer: fakeSealer, watch: { useFsEvents: false, scanIntervalMs: 200 } });
    services.push(s);
    try {
      await s.setup({ kind: "icloud" });
      const changes: LibraryChange[] = [];
      s.watch((c) => changes.push(...c));
      await s.write(`notes/${DOC}.fnote`, utf8("in the cloud"), {});
      expect(writes.some((w) => w.endsWith(`notes/${DOC}.fnote`))).toBe(true);
      await new Promise((r) => setTimeout(r, 400));
      uploaded = true;
      await waitFor(() => changes.some((c) => c.kind === "uploaded"), 8000, "the upload");
      expect(changes.filter((c) => c.kind === "uploaded").map((c) => c.path)).toContain(`notes/${DOC}.fnote`);
    } finally {
      s.dispose();
      files.close();
    }
  }, 20_000);
});

describe("encryption", () => {
  test("on, locked, unlocked, passphrase changed, off", async () => {
    const { s, home, userData } = make();
    await s.setup({ kind: "device" });
    const root = defaultLocation("device", home);
    await s.write(`notes/${DOC}.fnote`, utf8(JSON.stringify({ id: DOC, words: "secret plans" })), {});
    await s.write("index/library.findex", utf8("{}"), {});
    // Attachments are content addressed: the name is the bytes' SHA-256 (checked when an encrypted name is learnt).
    const ASHA = createHash("sha256").update("attachment bytes").digest("hex");
    await s.write(`files/${ASHA.slice(0, 2)}/${ASHA}`, utf8("attachment bytes"), {});
    await s.journal().append(utf8("kept"));

    await s.setPassphrase("correct horse");
    expect(await s.info()).toMatchObject({ encrypted: true, locked: false });
    const onDisk = readdirSync(join(root, "notes"));
    expect(onDisk.length).toBe(1);
    expect(onDisk[0]).toMatch(/^[0-9a-hjkmnp-tv-z]{26}\.fnote$/);
    expect(isEnvelope(readFileSync(join(root, "notes", onDisk[0]!)))).toBe(true);
    expect(isEnvelope(readFileSync(join(root, "index", "library.findex")))).toBe(true);
    expect(readFileSync(join(root, "notes", onDisk[0]!)).includes("secret")).toBe(false);
    // The page still sees plain names and bytes.
    const r = await s.read(`notes/${DOC}.fnote`);
    expect("bytes" in r && JSON.parse(text(r.bytes)).words).toBe("secret plans");
    expect((await s.list("")).map((e) => e.path).sort()).toEqual([`files/${ASHA.slice(0, 2)}/${ASHA}`, "folevi-library.json", "index/library.findex", `notes/${DOC}.fnote`]);

    // local-store's reference reads what the Mac wrote, given the key from the header.
    const manifest = decodeManifest(readFileSync(join(root, "folevi-library.json")));
    const key = await refUnlock(manifest.encryption as never, "correct horse");
    expect(key).not.toBeNull();
    const mem = new MemoryFs();
    for (const e of await new NodeFs({ root }).list("")) {
      const b = await new NodeFs({ root }).read(e.path);
      if ("bytes" in b) mem.put(e.path, b.bytes);
    }
    const ref = new EncryptedFs(mem, key!);
    expect(JSON.parse(text((await ref.read(`notes/${DOC}.fnote`) as { bytes: Uint8Array }).bytes)).words).toBe("secret plans");
    expect(text((await ref.read(`files/${ASHA.slice(0, 2)}/${ASHA}`) as { bytes: Uint8Array }).bytes)).toBe("attachment bytes");

    // A new start: the key comes back from safeStorage.
    const second = make({ home, userData }).s;
    await second.open();
    expect(await second.info()).toMatchObject({ encrypted: true, locked: false });
    // Without a cached key it's locked until the passphrase.
    second.lock();
    const third = make({ home, userData }).s;
    await third.open();
    expect(await third.info()).toMatchObject({ encrypted: true, locked: true });
    await expect(third.read(`notes/${DOC}.fnote`)).rejects.toMatchObject({ code: "locked" });
    expect(await third.unlock("wrong")).toBe(false);
    expect(await third.unlock("correct horse")).toBe(true);
    expect((await third.info()).locked).toBe(false);
    expect((await third.journal().readAll()).map(text)).toEqual(["kept"]);

    expect(await third.changePassphrase("wrong", "new one")).toBe(false);
    expect(await third.changePassphrase("correct horse", "new one")).toBe(true);
    expect(readdirSync(join(root, "notes"))).toEqual(onDisk); // only the key was rewrapped
    third.lock();
    expect(await third.unlock("correct horse")).toBe(false);
    expect(await third.unlock("new one")).toBe(true);

    await third.setPassphrase(null);
    expect(await third.info()).toMatchObject({ encrypted: false, locked: false });
    expect(readdirSync(join(root, "notes"))).toEqual([`${DOC}.fnote`]);
    expect(JSON.parse(readFileSync(join(root, "notes", `${DOC}.fnote`), "utf8")).words).toBe("secret plans");
    expect(readFileSync(join(root, "files", ASHA.slice(0, 2), ASHA), "utf8")).toBe("attachment bytes");
  });
});

describe("moving", () => {
  test("to a chosen folder: copied, checked, switched; the old copy stays", async () => {
    const target = tempDir();
    const { s, home } = make({ pick: target });
    await s.setup({ kind: "device" });
    for (let i = 0; i < 5; i++) await s.write(`notes/01J9ZDOC00000000000000000${i}.fnote`, utf8(`note ${i}`), {});
    const info = await s.move({ kind: "folder" });
    expect(info).toMatchObject({ kind: "folder", available: true });
    expect(readdirSync(join(target, "notes")).length).toBe(5);
    expect(existsSync(join(defaultLocation("device", home), "notes", "01J9ZDOC000000000000000000.fnote"))).toBe(true);
    const r = await s.read("notes/01J9ZDOC000000000000000003.fnote");
    expect("bytes" in r && text(r.bytes)).toBe("note 3");
    // The new place is used from now on.
    await s.write("notes/01J9ZDOC000000000000000009.fnote", utf8("new"), {});
    expect(existsSync(join(target, "notes", "01J9ZDOC000000000000000009.fnote"))).toBe(true);
  });

  test("a move that stopped part way finishes when asked again, skipping what arrived", async () => {
    const chosen = tempDir();
    // The chosen folder has other things in it, so the library goes into "Folevi Library" there.
    writeFileSync(join(chosen, "Taxes.pdf"), "x");
    const target = join(chosen, "Folevi Library");
    const { s } = make({ pick: chosen });
    await s.setup({ kind: "device" });
    for (let i = 0; i < 4; i++) await s.write(`notes/01J9ZDOC00000000000000000${i}.fnote`, utf8(`note ${i}`), {});
    // One file in the way can't be written yet (a folder where the last note should go).
    const blocker = join(target, "notes", "01J9ZDOC000000000000000003.fnote");
    mkdirSync(blocker, { recursive: true });
    await expect(s.move({ kind: "folder" })).rejects.toBeTruthy();
    // Still on the old place, and the library file (copied last) isn't in the new one yet.
    expect((await s.info()).kind).toBe("device");
    expect(existsSync(join(target, "folevi-library.json"))).toBe(false);
    const copied = readdirSync(join(target, "notes")).filter((n) => n !== "01J9ZDOC000000000000000003.fnote");
    expect(copied.length).toBe(3);
    const firstMtime = (await import("node:fs")).statSync(join(target, "notes", copied[0]!)).mtimeMs;
    rmSync(blocker, { recursive: true });
    await new Promise((r) => setTimeout(r, 20));
    expect(await s.move({ kind: "folder" })).toMatchObject({ kind: "folder" });
    expect(readdirSync(join(target, "notes")).length).toBe(4);
    // Files that had arrived whole weren't written again.
    expect((await import("node:fs")).statSync(join(target, "notes", copied[0]!)).mtimeMs).toBe(firstMtime);
  });

  test("not into a folder holding another library", async () => {
    const other = tempDir();
    const x = make({ pick: other });
    await x.s.setup({ kind: "folder" });
    const { s } = make({ pick: other });
    await s.setup({ kind: "device" });
    await expect(s.move({ kind: "folder" })).rejects.toMatchObject({ code: "target_has_library" });
  });
});

describe("attachments for app://folevi/_files", () => {
  const handlerFor = (s: LibraryService) => createAppHandler({ root: tempDir(), mode: () => "local", csp: { serviceOrigin: "https://app.folevi.com" }, files: s.files });
  const body = Buffer.alloc(300_000);
  for (let i = 0; i < body.length; i++) body[i] = i % 253;

  test.each([false, true])("encrypted %s: whole, by range, and missing", async (encrypted) => {
    const { s } = make();
    await s.setup({ kind: "device" });
    if (encrypted) await s.setPassphrase("pass");
    await s.write(`files/${SHA.slice(0, 2)}/${SHA}`, body, {});
    const handle = handlerFor(s);
    const whole = await handle(new Request(`app://folevi/_files/${SHA}?type=audio/mpeg`));
    expect(whole.status).toBe(200);
    expect(whole.headers.get("content-type")).toBe("audio/mpeg");
    expect(Buffer.from(await whole.arrayBuffer()).equals(body)).toBe(true);
    const part = await handle(new Request(`app://folevi/_files/${SHA}`, { headers: { range: "bytes=65530-131080" } }));
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe(`bytes 65530-131080/${body.length}`);
    expect(Buffer.from(await part.arrayBuffer()).equals(body.subarray(65530, 131081))).toBe(true);
    const tail = await handle(new Request(`app://folevi/_files/${SHA}`, { headers: { range: "bytes=-10" } }));
    expect(Buffer.from(await tail.arrayBuffer()).equals(body.subarray(body.length - 10))).toBe(true);
    expect((await handle(new Request(`app://folevi/_files/${"0".repeat(64)}`))).status).toBe(404);
  });

  test("a damaged encrypted attachment isn't served", async () => {
    const { s, home } = make();
    await s.setup({ kind: "device" });
    await s.setPassphrase("pass");
    await s.write(`files/${SHA.slice(0, 2)}/${SHA}`, body, {});
    const dir = join(defaultLocation("device", home), "files");
    const sub = readdirSync(dir)[0]!;
    const name = readdirSync(join(dir, sub))[0]!;
    // Cut short: the final chunk's flag is missing, so it can't pass as a shorter file.
    const full = readFileSync(join(dir, sub, name));
    writeFileSync(join(dir, sub, name), full.subarray(0, full.length - 100));
    expect((await handlerFor(s)(new Request(`app://folevi/_files/${SHA}`))).status).toBe(404);
    expect(sealStream(new Uint8Array(32), "x", new Uint8Array(1)).length).toBeGreaterThan(17);
  });

  test("a locked library serves nothing", async () => {
    const { s, home, userData } = make();
    await s.setup({ kind: "device" });
    await s.setPassphrase("pass");
    await s.write(`files/${SHA.slice(0, 2)}/${SHA}`, body, {});
    s.lock();
    const locked = make({ home, userData }).s;
    await locked.open();
    expect((await handlerFor(locked)(new Request(`app://folevi/_files/${SHA}`))).status).toBe(404);
  });
});
