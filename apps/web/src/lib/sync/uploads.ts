"use client";

import type { ConvexReactClient } from "convex/react";
import { ulid } from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";
import { localDb, type PendingUpload } from "./db";
import type { SyncEngine } from "./engine";

async function sha256Hex(blob: Blob): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
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

/** Stores the file durably, registers the upload with the sync engine and returns its id. */
export async function enqueueUpload(
  accountKey: string,
  engine: SyncEngine,
  input: { documentId: string; blockId: string; file: File; kind: "image" | "file" },
): Promise<string> {
  const uploadId = ulid();
  const record: PendingUpload = {
    uploadId,
    workspaceId: engine.workspaceId,
    documentId: input.documentId,
    blockId: input.blockId,
    kind: input.kind,
    filename: input.file.name || (input.kind === "image" ? "image" : "file"),
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
 */
export class Uploader {
  private running = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  constructor(
    private client: ConvexReactClient,
    private accountKey: string,
    private engine: SyncEngine,
    private onError: (message: string) => void,
  ) {}

  kick(delay = 0) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.run(), delay);
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
  }

  private async run() {
    if (this.running || !navigator.onLine) return;
    this.running = true;
    try {
      const db = await localDb(this.accountKey);
      const all = (await db.getAll("uploads")).filter((u) => u.workspaceId === this.engine.workspaceId);
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
        try {
          const { uploadUrl, intentId } = await this.client.mutation(api.files.generateUploadUrl, {
            workspaceId: u.workspaceId,
            documentId: u.documentId,
            filename: u.filename,
            size: u.size,
            mimeType: u.mimeType,
            kind: u.kind,
          });
          const res = await fetch(uploadUrl, { method: "POST", headers: { "Content-Type": u.mimeType }, body: u.blob });
          if (!res.ok) throw new Error(`upload failed (${res.status})`);
          const { storageId } = (await res.json()) as { storageId: string };
          const result = await this.client.action(api.files.finalize, { intentId, storageId: storageId as never, sha256: await sha256Hex(u.blob) });
          this.engine.uploadCompleted(u.uploadId, result.fileId);
          await db.delete("uploads", u.uploadId);
        } catch (e) {
          const code = (e as { data?: { code?: string; message?: string } }).data;
          const attempts = u.attempts + 1;
          this.engine.uploadFailed(u.uploadId);
          if (code?.code === "unsupported_file" || code?.code === "invalid_argument" || code?.code === "quota_exceeded" || attempts >= 8) {
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
      if (soonest !== Infinity) this.kick(Math.max(1000, soonest - Date.now()));
    } finally {
      this.running = false;
    }
  }
}
