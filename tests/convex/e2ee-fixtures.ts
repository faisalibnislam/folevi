// Test fixtures for end-to-end encrypted content (WP3 tests): an encrypted space set up directly in the
// database (a stub of WP2's e2ee.spaces.setUp / enable, which the client calls in the real flow), and a
// device-side sealer built on @folevi/local-store/e2ee (WP1) that turns plaintext blocks, titles and
// fields into the sealed wire shapes of docs/E2EE_DESIGN.md §4.6, and opens what the server sends back.
//
// The server never opens anything; only these tests (playing the device) do.
import {
  blockFromPlaintext,
  blockPlaintext,
  ctx as aad,
  deriveNoteKeys,
  deriveSpaceKeys,
  importAead,
  macOf,
  openRecord,
  randomBytes,
  sealFileStream,
  sealRecord,
  tagNameMac,
  type NoteKeys,
  type SpaceKeys,
} from "@folevi/local-store/e2ee";
import { canonicalJson, ulid, type SyncOp, type WireBlock } from "@folevi/editor-schema";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { T } from "./helpers";

type Person = { as: { mutation: (...a: never[]) => unknown; query: (...a: never[]) => unknown }; profileId: string };

const enc = new TextEncoder();
const dec = new TextDecoder();
const buf = (u: Uint8Array): ArrayBuffer => u.slice().buffer as ArrayBuffer;
const u8 = (b: ArrayBuffer) => new Uint8Array(b);

export type Level = "standard" | "selected" | "full";

/** A scope as the AAD contexts name it (§4.5): personal:<profile id> or workspace:<workspace public id>. */
export function scopeId(scope: { kind: "personal" } | { kind: "workspace"; workspaceId: string }, profileId: string): string {
  return scope.kind === "personal" ? `personal:${profileId}` : `workspace:${scope.workspaceId}`;
}

/**
 * Sets up encryption for a scope as WP2's setUp + enable would: an e2eeSpaces row at `level` (state "on",
 * or the given state) and space key version 1. Returns the space keys a device of the space holds.
 */
export async function encryptedSpace(
  t: T,
  owner: Person,
  opts: { workspaceId?: string; level?: Level; state?: "off" | "enabling" | "on" | "disabling" } = {},
) {
  const sk = randomBytes(32);
  const keys: SpaceKeys = await deriveSpaceKeys(sk.slice());
  const level = opts.level ?? "full";
  const state = opts.state ?? (level === "standard" ? "off" : "on");
  await t.run(async (ctx) => {
    const profileId = owner.profileId as Id<"profiles">;
    let scoped: { ownerProfileId: Id<"profiles"> } | { workspaceId: Id<"workspaces"> };
    let key: string;
    if (opts.workspaceId) {
      const ws = await ctx.db
        .query("workspaces")
        .withIndex("by_public_id", (q) => q.eq("publicId", opts.workspaceId!))
        .unique();
      scoped = { workspaceId: ws!._id };
      key = `w:${ws!._id}`;
    } else {
      scoped = { ownerProfileId: profileId };
      key = `p:${profileId}`;
    }
    const now = Date.now();
    await ctx.db.insert("e2eeSpaces", {
      ...scoped,
      scopeKey: key,
      level,
      state,
      switches: { foliAi: "off", backgroundAi: false, searchEverywhere: false, apps: false, emailToNote: false, webClipper: false, notificationPreviews: false },
      currentKeyVersion: 1,
      lockedCount: 0,
      changedBy: profileId,
      changedAt: now,
      seq: 0,
    } as never);
    await ctx.db.insert("e2eeSpaceKeys", { ...scoped, scopeKey: key, version: 1, inboxPub: new ArrayBuffer(32), skCheck: new ArrayBuffer(16), createdBy: profileId, createdAt: now } as never);
  });
  return { keys, scope: opts.workspaceId ? scopeId({ kind: "workspace", workspaceId: opts.workspaceId }, owner.profileId) : scopeId({ kind: "personal" }, owner.profileId) };
}

/** Changes a space's level and state (WP2's enable / lower would). */
export async function setLevel(t: T, profileId: string, level: Level, state: "off" | "enabling" | "on" | "disabling") {
  await t.run(async (ctx) => {
    const row = await ctx.db
      .query("e2eeSpaces")
      .withIndex("by_scope_key", (q) => q.eq("scopeKey", `p:${profileId}`))
      .unique();
    await ctx.db.patch(row!._id, { level, state });
  });
}

/**
 * One device's view of an encrypted space: a note key per document (version 1, made at create, or added
 * with `adoptNoteKey`), and the sealing and opening of everything §4.6 puts on the wire.
 */
export class Sealer {
  private noteKeys = new Map<string, { nk: Uint8Array; keys: NoteKeys; v: number }>();
  constructor(
    readonly space: { keys: SpaceKeys; scope: string },
    readonly spaceVersion = 1,
  ) {}

  private async note(docId: string): Promise<{ keys: NoteKeys; v: number }> {
    let n = this.noteKeys.get(docId);
    if (!n) {
      const nk = randomBytes(32);
      n = { nk, keys: await deriveNoteKeys(nk.slice()), v: 1 };
      this.noteKeys.set(docId, n);
    }
    return n;
  }

  /** The note key wrapped by the space key, as document.create and beginDocument carry it. */
  async wrappedNoteKey(docId: string, version = 1): Promise<ArrayBuffer> {
    await this.note(docId);
    const nk = this.noteKeys.get(docId)!.nk;
    return buf(await sealRecord(this.space.keys.wrap, this.spaceVersion, aad.noteKeySpace(docId, version, this.space.scope, this.spaceVersion), nk));
  }

  /** A new note key version for a document (rotation): later seals use it. */
  async rotate(docId: string): Promise<{ version: number; wrapped: ArrayBuffer }> {
    const old = await this.note(docId);
    const nk = randomBytes(32);
    const next = { nk, keys: await deriveNoteKeys(nk.slice()), v: old.v + 1 };
    this.noteKeys.set(docId, next);
    return { version: next.v, wrapped: buf(await sealRecord(this.space.keys.wrap, this.spaceVersion, aad.noteKeySpace(docId, next.v, this.space.scope, this.spaceVersion), nk)) };
  }

  async sealField(docId: string, field: "title" | "appearance" | "meta", value: unknown): Promise<ArrayBuffer> {
    const n = await this.note(docId);
    const context = field === "title" ? aad.docTitle(docId) : field === "appearance" ? aad.docAppearance(docId) : aad.docMeta(docId);
    const text = typeof value === "string" && field === "title" ? value : canonicalJson(value);
    return buf(await sealRecord(n.keys.content, n.v, context, enc.encode(text)));
  }

  async titleMac(docId: string, title: string): Promise<string> {
    const n = await this.note(docId);
    return await macOf(n.keys.mac, aad.docTitle(docId), enc.encode(title));
  }

  async openTitle(docId: string, sealed: { c: ArrayBuffer }): Promise<string> {
    const n = await this.note(docId);
    return dec.decode(await openRecord(n.keys.content, aad.docTitle(docId), u8(sealed.c)));
  }

  /** document.create for a sealed note (§4.6 SealedDocumentCreate). */
  async createOp(docId: string, o: { title?: string; icon?: string; parentDocumentId?: string | null; folderId?: string | null; kind?: string; dailyDate?: string; lockedOwn?: true; fileIds?: string[] } = {}): Promise<SyncOp> {
    const title = o.title ?? "";
    return {
      opId: ulid(),
      kind: "document.create",
      document: {
        id: docId,
        parentDocumentId: o.parentDocumentId ?? null,
        folderId: o.folderId ?? null,
        kind: (o.kind ?? "document") as never,
        title: "",
        icon: null,
        ...(o.dailyDate ? { dailyDate: o.dailyDate } : {}),
        sealed: {
          title: await this.sealField(docId, "title", title),
          titleMac: await this.titleMac(docId, title),
          appearance: await this.sealField(docId, "appearance", { icon: o.icon ?? null, cover: { kind: "none" }, style: null }),
          noteKey: { v: 1, spaceVersion: this.spaceVersion, wrapped: await this.wrappedNoteKey(docId) },
          ...(o.lockedOwn ? { lockedOwn: true } : {}),
          ...(o.fileIds ? { fileIds: o.fileIds } : {}),
        },
      } as never,
    };
  }

  /** document.update renaming a sealed note. */
  async renameOp(docId: string, title: string, baseRevision: number | null): Promise<SyncOp> {
    return {
      opId: ulid(),
      kind: "document.update",
      documentId: docId,
      patch: { sealedTitle: { c: await this.sealField(docId, "title", title), mac: await this.titleMac(docId, title) } } as never,
      baseRevision,
    };
  }

  /** A plaintext block as a SealedWireBlock (§6.6 sealBlock). */
  async sealBlock(docId: string, block: WireBlock): Promise<WireBlock> {
    const n = await this.note(docId);
    const context = aad.block(docId, block.id);
    const plain = blockPlaintext(block);
    const sealed: Record<string, unknown> = {
      c: buf(await sealRecord(n.keys.content, n.v, context, plain)),
      mac: await macOf(n.keys.mac, context, plain),
      k: n.v,
    };
    if ((block.props as { collapsed?: unknown }).collapsed === true) sealed.collapsed = true;
    if (block.type === "synced" && typeof (block.props as { sourceId?: unknown }).sourceId === "string") sealed.syncedSource = (block.props as { sourceId: string }).sourceId;
    const mentions = mentionIds(block);
    if (mentions.length) sealed.mentions = mentions;
    const out: Record<string, unknown> = { id: block.id, type: "sealed", parentId: block.parentId, rank: block.rank, schemaVersion: 0, text: [], props: {}, sealed };
    if (block.revision !== undefined) out.revision = block.revision;
    return out as unknown as WireBlock;
  }

  /** A SealedWireBlock from the server back to the plaintext block it holds. */
  async openBlock(docId: string, block: WireBlock & { sealed?: { c: ArrayBuffer; collapsed?: true } }): Promise<WireBlock> {
    if (!block.sealed) return block;
    const n = this.noteKeys.get(docId);
    if (!n) throw new Error("no note key");
    const bytes = await openRecord(n.keys.content, aad.block(docId, block.id), u8(block.sealed.c));
    return blockFromPlaintext(bytes, { id: block.id, parentId: block.parentId, rank: block.rank, revision: block.revision }, block.sealed.collapsed === true);
  }

  /** A sealed upsert op for `block` (sealed here). */
  async upsert(docId: string, block: WireBlock, baseRevision: number | null, fields: ("content" | "position" | "collapsed")[] = ["content", "position"]): Promise<SyncOp> {
    return { opId: ulid(), kind: "block.upsert", documentId: docId, block: await this.sealBlock(docId, block), baseRevision, fields };
  }

  /** Any sealed record under a note (comment body, found text, version name, collection record…). */
  async sealNoteRecord(docId: string, context: string, value: unknown): Promise<ArrayBuffer> {
    const n = await this.note(docId);
    return buf(await sealRecord(n.keys.content, n.v, context, enc.encode(typeof value === "string" ? value : canonicalJson(value))));
  }

  async openNoteRecord(docId: string, context: string, c: ArrayBuffer): Promise<string> {
    const n = await this.note(docId);
    return dec.decode(await openRecord(n.keys.content, context, u8(c)));
  }

  /** A folder or tag name sealed with the space key "space/meta". */
  async sealSpaceName(kind: "folder" | "tag", id: string, name: string): Promise<ArrayBuffer> {
    const context = kind === "folder" ? aad.folder(this.space.scope, id) : aad.tag(this.space.scope, id);
    return buf(await sealRecord(this.space.keys.meta, this.spaceVersion, context, enc.encode(name)));
  }

  async openSpaceName(kind: "folder" | "tag", id: string, c: ArrayBuffer): Promise<string> {
    const context = kind === "folder" ? aad.folder(this.space.scope, id) : aad.tag(this.space.scope, id);
    return dec.decode(await openRecord(this.space.keys.meta, context, u8(c)));
  }

  async tagMac(name: string): Promise<string> {
    return await tagNameMac(this.space.keys.mac, name);
  }

  /** A file sealed for a note (§6.8): the keyed stream bytes, its SHA-256 and the row's sealed fields. */
  async sealFileBytes(docId: string, fileId: string, plain: Uint8Array, meta: { name: string; mime: string }) {
    const n = await this.note(docId);
    const fk = randomBytes(32);
    const key = buf(await sealRecord(n.keys.files, n.v, aad.fileKey(docId, fileId), fk));
    const fileKey = await importAead(fk.slice());
    const sealedMeta = buf(await sealRecord(fileKey, 0, aad.fileMeta(docId, fileId), enc.encode(canonicalJson(meta))));
    const bytes = await sealFileStream(fileKey, aad.file(fileId), plain);
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes.slice()));
    const sha256 = [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
    return { bytes: buf(bytes), sha256, row: { key, meta: sealedMeta, k: n.v, plainSize: plain.length } };
  }

  noteVersion(docId: string): number {
    return this.noteKeys.get(docId)?.v ?? 1;
  }
}

function mentionIds(block: WireBlock): string[] {
  const out: string[] = [];
  for (const n of block.text as { type: string; userId?: string }[]) if (n.type === "mention" && n.userId && !out.includes(n.userId)) out.push(n.userId);
  return out;
}

/** Pushes ops through sync.push. */
export async function push(p: Person, ops: SyncOp[], deviceId = "device-e2ee-1", scope: unknown = { kind: "personal" }) {
  return (await (p.as.mutation as (r: unknown, a: unknown) => Promise<unknown>)(api.sync.push, { scope, deviceId, ops })) as {
    opId: string;
    status: string;
    revision?: number;
    block?: (WireBlock & { sealed?: { c: ArrayBuffer; mac: string; k: number; collapsed?: true; syncedSource?: string; mentions?: string[] } }) | null;
    deleted?: boolean;
    conflict?: { reason: string; server: WireBlock | null; client: WireBlock | null };
    error?: { code: string; message: string };
    normalized?: boolean;
    document?: Record<string, unknown>;
  }[];
}

// ---------------------------------------------------------------- the no-plaintext scan (§11.2)

const toB64 = (s: string) => btoa(String.fromCharCode(...enc.encode(s)));
const toUtf16 = (s: string) => {
  const out: string[] = [];
  for (const ch of s) out.push(ch, "\u0000");
  return out.join("");
};

/** Every encoding of a marker the scan looks for. */
export function markerForms(marker: string): string[] {
  return [marker, toUtf16(marker), toB64(marker), toB64(marker).replace(/=+$/, ""), marker.toLowerCase()];
}

/** Finds markers anywhere in a value (strings, nested objects, and bytes decoded as UTF-8 and UTF-16). */
export function findMarkers(value: unknown, markers: string[], path = "", hits: string[] = []): string[] {
  const forms = markers.flatMap((m) => markerForms(m).map((f) => [m, f] as const));
  const visit = (v: unknown, p: string) => {
    if (v === null || v === undefined) return;
    if (typeof v === "string") {
      for (const [m, f] of forms) if (v.includes(f)) hits.push(`${p}: ${m}`);
      return;
    }
    if (v instanceof ArrayBuffer || ArrayBuffer.isView(v)) {
      const bytes = v instanceof ArrayBuffer ? new Uint8Array(v) : new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
      const asText = dec.decode(bytes);
      const asUtf16 = String.fromCharCode(...bytes);
      for (const [m, f] of forms) if (asText.includes(f) || asUtf16.includes(f)) hits.push(`${p} (bytes): ${m}`);
      return;
    }
    if (Array.isArray(v)) {
      v.forEach((x, i) => visit(x, `${p}[${i}]`));
      return;
    }
    if (typeof v === "object") for (const [k, x] of Object.entries(v as Record<string, unknown>)) visit(x, `${p}.${k}`);
  };
  visit(value, path);
  return hits;
}
