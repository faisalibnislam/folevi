// The page's `shell.library` calls, from preload.ts to the library service (docs/LOCAL_MODE_PLAN.md §4.1, §4.2).
// Every call is checked: it must come from the bundled interface's own page (`allowed`, main.ts's isAppUrl
// check), and every argument is validated here before the service sees it. Answers are envelopes,
// { ok: true, value } or { ok: false, error: { code, message } }, because an Error's code doesn't survive IPC
// or contextBridge; preload turns a failed one back into a rejection with `code` (local-store's isNotFound
// reads it). Change batches go to each watching page as "library:changes".
import type { LibraryService } from "./service";
import { errorCode, LibraryError, type LibraryChange, type LibraryKind } from "./types";

/** The channels preload.ts invokes (all `library:` + name). */
export const LIBRARY_CHANNELS = [
  "setup",
  "info",
  "list",
  "read",
  "write",
  "remove",
  "conflict-versions",
  "resolve-conflicts",
  "start-download",
  "watch",
  "unwatch",
  "journal-append",
  "journal-read",
  "journal-truncate",
  "unlock",
  "set-passphrase",
  "change-passphrase",
  "move",
] as const;

export const CHANGES_CHANNEL = "library:changes";

export type Envelope<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string; path?: string } };

/** The few parts of Electron's ipcMain and an event's sender this needs (fakes in tests). */
export interface IpcSender {
  id: number;
  send(channel: string, ...args: unknown[]): void;
  isDestroyed(): boolean;
  once(event: "destroyed", listener: () => void): unknown;
}
export interface IpcEvent {
  sender: IpcSender;
  senderFrame?: { url: string } | null;
}
export interface IpcMainLike {
  handle(channel: string, listener: (e: IpcEvent, ...args: unknown[]) => unknown): void;
  removeHandler(channel: string): void;
}

const KINDS: readonly LibraryKind[] = ["icloud", "folder", "device", "dropbox", "gdrive"];
const MAX_BYTES = 512 * 1024 * 1024;

const bad = (message: string) => new LibraryError("invalid_argument", message);

function str(v: unknown, what: string, max = 1024): string {
  if (typeof v !== "string" || v.length > max) throw bad(`${what} must be text.`);
  return v;
}

function bytes(v: unknown, max = MAX_BYTES): Uint8Array {
  if (!(v instanceof Uint8Array) || v.byteLength > max) throw bad("Bytes are needed.");
  return v;
}

function kindOf(v: unknown): LibraryKind {
  const kind = (v as { kind?: unknown } | null)?.kind;
  if (!KINDS.includes(kind as LibraryKind)) throw bad("kind is icloud, folder, device, dropbox or gdrive.");
  return kind as LibraryKind;
}

function ifMatchOf(v: unknown, allowNull: boolean): string | null | undefined {
  const m = (v as { ifMatch?: unknown } | null | undefined)?.ifMatch;
  if (m === undefined) return undefined;
  if (m === null && allowNull) return null;
  return str(m, "ifMatch", 200);
}

function strings(v: unknown, what: string, maxCount: number): string[] {
  if (!Array.isArray(v) || v.length > maxCount) throw bad(`${what} must be a list of at most ${maxCount}.`);
  return v.map((x) => str(x, what));
}

function fail(e: unknown): Envelope<never> {
  const code = errorCode(e) ?? "io";
  const message = e instanceof Error ? e.message : String(e);
  const path = (e as { path?: unknown })?.path;
  return { ok: false, error: { code, message, ...(typeof path === "string" ? { path } : {}) } };
}

/** Registers the handlers. Returns a function that removes them (and stops every page's watch). */
export function registerLibraryIpc(ipc: IpcMainLike, service: LibraryService, allowed: (e: IpcEvent) => boolean): () => void {
  const watchers = new Map<number, () => void>();

  const handle = (name: (typeof LIBRARY_CHANNELS)[number], work: (e: IpcEvent, ...args: unknown[]) => unknown) => {
    ipc.handle(`library:${name}`, async (e, ...args): Promise<Envelope<unknown>> => {
      if (!allowed(e)) return { ok: false, error: { code: "invalid_argument", message: "Not from Folevi." } };
      try {
        return { ok: true, value: (await work(e, ...args)) ?? null };
      } catch (error) {
        return fail(error);
      }
    });
  };

  handle("setup", (_e, o) => service.setup({ kind: kindOf(o) }));
  handle("info", () => service.info());
  handle("list", (_e, dir) => service.list(str(dir, "dir")));
  handle("read", (_e, path) => service.read(str(path, "path")));
  handle("write", (_e, path, data, o) => service.write(str(path, "path"), bytes(data), { ifMatch: ifMatchOf(o, true) }));
  handle("remove", (_e, path, o) => {
    const m = ifMatchOf(o, false);
    return service.remove(str(path, "path"), m === undefined ? {} : { ifMatch: m as string });
  });
  handle("conflict-versions", (_e, path) => service.conflictVersions(str(path, "path")));
  handle("resolve-conflicts", (_e, path, ids) => service.resolveConflicts(str(path, "path"), strings(ids, "ids", 1000)));
  handle("start-download", (_e, paths) => service.startDownload(strings(paths, "paths", 100_000)));
  handle("watch", (e) => {
    const sender = e.sender;
    if (watchers.has(sender.id)) return true;
    const off = service.watch((changes: LibraryChange[]) => {
      if (!sender.isDestroyed()) sender.send(CHANGES_CHANNEL, changes);
    });
    watchers.set(sender.id, off);
    sender.once("destroyed", () => {
      watchers.get(sender.id)?.();
      watchers.delete(sender.id);
    });
    return true;
  });
  handle("unwatch", (e) => {
    watchers.get(e.sender.id)?.();
    watchers.delete(e.sender.id);
    return true;
  });
  handle("journal-append", (_e, record) => service.journal().append(bytes(record, 16 * 1024 * 1024)));
  handle("journal-read", () => service.journal().readAll());
  handle("journal-truncate", (_e, n) => {
    if (!Number.isInteger(n) || (n as number) < 0) throw bad("truncate takes a whole number.");
    return service.journal().truncate(n as number);
  });
  handle("unlock", (_e, p) => service.unlock(str(p, "passphrase")));
  handle("set-passphrase", (_e, p) => service.setPassphrase(p === null ? null : str(p, "passphrase")));
  handle("change-passphrase", (_e, a, b) => service.changePassphrase(str(a, "passphrase"), str(b, "passphrase")));
  handle("move", (_e, to) => service.move({ kind: kindOf(to) }));

  return () => {
    for (const name of LIBRARY_CHANNELS) ipc.removeHandler(`library:${name}`);
    for (const off of watchers.values()) off();
    watchers.clear();
  };
}
