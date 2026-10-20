// Moving notes between a library on the person's devices and their Folevi account (docs/LOCAL_MODE_PLAN.md §6,
// WP12). Both directions are one copy (copy.ts) from a `MigrationSource` into a `MigrationTarget`, each of which
// talks to a backend through the same public functions (the Convex client, or a LocalClient over a library):
// uploadLibrary.ts goes up (a library into an account), exportToLocal.ts comes down (an account into a library).
import type { FunctionReturnType } from "convex/server";
import type { WireBlock, WireDocumentCreate, WireDocumentPatch } from "@folevi/editor-schema";
import type { api } from "@/lib/convex/api";
import type { FoleviClient } from "@/lib/convex/client";

/** What the copy needs of a backend client: Convex's, or a LocalClient (both are what `useConvex()` gives). */
export type MigrationClient = FoleviClient;

/** A note as migration.documents lists it (the server's shape; local mode answers the same). */
export type SourceNote = FunctionReturnType<typeof api.migration.documents>["page"][number];

export interface SourceFolder {
  id: string;
  name: string;
  color: string | null;
  parentFolderId: string | null;
  rank: string;
}

export interface SourceTag {
  id: string;
  name: string;
  color: string;
}

/** A collection as collections.get gives it, with what the copy needs. */
export interface SourceCollection {
  id: string;
  name: string;
  hostDocumentId: string;
  properties: { id: string; name: string; type: string; options: { id: string; name: string; color: string }[]; formula: string | null; numberFormat: unknown }[];
  views: { id: string; name: string; type: string; config: unknown }[];
  rows: { id: string; documentId: string; rank: string; values: Record<string, unknown> }[];
}

/** An attachment's bytes and what's known about them. */
export interface SourceFile {
  id: string;
  name: string;
  mimeType: string;
  /** What it is to the note: an image, a file, a recording, or the note's theme image. */
  kind: "image" | "file" | "audio" | "cover";
  size: number;
  /** The bytes' SHA-256 (hex), when the source knows it. */
  sha256: string | null;
  blob: Blob;
}

export type SourceFileText = FunctionReturnType<typeof api.migration.fileTexts>[number];

export interface SourceVersion {
  id: string;
  name: string | null;
  title: string;
  icon: string | null;
  style?: SourceNote["style"];
  blocks: WireBlock[];
  createdAt: number;
}

/** Where notes come from. */
export interface MigrationSource {
  /** The person's profile id there (mentions and assignees name it). */
  profileId(): Promise<string>;
  organization(): Promise<{ folders: SourceFolder[]; tags: SourceTag[] }>;
  /** Every note: Archive, Trash, nested pages, templates, rows and synced content too. */
  notes(): Promise<SourceNote[]>;
  /** A note's live blocks. */
  blocks(documentId: string): Promise<WireBlock[]>;
  collection(collectionId: string): Promise<SourceCollection | null>;
  /** An attachment of the note (null when it's gone or can't be read). */
  file(fileId: string, documentId: string, kind: SourceFile["kind"]): Promise<SourceFile | null>;
  fileTexts(documentId: string): Promise<SourceFileText[]>;
  /** A note's saved versions, oldest first. */
  versions(documentId: string): Promise<SourceVersion[]>;
}

/** Where notes go. Every call may be sent again after a stop: each one is idempotent. */
export interface MigrationTarget {
  profileId(): Promise<string>;
  /** The person's Inbox there (made when needed), and the rank after its last line. */
  inbox(): Promise<{ documentId: string; lastRank: string | null }>;
  createFolder(folder: { id: string; name: string; parentFolderId: string | null; color: string | null }): Promise<void>;
  /** The tag with this name (made when needed), as its id there. */
  ensureTag(tag: { name: string; color: string }): Promise<string>;
  /** "exists": a Daily Note for that date is already there (the caller makes it an ordinary page). */
  createDocument(doc: WireDocumentCreate): Promise<"created" | "exists">;
  updateDocument(documentId: string, patch: WireDocumentPatch): Promise<void>;
  /** Adds the blocks (parents first). Says which the backend refused, and why. */
  putBlocks(documentId: string, blocks: WireBlock[]): Promise<{ refused: { blockId: string; message: string }[] }>;
  setStarred(documentId: string, starred: boolean): Promise<void>;
  setArchived(documentId: string, archived: boolean): Promise<void>;
  setTags(documentId: string, tagIds: string[]): Promise<void>;
  moveToTrash(documentId: string): Promise<void>;
  /** The collection with its own id, its properties and views as the source has them (rows come with `addRow`). */
  putCollection(collection: SourceCollection): Promise<void>;
  /** A row and its note (the note's id is the source's). */
  addRow(collectionId: string, row: { id: string; documentId: string; title: string; values: Record<string, unknown> }): Promise<void>;
  /** Stores an attachment for the note; its id there. */
  putFile(file: SourceFile, documentId: string): Promise<string>;
  saveFileText(documentId: string, text: SourceFileText): Promise<void>;
  importVersion(documentId: string, version: SourceVersion): Promise<void>;
}

/** Why an attachment didn't come along. */
export type FileProblem = "space" | "size" | "missing" | "refused";

/** What a copy has done so far, kept between runs (progress.ts), so a stopped copy goes on where it was. */
export interface MigrationState {
  v: 1;
  direction: "upload" | "export";
  startedAt: number;
  /** The person's profile ids on each side (checked on resume: another account is another move). */
  sourceProfileId: string;
  targetProfileId: string;
  /** The Inbox there, and the rank its first line of the source's Inbox follows (fixed at the first run). */
  inbox: { documentId: string; base: string | null } | null;
  folders: Record<string, true>;
  /** Source tag id → its id there. */
  tags: Record<string, string>;
  /** Source file id → its id there, or why it didn't come. */
  files: Record<string, string | { problem: FileProblem; name: string }>;
  collections: Record<string, true>;
  /** migration.done[docId] (plan §6.1): notes copied whole. */
  notes: Record<string, "done">;
  /** Daily Notes that became ordinary pages there (a Daily Note for the date was already there). */
  dailyAsPage: Record<string, true>;
  versions: Record<string, true>;
  trashed: Record<string, true>;
  /** What didn't come along, for the person to read at the end. */
  problems: MigrationProblem[];
  finishedAt: number | null;
}

export interface MigrationProblem {
  kind: "file" | "block" | "fileText" | "version" | "note";
  documentId: string;
  title: string;
  detail: string;
  /** The file's name, for "file". */
  name?: string;
  problem?: FileProblem;
}

/** Kept between runs: in the library's replica on this device (progress.ts). */
export interface ProgressStore {
  load(): Promise<MigrationState | null>;
  save(state: MigrationState): Promise<void>;
}

export interface MigrationProgress {
  phase: "organizing" | "notes" | "trash" | "done";
  notesDone: number;
  notesTotal: number;
  filesDone: number;
  /** The note being copied now. */
  current: string | null;
  /** Set while waiting for the server's rate limit: when it lets the copy go on. */
  waitingUntil: number | null;
}
