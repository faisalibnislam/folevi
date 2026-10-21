// References to the e2ee server functions the data side calls (docs/E2EE_DESIGN.md §5.3, WP2 and WP3), by
// name, with the argument and result shapes the design gives. Named references keep the router compiling
// whichever of them has landed; tests/e2ee/route-coverage.test.ts checks each name against convex/e2ee/*.
import { makeFunctionReference } from "convex/server";
import type { WireScope } from "@folevi/editor-schema";
import type { Level, PulledNoteKey, Switches } from "./deps";

type Bytes = ArrayBuffer;
type SealedField = { c: Bytes; k: number };

// ---- e2ee.spaces (WP2) ------------------------------------------------------------------------------------

export interface MineSpaceRow {
  scope: WireScope;
  scopeId: string;
  level: Level;
  state: "off" | "enabling" | "on" | "disabling";
  switches: Switches;
  currentKeyVersion: number;
  lockedCount: number;
  seq: number;
}

export const spacesMine = makeFunctionReference<"query", Record<string, never>, MineSpaceRow[]>("e2ee/spaces:mine");
export const keysStatus = makeFunctionReference<"query", Record<string, never>, { setUp: boolean }>("e2ee/keys:status");

// ---- e2ee.pull (WP3) --------------------------------------------------------------------------------------

/** A file of a pulled note: its metadata sealed with its file key, the file key wrapped by the note key. */
export interface PulledFile {
  id: string;
  kind: string;
  size: number;
  status?: string;
  createdAt: number;
  sealed?: { key: Bytes; meta: Bytes; k: number; plainSize: number };
  /** A file not sealed yet (a migration in progress). */
  plain?: { filename: string; mimeType: string; width: number | null; height: number | null; palette?: unknown };
}

export interface PulledDocument {
  id: string;
  kind: string;
  parentDocumentId: string | null;
  folderId: string | null;
  rank: string;
  dailyDate: string | null;
  accessMode?: string;
  createdAt: number;
  updatedAt: number;
  archivedAt: number | null;
  inTrash: boolean;
  deletedAt: number | null;
  revision: number;
  titleRev: number;
  seq: number;
  contentSeq: number;
  createdBy?: string;
  lastEditedBy?: string | null;
  locked?: boolean;
  lockedVia?: string | null;
  tagIds: string[];
  fileIds?: string[];
  /** Deleted for good: the replica drops it (sent once WP3 keeps tombstones of purged notes). */
  purged?: boolean;
  sealed?: { title: SealedField & { mac: string }; appearance: SealedField; meta?: SealedField | null };
  /** Only while a migration hasn't reached this note. */
  plain?: { title: string; icon: string | null; cover?: unknown; style?: unknown; templateKey?: string | null; collectionId?: string | null };
  files?: PulledFile[];
}

/** A block of a pulled note: the block as clients receive it (sealed or plain), and whether it was deleted. */
export interface PulledBlock {
  documentId: string;
  block: {
    id: string;
    type: string;
    parentId: string | null;
    rank: string;
    schemaVersion: number;
    text: unknown[];
    props: Record<string, unknown>;
    revision?: number;
    sealed?: { c: Bytes; mac: string; k: number; collapsed?: true; syncedSource?: string; mentions?: string[] };
  };
  deleted: boolean;
}

export interface PulledFolder {
  id: string;
  parentFolderId: string | null;
  rank: string;
  color: string | null;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
  locked?: boolean;
  name?: string;
  sealedName?: SealedField;
  seq: number;
}

export interface PulledTag {
  id: string;
  color: string;
  createdAt: number;
  name?: string;
  normalizedName?: string;
  sealedName?: SealedField;
  nameMac?: string | null;
  deletedAt?: number | null;
  seq: number;
}

export interface PulledRecord {
  kind: "collection" | "fileText" | "studyReview" | "aiChat" | "aiMemory" | "prefs";
  recordId: string;
  documentId: string | null;
  profileId?: string | null;
  keyVersion: number;
  sealed: Bytes;
  rev: number;
  updatedAt: number;
  deletedAt: number | null;
  seq: number;
}

export interface PulledSpace {
  level: Level;
  state: string;
  switches: Switches;
  currentKeyVersion: number;
  inboxDocumentId?: string | null;
  migrationId?: string | null;
  lockedCount: number;
  seq: number;
}

export interface E2eePullPage {
  documents: PulledDocument[];
  blocks: PulledBlock[];
  folders: PulledFolder[];
  tags: PulledTag[];
  records: PulledRecord[];
  noteKeys: PulledNoteKey[];
  space: PulledSpace | null;
  nextCursor: number;
  hasMore: boolean;
  head: number;
}

/** The caller's own marks in the scope (no seq; small; reactive). */
export interface PulledMine {
  stars: { documentId: string; at: number }[];
  recents: { documentId: string; viewedAt: number }[];
  hidden: { documentId: string; hiddenAt: number }[];
}

export const pullHead = makeFunctionReference<"query", { scope: WireScope }, { seq: number }>("e2ee/pull:head");
export const pullPage = makeFunctionReference<"query", { scope: WireScope; cursor: number; limit?: number }, E2eePullPage>("e2ee/pull:pull");
export const pullMine = makeFunctionReference<"query", { scope: WireScope }, PulledMine>("e2ee/pull:mine");

// ---- e2ee.content (WP3) -----------------------------------------------------------------------------------

const mutation = <A extends Record<string, unknown>>(name: string) => makeFunctionReference<"mutation", A, unknown>(name);

export const content = {
  createFolder: mutation<{ scope: WireScope; folderId: string; parentFolderId?: string | null; sealedName: Bytes; color?: string; rank?: string; locked?: boolean }>("e2ee/content:createFolder"),
  renameFolder: mutation<{ folderId: string; sealedName: Bytes }>("e2ee/content:renameFolder"),
  createTag: mutation<{ scope: WireScope; tagId: string; sealedName: Bytes; nameMac: string; color?: string }>("e2ee/content:createTag"),
  updateTag: mutation<{ tagId: string; sealedName?: Bytes; nameMac?: string; color?: string }>("e2ee/content:updateTag"),
  setDocumentTags: mutation<{ documentId: string; tagIds: string[] }>("e2ee/content:setDocumentTags"),
  putRecord: mutation<{ scope: WireScope; kind: PulledRecord["kind"]; recordId: string; documentId?: string; sealed: Bytes; keyVersion: number; baseRev: number }>("e2ee/content:putRecord"),
  deleteRecord: mutation<{ scope: WireScope; kind: PulledRecord["kind"]; recordId: string; documentId?: string; baseRev: number }>("e2ee/content:deleteRecord"),
  createComment: mutation<{ documentId: string; blockId?: string; threadId: string; commentId: string; sealedBody: Bytes; mentions: string[]; preview?: { title: string; excerpt: string } }>("e2ee/content:createComment"),
  replyComment: mutation<{ threadId: string; commentId: string; sealedBody: Bytes; mentions: string[]; preview?: { title: string; excerpt: string } }>("e2ee/content:replyComment"),
  editComment: mutation<{ commentId: string; sealedBody: Bytes; mentions: string[]; preview?: { title: string; excerpt: string } }>("e2ee/content:editComment"),
  nameVersion: mutation<{ snapshotId: string; sealedName: Bytes | null }>("e2ee/content:nameVersion"),
  importVersion: mutation<{ documentId: string; id: string; content: unknown; createdAt: number; sealedName?: Bytes }>("e2ee/content:importVersion"),
  setFolderLocked: mutation<{ folderId: string; locked: boolean }>("e2ee/content:setFolderLocked"),
  setDocumentLocked: mutation<{ documentId: string; locked: boolean }>("e2ee/content:setDocumentLocked"),
  setDocumentRowMeta: mutation<{ documentId: string; sealedMeta: Bytes }>("e2ee/content:setDocumentRowMeta"),
};

// ---- e2ee.files (WP3) -------------------------------------------------------------------------------------

export const files = {
  generateUploadUrl: makeFunctionReference<"mutation", { documentId: string; kind: "image" | "file" | "audio" | "cover"; declaredSize: number }, { uploadUrl: string; intentId: string }>("e2ee/files:generateUploadUrl"),
  commit: makeFunctionReference<
    "action",
    { intentId: string; documentId: string; fileId: string; storageId: string; sealed: { key: Bytes; meta: Bytes; k: number; plainSize: number }; size: number; sha256: string },
    { fileId: string; size: number }
  >("e2ee/files:commit"),
  updateMeta: makeFunctionReference<"mutation", { fileId: string; meta: Bytes }, unknown>("e2ee/files:updateMeta"),
  rewrap: makeFunctionReference<"mutation", { fileId: string; targetDocumentId: string; newFileId: string; key: Bytes; meta: Bytes; k: number }, unknown>("e2ee/files:rewrap"),
};
