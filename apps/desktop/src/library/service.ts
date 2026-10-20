// The library behind `shell.library` on the Mac (docs/LOCAL_MODE_PLAN.md §3, §4.1, §4.2): where it is, its
// files (fs.ts, or encryptedFs.ts around it), change detection (watch.ts), the journal (journal.ts), the
// passphrase and the key (crypto.ts, keys.ts), moving it, and attachments for app://folevi/_files.
//
// The service knows nothing of Electron: main.ts gives it the folders, the folder picker and safeStorage, and
// ipc.ts carries the page's calls to it. Its own state is `library.json` in Application Support:
// { kind, path, libraryId, chosenFolder?, move?, encryptionJob? }.
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { mkdir, readdir, realpath } from "node:fs/promises";
import { join, sep } from "node:path";
import { LibraryAttachments } from "./attachments";
import { createEncryption, isEnvelope, keyMatches, unlockMasterKey, wrapMasterKey, type EncryptionHeader } from "./crypto";
import { EncryptedNodeFs } from "./encryptedFs";
import { NodeFs } from "./fs";
import { FilesHelper, type Coordinator } from "./helper";
import { FileJournal } from "./journal";
import { KeyCache, type StringSealer } from "./keys";
import { checkICloud, defaultLocation, displayPath, iCloudDriveRoot, isFolder, probeWritable, providerOf, DEVICE_FOLDER } from "./locations";
import { checkPath, FILES_DIR, LIBRARY_FILE } from "./paths";
import { LibraryWatcher, type WatchSource } from "./watch";
import { LibraryError, type LibraryChange, type LibraryFs, type LibraryInfo, type LibraryKind, type LocalFsEntry, type ReadResult, type WriteResult } from "./types";

export interface LibraryManifest {
  format: "folevi-library";
  v: number;
  libraryId: string;
  createdAt: number;
  minWriterVersion: number;
  encryption: EncryptionHeader | null;
  migratedTo?: string;
  [k: string]: unknown;
}

interface StoredState {
  v: 1;
  kind: LibraryKind;
  path: string;
  libraryId: string;
  /** "Choose a folder": the folder the person picked (the library may be a "Folevi Library" folder in it). */
  chosenFolder?: string;
  /** A move under way: finished by calling move again, or on the next start. */
  move?: { kind: LibraryKind; path: string; chosenFolder?: string };
  /** Encryption being switched on or off: resumed on the next start (or unlock). */
  encryptionJob?: { direction: "encrypt" | "decrypt" };
}

export interface LibraryServiceOptions {
  /** Application Support/Folevi (app.getPath("userData")). */
  userData: string;
  home: string;
  /** folevi-files; null when there is none (tests, or a development build without it). */
  helperPath: string | null;
  helperArgs?: string[];
  /** Or a coordinator made elsewhere (tests). */
  coordinator?: Coordinator | null;
  /** dialog.showOpenDialog for folders: the chosen path, or null when cancelled. */
  chooseFolder: (o: { title: string; defaultPath: string }) => Promise<string | null>;
  /** Electron's safeStorage. */
  sealer: StringSealer | null;
  now?: () => number;
  watch?: { scanIntervalMs?: number; debounceMs?: number; useFsEvents?: boolean };
  /** "Sync with Dropbox" and "Sync with Google Drive" (cloud/library.ts's CloudLibrary); absent without them. */
  cloud?: CloudSource | null;
  /** PBKDF2 iterations for a new passphrase (600,000; tests use fewer). */
  iterations?: number;
}

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** The part of cloud/library.ts's CloudLibrary the service uses (a fake in tests). */
export interface CloudSource {
  /** The connected provider's LocalFs, or null when nothing is connected. */
  fs(): LibraryFs | null;
  /** The library file there: the one another device made, or a new one. */
  prepare(): Promise<{ libraryId: string }>;
  info(): Promise<{ kind: "dropbox" | "googleDrive"; displayPath: string; available: boolean } | null>;
  /** Change batches from the provider's change feed (on-disk paths). */
  watch(cb: (changes: { path: string; kind: "changed" | "removed" }[]) => void): () => void;
}

const CLOUD_KINDS = { dropbox: "dropbox", gdrive: "googleDrive" } as const;
const isCloudKind = (k: LibraryKind): k is "dropbox" | "gdrive" => k === "dropbox" || k === "gdrive";

/** A ULID (time + randomness, Crockford base32) for a new library. */
export function newLibraryId(now: number): string {
  let t = now;
  let time = "";
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD[t % 32] + time;
    t = Math.floor(t / 32);
  }
  const r = randomBytes(16);
  let rand = "";
  for (let i = 0; i < 16; i++) rand += CROCKFORD[r[i]! % 32];
  return time + rand;
}

export function encodeManifest(m: LibraryManifest): Uint8Array {
  return new Uint8Array(Buffer.from(`${JSON.stringify(m, null, 2)}\n`, "utf8"));
}

export function decodeManifest(bytes: Uint8Array): LibraryManifest {
  const m = JSON.parse(Buffer.from(bytes).toString("utf8")) as Partial<LibraryManifest>;
  if (!m || m.format !== "folevi-library") throw new Error("Not a Folevi library.");
  if (typeof m.libraryId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(m.libraryId) || typeof m.createdAt !== "number" || typeof m.minWriterVersion !== "number")
    throw new Error("The library file is missing fields.");
  return { encryption: null, v: 1, ...m } as LibraryManifest;
}

/** Shared access for the page's calls, exclusive for a move or an encryption switch. */
class Gate {
  private active = 0;
  private exclusive: Promise<void> | null = null;
  private drained: (() => void) | null = null;

  async shared<T>(work: () => Promise<T>): Promise<T> {
    while (this.exclusive) await this.exclusive.catch(() => undefined);
    this.active++;
    try {
      return await work();
    } finally {
      this.active--;
      if (this.active === 0) this.drained?.();
    }
  }

  async only<T>(work: () => Promise<T>): Promise<T> {
    while (this.exclusive) await this.exclusive.catch(() => undefined);
    let done!: () => void;
    this.exclusive = new Promise<void>((r) => (done = r));
    try {
      if (this.active > 0) await new Promise<void>((r) => (this.drained = r));
      this.drained = null;
      return await work();
    } finally {
      this.exclusive = null;
      done();
    }
  }

  get busy() {
    return this.exclusive !== null;
  }
}

const inside = (path: string, dir: string) => path === dir || path.startsWith(dir + sep);
const ATTACHMENT_PLAIN = /^files\/[0-9a-f]{2}\/[0-9a-f]{64}$/;

export class LibraryService {
  private state: StoredState | null = null;
  /** A folder library's files (null for Dropbox and Google Drive). */
  private plain: NodeFs | null = null;
  /** The library's own files, as stored: the folder, or the provider's LocalFs. */
  private base: LibraryFs | null = null;
  private unwatchCloud: (() => void) | null = null;
  private enc: EncryptedNodeFs | null = null;
  private manifest: LibraryManifest | null = null;
  private manifestEtag: string | null = null;
  private watcher: LibraryWatcher | null = null;
  private unwatchHelper: (() => void) | null = null;
  private listeners = new Set<(changes: LibraryChange[]) => void>();
  private journalStore: FileJournal | null = null;
  private helperInstance: FilesHelper | null = null;
  private readonly keys: KeyCache;
  private readonly gate = new Gate();
  private readonly now: () => number;
  readonly files: LibraryAttachments;

  constructor(private readonly o: LibraryServiceOptions) {
    this.now = o.now ?? Date.now;
    this.keys = new KeyCache(join(o.userData, "library-keys"), o.sealer);
    this.files = new LibraryAttachments({
      root: () => (this.plain && this.manifest ? this.plain.root : null),
      // Dropbox and Google Drive: through the provider's LocalFs (it answers from this Mac's copy).
      readWhole: async (rel) => {
        if (this.plain || !this.base || !this.manifest) return null;
        const r = await this.base.read(rel).catch(() => null);
        return r && "bytes" in r ? r.bytes : null;
      },
      key: () => (this.manifest?.encryption ? (this.key() ?? "locked") : null),
      startDownload: async (paths) => {
        if (this.plain?.coordinator) await this.plain.coordinator.startDownload(paths);
      },
      downloaded: async (abs) => {
        if (!this.plain?.coordinator) return true;
        const s = await this.plain.coordinator.status([abs]).catch(() => null);
        return s?.[abs]?.downloaded ?? true;
      },
    });
  }

  // ---------------------------------------------------------------- state

  private get stateFile() {
    return join(this.o.userData, "library.json");
  }

  private loadState(): StoredState | null {
    try {
      const raw = JSON.parse(readFileSync(this.stateFile, "utf8")) as Partial<StoredState>;
      if (raw.v !== 1 || !["icloud", "folder", "device", "dropbox", "gdrive"].includes(raw.kind as string) || typeof raw.path !== "string" || typeof raw.libraryId !== "string") return null;
      return raw as StoredState;
    } catch {
      return null;
    }
  }

  private saveState(s: StoredState | null) {
    this.state = s;
    mkdirSync(this.o.userData, { recursive: true });
    const tmp = `${this.stateFile}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(s ?? {}, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, this.stateFile);
  }

  private coordinatorFor = async (path: string): Promise<Coordinator | null> => {
    if ((await providerOf(path, this.o.home)) === "plain") return null;
    if (this.o.coordinator !== undefined) return this.o.coordinator;
    if (!this.o.helperPath || !FilesHelper.available(this.o.helperPath)) return null;
    this.helperInstance ??= new FilesHelper(this.o.helperPath, { args: this.o.helperArgs });
    return this.helperInstance;
  };

  private helper(): FilesHelper | null {
    if (this.o.coordinator !== undefined) return null;
    if (!this.o.helperPath || !FilesHelper.available(this.o.helperPath)) return null;
    this.helperInstance ??= new FilesHelper(this.o.helperPath, { args: this.o.helperArgs });
    return this.helperInstance;
  }

  /** Loads library.json and opens the library it names; finishes a move or encryption switch left half done. */
  async open(): Promise<void> {
    this.state = this.loadState();
    if (!this.state) return;
    if (this.state.move) {
      await this.finishMove().catch(() => undefined);
      if (this.base) return;
    }
    await this.attach().catch(() => undefined);
    void this.resumeEncryption().catch(() => undefined);
  }

  private key(): Buffer | null {
    const m = this.manifest;
    if (!m?.encryption) return null;
    const k = this.keys.get(m.libraryId);
    return k && keyMatches(m.encryption, k) ? k : null;
  }

  /** The files the page works with: the encrypted view, the plain folder, or nothing while locked. */
  private current(): LibraryFs {
    if (!this.state) throw new LibraryError("not_set_up", "No library has been set up on this Mac.");
    if (!this.base || !this.manifest) throw new LibraryError("unavailable", "The library folder can't be reached right now.");
    if (this.manifest.encryption) {
      if (!this.enc) throw new LibraryError("locked", "The library is encrypted: enter its passphrase.");
      return this.enc;
    }
    return this.base;
  }

  private async readManifest(fs: LibraryFs): Promise<{ manifest: LibraryManifest; etag: string } | null> {
    try {
      const r = await fs.read(LIBRARY_FILE);
      if ("notDownloaded" in r) {
        await fs.startDownload([LIBRARY_FILE]);
        return null;
      }
      return { manifest: decodeManifest(r.bytes), etag: r.etag };
    } catch {
      return null;
    }
  }

  private async attach(): Promise<void> {
    this.detach();
    const s = this.state!;
    const base = await this.baseFor(s.kind, s.path);
    if (!base) return;
    this.base = base;
    if (base instanceof NodeFs) this.plain = base;
    const m = await this.readManifest(base);
    if (!m) {
      this.manifest = null;
      return;
    }
    if (m.manifest.libraryId !== s.libraryId) {
      // The folder now holds another library (replaced in Finder): adopt it, its journal is its own.
      this.saveState({ ...s, libraryId: m.manifest.libraryId });
    }
    this.useManifest(m.manifest, m.etag);
    await this.plain?.cleanTemp(this.now()).catch(() => 0);
    await this.startWatching();
  }

  /** The files of a library kind and place: a folder, or the connected provider (null if it isn't connected). */
  private async baseFor(kind: LibraryKind, path: string): Promise<LibraryFs | null> {
    if (!isCloudKind(kind)) return new NodeFs({ root: path, coordinator: await this.coordinatorFor(path) });
    const cloud = this.o.cloud;
    const info = cloud ? await cloud.info().catch(() => null) : null;
    if (!cloud || info?.kind !== CLOUD_KINDS[kind]) return null;
    return cloud.fs();
  }

  private useManifest(m: LibraryManifest, etag: string) {
    this.manifest = m;
    this.manifestEtag = etag;
    const key = this.key();
    this.enc = m.encryption && key && this.base ? new EncryptedNodeFs(this.base, key) : null;
  }

  private detach() {
    this.watcher?.stop();
    this.watcher = null;
    this.unwatchHelper?.();
    this.unwatchHelper = null;
    this.unwatchCloud?.();
    this.unwatchCloud = null;
    this.plain = null;
    this.base = null;
    this.enc = null;
    this.manifest = null;
    this.manifestEtag = null;
  }

  private async startWatching() {
    if (!this.plain && this.base && this.o.cloud) return this.watchCloud(this.o.cloud);
    const plain = this.plain;
    if (!plain) return;
    const source: WatchSource = {
      list: (dir) => {
        const fs = this.manifest?.encryption ? this.enc : plain;
        if (fs) return fs.list(dir);
        // Locked: only the manifest matters (a passphrase change elsewhere).
        return plain.entry(LIBRARY_FILE).then((e) => (e ? [e] : []));
      },
      entries: (physical) => (this.manifest?.encryption ? (this.enc ? this.enc.entries(physical) : Promise.resolve(null)) : plain.entries(physical)),
    };
    const watcher = new LibraryWatcher({
      root: plain.root,
      source,
      onChanges: (changes) => void this.onChanges(changes),
      ...this.o.watch,
    });
    this.watcher = watcher;
    await watcher.start();
    if (plain.coordinator) {
      const root = await realpath(plain.root).catch(() => plain.root);
      this.unwatchHelper = await plain.coordinator
        .watch(root, (e) => {
          const items: { path: string; downloaded: boolean; uploaded: boolean }[] = [];
          const touched: string[] = [];
          for (const it of e.items) {
            if (!it.path.startsWith(root + sep)) continue;
            const rel = it.path.slice(root.length + 1).split(sep).join("/");
            touched.push(rel);
            const logical = this.enc ? this.enc.knownLogical(rel) : rel;
            if (logical) items.push({ path: logical, downloaded: it.downloaded, uploaded: it.uploaded });
          }
          watcher.noteStatus(items);
          watcher.touch(touched);
        })
        .catch(() => null);
      // NSMetadataQuery reports nothing for an ordinary iCloud Drive folder (it needs the app's own container,
      // see locations.ts), so upload state is also polled with each scan, a few seconds apart while uploads wait.
      let stopped = false;
      let timer: NodeJS.Timeout | null = null;
      const poll = async () => {
        if (stopped || this.watcher !== watcher) return;
        const pending = await this.pollUploads(plain, root, watcher).catch(() => false);
        if (stopped) return;
        const every = this.o.watch?.scanIntervalMs ?? 30_000;
        timer = setTimeout(() => void poll(), pending ? Math.min(5_000, every) : every);
        timer.unref();
      };
      void poll();
      const unwatch = this.unwatchHelper;
      this.unwatchHelper = () => {
        stopped = true;
        if (timer) clearTimeout(timer);
        unwatch?.();
      };
    }
  }

  /** Dropbox and Google Drive: the provider's change feed, with on-disk names turned into the page's. */
  private watchCloud(cloud: CloudSource) {
    this.unwatchCloud?.();
    this.unwatchCloud = cloud.watch((raw) => {
      void (async () => {
        const changes: LibraryChange[] = [];
        for (const c of raw) {
          let path: string | null = c.path;
          if (this.manifest?.encryption) path = this.enc ? (this.enc.knownLogical(c.path) ?? (c.kind === "changed" ? await this.enc.logical(c.path) : null)) : c.path === LIBRARY_FILE ? c.path : null;
          if (path) changes.push({ path, kind: c.kind });
        }
        if (changes.length) await this.onChanges(changes);
      })();
    });
  }

  /** Feeds folevi-files' upload state to the watcher; true while some file is still uploading. */
  private async pollUploads(plain: NodeFs, root: string, watcher: LibraryWatcher): Promise<boolean> {
    const coordinator = plain.coordinator;
    if (!coordinator) return false;
    const entries = await plain.list("");
    const abs = entries.map((e) => join(root, ...e.path.split("/")));
    const status = await coordinator.status(abs);
    const items: { path: string; downloaded: boolean; uploaded: boolean }[] = [];
    let pending = false;
    entries.forEach((e, i) => {
      const st = status[abs[i]!];
      if (!st?.ubiquitous) return;
      if (!st.uploaded) pending = true;
      const logical = this.enc ? this.enc.knownLogical(e.path) : this.manifest?.encryption ? null : e.path;
      if (logical) items.push({ path: logical, downloaded: st.downloaded, uploaded: st.uploaded });
    });
    watcher.noteStatus(items);
    return pending;
  }

  /** Stops change detection while every name on disk changes (an encryption switch). */
  private pauseWatching() {
    this.watcher?.stop();
    this.watcher = null;
    this.unwatchHelper?.();
    this.unwatchHelper = null;
    this.unwatchCloud?.();
    this.unwatchCloud = null;
  }

  private async onChanges(changes: LibraryChange[]) {
    if (changes.some((c) => c.path === LIBRARY_FILE) && this.base) {
      // Another device changed the passphrase, or switched encryption on or off.
      const m = await this.readManifest(this.base);
      if (m) {
        const wasEncrypted = !!this.manifest?.encryption;
        this.useManifest(m.manifest, m.etag);
        if (wasEncrypted !== !!m.manifest.encryption) {
          // Names on disk mean something else now: start over from a fresh listing.
          this.pauseWatching();
          await this.startWatching();
        }
      }
    }
    for (const l of this.listeners) l(changes);
  }

  // ---------------------------------------------------------------- info and setup

  async info(): Promise<LibraryInfo> {
    const s = this.state;
    if (!s) return { kind: "device", displayPath: "", available: false, encrypted: false, locked: false, configured: false };
    if (!this.manifest && !this.gate.busy) await this.attach().catch(() => undefined);
    if (isCloudKind(s.kind)) {
      const c = await this.o.cloud?.info().catch(() => null);
      const here = c?.kind === CLOUD_KINDS[s.kind];
      const encrypted = !!this.manifest?.encryption;
      return {
        kind: s.kind,
        displayPath: here ? c!.displayPath : s.kind === "dropbox" ? "Dropbox" : "Google Drive",
        available: !!here && c!.available && !!this.manifest,
        encrypted,
        locked: encrypted && !this.enc,
        configured: true,
      };
    }
    const folder = await isFolder(s.path);
    const drive = s.kind !== "icloud" || (await isFolder(iCloudDriveRoot(this.o.home)));
    const encrypted = !!this.manifest?.encryption;
    return {
      kind: s.kind,
      displayPath: displayPath(s.path, this.o.home),
      available: folder && drive && !!this.manifest,
      encrypted,
      locked: encrypted && !this.enc,
      configured: true,
    };
  }

  private async icloudTarget(): Promise<string> {
    const helper = this.helper();
    const st = await checkICloud(this.o.home, { signedIn: helper ? () => helper.icloud().then((r) => r.signedIn) : undefined });
    if (!st.available) {
      const why = { drive_off: "iCloud Drive is turned off on this Mac.", signed_out: "This Mac isn't signed in to iCloud.", not_writable: "Folevi can't write to iCloud Drive." }[st.reason];
      throw new LibraryError("unavailable", why, st.reason);
    }
    return defaultLocation("icloud", this.o.home);
  }

  /** The library folder for a folder the person chose: it, if it's a library or empty; else "Folevi Library" in it. */
  private async libraryFolderIn(chosen: string): Promise<string> {
    let names: string[];
    try {
      names = await readdir(chosen);
    } catch {
      return chosen;
    }
    if (names.includes(LIBRARY_FILE)) return chosen;
    if (names.filter((n) => n !== ".DS_Store" && n !== "Icon\r" && !n.startsWith(".folevi")).length === 0) return chosen;
    return join(chosen, DEVICE_FOLDER);
  }

  /** The connected provider for a cloud kind, or an "unavailable" error saying what to do. */
  private async cloudFor(kind: "dropbox" | "gdrive"): Promise<CloudSource> {
    const cloud = this.o.cloud;
    const name = kind === "dropbox" ? "Dropbox" : "Google Drive";
    const info = cloud ? await cloud.info().catch(() => null) : null;
    if (!cloud || info?.kind !== CLOUD_KINDS[kind] || !cloud.fs()) throw new LibraryError("unavailable", `Connect ${name} first.`, "not_connected");
    return cloud;
  }

  private async target(kind: LibraryKind): Promise<{ path: string; chosenFolder?: string } | null> {
    if (isCloudKind(kind)) {
      await this.cloudFor(kind);
      return { path: "" };
    }
    if (kind === "device") return { path: defaultLocation("device", this.o.home) };
    if (kind === "icloud") return { path: await this.icloudTarget() };
    if (kind === "folder") {
      const chosen = await this.o.chooseFolder({ title: "Choose a folder for your Folevi library", defaultPath: this.state?.chosenFolder ?? join(this.o.home, "Documents") });
      if (!chosen) return null;
      return { path: await this.libraryFolderIn(chosen), chosenFolder: chosen };
    }
    throw new LibraryError("invalid_argument", "Unknown library kind.");
  }

  /** Makes sure a folder holds a library: a new manifest when there's none. Returns its id. */
  private async prepare(path: string): Promise<string> {
    await mkdir(path, { recursive: true });
    if (!(await probeWritable(path))) throw new LibraryError("unavailable", "Folevi can't write to that folder.", "not_writable");
    const fs = new NodeFs({ root: path, coordinator: await this.coordinatorFor(path) });
    const existing = await this.readManifest(fs);
    if (existing) return existing.manifest.libraryId;
    const m: LibraryManifest = { format: "folevi-library", v: 1, libraryId: newLibraryId(this.now()), createdAt: this.now(), minWriterVersion: 1, encryption: null };
    const w = await fs.write(LIBRARY_FILE, encodeManifest(m), { ifMatch: null });
    if ("mismatch" in w) {
      // Another device made it just now.
      const again = await this.readManifest(fs);
      if (!again) throw new LibraryError("unreadable", "The library file in that folder can't be read yet.");
      return again.manifest.libraryId;
    }
    return m.libraryId;
  }

  /** First run: "This device only", "Sync with iCloud" or "Choose a folder". Null when the picker was cancelled. */
  async setup(o: { kind: LibraryKind }): Promise<LibraryInfo | null> {
    return this.gate.only(async () => {
      const t = await this.target(o.kind);
      if (!t) return null;
      const libraryId = isCloudKind(o.kind) ? (await (await this.cloudFor(o.kind)).prepare()).libraryId : await this.prepare(t.path);
      this.saveState({ v: 1, kind: o.kind, path: t.path, libraryId, ...(t.chosenFolder ? { chosenFolder: t.chosenFolder } : {}) });
      this.journalStore = null;
      await this.attach();
      return this.info();
    });
  }

  // ---------------------------------------------------------------- files (the page's calls)

  private remember(path: string, entry: LocalFsEntry | null) {
    // In iCloud Drive a file just written isn't uploaded yet: its upload is reported when it is.
    this.watcher?.noteOwnChange(path, entry, { pendingUpload: !!this.plain?.coordinator });
  }

  list(dir: string): Promise<LocalFsEntry[]> {
    return this.gate.shared(() => this.current().list(dir));
  }

  read(path: string): Promise<ReadResult> {
    return this.gate.shared(() => this.current().read(path));
  }

  write(path: string, bytes: Uint8Array, o: { ifMatch?: string | null } = {}): Promise<WriteResult> {
    return this.gate.shared(async () => {
      checkPath(path);
      const fs = this.current();
      const r = await fs.write(path, bytes, o);
      if (!("mismatch" in r)) {
        this.remember(path, { path, size: bytes.length, mtimeMs: this.now(), etag: r.etag, downloaded: true, hasConflicts: false });
        if (path === LIBRARY_FILE && this.base) {
          const m = await this.readManifest(this.base);
          if (m) this.useManifest(m.manifest, m.etag);
        }
      }
      return r;
    });
  }

  remove(path: string, o: { ifMatch?: string } = {}): Promise<void> {
    return this.gate.shared(async () => {
      if (checkPath(path) === LIBRARY_FILE) throw new LibraryError("invalid_path", "The library file can't be removed.", path);
      await this.current().remove(path, o);
      this.remember(path, null);
    });
  }

  conflictVersions(path: string) {
    return this.gate.shared(() => this.current().conflictVersions(path));
  }

  resolveConflicts(path: string, ids: string[]) {
    return this.gate.shared(() => this.current().resolveConflicts(path, ids));
  }

  startDownload(paths: string[]) {
    return this.gate.shared(() => this.current().startDownload(paths));
  }

  /** Subscribes to change batches. Returns the unsubscribe function. */
  watch(cb: (changes: LibraryChange[]) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** A full listing now: the 30 s timer, waking from sleep, the app coming to the front, "Sync now". */
  rescan(): Promise<void> {
    return this.watcher?.rescan() ?? Promise.resolve();
  }

  // ---------------------------------------------------------------- the journal

  journal(): FileJournal {
    const s = this.state;
    if (!s) throw new LibraryError("not_set_up", "No library has been set up on this Mac.");
    if (!this.journalStore || !this.journalStore.path.endsWith(`journal-${s.libraryId}.bin`)) this.journalStore = new FileJournal(join(this.o.userData, "library", `journal-${s.libraryId}.bin`));
    return this.journalStore;
  }

  // ---------------------------------------------------------------- passphrase

  private async writeManifest(change: (m: LibraryManifest) => LibraryManifest): Promise<void> {
    const plain = this.base;
    if (!plain) throw new LibraryError("unavailable", "The library folder can't be reached right now.");
    for (let attempt = 0; attempt < 5; attempt++) {
      const cur = await this.readManifest(plain);
      if (!cur) throw new LibraryError("unreadable", "The library file can't be read right now.");
      const next = change(cur.manifest);
      const w = await plain.write(LIBRARY_FILE, encodeManifest(next), { ifMatch: cur.etag });
      if (!("mismatch" in w)) {
        this.remember(LIBRARY_FILE, { path: LIBRARY_FILE, size: 0, mtimeMs: this.now(), etag: w.etag, downloaded: true, hasConflicts: false });
        this.useManifest(next, w.etag);
        return;
      }
    }
    throw new LibraryError("busy", "The library file kept changing; try again.");
  }

  /** Unlocks an encrypted library. False when the passphrase is wrong. */
  async unlock(passphrase: string): Promise<boolean> {
    if (typeof passphrase !== "string" || passphrase.length > 1024) throw new LibraryError("invalid_argument", "A passphrase is text.");
    const m = this.manifest;
    if (!m) {
      if (!this.state) throw new LibraryError("not_set_up", "No library has been set up on this Mac.");
      throw new LibraryError("unavailable", "The library folder can't be reached right now.");
    }
    if (!m.encryption) return true;
    const key = await unlockMasterKey(m.encryption, passphrase).catch(() => null);
    if (!key) return false;
    this.keys.set(m.libraryId, key);
    const wasLocked = !this.enc;
    this.useManifest(m, this.manifestEtag ?? "");
    if (wasLocked) {
      this.pauseWatching();
      await this.startWatching();
    }
    void this.resumeEncryption().catch(() => undefined);
    return true;
  }

  /** Locks it again on this Mac (the cached key is forgotten). */
  lock() {
    if (this.manifest) this.keys.clear(this.manifest.libraryId);
    if (this.manifest && this.manifestEtag !== null) this.useManifest(this.manifest, this.manifestEtag);
  }

  /**
   * Turns encryption on (a passphrase), changes the passphrase of an unlocked library, or turns it off (null).
   * On and off rewrite every file; that resumes after a restart. The page's calls wait meanwhile.
   */
  async setPassphrase(passphrase: string | null): Promise<void> {
    if (passphrase !== null && (typeof passphrase !== "string" || passphrase.length < 1 || passphrase.length > 1024)) throw new LibraryError("invalid_argument", "A passphrase is 1 to 1024 characters.");
    this.current(); // set up, reachable and unlocked
    try {
      await this.switchEncryption(passphrase);
    } finally {
      // Names on disk changed: a fresh baseline (also after a failure part way).
      if (!this.watcher && !this.unwatchCloud && this.base) await this.startWatching();
    }
  }

  private switchEncryption(passphrase: string | null): Promise<void> {
    return this.gate.only(async () => {
      this.pauseWatching();
      const m = this.manifest!;
      if (passphrase === null) {
        if (!m.encryption) return;
        this.saveState({ ...this.state!, encryptionJob: { direction: "decrypt" } });
        await this.runEncryptionJob();
        return;
      }
      if (m.encryption) {
        const key = this.key();
        if (!key) throw new LibraryError("locked", "The library is encrypted: enter its passphrase.");
        const header = await wrapMasterKey(key, passphrase, { iterations: this.o.iterations });
        await this.writeManifest((cur) => ({ ...cur, encryption: header }));
        return;
      }
      const { header, masterKey } = await createEncryption(passphrase, { iterations: this.o.iterations });
      this.keys.set(m.libraryId, masterKey);
      this.saveState({ ...this.state!, encryptionJob: { direction: "encrypt" } });
      await this.writeManifest((cur) => ({ ...cur, encryption: header }));
      await this.runEncryptionJob();
    });
  }

  /** Changes the passphrase given the old one. False when the old one is wrong. */
  async changePassphrase(oldPassphrase: string, newPassphrase: string): Promise<boolean> {
    if (typeof oldPassphrase !== "string" || typeof newPassphrase !== "string" || newPassphrase.length < 1 || newPassphrase.length > 1024)
      throw new LibraryError("invalid_argument", "A passphrase is 1 to 1024 characters.");
    const m = this.manifest;
    if (!m?.encryption) return false;
    const key = await unlockMasterKey(m.encryption, oldPassphrase).catch(() => null);
    if (!key) return false;
    const header = await wrapMasterKey(key, newPassphrase, { iterations: m.encryption.kdf.iterations });
    await this.gate.only(() => this.writeManifest((cur) => ({ ...cur, encryption: header })));
    this.keys.set(m.libraryId, key);
    this.useManifest(this.manifest!, this.manifestEtag ?? "");
    return true;
  }

  private async resumeEncryption() {
    if (!this.state?.encryptionJob || !this.base || !this.manifest) return;
    if (this.state.encryptionJob.direction === "encrypt" && !this.manifest.encryption) {
      // It stopped before the manifest was written: nothing was converted; start again when asked.
      const s = { ...this.state };
      delete s.encryptionJob;
      this.saveState(s);
      return;
    }
    if (!this.key()) return; // after unlock
    await this.gate.only(() => this.runEncryptionJob());
  }

  /** Rewrites every file for the job in library.json; safe to run again (each file says what it is). */
  private async runEncryptionJob(): Promise<void> {
    const plain = this.base!;
    const job = this.state!.encryptionJob!;
    const key = this.key();
    if (!key) throw new LibraryError("locked", "The library is encrypted: enter its passphrase.");
    const enc = new EncryptedNodeFs(plain, key);
    let leftover = 0;
    for (let pass = 0; pass < 3; pass++) {
      leftover = 0;
      const entries = (await plain.list("")).filter((e) => e.path !== LIBRARY_FILE);
      const waiting = entries.filter((e) => !e.downloaded).map((e) => e.path);
      if (waiting.length) await plain.startDownload(waiting);
      for (const e of entries) {
        if (!e.downloaded) {
          leftover++;
          continue;
        }
        const r = await plain.read(e.path).catch(() => null);
        if (!r || "notDownloaded" in r) {
          leftover++;
          continue;
        }
        const isPlain = e.path.startsWith(`${FILES_DIR}/`) ? ATTACHMENT_PLAIN.test(e.path) : !isEnvelope(r.bytes);
        if (job.direction === "encrypt" && isPlain) {
          const target = enc.physical(e.path);
          const sealed = enc.seal(target, r.bytes);
          if (target === e.path) {
            const w = await plain.write(e.path, sealed, { ifMatch: r.etag });
            if ("mismatch" in w) leftover++;
          } else {
            await plain.write(target, sealed, {});
            await plain.remove(e.path, { ifMatch: r.etag }).catch(() => leftover++);
          }
        } else if (job.direction === "decrypt" && !isPlain) {
          const logical = await enc.logical(e.path);
          if (!logical) {
            leftover++;
            continue;
          }
          let opened: Uint8Array;
          try {
            opened = enc.open(e.path, r.bytes);
          } catch {
            leftover++;
            continue;
          }
          if (logical === e.path) {
            const w = await plain.write(e.path, opened, { ifMatch: r.etag });
            if ("mismatch" in w) leftover++;
          } else {
            await plain.write(logical, opened, {});
            await plain.remove(e.path, { ifMatch: r.etag }).catch(() => leftover++);
          }
        }
      }
      if (!leftover) break;
    }
    if (leftover) throw new LibraryError("not_downloaded", `${leftover} files couldn't be rewritten yet; Folevi will finish later.`);
    if (job.direction === "decrypt") {
      const id = this.manifest!.libraryId;
      await this.writeManifest((cur) => ({ ...cur, encryption: null }));
      this.keys.clear(id);
    }
    const s = { ...this.state! };
    delete s.encryptionJob;
    this.saveState(s);
    this.useManifest(this.manifest!, this.manifestEtag ?? "");
  }

  // ---------------------------------------------------------------- moving

  /**
   * Copies the library to another place, checks every file arrived, then switches to it. The old folder is
   * left as it was (Settings tells the person they can delete it). Calling it again with the same place, or
   * restarting, picks up where it stopped: files already there and equal are skipped.
   */
  async move(to: { kind: LibraryKind }): Promise<LibraryInfo> {
    if (!this.state) throw new LibraryError("not_set_up", "No library has been set up on this Mac.");
    if (!this.base || !this.manifest) throw new LibraryError("unavailable", "The library folder can't be reached right now.");
    const t = await this.target(to.kind);
    if (!t) return this.info();
    if (isCloudKind(to.kind) || isCloudKind(this.state.kind)) {
      if (to.kind === this.state.kind) return this.info();
    } else {
      const from = await realpath(this.state.path).catch(() => this.state!.path);
      await mkdir(t.path, { recursive: true });
      const dest = await realpath(t.path);
      if (dest === from) {
        this.saveState({ ...this.state, kind: to.kind, ...(t.chosenFolder ? { chosenFolder: t.chosenFolder } : {}) });
        return this.info();
      }
      if (inside(dest, from) || inside(from, dest)) throw new LibraryError("invalid_argument", "A library can't move into itself or into a folder that holds it.");
    }
    this.saveState({ ...this.state, move: { kind: to.kind, path: t.path, ...(t.chosenFolder ? { chosenFolder: t.chosenFolder } : {}) } });
    await this.gate.only(() => this.finishMove());
    return this.info();
  }

  private async finishMove(): Promise<void> {
    const s = this.state!;
    const mv = s.move!;
    if (!this.base) {
      const base = await this.baseFor(s.kind, s.path);
      if (!base) throw new LibraryError("unavailable", "The library can't be reached right now.");
      this.base = base;
      if (base instanceof NodeFs) this.plain = base;
    }
    const src = this.base;
    let dst: LibraryFs;
    if (isCloudKind(mv.kind)) dst = (await this.cloudFor(mv.kind)).fs()!;
    else {
      await mkdir(mv.path, { recursive: true });
      if (!(await probeWritable(mv.path))) throw new LibraryError("unavailable", "Folevi can't write to that folder.", "not_writable");
      dst = new NodeFs({ root: mv.path, coordinator: await this.coordinatorFor(mv.path) });
    }
    const theirs = await this.readManifest(dst);
    if (theirs && theirs.manifest.libraryId !== s.libraryId) throw new LibraryError("target_has_library", "That place already holds another Folevi library.");
    let entries = await src.list("");
    const waiting = entries.filter((e) => !e.downloaded).map((e) => e.path);
    if (waiting.length) {
      await src.startDownload(waiting);
      for (let i = 0; i < 120 && (entries = await src.list("")).some((e) => !e.downloaded); i++) await new Promise((r) => setTimeout(r, 500));
      if (entries.some((e) => !e.downloaded)) throw new LibraryError("not_downloaded", "Some files are still downloading; Folevi will finish moving the library later.");
    }
    // The library file goes last: a place with it holds a whole library.
    const ordered = [...entries.filter((e) => e.path !== LIBRARY_FILE), ...entries.filter((e) => e.path === LIBRARY_FILE)];
    for (const e of ordered) {
      const r = await src.read(e.path);
      if ("notDownloaded" in r) throw new LibraryError("not_downloaded", "Some files are still downloading.");
      const there = await dst.read(e.path).catch(() => null);
      if (there && !("notDownloaded" in there) && Buffer.compare(Buffer.from(there.bytes), Buffer.from(r.bytes)) === 0) continue;
      await dst.write(e.path, r.bytes, {});
    }
    // Every file arrived whole.
    const copied = new Map((await dst.list("")).map((e) => [e.path, e]));
    for (const e of entries) {
      const d = copied.get(e.path);
      if (!d || d.size !== e.size) throw new LibraryError("io", `${e.path} didn't arrive whole; moving again will finish it.`);
    }
    const next: StoredState = { v: 1, kind: mv.kind, path: mv.path, libraryId: s.libraryId, ...(mv.chosenFolder ? { chosenFolder: mv.chosenFolder } : s.chosenFolder && mv.kind === "folder" ? { chosenFolder: s.chosenFolder } : {}) };
    if (s.encryptionJob) next.encryptionJob = s.encryptionJob;
    this.saveState(next);
    await this.attach();
  }

  // ---------------------------------------------------------------- the end

  dispose() {
    this.detach();
    void this.journalStore?.close();
    this.helperInstance?.close();
    this.helperInstance = null;
    this.listeners.clear();
  }
}
