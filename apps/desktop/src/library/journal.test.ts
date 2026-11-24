// The journal: records survive in order, torn appends are skipped and cut off, truncation drops covered ones,
// every acknowledged append survives the app being killed, and local-store's records replay from it.
import { spawn } from "node:child_process";
import { appendFileSync, readFileSync, truncateSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import {
  HybridClock,
  createNote,
  decodeJournalRecord,
  encodeJournalRecord,
  readRecords,
  replayJournal,
  upsertBlock,
  type NoteLike,
} from "../../../../packages/local-store/src";
import { para } from "../../../../packages/local-store/test/helpers";
import { cleanupTemps, compiledSrc, tempDir, text, utf8 } from "../../test/library-kit";
import { crc32, FileJournal, parseJournal } from "./journal";

afterAll(cleanupTemps);

describe("the journal", () => {
  test("appends, reads back in order, and survives reopening", async () => {
    const path = join(tempDir(), "j", "journal.bin");
    const j = new FileJournal(path);
    await Promise.all(["a", "b", "c"].map((r) => j.append(utf8(r))));
    expect((await j.readAll()).map(text)).toEqual(["a", "b", "c"]);
    await j.close();
    const again = new FileJournal(path);
    await again.append(utf8("d"));
    expect((await again.readAll()).map(text)).toEqual(["a", "b", "c", "d"]);
  });

  test("truncate drops the first n, atomically", async () => {
    const j = new FileJournal(join(tempDir(), "journal.bin"));
    for (const r of ["1", "2", "3", "4"]) await j.append(utf8(r));
    await j.truncate(2);
    expect((await j.readAll()).map(text)).toEqual(["3", "4"]);
    await j.append(utf8("5"));
    await j.truncate(10);
    expect(await j.readAll()).toEqual([]);
    await j.append(utf8("6"));
    expect((await j.readAll()).map(text)).toEqual(["6"]);
    await expect(j.truncate(-1)).rejects.toMatchObject({ code: "invalid_argument" });
  });

  test("a torn last append is skipped, and cut off before the next one", async () => {
    const path = join(tempDir(), "journal.bin");
    const j = new FileJournal(path);
    for (const r of ["one", "two", "three"]) await j.append(utf8(r));
    await j.close();
    // The app died half way through writing "three".
    const full = readFileSync(path).length;
    truncateSync(path, full - 2);
    const k = new FileJournal(path);
    expect((await k.readAll()).map(text)).toEqual(["one", "two"]);
    await k.append(utf8("four"));
    expect((await k.readAll()).map(text)).toEqual(["one", "two", "four"]);
  });

  test("garbage after the last whole record, or a damaged record, ends the readable part there", async () => {
    const path = join(tempDir(), "journal.bin");
    const j = new FileJournal(path);
    for (const r of ["one", "two"]) await j.append(utf8(r));
    await j.close();
    appendFileSync(path, Buffer.from([0, 0, 0, 3, 1, 2, 3, 4, 120, 121, 122]));
    expect(parseJournal(readFileSync(path)).records.map(text)).toEqual(["one", "two"]);
    expect(parseJournal(readFileSync(path)).torn).toBe(true);
    // Flip a byte inside "one": its CRC fails and nothing after it is trusted.
    const b = readFileSync(path);
    b[5 + 8] ^= 0xff;
    writeFileSync(path, b);
    expect(parseJournal(b).records).toEqual([]);
    expect(crc32(utf8("123456789"))).toBe(0xcbf43926);
  });

  test("every acknowledged append survives the process being killed mid-stream", async () => {
    const dist = compiledSrc();
    const path = join(tempDir(), "journal.bin");
    const script = `
      const { FileJournal } = require(${JSON.stringify(join(dist, "library", "journal.js"))});
      const j = new FileJournal(${JSON.stringify(path)});
      (async () => { for (let i = 0; ; i++) { await j.append(Buffer.from("record " + i + " " + "x".repeat(i % 500))); process.stdout.write(i + "\\n"); } })();`;
    const child = spawn(process.execPath, ["-e", script], { stdio: ["ignore", "pipe", "inherit"] });
    let acked = -1;
    await new Promise<void>((resolve) => {
      let buf = "";
      child.stdout.on("data", (d: Buffer) => {
        buf += d.toString();
        const lines = buf.split("\n");
        buf = lines.pop()!;
        for (const l of lines) acked = Number(l);
        if (acked >= 60) {
          child.kill("SIGKILL");
          resolve();
        }
      });
    });
    await new Promise((r) => child.on("exit", r));
    const records = (await new FileJournal(path).readAll()).map(text);
    expect(records.length).toBeGreaterThanOrEqual(acked + 1);
    records.forEach((r, i) => expect(r.startsWith(`record ${i} `)).toBe(true));
  }, 30_000);

  test("local-store records replay from it, torn ones skipped", async () => {
    const j = new FileJournal(join(tempDir(), "journal.bin"));
    const clock = new HybridClock("A", { now: () => 1000 });
    const DOC = "01J9ZDOC000000000000000001";
    const n0 = createNote(DOC, { createdAt: 1, title: "Trip" }, clock);
    const n1 = upsertBlock(n0, para("B1", "hello"), ["content", "position"], clock);
    await j.append(encodeJournalRecord({ k: "note", id: DOC, delta: n0 }));
    await j.append(utf8("{ not a record"));
    await j.append(encodeJournalRecord({ k: "note", id: DOC, delta: n1 }));
    const records = await readRecords(j);
    expect(records.map((r) => r?.k ?? null)).toEqual(["note", null, "note"]);
    const replica = { notes: new Map<string, NoteLike>(), index: null };
    const out = replayJournal(records, replica);
    expect(out).toMatchObject({ notes: [DOC], skipped: 1 });
    expect(Object.keys((replica.notes.get(DOC) as typeof n1).blocks)).toEqual(["B1"]);
    expect(decodeJournalRecord(utf8("x"))).toBeNull();
  });
});
