// Clocks, version vectors, the note file codec, history, the index, catalogs, attachments, compaction
// and the journal.
import { createHash } from "node:crypto";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  HybridClock,
  MAX_FORWARD_DRIFT_MS,
  MemoryJournal,
  NoteFileError,
  addTag,
  appendRecord,
  buildCatalog,
  canCompactTombstone,
  compactTombstones,
  compareHlc,
  compareVv,
  conflictVersionName,
  coveredPrefix,
  createNote,
  decodeIndex,
  decodeNoteFile,
  decodeVersionFile,
  deleteBlock,
  diffNote,
  emptyIndex,
  encodeIndex,
  encodeJournalRecord,
  encodeNoteFile,
  encodeVersionFile,
  formatHlc,
  gcEligible,
  hlcMs,
  hlcSuccessor,
  isHlc,
  liveFolders,
  makeStub,
  mergeIndex,
  mergeNoteFiles,
  mergeVv,
  noteSum,
  parseHlc,
  parseVersionFileName,
  readRecords,
  recordDeletedNote,
  replayJournal,
  resolveCatalog,
  setDocField,
  setFile,
  setFolderField,
  setSetting,
  setTagField,
  sha256Hex,
  snapshotVersion,
  stubExpired,
  thinVersions,
  trackUnreferenced,
  missingAttachments,
  upsertBlock,
  utf8,
  versionFileName,
  type DeviceRecord,
  type IndexFile,
  type NoteFile,
  type NoteLike,
} from "../src";
import { DOC, para } from "./helpers";

const DAY = 24 * 3_600_000;

function device(id: string, heads: Record<string, string>): DeviceRecord {
  return {
    format: "folevi-device",
    v: 1,
    deviceId: id,
    name: id,
    platform: "mac",
    appVersion: "1",
    formatVersion: 1,
    lastSeen: 0,
    heads,
  };
}

describe("hlc", () => {
  it("formats fixed width, parses back and orders as strings", () => {
    const h = formatHlc({ ms: 1_760_000_000_000, counter: 5, deviceId: "Mac1" });
    expect(h).toMatch(/^[0-9a-z]{9}-[0-9a-z]{4}-Mac1$/);
    expect(parseHlc(h)).toEqual({ ms: 1_760_000_000_000, counter: 5, deviceId: "Mac1" });
    expect(
      compareHlc(
        formatHlc({ ms: 9, counter: 0, deviceId: "Z" }),
        formatHlc({ ms: 10, counter: 0, deviceId: "A" }),
      ),
    ).toBe(-1);
    expect(
      compareHlc(
        formatHlc({ ms: 10, counter: 0, deviceId: "A" }),
        formatHlc({ ms: 10, counter: 0, deviceId: "B" }),
      ),
    ).toBe(-1);
    expect(compareHlc(null, h)).toBe(-1);
    expect(() => parseHlc("nope")).toThrow();
    expect(() => formatHlc({ ms: 1, counter: 0, deviceId: "has-dash" })).toThrow();
    expect(isHlc(h)).toBe(true);
  });

  it("ticks strictly increase, even when the wall clock stalls or goes back", () => {
    let now = 1000;
    const c = new HybridClock("A", { now: () => now });
    const seen: string[] = [];
    for (let i = 0; i < 50; i++) {
      if (i % 7 === 0) now -= 3;
      seen.push(c.tick());
    }
    for (let i = 1; i < seen.length; i++) expect(seen[i]! > seen[i - 1]!).toBe(true);
  });

  it("orders local stamps after received ones, within the drift cap", () => {
    const now = 1_000_000;
    const c = new HybridClock("A", { now: () => now });
    const remote = formatHlc({ ms: now + 60_000, counter: 3, deviceId: "B" });
    c.receive(remote);
    expect(c.tick() > remote).toBe(true);
  });

  it("caps forward drift and reports skew, but accepts the remote clock", () => {
    const now = 1_000_000;
    const reports: { aheadMs: number; severe: boolean }[] = [];
    const c = new HybridClock("A", { now: () => now, onSkew: (r) => reports.push(r) });
    const remote = formatHlc({ ms: now + 2 * DAY, counter: 0, deviceId: "B" });
    c.receive(remote);
    const t = c.tick();
    expect(hlcMs(t)).toBeLessThanOrEqual(now + MAX_FORWARD_DRIFT_MS);
    expect(t < remote).toBe(true);
    expect(reports).toEqual([{ remote, aheadMs: 2 * DAY, severe: true }]);
    // tickAfter still beats an observed stamp when a register needs it.
    expect(c.tickAfter(remote) > remote).toBe(true);
    expect(hlcSuccessor(remote, "A") > remote).toBe(true);
  });

  it("resumes from the last persisted stamp", () => {
    const a = new HybridClock("A", { now: () => 5 });
    const last = a.tick();
    const b = new HybridClock("A", { now: () => 1, last });
    expect(b.tick() > last).toBe(true);
  });
});

describe("version vectors", () => {
  const vv = fc.dictionary(
    fc.constantFrom("A", "B", "C"),
    fc.integer({ min: 0, max: 50 }).map((n) => formatHlc({ ms: n, counter: 0, deviceId: "A" })),
  );
  it("merge is a join (commutative, associative, idempotent, an upper bound)", () => {
    fc.assert(
      fc.property(vv, vv, vv, (a, b, c) => {
        expect(mergeVv(a, b)).toEqual(mergeVv(b, a));
        expect(mergeVv(mergeVv(a, b), c)).toEqual(mergeVv(a, mergeVv(b, c)));
        expect(mergeVv(a, a)).toEqual(mergeVv(a, {}));
        const m = mergeVv(a, b);
        expect(["after", "equal"]).toContain(compareVv(m, a));
        expect(["after", "equal"]).toContain(compareVv(m, b));
      }),
    );
  });
  it("compares", () => {
    const t = (n: number) => formatHlc({ ms: n, counter: 0, deviceId: "A" });
    expect(compareVv({ A: t(2) }, { A: t(1) })).toBe("after");
    expect(compareVv({ A: t(1) }, { A: t(1), B: t(1) })).toBe("before");
    expect(compareVv({ A: t(2) }, { B: t(1) })).toBe("concurrent");
    expect(compareVv({}, {})).toBe("equal");
  });
});

describe("sha256", () => {
  it("matches node:crypto", () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 300 }), (bytes) => {
        expect(sha256Hex(bytes)).toBe(createHash("sha256").update(bytes).digest("hex"));
      }),
    );
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });
});

function sample(): NoteFile {
  const c = new HybridClock("A", { now: () => 1000 });
  let n = createNote(DOC, { createdAt: 1000, title: "Trip" }, c);
  n = upsertBlock(
    n,
    para("B1", "hello", { props: { collapsed: true } }),
    ["content", "position"],
    c,
  );
  return addTag(n, "T1", c);
}

describe("note file", () => {
  it("round trips through canonical bytes with a checksum", () => {
    const note = sample();
    const bytes = encodeNoteFile(note);
    const back = decodeNoteFile(bytes) as NoteFile;
    expect(noteSum(back)).toBe(noteSum(note));
    expect(back.sum).toBe(noteSum(note));
    expect(encodeNoteFile(back)).toEqual(bytes);
    // collapsed lives outside props.
    expect(back.blocks.B1!.props).toEqual({});
    expect(back.blocks.B1!.collapsed).toBe(true);
  });

  it("gives clear errors and never a partial note", () => {
    const bytes = encodeNoteFile(sample());
    const code = (b: Uint8Array) => {
      try {
        decodeNoteFile(b);
        return "ok";
      } catch (e) {
        expect(e).toBeInstanceOf(NoteFileError);
        return (e as NoteFileError).code;
      }
    };
    for (let cut = 1; cut < bytes.length; cut += Math.max(1, Math.floor(bytes.length / 40)))
      expect(code(bytes.slice(0, cut))).not.toBe("ok");
    expect(code(new Uint8Array([0xff, 0xfe]))).toBe("not_utf8");
    expect(code(utf8("{"))).toBe("not_json");
    expect(code(utf8('{"format":"other"}'))).toBe("wrong_format");
    expect(code(utf8(new TextDecoder().decode(bytes).replace('"v":1', '"v":2')))).toBe(
      "unsupported_version",
    );
    expect(code(utf8(new TextDecoder().decode(bytes).replace("hello", "hellO")))).toBe("bad_sum");
    const invalid = { ...sample(), blocks: { "bad id!": sample().blocks.B1! } };
    expect(code(encodeNoteFile(invalid))).toBe("invalid");
  });

  it("stubs keep what the note had seen", () => {
    const note = sample();
    const stub = makeStub(note, formatHlc({ ms: 5000, counter: 0, deviceId: "B" }));
    expect(stub.seen.A).toBe(note.seen.A);
    expect(stub.seen.B).toBeDefined();
    expect(decodeNoteFile(encodeNoteFile(stub))).toEqual({ ...stub, sum: noteSum(stub) });
    expect(stubExpired(stub, 5000 + 181 * DAY)).toBe(true);
    expect(stubExpired(stub, 5000 + 10 * DAY)).toBe(false);
  });

  it("a delta merged into the old state gives the new state", () => {
    const c = new HybridClock("A", { now: () => 2000 });
    const before = sample();
    let after = setDocField(before, "title", "Rome", c);
    after = upsertBlock(after, para("B2", "new"), ["content", "position"], c);
    after = deleteBlock(after, "B1", c);
    const delta = diffNote(before, after);
    expect(Object.keys(delta.blocks).sort()).toEqual(["B1", "B2"]);
    expect(noteSum(mergeNoteFiles(before, delta).file)).toBe(noteSum(after));
  });
});

describe("history", () => {
  it("names versions and parses them back", () => {
    const c = formatHlc({ ms: 1000, counter: 1, deviceId: "Mac1" });
    const name = versionFileName({ c, by: "Mac1", reason: "auto" });
    expect(name).toBe(`${c}-Mac1-auto.fver`);
    expect(parseVersionFileName(name)).toEqual({ c, by: "Mac1", reason: "auto" });
    const conflict = conflictVersionName("B1", c);
    expect(conflict).toMatch(/-Mac1-conflict-[0-9a-f]{12}\.fver$/);
    expect(conflictVersionName("B1", c)).toBe(conflict);
    expect(conflictVersionName("B2", c)).not.toBe(conflict);
    expect(parseVersionFileName(`${conflict.slice(0, -5)} 2.fver`)).toBeNull();
  });

  it("gzips deterministically and round trips", () => {
    const { file } = snapshotVersion(
      sample(),
      "auto",
      formatHlc({ ms: 1000, counter: 0, deviceId: "A" }),
      "A",
    );
    const a = encodeVersionFile(file);
    expect(a).toEqual(encodeVersionFile(file));
    expect(decodeVersionFile(a)).toEqual(JSON.parse(JSON.stringify(file)));
    expect(() => decodeVersionFile(a.slice(0, a.length - 4))).toThrow();
  });

  it("thins only this device's auto versions: hourly for a day, daily for a month, weekly after", () => {
    const now = 400 * DAY;
    const names: string[] = [];
    const at = (ms: number, dev = "A", reason: "auto" | "named" | "conflict" = "auto") => {
      const n = versionFileName({
        c: formatHlc({ ms, counter: 0, deviceId: dev }),
        by: dev,
        reason,
        ...(reason === "conflict" ? { tag: "0123456789ab" } : {}),
      });
      names.push(n);
      return n;
    };
    const keepHour = [at(now - 10 * 60_000), at(now - 2 * 3_600_000 + 5 * 60_000)];
    const dropHour = at(now - 2 * 3_600_000 + 1 * 60_000);
    const keepDay = at(now - 3 * DAY + 3_600_000);
    const dropDay = at(now - 3 * DAY + 60_000);
    const keepWeek = at(now - 60 * DAY);
    const dropWeek = at(now - 60 * DAY - 1000);
    const other = at(now - 60 * DAY - 2000, "B");
    const named = at(now - 60 * DAY - 3000, "A", "named");
    const conflict = at(now - 60 * DAY - 4000, "A", "conflict");
    const renamed = at(now - 60 * DAY - 5000);
    const removed = thinVersions(names, "A", now, new Set([renamed]));
    expect(removed.sort()).toEqual([dropHour, dropDay, dropWeek].sort());
    for (const k of [...keepHour, keepDay, keepWeek, other, named, conflict, renamed])
      expect(removed).not.toContain(k);
  });
});

describe("library index", () => {
  const clock = (dev: string, now: number) => new HybridClock(dev, { now: () => now });
  it("merges folders, tags and settings as a CRDT", () => {
    const a0 = setFolderField(emptyIndex("lib"), "F1", "name", "Work", clock("A", 1000));
    const b = setFolderField(a0, "F1", "name", "Job", clock("B", 3000));
    const a = setTagField(
      setFolderField(a0, "F1", "color", "red", clock("A", 2000)),
      "T1",
      "name",
      "urgent",
      clock("A", 2100),
    );
    const c = setSetting(a0, "theme", "dark", clock("C", 2500));
    const m1 = mergeIndex(mergeIndex(a, b), c);
    const m2 = mergeIndex(a, mergeIndex(b, c));
    expect(encodeIndex(m1)).toEqual(encodeIndex(m2));
    expect(encodeIndex(mergeIndex(b, a))).toEqual(encodeIndex(mergeIndex(a, b)));
    expect(encodeIndex(mergeIndex(m1, m1))).toEqual(encodeIndex(m1));
    expect(m1.folders.F1!.name!.v).toBe("Job");
    expect(m1.folders.F1!.color!.v).toBe("red");
    expect(m1.tags.T1!.name!.v).toBe("urgent");
    expect(m1.settings.theme!.v).toBe("dark");
    expect(decodeIndex(encodeIndex(m1))).toEqual({ ...m1, sum: decodeIndex(encodeIndex(m1)).sum });
    expect(() => decodeIndex(encodeIndex(m1).slice(0, 20))).toThrow();
  });

  it("puts folders with cyclic or deleted parents at the top", () => {
    let i: IndexFile = emptyIndex("lib");
    const c = clock("A", 1000);
    i = setFolderField(i, "F1", "parentId", "F2", c);
    i = setFolderField(i, "F2", "parentId", "F1", c);
    i = setFolderField(i, "F3", "parentId", "F4", c);
    i = setFolderField(i, "F4", "deleted", true, c);
    const tree = liveFolders(i);
    expect(tree.find((f) => f.id === "F3")!.parentId).toBeNull();
    expect(tree.filter((f) => f.parentId === null).length).toBeGreaterThanOrEqual(2);
    expect(tree.find((f) => f.id === "F4")).toBeUndefined();
  });

  it("remembers permanently deleted notes", () => {
    const stub = makeStub(sample(), formatHlc({ ms: 9000, counter: 0, deviceId: "B" }));
    const i = recordDeletedNote(emptyIndex("lib"), DOC, stub);
    expect(i.deletedNotes[DOC]!.seen).toEqual(stub.seen);
  });
});

describe("catalogs", () => {
  it("newest catalog entry wins, and a note file at least as new overrides it", () => {
    const note = sample();
    const old = buildCatalog("A", [note], 1, hlcMs);
    const c = new HybridClock("B", { now: () => 5000 });
    const newer = setDocField(note, "title", "Rome", c);
    const cat = buildCatalog("B", [newer], 2, hlcMs);
    expect(resolveCatalog([old, cat]).get(DOC)!.title).toBe("Rome");
    expect(resolveCatalog([cat, old]).get(DOC)!.title).toBe("Rome");
    // The file is older than a catalog: the catalog hint wins until the file arrives.
    expect(resolveCatalog([cat], new Map([[DOC, note]]), hlcMs).get(DOC)!.source).toBe("catalog");
    const newest = setDocField(newer, "title", "Paris", c);
    const r = resolveCatalog([cat], new Map<string, NoteLike>([[DOC, newest]]), hlcMs).get(DOC)!;
    expect([r.title, r.source]).toEqual(["Paris", "note"]);
    const stub = makeStub(newest, c.tick());
    expect(resolveCatalog([cat], new Map<string, NoteLike>([[DOC, stub]]), hlcMs).has(DOC)).toBe(
      false,
    );
  });
});

describe("attachments and compaction", () => {
  const t = (ms: number, dev = "A") => formatHlc({ ms, counter: 0, deviceId: dev });
  it("collects a file only when unreferenced for 30 days and seen by every device", () => {
    const sha = "a".repeat(64);
    const devices = [device("A", { A: t(10 * DAY) }), device("B", { A: t(10 * DAY) })];
    const cand = { sha256: sha, unreferencedAt: t(DAY) };
    expect(gcEligible(cand, new Set(), devices, 40 * DAY)).toBe(true);
    expect(gcEligible(cand, new Set([sha]), devices, 40 * DAY)).toBe(false);
    expect(gcEligible(cand, new Set(), devices, 20 * DAY)).toBe(false);
    expect(gcEligible(cand, new Set(), [...devices, device("C", { A: t(0) })], 40 * DAY)).toBe(
      false,
    );
    expect(gcEligible({ sha256: sha, unreferencedAt: null }, new Set(), devices, 40 * DAY)).toBe(
      false,
    );
    expect(gcEligible(cand, new Set(), [], 40 * DAY)).toBe(false);
    const tracked = trackUnreferenced(
      [sha, "b".repeat(64)],
      new Set(["b".repeat(64)]),
      new Map(),
      t(5),
    );
    expect([...tracked]).toEqual([[sha, t(5)]]);
    expect(trackUnreferenced([sha], new Set(), tracked, t(9)).get(sha)).toBe(t(5));
    expect(missingAttachments(new Set(["x", "y"]), new Set(["x"]))).toEqual(["y"]);
  });

  it("compacts tombstones older than 90 days that every device has seen", () => {
    const c = new HybridClock("A", { now: () => DAY });
    let n = sample();
    n = setFile(
      n,
      "F1",
      { sha256: "a".repeat(64), name: "a.png", mime: "image/png", size: 1, kind: "image" },
      c,
    );
    n = deleteBlock(n, "B1", c);
    const del = n.blocks.B1!.deleted!.c;
    expect(canCompactTombstone(del, [device("A", { A: del })], DAY + 91 * DAY)).toBe(true);
    expect(
      canCompactTombstone(del, [device("A", { A: del }), device("B", {})], DAY + 91 * DAY),
    ).toBe(false);
    expect(canCompactTombstone(del, [device("A", { A: del })], DAY + 30 * DAY)).toBe(false);
    const r = compactTombstones(n, [device("A", { A: del })], DAY + 91 * DAY);
    expect(r.removed).toEqual(["B1"]);
    expect(r.note.blocks.B1).toBeUndefined();
    // The stale copy that still has B1 doesn't bring it back.
    expect(mergeNoteFiles(r.note, sample()).file).not.toHaveProperty("blocks.B1");
  });
});

describe("journal", () => {
  it("replays deltas, skips torn records, and truncates what files hold", async () => {
    const j = new MemoryJournal();
    const c = new HybridClock("A", { now: () => 1000 });
    const base = createNote(DOC, { createdAt: 1000, title: "Trip" }, c);
    await appendRecord(j, { k: "note", id: DOC, delta: diffNote(null, base) });
    const v2 = upsertBlock(base, para("B1", "hello"), ["content", "position"], c);
    await appendRecord(j, { k: "note", id: DOC, delta: diffNote(base, v2) });
    const v3 = setDocField(v2, "title", "Rome", c);
    await appendRecord(j, { k: "note", id: DOC, delta: diffNote(v2, v3) });
    const idx = setSetting(emptyIndex("lib"), "theme", "dark", c);
    await appendRecord(j, { k: "index", delta: idx });
    const torn = encodeJournalRecord({
      k: "note",
      id: DOC,
      delta: diffNote(v3, setDocField(v3, "title", "x", c)),
    });
    j.records.push(torn.slice(0, torn.length - 7));
    const records = await readRecords(j);
    expect(records.at(-1)).toBeNull();
    const replica = { notes: new Map<string, NoteLike>(), index: null as IndexFile | null };
    const r1 = replayJournal(records, replica);
    expect(r1).toEqual({ notes: [DOC], index: true, skipped: 1 });
    expect(noteSum(replica.notes.get(DOC)!)).toBe(noteSum(v3));
    replayJournal(records, replica);
    expect(noteSum(replica.notes.get(DOC)!)).toBe(noteSum(v3));
    // The file holds v2 only: the first two records can go.
    expect(coveredPrefix(records, { notes: new Map([[DOC, v2]]), index: null })).toBe(2);
    expect(coveredPrefix(records, { notes: new Map([[DOC, v3]]), index: idx })).toBe(5);
    await j.truncate(2);
    expect(j.records.length).toBe(3);
  });
});
