"use client";

import { localApiOf, type FoleviClient } from "@/lib/convex/client";
import { ulid, type WireScope } from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";
import { localDb, type PendingUpload } from "./db";
import type { SyncEngine } from "./engine";

export async function sha256Hex(blob: Blob): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Uploads one file right away (online only) and returns its file id, for imports where the file must
 * exist before the document that references it is created, and for files attached to an AI chat. With a `documentId` the page's scope decides
 * where it's stored; without one it goes to `scope`. Errors carry the server's message.
 */
export async function uploadFileNow(
  client: FoleviClient,
  input: { scope?: WireScope; blob: Blob; filename: string; mimeType: string; kind: "image" | "file" | "cover" | "attachment"; documentId?: string },
): Promise<string> {
  // Local mode: the bytes go straight into the library (no upload address, no server).
  const local = localApiOf(client);
  if (local) return (await local.putFile(input.blob, { name: input.filename, mimeType: input.mimeType, kind: input.kind, documentId: input.documentId ?? null })).fileId;
  const { uploadUrl, intentId } = await client.mutation(api.files.generateUploadUrl, {
    scope: input.scope,
    documentId: input.documentId,
    filename: input.filename,
    size: input.blob.size,
    mimeType: input.mimeType,
    kind: input.kind,
  });
  const res = await fetch(uploadUrl, { method: "POST", headers: { "Content-Type": input.mimeType }, body: input.blob });
  if (!res.ok) throw new Error(`The upload failed (${res.status}).`);
  const { storageId } = (await res.json()) as { storageId: string };
  const result = await client.action(api.files.finalize, { intentId, storageId: storageId as never, sha256: await sha256Hex(input.blob) });
  return result.fileId;
}

/** A note's file that just finished uploading from this device, with its bytes (lib/fileText reads PDFs and images from them). */
export interface UploadedFile {
  documentId: string;
  blockId: string;
  fileId: string;
  kind: "image" | "file" | "audio";
  mimeType: string;
  blob: Blob;
}
const uploadedListeners = new Set<(file: UploadedFile) => void>();

/** Hears every note file this device finishes uploading; returns the function that stops listening. */
export function onFileUploaded(listener: (file: UploadedFile) => void): () => void {
  uploadedListeners.add(listener);
  return () => {
    uploadedListeners.delete(listener);
  };
}

const objectUrls = new Map<string, string>();

/** A local preview URL for an upload that hasn't reached the server yet. */
export async function localPreviewUrl(accountKey: string, uploadId: string): Promise<string | null> {
  const hit = objectUrls.get(uploadId);
  if (hit) return hit;
  const db = await localDb(accountKey);
  const rec = await db.get("uploads", uploadId);
  if (!rec) return null;
  const url = URL.createObjectURL(rec.blob);
  objectUrls.set(uploadId, url);
  return url;
}

/**
 * Lets go of an upload's preview URL (and the file it keeps in memory). Called by a view once the server's
 * address has replaced it on screen.
 */
export function releaseLocalPreview(uploadId: string): void {
  const url = objectUrls.get(uploadId);
  if (!url) return;
  objectUrls.delete(uploadId);
  URL.revokeObjectURL(url);
}

/** Stores the file durably, registers the upload with the sync engine and returns its id. */
export async function enqueueUpload(
  accountKey: string,
  engine: SyncEngine,
  input: { documentId: string; blockId: string; file: File; kind: "image" | "file" | "audio" },
): Promise<string> {
  const uploadId = ulid();
  const record: PendingUpload = {
    uploadId,
    documentId: input.documentId,
    blockId: input.blockId,
    kind: input.kind,
    filename: input.file.name || (input.kind === "image" ? "image" : input.kind === "audio" ? "recording" : "file"),
    mimeType: input.file.type || "application/octet-stream",
    size: input.file.size,
    blob: input.file,
    attempts: 0,
    nextAttemptAt: 0,
  };
  const db = await localDb(accountKey);
  await db.put("uploads", record);
  engine.queueUpload(input.documentId, input.blockId, uploadId);
  return uploadId;
}

/**
 * Background uploader: two-phase upload (authorized short-lived URL → direct upload → server-side
 * verification). Interrupted uploads stay queued with exponential backoff and never block other edits.
 * A file for a page made on this device waits until the page's create reached the server (the server
 * can't hand out an upload address for a page it doesn't have yet), and that wait isn't a failed try.
 * Only a refusal that can't change (the file type, the size, the storage quota) or a page that's gone
 * lets a file go; anything else is tried again, however long it takes.
 */
/** How often an upload for a page still on its way looks again (a local check, nothing sent). */
const PAGE_WAIT_MS = 1000;

export class Uploader {
  private running = false;
  /** A kick that arrived while a pass was running: run again right after it (new uploads aren't missed). */
  private rerun = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  constructor(
    private client: FoleviClient,
    private accountKey: string,
    private engine: SyncEngine,
    private onError: (message: string) => void,
  ) {}

  /** Set once the account's engine is torn down: a pass still running then must not schedule another. */
  private stopped = false;

  kick(delay = 0) {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.run(), delay);
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Two-phase upload: an authorized short-lived address, the bytes, then the server's check of them. */
  private async uploadToServer(u: PendingUpload): Promise<{ fileId: string; mimeType: string }> {
    // The page's scope decides where the file is stored (the server checks access to the page).
    const { uploadUrl, intentId } = await this.client.mutation(api.files.generateUploadUrl, {
      documentId: u.documentId,
      filename: u.filename,
      size: u.size,
      mimeType: u.mimeType,
      kind: u.kind,
    });
    const res = await fetch(uploadUrl, { method: "POST", headers: { "Content-Type": u.mimeType }, body: u.blob });
    if (!res.ok) throw new Error(`upload failed (${res.status})`);
    const { storageId } = (await res.json()) as { storageId: string };
    return await this.client.action(api.files.finalize, { intentId, storageId: storageId as never, sha256: await sha256Hex(u.blob) });
  }

  private async run() {
    const local = localApiOf(this.client);
    // A local library needs no network: its files are stored on this device.
    if (!local && !navigator.onLine) return;
    if (this.running) {
      this.rerun = true;
      return;
    }
    this.running = true;
    this.rerun = false;
    try {
      const db = await localDb(this.accountKey);
      // The engine (and its upload records) is account-wide: process every queued upload, whatever workspace is selected.
      const all = await db.getAll("uploads");
      let soonest = Infinity;
      for (const u of all) {
        if (!this.engine.state.uploads.some((x) => x.uploadId === u.uploadId)) {
          await db.delete("uploads", u.uploadId);
          continue;
        }
        if (u.nextAttemptAt > Date.now()) {
          soonest = Math.min(soonest, u.nextAttemptAt);
          continue;
        }
        // The page is new and still on its way (made offline, or a moment ago): looked at again shortly.
        if (this.engine.waitsToSync(u.documentId, null)) {
          soonest = Math.min(soonest, Date.now() + PAGE_WAIT_MS);
          continue;
        }
        try {
          const result = local
            ? await local.putFile(u.blob, { name: u.filename, mimeType: u.mimeType, kind: u.kind, documentId: u.documentId })
            : await this.uploadToServer(u);
          this.engine.uploadCompleted(u.uploadId, result.fileId);
          for (const listener of uploadedListeners) listener({ documentId: u.documentId, blockId: u.blockId, fileId: result.fileId, kind: u.kind, mimeType: result.mimeType, blob: u.blob });
          await db.delete("uploads", u.uploadId);
        } catch (e) {
          const code = (e as { data?: { code?: string; message?: string } }).data;
          const attempts = u.attempts + 1;
          this.engine.uploadFailed(u.uploadId);
          const permanent = code?.code === "unsupported_file" || code?.code === "invalid_argument" || code?.code === "quota_exceeded";
          // Not found or not allowed again and again, with the page on the server as far as this device
          // knows: it was deleted, or access went. A network failure or the server having a moment never counts.
          const gone = (code?.code === "not_found" || code?.code === "forbidden") && attempts >= 8;
          if (permanent || gone) {
            this.onError(code?.message ?? `“${u.filename}” couldn't be uploaded.`);
            this.engine.abandonUpload(u.uploadId);
            await db.delete("uploads", u.uploadId);
          } else {
            const delay = Math.min(60_000 * 10, 2000 * 2 ** attempts);
            await db.put("uploads", { ...u, attempts, nextAttemptAt: Date.now() + delay });
            soonest = Math.min(soonest, Date.now() + delay);
          }
        }
      }
      if (this.rerun) this.kick(0);
      else if (soonest !== Infinity) this.kick(Math.max(1000, soonest - Date.now()));
    } finally {
      this.running = false;
    }
  }
}
