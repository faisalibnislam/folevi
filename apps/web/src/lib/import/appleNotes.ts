// Apple Notes, in Folevi for Mac only: the app reads the notes through Notes' scripting interface (with the
// person's one-time permission; apps/native-kit/Sources/FoleviMac/Model/AppleNotesReader.swift) and hands
// them here as HTML, a batch at a time. Each note becomes a page in a folder named like its Notes folder (the
// account first when there's more than one), with the images its body shows; what Notes can't hand over (other
// attachments, password-locked notes) is counted and reported. The pages go through the same importer as every
// other source (run.ts, importDocs).
import type { WireScope } from "@folevi/editor-schema";
import { ulid } from "@folevi/editor-schema";
import { htmlToMarkdown } from "./htmlToMarkdown";
import { dataUriImage, type ImportDoc, type ImportImage } from "./sources";
import { importDocs, type ImportResult } from "./run";

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
  /** The names of its attachments; Notes lists the images in the body here too. */
  attachments?: string[];
}

/** A note the Mac has found but not read yet (Notes' scan: everything but the body). */
export type AppleNoteRef = Omit<AppleNote, "html" | "attachments">;

/** What foleviDesktop.appleNotes answers (lib/desktop.ts). */
export interface AppleNotesBridge {
  access(ask: boolean): Promise<AppleNotesAccess>;
  scan(): Promise<{ notes: AppleNoteRef[]; locked: number }>;
  read(ids: string[]): Promise<{ id: string; html: string; attachments: string[] }[]>;
}
export type AppleNotesAccess = "granted" | "denied" | "not-determined" | "unavailable";

const norm = (s: string) => s.replace(/\s+/g, " ").trim().normalize("NFC");

/** The note's body without its first line when that line is the title (Notes names a note by its first line). */
export function withoutTitleLine(html: string, title: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const first = [...doc.body.children].find((el) => norm(el.textContent ?? "") !== "" || el.querySelector("img"));
  if (first && !first.querySelector("img") && norm(first.textContent ?? "") === norm(title)) first.remove();
  return doc.body.innerHTML;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** One note as a page: its title as the page's heading, its body as Markdown, its images uploaded with it. */
export function appleNoteDoc(note: AppleNote): ImportDoc {
  const title = norm(note.title).slice(0, 200) || "Untitled";
  const warnings: { message: string }[] = [];
  const { markdown, images: refs } = htmlToMarkdown(withoutTitleLine(note.html, title));
  const images = new Map<string, ImportImage>();
  let content = markdown;
  let n = 0;
  let unsupported = 0;
  for (const ref of refs) {
    if (!ref.src.startsWith("data:")) continue;
    const img = dataUriImage(ref.src, ++n);
    const md = `![${ref.alt}](${ref.src})`;
    if (img) {
      const key = `apple-notes-image-${n}`;
      content = content.replace(md, `![${ref.alt}](${key})`);
      images.set(key, img);
    } else {
      content = content.replace(md, "");
      unsupported++;
    }
  }
  if (unsupported) warnings.push({ message: `${plural(unsupported, "image")} in a format other than PNG, JPEG, GIF or WebP ${unsupported === 1 ? "was" : "were"} left out` });
  // Notes lists every attachment, the body's images included: the rest (files, scans, drawings, links,
  // audio) aren't in the body it hands over.
  const attachments = note.attachments ?? [];
  const others = attachments.length - n;
  if (others > 0) {
    const names = attachments.filter(Boolean).slice(0, 5).join(", ");
    warnings.push({ message: `${plural(others, "attachment")} (files, scans, drawings, audio or links) ${others === 1 ? "isn’t" : "aren’t"} imported: Notes doesn’t hand ${others === 1 ? "it" : "them"} over${names ? `. Its attachments: ${names}${attachments.length > 5 ? "…" : ""}` : ""}` });
  }
  const folderPath = note.folder.map((f) => f.replace(/[\u0000-\u001F\u007F]/g, "").trim().slice(0, 80)).filter(Boolean).slice(0, 8);
  const body = content.replace(/\n{3,}/g, "\n\n").trim();
  return {
    name: [...folderPath, title].join(" / "),
    path: `apple-notes/${note.id}`,
    filename: `${title}.md`,
    format: "markdown",
    content: body ? `# ${title}\n\n${body}` : `# ${title}`,
    images,
    publicId: ulid(),
    ...(folderPath.length ? { folderPath } : {}),
    warnings,
  };
}

export const appleNotesDocs = (notes: AppleNote[]): ImportDoc[] => notes.map(appleNoteDoc);

/** Notes read per bridge call: a few at a time, so a library of thousands moves along with steady progress. */
export const APPLE_NOTES_BATCH = 20;

type Client = Parameters<typeof importDocs>[0];
type Options = Omit<Parameters<typeof importDocs>[3], "out" | "offset" | "total">;

/**
 * The web section's Apple Notes import (in the Mac app): finds every note, then reads and imports them a batch
 * at a time until done or `signal` stops it. Locked notes are skipped and counted.
 */
export async function importAppleNotes(client: Client, scope: WireScope, bridge: AppleNotesBridge, o: Options): Promise<{ results: ImportResult[]; locked: number; total: number; cancelled: boolean }> {
  const out: ImportResult[] = [];
  o.onProgress?.("Finding your notes in Apple Notes…");
  const { notes, locked } = await bridge.scan();
  for (let i = 0; i < notes.length && !o.signal?.aborted; i += APPLE_NOTES_BATCH) {
    const refs = notes.slice(i, i + APPLE_NOTES_BATCH);
    o.onProgress?.(`Reading notes ${i + 1} to ${i + refs.length} of ${notes.length}…`);
    const bodies = new Map((await bridge.read(refs.map((r) => r.id))).map((b) => [b.id, b]));
    const batch: AppleNote[] = [];
    for (const r of refs) {
      const b = bodies.get(r.id);
      if (b) batch.push({ ...r, html: b.html, attachments: b.attachments });
      else out.push({ name: [...r.folder, r.title].join(" / "), warnings: [], error: "Notes didn’t hand this note over (it may have been deleted or locked meanwhile)." });
    }
    if (o.signal?.aborted) break;
    await importDocs(client, scope, appleNotesDocs(batch), { ...o, out, offset: i, total: notes.length });
  }
  return { results: out, locked, total: notes.length, cancelled: o.signal?.aborted === true };
}

/** The line that sums an Apple Notes import up. */
export function appleNotesSummary(r: { results: ImportResult[]; locked: number; total: number; cancelled: boolean }): string {
  const ok = r.results.filter((x) => x.id).length;
  const parts = [r.cancelled ? `Stopped: imported ${ok} of ${plural(r.total, "note")}` : `Imported ${ok} of ${plural(r.total, "note")} from Apple Notes`];
  if (r.locked) parts.push(`${plural(r.locked, "locked note")} skipped (unlock ${r.locked === 1 ? "it" : "them"} in Notes to import)`);
  return parts.join("; ");
}
