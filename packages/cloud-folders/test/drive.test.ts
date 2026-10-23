// DriveFs against the fake Drive: the shared LocalFs contract, then what is Drive's own (the Folevi folder,
// twins from concurrent creates, the check-then-upload race and its recovery, page tokens, resumable uploads,
// 403 rate limits, trash).
import { describe, expect, test } from "vitest";
import { numberedCopy, parseDriveEtag } from "../src/drive";
import { runContract } from "./contract";
import { NO_FAKE_FAULTS } from "./fakeCommon";
import { FakeDrive } from "./fakeDrive";
import { driveDevice, SMALL_UPLOADS } from "./harness";

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);
const NOTE = "notes/01J9ZDOC000000000000000001.fnote";

runContract("Google Drive", () => {
  const fake = new FakeDrive({ seed: 5, pageSize: 2, chunkMultiple: 1024 });
  return {
    device: (mirror) => driveDevice(fake, { ...SMALL_UPLOADS.drive, ...(mirror ? { mirror } : {}) }),
    cloudFile: (p) => fake.file(p),
    setFaults: (f) => (fake.faults = { ...NO_FAKE_FAULTS, ...f }),
    settle: () => fake.settle(),
    downloads: () => fake.routes.get("GET www.googleapis.com/drive/v3/files/:id?alt=media") ?? 0,
  };
});

describe("Google Drive specifics", () => {
  test("one Folevi folder, marked, in My Drive; the tree is real folders", async () => {
    const fake = new FakeDrive();
    const { fs } = driveDevice(fake);
    await fs.write(NOTE, enc("n"), { ifMatch: null });
    await fs.write("history/01J9ZDOC000000000000000001/a.fver", enc("v"), { ifMatch: null });
    const roots = fake.roots();
    expect(roots.length).toBe(1);
    expect(roots[0]).toMatchObject({ name: "Folevi", parents: ["root"], appProperties: { folevi: "library" } });
    const folders = [...fake.items.values()].filter((i) => i.mimeType.endsWith("folder")).map((i) => i.name).sort();
    expect(folders).toEqual(["01J9ZDOC000000000000000001", "Folevi", "history", "notes"]);
    const etag = (await fs.list("notes"))[0]!.etag;
    const parsed = parseDriveEtag(etag)!;
    expect(fake.items.get(parsed.id)!.revisions.at(-1)!.id).toBe(parsed.head);
  });

  test("two devices creating the library at once: both folders count, nothing is lost", async () => {
    const fake = new FakeDrive({ seed: 2 });
    const a = driveDevice(fake).fs;
    const b = driveDevice(fake).fs;
    // Both looked before either created anything.
    await a.list("");
    await b.list("");
    fake.faults = { ...NO_FAKE_FAULTS, lag: 1 };
    await a.write(NOTE, enc("from a"), { ifMatch: null });
    await b.write("notes/01J9ZDOC000000000000000002.fnote", enc("from b"), { ifMatch: null });
    fake.settle();
    expect(fake.roots().length).toBe(2);
    const seen = (await a.list("notes")).map((e) => e.path);
    expect(seen).toEqual([NOTE, "notes/01J9ZDOC000000000000000002.fnote"]);
    expect((await b.list("notes")).map((e) => e.path)).toEqual(seen);
    // New files go into the oldest twin.
    await b.write("notes/01J9ZDOC000000000000000003.fnote", enc("third"), { ifMatch: null });
    const oldest = fake.roots().sort((x, y) => x.createdTime.localeCompare(y.createdTime))[0]!;
    const notesInOldest = [...fake.items.values()].find((i) => i.name === "notes" && i.parents[0] === oldest.id)!;
    const third = [...fake.items.values()].find((i) => i.name === "01J9ZDOC000000000000000003.fnote")!;
    expect(third.parents).toEqual([notesInOldest.id]);
  });

  test("a create race: the later device sees the earlier file and steps back", async () => {
    const fake = new FakeDrive({ seed: 4 });
    const a = driveDevice(fake).fs;
    const b = driveDevice(fake).fs;
    await a.write("notes/01J9ZDOC000000000000000009.fnote", enc("x"), { ifMatch: null }); // the folders exist
    await b.list("");
    fake.faults = { ...NO_FAKE_FAULTS, lag: 1 }; // b's index won't show a's file
    const wa = (await a.write(NOTE, enc("from a"), { ifMatch: null })) as { etag: string };
    fake.settle(); // ...but Drive's name query does by the time b checks
    const wb = await b.write(NOTE, enc("from b"), { ifMatch: null });
    expect(wb).toMatchObject({ mismatch: true, etag: wa.etag });
    expect(dec(fake.file(NOTE)!)).toBe("from a");
    expect(fake.libraryFiles().get(NOTE)!.length).toBe(1);
  });

  test("twins the query didn't catch are listed as numbered copies, and go once removed", async () => {
    const fake = new FakeDrive({ seed: 6 });
    const a = driveDevice(fake).fs;
    await a.write(NOTE, enc("first"), { ifMatch: null });
    // Another client made a second file with the same name in the same folder.
    const notes = [...fake.items.values()].find((i) => i.name === "notes")!;
    const extra = (fake as unknown as { create(m: object, b: Uint8Array): { id: string } }).create({ name: "01J9ZDOC000000000000000001.fnote", parents: [notes.id] }, enc("second"));
    const list = await a.list("notes");
    expect(numberedCopy(NOTE, 1)).toBe("notes/01J9ZDOC000000000000000001(1).fnote");
    expect(list.map((e) => e.path).sort()).toEqual([NOTE, numberedCopy(NOTE, 1)].sort());
    const copy = list.find((e) => e.path === numberedCopy(NOTE, 1))!;
    expect(parseDriveEtag(copy.etag)!.id).toBe(extra.id);
    const r = await a.read(copy.path);
    expect("bytes" in r && dec(r.bytes)).toBe("second");
    await a.remove(copy.path, { ifMatch: copy.etag });
    expect(fake.items.get(extra.id)!.trashed).toBe(true);
    expect((await a.list("notes")).map((e) => e.path)).toEqual([NOTE]);
  });

  test("the check-then-upload race: the replaced revision comes back as a conflict version", async () => {
    const fake = new FakeDrive({ seed: 8 });
    const a = driveDevice(fake);
    const w = (await a.fs.write(NOTE, enc("base"), { ifMatch: null })) as { etag: string };
    const id = parseDriveEtag(w.etag)!.id;
    // Another device's upload lands between a's check and a's upload.
    const realFetch = a.http as unknown as { fetchImpl: typeof fetch };
    const inner = realFetch.fetchImpl;
    realFetch.fetchImpl = (async (url: string, init?: RequestInit) => {
      if (String(url).includes("uploadType=media")) fake.overwrite(id, enc("other device"));
      return inner(url, init);
    }) as typeof fetch;
    const mine = await a.fs.write(NOTE, enc("mine"), { ifMatch: w.etag });
    realFetch.fetchImpl = inner;
    expect("mismatch" in mine).toBe(false);
    expect(dec(fake.file(NOTE)!)).toBe("mine");
    const entry = (await a.fs.list("notes"))[0]!;
    expect(entry.hasConflicts).toBe(true);
    const versions = await a.fs.conflictVersions(NOTE);
    expect(versions.map((v) => dec(v.bytes))).toEqual(["other device"]);
    await a.fs.resolveConflicts(NOTE, versions.map((v) => v.id));
    expect((await a.fs.list("notes"))[0]!.hasConflicts).toBe(false);
  });

  test("page tokens: only changes after the first listing; a refused token lists everything again", async () => {
    const fake = new FakeDrive({ pageSize: 2 });
    const a = driveDevice(fake).fs;
    for (let i = 0; i < 5; i++) await a.write(`notes/01J9ZDOC00000000000000000${i}.fnote`, enc(`n${i}`), { ifMatch: null });
    const b = driveDevice(fake).fs;
    expect((await b.list("notes")).length).toBe(5);
    const listings = fake.routes.get("GET www.googleapis.com/drive/v3/files") ?? 0;
    expect(listings).toBeGreaterThan(0);
    await a.remove("notes/01J9ZDOC000000000000000000.fnote");
    await a.write("notes/01J9ZDOC000000000000000001.fnote", enc("changed"), {});
    const changes = await b.refresh();
    expect(changes).toEqual(
      expect.arrayContaining([
        { path: "notes/01J9ZDOC000000000000000000.fnote", kind: "removed" },
        { path: "notes/01J9ZDOC000000000000000001.fnote", kind: "changed" },
      ]),
    );
    expect(fake.routes.get("GET www.googleapis.com/drive/v3/files") ?? 0).toBe(listings);
    // A token Drive no longer accepts.
    (b as unknown as { pageToken: string }).pageToken = "bogus";
    expect((await b.list("notes")).length).toBe(4);
  });

  test("403 userRateLimitExceeded is a rate limit, retried", async () => {
    const fake = new FakeDrive({ seed: 12 });
    const { fs, injector } = driveDevice(fake);
    fake.faults = { ...NO_FAKE_FAULTS, rateLimit: 0.5 };
    for (let i = 0; i < 6; i++) await fs.write(`notes/01J9ZDOC00000000000000000${i}.fnote`, enc("x"), {});
    fake.faults = NO_FAKE_FAULTS;
    expect(injector.stats.rateLimited).toBeGreaterThan(0);
    expect(fake.paths().length).toBe(6);
  });

  test("resumable uploads resume from Drive's Range after a cut-off chunk", async () => {
    const fake = new FakeDrive({ seed: 3, chunkMultiple: 256 });
    const { fs, injector } = driveDevice(fake, { simpleUploadMax: 100, chunkSize: 256 });
    const big = new Uint8Array(3000).map((_, i) => i % 256);
    fake.faults = { ...NO_FAKE_FAULTS, partial: 0.7 };
    await fs.write("files/bb/bb0123456789abcdef", big, { ifMatch: null });
    await fs.write("files/bb/bb0123456789abcdef", big.map((b) => 255 - b), {});
    fake.faults = NO_FAKE_FAULTS;
    expect(injector.stats.partial).toBeGreaterThan(0);
    expect(fake.file("files/bb/bb0123456789abcdef")).toEqual(big.map((b) => 255 - b));
  });

  test("deletes go to the trash", async () => {
    const fake = new FakeDrive();
    const { fs } = driveDevice(fake);
    await fs.write(NOTE, enc("bye"), { ifMatch: null });
    await fs.remove(NOTE);
    const item = [...fake.items.values()].find((i) => i.name === "01J9ZDOC000000000000000001.fnote")!;
    expect(item.trashed).toBe(true);
    expect(item.revisions.at(-1)!.bytes).toEqual(enc("bye"));
  });
});
