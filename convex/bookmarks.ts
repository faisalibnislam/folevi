// Bookmark previews: the page's title, description, site name, preview image and icon, read from its HTML
// metadata (Open Graph, Twitter cards, <title>, <link rel=icon>) on the server, since browsers can't read
// other sites' pages. Only public http(s) pages are fetched, with a time and size limit, rate-limited per
// person. Images are returned as addresses (the note shows them from the site).
//
// Which addresses may be fetched is decided by the same check Foli AI's page reader uses (lib/ai/web.ts
// checkHost): http or https on ports 80 and 443, no user name or password, never a private, loopback or
// link-local address, whether written as an IP or reached through a host name (the name is looked up and
// every address it has must be public). The first request and every redirect hop are checked.
import { v } from "convex/values";
import { action } from "./_generated/server";
import { internalMutation } from "./lib/functions";
import { internal } from "./_generated/api";
import { assertWritable, getDocumentByPublicId, requireIdentity, requireProfile, resolveScope } from "./lib/auth";
import { consume } from "./lib/rateLimit";
import { vScopeArg, scopeOfRow } from "./lib/scope";
import { failE2ee, isSealed } from "./lib/e2ee/state";
import { isEncryptedSpace } from "./lib/e2ee/coreGuards";
import { checkHost, checkUrl } from "./lib/ai/web";

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
  args: { scope: v.optional(vScopeArg), documentId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    // Fetching the page would show Folevi the link: never for an end-to-end encrypted note or space
    // (docs/E2EE_DESIGN.md §5.7, §14 Q6). The Mac app fetches previews on the device instead.
    const doc = args.documentId ? await getDocumentByPublicId(ctx, args.documentId) : null;
    if (doc && isSealed(doc)) failE2ee("e2ee_unavailable", undefined, { feature: "bookmarkPreview" });
    const scope = doc ? scopeOfRow(doc) : args.scope ? (await resolveScope(ctx, profile, args.scope)).scope : null;
    if (scope && (await isEncryptedSpace(ctx, scope))) failE2ee("e2ee_unavailable", undefined, { feature: "bookmarkPreview" });
    await consume(ctx, "bookmarkPreview", profile._id);
    return null;
  },
});

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
  /** Where the bookmark is (a note, or its place): previews are off in end-to-end encrypted ones. */
  args: { url: v.string(), scope: v.optional(vScopeArg), documentId: v.optional(v.string()) },
  handler: async (ctx, args): Promise<BookmarkPreview> => {
    await requireIdentity(ctx);
    // The link itself first (no lookup yet), so a link that can never be read costs nothing.
    const link = checkUrl(args.url);
    if (!link.ok) return EMPTY;
    await ctx.runMutation(internal.bookmarks.consumeQuota, { scope: args.scope, documentId: args.documentId });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      // Redirects are followed by hand, so each hop is checked too.
      let res: Response | null = null;
      let current = link.url;
      for (let hop = 0; hop < 5; hop++) {
        // Every address the host name has must be public, on this hop like on the first.
        const checked = await checkHost(current.href);
        if (!checked.ok) return EMPTY;
        current = checked.url;
        res = await fetch(current.href, {
          credentials: "omit",
          redirect: "manual",
          signal: controller.signal,
          headers: { "User-Agent": "Mozilla/5.0 (compatible; FoleviBot/1.0; +https://folevi.com)", Accept: "text/html,application/xhtml+xml" },
        });
        const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
        if (!location) break;
        void res.body?.cancel().catch(() => undefined);
        res = null;
        current = new URL(location, current);
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
