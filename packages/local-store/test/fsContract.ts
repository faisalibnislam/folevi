// Runs fixtures/fs-contract.json against a LocalFs (WP9). Used by fs-contract.test.ts (MemoryFs, EncryptedFs)
// and by apps/desktop's library tests (the Mac's NodeFs). No test framework inside: it throws on the first
// difference, naming the case and step.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { LocalFs } from "../src/io";

export interface ContractHooks {
  /** Turns a file into a cloud placeholder. */
  evict?(path: string): Promise<void>;
  /** A provider writing the file behind the file layer's back. */
  put?(path: string, bytes: Uint8Array): Promise<void>;
  /** Adds an NSFileVersion-style conflict version. */
  addConflictVersion?(path: string, bytes: Uint8Array): Promise<void>;
}

export interface ContractTarget {
  fs: LocalFs;
  hooks?: ContractHooks;
  cleanup?(): Promise<void>;
}

type Step = Record<string, unknown> & { op: string; path?: string };
interface Case {
  name: string;
  requires?: (keyof ContractHooks)[];
  steps: Step[];
}
export interface Contract {
  invalidPaths: string[];
  cases: Case[];
}

export function loadContract(): Contract {
  return JSON.parse(readFileSync(resolve(__dirname, "../fixtures/fs-contract.json"), "utf8")) as Contract;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

function bytesOf(step: Step): Uint8Array {
  if (typeof step.hex === "string") {
    const out = new Uint8Array(step.hex.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(step.hex.slice(i * 2, i * 2 + 2), 16);
    return out;
  }
  return enc.encode(String(step.text ?? ""));
}

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");

function codeOf(e: unknown): unknown {
  return (e as { code?: unknown } | null)?.code;
}

export async function runContractCase(c: Case, target: ContractTarget): Promise<void> {
  const { fs } = target;
  const saved = new Map<string, string>();
  const ids = new Map<string, string[]>();
  const ref = (v: unknown) => (typeof v === "string" && v.startsWith("$") ? saved.get(v.slice(1)) : v);
  for (const [i, step] of c.steps.entries()) {
    const where = `${c.name}, step ${i + 1} (${step.op} ${step.path ?? step.dir ?? ""})`;
    const fail = (msg: string): never => {
      throw new Error(`${where}: ${msg}`);
    };
    const checkEtag = (etag: string) => {
      if ("etagIs" in step && etag !== ref(step.etagIs)) fail(`etag ${etag} is not ${String(ref(step.etagIs))}`);
      if ("etagNot" in step && etag === ref(step.etagNot)) fail(`etag ${etag} should have changed`);
      if (typeof step.save === "string") saved.set(step.save, etag);
    };
    switch (step.op) {
      case "write": {
        const o: { ifMatch?: string | null } = {};
        if ("ifMatch" in step) o.ifMatch = step.ifMatch === null ? null : (ref(step.ifMatch) as string);
        const r = await fs.write(step.path!, bytesOf(step), o);
        const mismatch = "mismatch" in r;
        if ((step.expect === "mismatch") !== mismatch) fail(`expected ${String(step.expect)}, got ${JSON.stringify(r)}`);
        checkEtag(r.etag);
        break;
      }
      case "read": {
        let r: Awaited<ReturnType<LocalFs["read"]>> | null = null;
        try {
          r = await fs.read(step.path!);
        } catch (e) {
          if (step.expect === "not_found" && codeOf(e) === "not_found") break;
          fail(`threw ${String(codeOf(e))}: ${(e as Error).message}`);
        }
        if (step.expect === "not_found") fail(`expected not_found, got ${JSON.stringify(r)}`);
        if (step.expect === "notDownloaded") {
          if (!r || !("notDownloaded" in r)) fail("expected notDownloaded");
          break;
        }
        if (!r || "notDownloaded" in r) fail("expected bytes, got notDownloaded");
        const got = (r as { bytes: Uint8Array }).bytes;
        if ("text" in step && dec.decode(got) !== step.text) fail(`read ${JSON.stringify(dec.decode(got))}, not ${JSON.stringify(step.text)}`);
        if ("hex" in step && hex(got) !== step.hex) fail(`read ${hex(got)}, not ${String(step.hex)}`);
        checkEtag((r as { etag: string }).etag);
        break;
      }
      case "remove": {
        const o = "ifMatch" in step ? { ifMatch: ref(step.ifMatch) as string } : undefined;
        try {
          await fs.remove(step.path!, o);
          if (step.expect === "mismatch") fail("expected mismatch");
        } catch (e) {
          if (step.expect !== "mismatch" || codeOf(e) !== "mismatch") fail(`threw ${String(codeOf(e))}: ${(e as Error).message}`);
        }
        break;
      }
      case "list": {
        const entries = await fs.list(String(step.dir ?? ""));
        // Any order (an encrypted layer lists in on-disk name order).
        const paths = entries.map((e) => e.path).sort();
        if (JSON.stringify(paths) !== JSON.stringify([...(step.paths as string[])].sort())) fail(`listed ${JSON.stringify(paths)}`);
        const by = new Map(entries.map((e) => [e.path, e]));
        for (const [p, want] of Object.entries((step.etags ?? {}) as Record<string, string>)) if (by.get(p)?.etag !== ref(want)) fail(`etag of ${p} is ${by.get(p)?.etag}`);
        for (const [p, want] of Object.entries((step.downloaded ?? {}) as Record<string, boolean>)) if (by.get(p)?.downloaded !== want) fail(`downloaded of ${p} is ${by.get(p)?.downloaded}`);
        for (const [p, want] of Object.entries((step.hasConflicts ?? {}) as Record<string, boolean>))
          if (by.get(p)?.hasConflicts !== want) fail(`hasConflicts of ${p} is ${by.get(p)?.hasConflicts}`);
        for (const e of entries) if (typeof e.size !== "number" || typeof e.mtimeMs !== "number" || typeof e.etag !== "string" || !e.etag) fail(`bad entry ${JSON.stringify(e)}`);
        break;
      }
      case "conflictVersions": {
        const vs = await fs.conflictVersions(step.path!);
        const texts = vs.map((v) => dec.decode(v.bytes)).sort();
        if (JSON.stringify(texts) !== JSON.stringify([...(step.texts as string[])].sort())) fail(`versions ${JSON.stringify(texts)}`);
        if (typeof step.saveIds === "string") ids.set(step.saveIds, vs.map((v) => v.id));
        break;
      }
      case "resolveConflicts": {
        const list = typeof step.ids === "string" ? (ids.get(step.ids.slice(1)) ?? []) : (step.ids as string[]);
        await fs.resolveConflicts(step.path!, list);
        break;
      }
      case "hook.evict":
        await target.hooks!.evict!(step.path!);
        break;
      case "hook.put":
        await target.hooks!.put!(step.path!, bytesOf(step));
        break;
      case "hook.addConflictVersion":
        await target.hooks!.addConflictVersion!(step.path!, bytesOf(step));
        break;
      default:
        fail("unknown step");
    }
  }
}

/** Every invalid path is refused by read, write, remove and list with code invalid_path. */
export async function runInvalidPaths(fs: LocalFs, paths: string[]): Promise<void> {
  for (const p of paths) {
    const attempts: [string, () => Promise<unknown>][] = [
      ["read", () => fs.read(p)],
      ["write", () => fs.write(p, enc.encode("x"), {})],
      ["remove", () => fs.remove(p)],
    ];
    if (p !== "") attempts.push(["list", () => fs.list(p)]);
    for (const [op, run] of attempts) {
      let code: unknown = "none";
      try {
        await run();
      } catch (e) {
        code = codeOf(e) ?? (e as Error).name;
      }
      if (code !== "invalid_path" && code !== "PathError") throw new Error(`${op}(${JSON.stringify(p)}) gave ${String(code)}, not invalid_path`);
    }
  }
}

/** Runs every case on a fresh target from `make`; returns the cases skipped for want of hooks. */
export async function runFsContract(make: () => Promise<ContractTarget>, contract: Contract = loadContract()): Promise<{ ran: string[]; skipped: string[] }> {
  const ran: string[] = [];
  const skipped: string[] = [];
  for (const c of contract.cases) {
    const target = await make();
    try {
      if ((c.requires ?? []).some((h) => !target.hooks?.[h])) {
        skipped.push(c.name);
        continue;
      }
      await runContractCase(c, target);
      ran.push(c.name);
    } finally {
      await target.cleanup?.();
    }
  }
  const target = await make();
  try {
    await runInvalidPaths(target.fs, contract.invalidPaths);
  } finally {
    await target.cleanup?.();
  }
  return { ran, skipped };
}
