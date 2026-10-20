// The watcher: bursts of changes arrive as few batches with each path once, own writes aren't echoed,
// removals (also of whole folders) and downloads are reported, scans catch what FSEvents missed, and an
// encrypted library reports logical paths.
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, test } from "vitest";
import { cleanupTemps, tempDir, utf8, waitFor } from "../../test/library-kit";
import { EncryptedNodeFs } from "./encryptedFs";
import { NodeFs } from "./fs";
import { hmacName } from "./crypto";
import type { LibraryChange } from "./types";
import { LibraryWatcher } from "./watch";

const watchers: LibraryWatcher[] = [];
afterEach(() => {
  for (const w of watchers.splice(0)) w.stop();
});
afterAll(cleanupTemps);

function setup(o: { useFsEvents?: boolean; encryptedKey?: Uint8Array } = {}) {
  const root = tempDir();
  mkdirSync(join(root, "notes"));
  const plain = new NodeFs({ root });
  const fs = o.encryptedKey ? new EncryptedNodeFs(plain, o.encryptedKey) : plain;
  const batches: LibraryChange[][] = [];
  const watcher = new LibraryWatcher({ root, source: fs, onChanges: (c) => batches.push(c), debounceMs: 150, scanIntervalMs: 60_000, useFsEvents: o.useFsEvents });
  watchers.push(watcher);
  const all = () => batches.flat();
  // FSEvents streams take a moment to start (anything before that is left to the scans).
  const start = async () => {
    await watcher.start();
    if (o.useFsEvents !== false) await new Promise((r) => setTimeout(r, 300));
  };
  return { root, plain, fs, watcher, batches, all, start };
}

describe("the library watcher", { timeout: 15_000 }, () => {
  test("a burst of outside changes arrives in few batches, each path once", async () => {
    const { root, batches, all, start } = setup();
    await start();
    for (let i = 0; i < 30; i++) writeFileSync(join(root, "notes", `N${String(i).padStart(2, "0")}.fnote`), `n${i}`);
    for (let i = 0; i < 5; i++) writeFileSync(join(root, "notes", "N00.fnote"), `again ${i}`);
    await waitFor(() => new Set(all().map((c) => c.path)).size === 30, 8000, "30 paths");
    await new Promise((r) => setTimeout(r, 400));
    expect(batches.length).toBeLessThanOrEqual(4);
    for (const b of batches) expect(new Set(b.map((c) => c.path)).size).toBe(b.length);
    expect(all().every((c) => c.kind === "changed")).toBe(true);
  });

  test("its own writes aren't echoed back; someone else's are", async () => {
    const { root, plain, watcher, all, start } = setup();
    await start();
    const w = await plain.write("notes/MINE.fnote", utf8("mine"), {});
    watcher.noteOwnChange("notes/MINE.fnote", { path: "notes/MINE.fnote", size: 4, mtimeMs: 0, etag: (w as { etag: string }).etag, downloaded: true, hasConflicts: false });
    writeFileSync(join(root, "notes", "THEIRS.fnote"), "theirs");
    await waitFor(() => all().some((c) => c.path === "notes/THEIRS.fnote"), 8000, "their change");
    await watcher.rescan();
    expect(all().map((c) => c.path)).toEqual(["notes/THEIRS.fnote"]);
  });

  test("removals, of a file and of a whole folder", async () => {
    const { root, all, start } = setup();
    mkdirSync(join(root, "history", "X"), { recursive: true });
    writeFileSync(join(root, "notes", "A.fnote"), "a");
    writeFileSync(join(root, "history", "X", "1.fver"), "1");
    writeFileSync(join(root, "history", "X", "2.fver"), "2");
    await start();
    rmSync(join(root, "notes", "A.fnote"));
    rmSync(join(root, "history", "X"), { recursive: true });
    await waitFor(() => all().filter((c) => c.kind === "removed").length === 3, 8000, "three removals");
    expect(all().map((c) => `${c.kind} ${c.path}`).sort()).toEqual(["removed history/X/1.fver", "removed history/X/2.fver", "removed notes/A.fnote"]);
  });

  test("without FSEvents a scan finds the differences; a placeholder that arrives is 'downloaded'", async () => {
    const { root, watcher, all, start } = setup({ useFsEvents: false });
    writeFileSync(join(root, "notes", ".P.fnote.icloud"), "plist");
    writeFileSync(join(root, "notes", "K.fnote"), "keep");
    writeFileSync(join(root, "notes", "G.fnote"), "gone soon");
    await start();
    rmSync(join(root, "notes", ".P.fnote.icloud"));
    writeFileSync(join(root, "notes", "P.fnote"), "arrived");
    writeFileSync(join(root, "notes", "K.fnote"), "kept, changed");
    rmSync(join(root, "notes", "G.fnote"));
    writeFileSync(join(root, "notes", "N.fnote"), "new");
    await watcher.rescan();
    expect(all()).toEqual([
      { path: "notes/G.fnote", kind: "removed" },
      { path: "notes/K.fnote", kind: "changed" },
      { path: "notes/N.fnote", kind: "changed" },
      { path: "notes/P.fnote", kind: "downloaded" },
    ]);
    await watcher.rescan();
    expect(all().length).toBe(4);
  });

  test("an atomic replace by another app is one change", async () => {
    const { root, all, start } = setup();
    writeFileSync(join(root, "notes", "R.fnote"), "v1");
    await start();
    writeFileSync(join(root, "notes", ".R.tmp"), "v2");
    renameSync(join(root, "notes", ".R.tmp"), join(root, "notes", "R.fnote"));
    await waitFor(() => all().length > 0, 8000, "the replace");
    await new Promise((r) => setTimeout(r, 300));
    expect(all()).toEqual([{ path: "notes/R.fnote", kind: "changed" }]);
  });

  test("uploads reported by the helper become 'uploaded' once", async () => {
    const { root, watcher, all, start } = setup({ useFsEvents: false });
    writeFileSync(join(root, "notes", "U.fnote"), "u");
    await start();
    watcher.noteStatus([{ path: "notes/U.fnote", downloaded: true, uploaded: false }]);
    watcher.noteStatus([{ path: "notes/U.fnote", downloaded: true, uploaded: true }]);
    watcher.noteStatus([{ path: "notes/U.fnote", downloaded: true, uploaded: true }]);
    expect(all()).toEqual([{ path: "notes/U.fnote", kind: "uploaded" }]);
  });

  test("an encrypted library reports logical paths", async () => {
    const key = new Uint8Array(32).fill(4);
    const { root, fs, all, start } = setup({ encryptedKey: key });
    await start();
    // Another device writes a note: on disk only its HMAC name shows.
    const other = new EncryptedNodeFs(new NodeFs({ root }), key);
    await other.write("notes/01J9ZDOC000000000000000009.fnote", utf8(JSON.stringify({ id: "01J9ZDOC000000000000000009" })), {});
    await waitFor(() => all().length > 0, 8000, "the encrypted change");
    expect(all()).toEqual([{ path: "notes/01J9ZDOC000000000000000009.fnote", kind: "changed" }]);
    expect(hmacName(key, "note", "01J9ZDOC000000000000000009")).not.toBe("01J9ZDOC000000000000000009");
    expect((await fs.list("notes")).map((e) => e.path)).toEqual(["notes/01J9ZDOC000000000000000009.fnote"]);
  });
});
