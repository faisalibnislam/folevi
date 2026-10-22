// Fakes for the WP7 tests (docs/E2EE_DESIGN.md §12 WP7: "stubbed with a fake server until merged"):
//
// - FakeKeyRing: WP6's KeyRing over real WP1 crypto (space keys per scope, note keys made, wrapped by the
//   space key and opened from pulled wraps), so what the router seals really is ciphertext.
// - FakeSession: an unlocked (or locked) key session.
// - FakeConvex: the plain Convex client underneath, with the handful of server functions the router calls
//   (e2ee.spaces.mine, users.me, sync.push, e2ee.pull.*, blocks.list, documents.get, e2ee.content.*) as an
//   in-memory server that stores what it's sent, never opens anything, and refuses plaintext for sealed notes
//   as WP3's sync engine does. Watches re-run after every mutation.
import { ConvexError } from "convex/values";
import { getFunctionName, type FunctionReference } from "convex/server";
import { ctx as aad, deriveNoteKeys, deriveSpaceKeys, openRecord, randomBytes, sealRecord, toWireBytes, type NoteKeys, type SpaceKeys } from "@folevi/local-store/e2ee";
import type { OpResult, SyncOp, WireBlock, WireScope } from "@folevi/editor-schema";
import type { KeyRingLike, KeySessionLike, LockState, PulledNoteKey } from "@/lib/e2ee/router/deps";
import type { E2eePullPage, MineSpaceRow } from "@/lib/e2ee/router/refs";
import { LocalBackend, LocalClient, MemoryStore } from "@/lib/local";
import { api } from "@/lib/convex/api";
import type { LocalProfile } from "@/lib/local/functions/shared";

const scopeKey = (s: WireScope) => (s.kind === "personal" ? "personal" : `workspace:${s.workspaceId}`);

export class FakeKeyRing implements KeyRingLike {
  private sk = new Map<string, { raw: Uint8Array; keys: SpaceKeys }>();
  private notes = new Map<string, NoteKeys & { version: number }>();
  private rows = new Map<string, PulledNoteKey[]>();
  /** Every key ring call, for assertions (never key bytes). */
  calls: string[] = [];

  constructor(private readonly spaces: { scope: WireScope; scopeId: string }[]) {}

  private scopeIdOf(scope: WireScope): string {
    const s = this.spaces.find((x) => scopeKey(x.scope) === scopeKey(scope));
    if (!s) throw new Error("No such space in the fake key ring.");
    return s.scopeId;
  }

  async spaceKeys(scope: WireScope, version = 1): Promise<SpaceKeys & { version: number }> {
    const key = `${scopeKey(scope)}#${version}`;
    let hit = this.sk.get(key);
    if (!hit) {
      const raw = randomBytes(32);
      hit = { raw, keys: await deriveSpaceKeys(raw.slice()) };
      this.sk.set(key, hit);
    }
    return { ...hit.keys, version };
  }

  /** Another device of the same person: the same space keys, nothing else. */
  sibling(): FakeKeyRing {
    const other = new FakeKeyRing(this.spaces);
    for (const [k, v] of this.sk) other.sk.set(k, v);
    return other;
  }

  async noteKeys(documentId: string, version?: number): Promise<NoteKeys & { version: number }> {
    this.calls.push(`noteKeys:${documentId}`);
    const rows = this.rows.get(documentId) ?? [];
    const v = version ?? Math.max(0, ...rows.map((r) => r.version), ...[...this.notes.keys()].filter((k) => k.startsWith(`${documentId}#`)).map((k) => Number(k.split("#")[1])));
    const hit = this.notes.get(`${documentId}#${v}`);
    if (hit) return hit;
    const row = rows.find((r) => r.version === v && r.wrappedBy === "space");
    if (!row) throw new ConvexError({ code: "e2ee_no_key", message: "You don't have the key to this note." });
    for (const s of this.spaces) {
      if (row.scope && scopeKey(row.scope) !== scopeKey(s.scope)) continue;
      try {
        const sk = await this.spaceKeys(s.scope, row.spaceVersion ?? 1);
        const raw = await openRecord(sk.wrap, aad.noteKeySpace(documentId, v, s.scopeId, row.spaceVersion ?? 1), new Uint8Array(row.wrapped));
        const keys = { ...(await deriveNoteKeys(raw)), version: v };
        this.notes.set(`${documentId}#${v}`, keys);
        return keys;
      } catch {
        continue;
      }
    }
    throw new ConvexError({ code: "e2ee_no_key", message: "You don't have the key to this note." });
  }

  async newNoteKey(documentId: string, scope: WireScope) {
    this.calls.push(`newNoteKey:${documentId}`);
    const sk = await this.spaceKeys(scope);
    const nk = randomBytes(32);
    const wrapped = await sealRecord(sk.wrap, sk.version, aad.noteKeySpace(documentId, 1, this.scopeIdOf(scope), sk.version), nk);
    const keys = await deriveNoteKeys(nk.slice());
    this.notes.set(`${documentId}#1`, { ...keys, version: 1 });
    this.rows.set(documentId, [{ documentId, version: 1, wrappedBy: "space", spaceVersion: sk.version, wrapped: toWireBytes(wrapped), scope }]);
    nk.fill(0);
    return { keys, version: 1, wrapped, spaceVersion: sk.version };
  }

  async addNoteKeys(rows: PulledNoteKey[]): Promise<void> {
    for (const r of rows) {
      const list = (this.rows.get(r.documentId) ?? []).filter((x) => !(x.version === r.version && x.wrappedBy === r.wrappedBy));
      list.push(r);
      this.rows.set(r.documentId, list);
    }
  }

  async linkNoteKey(): Promise<void> {}
}

export class FakeSession implements KeySessionLike {
  private listeners = new Set<() => void>();
  constructor(
    private lock: LockState = "unlocked",
    private readonly device = "web-test-device-01",
  ) {}
  state(): LockState {
    return this.lock;
  }
  set(state: LockState) {
    this.lock = state;
    for (const l of [...this.listeners]) l();
  }
  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }
  accountKeys(): never {
    throw new Error("not needed");
  }
  deviceId(): string {
    return this.device;
  }
}

/** A profile in exactly users.me's shape (from a local library's setup). */
export async function testProfile(displayName = "Tess"): Promise<LocalProfile> {
  const client = new LocalClient(new LocalBackend(new MemoryStore(), { deviceId: "profile-maker" }));
  await client.local.setup({ timeZone: "UTC", locale: "en", displayName, seed: false });
  const me = (await client.query(api.users.me, {})) as { profile: LocalProfile & { avatarUrl?: unknown; entitlements?: unknown } };
  await client.close();
  const { avatarUrl: _a, entitlements: _e, ...profile } = me.profile;
  void _a;
  void _e;
  return profile as LocalProfile;
}

interface Row {
  documentId: string;
  block: WireBlock & { sealed?: unknown };
  revision: number;
  seq: number;
  deleted: boolean;
}

interface DocRow {
  id: string;
  scope: string;
  parentDocumentId: string | null;
  folderId: string | null;
  kind: string;
  rank: string;
  createdAt: number;
  updatedAt: number;
  revision: number;
  titleRev: number;
  seq: number;
  contentSeq: number;
  inTrash: boolean;
  sealed?: { title: { c: ArrayBuffer; k: number; mac: string }; appearance: { c: ArrayBuffer; k: number }; meta?: { c: ArrayBuffer; k: number } };
  plain?: { title: string; icon: string | null };
  noteKey?: { spaceVersion: number; wrapped: ArrayBuffer; seq: number };
}

type Watch = { onUpdate(cb: () => void): () => void; localQueryResult(): unknown; journal(): unknown; localQueryLogs(): unknown };

/** The fake Convex deployment and client (one person). */
export class FakeConvex {
  /** Every call that reached "the server": function name and args, in order. */
  log: { name: string; args: Record<string, unknown> }[] = [];
  spaces: MineSpaceRow[] = [];
  profile: LocalProfile;
  docs = new Map<string, DocRow>();
  blocks = new Map<string, Row>();
  folders = new Map<string, { id: string; scope: string; sealedName?: { c: ArrayBuffer; k: number }; name?: string; parentFolderId: string | null; seq: number }>();
  seq = 0;
  private watchers = new Set<() => void>();
  /** Handlers for functions a test adds. */
  extra = new Map<string, (args: Record<string, unknown>) => unknown>();

  constructor(profile: LocalProfile) {
    this.profile = profile;
  }

  private bump() {
    for (const w of [...this.watchers]) w();
  }

  private answer(name: string, args: Record<string, unknown>): unknown {
    const custom = this.extra.get(name);
    if (custom) return custom(args);
    switch (name) {
      case "e2ee/spaces:mine":
        return this.spaces;
      case "users:me":
        return { state: "ready", profile: { ...this.profile, avatarUrl: null, entitlements: {} } };
      case "e2ee/pull:head":
        return { seq: this.seq };
      case "e2ee/pull:mine":
        return { stars: [], recents: [], hidden: [] };
      case "e2ee/pull:pull":
        return this.pull(args as { scope: WireScope; cursor: number; limit?: number });
      case "blocks:list": {
        const d = this.docs.get(String(args.documentId));
        if (!d) return null;
        const blocks = [...this.blocks.values()].filter((r) => r.documentId === d.id && !r.deleted).map((r) => ({ ...r.block, revision: r.revision }));
        return { documentId: d.id, revision: d.revision, contentSeq: d.contentSeq, head: d.seq, blocks };
      }
      case "documents:get": {
        const d = this.docs.get(String(args.documentId));
        if (!d) return null;
        return { document: this.summary(d), access: "owner", isMember: true, folder: null, breadcrumbs: [], lastEditedBy: null, createdByName: null, inTrash: d.inTrash };
      }
      case "documents:list":
        return [...this.docs.values()].map((d) => this.summary(d));
      default:
        throw new Error(`The fake server has no ${name}.`);
    }
  }

  summary(d: DocRow) {
    return {
      id: d.id,
      workspaceId: null,
      ownerProfileId: this.profile.id,
      parentDocumentId: d.parentDocumentId,
      folderId: d.folderId,
      kind: d.kind,
      title: d.sealed ? "" : (d.plain?.title ?? ""),
      icon: d.sealed ? null : (d.plain?.icon ?? null),
      rank: d.rank,
      revision: d.revision,
      titleRev: d.titleRev,
      seq: d.seq,
      excerpt: "",
      ...(d.sealed ? { sealed: d.sealed } : {}),
    };
  }

  private pull(a: { scope: WireScope; cursor: number }): E2eePullPage {
    const key = scopeKey(a.scope);
    const docs = [...this.docs.values()].filter((d) => d.scope === key && d.seq > a.cursor);
    const blocks = [...this.blocks.values()].filter((r) => this.docs.get(r.documentId)?.scope === key && r.seq > a.cursor);
    const folders = [...this.folders.values()].filter((f) => f.scope === key && f.seq > a.cursor);
    return {
      documents: docs.map((d) => ({
        id: d.id,
        kind: d.kind,
        parentDocumentId: d.parentDocumentId,
        folderId: d.folderId,
        rank: d.rank,
        dailyDate: null,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
        archivedAt: null,
        inTrash: d.inTrash,
        deletedAt: null,
        revision: d.revision,
        titleRev: d.titleRev,
        seq: d.seq,
        contentSeq: d.contentSeq,
        tagIds: [],
        fileIds: [],
        ...(d.sealed ? { sealed: d.sealed } : { plain: { title: d.plain?.title ?? "", icon: d.plain?.icon ?? null } }),
        files: [],
      })),
      blocks: blocks.map((r) => ({ documentId: r.documentId, block: { ...r.block, revision: r.revision } as never, deleted: r.deleted })),
      folders: folders.map((f) => ({ id: f.id, parentFolderId: f.parentFolderId, rank: "a", color: null, createdAt: 1, updatedAt: 1, deletedAt: null, seq: f.seq, ...(f.sealedName ? { sealedName: f.sealedName } : { name: f.name }) })),
      tags: [],
      records: [],
      noteKeys: docs.filter((d) => d.noteKey && d.noteKey.seq > a.cursor).map((d) => ({ documentId: d.id, version: 1, wrappedBy: "space" as const, spaceVersion: d.noteKey!.spaceVersion, wrapped: d.noteKey!.wrapped })),
      space: null,
      nextCursor: this.seq,
      hasMore: false,
      head: this.seq,
    };
  }

  /** WP3's sync engine, as far as these tests need it. */
  private push(args: { scope: WireScope; ops: SyncOp[] }): OpResult[] {
    const seq = ++this.seq;
    const now = Date.now();
    const out: OpResult[] = [];
    for (const op of args.ops) {
      if (op.kind === "document.create") {
        const d = op.document as typeof op.document & { sealed?: { title: ArrayBuffer; titleMac: string; appearance: ArrayBuffer; meta?: ArrayBuffer; noteKey: { spaceVersion: number; wrapped: ArrayBuffer } } };
        if (this.docs.has(d.id)) {
          out.push({ opId: op.opId, status: "duplicate", revision: this.docs.get(d.id)!.revision });
          continue;
        }
        const scope = d.parentDocumentId ? this.docs.get(d.parentDocumentId)!.scope : scopeKey(d.scope ?? args.scope);
        const space = this.spaces.find((s) => scopeKey(s.scope) === scope);
        if (space && space.level !== "standard" && !d.sealed) {
          out.push({ opId: op.opId, status: "rejected", error: { code: "e2ee_required", message: "This note is end-to-end encrypted. Update Folevi to edit it." } });
          continue;
        }
        if (d.sealed && (d.title !== "" || d.icon !== null)) {
          out.push({ opId: op.opId, status: "rejected", error: { code: "e2ee_plaintext", message: "plaintext with sealed" } });
          continue;
        }
        const row: DocRow = {
          id: d.id,
          scope,
          parentDocumentId: d.parentDocumentId,
          folderId: d.folderId,
          kind: d.kind,
          rank: `r${seq}`,
          createdAt: now,
          updatedAt: now,
          revision: 1,
          titleRev: 1,
          seq,
          contentSeq: 0,
          inTrash: false,
          ...(d.sealed
            ? { sealed: { title: { c: d.sealed.title, k: 1, mac: d.sealed.titleMac }, appearance: { c: d.sealed.appearance, k: 1 }, ...(d.sealed.meta ? { meta: { c: d.sealed.meta, k: 1 } } : {}) }, noteKey: { spaceVersion: d.sealed.noteKey.spaceVersion, wrapped: d.sealed.noteKey.wrapped, seq } }
            : { plain: { title: d.title, icon: d.icon } }),
        };
        this.docs.set(d.id, row);
        out.push({ opId: op.opId, status: "applied", revision: 1, document: this.summary(row) } as OpResult);
        continue;
      }
      const doc = this.docs.get(op.documentId);
      if (!doc) {
        out.push({ opId: op.opId, status: "rejected", error: { code: "not_found", message: "Document not found." } });
        continue;
      }
      if (op.kind === "document.update") {
        const patch = op.patch as Record<string, unknown>;
        if (doc.sealed && (patch.title !== undefined || patch.icon !== undefined)) {
          out.push({ opId: op.opId, status: "rejected", error: { code: "e2ee_required", message: "sealed" } });
          continue;
        }
        if (patch.sealedTitle) doc.sealed = { ...doc.sealed!, title: { ...(patch.sealedTitle as { c: ArrayBuffer; mac: string }), k: 1 } };
        if (patch.sealedAppearance) doc.sealed = { ...doc.sealed!, appearance: { c: patch.sealedAppearance as ArrayBuffer, k: 1 } };
        doc.revision++;
        doc.titleRev = doc.revision;
        doc.seq = seq;
        out.push({ opId: op.opId, status: "applied", revision: doc.revision, document: this.summary(doc) } as OpResult);
        continue;
      }
      const key = `${op.documentId}/${op.kind === "block.upsert" ? op.block.id : op.blockId}`;
      const prev = this.blocks.get(key);
      if (op.kind === "block.upsert") {
        const sealed = (op.block as { sealed?: unknown }).sealed !== undefined;
        if (doc.sealed && !sealed) {
          out.push({ opId: op.opId, status: "rejected", error: { code: "e2ee_required", message: "sealed" } });
          continue;
        }
        if (sealed && (op.block.type !== "sealed" || op.block.text.length || Object.keys(op.block.props).length)) {
          out.push({ opId: op.opId, status: "rejected", error: { code: "e2ee_plaintext", message: "placeholders" } });
          continue;
        }
        const revision = (prev?.revision ?? 0) + 1;
        const { revision: _r, ...block } = op.block;
        void _r;
        this.blocks.set(key, { documentId: op.documentId, block, revision, seq, deleted: false });
        doc.seq = seq;
        doc.contentSeq++;
        out.push({ opId: op.opId, status: "applied", revision, block: { ...block, revision } });
      } else if (op.kind === "block.delete") {
        if (prev) this.blocks.set(key, { ...prev, deleted: true, revision: prev.revision + 1, seq });
        out.push({ opId: op.opId, status: "applied", revision: (prev?.revision ?? 0) + 1, deleted: true });
      } else {
        if (prev) this.blocks.set(key, { ...prev, deleted: false, revision: prev.revision + 1, seq });
        out.push({ opId: op.opId, status: "applied", revision: (prev?.revision ?? 0) + 1, block: prev ? { ...prev.block, revision: prev.revision + 1 } : null });
      }
    }
    return out;
  }

  private mutate(name: string, args: Record<string, unknown>): unknown {
    const custom = this.extra.get(name);
    if (custom) return custom(args);
    switch (name) {
      case "sync:push":
        return this.push(args as { scope: WireScope; ops: SyncOp[] });
      case "e2ee/content:createFolder": {
        const a = args as { scope: WireScope; folderId: string; parentFolderId: string | null; sealedName: ArrayBuffer };
        this.folders.set(a.folderId, { id: a.folderId, scope: scopeKey(a.scope), sealedName: { c: a.sealedName, k: 1 }, parentFolderId: a.parentFolderId, seq: ++this.seq });
        return { id: a.folderId };
      }
      case "organization:createFolder": {
        const a = args as { scope: WireScope; name: string; id?: string };
        const id = a.id ?? `F${this.seq}`;
        this.folders.set(id, { id, scope: scopeKey(a.scope), name: a.name, parentFolderId: null, seq: ++this.seq });
        return { id };
      }
      default:
        return null;
    }
  }

  // ---- the client surface the router uses -----------------------------------------------------------------

  readonly client = {
    watchQuery: (ref: FunctionReference<"query">, args: Record<string, unknown> = {}): Watch => {
      const name = getFunctionName(ref);
      return {
        onUpdate: (cb) => {
          this.watchers.add(cb);
          return () => this.watchers.delete(cb);
        },
        localQueryResult: () => this.answer(name, args),
        journal: () => undefined,
        localQueryLogs: () => undefined,
      };
    },
    query: async (ref: FunctionReference<"query">, args: Record<string, unknown> = {}) => {
      const name = getFunctionName(ref);
      this.log.push({ name, args });
      return structuredClone(this.answer(name, args));
    },
    mutation: async (ref: FunctionReference<"mutation">, args: Record<string, unknown> = {}) => {
      const name = getFunctionName(ref);
      this.log.push({ name, args });
      const r = this.mutate(name, args);
      queueMicrotask(() => this.bump());
      return structuredClone(r);
    },
    action: async (ref: FunctionReference<"action">, args: Record<string, unknown> = {}) => {
      const name = getFunctionName(ref);
      this.log.push({ name, args });
      return this.mutate(name, args);
    },
    connectionState: () => ({ isWebSocketConnected: true }),
    subscribeToConnectionState: () => () => {},
    setAuth: () => {},
    clearAuth: () => {},
    close: async () => {},
    logger: console,
  };

  /** Makes a scope e2ee-active (as e2ee.spaces.mine lists it). */
  encrypt(scope: WireScope, scopeId: string, level: "standard" | "selected" | "full" = "full", lockedCount = 0) {
    this.spaces.push({
      scope,
      scopeId,
      level,
      state: level === "standard" ? "off" : "on",
      switches: { foliAi: "off", backgroundAi: false, searchEverywhere: false, apps: false, emailToNote: false, webClipper: false, notificationPreviews: false },
      currentKeyVersion: 1,
      lockedCount,
      seq: 0,
    });
    this.bump();
  }

  /** Every byte string and string the server holds, for "no plaintext" checks. */
  stored(): string {
    const parts: string[] = [];
    const walk = (v: unknown) => {
      if (v instanceof ArrayBuffer) parts.push(new TextDecoder("utf-8", { fatal: false }).decode(v));
      else if (ArrayBuffer.isView(v)) parts.push(new TextDecoder().decode(v));
      else if (typeof v === "string") parts.push(v);
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") Object.values(v).forEach(walk);
    };
    walk([...this.docs.values()]);
    walk([...this.blocks.values()]);
    walk([...this.folders.values()]);
    return parts.join("\n");
  }
}

/** Waits until `check` holds (polling the event loop), or fails after `ms`. */
export async function until(check: () => boolean | Promise<boolean>, ms = 3000): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (await check()) return;
    if (Date.now() - start > ms) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 5));
  }
}
