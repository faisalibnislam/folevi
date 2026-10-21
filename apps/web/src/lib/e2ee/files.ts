// Attachments of sealed notes (docs/E2EE_DESIGN.md §6.8, WP7): uploads encrypted on the device, downloads
// decrypted into `blob:` URLs.
//
// Upload: the same checks as every upload (sniffed type, size limits, metadata stripped, width and height:
// lib/local/functions/files.ts prepareUpload, which local mode uses), then a random file key, the metadata
// sealed with it, the bytes as FLV1 0x04, and e2ee.files.generateUploadUrl → POST → e2ee.files.commit. The
// queue keeps the plaintext blob, so a retry encrypts again.
//
// Download: `FileCache` fetches the ciphertext from the url files.urls signed, opens it and hands out an
// object URL, keeping up to 200 MB per tab (least recently used goes first). A file over 500 MB isn't opened
// in the page (v1, §13 R12): it offers a download instead.
import { ctx, importAead, openFileStream, sealFileStream, sha256, type Bytes } from "@folevi/local-store/e2ee";
import { api } from "@/lib/convex/api";
import { ulid } from "@folevi/editor-schema";
import { prepareUpload } from "@/lib/local/functions/files";
import type { PendingUpload } from "@/lib/sync/db";
import { Sealer } from "./seal";
import { files as e2eeFiles } from "./router/refs";
import type { InnerClient } from "./router/types";
import { requireActiveRouter } from "./router/active";

export const FILE_CACHE_BYTES = 200 * 1024 * 1024;
export const MAX_OPEN_BYTES = 500 * 1024 * 1024;

/** A sealed file's server fields (files.sealed, §5.2) as results carry them. */
export interface SealedFileFields {
  key: Bytes;
  meta: Bytes;
  k: number;
  plainSize: number;
}

/** What a sealed file's metadata holds (sealed with its file key). */
export interface FileMeta {
  name: string;
  mime: string;
  width: number | null;
  height: number | null;
  palette?: unknown;
  /** SHA-256 of the plaintext, hex. */
  sha256: string;
}

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");

interface Entry {
  url: string;
  bytes: number;
  meta: FileMeta;
}

export class FileCache {
  private entries = new Map<string, Entry>();
  private loading = new Map<string, Promise<Entry>>();
  private total = 0;

  constructor(
    private readonly sealer: () => Sealer,
    private readonly o: { fetch?: typeof fetch; maxBytes?: number; createUrl?: (blob: Blob) => string; revokeUrl?: (url: string) => void } = {},
  ) {}

  private get fetcher(): typeof fetch {
    return this.o.fetch ?? ((...a) => fetch(...a));
  }

  /** The decrypted file as an object URL (and its opened metadata), fetched and opened once per tab. */
  async open(fileId: string, documentId: string, signedUrl: string, sealed: SealedFileFields): Promise<{ url: string; meta: FileMeta } | { tooLarge: true; meta: FileMeta }> {
    const hit = this.entries.get(fileId);
    if (hit) {
      // Most recently used goes to the end.
      this.entries.delete(fileId);
      this.entries.set(fileId, hit);
      return { url: hit.url, meta: hit.meta };
    }
    if (sealed.plainSize > MAX_OPEN_BYTES) return { tooLarge: true, meta: await this.meta(fileId, documentId, sealed) };
    let p = this.loading.get(fileId);
    if (!p) {
      p = this.load(fileId, documentId, signedUrl, sealed).finally(() => this.loading.delete(fileId));
      this.loading.set(fileId, p);
    }
    const e = await p;
    return { url: e.url, meta: e.meta };
  }

  /** A sealed file's metadata only (no download). */
  async meta(fileId: string, documentId: string, sealed: SealedFileFields): Promise<FileMeta> {
    const raw = await this.sealer().openFileKey(documentId, fileId, sealed.key);
    try {
      return (await Sealer.openFileMeta(raw, documentId, fileId, sealed.meta)) as FileMeta;
    } finally {
      raw.fill(0);
    }
  }

  /** The decrypted bytes (an export, an AI request the person allowed). */
  async bytes(fileId: string, documentId: string, signedUrl: string, sealed: SealedFileFields): Promise<{ bytes: Uint8Array; meta: FileMeta }> {
    const res = await this.fetcher(signedUrl);
    if (!res.ok) throw new Error(`The file couldn't be downloaded (${res.status}).`);
    const envelope = new Uint8Array(await res.arrayBuffer());
    const raw = await this.sealer().openFileKey(documentId, fileId, sealed.key);
    try {
      const meta = (await Sealer.openFileMeta(raw, documentId, fileId, sealed.meta)) as FileMeta;
      const bytes = await openFileStream(await importAead(raw.slice()), ctx.file(fileId), envelope);
      return { bytes, meta };
    } finally {
      raw.fill(0);
    }
  }

  private async load(fileId: string, documentId: string, signedUrl: string, sealed: SealedFileFields): Promise<Entry> {
    const { bytes, meta } = await this.bytes(fileId, documentId, signedUrl, sealed);
    const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: meta.mime || "application/octet-stream" });
    const url = (this.o.createUrl ?? URL.createObjectURL)(blob);
    const entry = { url, bytes: bytes.length, meta };
    this.entries.set(fileId, entry);
    this.total += entry.bytes;
    this.evict();
    return entry;
  }

  private evict() {
    const max = this.o.maxBytes ?? FILE_CACHE_BYTES;
    for (const [id, e] of this.entries) {
      if (this.total <= max || this.entries.size <= 1) break;
      this.entries.delete(id);
      this.total -= e.bytes;
      (this.o.revokeUrl ?? URL.revokeObjectURL)(e.url);
    }
  }

  /** Lets go of every decrypted file (lock, sign-out). */
  clear(): void {
    for (const e of this.entries.values()) (this.o.revokeUrl ?? URL.revokeObjectURL)(e.url);
    this.entries.clear();
    this.total = 0;
  }

  get size(): number {
    return this.total;
  }
}

export interface SealedUploadDeps {
  inner: InnerClient;
  sealer: Sealer;
  fetch?: typeof fetch;
}

/**
 * Encrypts and uploads one attachment of a sealed note (§6.8). The checks are local mode's (the same as the
 * server's for plaintext uploads); errors carry the same codes, so the uploader's retry rules apply as they are.
 */
export async function uploadSealedWith(d: SealedUploadDeps, p: Pick<PendingUpload, "documentId" | "filename" | "mimeType" | "kind" | "blob">): Promise<{ fileId: string; mimeType: string }> {
  const prepared = await prepareUpload(p.blob, { name: p.filename, mimeType: p.mimeType, kind: p.kind, documentId: p.documentId });
  const fileId = ulid();
  const { raw, wrapped, k } = await d.sealer.newFileKey(p.documentId, fileId);
  try {
    const meta: FileMeta = { name: prepared.name, mime: prepared.mimeType, width: prepared.width, height: prepared.height, sha256: prepared.sha256 };
    const sealedMeta = await Sealer.sealFileMeta(raw, p.documentId, fileId, meta);
    const envelope = await sealFileStream(await importAead(raw.slice()), ctx.file(fileId), prepared.bytes);
    const kind = prepared.kind === "image" || prepared.kind === "audio" || prepared.kind === "cover" ? prepared.kind : "file";
    const target = (await d.inner.mutation(e2eeFiles.generateUploadUrl, { documentId: p.documentId, kind, declaredSize: envelope.length })) as { uploadUrl: string; intentId: string };
    const res = await (d.fetch ?? fetch)(target.uploadUrl, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: envelope as Uint8Array<ArrayBuffer> });
    if (!res.ok) throw new Error(`upload failed (${res.status})`);
    const { storageId } = (await res.json()) as { storageId: string };
    const committed = (await d.inner.action(e2eeFiles.commit, {
      intentId: target.intentId,
      documentId: p.documentId,
      fileId,
      storageId,
      sealed: { key: wrapped, meta: sealedMeta, k, plainSize: prepared.bytes.length },
      size: envelope.length,
      sha256: hex(sha256(envelope)),
    })) as { fileId?: string } | null;
    return { fileId: committed?.fileId ?? fileId, mimeType: prepared.mimeType };
  } finally {
    raw.fill(0);
  }
}

/** §12 WP7: uploads one queued attachment of a sealed note through the active router. */
export async function uploadSealed(p: PendingUpload): Promise<{ fileId: string; mimeType: string }> {
  const r = requireActiveRouter();
  return await uploadSealedWith({ inner: r.env.inner, sealer: r.env.sealer }, p);
}

/** §12 WP7: a sealed file as a `blob:` URL (files.urls signs the ciphertext's address; the cache opens it). */
export async function decryptedFileUrl(fileId: string, documentId: string): Promise<string> {
  const r = requireActiveRouter();
  const urls = (await r.env.inner.query(api.files.urls, { fileIds: [fileId], now: Date.now() })) as Record<string, { url: string; sealed?: SealedFileFields } | undefined>;
  const entry = urls[fileId];
  if (!entry) throw new Error("File not found.");
  if (!entry.sealed) return entry.url;
  const opened = await r.env.files.open(fileId, documentId, entry.url, entry.sealed);
  if ("tooLarge" in opened) throw new Error("This file is too large to open here. Download it instead.");
  return opened.url;
}
