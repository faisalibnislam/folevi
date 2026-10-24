"use client";

// Attachments kept on this device for the device copy (docs/NATIVE_APP_PLAN.md §11.5): the website and today's
// apps keep them in Cache Storage (`folevi-files-<account>`), indexed in the account's IndexedDB
// (`copyFile:<file id>`, db.ts). What comes:
//   always            files up to 1 MB (most images, small documents)
//   on Wi-Fi only     larger images (up to 10 MB, with a 640 px thumbnail made on the device) and files (up to
//                     25 MB), within the storage budget: 2 GB or 10% of the free space, whichever is smaller
//   when opened       everything else (as today)
// Large files go least recently used first when the budget is reached; small files and thumbnails stay. Sealed
// (end-to-end encrypted) files never come here. Downloads use the files' own signed links, not Convex bandwidth.
import { api } from "@/lib/convex/api";
import type { WireBlock } from "@folevi/editor-schema";
import { COPY_FILE_PREFIX, copyFileKeys, localDb } from "./db";
import type { CopyClient } from "./deviceCopy";

export const SMALL_FILE = 1024 * 1024;
export const LARGE_IMAGE_MAX = 10 * 1024 * 1024;
export const LARGE_FILE_MAX = 25 * 1024 * 1024;
export const BUDGET_MAX = 2 * 1024 * 1024 * 1024;
const THUMB_PX = 640;
const BATCH = 25;

export interface KeptFile {
  fileId: string;
  size: number;
  mimeType: string;
  filename: string;
  width: number | null;
  height: number | null;
  /** "small": always kept; "large": on Wi-Fi, evictable; "thumb": only a thumbnail is kept (the large file went). */
  kind: "small" | "large" | "thumb";
  thumb: boolean;
  usedAt: number;
  documentId: string;
}

type UrlInfo = { url: string; mimeType: string; filename: string; size: number; width: number | null; height: number | null; sealed?: unknown };

export const filesCacheName = (accountKey: string) => `folevi-files-${accountKey}`;
const fullKey = (fileId: string) => `https://folevi.files/${encodeURIComponent(fileId)}`;
const thumbKey = (fileId: string) => `https://folevi.files/${encodeURIComponent(fileId)}?thumb`;

/** The attachments a note's blocks name (images, files, audio, video: any block with a `fileId`). */
export function fileIdsOf(blocks: readonly WireBlock[]): string[] {
  const out = new Set<string>();
  for (const b of blocks) {
    const id = (b.props as { fileId?: unknown } | undefined)?.fileId;
    if (typeof id === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(id)) out.add(id);
  }
  return [...out];
}

export type DownloadPlan = "small" | "large" | "skip";

/**
 * What to do with an attachment: keep small ones always, large ones only when large downloads are allowed now
 * (Wi-Fi or a wired connection, not Data Saver) and they fit the limits; never a sealed one.
 */
export function planDownload(info: Pick<UrlInfo, "size" | "mimeType" | "sealed">, largeAllowed: boolean): DownloadPlan {
  if (info.sealed) return "skip";
  if (info.size <= SMALL_FILE) return "small";
  if (!largeAllowed) return "skip";
  const max = info.mimeType.startsWith("image/") ? LARGE_IMAGE_MAX : LARGE_FILE_MAX;
  return info.size <= max ? "large" : "skip";
}

/** The large files to remove, least recently used first, to bring their total within `budget`. */
export function evictionOrder(files: readonly Pick<KeptFile, "fileId" | "size" | "kind" | "usedAt">[], budget: number): string[] {
  const large = files.filter((f) => f.kind === "large").sort((a, b) => a.usedAt - b.usedAt);
  let total = large.reduce((s, f) => s + f.size, 0);
  const out: string[] = [];
  for (const f of large) {
    if (total <= budget) break;
    out.push(f.fileId);
    total -= f.size;
  }
  return out;
}

type Connection = { type?: string; saveData?: boolean };

/**
 * Whether large attachments may download now. The web sees the connection type only on some browsers
 * (Chrome on Android): Wi-Fi, Ethernet or an unknown type on a desktop browser count; cellular, Data Saver, or
 * an unknown type on a phone or in the iPhone and iPad app (whose bridge doesn't tell the page yet: R2) don't.
 */
export function largeDownloadsAllowed(nav: { connection?: Connection; userAgent?: string; maxTouchPoints?: number } = typeof navigator !== "undefined" ? (navigator as never) : {}): boolean {
  const c = nav.connection;
  if (c?.saveData) return false;
  if (c?.type) return c.type === "wifi" || c.type === "ethernet";
  const ua = nav.userAgent ?? "";
  const phoneOrTablet = /iPhone|iPad|Android|Mobile|FoleviiOS/.test(ua) || ((nav.maxTouchPoints ?? 0) > 1 && /Macintosh/.test(ua) && /Safari/.test(ua) && !/Chrome/.test(ua));
  return !phoneOrTablet;
}

/** The storage budget for large attachments: 2 GB or 10% of the free space, whichever is smaller. */
export async function storageBudget(): Promise<number> {
  try {
    const est = await navigator.storage?.estimate?.();
    if (est?.quota) return Math.min(BUDGET_MAX, Math.max(0, (est.quota - (est.usage ?? 0)) * 0.1));
  } catch {
    /* unknown */
  }
  return 256 * 1024 * 1024;
}

async function thumbnail(blob: Blob): Promise<Blob | null> {
  try {
    if (typeof createImageBitmap === "undefined" || typeof OffscreenCanvas === "undefined") return null;
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, THUMB_PX / Math.max(bitmap.width, bitmap.height));
    const canvas = new OffscreenCanvas(Math.max(1, Math.round(bitmap.width * scale)), Math.max(1, Math.round(bitmap.height * scale)));
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return await canvas.convertToBlob({ type: "image/webp", quality: 0.8 });
  } catch {
    return null;
  }
}

export interface DeviceFilesDeps {
  client: CopyClient;
  accountKey: string;
  largeAllowed?: () => boolean;
  budget?: () => Promise<number>;
  fetchFile?: (url: string) => Promise<Blob>;
  now?: () => number;
}

/** One account's attachment downloads. `queue` the notes the copy filled; it works through them one batch at a time. */
export class DeviceFiles {
  private pending = new Map<string, string>();
  private stopped = false;
  private readonly now: () => number;

  constructor(private readonly deps: DeviceFilesDeps) {
    this.now = deps.now ?? Date.now;
  }

  stop() {
    this.stopped = true;
  }

  /** The attachments of these notes join the queue (read from the notes' kept content). */
  async queue(documentIds: readonly string[]): Promise<void> {
    if (typeof caches === "undefined") return;
    const db = await localDb(this.deps.accountKey);
    for (const id of documentIds) {
      const entry = await db.get("blocks", id);
      if (!entry) continue;
      for (const f of fileIdsOf(entry.blocks)) if (!this.pending.has(f)) this.pending.set(f, id);
    }
    void this.run();
  }

  private current: Promise<void> | null = null;

  /** Works through the queue (tests; the copy calls it after each filled batch). Resolves when it's empty. */
  run(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    this.current ??= (async () => {
      try {
        while (this.pending.size && !this.stopped) await this.batch();
      } catch {
        // The network went: what's left is tried with the next batch the copy fills.
      } finally {
        this.current = null;
      }
    })();
    return this.current;
  }

  private async batch() {
    const db = await localDb(this.deps.accountKey);
    const ids: [string, string][] = [];
    for (const [fileId, doc] of this.pending) {
      this.pending.delete(fileId);
      const known = (await db.get("meta", `${COPY_FILE_PREFIX}${fileId}`)) as KeptFile | undefined;
      if (known && known.kind !== "thumb") continue;
      if (known?.kind === "thumb" && !(this.deps.largeAllowed ?? largeDownloadsAllowed)()) continue;
      ids.push([fileId, doc]);
      if (ids.length >= BATCH) break;
    }
    if (!ids.length) return;
    const urls = (await this.deps.client.query(api.files.urls, { fileIds: ids.map(([f]) => f), now: Math.floor(this.now() / 3_600_000) * 3_600_000 })) as Record<string, UrlInfo>;
    const cache = await caches.open(filesCacheName(this.deps.accountKey));
    const large = (this.deps.largeAllowed ?? largeDownloadsAllowed)();
    for (const [fileId, documentId] of ids) {
      const info = urls[fileId];
      if (!info) continue;
      const plan = planDownload(info, large);
      if (plan === "skip") continue;
      const blob = await (this.deps.fetchFile ?? ((u) => fetch(u, { credentials: "omit" }).then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))))(info.url);
      await cache.put(fullKey(fileId), new Response(blob, { headers: { "content-type": info.mimeType || "application/octet-stream" } }));
      let thumb = false;
      if (plan === "large" && info.mimeType.startsWith("image/")) {
        const t = await thumbnail(blob);
        if (t) {
          await cache.put(thumbKey(fileId), new Response(t, { headers: { "content-type": "image/webp" } }));
          thumb = true;
        }
      }
      const kept: KeptFile = { fileId, size: info.size, mimeType: info.mimeType, filename: info.filename, width: info.width, height: info.height, kind: plan, thumb, usedAt: this.now(), documentId };
      await db.put("meta", kept, `${COPY_FILE_PREFIX}${fileId}`);
    }
    await this.evict();
  }

  /** Brings the large files within the budget, least recently opened first (their thumbnails stay). */
  async evict(): Promise<void> {
    const db = await localDb(this.deps.accountKey);
    const all = (await db.getAll("meta", copyFileKeys())) as KeptFile[];
    const drop = evictionOrder(all, await (this.deps.budget ?? storageBudget)());
    if (!drop.length) return;
    const cache = await caches.open(filesCacheName(this.deps.accountKey));
    for (const fileId of drop) {
      await cache.delete(fullKey(fileId));
      const f = all.find((x) => x.fileId === fileId)!;
      if (f.thumb) await db.put("meta", { ...f, kind: "thumb" }, `${COPY_FILE_PREFIX}${fileId}`);
      else await db.delete("meta", `${COPY_FILE_PREFIX}${fileId}`);
    }
  }

  /** Removes every downloaded attachment ("Remove downloaded copy"). */
  async clear(): Promise<void> {
    this.pending.clear();
    if (typeof caches !== "undefined") await caches.delete(filesCacheName(this.deps.accountKey));
    const db = await localDb(this.deps.accountKey);
    const tx = db.transaction("meta", "readwrite");
    let c = await tx.store.openCursor(copyFileKeys());
    while (c) {
      await c.delete();
      c = await c.continue();
    }
    await tx.done;
  }
}

/** How much the downloaded attachments take: count and bytes (thumbnails counted roughly). */
export async function keptFilesUsage(accountKey: string): Promise<{ count: number; bytes: number }> {
  const db = await localDb(accountKey);
  const all = (await db.getAll("meta", copyFileKeys())) as KeptFile[];
  return { count: all.length, bytes: all.reduce((s, f) => s + (f.kind === "thumb" ? 60_000 : f.size), 0) };
}

const urls = new Map<string, string>();
const touched = new Map<string, number>();

/**
 * A kept attachment as the editor shows it when the server's signed link isn't there (offline, or not answered
 * yet): an object URL of the file (or its thumbnail) and its details. null when this device doesn't have it.
 */
export async function keptFileUrl(accountKey: string, fileId: string): Promise<{ url: string; mimeType: string; filename: string; size: number; width: number | null; height: number | null } | null> {
  if (typeof caches === "undefined") return null;
  try {
    const db = await localDb(accountKey);
    const meta = (await db.get("meta", `${COPY_FILE_PREFIX}${fileId}`)) as KeptFile | undefined;
    if (!meta) return null;
    const memo = `${accountKey}|${fileId}`;
    let url = urls.get(memo);
    if (!url) {
      const cache = await caches.open(filesCacheName(accountKey));
      const hit = (meta.kind !== "thumb" ? await cache.match(fullKey(fileId)) : undefined) ?? (meta.thumb ? await cache.match(thumbKey(fileId)) : undefined);
      if (!hit) return null;
      url = URL.createObjectURL(await hit.blob());
      urls.set(memo, url);
    }
    // Opened: it's recently used (written at most once an hour per file).
    const now = Date.now();
    if (now - (touched.get(memo) ?? 0) > 3_600_000) {
      touched.set(memo, now);
      void db.put("meta", { ...meta, usedAt: now }, `${COPY_FILE_PREFIX}${fileId}`).catch(() => undefined);
    }
    return { url, mimeType: meta.kind === "thumb" ? "image/webp" : meta.mimeType, filename: meta.filename, size: meta.size, width: meta.width, height: meta.height };
  } catch {
    return null;
  }
}
