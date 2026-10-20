// Text found in a note's files and drawings, so search finds it (docs/ARCHITECTURE.md, "Search in files"): the words in a
// PDF (read on the device with pdf.js), in an image (recognised on the device by Apple's Vision, or by Foli AI
// when asked), and in handwriting on a whiteboard (drawn to an image and recognised on the device). The text
// is kept beside the file, never in the note's body, and these helpers are shared by the client that finds
// it and the server that stores and searches it.

/** Where a piece of found text came from (what a search result says: "in PDF, page 3"). */
export type FileTextSource = "pdf" | "image" | "handwriting";

/** Who read it: pdf.js on the device, the device's own recogniser (Vision), or Foli AI (AI credits). */
export type FileTextReader = "pdf" | "device" | "foli";

/** The most characters kept for one file or drawing (the search index takes the rest of the row easily). */
export const MAX_FILE_TEXT = 100_000;
/** PDF pages read at most (a long manual is still found by its first few hundred pages). */
export const MAX_PDF_PAGES = 300;
/** PDFs larger than this aren't read on the device (it would take too long and too much memory). */
export const MAX_PDF_BYTES = 40 * 1024 * 1024;
/** Pages a PDF can say it starts at (`pageStarts` length). */
export const MAX_PAGE_STARTS = MAX_PDF_PAGES;

// Control characters (but not tab or line breaks) and the replacement character.
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\uFFFD]/g;

/**
 * Found text, tidied: control characters dropped, runs of spaces and blank lines collapsed, each line
 * trimmed, at most `max` characters (cut at a word where it can be).
 */
export function cleanFileText(text: string, max = MAX_FILE_TEXT): string {
  const lines = text
    .replace(/\r\n?/g, "\n")
    .replace(CONTROL, "")
    .split("\n")
    .map((l) => l.replace(/[ \t\u00a0]+/g, " ").trim());
  const out: string[] = [];
  for (const l of lines) {
    if (!l && (!out.length || !out[out.length - 1])) continue;
    out.push(l);
  }
  while (out.length && !out[out.length - 1]) out.pop();
  const joined = out.join("\n");
  if (joined.length <= max) return joined;
  const cut = joined.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return space > max * 0.9 ? cut.slice(0, space) : cut;
}

/**
 * A PDF's pages as one text, with where each page starts in it (for "page 3"). Pages are tidied one by one,
 * separated by a blank line; reading stops at `max` characters, so the last page may be cut short.
 */
export function joinPdfPages(pages: readonly string[], max = MAX_FILE_TEXT): { text: string; pageStarts: number[] } {
  let text = "";
  const pageStarts: number[] = [];
  for (const raw of pages.slice(0, MAX_PDF_PAGES)) {
    const sep = text ? "\n\n" : "";
    const room = max - text.length - sep.length;
    if (room <= 0) break;
    const page = cleanFileText(raw, room);
    pageStarts.push(text.length + sep.length);
    if (page) text += sep + page;
  }
  return { text, pageStarts };
}

/** The page (1-based) an offset in a PDF's text is on, or null when the text has no pages. */
export function pageAt(pageStarts: readonly number[] | undefined, offset: number): number | null {
  if (!pageStarts?.length) return null;
  let page = 1;
  for (let i = 0; i < pageStarts.length; i++) if (pageStarts[i]! <= offset) page = i + 1;
  return page;
}

/** Whether `pageStarts` is well formed for a text: increasing offsets inside it, at most one per page read. */
export function validPageStarts(pageStarts: readonly number[], textLength: number): boolean {
  if (pageStarts.length > MAX_PAGE_STARTS) return false;
  let last = -1;
  for (const n of pageStarts) {
    if (!Number.isInteger(n) || n < 0 || n > textLength || n < last) return false;
    last = n;
  }
  return true;
}

/** How a search result names where its words were found. */
export function fileTextLabel(source: FileTextSource, page?: number | null): string {
  if (source === "pdf") return page ? `In PDF, page ${page}` : "In PDF";
  if (source === "handwriting") return "In handwriting";
  return "In image";
}

/** A short stable fingerprint of some text (a drawing's strokes), to tell when it changed. Not for security. */
export function textFingerprint(value: string): string {
  // FNV-1a, 32-bit, twice with different seeds: plenty to notice a drawing changed.
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ value.length;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x5bd1e995) >>> 0;
  }
  return `${a.toString(16).padStart(8, "0")}${b.toString(16).padStart(8, "0")}`;
}
