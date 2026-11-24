// packages/local-store/fixtures/fs-contract.json against the Mac's file layers: NodeFs on a plain folder,
// EncryptedNodeFs around it, and NodeFs with coordinated I/O through the real folevi-files helper. Then
// local-store's own read-merge-write and NoteReplica run on top of NodeFs unchanged.
import { renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { loadContract, runFsContract } from "../../../../packages/local-store/test/fsContract";
import {
  HybridClock,
  NoteReplica,
  createNote,
  decodeNoteFile,
  encodeNoteFile,
  noteCodec,
  notePath,
  readMergeWrite,
  upsertBlock,
  type LocalFs as RefLocalFs,
  type NoteFile,
} from "../../../../packages/local-store/src";
import { para } from "../../../../packages/local-store/test/helpers";
import { cleanupTemps, helperBinary, tempDir } from "../../test/library-kit";
import { EncryptedNodeFs } from "./encryptedFs";
import { NodeFs } from "./fs";
import { FilesHelper, type Coordinator } from "./helper";
import { placeholderName } from "./paths";

afterAll(cleanupTemps);
const CASES = loadContract().cases.length;

/** Provider behaviour a plain folder can show: placeholders and writes from outside. */
function plainHooks(root: string) {
  return {
    evict: async (p: string) => {
      const abs = join(root, p);
      renameSync(abs, join(dirname(abs), placeholderName(abs.slice(abs.lastIndexOf("/") + 1))));
    },
    put: async (p: string, b: Uint8Array) => {
      // In place, the way a sync client or an editor might.
      writeFileSync(join(root, p), b);
    },
  };
}

describe("the LocalFs contract on the Mac", () => {
  test("NodeFs on a plain folder", async () => {
    const r = await runFsContract(async () => {
      const root = tempDir();
      return { fs: new NodeFs({ root }) as unknown as RefLocalFs, hooks: plainHooks(root) };
    });
    expect(r.skipped).toEqual(["conflict versions are listed, read and resolved"]);
    expect(r.ran.length).toBe(CASES - 1);
  });

  test("EncryptedNodeFs (key in the main process)", async () => {
    const r = await runFsContract(async () => ({ fs: new EncryptedNodeFs(new NodeFs({ root: tempDir() }), new Uint8Array(32).fill(5)) as unknown as RefLocalFs }));
    expect(r.ran.length).toBe(CASES - 3);
  });

  const helper = helperBinary();
  test.skipIf(!helper)("NodeFs with coordinated I/O through folevi-files (NSFileCoordinator, NSFileVersion)", async () => {
    const files = new FilesHelper(helper!, { args: ["--test-hooks"] });
    try {
      // Local NSFileVersions stand in for iCloud's conflict versions: the test hook lists them as conflicts.
      const coordinator: Coordinator = {
        read: (p) => files.read(p),
        write: (p, b, c) => files.write(p, b, c),
        remove: (p, c) => files.remove(p, c),
        startDownload: (ps) => files.startDownload(ps),
        watch: (r, cb) => files.watch(r, cb),
        conflictVersions: (p) => files.conflictVersions(p, { includeOther: true }),
        resolveConflicts: (p, ids) => files.resolveConflicts(p, ids, { includeOther: true }),
        status: async (ps) => {
          const s = await files.status(ps);
          for (const p of ps) if (s[p]?.exists && !s[p]!.placeholder) s[p]!.hasConflicts = (await files.conflictVersions(p, { includeOther: true })).length > 0;
          return s;
        },
      };
      const r = await runFsContract(async () => {
        const root = tempDir();
        return {
          fs: new NodeFs({ root, coordinator }) as unknown as RefLocalFs,
          hooks: {
            ...plainHooks(root),
            addConflictVersion: async (p: string, b: Uint8Array) => {
              await files.request("addVersion", { path: join(root, p), bytes: Buffer.from(b).toString("base64") });
            },
          },
        };
      });
      expect(r.skipped).toEqual([]);
      expect(r.ran.length).toBe(CASES);
    } finally {
      files.close();
    }
  }, 60_000);
});

const DOC = "01J9ZDOC000000000000000001";
function note(dev: string, now: number, text: string): NoteFile {
  const c = new HybridClock(dev, { now: () => now });
  const n = createNote(DOC, { createdAt: 1, title: "Trip" }, c);
  return upsertBlock(n, para("B1", text), ["content", "position"], c);
}

describe("local-store on top of NodeFs", () => {
  test("read-merge-write retries a lost race and keeps both edits", async () => {
    const fs = new NodeFs({ root: tempDir() }) as unknown as RefLocalFs;
    const path = notePath(DOC);
    expect((await readMergeWrite(fs, path, noteCodec, note("A", 1000, "from A"))).status).toBe("written");
    // B writes between A's read and A's write: A's ifMatch fails once, then A merges B in.
    let raced = false;
    const racing: RefLocalFs = {
      ...fs,
      list: (d) => fs.list(d),
      read: (p) => fs.read(p),
      remove: (p, o) => fs.remove(p, o),
      conflictVersions: (p) => fs.conflictVersions(p),
      resolveConflicts: (p, i) => fs.resolveConflicts(p, i),
      write: async (p, b, o) => {
        if (!raced) {
          raced = true;
          await readMergeWrite(fs, path, noteCodec, note("B", 2000, "from B"));
        }
        return fs.write(p, b, o);
      },
    };
    const r = await readMergeWrite(racing, path, noteCodec, note("C", 1500, "from C"));
    expect(r.status).toBe("written");
    expect(r.status === "written" && r.attempts).toBe(2);
    const onDisk = decodeNoteFile((await fs.read(path) as { bytes: Uint8Array }).bytes) as NoteFile;
    expect(Object.keys(onDisk.seen).sort()).toEqual(["A", "B", "C"]);
  });

  test("NoteReplica syncs a folder written by two devices", async () => {
    const root = tempDir();
    const a = new NoteReplica(new NodeFs({ root }) as unknown as RefLocalFs, new HybridClock("A", { now: () => 5000 }));
    const b = new NoteReplica(new NodeFs({ root }) as unknown as RefLocalFs, new HybridClock("B", { now: () => 6000 }));
    a.edit(DOC, () => note("A", 1000, "A's words"));
    await a.sync();
    await b.sync();
    b.edit(DOC, (n) => upsertBlock(n as NoteFile, para("B2", "B's words", { rank: "W" }), ["content", "position"], new HybridClock("B", { now: () => 7000 })));
    await b.sync();
    await a.sync();
    const file = decodeNoteFile(new Uint8Array(await new NodeFs({ root }).read(notePath(DOC)).then((r) => (r as { bytes: Uint8Array }).bytes))) as NoteFile;
    expect(Object.keys(file.blocks).sort()).toEqual(["B1", "B2"]);
    expect(encodeNoteFile(file).length).toBeGreaterThan(0);
  });
});
