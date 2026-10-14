// What a clip becomes in Folevi: a title, a source line ("Clipped from [title](url) on 14 October 2026"),
// the byline when the page has one, and the content as Markdown, cut at a paragraph when it's longer than a
// note takes. A link clip (from the context menu) is the link itself with where it was found.
import { MAX_CLIP_CHARS } from "../config";
import { safeUrl } from "./htmlToMarkdown";

export type ClipKind = "article" | "selection" | "link";

export interface Clip {
  kind: ClipKind;
  /** The page's title (or the link's text, for a link). */
  title: string;
  /** The page the clip came from. */
  pageUrl: string;
  pageTitle?: string;
  markdown: string;
  byline?: string | null;
  siteName?: string | null;
  /** For a link clip: where it points. */
  linkUrl?: string;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "14 October 2026", in the person's own time zone. */
export function clipDate(date: Date): string {
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

/** Text that sits inside a Markdown link's brackets. */
function linkText(text: string): string {
  return text.replace(/\s+/g, " ").trim().replace(/([\\[\]])/g, "\\$1");
}

/** A note title: one line, at most 200 characters, never empty. */
export function cleanTitle(title: string, fallbackUrl?: string): string {
  const t = title.replace(/\s+/g, " ").trim().slice(0, 200).trim();
  if (t) return t;
  try {
    if (fallbackUrl) return new URL(fallbackUrl).hostname.replace(/^www\./, "") || "Untitled clip";
  } catch {
    // Not an address.
  }
  return "Untitled clip";
}

/** Where the clip came from, as a line of Markdown. */
export function sourceLine(kind: ClipKind, pageTitle: string, pageUrl: string, date: Date): string {
  const url = safeUrl(pageUrl, pageUrl);
  const name = linkText(pageTitle) || url || "a page";
  const from = url ? `[${name}](${url})` : name;
  return `${kind === "link" ? "Link saved from" : "Clipped from"} ${from} on ${clipDate(date)}`;
}

/** Cuts Markdown to `max` characters at the last paragraph (or line) break before it. */
export function capMarkdown(markdown: string, max: number): { markdown: string; cut: boolean } {
  if (markdown.length <= max) return { markdown, cut: false };
  const head = markdown.slice(0, max);
  const at = Math.max(head.lastIndexOf("\n\n"), head.lastIndexOf("\n"));
  let kept = (at > max * 0.5 ? head.slice(0, at) : head).trimEnd();
  // Don't leave a code fence open.
  if ((kept.match(/^(```|~~~)/gm) ?? []).length % 2 === 1) kept += "\n```";
  return { markdown: kept, cut: true };
}

const CUT_NOTE = "_The rest of the page was too long to clip._";

/** The note for a clip: its title and Markdown (source line first, content after a rule). */
export function buildNote(clip: Clip, now: Date): { title: string; markdown: string } {
  const pageTitle = clip.pageTitle ?? clip.title;
  const header = [sourceLine(clip.kind, cleanTitle(pageTitle, clip.pageUrl), clip.pageUrl, now)];
  const byline = [clip.byline, clip.siteName].map((s) => (s ?? "").replace(/\s+/g, " ").trim().replace(/([\\`*_[\]])/g, "\\$1")).filter(Boolean);
  if (clip.kind === "article" && byline.length) header.push(`${[...new Set(byline)].join(" · ").slice(0, 200)}`);

  let body = clip.markdown.trim();
  if (clip.kind === "link") {
    const href = safeUrl(clip.linkUrl, clip.pageUrl);
    body = href ? `[${linkText(clip.title) || href}](${href})` : linkText(clip.title);
  }
  const head = header.join("\n\n");
  const room = MAX_CLIP_CHARS - head.length - CUT_NOTE.length - 16;
  const capped = capMarkdown(body, room);
  const parts = [head, ...(capped.markdown ? ["---", capped.markdown] : []), ...(capped.cut ? [CUT_NOTE] : [])];
  return { title: cleanTitle(clip.title, clip.linkUrl ?? clip.pageUrl), markdown: parts.join("\n\n") };
}
