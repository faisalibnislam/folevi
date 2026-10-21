// Sealed rows on the server (docs/E2EE_DESIGN.md §4.6, §5.4, §5.5): what a sealed block, title or field
// must look like, how sealed rows travel back to clients, which note key versions exist and where locks
// come from. The server checks sizes, placeholders, headers and key versions; it never opens anything.
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import type { WireBlock } from "@folevi/editor-schema";
import { failE2ee, spaceE2ee } from "./state";
import { E2EE_LIMITS, type SealedBlockFieldsInput } from "./validators";
import { scopeKey, type Scope } from "../scope";

type Ctx = QueryCtx | MutationCtx;

/** FLV1 mode 0x03 (keyed record): "FLV1", 0x03, flags, keyVersion uint32 BE, nonce (12), then ciphertext + tag. */
const RECORD_HEADER = 22;
const TAG = 16;
const MAGIC = [0x46, 0x4c, 0x56, 0x31];
const MODE_RECORD = 0x03;
const MAC = /^[A-Za-z0-9_-]{22}$/;

/** The key version in a keyed record's header, or null when the bytes aren't a keyed record. */
export function recordHeaderVersion(bytes: ArrayBuffer): number | null {
  if (!(bytes instanceof ArrayBuffer) || bytes.byteLength < RECORD_HEADER + TAG) return null;
  const b = new Uint8Array(bytes, 0, RECORD_HEADER);
  for (let i = 0; i < 4; i++) if (b[i] !== MAGIC[i]) return null;
  if (b[4] !== MODE_RECORD) return null;
  // Only bit 0 (compressed) is defined.
  if ((b[5]! & 0xfe) !== 0) return null;
  return new DataView(bytes, 6, 4).getUint32(0, false);
}

/** Refuses anything but a keyed record of at most `max` bytes sealed with key version `k` (when given). */
export function checkRecord(bytes: unknown, max: number, what: string, k?: number): ArrayBuffer {
  if (!(bytes instanceof ArrayBuffer)) failE2ee("e2ee_plaintext", `${what} must be sealed.`);
  if (bytes.byteLength > max) failE2ee("e2ee_plaintext", `${what} is too large.`);
  const version = recordHeaderVersion(bytes);
  if (version === null) failE2ee("e2ee_plaintext", `${what} isn't a sealed record.`);
  if (k !== undefined && version !== k) failE2ee("e2ee_plaintext", `${what} names another key version.`);
  return bytes;
}

export function checkMac(mac: unknown, what: string): string {
  if (typeof mac !== "string" || !MAC.test(mac)) failE2ee("e2ee_plaintext", `${what} needs a content check value.`);
  return mac;
}

/** A sealed block as a sync op carries it (§4.6). */
export type SealedWireBlockIn = WireBlock & { sealed?: SealedBlockFieldsInput };

/** The plaintext columns of a sealed block row. */
export function sealedPlaceholders(collapsed: boolean) {
  return { type: "sealed", schemaVersion: 0, text: [] as never[], props: collapsed ? { collapsed: true } : {} };
}

/**
 * Checks a sealed block's placeholders and sealed fields (§5.4 validateSealedBlock). Returns the first
 * problem, or null. Key version existence is checked by the caller (it needs the database).
 */
export function sealedBlockIssue(block: SealedWireBlockIn): string | null {
  const s = block.sealed;
  if (!s) return "sealed: missing";
  if (block.type !== "sealed") return "type: must be the placeholder";
  if (block.schemaVersion !== 0) return "schemaVersion: must be the placeholder";
  if (!Array.isArray(block.text) || block.text.length !== 0) return "text: must be the placeholder";
  const props = block.props as Record<string, unknown> | null;
  if (!props || typeof props !== "object" || Array.isArray(props) || Object.keys(props).length !== 0) return "props: must be the placeholder";
  if (typeof block.id !== "string" || block.id.length < 8 || block.id.length > 64) return "id: invalid";
  if (typeof block.rank !== "string" || block.rank.length < 1 || block.rank.length > 200) return "rank: invalid";
  if (!(s.c instanceof ArrayBuffer) || s.c.byteLength > E2EE_LIMITS.blockBytes) return "sealed.c: too large";
  const version = recordHeaderVersion(s.c);
  if (version === null) return "sealed.c: not a sealed record";
  if (!Number.isInteger(s.k) || s.k < 1 || version !== s.k) return "sealed.k: doesn't match the record";
  if (typeof s.mac !== "string" || !MAC.test(s.mac)) return "sealed.mac: invalid";
  if (s.mentions !== undefined) {
    if (s.mentions.length > E2EE_LIMITS.mentionsPerBlock) return "sealed.mentions: too many";
    if (s.mentions.some((m) => typeof m !== "string" || m.length > 64)) return "sealed.mentions: invalid";
  }
  if (s.syncedSource !== undefined && (typeof s.syncedSource !== "string" || s.syncedSource.length > 64)) return "sealed.syncedSource: invalid";
  if (s.mentionPreview && (s.mentionPreview.title.length > 140 || s.mentionPreview.line.length > 140)) return "sealed.mentionPreview: too long";
  return null;
}

/** A sealed block row as clients receive it: the placeholders and `sealed` (§4.6 SealedWireBlock). */
export function toSealedWireBlock(row: Doc<"blocks">): WireBlock & { sealed: SealedBlockFieldsInput } {
  const sealed: SealedBlockFieldsInput = { c: row.sealed!.c, mac: row.sealed!.mac, k: row.sealed!.k };
  if ((row.props as { collapsed?: unknown } | null)?.collapsed === true) sealed.collapsed = true;
  if (row.syncedSource !== undefined) sealed.syncedSource = row.syncedSource;
  if (row.mentionIds?.length) sealed.mentions = row.mentionIds;
  return { id: row.blockId, type: "sealed", parentId: row.parentId, rank: row.rank, schemaVersion: 0, text: [], props: {}, revision: row.revision, sealed };
}

/** Sealed fields of a note in results (§5.3 PulledDocument.sealed, DocumentSummary.sealed). */
export interface SealedDocumentFields {
  title: { c: ArrayBuffer; k: number; mac: string };
  appearance: { c: ArrayBuffer; k: number };
  meta?: { c: ArrayBuffer; k: number };
}

export function sealedFieldsOf(doc: Doc<"documents">): SealedDocumentFields | undefined {
  if (doc.sealedAt === undefined || !doc.sealedTitle || !doc.sealedAppearance) return undefined;
  const out: SealedDocumentFields = { title: doc.sealedTitle, appearance: doc.sealedAppearance };
  if (doc.sealedMeta) out.meta = doc.sealedMeta;
  return out;
}

/** The note key versions a note has (any wrapping), cached per call. */
export class NoteKeyVersions {
  private cache = new Map<Id<"documents">, Set<number>>();
  constructor(private ctx: Ctx) {}
  async of(documentId: Id<"documents">): Promise<Set<number>> {
    let set = this.cache.get(documentId);
    if (!set) {
      const rows = await this.ctx.db
        .query("e2eeNoteKeys")
        .withIndex("by_document", (q) => q.eq("documentId", documentId))
        .take(500);
      set = new Set(rows.map((r) => r.version));
      this.cache.set(documentId, set);
    }
    return set;
  }
  add(documentId: Id<"documents">, version: number) {
    this.cache.get(documentId)?.add(version);
  }
  async has(documentId: Id<"documents">, version: number): Promise<boolean> {
    return (await this.of(documentId)).has(version);
  }
}

/** Space rows per scope, read once per call (Standard: one indexed read that finds nothing). */
export class SpaceRows {
  private cache = new Map<string, Doc<"e2eeSpaces"> | null>();
  constructor(private ctx: Ctx) {}
  async of(scope: Scope): Promise<Doc<"e2eeSpaces"> | null> {
    const key = scopeKey(scope);
    if (!this.cache.has(key)) this.cache.set(key, await spaceE2ee(this.ctx, scope));
    return this.cache.get(key) ?? null;
  }
  forget(scope: Scope) {
    this.cache.delete(scopeKey(scope));
  }
}

/** Whether new notes in this space must be sealed: an encrypted level (any state). */
export function sealsNewNotes(space: Doc<"e2eeSpaces"> | null): boolean {
  return space !== null && space.level !== "standard";
}

/** A space key version that exists for the scope and isn't retired; refuses otherwise (e2ee_not_set_up). */
export async function requireSpaceKey(ctx: Ctx, scope: Scope, version: number): Promise<Doc<"e2eeSpaceKeys">> {
  const row = await ctx.db
    .query("e2eeSpaceKeys")
    .withIndex("by_scope_version", (q) => q.eq("scopeKey", scopeKey(scope)).eq("version", version))
    .unique();
  if (!row) failE2ee("e2ee_not_set_up", "This space has no encryption key with that version.");
  if (row.retiredAt !== undefined) failE2ee("e2ee_not_set_up", "That space key was replaced. Use the current one.");
  return row;
}

/** Whether the scope has any space key (sealed writes need one). */
export async function hasSpaceKey(ctx: Ctx, scope: Scope): Promise<boolean> {
  const row = await ctx.db
    .query("e2eeSpaceKeys")
    .withIndex("by_scope_version", (q) => q.eq("scopeKey", scopeKey(scope)))
    .first();
  return row !== null;
}

/**
 * The locked folder a folder is in (itself or its nearest locked ancestor), or undefined. Bounded in depth,
 * as folder nesting is (docs/NESTED_FOLDERS).
 */
export async function lockOfFolder(ctx: Ctx, folderId: Id<"folders"> | undefined): Promise<Id<"folders"> | undefined> {
  let cursor = folderId;
  for (let depth = 0; cursor && depth < 32; depth++) {
    const f: Doc<"folders"> | null = await ctx.db.get(cursor);
    if (!f || f.deletedAt) return undefined;
    if (f.locked) return f._id;
    cursor = f.parentFolderId;
  }
  return undefined;
}

/** Where a note's lock comes from given its folder and parent page (a nested page follows its parent). */
export async function lockFor(ctx: Ctx, folderId: Id<"folders"> | undefined, parent: Doc<"documents"> | null): Promise<Id<"folders"> | undefined> {
  if (parent) return parent.lockedVia ?? (await lockOfFolder(ctx, parent.folderId));
  return await lockOfFolder(ctx, folderId);
}

/** Whether a note must be sealed: it is already, its space is encrypted, or it is locked. */
export function mustBeSealed(doc: Doc<"documents">, space: Doc<"e2eeSpaces"> | null): boolean {
  return doc.sealedAt !== undefined || sealsNewNotes(space);
}

/** Bytes of an ArrayBuffer as base64url (SealedVersionContent carries ciphertext as text, §5.4). */
export function bytesToB64u(bytes: ArrayBuffer): string {
  const b = new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64uToBytes(text: string): ArrayBuffer {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) failE2ee("e2ee_plaintext", "Malformed sealed content.");
  const pad = text.length % 4 === 2 ? "==" : text.length % 4 === 3 ? "=" : "";
  const bin = atob(text.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}
