// The handover to the native Folevi for Mac (docs/MAC_WEBKIT_PLAN.md §8.3, Electron 1.22). The native app shows the
// same interface in WebKit, whose storage can't read Chromium's: edits this app hasn't sent yet (an account's
// outbox, sync ops, waiting uploads, the journals written as a tab closed) would stay behind in Chromium's
// IndexedDB. So this app writes them out as files the native app imports on its first launch
// (apps/mac/Folevi/Migration/HandoverImport.swift), with the same kit the one-time handoff uses (handoffKit.ts):
//
//   userData/handover/index.json   { v: 1, createdAt, appVersion, dbVersion, origin, databases: [{ name, version,
//                                    schema, pending, counts, chunks: [{ store, file, records, sha256 }] }],
//                                    storage: { file, entries, sha256 } | null }
//   userData/handover/0001.json    one chunk as the kit's readChunk wrote it (tagged JSON records)
//   userData/handover/storage.json the localStorage entries ([key, value][]) the native app doesn't have yet
//
// Only databases with work not yet sent go in (handoff.ts `pendingAccounts`); a folder with no databases says this
// app quit with nothing waiting. It's written as the app quits (every quit, so a native app installed by hand finds
// it too) and before an update installs, after waiting for the normal sync to send what it can (`waitForSync`).
// It's written whole into a temporary folder and renamed into place, so a half-written handover never exists.
// This app removes a handover it finds at launch (it's still running, so its own storage is the truth).
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { handOver, pendingAccounts, type KitCall } from "./handoff";
import type { DatabaseInventory, Inventory } from "./handoffKit";

export const HANDOVER_DIR = "handover";

export interface HandoverChunk {
  store: string;
  file: string;
  records: number;
  sha256: string;
}

export interface HandoverDatabase {
  name: string;
  version: number;
  schema: DatabaseInventory;
  pending: DatabaseInventory["pending"];
  counts: Record<string, number>;
  chunks: HandoverChunk[];
}

export interface HandoverIndex {
  v: 1;
  createdAt: number;
  appVersion: string;
  /** The IndexedDB schema version this app's interface opens (shell/build.json), for the record. */
  dbVersion: number | null;
  origin: string;
  databases: HandoverDatabase[];
  storage: { file: string; entries: number; sha256: string } | null;
}

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

/**
 * The kit's write side as files: handOver() copies into it as it would into another origin. Every database is new
 * here ("created"), each chunk becomes a file, and `counts` answers what was written, so handOver's check that
 * every record arrived holds for the files too.
 */
export function fileSink(dir: string): { call: KitCall; databases: HandoverDatabase[]; storage: () => HandoverIndex["storage"] } {
  const databases: HandoverDatabase[] = [];
  let storage: HandoverIndex["storage"] = null;
  let n = 0;
  const byName = (name: unknown) => {
    const db = databases.find((d) => d.name === name);
    if (!db) throw new Error(`No database ${String(name)}`);
    return db;
  };
  const call: KitCall = async (fn, ...args) => {
    switch (fn) {
      case "prepare": {
        const schema = JSON.parse(args[0] as string) as DatabaseInventory;
        databases.push({ name: schema.name, version: schema.version, schema, pending: schema.pending, counts: Object.fromEntries(schema.stores.map((s) => [s.name, 0])), chunks: [] });
        return "created";
      }
      case "writeChunk": {
        const [name, store, text] = args as [string, string, string];
        const db = byName(name);
        const records = (JSON.parse(text) as { records: unknown[] }).records.length;
        const file = `${String(++n).padStart(4, "0")}.json`;
        writeFileSync(join(dir, file), text, { mode: 0o600 });
        db.chunks.push({ store, file, records, sha256: sha256(text) });
        db.counts[store] = (db.counts[store] ?? 0) + records;
        return records;
      }
      case "counts":
        return JSON.stringify(byName(args[0]).counts);
      case "writeStorage": {
        const text = args[0] as string;
        const entries = (JSON.parse(text) as unknown[]).length;
        writeFileSync(join(dir, "storage.json"), text, { mode: 0o600 });
        storage = { file: "storage.json", entries, sha256: sha256(text) };
        return entries;
      }
      default:
        throw new Error(`The handover doesn't read (${fn})`);
    }
  };
  return { call, databases, storage: () => storage };
}

/**
 * Writes the handover for the native app into `<userData>/handover`: the account databases of `from` (a page on
 * the app's origin running the kit) that still hold unsent work, and their journals.
 */
export async function writeHandover(from: KitCall, userData: string, o: { appVersion: string; dbVersion?: number | null; origin: string; now?: () => number; budget?: number }): Promise<HandoverIndex> {
  const target = join(userData, HANDOVER_DIR);
  const tmp = `${target}.${process.pid}.tmp`;
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true, mode: 0o700 });
  try {
    const sink = fileSink(tmp);
    // dbVersion null: the native app decides about databases newer than its interface (it asks for an update).
    await handOver(from, sink.call, { budget: o.budget, dbVersion: null });
    const index: HandoverIndex = {
      v: 1,
      createdAt: (o.now ?? Date.now)(),
      appVersion: o.appVersion,
      dbVersion: o.dbVersion ?? null,
      origin: o.origin,
      databases: sink.databases,
      storage: sink.storage(),
    };
    writeFileSync(join(tmp, "index.json"), `${JSON.stringify(index, null, 2)}\n`, { mode: 0o600 });
    rmSync(target, { recursive: true, force: true });
    mkdirSync(dirname(target), { recursive: true });
    renameSync(tmp, target);
    return index;
  } catch (e) {
    rmSync(tmp, { recursive: true, force: true });
    throw e;
  }
}

/** How many accounts still have work this app hasn't sent (in their database, or in a journal written as a tab closed). */
export function pendingWork(inv: Inventory): number {
  return pendingAccounts(inv).size;
}

/**
 * Waits for the normal sync to send what's waiting (before an update installs): checks every `intervalMs` until
 * nothing is waiting or `timeoutMs` passed. True when nothing is left.
 */
export async function waitForSync(from: KitCall, o: { timeoutMs?: number; intervalMs?: number; now?: () => number; sleep?: (ms: number) => Promise<void>; onWaiting?: (n: number) => void } = {}): Promise<boolean> {
  const now = o.now ?? Date.now;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const end = now() + (o.timeoutMs ?? 10 * 60_000);
  for (;;) {
    const n = pendingWork(JSON.parse((await from("inventory", "folevi-")) as string) as Inventory);
    if (n === 0) return true;
    o.onWaiting?.(n);
    if (now() >= end) return false;
    await sleep(o.intervalMs ?? 15_000);
  }
}

/** A handover this app left earlier (it's running again, so its own storage is the truth): removed. */
export function removeStaleHandover(userData: string): boolean {
  const target = join(userData, HANDOVER_DIR);
  if (!existsSync(target)) return false;
  rmSync(target, { recursive: true, force: true });
  return true;
}
