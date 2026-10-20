// A simulated cloud folder shared by several devices, with the faults real providers show: late delivery,
// duplicate delivery, stale (reordered) delivery, partial files, conflict copies (named copies or NSFileVersion
// conflict versions) and lost updates (one device's write silently replaced by another's).
//
// Each device mounts the cloud as its own LocalFs (a local folder the provider syncs). Writes land locally at
// once and upload later; `step()` runs one provider event chosen at random, `settle()` turns faults off and
// delivers everything.
import {
  LocalFsError,
  type LocalFs,
  type LocalFsEntry,
  type ReadResult,
  type WriteResult,
} from "../io";
import { MemoryFs } from "./memoryFs";

export interface FaultRates {
  /** A pending event is put back instead of run. */
  delay: number;
  /** A delivery is repeated later. */
  duplicate: number;
  /** An older version is delivered first. */
  stale: number;
  /** The first delivery is cut short (a partial file). */
  truncate: number;
  /** On a concurrent upload, the provider overwrites the other device's version (it is lost from the cloud). */
  loseUpdate: number;
}

export const NO_FAULTS: FaultRates = {
  delay: 0,
  duplicate: 0,
  stale: 0,
  truncate: 0,
  loseUpdate: 0,
};
export const DEFAULT_FAULTS: FaultRates = {
  delay: 0.2,
  duplicate: 0.1,
  stale: 0.1,
  truncate: 0.1,
  loseUpdate: 0.25,
};

/** How the provider keeps both versions on a concurrent upload (when it doesn't lose one). */
export type CopyStyle = "dropbox" | "icloud" | "numbered" | "onedrive" | "versions";

export interface FaultyCloudOptions {
  seed: number;
  faults?: FaultRates;
  copyStyle?: CopyStyle | CopyStyle[];
}

interface CloudFile {
  bytes: Uint8Array;
  version: number;
  conflicts: { id: string; bytes: Uint8Array }[];
}

type CloudEvent =
  | { kind: "upload"; mount: string; path: string }
  | { kind: "download"; mount: string; path: string; stale?: boolean; truncated?: boolean }
  | { kind: "resolve"; mount: string; path: string; ids: string[] };

/** mulberry32: small, seeded, deterministic. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export class FaultyCloud {
  readonly random: () => number;
  faults: FaultRates;
  private readonly styles: CopyStyle[];
  private readonly files = new Map<string, CloudFile>();
  /** Old versions per path, for stale deliveries. */
  private readonly past = new Map<string, Uint8Array[]>();
  private readonly mounts = new Map<string, FaultyMount>();
  private queue: CloudEvent[] = [];
  private version = 0;
  private copies = 0;
  /** What happened, for test failure messages. */
  readonly log: string[] = [];
  readonly stats = {
    uploads: 0,
    deliveries: 0,
    copies: 0,
    conflictVersions: 0,
    lostUpdates: 0,
    truncated: 0,
    stale: 0,
    duplicates: 0,
  };

  constructor(options: FaultyCloudOptions) {
    this.random = seededRandom(options.seed);
    this.faults = options.faults ?? DEFAULT_FAULTS;
    const style = options.copyStyle ?? ["dropbox", "icloud", "numbered", "versions"];
    this.styles = Array.isArray(style) ? style : [style];
  }

  mount(name: string): FaultyMount {
    if (!/^[A-Za-z0-9]+$/.test(name)) throw new Error("Mount names are letters and digits.");
    const m = new FaultyMount(this, name);
    this.mounts.set(name, m);
    return m;
  }

  /** @internal */
  enqueue(event: CloudEvent): void {
    this.queue.push(event);
  }

  get pending(): number {
    return this.queue.length;
  }

  /** The cloud's own copy of a file (what a fresh device would download). */
  cloudFile(path: string): Uint8Array | undefined {
    return this.files.get(path)?.bytes.slice();
  }

  cloudPaths(): string[] {
    return [...this.files.keys()].sort();
  }

  private chance(p: number): boolean {
    return p > 0 && this.random() < p;
  }

  /** Runs one provider event (picked at random, so events reorder). Returns false when nothing is pending. */
  step(): boolean {
    if (this.queue.length === 0) return false;
    const index = Math.floor(this.random() * this.queue.length);
    const [event] = this.queue.splice(index, 1);
    if (this.chance(this.faults.delay)) {
      this.queue.push(event!);
      return true;
    }
    this.run(event!);
    return true;
  }

  /** Turns faults off and delivers everything pending, in order. */
  settle(maxEvents = 100_000): void {
    this.faults = NO_FAULTS;
    let n = 0;
    while (this.queue.length > 0) {
      if (++n > maxEvents) throw new Error("The cloud didn't settle.");
      this.run(this.queue.shift()!);
    }
  }

  private run(event: CloudEvent): void {
    const mount = this.mounts.get(event.mount)!;
    if (event.kind === "upload") this.upload(mount, event.path);
    else if (event.kind === "download") this.download(mount, event.path, event);
    else {
      const f = this.files.get(event.path);
      if (f) f.conflicts = f.conflicts.filter((c) => !event.ids.includes(c.id));
      this.broadcast(event.path, null);
    }
  }

  private broadcast(path: string, except: string | null): void {
    for (const name of this.mounts.keys())
      if (name !== except) this.queue.push({ kind: "download", mount: name, path });
  }

  private upload(mount: FaultyMount, path: string): void {
    // Only the device's own changes upload (never what the provider itself delivered).
    if (!mount.dirty.has(path)) return;
    const local = mount.localFs.peek(path);
    const cloud = this.files.get(path);
    const base = mount.base.get(path);
    mount.dirty.delete(path);
    this.stats.uploads++;
    if (local === undefined) {
      // A removal. The provider only removes what the device last saw.
      if (cloud && base === cloud.version) {
        this.files.delete(path);
        this.log.push(`${mount.name} removed ${path}`);
        this.broadcast(path, mount.name);
      }
      mount.base.delete(path);
      return;
    }
    if (cloud && sameBytes(cloud.bytes, local)) {
      mount.base.set(path, cloud.version);
      return;
    }
    const concurrent = cloud !== undefined && base !== cloud.version;
    if (concurrent && !this.chance(this.faults.loseUpdate)) {
      // Keep both: the cloud keeps its version, the upload becomes a copy (or a conflict version).
      const style = this.styles[Math.floor(this.random() * this.styles.length)]!;
      if (style === "versions") {
        cloud.conflicts.push({ id: `cv${++this.copies}`, bytes: local.slice() });
        this.stats.conflictVersions++;
        this.log.push(`${mount.name} upload of ${path} became a conflict version`);
      } else {
        const copy = this.copyPath(path, style, mount.name);
        this.version++;
        this.files.set(copy, { bytes: local.slice(), version: this.version, conflicts: [] });
        this.stats.copies++;
        this.log.push(`${mount.name} upload of ${path} became ${copy}`);
        this.broadcast(copy, null);
      }
      // The device gets the cloud's version back (its own stays in the copy).
      this.queue.push({ kind: "download", mount: mount.name, path });
      return;
    }
    if (concurrent) {
      this.stats.lostUpdates++;
      this.log.push(
        `${mount.name} upload of ${path} overwrote a version it hadn't seen (lost update)`,
      );
    }
    if (cloud) this.past.set(path, [...(this.past.get(path) ?? []), cloud.bytes]);
    this.version++;
    this.files.set(path, {
      bytes: local.slice(),
      version: this.version,
      conflicts: cloud?.conflicts ?? [],
    });
    mount.base.set(path, this.version);
    this.broadcast(path, mount.name);
  }

  private copyPath(path: string, style: Exclude<CopyStyle, "versions">, device: string): string {
    const slash = path.lastIndexOf("/");
    const dir = path.slice(0, slash + 1);
    const file = path.slice(slash + 1);
    const dot = file.indexOf(".");
    const stem = dot === -1 ? file : file.slice(0, dot);
    const ext = dot === -1 ? "" : file.slice(dot);
    for (let n = style === "icloud" ? 2 : 1; ; n++) {
      const name =
        style === "dropbox"
          ? `${stem} (${device}'s conflicted copy 2026-10-20${n > 1 ? ` (${n})` : ""})${ext}`
          : style === "icloud"
            ? `${stem} ${n}${ext}`
            : style === "numbered"
              ? `${stem}(${n})${ext}`
              : `${stem}-${device.toUpperCase()}${n > 1 ? n : ""}${ext}`;
      if (!this.files.has(dir + name)) return dir + name;
    }
  }

  private download(
    mount: FaultyMount,
    path: string,
    event: { stale?: boolean; truncated?: boolean },
  ): void {
    const cloud = this.files.get(path);
    if (mount.dirty.has(path)) return; // the device's own change is waiting to upload; that upload decides
    this.stats.deliveries++;
    if (!cloud) {
      if (mount.localFs.peek(path) !== undefined && mount.base.has(path)) {
        mount.localFs.delete(path);
        mount.base.delete(path);
      }
      return;
    }
    if (!event.stale && !event.truncated) {
      const past = this.past.get(path);
      if (past?.length && this.chance(this.faults.stale)) {
        const old = past[Math.floor(this.random() * past.length)]!;
        mount.localFs.put(
          path,
          old,
          cloud.conflicts.map((c) => ({ ...c })),
        );
        mount.base.set(path, -1);
        this.stats.stale++;
        this.queue.push({ kind: "download", mount: mount.name, path });
        return;
      }
      if (cloud.bytes.length > 1 && this.chance(this.faults.truncate)) {
        const cut = 1 + Math.floor(this.random() * (cloud.bytes.length - 1));
        mount.localFs.put(path, cloud.bytes.slice(0, cut), []);
        mount.base.set(path, cloud.version);
        this.stats.truncated++;
        this.queue.push({ kind: "download", mount: mount.name, path });
        return;
      }
    }
    const current = mount.localFs.peek(path);
    if (!current || !sameBytes(current, cloud.bytes) || mount.base.get(path) !== cloud.version) {
      mount.localFs.put(
        path,
        cloud.bytes,
        cloud.conflicts.map((c) => ({ ...c })),
      );
    }
    mount.base.set(path, cloud.version);
    if (this.chance(this.faults.duplicate)) {
      this.stats.duplicates++;
      this.queue.push({ kind: "download", mount: mount.name, path });
    }
  }
}

/** One device's view of the cloud folder. */
export class FaultyMount implements LocalFs {
  /** @internal */ readonly localFs = new MemoryFs();
  /** @internal The cloud version each local file is based on. */ readonly base = new Map<
    string,
    number
  >();
  /** @internal Paths with local changes not uploaded yet. */ readonly dirty = new Set<string>();

  constructor(
    private readonly cloud: FaultyCloud,
    readonly name: string,
  ) {}

  list(dir: string): Promise<LocalFsEntry[]> {
    return this.localFs.list(dir);
  }

  read(path: string): Promise<ReadResult> {
    return this.localFs.read(path);
  }

  async write(
    path: string,
    bytes: Uint8Array,
    o: { ifMatch?: string | null },
  ): Promise<WriteResult> {
    const r = await this.localFs.write(path, bytes, o);
    if (!("mismatch" in r)) {
      this.dirty.add(path);
      this.cloud.enqueue({ kind: "upload", mount: this.name, path });
    }
    return r;
  }

  async remove(path: string, o?: { ifMatch?: string }): Promise<void> {
    if (this.localFs.peek(path) === undefined) return;
    await this.localFs.remove(path, o);
    this.dirty.add(path);
    this.cloud.enqueue({ kind: "upload", mount: this.name, path });
  }

  conflictVersions(path: string): Promise<{ id: string; bytes: Uint8Array }[]> {
    return this.localFs.conflictVersions(path);
  }

  async resolveConflicts(path: string, ids: string[]): Promise<void> {
    if (this.localFs.peek(path) === undefined)
      throw new LocalFsError("not_found", `No such file: ${path}`, path);
    await this.localFs.resolveConflicts(path, ids);
    this.cloud.enqueue({ kind: "resolve", mount: this.name, path, ids });
  }
}
