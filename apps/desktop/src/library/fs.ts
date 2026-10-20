// The library's files on the Mac: local-store's `LocalFs` over a folder (docs/LOCAL_MODE_PLAN.md §3.6, §4.2).
//
// - Paths are checked (relative, forward slashes, no `..`, no control characters) and can't leave the folder,
//   whatever symlinks it holds.
// - Etags are inode + size + mtime in nanoseconds: an atomic replace always makes a new inode.
// - Plain folders: a write goes to `.folevi-tmp/`, is fsync'd (F_FULLFSYNC through libuv) and renamed over
//   the file, and the folder is fsync'd. `ifMatch: null` (create only) links the temp file in place, so it
//   can't replace a file that appeared meanwhile, even one another app wrote. A string `ifMatch` is checked
//   under a lock shared by every NodeFs in this process, and again just before the rename.
// - iCloud Drive and File Provider folders (Dropbox, Google Drive, OneDrive, Box under ~/Library/CloudStorage):
//   reads, writes and removes go through folevi-files (NSFileCoordinator), which checks `ifMatch` inside the
//   coordinated block; placeholders and NSFileVersion conflicts come from it too.
// - Listing skips hidden and temporary files, reports `.name.icloud` placeholders as the file they stand for
//   with `downloaded: false`, and never follows symlinks.
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, mkdir, open, readdir, realpath, rename, rmdir, stat, unlink } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import type { Coordinator, HelperStat, ItemStatus } from "./helper";
import { checkDir, checkPath, fromPlaceholderName, isValidLibraryPath, placeholderName, TMP_DIR } from "./paths";
import { LibraryError, type LibraryFs, type LocalFsEntry, type ReadResult, type WriteResult } from "./types";

export interface NodeFsOptions {
  /** The library folder (absolute). */
  root: string;
  /** Coordinated I/O for iCloud Drive and File Provider folders; plain folders use Node directly. */
  coordinator?: Coordinator | null;
  /** Called after each successful write or remove by this NodeFs (the watcher doesn't echo them back). */
  onOwnChange?: (path: string, entry: LocalFsEntry | null) => void;
}

/** Names never listed: our temp folder, Finder's and the providers' own files. */
const IGNORED = new Set([TMP_DIR, ".DS_Store", ".dropbox", ".dropbox.attr", ".dropbox.cache", "Icon\r", ".tmp.drivedownload", ".tmp.driveupload", ".Trash"]);

type BigStat = { ino: bigint; size: bigint; mtimeNs: bigint; mtimeMs: number };

export function etagOf(s: { ino: bigint | string; size: bigint | number; mtimeNs: bigint | string }): string {
  return `${BigInt(s.ino).toString(36)}-${BigInt(s.size).toString(36)}-${BigInt(s.mtimeNs).toString(36)}`;
}

/** The parts of an etag, for a coordinated compare-and-swap; null if it isn't one of ours. */
export function parseEtag(etag: string): HelperStat | null {
  const m = /^([0-9a-z]+)-([0-9a-z]+)-([0-9a-z]+)$/.exec(etag);
  if (!m) return null;
  const n = (s: string) => {
    let v = 0n;
    for (const ch of s) v = v * 36n + BigInt(parseInt(ch, 36));
    return v;
  };
  return { ino: n(m[1]!).toString(), size: Number(n(m[2]!)), mtimeNs: n(m[3]!).toString() };
}

const helperEtag = (s: HelperStat) => etagOf({ ino: s.ino, size: BigInt(s.size), mtimeNs: s.mtimeNs });

// ---------------------------------------------------------------- locks shared by every NodeFs in the process

const locks = new Map<string, Promise<void>>();

/** Runs `work` alone for one key (an absolute path): concurrent writers in this process take turns. */
export async function withPathLock<T>(key: string, work: () => Promise<T>): Promise<T> {
  const before = locks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((r) => (release = r));
  const chained = before.then(() => mine);
  locks.set(key, chained);
  await before;
  try {
    return await work();
  } finally {
    release();
    if (locks.get(key) === chained) locks.delete(key);
  }
}

async function bigStat(path: string): Promise<BigStat | null> {
  try {
    const s = await lstat(path, { bigint: true });
    if (!s.isFile()) return null;
    return { ino: s.ino, size: s.size, mtimeNs: s.mtimeNs, mtimeMs: Number(s.mtimeMs) };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT" || (e as NodeJS.ErrnoException).code === "ENOTDIR") return null;
    throw e;
  }
}

async function fsyncDir(dir: string) {
  try {
    const fh = await open(dir, constants.O_RDONLY);
    try {
      await fh.sync();
    } finally {
      await fh.close();
    }
  } catch {
    // Some file systems refuse to fsync a directory; the rename itself is still atomic.
  }
}

function ioError(e: unknown, path: string): LibraryError {
  if (e instanceof LibraryError) return e;
  const code = (e as NodeJS.ErrnoException).code;
  if (code === "ENOENT") return new LibraryError("not_found", `No such file: ${path}`, path);
  return new LibraryError("io", `${(e as Error).message ?? e}`, path);
}

export class NodeFs implements LibraryFs {
  readonly root: string;
  private realRoot: string | null = null;
  readonly coordinator: Coordinator | null;
  private readonly onOwnChange?: NodeFsOptions["onOwnChange"];

  constructor(o: NodeFsOptions) {
    this.root = o.root.replace(/\/+$/, "") || "/";
    this.coordinator = o.coordinator ?? null;
    this.onOwnChange = o.onOwnChange;
  }

  get coordinated(): boolean {
    return this.coordinator !== null;
  }

  private async rootReal(): Promise<string> {
    if (this.realRoot) return this.realRoot;
    try {
      this.realRoot = await realpath(this.root);
    } catch (e) {
      throw new LibraryError("io", `The library folder isn't there: ${(e as Error).message}`);
    }
    return this.realRoot;
  }

  /** The absolute path for a library path, after checking that no symlink on the way leads out of the folder. */
  async abs(path: string): Promise<string> {
    checkPath(path);
    const root = await this.rootReal();
    const full = join(root, ...path.split("/"));
    // The deepest folder on the way that exists must resolve inside the library.
    let dir = dirname(full);
    for (;;) {
      try {
        const real = await realpath(dir);
        if (real !== root && !real.startsWith(root + sep)) throw new LibraryError("invalid_path", `Outside the library: ${path}`, path);
        break;
      } catch (e) {
        if (e instanceof LibraryError) throw e;
        if (dir === root || dir.length <= root.length) break;
        dir = dirname(dir);
      }
    }
    // The file itself must not be a symlink.
    try {
      const s = await lstat(full);
      if (s.isSymbolicLink()) throw new LibraryError("invalid_path", `A link, not a file: ${path}`, path);
    } catch (e) {
      if (e instanceof LibraryError) throw e;
    }
    return full;
  }

  private placeholderOf(abs: string): string {
    return join(dirname(abs), placeholderName(abs.slice(abs.lastIndexOf(sep) + 1)));
  }

  // ---------------------------------------------------------------- list

  async list(dir: string): Promise<LocalFsEntry[]> {
    checkDir(dir);
    const root = await this.rootReal();
    const start = dir === "" ? root : await this.abs(dir);
    const files: { path: string; abs: string; placeholder: boolean }[] = [];
    const walk = async (absDir: string) => {
      let names: string[];
      try {
        names = await readdir(absDir);
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code;
        if (code === "ENOENT" || code === "ENOTDIR") return;
        throw ioError(e, relative(root, absDir));
      }
      for (const name of names) {
        if (IGNORED.has(name)) continue;
        const abs = join(absDir, name);
        const real = fromPlaceholderName(name);
        if (name.startsWith(".") && !real) continue;
        let s;
        try {
          s = await lstat(abs);
        } catch {
          continue;
        }
        if (s.isSymbolicLink()) continue;
        if (s.isDirectory()) {
          if (!real) await walk(abs);
          continue;
        }
        if (!s.isFile()) continue;
        const shown = real ? join(absDir, real) : abs;
        const path = relative(root, shown).split(sep).join("/");
        if (!isValidLibraryPath(path)) continue;
        files.push({ path, abs, placeholder: !!real });
      }
    };
    await walk(start);
    // A placeholder and its downloaded file both present: the file wins.
    const byPath = new Map<string, (typeof files)[number]>();
    for (const f of files) if (!byPath.has(f.path) || !f.placeholder) byPath.set(f.path, f);
    const status = this.coordinator && byPath.size ? await this.coordinator.status([...byPath.values()].filter((f) => !f.placeholder).map((f) => f.abs)).catch(() => ({}) as Record<string, ItemStatus>) : null;
    const out: LocalFsEntry[] = [];
    for (const f of byPath.values()) {
      const s = await bigStat(f.abs);
      if (!s) continue;
      const st = status?.[f.abs];
      out.push({
        path: f.path,
        size: f.placeholder ? 0 : Number(s.size),
        mtimeMs: s.mtimeMs,
        etag: f.placeholder ? `p${etagOf(s)}` : etagOf(s),
        downloaded: !f.placeholder && (st ? st.downloaded : true),
        hasConflicts: !!st?.hasConflicts,
      });
    }
    return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  }

  /** One entry by path (null when missing): what the watcher stats after an fs.watch event. */
  async entry(path: string): Promise<LocalFsEntry | null> {
    const abs = await this.abs(path);
    const s = await bigStat(abs);
    if (!s) {
      const ph = await bigStat(this.placeholderOf(abs));
      return ph ? { path, size: 0, mtimeMs: ph.mtimeMs, etag: `p${etagOf(ph)}`, downloaded: false, hasConflicts: false } : null;
    }
    const st = this.coordinator ? (await this.coordinator.status([abs]).catch(() => ({}) as Record<string, ItemStatus>))[abs] : undefined;
    return { path, size: Number(s.size), mtimeMs: s.mtimeMs, etag: etagOf(s), downloaded: st ? st.downloaded : true, hasConflicts: !!st?.hasConflicts };
  }

  /**
   * Entries for paths as fs.watch reports them (relative, on disk): a placeholder counts as its file, a folder
   * as everything in it, and a missing path as null. Hidden and temporary names are skipped.
   */
  async entries(physical: string[]): Promise<Map<string, LocalFsEntry | null>> {
    const out = new Map<string, LocalFsEntry | null>();
    const root = await this.rootReal();
    for (const raw of new Set(physical)) {
      const parts = raw.split("/");
      const last = parts.pop() ?? "";
      const real = fromPlaceholderName(last);
      if (parts.some((p) => p.startsWith(".") || IGNORED.has(p)) || IGNORED.has(last) || (last.startsWith(".") && !real)) continue;
      const path = [...parts, real ?? last].join("/");
      if (!isValidLibraryPath(path)) continue;
      let s;
      try {
        s = await lstat(join(root, ...path.split("/")));
      } catch {
        s = null;
      }
      try {
        if (s?.isDirectory()) for (const e of await this.list(path)) out.set(e.path, e);
        else if (!s || s.isFile()) out.set(path, await this.entry(path));
      } catch {
        out.set(path, null);
      }
    }
    return out;
  }

  // ---------------------------------------------------------------- read

  async read(path: string): Promise<ReadResult> {
    const abs = await this.abs(path);
    if (this.coordinator) {
      const r = await this.coordinator.read(abs).catch((e) => {
        throw ioError(e, path);
      });
      if ("notDownloaded" in r) return r;
      return { bytes: r.bytes, etag: helperEtag(r.stat) };
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      let fh;
      try {
        fh = await open(abs, constants.O_RDONLY | constants.O_NOFOLLOW);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") {
          if (await bigStat(this.placeholderOf(abs))) return { notDownloaded: true };
          throw new LibraryError("not_found", `No such file: ${path}`, path);
        }
        throw ioError(e, path);
      }
      try {
        const before = await fh.stat({ bigint: true });
        if (!before.isFile()) throw new LibraryError("not_found", `Not a file: ${path}`, path);
        const bytes = await fh.readFile();
        const after = await fh.stat({ bigint: true });
        // The descriptor holds one inode, so a rename can't tear the read; an in-place rewrite by another
        // app could, and shows as a changed size or time.
        if (before.size === after.size && before.mtimeNs === after.mtimeNs && BigInt(bytes.length) === after.size)
          return { bytes: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength), etag: etagOf(after) };
      } catch (e) {
        throw ioError(e, path);
      } finally {
        await fh.close();
      }
    }
    throw new LibraryError("unreadable", `The file kept changing while it was read: ${path}`, path);
  }

  // ---------------------------------------------------------------- write

  async write(path: string, bytes: Uint8Array, o: { ifMatch?: string | null } = {}): Promise<WriteResult> {
    if (!(bytes instanceof Uint8Array)) throw new LibraryError("invalid_argument", "Bytes are needed.", path);
    const ifMatch = o.ifMatch;
    if (ifMatch !== undefined && ifMatch !== null && typeof ifMatch !== "string") throw new LibraryError("invalid_argument", "ifMatch must be a string or null.", path);
    const abs = await this.abs(path);
    const result = await withPathLock(abs, () => (this.coordinator ? this.writeCoordinated(abs, path, bytes, ifMatch) : this.writePlain(abs, path, bytes, ifMatch)));
    if ("etag" in result && !("mismatch" in result)) this.onOwnChange?.(path, { path, size: bytes.length, mtimeMs: Date.now(), etag: result.etag, downloaded: true, hasConflicts: false });
    return result;
  }

  private async currentEtag(abs: string): Promise<string> {
    const s = await bigStat(abs);
    if (s) return etagOf(s);
    const ph = await bigStat(this.placeholderOf(abs));
    return ph ? `p${etagOf(ph)}` : "";
  }

  private async writePlain(abs: string, path: string, bytes: Uint8Array, ifMatch: string | null | undefined): Promise<WriteResult> {
    const root = await this.rootReal();
    const current = await this.currentEtag(abs);
    if (ifMatch === null && current) return { mismatch: true, etag: current };
    if (typeof ifMatch === "string" && current !== ifMatch) return { mismatch: true, etag: current };
    const tmpDir = join(root, TMP_DIR);
    await mkdir(tmpDir, { recursive: true });
    await mkdir(dirname(abs), { recursive: true });
    // Re-checked now that the folders exist: a symlinked folder created meanwhile can't redirect the write.
    await this.abs(path);
    const tmp = join(tmpDir, `${randomUUID()}.tmp`);
    try {
      const fh = await open(tmp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o644);
      try {
        let off = 0;
        while (off < bytes.length) {
          const { bytesWritten } = await fh.write(bytes, off, bytes.length - off);
          off += bytesWritten;
        }
        await fh.sync();
      } finally {
        await fh.close();
      }
      if (ifMatch === null) {
        // Create only: link() fails if the name exists, atomically, whoever made it.
        try {
          await link(tmp, abs);
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code === "EEXIST") return { mismatch: true, etag: await this.currentEtag(abs) };
          throw e;
        }
      } else {
        if (typeof ifMatch === "string") {
          const now = await this.currentEtag(abs);
          if (now !== ifMatch) return { mismatch: true, etag: now };
        }
        await rename(tmp, abs);
      }
      await fsyncDir(dirname(abs));
      // A placeholder for the same name is stale now.
      await unlink(this.placeholderOf(abs)).catch(() => undefined);
      const s = await bigStat(abs);
      if (!s) throw new LibraryError("io", `The file vanished after writing: ${path}`, path);
      return { etag: etagOf(s) };
    } catch (e) {
      throw ioError(e, path);
    } finally {
      await unlink(tmp).catch(() => undefined);
    }
  }

  private async writeCoordinated(abs: string, path: string, bytes: Uint8Array, ifMatch: string | null | undefined): Promise<WriteResult> {
    const c = this.coordinator!;
    let condition: Parameters<Coordinator["write"]>[2];
    if (ifMatch === undefined) condition = { mode: "any" };
    else if (ifMatch === null) condition = { mode: "create" };
    else {
      const expect = parseEtag(ifMatch);
      if (!expect) return { mismatch: true, etag: await this.currentEtag(abs) };
      condition = { mode: "match", expect };
    }
    try {
      const r = await c.write(abs, bytes, condition);
      if ("mismatch" in r) return { mismatch: true, etag: r.current ? helperEtag(r.current) : await this.currentEtag(abs) };
      return { etag: helperEtag(r.stat) };
    } catch (e) {
      throw ioError(e, path);
    }
  }

  // ---------------------------------------------------------------- remove

  async remove(path: string, o: { ifMatch?: string } = {}): Promise<void> {
    const ifMatch = o?.ifMatch;
    if (ifMatch !== undefined && typeof ifMatch !== "string") throw new LibraryError("invalid_argument", "ifMatch must be a string.", path);
    const abs = await this.abs(path);
    await withPathLock(abs, async () => {
      const current = await this.currentEtag(abs);
      if (!current) return;
      if (ifMatch !== undefined && current !== ifMatch) throw new LibraryError("mismatch", `Changed since read: ${path}`, path);
      if (this.coordinator && !current.startsWith("p")) {
        const expect = ifMatch === undefined ? null : parseEtag(ifMatch);
        await this.coordinator.remove(abs, expect ? { mode: "match", expect } : { mode: "any" }).catch((e) => {
          throw ioError(e, path);
        });
      } else {
        try {
          await unlink(current.startsWith("p") ? this.placeholderOf(abs) : abs);
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw ioError(e, path);
        }
        await fsyncDir(dirname(abs));
      }
      // Empty folders a remove leaves behind (history/<id>/, files/<aa>/) go too; the top-level ones stay.
      const root = await this.rootReal();
      let dir = dirname(abs);
      while (dir.startsWith(root + sep) && relative(root, dir).split(sep).length >= 2) {
        try {
          await rmdir(dir);
        } catch {
          break;
        }
        dir = dirname(dir);
      }
    });
    this.onOwnChange?.(path, null);
  }

  // ---------------------------------------------------------------- providers

  async conflictVersions(path: string): Promise<{ id: string; bytes: Uint8Array }[]> {
    const abs = await this.abs(path);
    if (!this.coordinator) return [];
    return this.coordinator.conflictVersions(abs).catch((e) => {
      throw ioError(e, path);
    });
  }

  async resolveConflicts(path: string, ids: string[]): Promise<void> {
    const abs = await this.abs(path);
    if (!Array.isArray(ids) || !ids.every((i) => typeof i === "string")) throw new LibraryError("invalid_argument", "ids must be strings.", path);
    if (!this.coordinator || !ids.length) return;
    await this.coordinator.resolveConflicts(abs, ids).catch((e) => {
      throw ioError(e, path);
    });
  }

  async startDownload(paths: string[]): Promise<void> {
    const abs: string[] = [];
    for (const p of paths) abs.push(await this.abs(p));
    if (this.coordinator && abs.length) await this.coordinator.startDownload(abs).catch(() => undefined);
  }

  /** Clears `.folevi-tmp/` of files a crash left behind (older than a minute, so a write in flight is safe). */
  async cleanTemp(now = Date.now()): Promise<number> {
    const dir = join(await this.rootReal(), TMP_DIR);
    let removed = 0;
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      return 0;
    }
    for (const name of names) {
      try {
        const s = await stat(join(dir, name));
        if (now - s.mtimeMs > 60_000) {
          await unlink(join(dir, name));
          removed++;
        }
      } catch {
        // Gone already.
      }
    }
    return removed;
  }
}
