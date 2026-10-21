import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { COLLECTION_LIMITS, COLLECTION_VIEW_NAMES, clampCollectionViewConfig, collectionFormulaLoop, isValidId, normalizeCollectionOptions, rankBetween, renameInCollectionFormula, ulid } from "@folevi/editor-schema";
import { accessAtLeast, assertWritable, documentAccess, getDocumentByPublicId, membership, PageReader, requireDocument, requireProfile, type Access } from "./lib/auth";
import { fail } from "./lib/errors";
import { addView, checkedFormula, createCollection, formulaInputs, normalizeNumberFormat, normalizeValue } from "./lib/collections";
import { createDocument, specsToWireBlocks } from "./lib/create";
import { nextSeq } from "./lib/seq";
import { scopeOfRow } from "./lib/scope";
import { vCollectionNumberFormat, vCollectionPropertyType, vCollectionSummary, vCollectionViewType } from "./lib/validators";
import { SyncEngine } from "./lib/syncEngine";
import { queueIndex } from "./lib/ai/indexing";
import { isSealed, requirePlainWrite } from "./lib/e2ee/state";
import { refuseSealed, requireServerWritable } from "./lib/e2ee/coreGuards";

const VIEW_NAMES: Record<Doc<"collectionViews">["type"], string> = COLLECTION_VIEW_NAMES;

/** A property as the client gets it: a formula's text (null for other types) and its number format. */
function propertyOut(p: Doc<"collectionProperties">) {
  return { id: p.publicId, name: p.name, type: p.type, options: p.options, formula: p.formula ?? null, numberFormat: p.numberFormat ?? null };
}

async function liveProperties(ctx: MutationCtx, collectionId: Id<"collections">) {
  return (
    await ctx.db
      .query("collectionProperties")
      .withIndex("by_collection", (q) => q.eq("collectionId", collectionId))
      .collect()
  ).filter((p) => !p.deletedAt);
}

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
  // End-to-end encryption (docs/E2EE_DESIGN.md §5.7, §6.7): a sealed note's collections are sealed records
  // the device reads and writes; plaintext edits never go into an encrypted space.
  refuseSealed(host);
  if (need !== "read") await requirePlainWrite(ctx as MutationCtx, host);
  return { profile, collection, host, access };
}

/** People holding a grant on `doc` or a page above it (grants are inherited). */
async function pageGrantHolders(ctx: QueryCtx, doc: Doc<"documents">): Promise<Id<"profiles">[]> {
  const out: Id<"profiles">[] = [];
  let cursor: Doc<"documents"> | null = doc;
  for (let depth = 0; cursor && depth < 12; depth++) {
    const current: Doc<"documents"> = cursor;
    for (const g of await ctx.db
      .query("documentPermissions")
      .withIndex("by_document", (q) => q.eq("documentId", current._id))
      .take(200)) {
      out.push(g.profileId);
    }
    cursor = current.parentDocumentId ? await ctx.db.get(current.parentDocumentId) : null;
  }
  return out;
}

export const get = query({
  args: { collectionId: v.string() },
  handler: async (ctx, args) => {
    const { collection, access, profile, host } = await collectionFor(ctx, args.collectionId, "read");
    const props = (
      await ctx.db
        .query("collectionProperties")
        .withIndex("by_collection", (q) => q.eq("collectionId", collection._id))
        .collect()
    )
      .filter((p) => !p.deletedAt)
      .sort((a, b) => (a.rank < b.rank ? -1 : 1));
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
    // Every live property's values in one read each (not one read per row), keyed by row.
    const valuesByRow = new Map<string, Record<string, unknown>>();
    for (const p of props) {
      for (const val of await ctx.db
        .query("collectionValues")
        .withIndex("by_property", (q) => q.eq("propertyId", p._id))
        .collect()) {
        const vals = valuesByRow.get(val.rowId) ?? {};
        vals[p.publicId] = val.value;
        valuesByRow.set(val.rowId, vals);
      }
    }
    // Row pages sit under the host page: their restriction walks stop at pages already looked at.
    const reader = await PageReader.forScope(ctx, profile, scopeOfRow(collection));
    const outRows = [];
    for (const r of rows) {
      const doc = await ctx.db.get(r.documentId);
      if (!doc || doc.inTrash) continue;
      if (!(await reader.canOpen(doc))) continue;
      const vals = valuesByRow.get(r._id) ?? {};
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
    // Names for person values (display + picker). No emails.
    // - In the collection's scope (its Personal's owner, or a member of its workspace): the workspace's
    //   members, or in Personal its owner.
    // - A guest: only people this page already involves: whoever created the host page, the people it's
    //   shared with (on it or a page above), and the people named in the rows they can see. Never the
    //   workspace's member list.
    const scope = scopeOfRow(collection);
    const isMember = scope.kind === "personal" ? scope.profileId === profile._id : Boolean(await membership(ctx, profile._id, scope.workspaceId));
    const personIds = new Set<Id<"profiles">>();
    if (scope.kind === "personal") personIds.add(scope.profileId);
    else if (isMember) {
      for (const m of await ctx.db
        .query("workspaceMembers")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", scope.workspaceId))
        .take(300)) {
        personIds.add(m.profileId);
      }
    }
    if (!isMember) {
      personIds.add(host.createdBy);
      for (const id of await pageGrantHolders(ctx, host)) personIds.add(id);
      const personProps = new Set(props.filter((p) => p.type === "person").map((p) => p.publicId));
      for (const r of outRows) {
        for (const [key, value] of Object.entries(r.values)) {
          if (!personProps.has(key) || typeof value !== "string") continue;
          const id = ctx.db.normalizeId("profiles", value);
          if (id) personIds.add(id);
        }
      }
    }
    const people: { id: string; name: string }[] = [];
    for (const id of personIds) {
      const p = await ctx.db.get(id);
      if (p && p.status !== "deleted") people.push({ id: p._id as string, name: p.displayName });
    }
    people.sort((a, b) => a.name.localeCompare(b.name));
    const workspace = scope.kind === "workspace" ? await ctx.db.get(scope.workspaceId) : null;
    return {
      id: collection.publicId,
      name: collection.name,
      /** The team workspace it's in; null in Personal. */
      workspaceId: workspace?.publicId ?? null,
      /** In the collection's scope: its Personal's owner, or a member of its workspace. */
      isMember,
      people,
      hostDocumentId: host.publicId,
      canEdit: accessAtLeast(access, "write"),
      properties: props.map(propertyOut),
      views: views.map((vw) => ({ id: vw.publicId, name: vw.name, type: vw.type, config: vw.config })),
      rows: outRows,
    };
  },
});

/** Creates a collection hosted by a document. The client then inserts a `collection` block pointing at it. */
export const create = mutation({
  // `view` picks the first view's layout (Insert → Table / Gallery / Kanban / Calendar); defaults to a table.
  // `id` may be chosen by the client (a library moved into the account keeps its collections' ids); sending
  // the same create again returns the collection it made and its first view.
  args: { documentId: v.string(), name: v.optional(v.string()), view: v.optional(vCollectionViewType), id: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { doc } = await requireDocument(ctx, profile, args.documentId, "write");
    await requireServerWritable(ctx, doc);
    if (args.id !== undefined) {
      if (!isValidId(args.id)) fail("invalid_argument", "Invalid collection id.");
      const made = await ctx.db
        .query("collections")
        .withIndex("by_public_id", (q) => q.eq("publicId", args.id!))
        .unique();
      if (made) {
        if (made.documentId !== doc._id) fail("invalid_argument", "That collection id is taken.");
        const views = await ctx.db
          .query("collectionViews")
          .withIndex("by_collection", (q) => q.eq("collectionId", made._id))
          .collect();
        const first = views.sort((a, b) => (a.rank < b.rank ? -1 : 1))[0];
        return { collectionId: made.publicId, viewId: first?.publicId ?? "" };
      }
    }
    const seq = await nextSeq(ctx, scopeOfRow(doc));
    const coll = await createCollection(ctx, {
      scope: scopeOfRow(doc),
      documentId: doc._id,
      publicId: args.id,
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
    const status = coll.propertyPublicIds.get("status")!;
    const date = coll.propertyPublicIds.get("date")!;
    const vis = [status, date];
    const type = args.view ?? "table";
    const viewId = await addView(ctx, coll.collectionId, {
      name: VIEW_NAMES[type],
      type,
      groupBy: type === "board" ? status : undefined,
      dateBy: type === "calendar" ? date : undefined,
      visibleProperties: vis,
      rank: "V",
    });
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

/**
 * Adds a property, shown in every view. `id` may be chosen by the client (a property added offline, then set on
 * rows before it's sent); sending the same add again returns the property it made.
 */
export const addProperty = mutation({
  args: {
    collectionId: v.string(),
    name: v.string(),
    type: vCollectionPropertyType,
    id: v.optional(v.string()),
    /** A formula property's formula (checked: its length, and that it never depends on itself). */
    formula: v.optional(v.string()),
    numberFormat: v.optional(vCollectionNumberFormat),
  },
  handler: async (ctx, args) => {
    const { profile, collection } = await collectionFor(ctx, args.collectionId, "write");
    await assertWritable(ctx, profile);
    if (args.id !== undefined) {
      if (!isValidId(args.id)) fail("invalid_argument", "Invalid property id.");
      const made = await ctx.db
        .query("collectionProperties")
        .withIndex("by_public_id", (q) => q.eq("publicId", args.id!))
        .unique();
      if (made) {
        if (made.collectionId !== collection._id) fail("invalid_argument", "That property id is taken.");
        return { id: made.publicId };
      }
    }
    const existing = await ctx.db
      .query("collectionProperties")
      .withIndex("by_collection", (q) => q.eq("collectionId", collection._id))
      .collect();
    if (existing.filter((p) => !p.deletedAt).length >= COLLECTION_LIMITS.properties) fail("limit_exceeded", "A collection can have up to 40 properties.");
    const last = existing.map((p) => p.rank).sort().pop() ?? null;
    const publicId = args.id ?? ulid();
    const propId = await ctx.db.insert("collectionProperties", {
      publicId,
      collectionId: collection._id,
      name: args.name.trim().slice(0, 60) || "Property",
      type: args.type,
      options: [],
      ...(args.numberFormat && (args.type === "number" || args.type === "formula") ? { numberFormat: normalizeNumberFormat(args.numberFormat) } : {}),
      rank: rankBetween(last, null),
      createdAt: Date.now(),
    });
    if (args.type === "formula") {
      const formula = checkedFormula(await liveProperties(ctx, collection._id), publicId, args.formula ?? "");
      await ctx.db.patch(propId, { formula });
    }
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

/**
 * Renames a property, or sets its options (the whole list: an option keeps its id, so rows that chose it keep
 * it; a new one sent with an id keeps that id, so a resend changes nothing).
 */
export const updateProperty = mutation({
  args: {
    collectionId: v.string(),
    propertyId: v.string(),
    name: v.optional(v.string()),
    options: v.optional(v.array(v.object({ id: v.optional(v.string()), name: v.string(), color: v.optional(v.string()) }))),
    /** A formula property's new formula. */
    formula: v.optional(v.string()),
    /** Number and formula properties: how numbers show (null: plain). */
    numberFormat: v.optional(v.union(vCollectionNumberFormat, v.null())),
  },
  handler: async (ctx, args) => {
    const { profile, collection } = await collectionFor(ctx, args.collectionId, "write");
    await assertWritable(ctx, profile);
    const prop = await propertyFor(ctx, collection, args.propertyId);
    const patch: Partial<Doc<"collectionProperties">> = {};
    if (args.formula !== undefined) {
      if (prop.type !== "formula") fail("invalid_argument", "Only formula properties have a formula.");
      patch.formula = checkedFormula(await liveProperties(ctx, collection._id), prop.publicId, args.formula);
    }
    if (args.numberFormat !== undefined) {
      if (prop.type !== "number" && prop.type !== "formula") fail("invalid_argument", "Only number and formula properties have a number format.");
      patch.numberFormat = args.numberFormat ? normalizeNumberFormat(args.numberFormat) : undefined;
    }
    if (args.name !== undefined) {
      patch.name = args.name.trim().slice(0, 60) || prop.name;
      if (patch.name !== prop.name) {
        const own = await renameInFormulas(ctx, collection._id, prop, patch.name, patch.formula);
        if (own !== undefined) patch.formula = own;
      }
    }
    if (args.options) {
      if (prop.type !== "select" && prop.type !== "multiSelect") fail("invalid_argument", "Only select properties have options.");
      patch.options = normalizeCollectionOptions(args.options);
    }
    await ctx.db.patch(prop._id, patch);
    return null;
  },
});

/**
 * A property renamed: every formula that names it names it the new way (the formulas follow it, as a table's
 * column names do). Refused when the new name would make formulas depend on each other in a loop.
 */
async function renameInFormulas(ctx: MutationCtx, collectionId: Id<"collections">, prop: Doc<"collectionProperties">, name: string, ownFormula: string | undefined) {
  const props = await liveProperties(ctx, collectionId);
  const before = formulaInputs(props);
  const updates = new Map<Id<"collectionProperties">, string>();
  for (const p of props) {
    const text = p._id === prop._id && ownFormula !== undefined ? ownFormula : p.formula;
    if (p.type !== "formula" || !text) continue;
    const next = renameInCollectionFormula(text, before, prop.publicId, name);
    if (next !== p.formula) updates.set(p._id, next);
  }
  const after = before.map((p) => {
    const doc = props.find((x) => x.publicId === p.id)!;
    return { ...p, name: p.id === prop.publicId ? name : p.name, formula: updates.get(doc._id) ?? (p.id === prop.publicId && ownFormula !== undefined ? ownFormula : p.formula) };
  });
  const loop = collectionFormulaLoop(after);
  if (loop) fail("invalid_argument", `With that name, formulas would depend on each other in a loop: ${loop.map((n) => `“${n}”`).join(" → ")}.`);
  for (const [id, formula] of updates) if (id !== prop._id) await ctx.db.patch(id, { formula });
  // Its own formula (when it names itself it's refused above) is part of the caller's patch.
  return updates.get(prop._id);
}

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

/**
 * Adds a row (a page under the host page). `id` and `documentId` (the row and its page) may be chosen by the
 * client, so a row added offline can be filled in before the server has it; sending the same add again (its
 * answer was lost) returns the row it made, once.
 */
export const addRow = mutation({
  args: {
    collectionId: v.string(),
    title: v.optional(v.string()),
    values: v.optional(v.record(v.string(), v.any())),
    afterRowId: v.optional(v.string()),
    id: v.optional(v.string()),
    documentId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { profile, collection, host } = await collectionFor(ctx, args.collectionId, "write");
    await assertWritable(ctx, profile);
    if ((args.id !== undefined && !isValidId(args.id)) || (args.documentId !== undefined && !isValidId(args.documentId))) fail("invalid_argument", "Invalid row id.");
    if (args.id !== undefined) {
      const existing = await ctx.db
        .query("collectionRows")
        .withIndex("by_public_id", (q) => q.eq("publicId", args.id!))
        .unique();
      if (existing) {
        if (existing.collectionId !== collection._id) fail("invalid_argument", "That row id is taken.");
        const page = await ctx.db.get(existing.documentId);
        return { id: existing.publicId, documentId: page?.publicId ?? args.documentId ?? "" };
      }
    }
    const rows = (
      await ctx.db
        .query("collectionRows")
        .withIndex("by_collection", (q) => q.eq("collectionId", collection._id))
        .collect()
    )
      .filter((r) => !r.deletedAt)
      .sort((a, b) => (a.rank < b.rank ? -1 : 1));
    if (rows.length >= COLLECTION_LIMITS.rows) fail("limit_exceeded", "A collection can have up to 2,000 rows.");
    let rank: string;
    if (args.afterRowId) {
      const idx = rows.findIndex((r) => r.publicId === args.afterRowId);
      rank = rankBetween(rows[idx]?.rank ?? null, rows[idx + 1]?.rank ?? null);
    } else rank = rankBetween(rows[rows.length - 1]?.rank ?? null, null);
    const doc = await createDocument(ctx, {
      scope: scopeOfRow(collection),
      actor: profile,
      publicId: args.documentId,
      title: (args.title ?? "").slice(0, 300),
      kind: "collectionRow",
      parentDocumentId: host._id,
      collectionId: collection._id,
      accessMode: host.accessMode,
      // A page whose id the client chose may already be open there, with lines typed into it before it was
      // sent: it starts empty, like any new note, so those lines aren't joined by a second empty one.
      blocks: args.documentId !== undefined ? [] : specsToWireBlocks([{ type: "paragraph", md: "" }]),
    });
    const now = Date.now();
    const publicId = args.id ?? ulid();
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

/** Renames a row (its page title) inline from a collection view. Goes through the sync engine so derived text and link labels follow. */
export const renameRow = mutation({
  args: { collectionId: v.string(), rowId: v.string(), title: v.string() },
  handler: async (ctx, args) => {
    const { profile, collection } = await collectionFor(ctx, args.collectionId, "write");
    await assertWritable(ctx, profile);
    const row = await rowFor(ctx, collection, args.rowId);
    const doc = await ctx.db.get(row.documentId);
    if (!doc || doc.inTrash) fail("not_found", "Row not found.");
    const engine = new SyncEngine(ctx, profile, "server");
    const [r] = await engine.applyAll(null, [
      { opId: ulid(), kind: "document.update", documentId: doc.publicId, patch: { title: args.title.slice(0, 300) }, baseRevision: null },
    ]);
    if (!r || r.status === "rejected") fail("forbidden", r?.error?.message ?? "Couldn't rename this row.");
    await ctx.db.patch(row._id, { updatedAt: Date.now() });
    return null;
  },
});

/**
 * The collection a page belongs to as a row (null for ordinary pages): shown as editable properties
 * at the top of the row's page.
 */
export const rowForDocument = query({
  args: { documentId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const doc = await getDocumentByPublicId(ctx, args.documentId);
    // A sealed row's values live in its own sealed meta (docs/E2EE_DESIGN.md §6.7): the device shows them.
    if (!doc || doc.kind !== "collectionRow" || !doc.collectionId || isSealed(doc)) return null;
    const access = await documentAccess(ctx, profile, doc);
    if (!accessAtLeast(access, "read")) return null;
    const collection = await ctx.db.get(doc.collectionId);
    if (!collection || collection.deletedAt) return null;
    const row = (
      await ctx.db
        .query("collectionRows")
        .withIndex("by_collection", (q) => q.eq("collectionId", collection._id))
        .collect()
    ).find((r) => r.documentId === doc._id && !r.deletedAt);
    if (!row) return null;
    const host = await ctx.db.get(collection.documentId);
    if (host && isSealed(host)) return null;
    const hostReadable = host ? accessAtLeast(await documentAccess(ctx, profile, host), "read") : false;
    const props = (
      await ctx.db
        .query("collectionProperties")
        .withIndex("by_collection", (q) => q.eq("collectionId", collection._id))
        .collect()
    )
      .filter((p) => !p.deletedAt)
      .sort((a, b) => (a.rank < b.rank ? -1 : 1));
    const byId = new Map(props.map((p) => [p._id as string, p.publicId]));
    const values: Record<string, unknown> = {};
    for (const val of await ctx.db
      .query("collectionValues")
      .withIndex("by_row", (q) => q.eq("rowId", row._id))
      .collect()) {
      const pid = byId.get(val.propertyId);
      if (pid) values[pid] = val.value;
    }
    return {
      collection: { id: collection.publicId, name: collection.name, hostDocumentId: hostReadable && host ? host.publicId : null, hostTitle: hostReadable && host ? host.title : null },
      canEdit: accessAtLeast(access, "write"),
      row: { id: row.publicId, documentId: doc.publicId, title: doc.title, values },
      properties: props.map(propertyOut),
    };
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
      await ctx.db.patch(doc._id, { inTrash: true, deletedAt: Date.now(), deletedBy: profile._id, seq: await nextSeq(ctx, scopeOfRow(doc)) });
      await queueIndex(ctx, doc);
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
  dateBy: v.optional(v.string()),
  visibleProperties: v.array(v.string()),
  cardPreview: v.union(v.literal("none"), v.literal("cover"), v.literal("content")),
  cardSize: v.union(v.literal("small"), v.literal("medium"), v.literal("large")),
  summaries: v.optional(v.array(vCollectionSummary)),
});

/** Adds a view. `id` may be chosen by the client (a view added offline); sending it again returns that view. */
export const addViewToCollection = mutation({
  args: { collectionId: v.string(), name: v.string(), type: vCollectionViewType, id: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { profile, collection } = await collectionFor(ctx, args.collectionId, "write");
    await assertWritable(ctx, profile);
    if (args.id !== undefined) {
      if (!isValidId(args.id)) fail("invalid_argument", "Invalid view id.");
      const made = await ctx.db
        .query("collectionViews")
        .withIndex("by_public_id", (q) => q.eq("publicId", args.id!))
        .unique();
      if (made) {
        if (made.collectionId !== collection._id) fail("invalid_argument", "That view id is taken.");
        return { id: made.publicId };
      }
    }
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
    if (views.length >= COLLECTION_LIMITS.views) fail("limit_exceeded", "Up to 20 views per collection.");
    const groupBy = args.type === "board" ? props.find((p) => p.type === "select")?.publicId : undefined;
    if (args.type === "board" && !groupBy) fail("invalid_argument", "Add a single-select property to group a board by.");
    const dateBy = args.type === "calendar" ? props.find((p) => p.type === "date")?.publicId : undefined;
    if (args.type === "calendar" && !dateBy) fail("invalid_argument", "Add a date property to show a calendar.");
    const id = await addView(ctx, collection._id, {
      name: args.name.trim().slice(0, 40) || "View",
      type: args.type,
      groupBy,
      dateBy,
      visibleProperties: props.map((p) => p.publicId),
      rank: rankBetween(views.map((vw) => vw.rank).sort().pop() ?? null, null),
      publicId: args.id,
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
        if (prop.type !== "select" && prop.type !== "formula") fail("invalid_argument", "Boards group by a single-select or formula property.");
      }
      if (view.type === "calendar" && args.config.dateBy) {
        const prop = await propertyFor(ctx, collection, args.config.dateBy);
        if (prop.type !== "date") fail("invalid_argument", "Calendars place rows by a date property.");
      }
      patch.config = clampCollectionViewConfig(args.config);
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
    // Not found first: a delete sent again (its answer was lost) is told it's done, even when one view is left.
    const view = views.find((vw) => vw.publicId === args.viewId);
    if (!view) fail("not_found", "View not found.");
    if (views.length <= 1) fail("invalid_argument", "A collection needs at least one view.");
    await ctx.db.delete(view._id);
    return null;
  },
});

