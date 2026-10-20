// Offline: edits are journalled (local-store's journal, the way the page writes them before acknowledging),
// a sync while offline fails with "offline" and writes nothing, the library still lists and opens from the
// device copy, and the app can even restart offline (the journal replays into a fresh replica). Back online,
// one sync flushes everything, the journal is truncated by what the file now holds, and the other device sees
// the edits. Run on both providers.
import { describe, expect, test } from "vitest";
import {
  appendRecord,
  coveredPrefix,
  createNote,
  decodeNoteFile,
  diffNote,
  HybridClock,
  isStub,
  MemoryJournal,
  NoteReplica,
  readRecords,
  replayJournal,
  upsertBlock,
  type LocalFs as StoreFs,
  type NoteFile,
} from "../../../../packages/local-store/src";
import { para } from "../../../../packages/local-store/test/helpers";
import type { MemoryMirror } from "../../src/library/cloud/mirror";
import { isCloudError } from "../../src/library/cloud/types";
import type { FaultInjector } from "./fakeCommon";
import { FakeDropbox } from "./fakeDropbox";
import { FakeDrive } from "./fakeDrive";
import { dropboxDevice, driveDevice, type Device } from "./harness";

const DOC = "01J9ZDOC000000000000000001";
const PATH = `notes/${DOC}.fnote`;

type Make = (mirror?: MemoryMirror) => Device<StoreFs & { open(): Promise<boolean> }>;

const providers: [string, () => { make: Make; file: (p: string) => Uint8Array | undefined }][] = [
  [
    "Dropbox",
    () => {
      const fake = new FakeDropbox();
      return { make: (mirror) => dropboxDevice(fake, mirror ? { mirror } : {}) as never, file: (p) => fake.file(p) };
    },
  ],
  [
    "Google Drive",
    () => {
      const fake = new FakeDrive();
      return { make: (mirror) => driveDevice(fake, mirror ? { mirror } : {}) as never, file: (p) => fake.file(p) };
    },
  ],
];

function texts(note: NoteFile): string[] {
  return Object.values(note.blocks)
    .filter((b) => !b.deleted)
    .map((b) => (b.text as { text: string }[]).map((t) => t.text).join(""))
    .sort();
}

for (const [name, setup] of providers) {
  describe(`${name}: offline`, () => {
    test("edits wait in the journal and flush when the connection is back", async () => {
      const { make, file } = setup();
      const now = { t: 1_000_000 };
      const a = make();
      const b = make();
      const ra = new NoteReplica(a.fs, new HybridClock("DA", { now: () => now.t }));
      const rb = new NoteReplica(b.fs, new HybridClock("DB", { now: () => now.t }));
      ra.edit(DOC, () => upsertBlock(createNote(DOC, { createdAt: 1, title: "Trip" }, ra.clock), para("B1", "pack"), ["content", "position"], ra.clock));
      await ra.sync();
      await rb.sync();
      expect(texts(rb.notes.get(DOC) as NoteFile)).toEqual(["pack"]);

      // a loses the network.
      a.injector.offline = true;
      const journal = new MemoryJournal();
      const edit = async (id: string, text: string) => {
        now.t += 1000;
        const before = ra.notes.get(DOC) as NoteFile;
        const after = ra.edit(DOC, (n) => upsertBlock(n as NoteFile, para(id, text, { rank: id === "B2" ? "T" : "W" }), ["content", "position"], ra.clock)) as NoteFile;
        await appendRecord(journal, { k: "note", id: DOC, delta: diffNote(before, after) });
      };
      await edit("B2", "tickets");
      await edit("B3", "passport");
      const offline = await ra.sync().catch((e: unknown) => e);
      expect(isCloudError(offline, "offline")).toBe(true);
      expect(texts(decodeNoteFile(file(PATH)!) as NoteFile)).toEqual(["pack"]);
      // Still browsable offline: the listing and the note come from the device copy.
      expect((await a.fs.list("notes")).map((e) => e.path)).toEqual([PATH]);
      const cached = await a.fs.read(PATH);
      expect("bytes" in cached && texts(decodeNoteFile(cached.bytes) as NoteFile)).toEqual(["pack"]);

      // The app quits and starts again, still offline: the journal brings the edits back.
      const restarted = make(a.mirror);
      (restarted.injector as FaultInjector).offline = true;
      const r2 = new NoteReplica(restarted.fs, new HybridClock("DA", { now: () => now.t }));
      await r2.ingest(); // from the device copy
      const replay = replayJournal(await readRecords(journal), { notes: r2.notes, index: null });
      expect(replay.notes).toEqual([DOC]);
      expect(texts(r2.notes.get(DOC) as NoteFile)).toEqual(["pack", "passport", "tickets"]);
      expect(isCloudError(await r2.sync().catch((e: unknown) => e), "offline")).toBe(true);

      // Meanwhile b edits the same note online.
      now.t += 1000;
      rb.edit(DOC, (n) => upsertBlock(n as NoteFile, para("B4", "charger", { rank: "Z" }), ["content", "position"], rb.clock));
      await rb.sync();

      // Back online: one sync merges b's edit and flushes the journalled ones.
      (restarted.injector as FaultInjector).offline = false;
      const report = await r2.sync();
      expect(report.written).toEqual([PATH]);
      const cloud = decodeNoteFile(file(PATH)!);
      expect(isStub(cloud)).toBe(false);
      expect(texts(cloud as NoteFile)).toEqual(["charger", "pack", "passport", "tickets"]);
      // The journal is truncated by what the file holds.
      const records = await readRecords(journal);
      expect(coveredPrefix(records, { notes: new Map([[DOC, cloud]]), index: null })).toBe(2);
      await journal.truncate(2);
      expect(journal.records).toEqual([]);
      await rb.sync();
      expect(texts(rb.notes.get(DOC) as NoteFile)).toEqual(["charger", "pack", "passport", "tickets"]);
    });

    test("a device that has never listed can't work offline (it says so)", async () => {
      const { make } = setup();
      const d = make();
      d.injector.offline = true;
      expect(isCloudError(await d.fs.list("").catch((e: unknown) => e), "offline")).toBe(true);
      expect(await d.fs.open()).toBe(false);
    });
  });
}
