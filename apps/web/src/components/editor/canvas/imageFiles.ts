"use client";

// The images a block's picture shows (a flowchart's shapes), fetched and turned into data URLs so the
// exported SVG, PNG, PDF or copied image stands alone: an SVG drawn as an image can't load anything, and a
// saved file shouldn't depend on a signed address that expires. Addresses come from files.urls, which
// answers in the account and in local mode (the library's own addresses). Very large photos are drawn
// smaller first. A file that can't be fetched keeps its placeholder.
import { useEffect } from "react";
import { useConvex, type ConvexReactClient } from "convex/react";
import { setClipboardFiles } from "../blockClipboard";
import { api } from "@/lib/convex/api";

/** Longest side of an image inside an exported picture. */
const MAX_SIDE = 1600;
/** Images larger than this are drawn smaller (as JPEG, or PNG when they may be transparent). */
const SHRINK_OVER = 1_500_000;

const readDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error("Couldn't read the image."));
    r.readAsDataURL(blob);
  });

async function smaller(blob: Blob): Promise<Blob> {
  if (blob.size <= SHRINK_OVER || blob.type === "image/svg+xml" || typeof createImageBitmap !== "function") return blob;
  try {
    const bmp = await createImageBitmap(blob);
    const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bmp.width * scale));
    canvas.height = Math.max(1, Math.round(bmp.height * scale));
    canvas.getContext("2d")?.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    const type = blob.type === "image/png" || blob.type === "image/webp" || blob.type === "image/gif" ? "image/png" : "image/jpeg";
    return await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b ?? blob), type, 0.88));
  } catch {
    return blob;
  }
}

/** Data URLs for the files (images only), by file id; files that can't be fetched are left out. */
export async function fileDataUrls(client: ConvexReactClient, fileIds: readonly string[]): Promise<Record<string, string>> {
  const ids = [...new Set(fileIds)].slice(0, 200);
  if (!ids.length) return {};
  const now = Math.floor(Date.now() / 3_600_000) * 3_600_000;
  const urls = await client.query(api.files.urls, { fileIds: ids, now });
  const out: Record<string, string> = {};
  await Promise.all(
    Object.entries(urls).map(async ([id, f]) => {
      try {
        // Not from the HTTP cache: the page's own <img> may have cached the file without its CORS headers.
        const res = await fetch(f.url, { cache: "no-store" });
        if (!res.ok) return;
        let blob = await res.blob();
        const type = blob.type || f.mimeType;
        if (!type.startsWith("image/")) return;
        if (blob.type !== type) blob = new Blob([blob], { type });
        out[id] = await readDataUrl(await smaller(blob));
      } catch {
        // Left as a placeholder.
      }
    }),
  );
  return out;
}

/**
 * While an editor is open, pictures copied from it (⌘C on a flowchart block) embed the images they show, as
 * Copy as image does (blockClipboard.ts).
 */
export function useClipboardImageFiles(): void {
  const client = useConvex();
  useEffect(() => {
    // Every open editor (a note's, each synced block's) talks to the same backend: the last one set stays.
    setClipboardFiles((ids) => fileDataUrls(client, ids));
  }, [client]);
}
