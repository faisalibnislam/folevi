// The Node side of folevi-files (native/folevi-files.swift): one long-running helper per app, spoken to in JSON
// lines. It's started on first use, restarted if it dies, and only used for libraries in iCloud Drive or a File
// Provider folder (fs.ts). Bytes travel as base64; a request that takes too long fails with "io" (the provider
// may be holding the file), and the app retries later like any other unreadable file.
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { LibraryError, type LibraryErrorCode } from "./types";

/** The parts an etag is made of, as the helper reports them (numbers that don't fit a double are strings). */
export interface HelperStat {
  ino: string;
  size: number;
  mtimeNs: string;
  dataless?: boolean;
}

export interface ItemStatus extends Partial<HelperStat> {
  exists: boolean;
  placeholder: boolean;
  ubiquitous: boolean;
  downloaded: boolean;
  downloading: boolean;
  uploaded: boolean;
  uploading: boolean;
  hasConflicts: boolean;
}

export type WriteCondition = { mode: "any" } | { mode: "create" } | { mode: "match"; expect: HelperStat };

export interface StatusEvent {
  event: "status";
  root: string;
  initial: boolean;
  items: (ItemStatus & { path: string })[];
}

/** What fs.ts needs from coordinated I/O (FilesHelper, or a fake in tests). */
export interface Coordinator {
  read(path: string): Promise<{ bytes: Uint8Array; stat: HelperStat } | { notDownloaded: true }>;
  write(path: string, bytes: Uint8Array, condition: WriteCondition): Promise<{ stat: HelperStat } | { mismatch: true; current: HelperStat | null }>;
  remove(path: string, condition: { mode: "any" } | { mode: "match"; expect: HelperStat }): Promise<void>;
  status(paths: string[]): Promise<Record<string, ItemStatus>>;
  startDownload(paths: string[]): Promise<void>;
  conflictVersions(path: string): Promise<{ id: string; bytes: Uint8Array }[]>;
  resolveConflicts(path: string, ids: string[]): Promise<void>;
  watch(root: string, onStatus: (e: StatusEvent) => void): Promise<() => void>;
}

const CODES = new Set<LibraryErrorCode>(["not_found", "unreadable", "mismatch", "invalid_path", "io", "invalid_argument"]);

export interface FilesHelperOptions {
  /** Extra arguments (tests pass --test-hooks). */
  args?: string[];
  /** Per request; coordinated access can wait on a provider. */
  timeoutMs?: number;
  /**
   * The bare folevi-files binary, used if `binary` (the signed helper app's, which has the iCloud container
   * entitlement) is stopped before it answers anything: macOS refuses an app whose profile doesn't fit. The
   * requests sent meanwhile go to it instead; only the container isn't reachable then.
   */
  fallback?: string;
}

type Pending = { resolve: (v: unknown) => void; reject: (e: unknown) => void; timer: NodeJS.Timeout; line: string };

export class FilesHelper implements Coordinator {
  private child: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private buffer = "";
  private listeners = new Set<(e: StatusEvent) => void>();
  private watched = new Map<string, number>();
  private closed = false;
  /** Whether the running helper has answered (a helper stopped before then may not be allowed to run). */
  private answered = false;
  private current: string;

  constructor(
    readonly binary: string,
    private readonly options: FilesHelperOptions = {},
  ) {
    this.current = binary;
  }

  /** The helper in use: `binary`, or the fallback once `binary` couldn't run. */
  get running(): string {
    return this.current;
  }

  static available(binary: string): boolean {
    return existsSync(binary);
  }

  private start(): ChildProcessWithoutNullStreams {
    if (this.child) return this.child;
    if (this.closed) throw new LibraryError("io", "The file helper was closed.");
    if (!existsSync(this.current)) throw new LibraryError("io", `folevi-files is missing (${this.current}).`);
    const child = spawn(this.current, this.options.args ?? [], { stdio: ["pipe", "pipe", "pipe"] });
    this.child = child;
    this.buffer = "";
    this.answered = false;
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.onData(chunk));
    child.stderr.on("data", () => undefined);
    child.stdin.on("error", () => undefined);
    const gone = () => {
      if (this.child !== child) return;
      this.child = null;
      const fallback = this.options.fallback;
      if (!this.answered && !this.closed && fallback && this.current !== fallback && existsSync(fallback)) {
        // The helper app wasn't allowed to run: the bare binary takes over, with what was waiting.
        this.current = fallback;
        try {
          const next = this.start();
          for (const [, p] of this.pending) next.stdin.write(p.line);
          if (this.watched.size) this.rewatch();
          return;
        } catch {
          // Fall through: the waiting requests fail.
        }
      }
      for (const [, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(new LibraryError("io", "The file helper stopped."));
      }
      this.pending.clear();
      // Watches resume with the next helper (status is also covered by the watcher's own scans).
      if (!this.closed && this.watched.size) setTimeout(() => this.rewatch(), 500).unref();
    };
    child.on("exit", gone);
    child.on("error", gone);
    return child;
  }

  private rewatch() {
    for (const root of this.watched.keys()) void this.request("watch", { root }).catch(() => undefined);
  }

  private onData(chunk: string) {
    this.buffer += chunk;
    let nl: number;
    while ((nl = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, nl);
      this.buffer = this.buffer.slice(nl + 1);
      if (!line.trim()) continue;
      this.answered = true;
      let msg: { id?: number | null; ok?: boolean; result?: unknown; code?: string; message?: string; event?: string };
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg.event === "status") {
        for (const l of this.listeners) l(msg as unknown as StatusEvent);
        continue;
      }
      if (typeof msg.id !== "number") continue;
      const p = this.pending.get(msg.id);
      if (!p) continue;
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.ok) p.resolve(msg.result ?? {});
      else {
        const code = CODES.has(msg.code as LibraryErrorCode) ? (msg.code as LibraryErrorCode) : "io";
        p.reject(new LibraryError(code, msg.message ?? "The file helper failed."));
      }
    }
  }

  /** One request; resolves with its result. */
  request<T = Record<string, unknown>>(op: string, params: Record<string, unknown> = {}, timeoutMs = this.options.timeoutMs ?? 60_000): Promise<T> {
    let child: ChildProcessWithoutNullStreams;
    try {
      child = this.start();
    } catch (e) {
      return Promise.reject(e);
    }
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new LibraryError("io", `The file helper took too long (${op}).`));
      }, timeoutMs);
      const line = `${JSON.stringify({ id, op, ...params })}\n`;
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer, line });
      (this.child ?? child).stdin.write(line);
    });
  }

  async ping(): Promise<{ version: string; pid: number; testHooks: boolean }> {
    return this.request("ping");
  }

  /**
   * iCloud on this Mac. With `container`, also Folevi's own container (made here if needed): its folder, or null
   * when this helper isn't entitled to it (the bare binary) or iCloud is signed out.
   */
  async icloud(o: { container?: boolean } = {}): Promise<{ signedIn: boolean; driveRoot: string; driveExists: boolean; entitled?: boolean; container?: string | null }> {
    return this.request("icloud", o.container ? { container: true } : {}, o.container ? 120_000 : undefined);
  }

  async read(path: string) {
    const r = await this.request<{ bytes?: string; stat?: HelperStat; notDownloaded?: boolean }>("read", { path });
    if (r.notDownloaded) return { notDownloaded: true as const };
    return { bytes: new Uint8Array(Buffer.from(r.bytes ?? "", "base64")), stat: r.stat! };
  }

  async write(path: string, bytes: Uint8Array, condition: WriteCondition) {
    const r = await this.request<{ stat?: HelperStat; mismatch?: boolean; current?: HelperStat | null }>("write", {
      path,
      bytes: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64"),
      ...condition,
    });
    if (r.mismatch) return { mismatch: true as const, current: r.current ?? null };
    return { stat: r.stat! };
  }

  async remove(path: string, condition: { mode: "any" } | { mode: "match"; expect: HelperStat }) {
    await this.request("remove", { path, ...condition });
  }

  async status(paths: string[]): Promise<Record<string, ItemStatus>> {
    const out: Record<string, ItemStatus> = {};
    // In slices, so one answer line stays a sensible size.
    for (let i = 0; i < paths.length; i += 500) {
      const r = await this.request<{ items: Record<string, ItemStatus> }>("stat", { paths: paths.slice(i, i + 500) });
      Object.assign(out, r.items);
    }
    return out;
  }

  async startDownload(paths: string[]) {
    for (let i = 0; i < paths.length; i += 500) await this.request("startDownload", { paths: paths.slice(i, i + 500) });
  }

  async conflictVersions(path: string, o: { includeOther?: boolean } = {}) {
    const r = await this.request<{ versions: { id: string; bytes: string }[] }>("conflictVersions", { path, includeOther: !!o.includeOther });
    return r.versions.map((v) => ({ id: v.id, bytes: new Uint8Array(Buffer.from(v.bytes, "base64")) }));
  }

  async resolveConflicts(path: string, ids: string[], o: { includeOther?: boolean } = {}) {
    await this.request("resolveConflicts", { path, ids, includeOther: !!o.includeOther });
  }

  async watch(root: string, onStatus: (e: StatusEvent) => void): Promise<() => void> {
    const listener = (e: StatusEvent) => {
      if (e.root === root) onStatus(e);
    };
    this.listeners.add(listener);
    this.watched.set(root, (this.watched.get(root) ?? 0) + 1);
    await this.request("watch", { root });
    return () => {
      this.listeners.delete(listener);
      const n = (this.watched.get(root) ?? 1) - 1;
      if (n > 0) this.watched.set(root, n);
      else {
        this.watched.delete(root);
        void this.request("unwatch", { root }).catch(() => undefined);
      }
    };
  }

  /** Stops the helper (it also exits by itself when its stdin closes). */
  close() {
    this.closed = true;
    const child = this.child;
    this.child = null;
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new LibraryError("io", "The file helper was closed."));
    }
    this.pending.clear();
    child?.stdin.end();
    setTimeout(() => child?.kill(), 2000).unref();
  }
}
