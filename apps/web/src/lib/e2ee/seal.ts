// Sealing and opening content on the device (docs/E2EE_DESIGN.md §4.4 to §4.6, WP7): blocks, a note's
// title, appearance and meta, folder and tag names, comments, version names, records, and files' keys and
// metadata. Every key comes from the key ring (WP6); every context is rebuilt from where the bytes belong
// (`ctx` from WP1), so ciphertext moved to another note, block or person fails to open.
//
// Plaintext never leaves this module except as the opened value; nothing here logs content or keys.
import {
  blockFromPlaintext,
  blockPlaintext,
  ctx,
  fromWireBytes,
  importAead,
  macOf,
  openRecord,
  randomBytes,
  recordKeyVersion,
  sealRecord,
  tagNameMac,
  toWireBytes,
  type Bytes,
  type SealedBlockFields,
  type SealedWireBlock,
} from "@folevi/local-store/e2ee";
import { canonicalJson, DEFAULT_COVER, DEFAULT_DOCUMENT_STYLE, type InlineNode, type WireBlock } from "@folevi/editor-schema";
import type { KeyRingLike } from "./router/deps";

const enc = new TextEncoder();
const dec = new TextDecoder();

const json = (value: unknown) => enc.encode(canonicalJson(value));
const parse = (bytes: Uint8Array): unknown => JSON.parse(dec.decode(bytes));

/** Wire bytes (an ArrayBuffer, or a view of one) as a Uint8Array. */
export function bytesOf(b: Bytes | ArrayBufferView): Uint8Array {
  return fromWireBytes(b);
}

/** What a note looks like: its icon, cover and page style (sealed together, §4.6). */
export interface Appearance {
  icon: string | null;
  cover?: unknown;
  style?: unknown;
}

/** A note's meta (sealed): the template it came from and, on a collection row's note, its row. */
export interface DocumentMeta {
  templateKey?: string | null;
  row?: { collectionId: string; rank: string; values: Record<string, unknown> } | null;
}

/** A note's sealed fields as results carry them (§5.3 PulledDocument.sealed). */
export interface SealedDocumentFields {
  title: { c: Bytes; k: number; mac: string };
  appearance: { c: Bytes; k: number };
  meta?: { c: Bytes; k: number } | null;
}

export interface OpenedDocumentFields {
  title: string;
  icon: string | null;
  cover: unknown;
  style: unknown;
  templateKey: string | null;
  row: DocumentMeta["row"];
}

/** Optional notification preview text a block carries when previews are on (§7.7). */
export interface MentionPreview {
  title: string;
  line: string;
}

const PREVIEW_MAX = 140;

/** The profile ids mentioned anywhere in a block's text (and table cells). */
export function mentionIds(block: Pick<WireBlock, "text" | "props">): string[] {
  const out = new Set<string>();
  const scan = (nodes: unknown) => {
    if (!Array.isArray(nodes)) return;
    for (const n of nodes as InlineNode[]) {
      const m = n as { type?: unknown; userId?: unknown };
      if (m && m.type === "mention" && typeof m.userId === "string" && m.userId) out.add(m.userId);
    }
  };
  scan(block.text);
  const rows = (block.props as { rows?: unknown } | null)?.rows;
  if (Array.isArray(rows)) for (const r of rows) if (Array.isArray(r)) for (const cell of r) scan(cell);
  return [...out].slice(0, 50);
}

/** The text a block shows that fails to open (§6.6): a read-only paragraph in its place. */
export const UNREADABLE_TEXT = "This block couldn't be decrypted. It may have been damaged.";

export function unreadableBlock(shell: Pick<WireBlock, "id" | "parentId" | "rank" | "revision">): WireBlock {
  const b: WireBlock = {
    id: shell.id,
    type: "paragraph",
    parentId: shell.parentId,
    rank: shell.rank,
    schemaVersion: 1,
    text: [{ type: "text", text: UNREADABLE_TEXT }],
    props: { e2eeUnreadable: true },
  };
  if (shell.revision !== undefined) b.revision = shell.revision;
  return b;
}

/** A block that failed to open, shown read-only. */
export function isUnreadableBlock(block: Pick<WireBlock, "props">): boolean {
  return (block.props as { e2eeUnreadable?: unknown } | null)?.e2eeUnreadable === true;
}

const clip = (s: string) => (s.length > PREVIEW_MAX ? s.slice(0, PREVIEW_MAX) : s);

/** Seals and opens through one key ring. `scopeId` is the space's `personal:<id>` / `workspace:<id>` (§4.5). */
export class Sealer {
  constructor(private readonly keyring: KeyRingLike) {}

  private noteContentKey = (documentId: string) => async (version: number) => (await this.keyring.noteKeys(documentId, version)).content;

  // ---- blocks -----------------------------------------------------------------------------------------

  async sealBlock(documentId: string, block: WireBlock, o: { preview?: MentionPreview | null } = {}): Promise<SealedWireBlock> {
    const nk = await this.keyring.noteKeys(documentId);
    const context = ctx.block(documentId, block.id);
    const plaintext = blockPlaintext(block);
    const [c, mac] = await Promise.all([sealRecord(nk.content, nk.version, context, plaintext), macOf(nk.mac, context, plaintext)]);
    plaintext.fill(0);
    const sealed: SealedBlockFields = { c: toWireBytes(c), mac, k: nk.version };
    if ((block.props as { collapsed?: unknown }).collapsed === true) sealed.collapsed = true;
    const source = (block.props as { sourceId?: unknown }).sourceId;
    if (block.type === "synced" && typeof source === "string") sealed.syncedSource = source;
    const mentions = mentionIds(block);
    if (mentions.length) {
      sealed.mentions = mentions;
      if (o.preview) sealed.mentionPreview = { title: clip(o.preview.title), line: clip(o.preview.line) };
    }
    const out: SealedWireBlock = { id: block.id, type: "sealed", parentId: block.parentId, rank: block.rank, schemaVersion: 0, text: [], props: {}, sealed };
    if (block.revision !== undefined) out.revision = block.revision;
    return out;
  }

  /** The content MAC a block would have now (equality without plaintext on the server). */
  async blockMac(documentId: string, block: WireBlock): Promise<string> {
    const nk = await this.keyring.noteKeys(documentId);
    return await macOf(nk.mac, ctx.block(documentId, block.id), blockPlaintext(block));
  }

  /** Opens a sealed block. Throws when it can't (a wrong key, a moved ciphertext, damage). */
  async openBlock(documentId: string, block: Pick<SealedWireBlock, "id" | "parentId" | "rank" | "revision" | "sealed">): Promise<WireBlock> {
    const bytes = await openRecord(this.noteContentKey(documentId), ctx.block(documentId, block.id), bytesOf(block.sealed.c));
    try {
      return blockFromPlaintext(bytes, { id: block.id, parentId: block.parentId, rank: block.rank, revision: block.revision }, block.sealed.collapsed === true);
    } finally {
      bytes.fill(0);
    }
  }

  /** Opens a sealed block, or returns the read-only "couldn't be decrypted" block in its place (§6.6). */
  async openBlockOrUnreadable(documentId: string, block: Pick<SealedWireBlock, "id" | "parentId" | "rank" | "revision" | "sealed">): Promise<WireBlock> {
    try {
      return await this.openBlock(documentId, block);
    } catch {
      // Logged without content or keys: which block, never what's in it.
      console.warn(`[e2ee] A block couldn't be decrypted (${documentId}/${block.id}).`);
      return unreadableBlock(block);
    }
  }

  // ---- documents --------------------------------------------------------------------------------------

  async sealTitle(documentId: string, title: string): Promise<{ c: Bytes; mac: string; k: number }> {
    const nk = await this.keyring.noteKeys(documentId);
    const context = ctx.docTitle(documentId);
    const plaintext = json(title);
    const [c, mac] = await Promise.all([sealRecord(nk.content, nk.version, context, plaintext), macOf(nk.mac, context, plaintext)]);
    return { c: toWireBytes(c), mac, k: nk.version };
  }

  async sealAppearance(documentId: string, a: Appearance): Promise<Bytes> {
    const nk = await this.keyring.noteKeys(documentId);
    return toWireBytes(await sealRecord(nk.content, nk.version, ctx.docAppearance(documentId), json({ icon: a.icon ?? null, cover: a.cover, style: a.style })));
  }

  async sealMeta(documentId: string, meta: DocumentMeta): Promise<Bytes> {
    const nk = await this.keyring.noteKeys(documentId);
    return toWireBytes(await sealRecord(nk.content, nk.version, ctx.docMeta(documentId), json(meta)));
  }

  async openTitle(documentId: string, c: Bytes): Promise<string> {
    const v = parse(await openRecord(this.noteContentKey(documentId), ctx.docTitle(documentId), bytesOf(c)));
    if (typeof v !== "string") throw new Error("A sealed title isn't text.");
    return v;
  }

  async openAppearance(documentId: string, c: Bytes): Promise<Required<Appearance>> {
    const v = parse(await openRecord(this.noteContentKey(documentId), ctx.docAppearance(documentId), bytesOf(c))) as Partial<Appearance> | null;
    if (!v || typeof v !== "object") throw new Error("A sealed appearance isn't an object.");
    return { icon: typeof v.icon === "string" ? v.icon : null, cover: v.cover ?? DEFAULT_COVER, style: v.style ?? DEFAULT_DOCUMENT_STYLE };
  }

  async openMeta(documentId: string, c: Bytes): Promise<DocumentMeta> {
    const v = parse(await openRecord(this.noteContentKey(documentId), ctx.docMeta(documentId), bytesOf(c))) as DocumentMeta | null;
    if (!v || typeof v !== "object") throw new Error("A sealed meta isn't an object.");
    return v;
  }

  async openDocumentFields(documentId: string, sealed: SealedDocumentFields): Promise<OpenedDocumentFields> {
    const [title, appearance, meta] = await Promise.all([
      this.openTitle(documentId, sealed.title.c),
      this.openAppearance(documentId, sealed.appearance.c),
      sealed.meta ? this.openMeta(documentId, sealed.meta.c) : Promise.resolve({} as DocumentMeta),
    ]);
    return { title, icon: appearance.icon, cover: appearance.cover, style: appearance.style, templateKey: meta.templateKey ?? null, row: meta.row ?? null };
  }

  // ---- folders and tags (the space key's "space/meta", §4.5) ------------------------------------------

  async sealFolderName(scope: Parameters<KeyRingLike["spaceKeys"]>[0], scopeId: string, folderId: string, name: string): Promise<{ c: Bytes; k: number }> {
    const sk = await this.keyring.spaceKeys(scope);
    return { c: toWireBytes(await sealRecord(sk.meta, sk.version, ctx.folder(scopeId, folderId), json(name))), k: sk.version };
  }

  async openFolderName(scope: Parameters<KeyRingLike["spaceKeys"]>[0], scopeId: string, folderId: string, c: Bytes): Promise<string> {
    const bytes = bytesOf(c);
    const sk = await this.keyring.spaceKeys(scope, recordKeyVersion(bytes));
    const v = parse(await openRecord(sk.meta, ctx.folder(scopeId, folderId), bytes));
    if (typeof v !== "string") throw new Error("A sealed folder name isn't text.");
    return v;
  }

  async sealTagName(scope: Parameters<KeyRingLike["spaceKeys"]>[0], scopeId: string, tagId: string, name: string): Promise<{ c: Bytes; k: number; nameMac: string }> {
    const sk = await this.keyring.spaceKeys(scope);
    const [c, nameMac] = await Promise.all([sealRecord(sk.meta, sk.version, ctx.tag(scopeId, tagId), json(name)), tagNameMac(sk.mac, name)]);
    return { c: toWireBytes(c), k: sk.version, nameMac };
  }

  async openTagName(scope: Parameters<KeyRingLike["spaceKeys"]>[0], scopeId: string, tagId: string, c: Bytes): Promise<string> {
    const bytes = bytesOf(c);
    const sk = await this.keyring.spaceKeys(scope, recordKeyVersion(bytes));
    const v = parse(await openRecord(sk.meta, ctx.tag(scopeId, tagId), bytes));
    if (typeof v !== "string") throw new Error("A sealed tag name isn't text.");
    return v;
  }

  // ---- comments and version names (the note key, §4.5) ------------------------------------------------

  async sealComment(documentId: string, commentId: string, body: unknown[]): Promise<{ c: Bytes; k: number }> {
    const nk = await this.keyring.noteKeys(documentId);
    return { c: toWireBytes(await sealRecord(nk.content, nk.version, ctx.comment(documentId, commentId), json(body))), k: nk.version };
  }

  async openComment(documentId: string, commentId: string, c: Bytes): Promise<unknown[]> {
    const v = parse(await openRecord(this.noteContentKey(documentId), ctx.comment(documentId, commentId), bytesOf(c)));
    if (!Array.isArray(v)) throw new Error("A sealed comment isn't a list of nodes.");
    return v;
  }

  async sealVersionName(documentId: string, snapshotId: string, name: string): Promise<{ c: Bytes; k: number }> {
    const nk = await this.keyring.noteKeys(documentId);
    return { c: toWireBytes(await sealRecord(nk.content, nk.version, ctx.versionName(documentId, snapshotId), json(name))), k: nk.version };
  }

  async openVersionName(documentId: string, snapshotId: string, c: Bytes): Promise<string> {
    const v = parse(await openRecord(this.noteContentKey(documentId), ctx.versionName(documentId, snapshotId), bytesOf(c)));
    if (typeof v !== "string") throw new Error("A sealed version name isn't text.");
    return v;
  }

  // ---- records (§4.5: under a note with its key, else with the space's "space/meta") --------------------

  async sealRecordValue(
    target: { documentId: string } | { scope: Parameters<KeyRingLike["spaceKeys"]>[0] },
    scopeId: string,
    kind: string,
    recordId: string,
    value: unknown,
  ): Promise<{ sealed: Bytes; keyVersion: number }> {
    const context = ctx.spaceRecord(scopeId, kind, recordId);
    if ("documentId" in target) {
      const nk = await this.keyring.noteKeys(target.documentId);
      return { sealed: toWireBytes(await sealRecord(nk.content, nk.version, context, json(value))), keyVersion: nk.version };
    }
    const sk = await this.keyring.spaceKeys(target.scope);
    return { sealed: toWireBytes(await sealRecord(sk.meta, sk.version, context, json(value))), keyVersion: sk.version };
  }

  async openRecordValue(target: { documentId: string } | { scope: Parameters<KeyRingLike["spaceKeys"]>[0] }, scopeId: string, kind: string, recordId: string, sealed: Bytes): Promise<unknown> {
    const context = ctx.spaceRecord(scopeId, kind, recordId);
    const bytes = bytesOf(sealed);
    if ("documentId" in target) return parse(await openRecord(this.noteContentKey(target.documentId), context, bytes));
    const sk = await this.keyring.spaceKeys(target.scope, recordKeyVersion(bytes));
    return parse(await openRecord(sk.meta, context, bytes));
  }

  // ---- files (§4.1: a file key per attachment, wrapped by the note's "note/files") ---------------------

  /** A new file key for a note's attachment: the raw key (the caller zeroes it) and its wrap. */
  async newFileKey(documentId: string, fileId: string): Promise<{ raw: Uint8Array; wrapped: Bytes; k: number }> {
    const nk = await this.keyring.noteKeys(documentId);
    const raw = randomBytes(32);
    const wrapped = await sealRecord(nk.files, nk.version, ctx.fileKey(documentId, fileId), raw, { compress: false });
    return { raw, wrapped: toWireBytes(wrapped), k: nk.version };
  }

  /** The raw file key from its wrap (the caller zeroes it once imported). */
  async openFileKey(documentId: string, fileId: string, wrapped: Bytes): Promise<Uint8Array> {
    const raw = await openRecord(async (v) => (await this.keyring.noteKeys(documentId, v)).files, ctx.fileKey(documentId, fileId), bytesOf(wrapped));
    if (raw.length !== 32) throw new Error("A file key must be 32 bytes.");
    return raw;
  }

  /** Seals a file's metadata with its file key (a copy of `raw` is imported; `raw` is left as it was). */
  static async sealFileMeta(raw: Uint8Array, documentId: string, fileId: string, meta: unknown): Promise<Bytes> {
    const key = await importAead(raw.slice());
    return toWireBytes(await sealRecord(key, 0, ctx.fileMeta(documentId, fileId), json(meta)));
  }

  static async openFileMeta(raw: Uint8Array, documentId: string, fileId: string, sealed: Bytes): Promise<unknown> {
    const key = await importAead(raw.slice());
    return parse(await openRecord(key, ctx.fileMeta(documentId, fileId), bytesOf(sealed)));
  }
}

let defaultSealer: Sealer | null = null;

/** The sealer the app uses (set when the router starts, from WP6's key ring). */
export function configureSealer(keyring: KeyRingLike | null): Sealer | null {
  defaultSealer = keyring ? new Sealer(keyring) : null;
  return defaultSealer;
}

export function currentSealer(): Sealer {
  if (!defaultSealer) throw new Error("End-to-end encryption isn't unlocked on this device.");
  return defaultSealer;
}

/** §12 WP7: seals a block of a sealed note with the note's newest key. */
export function sealBlock(documentId: string, block: WireBlock): Promise<SealedWireBlock> {
  return currentSealer().sealBlock(documentId, block);
}

/** §12 WP7: opens a sealed block (throws when it can't). */
export function openBlock(documentId: string, block: SealedWireBlock): Promise<WireBlock> {
  return currentSealer().openBlock(documentId, block);
}
