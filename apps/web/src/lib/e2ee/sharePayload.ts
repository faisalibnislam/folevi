// An encrypted link's payload (sharing.openPublicLink's `e2ee`, docs/E2EE_DESIGN.md §9.1) with its bytes as
// base64url text, so the share page (a server component) can hand it to EncryptedShare. Nothing in it is
// readable: it is the note's ciphertext and the note key wrapped by the link's key. Kept apart from links.ts
// so the server page doesn't load the opening code. WP8.
import { toBase64Url } from "@folevi/local-store/e2ee";

/** The payload EncryptedShare opens (lib/e2ee/links.ts openShare). */
export interface SharePayload {
  documentId: string;
  linkId: string;
  scopeId?: string | null;
  noteKey: { version: number; wrapped: string };
  title: { c: string; k: number; mac?: string } | null;
  appearance: { c: string; k: number } | null;
  meta: { c: string; k: number } | null;
  blocks: { id: string; parentId: string | null; rank: string; sealed: { c: string; mac: string; k: number; collapsed?: true; syncedSource?: string } }[];
  files: { id: string; url: string; size: number; sealed: { key: string; meta: string; k: number; plainSize: number } }[];
  records: { kind: string; recordId: string; keyVersion: number; sealed: string }[];
}

const text = (v: unknown): string => {
  if (v instanceof ArrayBuffer) return toBase64Url(new Uint8Array(v));
  if (ArrayBuffer.isView(v)) return toBase64Url(new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
  if (Object.prototype.toString.call(v) === "[object ArrayBuffer]") return toBase64Url(new Uint8Array(v as ArrayBuffer));
  return "";
};

function field<T extends { k: number }>(f: unknown): (T & { c: string }) | null {
  if (!f || typeof f !== "object" || !("c" in f)) return null;
  return { ...(f as unknown as T), c: text((f as { c: unknown }).c) };
}

export function sharePayload(raw: unknown): SharePayload {
  const e = raw as {
    documentId: string;
    linkId: string;
    scopeId?: string | null;
    noteKey: { version: number; wrapped: unknown };
    title: unknown;
    appearance: unknown;
    meta: unknown;
    blocks: { id: string; parentId: string | null; rank: string; sealed: { c: unknown; mac: string; k: number; collapsed?: true; syncedSource?: string } }[];
    files: { id: string; url: string; size: number; sealed: { key: unknown; meta: unknown; k: number; plainSize: number } }[];
    records: { kind: string; recordId: string; keyVersion: number; sealed: unknown }[];
  };
  return {
    documentId: e.documentId,
    linkId: e.linkId,
    scopeId: e.scopeId ?? null,
    noteKey: { version: e.noteKey.version, wrapped: text(e.noteKey.wrapped) },
    title: field<{ k: number; mac?: string }>(e.title),
    appearance: field<{ k: number }>(e.appearance),
    meta: field<{ k: number }>(e.meta),
    blocks: e.blocks.map((x) => ({ id: x.id, parentId: x.parentId, rank: x.rank, sealed: { ...x.sealed, c: text(x.sealed.c) } })),
    files: e.files.map((f) => ({ id: f.id, url: f.url, size: f.size, sealed: { key: text(f.sealed.key), meta: text(f.sealed.meta), k: f.sealed.k, plainSize: f.sealed.plainSize } })),
    records: e.records.map((r) => ({ kind: r.kind, recordId: r.recordId, keyVersion: r.keyVersion, sealed: text(r.sealed) })),
  };
}
