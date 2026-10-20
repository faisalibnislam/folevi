// Paths, conflict-copy names, the LocalFs contract, read-merge-write and the rule that a file which can't
// be read and merged is never overwritten.
import { describe, expect, it } from "vitest";
import {
  EncryptedFs,
  HybridClock,
  MemoryFs,
  NoteReplica,
  attachmentPath,
  createManifest,
  createNote,
  decodeManifest,
  decodeNoteFile,
  encodeManifest,
  encodeNoteFile,
  isValidLibraryPath,
  notePath,
  noteCodec,
  parseNoteFileName,
  readMergeWrite,
  sealFile,
  setDocField,
  upsertBlock,
  utf8,
  writeOnce,
  type NoteFile,
  type NoteLike,
} from "../src";
import { DOC, para, textOf } from "./helpers";

const ULID = "01J9ZDOC000000000000000001";
const HMAC = "7k2m9q4r1t8v3w6x0y5z2a7b4c";

describe("conflict-copy names", () => {
  const table: [string, { id: string; provider: string | null; placeholder?: boolean } | null][] = [
    [`${ULID}.fnote`, { id: ULID, provider: null }],
    [`${ULID} (Faisal's conflicted copy 2026-10-20).fnote`, { id: ULID, provider: "dropbox" }],
    [
      `${ULID} (Faisal's MacBook Pro's conflicted copy 2026-10-20 (1)).fnote`,
      { id: ULID, provider: "dropbox" },
    ],
    [`${ULID} (Case Conflict).fnote`, { id: ULID, provider: "dropbox" }],
    [`${ULID} (Selective Sync Conflict).fnote`, { id: ULID, provider: "dropbox" }],
    [`${ULID} 2.fnote`, { id: ULID, provider: "icloud" }],
    [`${ULID} 13.fnote`, { id: ULID, provider: "icloud" }],
    [`${ULID}(1).fnote`, { id: ULID, provider: "numbered" }],
    [`${ULID} (2).fnote`, { id: ULID, provider: "numbered" }],
    [`${ULID}-MACBOOK.fnote`, { id: ULID, provider: "onedrive" }],
    [`${ULID}-DESKTOP-4F2K9.fnote`, { id: ULID, provider: "onedrive" }],
    [`${HMAC}.fnote`, { id: HMAC, provider: null }],
    [`${HMAC} 2.fnote`, { id: HMAC, provider: "icloud" }],
    [`${HMAC} (Faisal's conflicted copy 2026-10-20).fnote`, { id: HMAC, provider: "dropbox" }],
    [`${HMAC}-LAPTOP.fnote`, { id: HMAC, provider: "onedrive" }],
    [
      "daily-2026-10-20-0123456789abcdef.fnote",
      { id: "daily-2026-10-20-0123456789abcdef", provider: null },
    ],
    [
      "daily-2026-10-20-0123456789abcdef 2.fnote",
      { id: "daily-2026-10-20-0123456789abcdef", provider: "icloud" },
    ],
    [
      "daily-2026-10-20-0123456789abcdef-PC.fnote",
      { id: "daily-2026-10-20-0123456789abcdef", provider: "onedrive" },
    ],
    ["inbox-0123456789abcdef(1).fnote", { id: "inbox-0123456789abcdef", provider: "numbered" }],
    ["legacy_id-42.fnote", { id: "legacy_id-42", provider: null }],
    [`.${ULID}.fnote.icloud`, { id: ULID, provider: null, placeholder: true }],
    [`.${ULID} 2.fnote.icloud`, { id: ULID, provider: "icloud", placeholder: true }],
    [`${ULID}.fnote.tmp`, null],
    [`${ULID} copy.fnote`, null],
    [`${ULID}.txt`, null],
    [" leading.fnote", null],
    [".fnote", null],
  ];
  for (const [name, want] of table) {
    it(JSON.stringify(name), () => {
      const got = parseNoteFileName(name);
      if (want === null) expect(got).toBeNull();
      else
        expect({
          id: got?.id,
          provider: got?.copy?.provider ?? null,
          placeholder: got?.placeholder ?? false,
        }).toEqual({ placeholder: false, ...want });
    });
  }
});

describe("paths", () => {
  it("validates library paths like the bridge does", () => {
    for (const ok of [
      "notes/a.fnote",
      "files/ab/abcdef",
      "folevi-library.json",
      "history/x/y.fver",
    ])
      expect(isValidLibraryPath(ok)).toBe(true);
    for (const bad of [
      "",
      "/abs",
      "a/../b",
      "..",
      "a//b",
      "a/",
      "a\\b",
      "a/\u0000b",
      "a/\nb",
      "./a",
    ])
      expect(isValidLibraryPath(bad), JSON.stringify(bad)).toBe(false);
    expect(attachmentPath("9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08")).toBe(
      "files/9f/9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
    );
    expect(() => attachmentPath("../x")).toThrow();
  });

  it("round trips the manifest", () => {
    const m = createManifest("lib1", 123);
    expect(decodeManifest(encodeManifest(m))).toEqual(m);
    expect(() => decodeManifest(utf8("{}"))).toThrow();
  });
});

describe("MemoryFs (the LocalFs contract)", () => {
  it("implements ifMatch, create-only, conditional remove and conflict versions", async () => {
    const fs = new MemoryFs();
    await expect(fs.read("notes/x.fnote")).rejects.toMatchObject({ code: "not_found" });
    const w1 = await fs.write("notes/x.fnote", utf8("1"), { ifMatch: null });
    expect("etag" in w1 && !("mismatch" in w1)).toBe(true);
    expect(await fs.write("notes/x.fnote", utf8("2"), { ifMatch: null })).toMatchObject({
      mismatch: true,
    });
    expect(await fs.write("notes/x.fnote", utf8("2"), { ifMatch: "nope" })).toMatchObject({
      mismatch: true,
    });
    expect(await fs.write("notes/y.fnote", utf8("2"), { ifMatch: "nope" })).toEqual({
      mismatch: true,
      etag: "",
    });
    const etag = (w1 as { etag: string }).etag;
    const w2 = await fs.write("notes/x.fnote", utf8("2"), { ifMatch: etag });
    expect("mismatch" in w2).toBe(false);
    await expect(fs.remove("notes/x.fnote", { ifMatch: etag })).rejects.toMatchObject({
      code: "mismatch",
    });
    const v = fs.addConflictVersion("notes/x.fnote", utf8("other"));
    expect((await fs.list("notes"))[0]!.hasConflicts).toBe(true);
    expect((await fs.conflictVersions("notes/x.fnote")).map((c) => c.id)).toEqual([v]);
    await fs.resolveConflicts("notes/x.fnote", [v]);
    expect((await fs.list("notes"))[0]!.hasConflicts).toBe(false);
    fs.evict("notes/x.fnote");
    expect(await fs.read("notes/x.fnote")).toEqual({ notDownloaded: true });
    await expect(fs.write("../x", utf8("1"), {})).rejects.toMatchObject({ code: "invalid_path" });
    await fs.remove("notes/missing.fnote");
  });
});

function note(dev: string, now: number, title: string, text = "hello"): NoteFile {
  const c = new HybridClock(dev, { now: () => now });
  const n = createNote(DOC, { createdAt: 1, title }, c);
  return upsertBlock(n, para("B1", text), ["content", "position"], c);
}

describe("read-merge-write", () => {
  it("creates, merges and skips identical writes", async () => {
    const fs = new MemoryFs();
    const path = notePath(DOC);
    const a = note("A", 1000, "Trip");
    expect((await readMergeWrite(fs, path, noteCodec, a)).status).toBe("written");
    expect((await readMergeWrite(fs, path, noteCodec, a)).status).toBe("unchanged");
    const b = note("B", 2000, "Trip", "from B");
    const r = await readMergeWrite(fs, path, noteCodec, b);
    expect(r.status).toBe("written");
    const onDisk = decodeNoteFile(fs.peek(path)!) as NoteFile;
    expect(Object.keys(onDisk.seen).sort()).toEqual(["A", "B"]);
  });

  it("re-reads and merges again when another writer got in between", async () => {
    const fs = new MemoryFs();
    const path = notePath(DOC);
    await readMergeWrite(fs, path, noteCodec, note("A", 1000, "Trip"));
    let raced = false;
    const racing = {
      ...fs,
      list: fs.list.bind(fs),
      read: fs.read.bind(fs),
      remove: fs.remove.bind(fs),
      conflictVersions: fs.conflictVersions.bind(fs),
      resolveConflicts: fs.resolveConflicts.bind(fs),
      write: async (p: string, bytes: Uint8Array, o: { ifMatch?: string | null }) => {
        if (!raced) {
          raced = true;
          fs.put(p, encodeNoteFile(note("C", 1500, "Trip", "from C")));
        }
        return fs.write(p, bytes, o);
      },
    };
    const r = await readMergeWrite(racing, path, noteCodec, note("B", 2000, "Trip", "from B"));
    expect(r).toMatchObject({ status: "written", attempts: 2 });
    expect(Object.keys((decodeNoteFile(fs.peek(path)!) as NoteFile).seen).sort()).toEqual([
      "B",
      "C",
    ]);
  });

  it("never overwrites a partial, damaged or newer-format file", async () => {
    const fs = new MemoryFs();
    const path = notePath(DOC);
    const full = encodeNoteFile(note("A", 1000, "Trip"));
    const cases: [string, Uint8Array][] = [
      ["partial", full.slice(0, Math.floor(full.length / 2))],
      ["empty", new Uint8Array(0)],
      ["damaged", utf8(new TextDecoder().decode(full).replace("hello", "jello"))],
      ["newer format", utf8(new TextDecoder().decode(full).replace('"v":1', '"v":9'))],
      ["encrypted with another key", await sealFile(new Uint8Array(32), path, full)],
    ];
    for (const [name, bytes] of cases) {
      fs.put(path, bytes);
      const etag = fs.etagOf(path);
      const r = await readMergeWrite(fs, path, noteCodec, note("B", 2000, "Mine"));
      expect(r.status, name).toBe("unreadable");
      expect(fs.peek(path), name).toEqual(bytes);
      expect(fs.etagOf(path), name).toBe(etag);
    }
  });

  it("leaves placeholders alone", async () => {
    const fs = new MemoryFs();
    const path = notePath(DOC);
    fs.put(path, encodeNoteFile(note("A", 1000, "Trip")));
    fs.evict(path);
    expect((await readMergeWrite(fs, path, noteCodec, note("B", 2000, "Mine"))).status).toBe(
      "notDownloaded",
    );
  });

  it("writes immutable files once", async () => {
    const fs = new MemoryFs();
    expect(await writeOnce(fs, "history/x/a.fver", utf8("1"))).toBe("written");
    expect(await writeOnce(fs, "history/x/a.fver", utf8("2"))).toBe("exists");
    expect(fs.peek("history/x/a.fver")).toEqual(utf8("1"));
  });
});

describe("NoteReplica", () => {
  it("merges conflict copies and conflict versions, then cleans them up after a successful write", async () => {
    const fs = new MemoryFs();
    const clock = new HybridClock("A", { now: () => 5000 });
    const r = new NoteReplica(fs, clock);
    const base = note("A", 1000, "Trip");
    fs.put(notePath(DOC), encodeNoteFile(base));
    fs.put(
      `notes/${DOC} (B's conflicted copy 2026-10-20).fnote`,
      encodeNoteFile(note("B", 2000, "Trip", "from B")),
    );
    fs.put(`notes/${DOC} 2.fnote`, encodeNoteFile(note("C", 3000, "Trip", "from C")));
    fs.addConflictVersion(notePath(DOC), encodeNoteFile(note("D", 4000, "Trip", "from D")));
    const report = await r.sync();
    expect(report.copiesMerged.sort()).toEqual([
      `notes/${DOC} (B's conflicted copy 2026-10-20).fnote`,
      `notes/${DOC} 2.fnote`,
    ]);
    expect(fs.paths().filter((p) => p.startsWith("notes/"))).toEqual([notePath(DOC)]);
    expect((await fs.list("notes"))[0]!.hasConflicts).toBe(false);
    const merged = decodeNoteFile(fs.peek(notePath(DOC))!) as NoteFile;
    expect(Object.keys(merged.seen).sort()).toEqual(["A", "B", "C", "D"]);
    // Each concurrent loser went to history first.
    expect(textOf(merged, "B1")).toBe("from D");
    const history = fs.paths().filter((p) => p.startsWith("history/"));
    expect(history.length).toBe(3);
    expect(
      Object.values(merged.notices).every((n) => history.some((h) => h.endsWith(n.version!))),
    ).toBe(true);
  });

  it("keeps a copy that couldn't be read, and never overwrites an unreadable canonical file", async () => {
    const fs = new MemoryFs();
    const r = new NoteReplica(fs, new HybridClock("A", { now: () => 5000 }));
    const full = encodeNoteFile(note("B", 1000, "Theirs"));
    fs.put(notePath(DOC), full.slice(0, 40));
    fs.put(`notes/${DOC} 2.fnote`, full.slice(0, 10));
    r.edit(DOC, () => note("A", 2000, "Mine"));
    const report = await r.sync();
    expect(report.health.map((h) => h.problem)).toEqual(["unreadable", "unreadable", "unreadable"]);
    expect(fs.peek(notePath(DOC))).toEqual(full.slice(0, 40));
    expect(fs.peek(`notes/${DOC} 2.fnote`)).toEqual(full.slice(0, 10));
    // Once the whole file arrives, both sides merge.
    fs.put(notePath(DOC), full);
    fs.delete(`notes/${DOC} 2.fnote`);
    await r.sync();
    expect(Object.keys((decodeNoteFile(fs.peek(notePath(DOC))!) as NoteFile).seen).sort()).toEqual([
      "A",
      "B",
    ]);
  });

  it("re-asserts local changes a provider dropped (anti-entropy)", async () => {
    const fs = new MemoryFs();
    const clock = new HybridClock("A", { now: () => 5000 });
    const r = new NoteReplica(fs, clock);
    r.edit(DOC, () => note("A", 1000, "Mine"));
    await r.sync();
    const theirs = note("B", 900, "Theirs", "B only");
    fs.put(notePath(DOC), encodeNoteFile(theirs)); // a lost update: B's version replaced ours without merging
    await r.sync();
    const onDisk = decodeNoteFile(fs.peek(notePath(DOC))!) as NoteFile;
    expect(Object.keys(onDisk.seen).sort()).toEqual(["A", "B"]);
  });

  it("works through EncryptedFs with HMAC names on disk", async () => {
    const disk = new MemoryFs();
    const key = new Uint8Array(32).fill(3);
    const fs = new EncryptedFs(disk, key);
    const r = new NoteReplica(fs, new HybridClock("A", { now: () => 5000 }));
    r.edit(
      DOC,
      (n?: NoteLike) =>
        n ??
        setDocField(
          note("A", 1000, "Secret trip"),
          "title",
          "Secret trip",
          new HybridClock("A", { now: () => 1001 }),
        ),
    );
    await r.sync();
    const paths = disk.paths();
    expect(paths.length).toBe(1);
    expect(paths[0]).toMatch(/^notes\/[0-9a-hjkmnp-tv-z]{26}\.fnote$/);
    expect(new TextDecoder().decode(disk.peek(paths[0]!)!)).not.toContain("Secret");
    // A second device with the same key reads it back (and learns the name by decrypting).
    const r2 = new NoteReplica(
      new EncryptedFs(disk, key),
      new HybridClock("B", { now: () => 6000 }),
    );
    await r2.sync();
    expect((r2.notes.get(DOC) as NoteFile).doc.title!.v).toBe("Secret trip");
    // A wrong key reads nothing and writes nothing.
    const r3 = new NoteReplica(
      new EncryptedFs(disk, new Uint8Array(32).fill(9)),
      new HybridClock("C", { now: () => 7000 }),
    );
    const before = disk.peek(paths[0]!);
    const report = await r3.sync();
    expect(r3.notes.size).toBe(0);
    expect(report.written).toEqual([]);
    expect(disk.peek(paths[0]!)).toEqual(before);
  });
});
