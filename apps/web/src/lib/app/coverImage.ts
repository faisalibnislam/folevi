"use client";

import { useMutation, useQuery, type ConvexReactClient } from "convex/react";
import { useEffect, useState } from "react";
import type { DocumentCover } from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";
import { uploadFileNow } from "@/lib/sync/uploads";
import { isImagePalette, paletteFromImage, type StylePalette as ImagePalette } from "@/lib/palette";

/** Image types the server accepts for a note theme image (it re-checks the bytes). */
export const COVER_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export const COVER_IMAGE_ACCEPT = COVER_IMAGE_TYPES.join(",");
/** Same limit as other images (convex/lib/images.ts MAX_IMAGE_BYTES). */
export const MAX_COVER_IMAGE_BYTES = 20 * 1024 * 1024;

/** A friendly reason the file can't be used, checked before uploading (the server enforces the same rules). */
export function coverImageProblem(file: File): string | null {
  if (!(COVER_IMAGE_TYPES as readonly string[]).includes(file.type)) return "Choose a PNG, JPEG, WebP or GIF image.";
  if (file.size > MAX_COVER_IMAGE_BYTES) return "Images can be up to 20 MB.";
  if (file.size === 0) return "That file is empty.";
  return null;
}

/** Colours picked on this device, by file id (so a fresh upload or an older image colours at once). */
const picked = new Map<string, ImagePalette>();
const picking = new Map<string, Promise<ImagePalette | null>>();

/**
 * Uploads a note theme image into the note (so it follows the note's access) and returns its file id. The
 * page and text colours are picked from the local file and saved with it.
 */
export async function uploadCoverImage(client: ConvexReactClient, input: { documentId: string; file: File }): Promise<string> {
  const palette = paletteFromImage(input.file).catch(() => null);
  const fileId = await uploadFileNow(client, {
    documentId: input.documentId,
    blob: input.file,
    filename: input.file.name || "note-style",
    mimeType: input.file.type,
    kind: "cover",
  });
  const colours = await palette;
  if (colours) {
    picked.set(fileId, colours);
    await client.mutation(api.files.setPalette, { fileId, palette: colours }).catch(() => undefined);
  }
  return fileId;
}

function useHour() {
  const bucket = 30 * 60_000;
  const [now, setNow] = useState(() => Math.floor(Date.now() / bucket) * bucket);
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / bucket) * bucket), bucket);
    return () => clearInterval(id);
  }, [bucket]);
  return now;
}

/**
 * A note's own theme image: its signed URL and the colours picked from it (null while loading, or for the
 * built-in themes). An image saved before colours were picked gets them here, once, from its pixels, and
 * they're saved back when this person can edit the note.
 */
export function useCoverImage(cover: DocumentCover | null | undefined): { url: string | null; palette: ImagePalette | null } {
  const fileId = cover?.kind === "image" && cover.value ? cover.value : null;
  const now = useHour();
  const urls = useQuery(api.files.urls, fileId ? { fileIds: [fileId], now } : "skip");
  const savePalette = useMutation(api.files.setPalette);
  const entry = fileId ? urls?.[fileId] : undefined;
  const url = entry?.url ?? null;
  const stored = isImagePalette(entry?.palette) ? entry.palette : null;
  // Colours picked here, tagged with their image so a note that changes image never shows stale ones.
  const [local, setLocal] = useState<{ fileId: string; palette: ImagePalette } | null>(null);
  useEffect(() => {
    if (!fileId || !url || stored) return;
    const cached = picked.get(fileId);
    if (cached) return setLocal({ fileId, palette: cached });
    let live = true;
    let job = picking.get(fileId);
    if (!job) {
      // no-store: the image may already be cached from a plain <img>/CSS load, without CORS headers.
      job = fetch(url, { mode: "cors", credentials: "omit", cache: "no-store" })
        .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
        .then(paletteFromImage)
        .then((p) => {
          picked.set(fileId, p);
          void savePalette({ fileId, palette: p }).catch(() => undefined);
          return p;
        })
        .catch(() => null);
      picking.set(fileId, job);
    }
    void job.then((p) => live && p && setLocal({ fileId, palette: p }));
    return () => {
      live = false;
    };
  }, [fileId, url, stored, savePalette]);
  if (!fileId) return { url: null, palette: null };
  return { url, palette: stored ?? (local?.fileId === fileId ? local.palette : null) ?? picked.get(fileId) ?? null };
}

/** The signed URL of a note's own theme image, or null while loading / for the built-in themes. */
export function useCoverImageUrl(cover: DocumentCover | null | undefined): string | null {
  return useCoverImage(cover).url;
}
