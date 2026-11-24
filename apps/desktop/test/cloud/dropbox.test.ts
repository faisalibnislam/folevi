// DropboxFs against the fake Dropbox: the shared LocalFs contract, then what is Dropbox's own (strict write
// modes, the cursor and its reset, longpoll, deleted folders, case, sessions resuming at correct_offset).
import { describe, expect, test } from "vitest";
import { apiArg } from "../../src/library/cloud/shared/dropbox";
import { runContract } from "./contract";
import { FakeDropbox } from "./fakeDropbox";
import { dropboxDevice, SMALL_UPLOADS } from "./harness";
import { NO_FAKE_FAULTS } from "./fakeCommon";

const enc = (s: string) => new TextEncoder().encode(s);
const NOTE = "notes/01J9ZDOC000000000000000001.fnote";

runContract("Dropbox", () => {
  const fake = new FakeDropbox({ seed: 5, pageSize: 2 });
  return {
    device: (mirror) => dropboxDevice(fake, { ...SMALL_UPLOADS.dropbox, ...(mirror ? { mirror } : {}) }),
    cloudFile: (p) => fake.file(p),
    setFaults: (f) => (fake.faults = { ...NO_FAKE_FAULTS, ...f }),
    settle: () => fake.settle(),
    downloads: () => fake.routes.get("/2/files/download") ?? 0,
  };
});

describe("Dropbox specifics", () => {
  test("uploads use update mode with the rev, strictly", async () => {
    const fake = new FakeDropbox();
    const { fs } = dropboxDevice(fake);
    const w = (await fs.write(NOTE, enc("a"), { ifMatch: null })) as { etag: string };
    expect(w.etag).toBe(fake.revOf(NOTE));
    // Identical bytes with add mode is still "exists" (strict), never a silent success.
    expect(await fs.write(NOTE, enc("a"), { ifMatch: null })).toEqual({ mismatch: true, etag: w.etag });
    // A delete in between makes an update a conflict, not a re-create.
    fake.remove(NOTE);
    expect(await fs.write(NOTE, enc("b"), { ifMatch: w.etag })).toEqual({ mismatch: true, etag: "" });
    expect(fake.file(NOTE)).toBeUndefined();
  });

  test("the cursor: only changes after the first listing; a reset lists everything again", async () => {
    const fake = new FakeDropbox({ pageSize: 3 });
    for (let i = 0; i < 8; i++) fake.put(`notes/01J9ZDOC00000000000000000${i}.fnote`, enc(`n${i}`));
    const { fs } = dropboxDevice(fake);
    expect((await fs.list("notes")).length).toBe(8);
    const fullListings = fake.routes.get("/2/files/list_folder");
    fake.put(`notes/01J9ZDOC000000000000000009.fnote`, enc("n9"));
    fake.remove("notes/01J9ZDOC000000000000000000.fnote");
    const changes = await fs.refresh();
    expect(changes).toEqual(
      expect.arrayContaining([
        { path: "notes/01J9ZDOC000000000000000009.fnote", kind: "changed" },
        { path: "notes/01J9ZDOC000000000000000000.fnote", kind: "removed" },
      ]),
    );
    expect(fake.routes.get("/2/files/list_folder")).toBe(fullListings);
    fake.resetCursors();
    fake.put(`notes/01J9ZDOC00000000000000000A.fnote`, enc("nA"));
    const after = await fs.list("notes");
    expect(after.length).toBe(9);
    expect(fake.routes.get("/2/files/list_folder")).toBe(fullListings! + 1);
  });

  test("a deleted folder removes everything in it", async () => {
    const fake = new FakeDropbox();
    const { fs } = dropboxDevice(fake);
    await fs.write("history/01J9ZDOC000000000000000001/a.fver", enc("1"), { ifMatch: null });
    await fs.write("history/01J9ZDOC000000000000000001/b.fver", enc("2"), { ifMatch: null });
    await fs.write(NOTE, enc("n"), { ifMatch: null });
    await fs.list("");
    // Dropbox reports one deleted entry for the folder.
    (fake as unknown as { files: Map<string, unknown> }).files.delete("/history/01j9zdoc000000000000000001/a.fver");
    (fake as unknown as { files: Map<string, unknown> }).files.delete("/history/01j9zdoc000000000000000001/b.fver");
    (fake as unknown as { record(l: string, f: null): void }).record("/history/01j9zdoc000000000000000001", null);
    expect((await fs.list("")).map((e) => e.path)).toEqual([NOTE]);
  });

  test("longpoll wakes the watch loop; it runs without the access token", async () => {
    const fake = new FakeDropbox();
    const { fs } = dropboxDevice(fake, { longpollSeconds: 30 });
    await fs.list("");
    const seen: string[] = [];
    const errors: unknown[] = [];
    const handle = fs.watch(
      (changes) => seen.push(...changes.map((c) => `${c.kind} ${c.path}`)),
      (e) => errors.push(e),
    );
    await new Promise((r) => setTimeout(r, 20));
    fake.put(NOTE, enc("from elsewhere"));
    for (let i = 0; i < 50 && !seen.length; i++) await new Promise((r) => setTimeout(r, 10));
    handle.stop();
    await handle.done;
    expect(seen).toEqual([`changed ${NOTE}`]);
    expect(errors).toEqual([]);
    expect(fake.routes.get("/2/files/list_folder/longpoll")).toBeGreaterThan(0);
  });

  test("an upload session resumes at Dropbox's correct_offset", async () => {
    const fake = new FakeDropbox({ seed: 9 });
    const { fs, injector } = dropboxDevice(fake, { singleUploadMax: 100, chunkSize: 64 });
    fake.faults = { ...NO_FAKE_FAULTS, partial: 0.6 };
    const big = enc("x".repeat(1000));
    await fs.write("files/aa/aa0123456789abcdef", big, {});
    fake.faults = NO_FAKE_FAULTS;
    expect(injector.stats.partial).toBeGreaterThan(0);
    expect(fake.file("files/aa/aa0123456789abcdef")).toEqual(big);
    expect(fake.routes.get("/2/files/upload_session/append_v2")).toBeGreaterThan(10);
  });

  test("a cut-off download is never taken as the file", async () => {
    const fake = new FakeDropbox({ seed: 3 });
    const a = dropboxDevice(fake).fs;
    await a.write(NOTE, enc("a whole note"), { ifMatch: null });
    const { fs } = dropboxDevice(fake);
    fake.faults = { ...NO_FAKE_FAULTS, partial: 1 };
    await expect(fs.read(NOTE)).rejects.toMatchObject({ code: "unreadable" });
    fake.faults = NO_FAKE_FAULTS;
    const r = await fs.read(NOTE);
    expect("bytes" in r && new TextDecoder().decode(r.bytes)).toBe("a whole note");
  });

  test("Dropbox-API-Arg escapes everything outside ASCII", () => {
    expect(apiArg({ path: "/notes/café ✓" })).toBe('{"path":"/notes/caf\\u00e9 \\u2713"}');
  });
});
