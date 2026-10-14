// Save to Folevi: what another app (the system share sheet, through the PWA's share target) or the
// bookmarklet sends, tidied into a note. Apps fill title, text and url very differently: many put the
// link in `text` and leave `url` empty, some repeat the link or the title in both, so the link is found
// once and never shown twice.
import { rankSequence, SCHEMA_VERSION, ulid, type WireBlock } from "@folevi/editor-schema";

export const MAX_SHARE_TITLE = 200;
export const MAX_SHARE_TEXT = 20_000;
export const MAX_SHARE_URL = 2048;
/** Lines of shared text kept as paragraphs (the rest joins the last one). */
const MAX_LINES = 200;
/** Files a share may carry, and the size of each (larger ones are left out and named). */
export const MAX_SHARE_FILES = 10;
export const MAX_SHARE_FILE_BYTES = 20 * 1024 * 1024;

export interface SharePayload {
  title: string;
  text: string;
  /** An http(s) link, or null. */
  url: string | null;
}

const URL_IN_TEXT = /\bhttps?:\/\/[^\s<>"'`]+/i;

/** The link when it's a web address (http or https), else null. Trailing punctuation from prose is dropped. */
export function webLink(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim().replace(/[).,;:!?\]]+$/, "");
  if (!value || value.length > MAX_SHARE_URL) return null;
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}

/** A short name for a link: its host without www, and the path when there is one. */
export function linkName(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/$/, "");
    return `${u.hostname.replace(/^www\./, "")}${path}`.slice(0, 120);
  } catch {
    return url.slice(0, 120);
  }
}

/** Tidies what was shared: trimmed and capped, the link found (in `url` or the text) and shown once. */
export function normaliseShare(input: { title?: string | null; text?: string | null; url?: string | null }): SharePayload {
  let title = (input.title ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_SHARE_TITLE);
  let text = (input.text ?? "").replace(/\r\n?/g, "\n").trim().slice(0, MAX_SHARE_TEXT);
  let url = webLink(input.url);
  if (!url) {
    const found = URL_IN_TEXT.exec(text)?.[0];
    url = webLink(found);
  }
  if (url) {
    // The link said again in the text (alone, or after a sentence about it) is taken out of the text.
    for (const form of new Set([url, url.replace(/\/$/, ""), (input.url ?? "").trim()])) {
      if (form) text = text.split(form).join("");
    }
    text = text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  }
  if (text === title) text = "";
  if (url && (title === url || webLink(title) === url)) title = "";
  if (!title) title = text ? (text.split("\n")[0] ?? "").slice(0, 120).trim() : url ? linkName(url) : "";
  return { title, text, url };
}

/** The shared text and link as the note's blocks: the link as a bookmark, then a paragraph per line of text. */
export function shareBlocks(payload: SharePayload, extra: WireBlock[] = []): WireBlock[] {
  const top: Omit<WireBlock, "rank">[] = [];
  if (payload.url) {
    top.push({ id: ulid(), type: "bookmark", parentId: null, schemaVersion: SCHEMA_VERSION, text: [], props: { url: payload.url, ...(payload.title ? { title: payload.title } : {}) } });
  }
  const lines = payload.text.split("\n").map((l) => l.trim());
  const kept: string[] = [];
  for (const line of lines) {
    if (!line) continue;
    if (kept.length < MAX_LINES) kept.push(line);
    else kept[kept.length - 1] += ` ${line}`;
  }
  for (const line of kept) {
    top.push({ id: ulid(), type: "paragraph", parentId: null, schemaVersion: SCHEMA_VERSION, text: [{ type: "text", text: line.slice(0, 20_000) }], props: {} });
  }
  const all = [...top, ...extra.map(({ rank: _rank, ...b }) => b)];
  const ranks = rankSequence(all.length);
  return all.map((b, i) => ({ ...b, rank: ranks[i]! }));
}

/** Files Folevi can put in the note: images as image blocks, PDFs (and other files) as file blocks. */
export function shareFileKind(file: { type: string; size: number }): "image" | "file" | null {
  if (file.size <= 0 || file.size > MAX_SHARE_FILE_BYTES) return null;
  if (/^image\/(png|jpe?g|gif|webp)$/i.test(file.type)) return "image";
  if (file.type === "application/pdf") return "file";
  return null;
}

/**
 * The bookmarklet: run on any page, it reads only the page's title, address and selected text, and opens
 * Folevi's share page with them in a small window (nothing is injected into the page, nothing else read).
 */
export function bookmarkletHref(origin: string): string {
  const base = `${origin.replace(/\/$/, "")}/share`;
  const code =
    "(function(){var d=document,w=window,s='';try{s=String(w.getSelection?w.getSelection():'').slice(0,2000)}catch(e){}" +
    `var u=${JSON.stringify(base)}+'?title='+encodeURIComponent(d.title.slice(0,200))+'&url='+encodeURIComponent(location.href)+'&text='+encodeURIComponent(s);` +
    "var o=w.open(u,'folevi-share','width=520,height=640,resizable=yes,scrollbars=yes');if(!o)location.href=u;})()";
  return `javascript:${encodeURIComponent(code)}`;
}
