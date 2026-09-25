import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { rankBetween, ulid } from "@folevi/editor-schema";
import { accessAtLeast, assertWritable, documentAccess, requireDocument, requireProfile, type Access } from "./lib/auth";
import { fail } from "./lib/errors";
import { addView, createCollection, normalizeValue } from "./lib/collections";
import { createDocument, specsToWireBlocks } from "./lib/create";
import { nextSeq } from "./lib/seq";
import { vCollectionPropertyType, vCollectionViewType } from "./lib/validators";

const OPTION_COLORS = ["accent", "moss", "marigold", "plum", "coral", "muted"];

async function collectionFor(ctx: QueryCtx | MutationCtx, collectionPublicId: string, need: Access) {
  const profile = await requireProfile(ctx);
  const collection = await ctx.db
    .query("collections")
    .withIndex("by_public_id", (q) => q.eq("publicId", collectionPublicId))
    .unique();
  if (!collection || collection.deletedAt) fail("not_found", "Collection not found.");
  const host = (await ctx.db.get(collection.documentId))!;
  const access = await documentAccess(ctx, profile, host);
  if (access === "none") fail("not_found", "Collection not found.");
  if (!accessAtLeast(access, need)) fail("forbidden", "You can't edit this collection.");
  return { profile, collection, host, access };
}

export const get = query({
  args: { collectionId: v.string() },
  handler: async (ctx, args) => {
    const { collection, access, profile } = await collectionFor(ctx, args.collectionId, "read");
    const props = (
      await ctx.db
        .query("collectionProperties")
        .withIndex("by_collection", (q) => q.eq("collectionId", collection._id))
        .collect()
    )
      .filter((p) => !p.deletedAt)
      .sort((a, b) => (a.rank < b.rank ? -1 : 1));
    const propPublic = new Map(props.map((p) => [p._id as string, p.publicId]));
    const views = (
      await ctx.db
        .query("collectionViews")
        .withIndex("by_collection", (q) => q.eq("collectionId", collection._id))
        .collect()
    ).sort((a, b) => (a.rank < b.rank ? -1 : 1));
    const rows = (
      await ctx.db
        .query("collectionRows")
        .withIndex("by_collection", (q) => q.eq("collectionId", collection._id))
        .take(2000)
    )
      .filter((r) => !r.deletedAt)
      .sort((a, b) => (a.rank < b.rank ? -1 : 1));
    const outRows = [];
    for (const r of rows) {
      const doc = await ctx.db.get(r.documentId);
      if (!doc || doc.inTrash) continue;
      if (!accessAtLeast(await documentAccess(ctx, profile, doc), "read")) continue;
      const values = await ctx.db
        .query("collectionValues")
        .withIndex("by_row", (q) => q.eq("rowId", r._id))
        .collect();
      const vals: Record<string, unknown> = {};
      for (const val of values) {
        const pid = propPublic.get(val.propertyId);
        if (pid) vals[pid] = val.value;
      }
      outRows.push({
        id: r.publicId,
        documentId: doc.publicId,
        title: doc.title,
        icon: doc.icon ?? null,
        cover: doc.cover,
        excerpt: doc.excerpt,
        rank: r.rank,
        values: vals,
        updatedAt: doc.updatedAt,
      });
    }
    return {
      id: collection.publicId,
      name: collection.name,
      hostDocumentId: (await ctx.db.get(collection.documentId))!.publicId,
      canEdit: accessAtLeast(access, "write"),
      properties: props.map((p) => ({ id: p.publicId, name: p.name, type: p.type, options: p.options })),
      views: views.map((vw) => ({ id: vw.publicId, name: vw.name, type: vw.type, config: vw.config })),
      rows: outRows,
    };
  },
});

/** Creates a collection hosted by a document. The client then inserts a `collection` block pointing at it. */
export const create = mutation({
  args: { documentId: v.string(), name: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { doc } = await requireDocument(ctx, profile, args.documentId, "write");
    const seq = await nextSeq(ctx, doc.workspaceId);
    const coll = await createCollection(ctx, {
      workspaceId: doc.workspaceId,
      documentId: doc._id,
      name: (args.name ?? "Collection").slice(0, 80),
      seq,
      properties: [
        {
          key: "status",
          name: "Status",
          type: "select",
          options: [
            { id: "todo", name: "Not started", color: "muted" },
            { id: "doing", name: "In progress", color: "marigold" },
            { id: "done", name: "Done", color: "moss" },
          ],
        },
        { key: "date", name: "Date", type: "date" },
      ],
    });
    const vis = [coll.propertyPublicIds.get("status")!, coll.propertyPublicIds.get("date")!];
    const viewId = await addView(ctx, coll.collectionId, { name: "Table", type: "table", visibleProperties: vis, rank: "V" });
    return { collectionId: coll.publicId, viewId };
  },
});

export const rename = mutation({
  args: { collectionId: v.string(), name: v.string() },
  handler: async (ctx, args) => {
    const { profile, collection } = await collectionFor(ctx, args.collectionId, "write");
    await assertWritable(ctx, profile);
    await ctx.db.patch(collection._id, { name: args.name.trim().slice(0, 80) || "Collection", updatedAt: Date.now() });
    return null;
  },
});

export const addProperty = mutation({
  args: { collectionId: v.string(), name: v.string(), type: vCollectionPropertyType },
  handler: async (ctx, args) => {
    const { profile, collection } = await collectionFor(ctx, args.collectionId, "write");
    await assertWritable(ctx, profile);
    const existing = await ctx.db
      .query("collectionProperties")
      .withIndex("by_collection", (q) => q.eq("collectionId", collection._id))
      .collect();
    if (existing.filter((p) => !p.deletedAt).length >= 40) fail("limit_exceeded", "A collection can have up to 40 properties.");
    const last = existing.map((p) => p.rank).sort().pop() ?? null;
    const publicId = ulid();
    await ctx.db.insert("collectionProperties", {
      publicId,
      collectionId: collection._id,
      name: args.name.trim().slice(0, 60) || "Property",
      type: args.type,
      options: [],
      rank: rankBetween(last, null),
      createdAt: Date.now(),
    });
    const views = await ctx.db
      .query("collectionViews")
      .withIndex("by_collection", (q) => q.eq("collectionId", collection._id))
      .collect();
    for (const vw of views) await ctx.db.patch(vw._id, { config: { ...vw.config, visibleProperties: [...vw.config.visibleProperties, publicId] } });
    return { id: publicId };
  },
});

async function propertyFor(ctx: MutationCtx, collection: Doc<"collections">, propertyPublicId: string) {
  const prop = await ctx.db
    .query("collectionProperties")
    .withIndex("by_public_id", (q) => q.eq("publicId", propertyPublicId))
    .unique();
  if (!prop || prop.collectionId !== collection._id || prop.deletedAt) fail("not_found", "Property not found.");
  return prop;
}

export const updateProperty = mutation({
  args: {
    collectionId: v.string(),
    propertyId: v.string(),
    name: v.optional(v.string()),
    options: v.optional(v.array(v.object({ id: v.optional(v.string()), name: v.string(), color: v.optional(v.string()) }))),
  },
  handler: async (ctx, args) => {
    const { profile, collection } = await collectionFor(ctx, args.collectionId, "write");
    await assertWritable(ctx, profile);
    const prop = await propertyFor(ctx, collection, args.propertyId);
    const patch: Partial<Doc<"collectionProperties">> = {};
    if (args.name !== undefined) patch.name = args.name.trim().slice(0, 60) || prop.name;
    if (args.options) {
      if (prop.type !== "select" && prop.type !== "multiSelect") fail("invalid_argument", "Only select properties have options.");
      patch.options = args.options.slice(0, 100).map((o, i) => ({
        id: o.id ?? ulid(),
        name: o.name.trim().slice(0, 60) || "Option",
        color: o.color && OPTION_COLORS.includes(o.color) ? o.color : OPTION_COLORS[i % OPTION_COLORS.length]!,
      }));
    }
    await ctx.db.patch(prop._id, patch);
    return null;
  },
});

export const deleteProperty = mutation({
  args: { collectionId: v.string(), propertyId: v.string() },
  handler: async (ctx, args) => {
    const { profile, collection } = await collectionFor(ctx, args.collectionId, "write");
    await assertWritable(ctx, profile);
    const prop = await propertyFor(ctx, collection, args.propertyId);
    await ctx.db.patch(prop._id, { deletedAt: Date.now() });
    return null;
  },
});

export const addRow = mutation({
  args: { collectionId: v.string(), title: v.optional(v.string()), values: v.optional(v.record(v.string(), v.any())), afterRowId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { profile, collection, host } = await collectionFor(ctx, args.collectionId, "write");
    await assertWritable(ctx, profile);
    const rows = (
      await ctx.db
        .query("collectionRows")
        .withIndex("by_collection", (q) => q.eq("collectionId", collection._id))
        .collect()
    )
      .filter((r) => !r.deletedAt)
      .sort((a, b) => (a.rank < b.rank ? -1 : 1));
    if (rows.length >= 2000) fail("limit_exceeded", "A collection can have up to 2,000 rows.");
    let rank: string;
    if (args.afterRowId) {
      const idx = rows.findIndex((r) => r.publicId === args.afterRowId);
      rank = rankBetween(rows[idx]?.rank ?? null, rows[idx + 1]?.rank ?? null);
    } else rank = rankBetween(rows[rows.length - 1]?.rank ?? null, null);
    const doc = await createDocument(ctx, {
      workspaceId: collection.workspaceId,
      actor: profile,
      title: (args.title ?? "").slice(0, 300),
      kind: "collectionRow",
      parentDocumentId: host._id,
      collectionId: collection._id,
      accessMode: host.accessMode,
      blocks: specsToWireBlocks([{ type: "paragraph", md: "" }]),
    });
    const now = Date.now();
    const publicId = ulid();
    const rowId = await ctx.db.insert("collectionRows", { publicId, collectionId: collection._id, documentId: doc._id, rank, createdAt: now, updatedAt: now });
    for (const [propPublic, value] of Object.entries(args.values ?? {})) {
      const prop = await propertyFor(ctx, collection, propPublic);
      const normalized = normalizeValue(prop, value);
      if (normalized !== null) await ctx.db.insert("collectionValues", { rowId, propertyId: prop._id, collectionId: collection._id, value: normalized, updatedAt: now });
    }
    await ctx.db.patch(collection._id, { updatedAt: now });
    return { id: publicId, documentId: doc.publicId };
  },
});

async function rowFor(ctx: MutationCtx, collection: Doc<"collections">, rowPublicId: string) {
  const row = await ctx.db
    .query("collectionRows")
    .withIndex("by_public_id", (q) => q.eq("publicId", rowPublicId))
    .unique();
  if (!row || row.collectionId !== collection._id || row.deletedAt) fail("not_found", "Row not found.");
  return row;
}

export const setValue = mutation({
  args: { collectionId: v.string(), rowId: v.string(), propertyId: v.string(), value: v.any() },
  handler: async (ctx, args) => {
    const { profile, collection } = await collectionFor(ctx, args.collectionId, "write");
    await assertWritable(ctx, profile);
    const row = await rowFor(ctx, collection, args.rowId);
    const prop = await propertyFor(ctx, collection, args.propertyId);
    const normalized = normalizeValue(prop, args.value);
    const existing = await ctx.db
      .query("collectionValues")
      .withIndex("by_row_property", (q) => q.eq("rowId", row._id).eq("propertyId", prop._id))
      .unique();
    const now = Date.now();
    const before = existing?.value ?? null;
    if (normalized === null) {
      if (existing) await ctx.db.delete(existing._id);
    } else if (existing) await ctx.db.patch(existing._id, { value: normalized, updatedAt: now });
    else await ctx.db.insert("collectionValues", { rowId: row._id, propertyId: prop._id, collectionId: collection._id, value: normalized, updatedAt: now });
    await ctx.db.patch(row._id, { updatedAt: now });
    return { before };
  },
});

export const moveRow = mutation({
  args: {
    collectionId: v.string(),
    rowId: v.string(),
    afterRowId: v.union(v.string(), v.null()),
    groupPropertyId: v.optional(v.string()),
    groupValue: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const { profile, collection } = await collectionFor(ctx, args.collectionId, "write");
    await assertWritable(ctx, profile);
    const row = await rowFor(ctx, collection, args.rowId);
    const rows = (
      await ctx.db
        .query("collectionRows")
        .withIndex("by_collection", (q) => q.eq("collectionId", collection._id))
        .collect()
    )
      .filter((r) => !r.deletedAt && r._id !== row._id)
      .sort((a, b) => (a.rank < b.rank ? -1 : 1));
    const idx = args.afterRowId === null ? -1 : rows.findIndex((r) => r.publicId === args.afterRowId);
    const rank = rankBetween(idx >= 0 ? rows[idx]!.rank : null, rows[idx + 1]?.rank ?? null);
    await ctx.db.patch(row._id, { rank, updatedAt: Date.now() });
    if (args.groupPropertyId !== undefined) {
      const prop = await propertyFor(ctx, collection, args.groupPropertyId);
      const existing = await ctx.db
        .query("collectionValues")
        .withIndex("by_row_property", (q) => q.eq("rowId", row._id).eq("propertyId", prop._id))
        .unique();
      const normalized = normalizeValue(prop, args.groupValue ?? null);
      if (normalized === null) {
        if (existing) await ctx.db.delete(existing._id);
      } else if (existing) await ctx.db.patch(existing._id, { value: normalized, updatedAt: Date.now() });
      else await ctx.db.insert("collectionValues", { rowId: row._id, propertyId: prop._id, collectionId: collection._id, value: normalized, updatedAt: Date.now() });
    }
    return null;
  },
});

export const deleteRow = mutation({
  args: { collectionId: v.string(), rowId: v.string() },
  handler: async (ctx, args) => {
    const { profile, collection } = await collectionFor(ctx, args.collectionId, "write");
    await assertWritable(ctx, profile);
    const row = await rowFor(ctx, collection, args.rowId);
    await ctx.db.patch(row._id, { deletedAt: Date.now() });
    const doc = await ctx.db.get(row.documentId);
    if (doc && !doc.inTrash) {
      await ctx.db.patch(doc._id, { inTrash: true, deletedAt: Date.now(), deletedBy: profile._id, seq: await nextSeq(ctx, doc.workspaceId) });
    }
    return null;
  },
});

const vConfig = v.object({
  filters: v.array(
    v.object({
      propertyId: v.string(),
      op: v.union(v.literal("is"), v.literal("isNot"), v.literal("contains"), v.literal("isEmpty"), v.literal("isNotEmpty"), v.literal("gt"), v.literal("lt"), v.literal("checked"), v.literal("unchecked")),
      value: v.optional(v.any()),
    }),
  ),
  sorts: v.array(v.object({ propertyId: v.string(), direction: v.union(v.literal("asc"), v.literal("desc")) })),
  groupBy: v.optional(v.string()),
  visibleProperties: v.array(v.string()),
  cardPreview: v.union(v.literal("none"), v.literal("cover"), v.literal("content")),
  cardSize: v.union(v.literal("small"), v.literal("medium"), v.literal("large")),
});

export const addViewToCollection = mutation({
  args: { collectionId: v.string(), name: v.string(), type: vCollectionViewType },
  handler: async (ctx, args) => {
    const { profile, collection } = await collectionFor(ctx, args.collectionId, "write");
    await assertWritable(ctx, profile);
    const props = (
      await ctx.db
        .query("collectionProperties")
        .withIndex("by_collection", (q) => q.eq("collectionId", collection._id))
        .collect()
    ).filter((p) => !p.deletedAt);
    const views = await ctx.db
      .query("collectionViews")
      .withIndex("by_collection", (q) => q.eq("collectionId", collection._id))
      .collect();
    if (views.length >= 20) fail("limit_exceeded", "Up to 20 views per collection.");
    const groupBy = args.type === "board" ? props.find((p) => p.type === "select")?.publicId : undefined;
    if (args.type === "board" && !groupBy) fail("invalid_argument", "Add a single-select property to group a board by.");
    const id = await addView(ctx, collection._id, {
      name: args.name.trim().slice(0, 40) || "View",
      type: args.type,
      groupBy,
      visibleProperties: props.map((p) => p.publicId),
      rank: rankBetween(views.map((vw) => vw.rank).sort().pop() ?? null, null),
    });
    return { id };
  },
});

export const updateView = mutation({
  args: { collectionId: v.string(), viewId: v.string(), name: v.optional(v.string()), config: v.optional(vConfig) },
  handler: async (ctx, args) => {
    const { profile, collection } = await collectionFor(ctx, args.collectionId, "write");
    await assertWritable(ctx, profile);
    const view = await ctx.db
      .query("collectionViews")
      .withIndex("by_public_id", (q) => q.eq("publicId", args.viewId))
      .unique();
    if (!view || view.collectionId !== collection._id) fail("not_found", "View not found.");
    const patch: Partial<Doc<"collectionViews">> = {};
    if (args.name !== undefined) patch.name = args.name.trim().slice(0, 40) || view.name;
    if (args.config) {
      if (view.type === "board" && args.config.groupBy) {
        const prop = await propertyFor(ctx, collection, args.config.groupBy);
        if (prop.type !== "select") fail("invalid_argument", "Boards group by a single-select property.");
      }
      patch.config = { ...args.config, filters: args.config.filters.slice(0, 20), sorts: args.config.sorts.slice(0, 5) };
    }
    await ctx.db.patch(view._id, patch);
    return null;
  },
});

export const deleteView = mutation({
  args: { collectionId: v.string(), viewId: v.string() },
  handler: async (ctx, args) => {
    const { profile, collection } = await collectionFor(ctx, args.collectionId, "write");
    await assertWritable(ctx, profile);
    const views = await ctx.db
      .query("collectionViews")
      .withIndex("by_collection", (q) => q.eq("collectionId", collection._id))
      .collect();
    if (views.length <= 1) fail("invalid_argument", "A collection needs at least one view.");
    const view = views.find((vw) => vw.publicId === args.viewId);
    if (!view) fail("not_found", "View not found.");
    await ctx.db.delete(view._id);
    return null;
  },
});

