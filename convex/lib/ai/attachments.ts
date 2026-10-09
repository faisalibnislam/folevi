// Files the AI can read (docs/AI_ASSISTANT.md, "Attachments"): which kinds, the limits, and turning a
// file's bytes into what the model is sent. Pure (no database, no provider), so the web app checks a file
// the same way before it's uploaded or sent: a file the assistant can't read is refused there, plainly,
// and never guessed at.
//
//   Images (PNG, JPEG, WebP) and PDFs go to the model as inline data, as does audio. Everything inline in
//   one request stays under INLINE_BUDGET_BYTES (Gemini refuses requests over 20 MB, and base64 adds a
//   third); a larger PDF or recording is refused with the limit rather than sent through the Files API.
//   Text, Markdown, CSV, HTML (stripped to its text) and JSON are read here and sent as text.
//   Word, Excel and PowerPoint files: no parser exists in the app yet, so they're "not supported yet".

const MB = 1024 * 1024;

/** Files one message can carry. */
export const MAX_ATTACHMENTS = 5;
/** Raw bytes sent inline in one request (images, PDFs, audio): about 19 MB once base64-encoded. */
export const INLINE_BUDGET_BYTES = 14 * MB;
/** The largest file of each kind. */
export const ATTACHMENT_LIMITS = { image: 7 * MB, pdf: 14 * MB, audio: 14 * MB, text: 2 * MB } as const;
/** The largest file a chat can upload (the largest of the limits). */
export const MAX_ATTACHMENT_UPLOAD = 14 * MB;
/** Characters of one text file the model reads (the rest is cut, and it's told so). */
export const TEXT_CHARS = 100_000;
/** Characters of all of a request's text files together. */
export const TEXT_BUDGET_CHARS = 200_000;

export type AttachmentKind = "image" | "pdf" | "audio" | "text" | "markdown" | "csv" | "html" | "json";

/** What the active model can take in (lib/ai/capabilities.ts). */
export interface ModelInputs {
  vision: boolean;
  audioIn: boolean;
}

export type AttachmentCheck = { ok: true; kind: AttachmentKind } | { ok: false; reason: string };

const IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/webp"]);
const OFFICE = /\.(docx?|xlsx?|pptx?|odt|ods|odp|pages|numbers|key|rtf)$/i;
const TEXT_EXT: Record<string, AttachmentKind> = {
  txt: "text",
  text: "text",
  log: "text",
  md: "markdown",
  markdown: "markdown",
  csv: "csv",
  tsv: "csv",
  html: "html",
  htm: "html",
  json: "json",
};
const TEXT_MIME: Record<string, AttachmentKind> = {
  "text/plain": "text",
  "text/markdown": "markdown",
  "text/csv": "csv",
  "text/tab-separated-values": "csv",
  "text/html": "html",
  "application/json": "json",
};
/** Types a browser or the server's sniffing may give a text file whose name says what it is. */
const GENERIC_MIMES = new Set(["", "application/octet-stream", "text/plain"]);

const extOf = (name: string) => (/\.([a-z0-9]{1,10})$/i.exec(name)?.[1] ?? "").toLowerCase();
const mimeOf = (mime: string) => mime.split(";")[0]!.trim().toLowerCase();

/** What kind of file this is to the assistant, or null when it can't read it. */
export function attachmentKind(file: { filename: string; mimeType: string }): AttachmentKind | null {
  const mime = mimeOf(file.mimeType);
  const ext = extOf(file.filename);
  if (IMAGE_MIMES.has(mime)) return "image";
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("audio/")) return "audio";
  if (TEXT_EXT[ext] && (GENERIC_MIMES.has(mime) || TEXT_MIME[mime] || mime.startsWith("text/"))) return TEXT_EXT[ext]!;
  if (TEXT_MIME[mime]) return TEXT_MIME[mime]!;
  return null;
}

/** The text kinds, read here and sent as text. */
export const isTextKind = (kind: AttachmentKind) => kind !== "image" && kind !== "pdf" && kind !== "audio";
/** Spreadsheet data: the model is given `calculate` for its numbers. */
export const isSheet = (kind: AttachmentKind) => kind === "csv";

const mb = (bytes: number) => `${Math.round(bytes / MB)} MB`;
const LABEL: Record<AttachmentKind, string> = { image: "Images", pdf: "PDFs", audio: "Recordings", text: "Text files", markdown: "Text files", csv: "Text files", html: "Text files", json: "Text files" };

/**
 * Whether the assistant can read a file: a kind it reads, within its size limit, and something the active
 * model takes in (`caps`, when known). The reason is a sentence to show the person.
 */
export function checkAttachment(file: { filename: string; mimeType: string; size: number }, caps?: ModelInputs): AttachmentCheck {
  const name = file.filename || "That file";
  if (OFFICE.test(file.filename)) return { ok: false, reason: `“${name}” isn't supported yet. Word, Excel and PowerPoint files can't be read yet: save it as a PDF or CSV and attach that.` };
  const kind = attachmentKind(file);
  if (!kind) {
    if (mimeOf(file.mimeType).startsWith("image/")) return { ok: false, reason: `“${name}” isn't supported yet. Images can be PNG, JPEG or WebP.` };
    return { ok: false, reason: `“${name}” isn't supported yet. The assistant reads PDFs, images, text, Markdown, CSV, HTML and JSON.` };
  }
  const limit = isTextKind(kind) ? ATTACHMENT_LIMITS.text : ATTACHMENT_LIMITS[kind as "image" | "pdf" | "audio"];
  if (file.size > limit) return { ok: false, reason: `“${name}” is too large. ${LABEL[kind]} can be up to ${mb(limit)}.` };
  if (caps && (kind === "image" || kind === "pdf") && !caps.vision) return { ok: false, reason: `The AI model in use can't read ${kind === "pdf" ? "PDFs" : "images"}.` };
  if (caps && kind === "audio" && !caps.audioIn) return { ok: false, reason: "The AI model in use can't listen to recordings." };
  return { ok: true, kind };
}

/** Whether a set of files fits in one request (inline kinds together). The reason when not. */
export function checkInlineBudget(files: { kind: AttachmentKind; size: number }[]): string | null {
  const inline = files.filter((f) => !isTextKind(f.kind)).reduce((n, f) => n + f.size, 0);
  return inline > INLINE_BUDGET_BYTES ? `Those files are too large together. PDFs, images and recordings can add up to ${mb(INLINE_BUDGET_BYTES)} per message.` : null;
}

/**
 * About how many tokens a file costs the model, for holding credits up front (the real count comes back
 * with the answer): an image ~1,300, a PDF ~600 a page (pages guessed from the size), audio 32 a second
 * (seconds guessed from the size), text a token per 4 characters.
 */
export function attachmentTokens(kind: AttachmentKind, size: number): number {
  if (kind === "image") return 1_300;
  if (kind === "pdf") return Math.min(600_000, Math.ceil(size / 50_000) * 600);
  if (kind === "audio") return Math.ceil(size / 250);
  return Math.ceil(Math.min(size, TEXT_CHARS) / 4);
}

/** Bytes as UTF-8 text, or null when they aren't text (a binary file with a text name). */
export function decodeText(bytes: Uint8Array): string | null {
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes).replace(/^\uFEFF/, "");
  if (text.includes("\u0000")) return null;
  const bad = (text.match(/\uFFFD/g) ?? []).length;
  if (bad > Math.max(4, text.length / 100)) return null;
  return text;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", mdash: "-", ndash: "-", hellip: "...", copy: "©", reg: "®" };

/** An HTML page's readable text: scripts, styles and comments dropped, blocks on their own lines, tags gone. */
export function htmlToText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|template|svg|head)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<\/(td|th)\s*>/gi, "\t")
    .replace(/<\/?(p|div|section|article|header|footer|main|nav|aside|h[1-6]|ul|ol|li|tr|table|blockquote|pre|figure|figcaption|dl|dt|dd)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === "#") {
        const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : " ";
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/[ \t\f\v\u00A0]+/g, (s) => (s.includes("\t") ? "\t" : " "))
    .split("\n")
    .map((l) => l.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** A text file's content as the model reads it (HTML as its text), cut to `max` characters. */
export function textForModel(kind: AttachmentKind, raw: string, max = TEXT_CHARS): { text: string; cut: boolean } {
  const text = kind === "html" ? htmlToText(raw) : raw;
  return text.length > max ? { text: text.slice(0, max), cut: true } : { text, cut: false };
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Bytes as base64 (inline data), without relying on Buffer or btoa. */
export function toBase64(bytes: Uint8Array): string {
  const out: string[] = [];
  let chunk = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = i + 1 < bytes.length ? bytes[i + 1]! : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2]! : 0;
    const n = (a << 16) | (b << 8) | c;
    chunk += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + (i + 1 < bytes.length ? B64[(n >> 6) & 63]! : "=") + (i + 2 < bytes.length ? B64[n & 63]! : "=");
    if (chunk.length >= 8192) {
      out.push(chunk);
      chunk = "";
    }
  }
  out.push(chunk);
  return out.join("");
}

/** Said to the model when spreadsheet data comes with a request. */
export const SHEET_RULE = "For any arithmetic on numbers from attached files (totals, averages, differences, percentages, counts), call the calculate tool and use its result. Never work numbers out yourself.";
