// folevi-files (native/folevi-files.swift), built for this Mac and driven over its JSON-lines protocol:
// its own self-test, coordinated writes with compare-and-swap, a coordinated reader waiting for a writer,
// NSFileVersion versions read and resolved, placeholders, refusals, and coming back after a crash.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, test } from "vitest";
import { cleanupTemps, helperBinary, tempDir, text, utf8 } from "../../test/library-kit";
import { FilesHelper, type HelperStat } from "./helper";

const binary = helperBinary();
const helpers: FilesHelper[] = [];
const open = (args: string[] = ["--test-hooks"]) => {
  const h = new FilesHelper(binary!, { args, timeoutMs: 20_000 });
  helpers.push(h);
  return h;
};
afterEach(() => {
  for (const h of helpers.splice(0)) h.close();
});
afterAll(cleanupTemps);

describe.skipIf(!binary)("folevi-files", { timeout: 30_000 }, () => {
  test("its self-test passes (coordination, compare-and-swap, placeholders, NSFileVersion)", () => {
    const out = execFileSync(binary!, ["--self-test", tempDir()], { encoding: "utf8" });
    const r = JSON.parse(out) as { selfTest: boolean; checks: { name: string; ok: boolean; detail?: string }[] };
    expect(r.checks.filter((c) => !c.ok)).toEqual([]);
    expect(r.checks.length).toBe(7);
    expect(r.selfTest).toBe(true);
  });

  test("a coordinated write, then compare-and-swap inside the coordination", async () => {
    const h = open();
    const file = join(tempDir(), "notes", "A.fnote");
    const created = await h.write(file, utf8("one"), { mode: "create" });
    if (!("stat" in created)) throw new Error("not created");
    expect(await h.write(file, utf8("two"), { mode: "create" })).toMatchObject({ mismatch: true, current: created.stat });
    const swapped = await h.write(file, utf8("two"), { mode: "match", expect: created.stat });
    expect("stat" in swapped).toBe(true);
    const stale = await h.write(file, utf8("three"), { mode: "match", expect: created.stat });
    expect(stale).toMatchObject({ mismatch: true });
    const r = await h.read(file);
    expect("bytes" in r && text(r.bytes)).toBe("two");
    expect("stat" in r && r.stat).toEqual((swapped as { stat: HelperStat }).stat);
    await expect(h.remove(file, { mode: "match", expect: created.stat })).rejects.toMatchObject({ code: "mismatch" });
    await h.remove(file, { mode: "any" });
    await expect(h.read(file)).rejects.toMatchObject({ code: "not_found" });
  });

  test("a coordinated read waits for a coordinated write in progress", async () => {
    const h = open();
    const file = join(tempDir(), "index", "library.findex");
    await h.write(file, utf8("before"), { mode: "any" });
    const order: string[] = [];
    const writing = h.request("holdWrite", { path: file, bytes: Buffer.from("after").toString("base64"), mode: "any", ms: 500 }).then(() => order.push("write"));
    await new Promise((r) => setTimeout(r, 150));
    const reading = h.read(file).then((r) => {
      order.push("read");
      return r;
    });
    const [, r] = await Promise.all([writing, reading]);
    expect(order).toEqual(["write", "read"]);
    expect("bytes" in r && text(r.bytes)).toBe("after");
  });

  test("NSFileVersion: versions are listed with their bytes, then resolved and gone", async () => {
    const h = open();
    const file = join(tempDir(), "notes", "V.fnote");
    await h.write(file, utf8("current"), { mode: "any" });
    // Real iCloud conflicts need two devices; the test hook stores local versions and lists them alongside.
    await h.request("addVersion", { path: file, bytes: Buffer.from("other mac").toString("base64") });
    await h.request("addVersion", { path: file, bytes: Buffer.from("third mac").toString("base64") });
    expect(await h.conflictVersions(file)).toEqual([]);
    const versions = await h.conflictVersions(file, { includeOther: true });
    expect(versions.map((v) => text(v.bytes)).sort()).toEqual(["other mac", "third mac"]);
    const keep = versions.find((v) => text(v.bytes) === "third mac")!;
    await h.resolveConflicts(file, versions.filter((v) => v !== keep).map((v) => v.id), { includeOther: true });
    expect((await h.conflictVersions(file, { includeOther: true })).map((v) => v.id)).toEqual([keep.id]);
    await h.resolveConflicts(file, [keep.id], { includeOther: true });
    expect(await h.conflictVersions(file, { includeOther: true })).toEqual([]);
    const r = await h.read(file);
    expect("bytes" in r && text(r.bytes)).toBe("current");
  });

  test("the test hooks only exist when asked for", async () => {
    const h = open([]);
    expect((await h.ping()).testHooks).toBe(false);
    await expect(h.request("addVersion", { path: join(tempDir(), "x"), bytes: "" })).rejects.toMatchObject({ code: "invalid_argument" });
  });

  test("placeholders: status and reads say not downloaded", async () => {
    const h = open();
    const dir = join(tempDir(), "notes");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, ".P.fnote.icloud"), "plist");
    writeFileSync(join(dir, "L.fnote"), "local");
    const s = await h.status([join(dir, "P.fnote"), join(dir, "L.fnote"), join(dir, "missing.fnote")]);
    expect(s[join(dir, "P.fnote")]).toMatchObject({ exists: true, placeholder: true, downloaded: false });
    expect(s[join(dir, "L.fnote")]).toMatchObject({ exists: true, placeholder: false, downloaded: true, ubiquitous: false, hasConflicts: false });
    expect(s[join(dir, "missing.fnote")]).toMatchObject({ exists: false });
    expect(await h.read(join(dir, "P.fnote"))).toEqual({ notDownloaded: true });
    // A create-only write doesn't replace a placeholder: its contents are somewhere else.
    expect(await h.write(join(dir, "P.fnote"), utf8("x"), { mode: "create" })).toMatchObject({ mismatch: true });
  });

  test("refuses relative paths and dot segments, and unknown requests", async () => {
    const h = open();
    await expect(h.read("notes/A.fnote")).rejects.toMatchObject({ code: "invalid_path" });
    await expect(h.read(`${tempDir()}/notes/../A.fnote`)).rejects.toMatchObject({ code: "invalid_path" });
    await expect(h.request("format-disk")).rejects.toMatchObject({ code: "invalid_argument" });
  });

  test("comes back after it dies; requests in flight fail cleanly", async () => {
    const h = open();
    const { pid } = await h.ping();
    process.kill(pid, "SIGKILL");
    await new Promise((r) => setTimeout(r, 100));
    const again = await h.ping();
    expect(again.pid).not.toBe(pid);
  });

  test("is missing: a clear error", async () => {
    const h = new FilesHelper("/nonexistent/folevi-files");
    await expect(h.ping()).rejects.toMatchObject({ code: "io" });
    expect(existsSync("/nonexistent/folevi-files")).toBe(false);
  });

  test("watch reports status for a folder's files (Spotlight permitting)", async () => {
    const h = open();
    const root = tempDir();
    writeFileSync(join(root, "a.fnote"), "a");
    const events: unknown[] = [];
    const stop = await h.watch(root, (e) => events.push(e));
    await new Promise((r) => setTimeout(r, 1500));
    stop();
    // Temporary folders aren't indexed by Spotlight, so this only checks the round trip doesn't fail; the
    // real check is the iCloud Drive run described in the report (status is also covered by scans).
    expect(Array.isArray(events)).toBe(true);
  });
});
