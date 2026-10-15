// Importing from other apps, in the browser: each source becomes ImportDocs (Markdown, the images it
// shows, where it nests and what it links to), which Settings → Import & export sends to imports.importText
// one by one. Sources: Markdown/text files and folders (and Obsidian vaults), a Notion export (ZIP), an
// Evernote export (.enex), Word documents (.docx), HTML files and CSV tables (alone, in a folder or in a ZIP).
import { ulid } from "@folevi/editor-schema";
import { TEXT_EXT, dirname, imageMime, imageSources, normalizePath, resolveImage, type BundleEntry } from "@/components/doc/importBundle";
import { htmlToMarkdown } from "./htmlToMarkdown";
import { folderPathOf } from "./folders";
import { md5Hex } from "./md5";

export interface ImportImage {
  blob: Blob;
  filename: string;
  mime: string;
}

export interface ImportDoc {
  /** What the results list calls it (a path in the source). */
  name: string;
  /** Its path in the source, for nesting and links. */
  path: string;
  /** The file name the importer titles it by (an H1 at the top wins). */
  filename: string;
  format: "markdown" | "text";
  content: string;
  /** Images the Markdown shows, by the src it uses. */
  images: Map<string, ImportImage>;
  /** Its id, chosen here so pages of the same import can link to it before it exists. */
  publicId: string;
  /** The page it's nested under (another doc of the batch, by path). */
  parentPath?: string;
  /** Link targets in the Markdown that are pages of the batch: href → page id. */
  links?: Record<string, string>;
  /** The folder to put it in, as names from the top level down (made if needed, reused when one is there; folders.ts). */
  folderPath?: string[];
  warnings: { message: string }[];
}

export class ImportSourceError extends Error {}

const MAX_TABLE_ROWS = 200;
const MAX_TABLE_COLS = 20;

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64.replace(/\s+/g, ""));
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function dataUriImage(src: string, n: number): ImportImage | null {
  const m = /^data:(image\/(?:png|jpeg|gif|webp));base64,(.+)$/i.exec(src);
  if (!m) return null;
  const mime = m[1]!.toLowerCase();
  return { blob: new Blob([base64ToBytes(m[2]!)], { type: mime }), filename: `image-${n}.${mime.split("/")[1]!.replace("jpeg", "jpg")}`, mime };
}

// ---------------------------------------------------------------- Markdown files, folders, Obsidian

/** What a file of a bundle becomes (Markdown and text as they are, the others converted when read). */
type BundleKind = "markdown" | "csv" | "docx" | "html";
const bundleKind = (path: string): BundleKind | null =>
  TEXT_EXT.test(path) ? "markdown" : /\.csv$/i.test(path) ? "csv" : /\.docx$/i.test(path) ? "docx" : /\.html?$/i.test(path) ? "html" : null;

/**
 * Markdown and text files of a bundle (files, a folder, a ZIP) with the images they use, its CSV files as
 * tables, and the Word and HTML files inside a ZIP. Each goes in the folder its path names (a picked folder
 * or a ZIP keeps its tree).
 */
export function markdownDocs(entries: BundleEntry[], map: Map<string, BundleEntry>): ImportDoc[] {
  const out: ImportDoc[] = [];
  for (const e of entries) {
    const kind = bundleKind(e.path);
    if (!kind) continue;
    const folderPath = folderPathOf(e.path);
    out.push({
      name: e.path,
      path: e.path,
      filename: (e.path.split("/").pop() ?? e.path).replace(/\.(csv|docx|html?)$/i, ".md"),
      format: /\.(txt|text)$/i.test(e.path) ? "text" : "markdown",
      content: "",
      images: new Map(),
      publicId: ulid(),
      warnings: [],
      ...(folderPath.length ? { folderPath } : {}),
      entry: e,
      map,
      kind,
    } as ImportDoc & { entry: BundleEntry; map: Map<string, BundleEntry>; kind: BundleKind });
  }
  return out;
}

/** Reads a bundle doc's text and its local images (deferred so a big folder doesn't all sit in memory). */
export async function loadMarkdown(doc: ImportDoc): Promise<void> {
  const { entry, map, kind } = doc as ImportDoc & { entry?: BundleEntry; map?: Map<string, BundleEntry>; kind?: BundleKind };
  if (!entry || !map) return;
  if (kind === "docx") {
    const word = await docxContent(await entry.blob.arrayBuffer(), doc.warnings);
    doc.content = word.markdown;
    doc.images = word.images;
    return;
  }
  if (kind === "html") {
    // Its images: embedded ones, and ones elsewhere in the bundle by relative path.
    const html = htmlContent(await entry.blob.text(), doc.warnings, (src) => {
      const found = resolveImage(map, entry.path, src);
      const mime = found ? imageMime(found.path) : null;
      return found && mime ? { blob: found.blob, filename: found.path.split("/").pop() ?? "image", mime } : null;
    });
    doc.content = html.content;
    doc.images = html.images;
    if (html.title) doc.filename = `${html.title}.md`;
    return;
  }
  doc.content = await entry.blob.text();
  if (kind === "csv") {
    const title = (entry.path.split("/").pop() ?? "").replace(/\.csv$/i, "");
    doc.content = `# ${title}\n\n${csvToMarkdown(doc.content, doc.warnings)}`;
    return;
  }
  if (doc.format !== "markdown") return;
  for (const src of imageSources(doc.content)) {
    const found = resolveImage(map, entry.path, src);
    if (!found) continue;
    const mime = imageMime(found.path);
    if (!mime) {
      doc.warnings.push({ message: `Image “${src}” isn’t a PNG, JPEG, GIF or WebP and was kept as a link` });
      continue;
    }
    doc.images.set(src, { blob: found.blob, filename: found.path.split("/").pop() ?? "image", mime });
  }
}

// ---------------------------------------------------------------- Notion

const NOTION_ID = / ([0-9a-f]{32})(?=(_all)?\.(md|csv)$|$)/i;

/** Whether a bundle is a Notion export (pages and databases carry a 32-hex id in their names). */
export function isNotionExport(entries: BundleEntry[]): boolean {
  return entries.some((e) => / [0-9a-f]{32}(_all)?\.(md|csv)$/i.test(e.path));
}

const stripId = (name: string) => name.replace(NOTION_ID, "").replace(/\.(md|csv)$/i, "").trim() || "Untitled";

/** A relative link from one page to another, as a path in the bundle (Notion URL-encodes them). */
function resolveHref(from: string, href: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("#")) return null;
  let decoded = href.split("#")[0]!;
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    // Keep it as written.
  }
  const dir = dirname(from);
  return normalizePath(dir ? `${dir}/${decoded}` : decoded);
}

/** Parses CSV (quoted fields, doubled quotes, newlines inside quotes). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim()));
}

/** A CSV as a Markdown table (the first row is the header), capped at the table block's size. */
export function csvToMarkdown(text: string, warnings: { message: string }[]): string {
  const rows = parseCsv(text);
  if (!rows.length) return "";
  const width = Math.min(MAX_TABLE_COLS, Math.max(...rows.map((r) => r.length)));
  if (rows.some((r) => r.length > MAX_TABLE_COLS)) warnings.push({ message: `Only the first ${MAX_TABLE_COLS} columns were kept` });
  if (rows.length > MAX_TABLE_ROWS) warnings.push({ message: `Only the first ${MAX_TABLE_ROWS - 1} rows were kept (of ${rows.length - 1})` });
  const cell = (s: string | undefined) => (s ?? "").replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ").trim();
  const kept = rows.slice(0, MAX_TABLE_ROWS).map((r) => Array.from({ length: width }, (_, i) => cell(r[i])));
  return [`| ${kept[0]!.join(" | ")} |`, `| ${kept[0]!.map(() => "---").join(" | ")} |`, ...kept.slice(1).map((r) => `| ${r.join(" | ")} |`)].join("\n");
}

/**
 * A Notion export: every page (Markdown) and database (CSV, as a table), nested as in Notion (a page's
 * subpages sit in a folder named like it), with links between them turned into page links.
 */
export async function notionDocs(entries: BundleEntry[], map: Map<string, BundleEntry>): Promise<ImportDoc[]> {
  // A database exports twice (the current view and _all): keep _all.
  const allCsv = new Set(entries.filter((e) => /_all\.csv$/i.test(e.path)).map((e) => e.path.replace(/_all\.csv$/i, ".csv")));
  const pages = entries.filter((e) => /\.md$/i.test(e.path) || (/\.csv$/i.test(e.path) && !allCsv.has(e.path)));
  const ids = new Map(pages.map((e) => [e.path, ulid()]));
  const docs: ImportDoc[] = [];
  for (const e of pages) {
    const warnings: { message: string }[] = [];
    const csv = /\.csv$/i.test(e.path);
    const title = stripId(e.path.split("/").pop() ?? e.path).replace(/_all$/i, "");
    let content = await e.blob.text();
    if (csv) content = `# ${title}\n\n${csvToMarkdown(content, warnings)}`;
    // Nested: its folder is named like its parent page (or database).
    const dir = dirname(e.path);
    const parentPath = dir ? [`${dir}.md`, `${dir}.csv`, `${dir}_all.csv`].find((p) => ids.has(p)) : undefined;
    const links: Record<string, string> = {};
    for (const m of content.matchAll(/\]\(([^)\s]+)\)/g)) {
      const target = resolveHref(e.path, m[1]!);
      const id = target ? (ids.get(target) ?? ids.get(target.replace(/\.csv$/i, "_all.csv"))) : undefined;
      if (id) links[m[1]!] = id;
    }
    const images = new Map<string, ImportImage>();
    if (!csv) {
      for (const src of imageSources(content)) {
        const found = resolveImage(map, e.path, src) ?? (() => {
          try {
            return resolveImage(map, e.path, decodeURIComponent(src));
          } catch {
            return null;
          }
        })();
        const mime = found ? imageMime(found.path) : null;
        if (found && mime) images.set(src, { blob: found.blob, filename: found.path.split("/").pop() ?? "image", mime });
      }
    }
    docs.push({ name: `${title} (${csv ? "database" : "page"})`, path: e.path, filename: `${title}.md`, format: "markdown", content, images, publicId: ids.get(e.path)!, ...(parentPath ? { parentPath } : {}), ...(Object.keys(links).length ? { links } : {}), warnings });
  }
  // Parents first, so a page is nested under one that already exists.
  return docs.sort((a, b) => a.path.split("/").length - b.path.split("/").length);
}

// ---------------------------------------------------------------- Evernote

/** An Evernote export (.enex): its notes, in a folder named after the notebook, with their images. */
export async function evernoteDocs(file: File): Promise<ImportDoc[]> {
  const xml = new DOMParser().parseFromString(await file.text(), "application/xml");
  if (xml.querySelector("parsererror") || !xml.querySelector("en-export")) throw new ImportSourceError("This isn’t an Evernote export (.enex).");
  const folder = file.name.replace(/\.enex$/i, "").trim() || "Evernote";
  const docs: ImportDoc[] = [];
  for (const note of [...xml.getElementsByTagName("note")]) {
    const title = note.getElementsByTagName("title")[0]?.textContent?.trim() || "Untitled";
    const enml = note.getElementsByTagName("content")[0]?.textContent ?? "";
    const warnings: { message: string }[] = [];
    // Its attachments, by the MD5 of their data (how ENML refers to them).
    const resources = new Map<string, { bytes: Uint8Array<ArrayBuffer>; mime: string; name: string }>();
    for (const r of [...note.getElementsByTagName("resource")]) {
      const data = r.getElementsByTagName("data")[0]?.textContent;
      if (!data) continue;
      const bytes = base64ToBytes(data);
      const mime = r.getElementsByTagName("mime")[0]?.textContent?.trim() ?? "application/octet-stream";
      const name = r.getElementsByTagName("file-name")[0]?.textContent?.trim() ?? "";
      resources.set(md5Hex(bytes), { bytes, mime, name });
    }
    const { markdown, images } = htmlToMarkdown(enml.replace(/<\?xml[^>]*>|<!DOCTYPE[^>]*>/gi, ""));
    const map = new Map<string, ImportImage>();
    for (const img of images) {
      const hash = img.src.startsWith("evernote:") ? img.src.slice("evernote:".length) : null;
      const res = hash ? resources.get(hash) : undefined;
      if (!hash) continue;
      if (res && /^image\/(png|jpeg|gif|webp)$/.test(res.mime)) map.set(img.src, { blob: new Blob([res.bytes], { type: res.mime }), filename: res.name || `image.${res.mime.split("/")[1]}`, mime: res.mime });
      else warnings.push({ message: `Attachment ${res?.name ? `“${res.name}” ` : ""}wasn’t imported (only PNG, JPEG, GIF and WebP images come along)` });
    }
    const tags = [...note.getElementsByTagName("tag")].map((t) => t.textContent?.trim()).filter(Boolean);
    if (tags.length) warnings.push({ message: `Tags weren’t imported: ${tags.join(", ")}` });
    docs.push({ name: `${folder} / ${title}`, path: `${folder}/${title}`, filename: `${title}.md`, format: "markdown", content: `# ${title}\n\n${markdown}`, images: map, publicId: ulid(), folderPath: [folder], warnings });
  }
  if (!docs.length) throw new ImportSourceError("There are no notes in this Evernote export.");
  return docs;
}

// ---------------------------------------------------------------- Word, HTML, CSV

/** A Word document's Markdown and images (its PNG, JPEG, GIF and WebP ones; the rest are left out with a warning). */
async function docxContent(arrayBuffer: ArrayBuffer, warnings: { message: string }[]): Promise<{ markdown: string; images: Map<string, ImportImage> }> {
  const mammoth = await import("mammoth");
  const images = new Map<string, ImportImage>();
  let n = 0;
  const result = await mammoth.convertToHtml(
    { arrayBuffer },
    {
      convertImage: mammoth.images.imgElement(async (image) => {
        const src = `docx-image-${++n}`;
        const mime = image.contentType;
        if (/^image\/(png|jpeg|gif|webp)$/.test(mime)) images.set(src, { blob: new Blob([await image.readAsArrayBuffer()], { type: mime }), filename: `image-${n}.${mime.split("/")[1]!.replace("jpeg", "jpg")}`, mime });
        return { src };
      }),
    },
  );
  const { markdown } = htmlToMarkdown(result.value);
  warnings.push(...result.messages.filter((m) => m.type === "warning").slice(0, 10).map((m) => ({ message: m.message })));
  if (n > images.size) warnings.push({ message: `${n - images.size} image${n - images.size === 1 ? "" : "s"} in a format other than PNG, JPEG, GIF or WebP ${n - images.size === 1 ? "was" : "were"} left out` });
  return { markdown, images };
}

/** A Word document (.docx): its text, headings, lists, tables and images. */
export async function docxDoc(file: File): Promise<ImportDoc> {
  const warnings: { message: string }[] = [];
  const { markdown, images } = await docxContent(await file.arrayBuffer(), warnings);
  const title = file.name.replace(/\.docx$/i, "");
  return { name: file.name, path: file.name, filename: `${title}.md`, format: "markdown", content: markdown, images, publicId: ulid(), warnings };
}

/**
 * An HTML page's Markdown (titled by its <title>) with its embedded (data:) images, and the ones `local`
 * finds (a ZIP's other files); any other image that isn't on the web is kept as a link, with a warning.
 */
function htmlContent(html: string, warnings: { message: string }[], local?: (src: string) => ImportImage | null): { content: string; images: Map<string, ImportImage>; title: string | null } {
  const { markdown, images: refs, title } = htmlToMarkdown(html);
  const images = new Map<string, ImportImage>();
  let n = 0;
  let content = markdown;
  for (const ref of refs) {
    if (ref.src.startsWith("data:")) {
      const img = dataUriImage(ref.src, ++n);
      const key = `html-image-${n}`;
      content = content.replace(ref.src, key);
      if (img) images.set(key, img);
    } else if (!/^https?:/i.test(ref.src)) {
      const img = local?.(ref.src);
      if (img) images.set(ref.src, img);
      else warnings.push({ message: `Image “${ref.src}” isn’t in the file and was kept as a link` });
    }
  }
  return { content: title ? `# ${title}\n\n${content}` : content, images, title };
}

/** An HTML file: its readable content, with embedded (data:) images. */
export async function htmlDoc(file: File): Promise<ImportDoc> {
  const warnings: { message: string }[] = [];
  const { content, images, title } = htmlContent(await file.text(), warnings);
  const name = file.name.replace(/\.html?$/i, "");
  return { name: file.name, path: file.name, filename: `${title || name}.md`, format: "markdown", content, images, publicId: ulid(), warnings };
}

/** A CSV file: a note with it as a table. */
export async function csvDoc(file: File): Promise<ImportDoc> {
  const warnings: { message: string }[] = [];
  const title = file.name.replace(/\.csv$/i, "");
  return { name: file.name, path: file.name, filename: `${title}.md`, format: "markdown", content: `# ${title}\n\n${csvToMarkdown(await file.text(), warnings)}`, images: new Map(), publicId: ulid(), warnings };
}
