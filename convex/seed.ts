import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { addDays, rankSequence, ulid } from "@folevi/editor-schema";
import { createDocument, specsToWireBlocks } from "./lib/create";
import { addView, createCollection } from "./lib/collections";
import { nextSeq } from "./lib/seq";
import { insertScoped, personalScope } from "./lib/scope";
import { bump } from "./lib/metrics";
import { DEFAULT_WORKSPACE_QUOTA_BYTES } from "./lib/entitlements";
import { seatsChanged } from "./lib/seats";
import { randomFolderColor } from "./lib/folderColors";
import {
  READING_SHELF,
  WELCOME_TITLE,
  atlasBriefBlocks,
  atlasQuestionsBlocks,
  fieldNotesBlocks,
  tripSketchBlocks,
  weeklyResetBlocks,
  welcomeBlocks,
} from "./lib/seedContent";

/** Creates a team workspace owned by `owner` (Personal is not a workspace: it needs no row). */
export async function createWorkspace(ctx: MutationCtx, owner: Doc<"profiles">, name: string): Promise<Id<"workspaces">> {
  const now = Date.now();
  const workspaceId = await ctx.db.insert("workspaces", {
    publicId: ulid(),
    name,
    ownerId: owner._id,
    changeSeq: 0,
    status: "active",
    storageUsedBytes: 0,
    storageQuotaBytes: DEFAULT_WORKSPACE_QUOTA_BYTES,
    // Plans don't limit members; this is only an abuse cap that an admin can raise per workspace.
    memberLimit: 1000,
    documentCount: 0,
    createdAt: now,
    updatedAt: now,
  });
  await ctx.db.insert("workspaceMembers", { workspaceId, profileId: owner._id, role: "owner", joinedAt: now });
  await seatsChanged(ctx, workspaceId);
  await bump(ctx, "workspaces_total");
  return workspaceId;
}

/**
 * Seeds a new person's Personal with folders, tags and example documents (straight into their Personal:
 * no workspace is created). Only `users.bootstrap` calls this, once per profile. `today` is the person's
 * local date.
 */
export async function seedPersonal(ctx: MutationCtx, owner: Doc<"profiles">, today: string): Promise<void> {
  const scope = personalScope(owner._id);
  const now = Date.now();

  const folderRanks = rankSequence(2);
  const projects = await insertScoped(ctx, "folders", scope, {
    publicId: ulid(),
    name: "Projects",
    // Folders show a colour, never an emoji.
    color: randomFolderColor(),
    rank: folderRanks[0]!,
    createdBy: owner._id,
    createdAt: now,
    updatedAt: now,
    seq: await nextSeq(ctx, scope),
  });
  const personal = await insertScoped(ctx, "folders", scope, {
    publicId: ulid(),
    name: "Personal",
    color: randomFolderColor(),
    rank: folderRanks[1]!,
    createdBy: owner._id,
    createdAt: now,
    updatedAt: now,
    seq: await nextSeq(ctx, scope),
  });

  const tagSeq = await nextSeq(ctx, scope);
  const travel = await insertScoped(ctx, "tags", scope, { publicId: ulid(), name: "travel", normalizedName: "travel", color: "coral", createdAt: now, seq: tagSeq });
  const reading = await insertScoped(ctx, "tags", scope, { publicId: ulid(), name: "reading", normalizedName: "reading", color: "plum", createdAt: now, seq: tagSeq });

  await createDocument(ctx, {
    scope,
    actor: owner,
    title: "Field Notes: A Quiet Morning",
    icon: "☕️",
    folderId: personal,
    style: { font: "serif", width: "wide", background: "paper", accent: "moss", card: "folio" },
    blocks: specsToWireBlocks(fieldNotesBlocks()),
  });

  const atlas = await createDocument(ctx, {
    scope,
    actor: owner,
    title: "Project Atlas Brief",
    icon: "🧭",
    folderId: projects,
    style: { font: "sans", width: "wide", background: "paper", accent: "accent", card: "folio" },
    blocks: specsToWireBlocks(atlasBriefBlocks(today)),
  });
  const questions = await createDocument(ctx, {
    scope,
    actor: owner,
    title: "Atlas: Open Questions",
    icon: "❓",
    parentDocumentId: atlas._id,
    blocks: specsToWireBlocks(atlasQuestionsBlocks()),
  });
  // Page card for the nested page at the end of the brief.
  const atlasBlocks = await ctx.db
    .query("blocks")
    .withIndex("by_document", (q) => q.eq("documentId", atlas._id))
    .collect();
  const lastRootRank = atlasBlocks.filter((b) => b.parentId === null).map((b) => b.rank).sort().pop() ?? "V";
  await insertScoped(ctx, "blocks", scope, {
    blockId: ulid(),
    documentId: atlas._id,
    parentId: null,
    rank: `${lastRootRank}V`,
    type: "page",
    schemaVersion: 1,
    text: [],
    props: { documentId: questions.publicId, display: "card", titleCache: questions.title, iconCache: questions.icon },
    revision: 1,
    contentRev: 1,
    positionRev: 1,
    seq: atlas.seq,
    createdAt: now,
    updatedAt: now,
    updatedBy: owner._id,
  });

  const trip = await createDocument(ctx, {
    scope,
    actor: owner,
    title: "Trip Sketch: Coastal Weekend",
    icon: "⛴",
    folderId: personal,
    style: { font: "sans", width: "wide", background: "paper", accent: "coral", card: "tinted" },
    blocks: specsToWireBlocks(tripSketchBlocks(today)),
  });
  await insertScoped(ctx, "documentTags", scope, { documentId: trip._id, tagId: travel });

  // Reading Shelf: a document hosting a collection with table/board/gallery views.
  const shelf = await createDocument(ctx, {
    scope,
    actor: owner,
    title: READING_SHELF.title,
    icon: "📚",
    folderId: personal,
    style: { font: "serif", width: "wide", background: "paper", accent: "plum", card: "folio" },
    blocks: specsToWireBlocks([{ type: "paragraph", md: READING_SHELF.intro }]),
  });
  await insertScoped(ctx, "documentTags", scope, { documentId: shelf._id, tagId: reading });
  const coll = await createCollection(ctx, {
    scope,
    documentId: shelf._id,
    name: "Books",
    seq: shelf.seq,
    properties: READING_SHELF.properties,
  });
  const viewRanks = rankSequence(3);
  const allProps = READING_SHELF.properties.map((p) => coll.propertyPublicIds.get(p.key)!);
  const tableView = await addView(ctx, coll.collectionId, { name: "Table", type: "table", visibleProperties: allProps, rank: viewRanks[0]! });
  await addView(ctx, coll.collectionId, {
    name: "By status",
    type: "board",
    groupBy: coll.propertyPublicIds.get("status"),
    visibleProperties: [coll.propertyPublicIds.get("author")!, coll.propertyPublicIds.get("rating")!],
    rank: viewRanks[1]!,
  });
  await addView(ctx, coll.collectionId, {
    name: "Gallery",
    type: "gallery",
    visibleProperties: [coll.propertyPublicIds.get("author")!, coll.propertyPublicIds.get("status")!],
    rank: viewRanks[2]!,
  });
  const rowRanks = rankSequence(READING_SHELF.rows.length);
  for (const [i, row] of READING_SHELF.rows.entries()) {
    const rowDoc = await createDocument(ctx, {
      scope,
      actor: owner,
      title: row.title,
      icon: "📖",
      kind: "collectionRow",
      parentDocumentId: shelf._id,
      collectionId: coll.collectionId,
      blocks: specsToWireBlocks([{ type: "paragraph", md: `Notes on _${row.title}_ by ${row.author}.` }]),
    });
    const rowId = await ctx.db.insert("collectionRows", {
      publicId: ulid(),
      collectionId: coll.collectionId,
      documentId: rowDoc._id,
      rank: rowRanks[i]!,
      createdAt: now,
      updatedAt: now,
    });
    const values: [string, unknown][] = [
      ["author", row.author],
      ["status", row.status],
      ["rating", "rating" in row ? row.rating : undefined],
      ["started", "started" in row && row.started !== undefined ? addDays(today, row.started) : undefined],
      ["format", row.format],
      ["link", "link" in row ? row.link : undefined],
    ];
    for (const [key, value] of values) {
      if (value === undefined) continue;
      await ctx.db.insert("collectionValues", {
        rowId,
        propertyId: coll.propertyIds.get(key)!,
        collectionId: coll.collectionId,
        value,
        updatedAt: now,
      });
    }
  }
  const shelfBlocks = await ctx.db
    .query("blocks")
    .withIndex("by_document", (q) => q.eq("documentId", shelf._id))
    .collect();
  await insertScoped(ctx, "blocks", scope, {
    blockId: ulid(),
    documentId: shelf._id,
    parentId: null,
    rank: `${shelfBlocks[0]?.rank ?? "V"}V`,
    type: "collection",
    schemaVersion: 1,
    text: [],
    props: { collectionId: coll.publicId, viewId: tableView },
    revision: 1,
    contentRev: 1,
    positionRev: 1,
    seq: shelf.seq,
    createdAt: now,
    updatedAt: now,
    updatedBy: owner._id,
  });

  await createDocument(ctx, {
    scope,
    actor: owner,
    title: "Weekly Reset",
    icon: "🔁",
    kind: "template",
    style: { font: "sans", width: "wide", background: "paper", accent: "marigold", card: "folio" },
    blocks: specsToWireBlocks(weeklyResetBlocks()),
  });

  // Created last so it sorts first by recency.
  await createDocument(ctx, {
    scope,
    actor: owner,
    title: WELCOME_TITLE,
    icon: "🌿",
    style: { font: "serif", width: "wide", background: "paper", accent: "accent", card: "folio" },
    blocks: specsToWireBlocks(welcomeBlocks(today)),
  });
}
