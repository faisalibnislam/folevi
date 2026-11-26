// Apple Notes, in Folevi for Mac only: the app reads the notes through Notes' scripting interface (with the
// person's one-time permission; apps/native-kit/Sources/FoleviMac/Model/AppleNotesReader.swift) and hands
// them here as HTML with every attachment saved out of Notes, a batch at a time. Each note becomes a page in a
// folder named like its Notes folder (the account first when there's more than one; empty folders are made too),
// with its original dates, its #tags as Folevi tags, its images as images and every other attachment (PDFs,
// scans, drawings, audio, video, any file) as a file block where the note shows it, or at its end. Web links
// it holds stay links. Only what Notes refuses to hand over is left: password-locked notes (counted) and an
// attachment Notes couldn't save (named in the note's results). The pages go through the same importer as every
// other source (run.ts, importDocs).
import type { WireScope } from "@folevi/editor-schema";
import { ulid } from "@folevi/editor-schema";
import { htmlToMarkdown } from "./htmlToMarkdown";
import { dataUriImage, type ImportDoc, type ImportImage } from "./sources";
import { importDocs, type ImportResult } from "./run";

/** One of a note's attachments, as the Mac saved it out of Notes. */
export interface AppleNoteAttachment {
  name: string;
  /** How the note's HTML refers to it ("cid:…"), when it does. */
  cid?: string;
  /** A web link attachment's address (nothing to save). */
  url?: string;
  /** The file's type and its bytes (base64), once saved. */
  mime?: string;
  data?: string;
  /** Why Notes didn't hand the file over. */
  error?: string;
}

/** A note as the Mac reads it from Notes. */
export interface AppleNote {
  /** Notes' own id (x-coredata://…), for reading it and keeping it apart from the rest. */
  id: string;
  title: string;
  /** The note's body as Notes gives it: HTML, images inline as data: URIs. */
  html: string;
  /** Its folder's names from the top level down; the account's name first when there's more than one. */
  folder: string[];
  /** When it was made and last changed (ms since 1970), as Notes says. */
  created?: number;
  modified?: number;
  /** Every attachment Notes lists for it (the body's images too). */
  attachments?: AppleNoteAttachment[];
}

/** A note the Mac has found but not read yet (Notes' scan: everything but the body). */
export type AppleNoteRef = Omit<AppleNote, "html" | "attachments">;

/** A read note's body and attachments. */
export type AppleNoteBody = { id: string; html: string; attachments: AppleNoteAttachment[] };

/** What foleviDesktop.appleNotes answers (lib/desktop.ts). */
export interface AppleNotesBridge {
  access(ask: boolean): Promise<AppleNotesAccess>;
  /** Every note (but locked ones, counted) and every folder, empty ones too. */
  scan(): Promise<{ notes: AppleNoteRef[]; locked: number; folders?: string[][] }>;
  /**
   * The notes' bodies, from the start of `ids` until a size budget is used up (big attachments): ids neither in
   * `notes` nor in `missing` are asked for again. `missing` are gone or locked since the scan.
   */
  read(ids: string[]): Promise<{ notes: AppleNoteBody[]; missing: string[] }>;
}
export type AppleNotesAccess = "granted" | "denied" | "not-determined" | "unavailable";

const norm = (s: string) => s.replace(/\s+/g, " ").trim().normalize("NFC");
const WEB_IMAGE = /^image\/(png|jpeg|gif|webp)$/i;

/** The note's body without its first line when that line is the title (Notes names a note by its first line). */
export function withoutTitleLine(html: string, title: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const first = [...doc.body.children].find((el) => norm(el.textContent ?? "") !== "" || el.querySelector("img"));
  if (first && !first.querySelector("img") && norm(first.textContent ?? "") === norm(title)) first.remove();
  return doc.body.innerHTML;
}

/**
 * Notes' tags: "#word" in the text (letters, digits, "-" and "_", not only digits), at the start or after a space
 * or bracket, so a link's "#anchor" isn't one. In order, each once, at most 20.
 */
export function hashtags(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(/(?:^|[\s([{])#([\p{L}\p{N}_-]{1,40})/gu)) {
    const tag = m[1]!.replace(/[-_]+$/, "");
    if (!tag || /^[\p{N}_-]+$/u.test(tag)) continue;
    const key = tag.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length === 20) break;
  }
  return out;
}

function base64ToBlob(b64: string, mime: string): Blob {
  const bin = atob(b64.replace(/\s+/g, ""));
  const bytes = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

const EXT: Record<string, string> = { "image/heic": "heic", "image/heif": "heif", "image/tiff": "tiff", "image/bmp": "bmp", "image/svg+xml": "svg", "application/pdf": "pdf" };
const cidKey = (s: string) => s.replace(/^cid:/i, "").replace(/^<|>$/g, "").trim().toLowerCase();
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** A Markdown link target that needs no escaping. */
const fileRef = (n: number) => `apple-notes-file-${n}`;
const imageRef = (n: number) => `apple-notes-image-${n}`;
const linkText = (s: string) => s.replace(/[[\]\\]/g, "\\$&").replace(/\n/g, " ");

/** One note as a page: title as its heading, body as Markdown, every image and attachment with it, its tags and dates. */
export function appleNoteDoc(note: AppleNote): ImportDoc {
  const title = norm(note.title).slice(0, 200) || "Untitled";
  const warnings: { message: string }[] = [];
  const images = new Map<string, ImportImage>();
  const files = new Map<string, ImportImage>();
  const addFile = (blob: Blob, name: string, mime: string) => {
    const key = fileRef(files.size + 1);
    files.set(key, { blob, filename: name || "Attachment", mime: mime || "application/octet-stream" });
    return key;
  };
  const attachments = note.attachments ?? [];
  const byCid = new Map(attachments.filter((a) => a.cid).map((a) => [cidKey(a.cid!), a]));
  const used = new Set<AppleNoteAttachment>();

  // The body, with what refers to an attachment ("cid:") pointing at the saved file instead.
  const dom = new DOMParser().parseFromString(withoutTitleLine(note.html, title), "text/html");
  const inlineImages = dom.querySelectorAll('img[src^="data:"]').length;
  for (const el of [...dom.querySelectorAll("[src], [href], object[data]")]) {
    const attr = el.hasAttribute("src") ? "src" : el.hasAttribute("href") ? "href" : "data";
    const ref = el.getAttribute(attr) ?? "";
    if (!/^cid:/i.test(ref)) continue;
    const a = byCid.get(cidKey(ref));
    if (!a?.data) continue;
    used.add(a);
    const mime = a.mime ?? "application/octet-stream";
    if (el.tagName.toLowerCase() === "img" && WEB_IMAGE.test(mime)) {
      el.setAttribute("src", `data:${mime};base64,${a.data}`);
    } else {
      const p = dom.createElement("p");
      const link = dom.createElement("a");
      link.setAttribute("href", addFile(base64ToBlob(a.data, mime), a.name, mime));
      link.textContent = a.name || "Attachment";
      p.append(link);
      el.replaceWith(p);
    }
  }
  const { markdown, images: refs } = htmlToMarkdown(dom.body.innerHTML);
  // Its tags, from the text as lines (Markdown's escapes undone; a link's "/#anchor" never counts).
  const tags = hashtags(markdown.replace(/\\([\\`*_[\]])/g, "$1"));
  let content = markdown;
  let n = 0;
  for (const ref of refs) {
    if (!ref.src.startsWith("data:")) continue;
    const md = `![${ref.alt}](${ref.src})`;
    const img = dataUriImage(ref.src, n + 1);
    if (img) {
      n++;
      content = content.replace(md, `![${ref.alt}](${imageRef(n)})`);
      images.set(imageRef(n), img);
      continue;
    }
    // An image the web can't show (the Mac makes most of them JPEG first) still comes along, as its file.
    const m = /^data:([^;,]+);base64,(.+)$/is.exec(ref.src);
    if (m) {
      const mime = m[1]!.toLowerCase();
      const key = addFile(base64ToBlob(m[2]!, mime), `${ref.alt || "Image"}.${EXT[mime] ?? mime.split("/")[1] ?? "bin"}`, mime);
      content = content.replace(md, `\n\n[${linkText(ref.alt || "Image")}](${key})\n\n`);
    } else {
      content = content.replace(md, "");
      warnings.push({ message: "An image in this note couldn’t be read" });
    }
  }

  // Attachments the body doesn't refer to go at the end: its images (but those already in the body as pictures,
  // which Notes lists here too), files, and web links. One Notes couldn't save is named.
  const tail: string[] = [];
  let alreadyShown = inlineImages;
  for (const a of attachments) {
    if (used.has(a)) continue;
    if (a.error || (!a.data && !a.url)) {
      warnings.push({ message: `Attachment “${a.name || "untitled"}” couldn’t be taken out of Notes${a.error ? `: ${a.error}` : ""}` });
      continue;
    }
    if (!a.data) {
      tail.push(`[${linkText(a.name || a.url!)}](${a.url!.replace(/\)/g, "%29").replace(/ /g, "%20")})`);
      continue;
    }
    const mime = a.mime ?? "application/octet-stream";
    if (/^image\//i.test(mime) && alreadyShown > 0) {
      alreadyShown--;
      continue;
    }
    if (WEB_IMAGE.test(mime)) {
      n++;
      images.set(imageRef(n), { blob: base64ToBlob(a.data, mime), filename: a.name || `image-${n}`, mime });
      tail.push(`![](${imageRef(n)})`);
    } else {
      tail.push(`[${linkText(a.name || "Attachment")}](${addFile(base64ToBlob(a.data, mime), a.name, mime)})`);
    }
  }
  if (tail.length) content = `${content}\n\n${tail.join("\n\n")}`;

  const folderPath = cleanFolder(note.folder);
  const body = content.replace(/\n{3,}/g, "\n\n").trim();
  return {
    name: [...folderPath, title].join(" / "),
    path: `apple-notes/${note.id}`,
    filename: `${title}.md`,
    format: "markdown",
    content: body ? `# ${title}\n\n${body}` : `# ${title}`,
    images,
    ...(files.size ? { files } : {}),
    ...(tags.length ? { tags } : {}),
    publicId: ulid(),
    ...(folderPath.length ? { folderPath } : {}),
    ...(note.created !== undefined ? { createdAt: note.created } : {}),
    ...(note.modified !== undefined ? { updatedAt: note.modified } : {}),
    warnings,
  };
}

/** Folder names as Folevi keeps them (no control characters, 80 characters, 8 levels). */
export const cleanFolder = (path: string[]): string[] => path.map((f) => f.replace(/[\u0000-\u001F\u007F]/g, "").trim().slice(0, 80)).filter(Boolean).slice(0, 8);

export const appleNotesDocs = (notes: AppleNote[]): ImportDoc[] => notes.map(appleNoteDoc);

/** Notes asked for per bridge call (the Mac may hand back fewer when their attachments are big). */
export const APPLE_NOTES_BATCH = 20;

type Client = Parameters<typeof importDocs>[0];
type Options = Omit<Parameters<typeof importDocs>[3], "out" | "offset" | "total" | "folders">;

/**
 * The web section's Apple Notes import (in the Mac app): finds every note and folder, then reads and imports the
 * notes a batch at a time until done or `signal` stops it. Locked notes are skipped and counted.
 */
export async function importAppleNotes(client: Client, scope: WireScope, bridge: AppleNotesBridge, o: Options): Promise<{ results: ImportResult[]; locked: number; total: number; cancelled: boolean }> {
  const out: ImportResult[] = [];
  o.onProgress?.("Finding your notes in Apple Notes…");
  const { notes, locked, folders } = await bridge.scan();
  let folderPaths = (folders ?? []).map(cleanFolder).filter((f) => f.length);
  let done = 0;
  const queue = [...notes];
  while (queue.length && !o.signal?.aborted) {
    const refs = queue.slice(0, APPLE_NOTES_BATCH);
    o.onProgress?.(`Reading notes from ${done + 1} of ${notes.length}…`);
    const { notes: bodies, missing } = await bridge.read(refs.map((r) => r.id));
    const got = new Map(bodies.map((b) => [b.id, b]));
    const gone = new Set(missing);
    const batch: AppleNote[] = [];
    let handled = 0;
    for (const r of refs) {
      const b = got.get(r.id);
      if (b) batch.push({ ...r, html: b.html, attachments: b.attachments });
      else if (gone.has(r.id)) out.push({ name: [...cleanFolder(r.folder), r.title].join(" / "), warnings: [], error: "Notes didn’t hand this note over (it was deleted or locked after the import started)." });
      else break; // over the size budget: asked for again in the next read
      handled++;
    }
    if (!handled) throw new Error("Apple Notes didn’t hand over the next note. Try the import again.");
    queue.splice(0, handled);
    if (o.signal?.aborted) break;
    await importDocs(client, scope, appleNotesDocs(batch), { ...o, out, offset: done, total: notes.length, folders: folderPaths });
    folderPaths = []; // made with the first batch
    done += handled;
  }
  return { results: out, locked, total: notes.length, cancelled: o.signal?.aborted === true };
}

/** The line that sums an Apple Notes import up. */
export function appleNotesSummary(r: { results: ImportResult[]; locked: number; total: number; cancelled: boolean }): string {
  const ok = r.results.filter((x) => x.id).length;
  const parts = [r.cancelled ? `Stopped: imported ${ok} of ${plural(r.total, "note")}` : `Imported ${ok} of ${plural(r.total, "note")} from Apple Notes`];
  if (r.locked) parts.push(`${plural(r.locked, "locked note")} skipped (remove ${r.locked === 1 ? "its lock" : "their locks"} in Notes to import ${r.locked === 1 ? "it" : "them"})`);
  return parts.join("; ");
}
