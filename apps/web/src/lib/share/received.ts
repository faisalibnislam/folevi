"use client";
// A share kept by the service worker (public/sw.js, receiveShare): another app's share sheet posted it to
// /share-target, and the app was opened at /share?received=<id>. It lives in the device's Cache Storage
// until the share page saves it or puts it away.

const SHARE_CACHE = "folevi-share-v1";
const ID = /^[0-9a-z]{1,12}-[0-9a-z]{1,12}$/;

export interface ReceivedShare {
  title: string;
  text: string;
  url: string;
  files: File[];
  /** Files left out (too many, too large or empty), by name. */
  skipped: string[];
}

export async function readReceivedShare(id: string): Promise<ReceivedShare | null> {
  if (!ID.test(id) || typeof caches === "undefined") return null;
  try {
    const cache = await caches.open(SHARE_CACHE);
    const metaRes = await cache.match(`/__share/${id}/meta`);
    if (!metaRes) return null;
    const meta = (await metaRes.json()) as { title?: unknown; text?: unknown; url?: unknown; files?: { name?: unknown; type?: unknown }[]; skipped?: unknown[] };
    const files: File[] = [];
    for (const [i, f] of (Array.isArray(meta.files) ? meta.files : []).slice(0, 10).entries()) {
      const res = await cache.match(`/__share/${id}/file/${i}`);
      if (!res) continue;
      const type = typeof f.type === "string" ? f.type : "application/octet-stream";
      files.push(new File([await res.blob()], typeof f.name === "string" ? f.name : "file", { type }));
    }
    const str = (v: unknown) => (typeof v === "string" ? v : "");
    return { title: str(meta.title), text: str(meta.text), url: str(meta.url), files, skipped: (Array.isArray(meta.skipped) ? meta.skipped : []).map(String).slice(0, 20) };
  } catch {
    return null;
  }
}

/** Deletes a kept share (after it was saved or put away). */
export async function forgetReceivedShare(id: string): Promise<void> {
  if (!ID.test(id) || typeof caches === "undefined") return;
  try {
    const cache = await caches.open(SHARE_CACHE);
    for (const key of await cache.keys()) if (new URL(key.url).pathname.startsWith(`/__share/${id}/`)) await cache.delete(key);
  } catch {
    // Dropped after a day by the service worker anyway.
  }
}
