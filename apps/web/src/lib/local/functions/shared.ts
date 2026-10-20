// Helpers the local handlers share: the profile, the one scope (Personal), page summaries as the server
// shapes them (convex/lib/documents.ts toSummary and documents.ts withExtras), live blocks, derived text.
import {
  DEFAULT_COVER,
  DEFAULT_DOCUMENT_STYLE,
  deriveDocumentText,
  newDocumentRank,
  randomNoteEmoji,
  sanitizeTitle,
  ulid,
  validateWireBlock,
  type WireBlock,
  type WireScope,
} from "@folevi/editor-schema";
import type { FunctionReturnType } from "convex/server";
import type { DocumentSummary } from "@convex/lib/documents";
import type { api } from "@/lib/convex/api";
import { fail } from "../errors";
import type { LocalMutationCtx, LocalQueryCtx, LocalReader, LocalWriter } from "../registry";
import type { LocalBlock, LocalDocument, LocalFolder } from "../store";

/** The library's profile, in exactly the shape users.me returns it. */
export type LocalProfile = Extract<FunctionReturnType<typeof api.users.me>, { state: "ready" }>["profile"];

export const PROFILE_KEY = "profile";

export async function getProfile(db: LocalReader): Promise<LocalProfile | null> {
  return ((await db.get("meta", PROFILE_KEY)) as LocalProfile | undefined) ?? null;
}

/** The profile, or the error the server gives a caller without one. */
export async function requireProfile(ctx: LocalQueryCtx | LocalMutationCtx): Promise<LocalProfile> {
  const p = await getProfile(ctx.db);
  if (!p) fail("profile_missing", "Set up this library first.");
  return p;
}

/** A local library has one place, Personal. A workspace scope names nothing here. */
export function checkScope(scope: WireScope | null | undefined): void {
  if (scope && scope.kind !== "personal") fail("not_found", "Workspace not found.");
}

export function toWireBlock(row: LocalBlock): WireBlock {
  return { id: row.id, type: row.type, parentId: row.parentId, rank: row.rank, schemaVersion: row.schemaVersion, text: row.text, props: row.props, revision: row.revision };
}

/** A note's blocks that aren't deleted. */
export async function liveBlocks(db: LocalReader, documentId: string): Promise<LocalBlock[]> {
  return (await db.list("blocks", documentId)).filter((b) => b.deletedAt === null);
}

export function toSummary(doc: LocalDocument, profileId: string): DocumentSummary {
  return {
    id: doc.id,
    workspaceId: null,
    ownerProfileId: profileId,
    parentDocumentId: doc.parentDocumentId,
    folderId: doc.folderId,
    kind: doc.kind,
    title: doc.title,
    icon: doc.icon,
    cover: doc.cover,
    style: doc.style,
    dailyDate: doc.dailyDate,
    accessMode: "workspace",
    rank: doc.rank,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    createdBy: profileId,
    archivedAt: doc.archivedAt,
    deletedAt: doc.deletedAt,
    revision: doc.revision,
    titleRev: doc.titleRev,
    seq: doc.seq,
    excerpt: doc.excerpt,
    preview: doc.preview,
    wordCount: doc.wordCount,
    charCount: doc.charCount,
    blockCount: doc.blockCount,
  };
}

export interface HomeFolder {
  id: string;
  name: string;
  color: string | null;
}

/** Each note's home folder: its own, or its nearest ancestor note's (convex/lib/documents.ts HomeFolders). */
export class HomeFolders {
  private folders: Map<string, LocalFolder> | null = null;
  private byDoc = new Map<string, HomeFolder | null>();
  constructor(private db: LocalReader) {}

  private async folder(id: string): Promise<HomeFolder | null> {
    this.folders ??= new Map((await this.db.list("folders")).map((f) => [f.id, f]));
    const f = this.folders.get(id);
    return f && f.deletedAt === null ? { id: f.id, name: f.name, color: f.color } : null;
  }

  async of(doc: LocalDocument): Promise<HomeFolder | null> {
    const chain: string[] = [];
    let cur: LocalDocument | undefined = doc;
    let found: HomeFolder | null = null;
    for (let depth = 0; cur && depth < 12; depth++) {
      if (this.byDoc.has(cur.id)) {
        found = this.byDoc.get(cur.id) ?? null;
        break;
      }
      chain.push(cur.id);
      if (cur.folderId) {
        found = await this.folder(cur.folderId);
        break;
      }
      cur = cur.parentDocumentId ? await this.db.get("documents", cur.parentDocumentId) : undefined;
    }
    for (const id of chain) this.byDoc.set(id, found);
    return found;
  }
}

export type DocumentWithExtras = DocumentSummary & { starred: boolean; tags: { id: string; name: string; color: string }[]; homeFolder: HomeFolder | null };

/** The summary with the note's star, tags and home folder (documents.ts withExtras). */
export async function withExtras(db: LocalReader, profileId: string, docs: LocalDocument[]): Promise<DocumentWithExtras[]> {
  const homes = new HomeFolders(db);
  const tags = docs.some((d) => d.tagIds.length) ? new Map((await db.list("tags")).map((t) => [t.id, t])) : new Map();
  const out: DocumentWithExtras[] = [];
  for (const d of docs) {
    const docTags = d.tagIds.flatMap((id) => {
      const t = tags.get(id);
      return t ? [{ id: t.id, name: t.name, color: t.color }] : [];
    });
    out.push({ ...toSummary(d, profileId), starred: d.starred, tags: docTags, homeFolder: await homes.of(d) });
  }
  return out;
}

/** Recomputes a note's search text, counts, excerpt and preview from its live blocks (lib/documents.ts refreshDerived). */
export async function refreshDerived(db: LocalWriter, doc: LocalDocument): Promise<LocalDocument> {
  const own = (await liveBlocks(db, doc.id)).map(toWireBlock);
  const derived = deriveDocumentText(doc.title, own, { synced: doc.kind === "synced" });
  return {
    ...doc,
    searchText: derived.searchText,
    wordCount: derived.wordCount,
    charCount: derived.charCount,
    blockCount: own.length,
    excerpt: derived.excerpt,
    preview: derived.preview,
  };
}

const LAST_RANK_KEY = "lastDocumentRank";
const ORDINAL_KEY = "documentOrdinal";

/** The rank of the note made last (lib/documents.ts lastRootRank): a new note goes after it. */
export async function lastRootRank(db: LocalReader): Promise<string | null> {
  const kept = (await db.get("meta", LAST_RANK_KEY)) as string | undefined;
  if (kept !== undefined) return kept;
  let latest: LocalDocument | null = null;
  for (const d of await db.list("documents")) if (!latest || d.createdAt > latest.createdAt || (d.createdAt === latest.createdAt && d.ordinal > latest.ordinal)) latest = d;
  return latest?.rank ?? null;
}

export interface NewDocument {
  id?: string;
  title: string;
  icon?: string | null;
  kind?: LocalDocument["kind"];
  parentDocumentId?: string | null;
  folderId?: string | null;
  style?: LocalDocument["style"];
  cover?: LocalDocument["cover"];
  dailyDate?: string | null;
  templateKey?: string | null;
  collectionId?: string | null;
  tagIds?: string[];
  blocks?: WireBlock[];
}

/**
 * Makes a note and its blocks (convex/lib/create.ts createDocument): validated blocks, the next rank, an
 * icon for a plain note, derived text from the start. `seq` is the mutation's change counter.
 */
export async function insertDocument(ctx: LocalMutationCtx, input: NewDocument): Promise<LocalDocument> {
  const now = ctx.now();
  const seq = await ctx.nextSeq();
  const id = input.id ?? ulid();
  if (await ctx.db.get("documents", id)) fail("conflict", "Document already exists.");
  const blocks = input.blocks ?? [];
  for (const b of blocks) {
    const issues = validateWireBlock(b);
    if (issues.length) fail("invalid_block", `${issues[0]!.path}: ${issues[0]!.message}`);
  }
  const kind = input.kind ?? "document";
  const title = sanitizeTitle(input.title);
  const rank = newDocumentRank(await lastRootRank(ctx.db));
  ctx.db.put("meta", LAST_RANK_KEY, rank);
  const ordinal = (((await ctx.db.get("meta", ORDINAL_KEY)) as number | undefined) ?? 0) + 1;
  ctx.db.put("meta", ORDINAL_KEY, ordinal);
  const doc: LocalDocument = {
    id,
    parentDocumentId: input.parentDocumentId ?? null,
    folderId: input.folderId ?? null,
    kind,
    title,
    // Every note has an icon (templates and collection rows keep whatever they were given).
    icon: input.icon ?? (kind === "document" ? randomNoteEmoji() : null),
    cover: input.cover ?? DEFAULT_COVER,
    style: input.style ?? DEFAULT_DOCUMENT_STYLE,
    dailyDate: input.dailyDate ?? null,
    templateKey: input.templateKey ?? null,
    collectionId: input.collectionId ?? null,
    rank,
    createdAt: now,
    ordinal,
    updatedAt: now,
    archivedAt: null,
    deletedAt: null,
    inTrash: false,
    revision: 1,
    titleRev: 1,
    seq,
    contentSeq: blocks.length ? 1 : 0,
    searchText: title,
    wordCount: 0,
    charCount: 0,
    blockCount: 0,
    excerpt: "",
    preview: null,
    starred: false,
    tagIds: input.tagIds ?? [],
  };
  for (const b of blocks) {
    const { revision: _revision, ...rest } = b;
    void _revision;
    ctx.db.put("blocks", b.id, { ...rest, documentId: id, revision: 1, contentRev: 1, positionRev: 1, seq, deletedAt: null, createdAt: now, updatedAt: now }, id);
  }
  const derived = await refreshDerived(ctx.db, doc);
  ctx.db.put("documents", id, derived);
  return derived;
}
