"use client";
// Finding the text in a note's files and drawings on this device, so search finds it (convex/fileText.ts;
// docs/ARCHITECTURE.md, "Search in files"). One job at a time, in the background, never blocking an edit:
//
//   a PDF        its words, with pdf.js (lib/fileText/pdf.ts), on every device
//   an image     the device's own recogniser (lib/fileText/recognizer.ts: the iPhone, iPad and Mac apps)
//   handwriting  a whiteboard drawn to an image and read by the same recogniser
//
// A file is read right after it's uploaded here (from the bytes this device already has), or the first time
// someone who can edit the note opens it (from the file's signed link). What was read is remembered by the
// server (the file's hash, a drawing's fingerprint), so each one is read once.
import type { ConvexReactClient } from "convex/react";
import { textFingerprint, whiteboardToSvg } from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";
import { readPdfText } from "./pdf";
import { deviceRecognizer } from "./recognizer";

export type FileTextJob =
  | { kind: "pdf"; documentId: string; blockId: string; fileId: string; bytes: () => Promise<Blob | null> }
  | { kind: "image"; documentId: string; blockId: string; fileId: string; bytes: () => Promise<Blob | null> }
  | { kind: "handwriting"; documentId: string; blockId: string; data: string; height: number };

/** What identifies a job: one file, or one drawing as drawn now. */
export const jobKey = (job: FileTextJob) => (job.kind === "handwriting" ? `wb:${job.documentId}:${job.blockId}:${textFingerprint(job.data)}` : `file:${job.fileId}`);

/** Images larger than this aren't read on the device (a camera photo is a few MB). */
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

/** A whiteboard as a PNG on white, twice its size (handwriting reads better large). */
export async function drawingImage(data: string, height: number): Promise<Blob | null> {
  const svg = whiteboardToSvg(data, height);
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    const scale = 2;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const g = canvas.getContext("2d");
    if (!g) return null;
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob | null>((done) => canvas.toBlob(done, "image/png"));
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** A file's bytes from its signed link (the note is open, so the person can read it). */
export async function fileBytes(client: ConvexReactClient, fileId: string): Promise<Blob | null> {
  const urls = await client.query(api.files.urls, { fileIds: [fileId], now: Math.floor(Date.now() / 3_600_000) * 3_600_000 });
  const url = urls[fileId]?.url;
  if (!url) return null;
  const res = await fetch(url);
  return res.ok ? await res.blob() : null;
}

class FileTextQueue {
  private jobs: FileTextJob[] = [];
  /** Done, failed or queued in this session: never twice (the server remembers across sessions). */
  private seen = new Set<string>();
  private running = false;
  private client: ConvexReactClient | null = null;

  /** Queues a job unless it's been seen. Returns whether it was queued. */
  add(client: ConvexReactClient, job: FileTextJob): boolean {
    const key = jobKey(job);
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    this.client = client;
    this.jobs.push(job);
    void this.run();
    return true;
  }

  /** Remembers something done outside the queue (an image Foli AI was asked to read), so it isn't done twice. */
  mark(key: string): void {
    this.seen.add(key);
  }

  /** Whether a job for this key was queued or done in this session. */
  has(key: string): boolean {
    return this.seen.has(key);
  }

  private async run() {
    if (this.running) return;
    this.running = true;
    try {
      for (let job = this.jobs.shift(); job; job = this.jobs.shift()) {
        // Out of the way of typing: a moment's pause, and whenever the browser is idle.
        await new Promise((r) => setTimeout(r, 250));
        try {
          await this.one(job);
        } catch {
          // Unreadable here (a damaged PDF, the recogniser gone, offline): it's tried again in another session.
        }
      }
    } finally {
      this.running = false;
    }
  }

  private async one(job: FileTextJob) {
    const client = this.client;
    if (!client) return;
    if (job.kind === "pdf") {
      const blob = await job.bytes();
      if (!blob) return;
      const { text, pageStarts } = await readPdfText(await blob.arrayBuffer());
      await client.mutation(api.fileText.save, { documentId: job.documentId, blockId: job.blockId, fileId: job.fileId, source: "pdf", text, pageStarts });
      return;
    }
    const recognizer = deviceRecognizer();
    if (!recognizer) return;
    if (job.kind === "image") {
      const blob = await job.bytes();
      if (!blob || blob.size > MAX_IMAGE_BYTES) return;
      const text = await recognizer.recognize(blob, "image");
      // Nothing read: not kept, so it's tried again another time (a recogniser can come up empty while it
      // starts, and reading again on the device costs nothing).
      if (!text.trim()) return;
      await client.mutation(api.fileText.save, { documentId: job.documentId, blockId: job.blockId, fileId: job.fileId, source: "image", text });
      return;
    }
    const image = await drawingImage(job.data, job.height);
    if (!image) return;
    const text = await recognizer.recognize(image, "handwriting");
    await client.mutation(api.fileText.save, { documentId: job.documentId, blockId: job.blockId, source: "handwriting", text, hash: textFingerprint(job.data) });
  }
}

/** The one queue for this tab. */
export const fileTextQueue = new FileTextQueue();
