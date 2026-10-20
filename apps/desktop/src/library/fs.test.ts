// NodeFs beyond the shared contract: atomic writes under concurrent writers (in this process and in others),
// compare-and-swap races, path rejection including symlinks, placeholders, what listing skips, and cleanup.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { cleanupTemps, compiledSrc, tempDir, text, utf8 } from "../../test/library-kit";
import { etagOf, NodeFs, parseEtag } from "./fs";

afterAll(cleanupTemps);

const payload = (seed: number, size: number) => {
  const b = Buffer.alloc(size);
  for (let i = 0; i < size; i++) b[i] = (seed * 31 + i) & 0xff;
  const sum = createHash("sha256").update(b).digest("hex");
  return Buffer.concat([Buffer.from(`${sum}\n`), b]);
};
/** A payload is whole if its body matches the checksum on its first line. */
const whole = (bytes: Uint8Array) => {
  const b = Buffer.from(bytes);
  const nl = b.indexOf(10);
  return nl === 64 && createHash("sha256").update(b.subarray(65)).digest("hex") === b.subarray(0, 64).toString();
};

describe("concurrent writers", () => {
  test("of many writers holding the same etag, exactly one wins", async () => {
    const fs = new NodeFs({ root: tempDir() });
    const first = await fs.write("index/library.findex", utf8("v0"), { ifMatch: null });
    if (!("etag" in first) || "mismatch" in first) throw new Error("setup");
    const results = await Promise.all(Array.from({ length: 40 }, (_, i) => fs.write("index/library.findex", utf8(`v${i + 1}`), { ifMatch: first.etag })));
    const winners = results.filter((r) => !("mismatch" in r));
    expect(winners.length).toBe(1);
    const final = await fs.read("index/library.findex");
    expect("etag" in final && final.etag).toBe((winners[0] as { etag: string }).etag);
    // Every loser was told the winner's etag.
    for (const r of results) if ("mismatch" in r) expect(r.etag).toBe((winners[0] as { etag: string }).etag);
  });

  test("two NodeFs on one folder share the lock: read-modify-write increments never get lost", async () => {
    const root = tempDir();
    const a = new NodeFs({ root });
    const b = new NodeFs({ root });
    await a.write("counter", utf8("0"), {});
    const bump = async (fs: NodeFs) => {
      for (;;) {
        const r = await fs.read("counter");
        if ("notDownloaded" in r) throw new Error("no");
        const w = await fs.write("counter", utf8(String(Number(text(r.bytes)) + 1)), { ifMatch: r.etag });
        if (!("mismatch" in w)) return;
      }
    };
    await Promise.all(Array.from({ length: 30 }, (_, i) => bump(i % 2 ? a : b)));
    const r = await a.read("counter");
    expect("bytes" in r && text(r.bytes)).toBe("30");
  });

  test("create-only: of concurrent creators exactly one wins", async () => {
    const fs = new NodeFs({ root: tempDir() });
    const results = await Promise.all(Array.from({ length: 25 }, (_, i) => fs.write("history/X/v.fver", utf8(`by ${i}`), { ifMatch: null })));
    expect(results.filter((r) => !("mismatch" in r)).length).toBe(1);
  });

  test("a reader never sees a torn file while writers replace it", async () => {
    const fs = new NodeFs({ root: tempDir() });
    await fs.write("notes/A.fnote", payload(0, 300_000), {});
    let stop = false;
    let reads = 0;
    const reader = (async () => {
      while (!stop) {
        const r = await fs.read("notes/A.fnote");
        if ("bytes" in r) {
          expect(whole(r.bytes)).toBe(true);
          reads++;
        }
      }
    })();
    await Promise.all(Array.from({ length: 4 }, async (_, w) => {
      for (let i = 0; i < 15; i++) await fs.write("notes/A.fnote", payload(w * 100 + i, 200_000 + w * 50_000), {});
    }));
    stop = true;
    await reader;
    expect(reads).toBeGreaterThan(5);
    // No temp files are left behind.
    expect(readdirSync(join(fs.root, ".folevi-tmp"))).toEqual([]);
  });

  test("other processes writing the same file: every read is whole, and create-only has one winner", async () => {
    const dist = compiledSrc();
    const root = tempDir();
    const fs = new NodeFs({ root });
    await fs.write("notes/B.fnote", payload(1, 100_000), {});
    const child = (mode: string, n: number) =>
      new Promise<string>((resolve, reject) => {
        const script = `
          const { NodeFs } = require(${JSON.stringify(join(dist, "library", "fs.js"))});
          const { createHash } = require("node:crypto");
          const fs = new NodeFs({ root: ${JSON.stringify(root)} });
          const payload = (seed, size) => { const b = Buffer.alloc(size); for (let i = 0; i < size; i++) b[i] = (seed * 31 + i) & 0xff;
            return Buffer.concat([Buffer.from(createHash("sha256").update(b).digest("hex") + "\\n"), b]); };
          (async () => {
            if (${JSON.stringify(mode)} === "create") {
              const r = await fs.write("history/X/once.fver", Buffer.from("by ${n}"), { ifMatch: null });
              process.stdout.write("mismatch" in r ? "lost" : "won");
              return;
            }
            for (let i = 0; i < 25; i++) await fs.write("notes/B.fnote", payload(${n} * 1000 + i, 150000 + ${n} * 20000), {});
            process.stdout.write("done");
          })().catch((e) => { console.error(e); process.exit(1); });`;
        const c = spawn(process.execPath, ["-e", script], { stdio: ["ignore", "pipe", "inherit"] });
        let out = "";
        c.stdout.on("data", (d) => (out += d));
        c.on("exit", (code) => (code === 0 ? resolve(out) : reject(new Error(`child ${n} exited ${code}`))));
      });
    let stop = false;
    let reads = 0;
    const reader = (async () => {
      while (!stop) {
        const r = await fs.read("notes/B.fnote");
        if ("bytes" in r) {
          expect(whole(r.bytes)).toBe(true);
          reads++;
        }
      }
    })();
    const outs = await Promise.all([child("write", 1), child("write", 2), child("write", 3), ...Array.from({ length: 6 }, (_, i) => child("create", i))]);
    stop = true;
    await reader;
    expect(outs.slice(0, 3)).toEqual(["done", "done", "done"]);
    expect(outs.slice(3).filter((o) => o === "won").length).toBe(1);
    expect(reads).toBeGreaterThan(0);
  }, 60_000);
});

describe("paths", () => {
  test("a symlink can't lead a read or write out of the library", async () => {
    const root = tempDir();
    const outside = tempDir();
    writeFileSync(join(outside, "secret.txt"), "secret");
    symlinkSync(outside, join(root, "notes"));
    symlinkSync(join(outside, "secret.txt"), join(root, "link.txt"));
    const fs = new NodeFs({ root });
    await expect(fs.write("notes/x.fnote", utf8("x"), {})).rejects.toMatchObject({ code: "invalid_path" });
    await expect(fs.read("notes/secret.txt")).rejects.toMatchObject({ code: "invalid_path" });
    await expect(fs.read("link.txt")).rejects.toMatchObject({ code: "invalid_path" });
    await expect(fs.remove("link.txt")).rejects.toMatchObject({ code: "invalid_path" });
    expect(existsSync(join(outside, "x.fnote"))).toBe(false);
    // Listing doesn't follow links either.
    expect((await fs.list("")).map((e) => e.path)).toEqual([]);
  });

  test("bad arguments are refused", async () => {
    const fs = new NodeFs({ root: tempDir() });
    await expect(fs.write("a", "text" as unknown as Uint8Array, {})).rejects.toMatchObject({ code: "invalid_argument" });
    await expect(fs.write("a", utf8("x"), { ifMatch: 5 as unknown as string })).rejects.toMatchObject({ code: "invalid_argument" });
    await expect(fs.remove("a", { ifMatch: {} as unknown as string })).rejects.toMatchObject({ code: "invalid_argument" });
  });

  test("etags round-trip through their parts", () => {
    const e = etagOf({ ino: 123456789012345n, size: 42n, mtimeNs: 1760000000123456789n });
    expect(parseEtag(e)).toEqual({ ino: "123456789012345", size: 42, mtimeNs: "1760000000123456789" });
    expect(parseEtag("nope")).toBeNull();
  });
});

describe("listing and housekeeping", () => {
  test("skips hidden, temporary and provider files; shows placeholders as not downloaded", async () => {
    const root = tempDir();
    mkdirSync(join(root, "notes"), { recursive: true });
    mkdirSync(join(root, ".folevi-tmp"));
    mkdirSync(join(root, ".dropbox.cache"));
    writeFileSync(join(root, "notes", "A.fnote"), "a");
    writeFileSync(join(root, "notes", ".B.fnote.icloud"), "plist");
    writeFileSync(join(root, "notes", ".DS_Store"), "x");
    writeFileSync(join(root, "notes", ".hidden"), "x");
    writeFileSync(join(root, ".folevi-tmp", "t.tmp"), "x");
    writeFileSync(join(root, ".dropbox.cache", "c"), "x");
    writeFileSync(join(root, "Icon\r"), "");
    const fs = new NodeFs({ root });
    const entries = await fs.list("");
    expect(entries.map((e) => [e.path, e.downloaded])).toEqual([
      ["notes/A.fnote", true],
      ["notes/B.fnote", false],
    ]);
    expect(await fs.read("notes/B.fnote")).toEqual({ notDownloaded: true });
    // Writing the real file replaces the placeholder.
    await fs.write("notes/B.fnote", utf8("b"), {});
    expect(existsSync(join(root, "notes", ".B.fnote.icloud"))).toBe(false);
    expect((await fs.list("notes")).map((e) => e.downloaded)).toEqual([true, true]);
  });

  test("a remove takes empty subfolders with it, never the top-level ones", async () => {
    const fs = new NodeFs({ root: tempDir() });
    await fs.write("history/X/a.fver", utf8("a"), {});
    await fs.write("files/ab/abcdef0123456789", utf8("f"), {});
    await fs.remove("history/X/a.fver");
    await fs.remove("files/ab/abcdef0123456789");
    expect(existsSync(join(fs.root, "history", "X"))).toBe(false);
    expect(existsSync(join(fs.root, "history"))).toBe(true);
    expect(existsSync(join(fs.root, "files", "ab"))).toBe(false);
  });

  test("temp files a crash left behind are cleaned up, a write in flight isn't", async () => {
    const fs = new NodeFs({ root: tempDir() });
    mkdirSync(join(fs.root, ".folevi-tmp"));
    writeFileSync(join(fs.root, ".folevi-tmp", "old.tmp"), "x");
    writeFileSync(join(fs.root, ".folevi-tmp", "new.tmp"), "x");
    const old = new Date(Date.now() - 3600_000);
    utimesSync(join(fs.root, ".folevi-tmp", "old.tmp"), old, old);
    expect(await fs.cleanTemp()).toBe(1);
    expect(readdirSync(join(fs.root, ".folevi-tmp"))).toEqual(["new.tmp"]);
  });

  test("own writes are reported to the watcher hook", async () => {
    const seen: [string, string | null][] = [];
    const fs = new NodeFs({ root: tempDir(), onOwnChange: (p, e) => seen.push([p, e?.etag ?? null]) });
    const w = await fs.write("notes/A.fnote", utf8("a"), {});
    await fs.remove("notes/A.fnote");
    expect(seen).toEqual([
      ["notes/A.fnote", (w as { etag: string }).etag],
      ["notes/A.fnote", null],
    ]);
  });
});
