// Bookmark previews: the page's title, description, site name, preview image and icon, read from its HTML
// metadata (Open Graph, Twitter cards, <title>, <link rel=icon>) on the server, since browsers can't read
// other sites' pages. Only public http(s) pages are fetched, with a time and size limit, rate-limited per
// person. Images are returned as addresses (the note shows them from the site).
import { v } from "convex/values";
import { action, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { assertWritable, requireIdentity, requireProfile } from "./lib/auth";
import { consume } from "./lib/rateLimit";

export interface BookmarkPreview {
  title: string | null;
  description: string | null;
  siteName: string | null;
  image: string | null;
  icon: string | null;
}

const EMPTY: BookmarkPreview = { title: null, description: null, siteName: null, image: null, icon: null };
const MAX_BYTES = 600_000;
const TIMEOUT_MS = 7_000;

/** Counts one preview against the caller's hourly allowance. */
export const consumeQuota = internalMutation({
  args: {},
  handler: async (ctx) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    await consume(ctx, "bookmarkPreview", profile._id);
    return null;
  },
});

/** Hosts that are never fetched: this machine, private networks, link-local and metadata addresses. */
export function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || !h.includes(".") && !h.includes(":")) return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    const c = Number(v4[3]);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0 && c === 0) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  // Any address starting "::" (loopback, unspecified, IPv4-mapped or -compatible like "::7f00:1"), unique
  // local, link-local and the NAT64 prefix, which can all reach this side of the network.
  if (h.includes(":")) return h.startsWith("::") || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80") || h.startsWith("64:ff9b:");
  return false;
}

const decode = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/\s+/g, " ")
    .trim();

/** Attributes of one tag (`<meta property="og:title" content="…">`). */
function attrsOf(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([a-zA-Z:_-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) out[m[1]!.toLowerCase()] = m[3] ?? m[4] ?? m[5] ?? "";
  return out;
}

/** Reads the preview from a page's HTML (the <head> is enough). `base` resolves relative addresses. */
export function previewFromHtml(html: string, base: string): BookmarkPreview {
  const head = html.slice(0, html.search(/<\/head>/i) > 0 ? html.search(/<\/head>/i) : html.length);
  const meta = new Map<string, string>();
  for (const m of head.matchAll(/<meta\b[^>]*>/gi)) {
    const a = attrsOf(m[0]);
    const key = (a.property ?? a.name ?? a.itemprop ?? "").toLowerCase();
    if (key && a.content && !meta.has(key)) meta.set(key, decode(a.content));
  }
  const url = (value: string | undefined): string | null => {
    if (!value) return null;
    try {
      const u = new URL(value, base);
      return /^https?:$/.test(u.protocol) && u.href.length <= 2048 ? u.href : null;
    } catch {
      return null;
    }
  };
  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1];
  let icon: string | null = null;
  let iconScore = -1;
  for (const m of head.matchAll(/<link\b[^>]*>/gi)) {
    const a = attrsOf(m[0]);
    const rel = (a.rel ?? "").toLowerCase();
    if (!/\bicon\b/.test(rel) || !a.href) continue;
    // Prefer an Apple touch icon (large, opaque), then a sized PNG, then any icon.
    const score = rel.includes("apple-touch-icon") ? 3 : /png|svg/.test(a.type ?? a.href) ? 2 : 1;
    if (score > iconScore) {
      const resolved = url(a.href);
      if (resolved) {
        icon = resolved;
        iconScore = score;
      }
    }
  }
  const clip = (s: string | undefined | null, n: number) => (s ? (s.length > n ? `${s.slice(0, n - 1)}…` : s) : null);
  return {
    title: clip(meta.get("og:title") ?? meta.get("twitter:title") ?? (titleTag ? decode(titleTag) : undefined), 300),
    description: clip(meta.get("og:description") ?? meta.get("twitter:description") ?? meta.get("description"), 500),
    siteName: clip(meta.get("og:site_name") ?? meta.get("application-name"), 120),
    image: url(meta.get("og:image:secure_url") ?? meta.get("og:image") ?? meta.get("og:image:url") ?? meta.get("twitter:image") ?? meta.get("twitter:image:src")),
    icon: icon ?? url("/favicon.ico"),
  };
}

/** The preview of a public web page, or empty fields when it can't be read. */
export const preview = action({
  args: { url: v.string() },
  handler: async (ctx, args): Promise<BookmarkPreview> => {
    await requireIdentity(ctx);
    let target: URL;
    try {
      target = new URL(args.url.trim());
    } catch {
      return EMPTY;
    }
    if (!/^https?:$/.test(target.protocol) || target.username || target.password || isPrivateHost(target.hostname)) return EMPTY;
    await ctx.runMutation(internal.bookmarks.consumeQuota, {});
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      // Redirects are followed by hand, so each hop is checked too.
      let res: Response | null = null;
      let current = target;
      for (let hop = 0; hop < 5; hop++) {
        res = await fetch(current.href, {
          redirect: "manual",
          signal: controller.signal,
          headers: { "User-Agent": "Mozilla/5.0 (compatible; FoleviBot/1.0; +https://folevi.com)", Accept: "text/html,application/xhtml+xml" },
        });
        const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
        if (!location) break;
        const next = new URL(location, current);
        if (!/^https?:$/.test(next.protocol) || isPrivateHost(next.hostname)) return EMPTY;
        current = next;
      }
      if (!res || !res.ok || !/html/i.test(res.headers.get("content-type") ?? "")) return EMPTY;
      // Only the start of the page (its <head>) is needed.
      const reader = res.body?.getReader();
      if (!reader) return EMPTY;
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (size < MAX_BYTES) {
        const { done, value } = await reader.read();
        if (done || !value) break;
        chunks.push(value);
        size += value.length;
        if (/<\/head>/i.test(new TextDecoder().decode(value))) break;
      }
      void reader.cancel().catch(() => undefined);
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const c of chunks) {
        bytes.set(c.subarray(0, Math.min(c.length, size - offset)), offset);
        offset += c.length;
      }
      return previewFromHtml(new TextDecoder().decode(bytes), current.href);
    } catch {
      return EMPTY;
    } finally {
      clearTimeout(timer);
    }
  },
});
