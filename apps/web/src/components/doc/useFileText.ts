"use client";
// Search in files, for an open note (DocumentView): the text in its PDFs, images and whiteboard handwriting
// is found on this device and saved for search (lib/fileText/indexer.ts, convex/fileText.ts). Runs only for
// someone who can edit the note. Files just uploaded here are read from the bytes this device has; files
// already in the note are read the first time an editor opens it. On a device with no recogniser of its own (a
// browser), Foli AI can read the images: only when asked ("Make text in images searchable" in the note's
// menu), or for images added here when the person turned on "Read images with Foli AI" in Settings > AI.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAction, useConvex, useQuery } from "convex/react";
import { parseWhiteboard, textFingerprint, type WireBlock } from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { useDocumentBlocks } from "@/lib/hooks/useEngine";
import type { SyncEngine } from "@/lib/sync/engine";
import { onFileUploaded } from "@/lib/sync/uploads";
import { deviceRecognizer } from "@/lib/fileText/recognizer";
import { fileBytes, fileTextQueue, jobKey } from "@/lib/fileText/indexer";
import { useToast, errorMessage } from "@/components/ui/Toast";

/** A drawing is read once it's been left alone this long (not on every stroke). */
const DRAWING_SETTLE_MS = 4000;
const FILE_ID = /^[0-9A-Za-z]{10,40}$/;

const fileIdOf = (b: WireBlock): string | null => {
  const id = (b.props as { fileId?: unknown }).fileId;
  return typeof id === "string" && FILE_ID.test(id) ? id : null;
};
const isPdf = (b: WireBlock) => b.type === "file" && String((b.props as { mimeType?: unknown }).mimeType ?? "") === "application/pdf";

interface Prefs {
  deviceText: boolean;
  readImages: boolean;
}

/**
 * Keeps an open note's files and drawings searchable, and returns the note menu's "Make text in images
 * searchable" (Foli AI), or null when there's nothing for it to do here.
 */
export function useFileText({ documentId, engine, canEdit, aiOn }: { documentId: string; engine: SyncEngine | null; canEdit: boolean; aiOn: boolean }): { count: number; run: () => void; busy: boolean } | null {
  const client = useConvex();
  const { profile } = useAppState();
  const toast = useToast();
  const readImage = useAction(api.fileText.readImage);
  const prefs: Prefs = { deviceText: true, readImages: false, ...((profile as { aiPrefs?: Partial<Prefs> }).aiPrefs ?? {}) };
  const blocks = useDocumentBlocks(engine, documentId);
  const known = useQuery(api.fileText.forDocument, canEdit ? { documentId } : "skip");
  // Looked up once: the app's bridges don't come or go while the page is open.
  const [recognizer] = useState(() => deviceRecognizer());
  const onDevice = Boolean(recognizer && prefs.deviceText);

  // Files that finish uploading from this device: read from the bytes it has (no download).
  const live = useRef({ onDevice, prefs, aiOn, canEdit });
  live.current = { onDevice, prefs, aiOn, canEdit };
  useEffect(
    () =>
      onFileUploaded((f) => {
        const now = live.current;
        if (f.mimeType === "application/pdf") fileTextQueue.add(client, { kind: "pdf", documentId: f.documentId, blockId: f.blockId, fileId: f.fileId, bytes: async () => f.blob });
        else if (f.kind === "image" && now.onDevice) fileTextQueue.add(client, { kind: "image", documentId: f.documentId, blockId: f.blockId, fileId: f.fileId, bytes: async () => f.blob });
        else if (f.kind === "image" && !now.onDevice && now.aiOn && now.prefs.readImages && !fileTextQueue.has(`foli:${f.fileId}`)) {
          // Turned on in Settings > AI: an image added here is read by Foli AI (the server checks the setting).
          fileTextQueue.mark(`foli:${f.fileId}`);
          void readImage({ documentId: f.documentId, fileId: f.fileId, blockId: f.blockId, auto: true }).catch(() => undefined);
        }
      }),
    [client, readImage],
  );

  // What the note shows now, and what the server already has.
  const knownFiles = useMemo(() => new Set((known ?? []).map((k) => k.fileId).filter(Boolean) as string[]), [known]);
  const knownDrawings = useMemo(() => new Map((known ?? []).filter((k) => k.source === "handwriting").map((k) => [k.blockId, k.hash])), [known]);

  // Files already in the note, the first time an editor opens it here.
  useEffect(() => {
    if (!canEdit || known === undefined) return;
    for (const b of blocks) {
      const fileId = fileIdOf(b);
      if (!fileId || knownFiles.has(fileId)) continue;
      if (isPdf(b)) fileTextQueue.add(client, { kind: "pdf", documentId, blockId: b.id, fileId, bytes: () => fileBytes(client, fileId) });
      else if (b.type === "image" && onDevice) fileTextQueue.add(client, { kind: "image", documentId, blockId: b.id, fileId, bytes: () => fileBytes(client, fileId) });
    }
  }, [blocks, known, knownFiles, canEdit, onDevice, client, documentId]);

  // Handwriting: a whiteboard once it's been left alone a moment, and again whenever it's drawn on.
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    if (!canEdit || !onDevice || known === undefined) return;
    const pending = timers.current;
    for (const b of blocks) {
      if (b.type !== "whiteboard") continue;
      const p = b.props as { data?: unknown; height?: unknown };
      const data = String(p.data ?? "");
      if (!data || !parseWhiteboard(data).strokes.length) continue;
      if (knownDrawings.get(b.id) === textFingerprint(data)) continue;
      const job = { kind: "handwriting" as const, documentId, blockId: b.id, data, height: Number(p.height) || 0 };
      if (fileTextQueue.has(jobKey(job))) continue;
      const before = pending.get(b.id);
      if (before) clearTimeout(before);
      pending.set(
        b.id,
        setTimeout(() => {
          pending.delete(b.id);
          fileTextQueue.add(client, job);
        }, DRAWING_SETTLE_MS),
      );
    }
  }, [blocks, known, knownDrawings, canEdit, onDevice, client, documentId]);
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const t of pending.values()) clearTimeout(t);
      pending.clear();
    };
  }, []);

  // Foli AI: the note's images with no text found yet (a device with its own recogniser reads them itself).
  const unread = useMemo(() => blocks.filter((b) => b.type === "image" && fileIdOf(b) && !knownFiles.has(fileIdOf(b)!)), [blocks, knownFiles]);
  const [busy, setBusy] = useState(false);
  const run = useCallback(() => {
    if (busy || !unread.length) return;
    setBusy(true);
    const images = unread.slice(0, 20);
    toast.show(images.length === 1 ? "Foli AI is reading the image…" : `Foli AI is reading ${images.length} images…`);
    void (async () => {
      let read = 0;
      let failure: unknown = null;
      for (const b of images) {
        try {
          await readImage({ documentId, fileId: fileIdOf(b)!, blockId: b.id });
          read++;
        } catch (e) {
          failure = e;
          // Out of credits, AI turned off, the hourly limit: the rest would be refused too.
          const code = (e as { data?: { code?: string } }).data?.code;
          if (code !== "unsupported_file") break;
        }
      }
      setBusy(false);
      if (read) toast.show(read === 1 ? "The text in this image is now searchable" : `The text in ${read} images is now searchable`);
      if (failure) toast.show(errorMessage(failure), { tone: "error" });
    })();
  }, [busy, unread, readImage, documentId, toast]);

  if (!canEdit || !aiOn || onDevice || known === undefined || !unread.length) return null;
  return { count: unread.length, run, busy };
}
