// Wire shapes for end-to-end encrypted content (docs/E2EE_DESIGN.md §4.6). The matching Convex validators
// live in convex/lib/e2ee/validators.ts (WP2); tests/convex/e2ee-wire.test.ts asserts they agree.
//
// `Bytes` is an ArrayBuffer on the wire (Convex `v.bytes()`).
import { canonicalJson, type InlineNode, type WireBlock } from "@folevi/editor-schema";
import { fromUtf8, utf8 } from "../../bytes";

export type Bytes = ArrayBuffer;

/** A block as it travels for a sealed document. It is a valid vWireBlock: the plaintext fields hold fixed placeholders. */
export interface SealedWireBlock {
  id: string;
  /** Placeholder; the real type is inside `sealed.c`. */
  type: "sealed";
  parentId: string | null;
  rank: string;
  /** Placeholder. */
  schemaVersion: 0;
  /** Placeholder. */
  text: [];
  /** Placeholder. */
  props: Record<string, never>;
  revision?: number;
  sealed: SealedBlockFields;
}

export interface SealedBlockFields {
  /** FLV1 0x03 of canonicalJson({ type, schemaVersion, text, props }) with props.collapsed removed. */
  c: Bytes;
  /** Keyed content MAC (§4.5). */
  mac: string;
  /** Note key version (also in the header; plaintext so the server can find old-key rows). */
  k: number;
  /** A toggle's open/closed state (last writer wins, no contentRev bump, as today). */
  collapsed?: true;
  /** Only on synced blocks: the source document's public id (the server checks access). */
  syncedSource?: string;
  /** Profile public ids mentioned in this block now (the server notifies the new ones). */
  mentions?: string[];
  /** Only with notification previews on (§7.7), at most 140 characters each. */
  mentionPreview?: { title: string; line: string };
}

/** document.create for a sealed document: vDocumentCreate with placeholders plus these. */
export interface SealedDocumentCreate {
  title: "";
  icon: null;
  style?: undefined;
  cover?: undefined;
  /** Templates are copied on the device (§6.7). */
  templateId?: null;
  sealed: {
    title: Bytes;
    titleMac: string;
    /** canonicalJson({ icon, cover, style }) */
    appearance: Bytes;
    /** canonicalJson({ templateKey?, row?: { collectionId, rank, values } }) */
    meta?: Bytes;
    /** The first note key, wrapped by the space key. */
    noteKey: { v: 1; spaceVersion: number; wrapped: Bytes };
    /** This note itself is "Always fully encrypted". */
    lockedOwn?: true;
    /** Files this note references (cover image included), for access and GC. */
    fileIds?: string[];
  };
}

export interface SealedDocumentPatch {
  sealedTitle?: { c: Bytes; mac: string };
  sealedAppearance?: Bytes;
  sealedMeta?: Bytes;
  // folderId / parentDocumentId stay plaintext, as in vDocumentPatch
}

/** What every sealed field looks like inside results returned to the client (documents, folders, comments, ...). */
export interface SealedField {
  c: Bytes;
  k: number;
}

// ---- Signed statements (§4.4 FST1, bodies from §4.7, §4.8, §4.9, §8.4) ----

export type StatementKind = "device" | "space-grant" | "note-grant" | "account-key";

/**
 * As stored on the server: `body` is canonicalJson of the statement body (the exact bytes that were signed,
 * after the kind prefix) and `sig` is base64url of the Ed25519 signature.
 */
export interface SignedStatement<K extends StatementKind = StatementKind> {
  kind: K;
  body: string;
  sig: string;
}

/** Public keys inside statement bodies are base64url strings. */
export interface AccountKeyStatementBody {
  profileId: string;
  epoch: number;
  x25519Pub: string;
  ed25519Pub: string;
  createdAt: number;
}

export interface DeviceStatementBody {
  profileId: string;
  deviceId: string;
  kind: "app" | "browser" | "session";
  x25519Pub: string;
  ed25519Pub: string;
  label: string;
  approvedBy: string; // a deviceId, or "recovery"
  approvedAt: number;
}

export interface SpaceGrantStatementBody {
  scope: string;
  version: number;
  profileId: string;
  granteeX25519Pub: string;
  grantedBy: string;
  at: number;
}

export interface NoteGrantStatementBody {
  documentId: string;
  version: number;
  profileId: string;
  granteeX25519Pub: string;
  grantedBy: string;
  at: number;
}

export interface StatementBodies {
  "account-key": AccountKeyStatementBody;
  device: DeviceStatementBody;
  "space-grant": SpaceGrantStatementBody;
  "note-grant": NoteGrantStatementBody;
}

// ---- Block plaintext (de)serialization ----

/** The sealed part of a block: everything the placeholders hide. */
export interface BlockPlaintext {
  type: string;
  schemaVersion: number;
  text: InlineNode[];
  props: Record<string, unknown>;
}

/** The plaintext, structural part of a block that stays visible. */
export type BlockShell = Pick<WireBlock, "id" | "parentId" | "rank" | "revision">;

/**
 * The bytes sealed into `SealedBlockFields.c`: canonicalJson({ type, schemaVersion, text, props }) with
 * `props.collapsed` removed (it travels as `sealed.collapsed` so the server can apply it without a content rev).
 */
export function blockPlaintext(block: Pick<WireBlock, "type" | "schemaVersion" | "text" | "props">): Uint8Array {
  const props: Record<string, unknown> = { ...block.props };
  delete props.collapsed;
  return utf8(
    canonicalJson({ type: block.type, schemaVersion: block.schemaVersion, text: block.text, props }),
  );
}

/**
 * Rebuilds a WireBlock from opened plaintext and the visible shell. `collapsed` is the row's
 * `sealed.collapsed` (only `true` is ever stored). Throws on malformed plaintext.
 */
export function blockFromPlaintext(
  bytes: Uint8Array,
  shell: BlockShell,
  collapsed?: boolean,
): WireBlock {
  const value: unknown = JSON.parse(fromUtf8(bytes));
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Sealed block content is not an object.");
  const v = value as Record<string, unknown>;
  if (typeof v.type !== "string" || v.type === "" || v.type === "sealed")
    throw new Error("Sealed block content has no type.");
  if (typeof v.schemaVersion !== "number" || !Number.isInteger(v.schemaVersion))
    throw new Error("Sealed block content has no schema version.");
  if (!Array.isArray(v.text)) throw new Error("Sealed block content has no text.");
  if (!v.props || typeof v.props !== "object" || Array.isArray(v.props))
    throw new Error("Sealed block content has no props.");
  const props: Record<string, unknown> = { ...(v.props as Record<string, unknown>) };
  delete props.collapsed;
  if (collapsed) props.collapsed = true;
  const block: WireBlock = {
    id: shell.id,
    type: v.type,
    parentId: shell.parentId,
    rank: shell.rank,
    schemaVersion: v.schemaVersion,
    text: v.text as InlineNode[],
    props,
  };
  if (shell.revision !== undefined) block.revision = shell.revision;
  return block;
}

/** The placeholder fields every SealedWireBlock carries. */
export const SEALED_PLACEHOLDERS = {
  type: "sealed",
  schemaVersion: 0,
  text: [] as [],
  props: {} as Record<string, never>,
} as const;

/** True for a block row that carries sealed content. */
export function isSealedWireBlock(block: { sealed?: unknown }): block is SealedWireBlock {
  return block.sealed !== undefined && block.sealed !== null;
}

/** Copies a Uint8Array into a standalone ArrayBuffer for the wire. */
export function toWireBytes(bytes: Uint8Array): Bytes {
  const out = new ArrayBuffer(bytes.length);
  new Uint8Array(out).set(bytes);
  return out;
}

/** A Uint8Array view of wire bytes (ArrayBuffer, or a view already). */
export function fromWireBytes(bytes: Bytes | ArrayBufferView): Uint8Array {
  if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes);
  return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}
