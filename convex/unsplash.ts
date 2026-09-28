// Image from Unsplash (Insert panel). Searches run on the server with the deployment's own access key
// (UNSPLASH_ACCESS_KEY, never exposed to browsers), rate-limited per profile. Chosen photos are hotlinked
// from images.unsplash.com and credited, and their download is reported to Unsplash — both required by
// the Unsplash API guidelines (https://help.unsplash.com/en/articles/2511245-unsplash-api-guidelines).
import { v } from "convex/values";
import { action, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { assertWritable, requireIdentity, requireProfile } from "./lib/auth";
import { fail } from "./lib/errors";
import { consume } from "./lib/rateLimit";

const API = "https://api.unsplash.com";
const UTM = "utm_source=folevi&utm_medium=referral";
const PHOTO_ID = /^[A-Za-z0-9_-]{1,64}$/;

export interface UnsplashPhoto {
  id: string;
  alt: string;
  width: number;
  height: number;
  color: string | null;
  /** Small image for the picker grid. */
  thumbUrl: string;
  /** The image to hotlink in the document. */
  url: string;
  photographer: string;
  photographerUrl: string;
  photoUrl: string;
}

export type UnsplashSearchResult = { configured: false } | { configured: true; photos: UnsplashPhoto[]; totalPages: number };

/** Counts one Unsplash request against the caller's hourly allowance. */
export const consumeQuota = internalMutation({
  args: {},
  handler: async (ctx) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    await consume(ctx, "unsplash", profile._id);
    return null;
  },
});

function withUtm(url: unknown): string {
  const s = typeof url === "string" && /^https:\/\/([a-z0-9-]+\.)*unsplash\.com\//i.test(url) ? url : "https://unsplash.com/";
  return `${s}${s.includes("?") ? "&" : "?"}${UTM}`;
}

function imageUrl(url: unknown): string | null {
  return typeof url === "string" && /^https:\/\/images\.unsplash\.com\//i.test(url) ? url : null;
}

interface RawPhoto {
  id?: unknown;
  width?: unknown;
  height?: unknown;
  color?: unknown;
  alt_description?: unknown;
  description?: unknown;
  urls?: { regular?: unknown; small?: unknown; thumb?: unknown };
  links?: { html?: unknown };
  user?: { name?: unknown; links?: { html?: unknown } };
}

const str = (x: unknown): string | null => (typeof x === "string" ? x : null);

/** Keeps only what the picker needs, from trusted Unsplash hosts. */
function toPhoto(raw: unknown): UnsplashPhoto | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as RawPhoto;
  const rawId = str(r.id);
  const id = rawId && PHOTO_ID.test(rawId) ? rawId : null;
  const regular = imageUrl(r.urls?.regular);
  const thumb = imageUrl(r.urls?.small) ?? imageUrl(r.urls?.thumb) ?? regular;
  if (!id || !regular || !thumb) return null;
  const name = str(r.user?.name)?.trim().slice(0, 120) || "Unknown photographer";
  const alt = str(r.alt_description) ?? str(r.description) ?? "";
  const color = str(r.color);
  return {
    id,
    alt: alt.slice(0, 300),
    width: Number(r.width) || 0,
    height: Number(r.height) || 0,
    color: color && /^#[0-9a-f]{6}$/i.test(color) ? color : null,
    thumbUrl: thumb,
    url: regular,
    photographer: name,
    photographerUrl: withUtm(r.user?.links?.html),
    photoUrl: withUtm(r.links?.html),
  };
}

async function unsplashGet(path: string, key: string): Promise<unknown> {
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Client-ID ${key}`, "Accept-Version": "v1" } });
  if (res.status === 401 || res.status === 403) fail("forbidden", "Unsplash didn't accept this server's access key.");
  if (res.status === 429) fail("rate_limited", "Unsplash is busy right now. Try again in a few minutes.");
  if (!res.ok) fail("invalid_argument", "Unsplash couldn't be reached. Try again.");
  return res.json();
}

/** Searches Unsplash photos (an empty query lists editorial picks). */
export const search = action({
  args: { query: v.string(), page: v.optional(v.number()) },
  handler: async (ctx, args): Promise<UnsplashSearchResult> => {
    await requireIdentity(ctx);
    const key = process.env.UNSPLASH_ACCESS_KEY;
    if (!key) return { configured: false };
    await ctx.runMutation(internal.unsplash.consumeQuota, {});
    const query = args.query.trim().slice(0, 100);
    const page = Math.max(1, Math.min(50, Math.floor(args.page ?? 1)));
    if (!query) {
      const list = await unsplashGet(`/photos?per_page=24&page=${page}&order_by=popular`, key);
      const photos = (Array.isArray(list) ? list : []).map(toPhoto).filter((p): p is UnsplashPhoto => p !== null);
      return { configured: true, photos, totalPages: 50 };
    }
    const data = (await unsplashGet(`/search/photos?per_page=24&page=${page}&content_filter=high&query=${encodeURIComponent(query)}`, key)) as {
      results?: unknown[];
      total_pages?: number;
    };
    const photos = (data.results ?? []).map(toPhoto).filter((p): p is UnsplashPhoto => p !== null);
    return { configured: true, photos, totalPages: Math.min(50, Number(data.total_pages) || 1) };
  },
});

/** Reports that a photo was used (Unsplash's required download tracking). */
export const trackDownload = action({
  args: { photoId: v.string() },
  handler: async (ctx, args) => {
    await requireIdentity(ctx);
    const key = process.env.UNSPLASH_ACCESS_KEY;
    if (!key || !PHOTO_ID.test(args.photoId)) return null;
    await ctx.runMutation(internal.unsplash.consumeQuota, {});
    await unsplashGet(`/photos/${encodeURIComponent(args.photoId)}/download`, key);
    return null;
  },
});
