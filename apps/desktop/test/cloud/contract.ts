// The LocalFs contract (packages/local-store/src/io.ts) for a cloud LocalFs, run against each fake provider:
// etags, ifMatch (string, null, undefined), conditional removes, missing files, path rules, listings, large
// files with cut-off chunks, rate limits and server errors, lagging listings, read-merge-write between two
// devices, and the device copy saving downloads.
import { describe, expect, test } from "vitest";
import { isNotFound, readMergeWrite, type Codec, type LocalFs as StoreFs } from "../../../../packages/local-store/src";
import type { CloudFs } from "../../src/library/cloud/shared/cloudFs";
import type { MemoryMirror } from "../../src/library/cloud/shared/mirror";
import type { LocalFs } from "../../src/library/cloud/shared/types";
import type { FaultInjector, FakeFaultRates } from "./fakeCommon";

export interface ContractEnv {
  /** A new device on the same cloud (optionally on an existing device copy: a restart). */
  device(mirror?: MemoryMirror): { fs: CloudFs & LocalFs; mirror: MemoryMirror; injector: FaultInjector };
  /** What the cloud holds at a path. */
  cloudFile(path: string): Uint8Array | undefined;
  setFaults(f: Partial<FakeFaultRates>): void;
  settle(): void;
  /** Download requests the fake served. */
  /** Content downloads the fake served. */
  downloads(): number;
}

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);
const NOTE = "notes/01J9ZDOC000000000000000001.fnote";
const NOTE2 = "notes/01J9ZDOC000000000000000002.fnote";

async function readText(fs: LocalFs, path: string): Promise<{ text: string; etag: string }> {
  const r = await fs.read(path);
  if ("notDownloaded" in r) throw new Error("placeholder");
  return { text: dec(r.bytes), etag: r.etag };
}

async function rejectsWith(p: Promise<unknown>, code: string) {
  const error = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error, `expected a ${code} rejection`).not.toBeNull();
  expect((error as { code?: string }).code).toBe(code);
}

/** A set of words; merge is union (commutative, idempotent), like the real codecs. */
const words: Codec<string[]> = {
  decode: (b) => {
    const v = JSON.parse(dec(b));
    if (!Array.isArray(v)) throw new Error("not words");
    return v;
  },
  encode: (v) => enc(JSON.stringify([...new Set(v)].sort())),
  merge: (a, b) => [...new Set([...a, ...b])].sort(),
};

export function runContract(name: string, makeEnv: () => ContractEnv) {
  describe(`${name}: the LocalFs contract`, () => {
    test("a missing file is not_found; a removed one too", async () => {
      const env = makeEnv();
      const { fs } = env.device();
      const missing = await fs.read(NOTE).then(
        () => null,
        (e: unknown) => e,
      );
      expect(isNotFound(missing)).toBe(true);
      await fs.write(NOTE, enc("a"), { ifMatch: null });
      await fs.remove(NOTE);
      await rejectsWith(fs.read(NOTE), "not_found");
      await fs.remove(NOTE); // removing a missing file is fine
      expect((await fs.list("notes")).map((e) => e.path)).toEqual([]);
    });

    test("create, read and list carry the same etag; nested folders work", async () => {
      const env = makeEnv();
      const { fs } = env.device();
      const w = await fs.write(NOTE, enc("hello"), { ifMatch: null });
      expect("etag" in w && !("mismatch" in w)).toBe(true);
      const etag = (w as { etag: string }).etag;
      expect(await readText(fs, NOTE)).toEqual({ text: "hello", etag });
      await fs.write("history/01J9ZDOC000000000000000001/0abc-D1-auto.fver", enc("v"), { ifMatch: null });
      await fs.write("files/ab/ab0123456789abcdef", enc("bytes"), { ifMatch: null });
      await fs.write("folevi-library.json", enc("{}"), { ifMatch: null });
      const all = await fs.list("");
      expect(all.map((e) => e.path)).toEqual(["files/ab/ab0123456789abcdef", "folevi-library.json", "history/01J9ZDOC000000000000000001/0abc-D1-auto.fver", NOTE]);
      const note = all.find((e) => e.path === NOTE)!;
      expect(note).toMatchObject({ etag, size: 5, downloaded: true, hasConflicts: false });
      expect((await fs.list("notes")).map((e) => e.path)).toEqual([NOTE]);
      expect((await fs.list("history")).length).toBe(1);
      expect(dec(env.cloudFile(NOTE)!)).toBe("hello");
    });

    test("ifMatch: null creates only; a string writes only over that etag; undefined always writes", async () => {
      const env = makeEnv();
      const { fs } = env.device();
      const first = (await fs.write(NOTE, enc("one"), { ifMatch: null })) as { etag: string };
      const again = await fs.write(NOTE, enc("two"), { ifMatch: null });
      expect(again).toEqual({ mismatch: true, etag: first.etag });
      const second = (await fs.write(NOTE, enc("two"), { ifMatch: first.etag })) as { etag: string };
      expect(second.etag).not.toBe(first.etag);
      const stale = await fs.write(NOTE, enc("three"), { ifMatch: first.etag });
      expect(stale).toEqual({ mismatch: true, etag: second.etag });
      expect(dec(env.cloudFile(NOTE)!)).toBe("two");
      const forced = (await fs.write(NOTE, enc("four"), {})) as { etag: string };
      expect(forced.etag).not.toBe(second.etag);
      const fresh = (await fs.write(NOTE2, enc("new"), {})) as { etag: string };
      expect(typeof fresh.etag).toBe("string");
      expect(dec(env.cloudFile(NOTE)!)).toBe("four");
      // An etag from nowhere never matches.
      expect("mismatch" in (await fs.write(NOTE, enc("x"), { ifMatch: "nonsense" }))).toBe(true);
      expect("mismatch" in (await fs.write("notes/01J9ZDOC000000000000000003.fnote", enc("x"), { ifMatch: first.etag }))).toBe(true);
    });

    test("conditional removes", async () => {
      const env = makeEnv();
      const { fs } = env.device();
      const a = (await fs.write(NOTE, enc("one"), { ifMatch: null })) as { etag: string };
      const b = (await fs.write(NOTE, enc("two"), { ifMatch: a.etag })) as { etag: string };
      await rejectsWith(fs.remove(NOTE, { ifMatch: a.etag }), "mismatch");
      expect(dec(env.cloudFile(NOTE)!)).toBe("two");
      await fs.remove(NOTE, { ifMatch: b.etag });
      expect(env.cloudFile(NOTE)).toBeUndefined();
    });

    test("paths are checked", async () => {
      const env = makeEnv();
      const { fs } = env.device();
      for (const bad of ["../x", "/notes/a", "notes/", "a//b", "notes/\u0001", "a\\b", ""]) {
        await rejectsWith(fs.read(bad), "invalid_path");
        await rejectsWith(fs.write(bad, enc("x"), {}), "invalid_path");
      }
      await rejectsWith(fs.list("../up"), "invalid_path");
    });

    test("another device's changes show up with new etags", async () => {
      const env = makeEnv();
      const a = env.device().fs;
      const b = env.device().fs;
      await a.write(NOTE, enc("from a"), { ifMatch: null });
      const seen = await b.list("notes");
      expect(seen.map((e) => e.path)).toEqual([NOTE]);
      expect((await readText(b, NOTE)).text).toBe("from a");
      const w = (await b.write(NOTE, enc("from b"), { ifMatch: seen[0]!.etag })) as { etag: string };
      const again = await a.list("notes");
      expect(again[0]!.etag).toBe(w.etag);
      expect(await readText(a, NOTE)).toEqual({ text: "from b", etag: w.etag });
      await b.remove(NOTE);
      expect(await a.list("notes")).toEqual([]);
    });

    test("large files go up in pieces, also when chunks are cut off", async () => {
      const env = makeEnv();
      const { fs, injector } = env.device();
      const big = new Uint8Array(10_000);
      for (let i = 0; i < big.length; i++) big[i] = (i * 31 + 7) % 251;
      env.setFaults({ partial: 0.5 });
      const w = (await fs.write("files/cd/cd0123456789abcdef", big, { ifMatch: null })) as { etag: string };
      expect(injector.stats.partial).toBeGreaterThan(0);
      env.setFaults({});
      expect(env.cloudFile("files/cd/cd0123456789abcdef")).toEqual(big);
      const other = env.device().fs;
      const r = await other.read("files/cd/cd0123456789abcdef");
      expect("bytes" in r && r.bytes).toEqual(big);
      expect("etag" in r && r.etag).toBe(w.etag);
      // An update of a large file, conditional.
      big[0] = 1;
      const w2 = await fs.write("files/cd/cd0123456789abcdef", big, { ifMatch: w.etag });
      expect("mismatch" in w2).toBe(false);
      expect(env.cloudFile("files/cd/cd0123456789abcdef")![0]).toBe(1);
    });

    test("rate limits, server errors and dropped connections are retried", async () => {
      const env = makeEnv();
      const { fs, injector } = env.device();
      env.setFaults({ rateLimit: 0.3, serverError: 0.3, network: 0.2 });
      let etag: string | null = null;
      for (let i = 0; i < 15; i++) {
        const w = (await fs.write(NOTE, enc(`v${i}`), { ifMatch: etag })) as { etag: string };
        expect("mismatch" in w).toBe(false);
        etag = w.etag;
      }
      env.setFaults({});
      expect(dec(env.cloudFile(NOTE)!)).toBe("v14");
      expect(injector.stats.rateLimited + injector.stats.serverErrors + injector.stats.dropped).toBeGreaterThan(3);
    });

    test("a lagging listing catches up; reads stay correct meanwhile", async () => {
      const env = makeEnv();
      const a = env.device().fs;
      const b = env.device().fs;
      await b.list(""); // b has an index
      env.setFaults({ lag: 1 });
      await a.write(NOTE, enc("late"), { ifMatch: null });
      expect((await b.list("notes")).map((e) => e.path)).toEqual([]);
      env.settle();
      const now = await b.list("notes");
      expect(now.map((e) => e.path)).toEqual([NOTE]);
      expect((await readText(b, NOTE)).text).toBe("late");
    });

    test("read-merge-write between two devices loses nothing", async () => {
      const env = makeEnv();
      const a = env.device().fs as unknown as StoreFs;
      const b = env.device().fs as unknown as StoreFs;
      await readMergeWrite(a, NOTE, words, ["a1"]);
      // b reads, then a writes in between, then b's conditional write must not win blindly.
      const r = await b.read(NOTE);
      await readMergeWrite(a, NOTE, words, ["a1", "a2"]);
      const blind = await b.write(NOTE, words.encode(["b1"]), { ifMatch: "etag" in r ? r.etag : null });
      expect("mismatch" in blind).toBe(true);
      const result = await readMergeWrite(b, NOTE, words, ["b1"]);
      expect(result.status).toBe("written");
      expect(words.decode(env.cloudFile(NOTE)!)).toEqual(["a1", "a2", "b1"]);
    });

    test("unchanged files aren't downloaded twice; attachments come from the device copy", async () => {
      const env = makeEnv();
      const a = env.device().fs;
      await a.write(NOTE, enc("x"), { ifMatch: null });
      await a.write("files/ef/ef0123456789abcdef", enc("pic"), { ifMatch: null });
      const { fs: b, mirror } = env.device();
      await b.list("");
      const before = env.downloads();
      await b.read(NOTE);
      await b.read("files/ef/ef0123456789abcdef");
      expect(env.downloads()).toBe(before + 2);
      await b.read(NOTE);
      await b.read("files/ef/ef0123456789abcdef");
      expect(env.downloads()).toBe(before + 2);
      expect(dec((await mirror.readFile(NOTE))!.bytes)).toBe("x");
    });

    test("the index and cursor survive a restart", async () => {
      const env = makeEnv();
      const { fs, mirror } = env.device();
      await fs.write(NOTE, enc("x"), { ifMatch: null });
      await fs.list("");
      await new Promise((r) => setTimeout(r, 0));
      expect(mirror.state).not.toBeNull();
      // The same device copy, a new process: it opens the saved index and reads without downloading.
      const restarted = env.device(mirror);
      expect(await restarted.fs.open()).toBe(true);
      expect(restarted.fs.indexedPaths()).toEqual([NOTE]);
      const before = env.downloads();
      expect((await readText(restarted.fs, NOTE)).text).toBe("x");
      expect(env.downloads()).toBe(before);
    });
  });
}
