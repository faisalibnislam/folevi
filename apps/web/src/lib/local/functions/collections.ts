// collections.* in local mode (convex/collections.ts and convex/lib/collections.ts). A collection's definition
// (its name, properties and views) lives in its host note (store `collections`, docs/LOCAL_MODE_PLAN.md §3.3);
// each row is a note of kind "collectionRow" under the host, carrying its row (`LocalDocument.row`: id, rank,
// values). The person owns the whole library, so every collection can be read and edited; the shapes, limits
// and checks are the server's (the checks are shared through @folevi/editor-schema collectionValues.ts).
import {
  COLLECTION_LIMITS,
  COLLECTION_VIEW_NAMES,
  READING_SHELF,
  addDays,
  clampCollectionViewConfig,
  cleanCollectionFormula,
  collectionFormulaLoop,
  collectionFormulaProblem,
  isValidId,
  normalizeCollectionNumberFormat,
  normalizeCollectionOptions,
  normalizeCollectionValue,
  rankBetween,
  rankSequence,
  renameInCollectionFormula,
  specsToWireBlocks,
  ulid,
  type CollectionPropertyType,
  type FormulaPropertyInput,
  type SyncOp,
} from "@folevi/editor-schema";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/lib/convex/api";
import { fail } from "../errors";
import { LOCAL_FUNCTIONS, defineLocal, type LocalMutationCtx, type LocalQueryCtx, type LocalReader } from "../registry";
import type { LocalCollection, LocalCollectionProperty, LocalCollectionRow, LocalCollectionView, LocalDocument } from "../store";
import { insertDocument, requireProfile } from "./shared";

type ViewType = LocalCollectionView["type"];
type ViewConfig = LocalCollectionView["config"];

const byRank = <T extends { rank: string; createdAt: number }>(a: T, b: T) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : a.createdAt - b.createdAt);
/** As they were made (the order the server's index lists them in); made together, by rank. */
const byCreation = <T extends { rank: string; createdAt: number }>(a: T, b: T) => a.createdAt - b.createdAt || (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0);

/** A property as the client gets it: a formula's text (null for other types) and its number format. */
function propertyOut(p: LocalCollectionProperty) {
  return { id: p.id, name: p.name, type: p.type, options: p.options, formula: p.formula, numberFormat: p.numberFormat };
}

/** The live properties, in order. */
function liveProperties(c: LocalCollection): LocalCollectionProperty[] {
  return Object.values(c.properties)
    .filter((p) => p.deletedAt === null)
    .sort(byRank);
}

/** The views (deleted ones are gone), in order. */
function liveViews(c: LocalCollection): LocalCollectionView[] {
  return Object.values(c.views)
    .filter((v) => v.deletedAt === null)
    .sort(byRank);
}

/** The live properties as the formula checks read them (convex/lib/collections.ts formulaInputs). */
function formulaInputs(c: LocalCollection): FormulaPropertyInput[] {
  return liveProperties(c).map((p) => ({ id: p.id, name: p.name, type: p.type, options: p.options, formula: p.formula }));
}

/** A formula as stored, refused with the reason when it's too long or would depend on itself. */
function checkedFormula(c: LocalCollection, propertyId: string, formula: string): string {
  const text = cleanCollectionFormula(formula);
  const problem = collectionFormulaProblem(formulaInputs(c), propertyId, text);
  if (problem) fail("invalid_argument", problem);
  return text;
}

function normalizeValue(property: LocalCollectionProperty, value: unknown): unknown {
  const out = normalizeCollectionValue(property, value);
  if ("problem" in out) fail("invalid_argument", out.problem);
  return out.value;
}

async function collectionFor(ctx: LocalQueryCtx | LocalMutationCtx, collectionId: string) {
  const profile = await requireProfile(ctx);
  const collection = await ctx.db.get("collections", collectionId);
  if (!collection || collection.deletedAt !== null) fail("not_found", "Collection not found.");
  const host = await ctx.db.get("documents", collection.documentId);
  if (!host) fail("not_found", "Collection not found.");
  return { profile, collection, host };
}

function propertyFor(collection: LocalCollection, propertyId: string): LocalCollectionProperty {
  const prop = Object.hasOwn(collection.properties, propertyId) ? collection.properties[propertyId] : undefined;
  if (!prop || prop.deletedAt !== null) fail("not_found", "Property not found.");
  return prop;
}

type RowNote = LocalDocument & { row: LocalCollectionRow };

const hasRow = (d: LocalDocument): d is RowNote => Boolean(d.row);

/** Every row of a collection (deleted ones too, and rows whose note is in Trash), on their notes. */
async function rowNotes(db: LocalReader, collectionId: string): Promise<RowNote[]> {
  return (await db.list("documents")).filter((d): d is RowNote => hasRow(d) && d.row.collectionId === collectionId);
}

/** Rows in order: by rank, then as they were made. */
const rowOrder = (a: RowNote, b: RowNote) => (a.row.rank < b.row.rank ? -1 : a.row.rank > b.row.rank ? 1 : a.row.createdAt - b.row.createdAt || a.ordinal - b.ordinal);

async function liveRows(db: LocalReader, collectionId: string): Promise<RowNote[]> {
  return (await rowNotes(db, collectionId)).filter((d) => d.row.deletedAt === null).sort(rowOrder);
}

/** The row with this id (on its note), whatever collection it's in, deleted or not. */
async function findRow(db: LocalReader, rowId: string): Promise<RowNote | undefined> {
  return (await db.list("documents")).find((d): d is RowNote => hasRow(d) && d.row.id === rowId);
}

async function rowFor(db: LocalReader, collection: LocalCollection, rowId: string): Promise<RowNote> {
  const note = await findRow(db, rowId);
  if (!note || note.row.collectionId !== collection.id || note.row.deletedAt !== null) fail("not_found", "Row not found.");
  return note;
}

function putRow(ctx: LocalMutationCtx, note: LocalDocument, row: LocalCollectionRow) {
  ctx.db.put("documents", note.id, { ...note, row });
}

/** A row's values with `propertyId` set to `value` (null clears it). */
function withValue(values: Record<string, unknown>, propertyId: string, value: unknown): Record<string, unknown> {
  const next = { ...values };
  if (value === null) delete next[propertyId];
  else next[propertyId] = value;
  return next;
}

// ---- making collections (create, the seed, copies) ------------------------------------------------------

const ORDINAL_KEY = "collectionOrdinal";

export interface NewProperty {
  key?: string;
  name: string;
  type: CollectionPropertyType;
  options?: { id: string; name: string; color: string }[];
}

/**
 * A collection hosted by `documentId`, with these properties (convex/lib/collections.ts createCollection). It's
 * written before this returns; `propertyIds` maps each property's key (or name) to its id.
 */
export async function createCollection(
  ctx: LocalMutationCtx,
  input: { documentId: string; name: string; seq: number; properties: NewProperty[] },
): Promise<{ collection: LocalCollection; propertyIds: Map<string, string> }> {
  const now = ctx.now();
  const ordinal = (((await ctx.db.get("meta", ORDINAL_KEY)) as number | undefined) ?? 0) + 1;
  ctx.db.put("meta", ORDINAL_KEY, ordinal);
  const collection: LocalCollection = { id: ulid(), documentId: input.documentId, name: input.name, createdAt: now, ordinal, updatedAt: now, deletedAt: null, seq: input.seq, properties: {}, views: {} };
  const ranks = rankSequence(input.properties.length);
  const propertyIds = new Map<string, string>();
  for (const [i, p] of input.properties.entries()) {
    const id = ulid();
    collection.properties[id] = { id, name: p.name, type: p.type, options: p.options ?? [], formula: null, numberFormat: null, rank: ranks[i]!, createdAt: now, deletedAt: null };
    propertyIds.set(p.key ?? p.name, id);
  }
  ctx.db.put("collections", collection.id, collection);
  return { collection, propertyIds };
}

/** Adds a view to `collection` (in place; the caller writes it). Returns its id. */
export function addView(
  ctx: LocalMutationCtx,
  collection: LocalCollection,
  view: { name: string; type: ViewType; groupBy?: string; dateBy?: string; visibleProperties: string[]; rank: string; id?: string },
): string {
  const id = view.id ?? ulid();
  const config: ViewConfig = {
    filters: [],
    sorts: [],
    visibleProperties: view.visibleProperties,
    cardPreview: view.type === "gallery" ? "cover" : "none",
    cardSize: "medium",
  };
  if (view.groupBy !== undefined) config.groupBy = view.groupBy;
  if (view.dateBy !== undefined) config.dateBy = view.dateBy;
  collection.views[id] = { id, name: view.name, type: view.type, config, rank: view.rank, createdAt: ctx.now(), deletedAt: null };
  return id;
}

/**
 * A copied note (Duplicate, or a note made from one of your templates) gets collections of its own: the same
 * properties and views, without the rows (convex/lib/collections.ts copyCollectionsInto). Its cloned
 * collection blocks are pointed at the copies. Call it once the copy and its blocks are written.
 */
export async function copyCollectionsInto(ctx: LocalMutationCtx, documentId: string): Promise<void> {
  const doc = await ctx.db.get("documents", documentId);
  if (!doc) return;
  for (const block of await ctx.db.list("blocks", documentId)) {
    if (block.type !== "collection" || block.deletedAt !== null) continue;
    const props = (block.props ?? {}) as { collectionId?: string; viewId?: string };
    if (!props.collectionId) continue;
    const source = await ctx.db.get("collections", props.collectionId);
    if (!source || source.documentId === documentId) continue;
    const now = ctx.now();
    const ordinal = (((await ctx.db.get("meta", ORDINAL_KEY)) as number | undefined) ?? 0) + 1;
    ctx.db.put("meta", ORDINAL_KEY, ordinal);
    const copy: LocalCollection = { id: ulid(), documentId, name: source.name, createdAt: now, ordinal, updatedAt: now, deletedAt: null, seq: await ctx.nextSeq(), properties: {}, views: {} };
    const propertyIds = new Map<string, string>();
    for (const p of Object.values(source.properties).sort(byCreation)) {
      if (p.deletedAt !== null) continue;
      const id = ulid();
      propertyIds.set(p.id, id);
      copy.properties[id] = { ...p, id, createdAt: now };
    }
    const mapId = (id: string) => propertyIds.get(id);
    let viewId: string | undefined;
    let firstView: string | undefined;
    for (const vw of Object.values(source.views).sort(byCreation)) {
      if (vw.deletedAt !== null) continue;
      const id = ulid();
      if (vw.id === props.viewId) viewId = id;
      firstView ??= id;
      const c = vw.config;
      const config: ViewConfig = {
        ...c,
        filters: c.filters.filter((f) => mapId(f.propertyId)).map((f) => ({ ...f, propertyId: mapId(f.propertyId)! })),
        sorts: c.sorts.filter((x) => mapId(x.propertyId)).map((x) => ({ ...x, propertyId: mapId(x.propertyId)! })),
        visibleProperties: c.visibleProperties.map(mapId).filter((x): x is string => Boolean(x)),
      };
      delete config.groupBy;
      delete config.dateBy;
      const groupBy = c.groupBy ? mapId(c.groupBy) : undefined;
      const dateBy = c.dateBy ? mapId(c.dateBy) : undefined;
      if (groupBy) config.groupBy = groupBy;
      if (dateBy) config.dateBy = dateBy;
      if (c.summaries) config.summaries = c.summaries.flatMap((x) => (x.propertyId === "title" ? [x] : mapId(x.propertyId) ? [{ ...x, propertyId: mapId(x.propertyId)! }] : []));
      copy.views[id] = { ...vw, id, config, createdAt: now };
    }
    viewId ??= firstView;
    ctx.db.put("collections", copy.id, copy);
    // As on the server: the block is pointed at the copy without a new revision (it's the copy's own content).
    ctx.db.put("blocks", block.id, { ...block, props: { ...props, collectionId: copy.id, ...(viewId ? { viewId } : {}) } }, documentId);
  }
}

/**
 * The Reading Shelf's collection, as a new library starts with it (convex/seed.ts seedPersonal): its
 * properties, three views, the five books as rows with their values, and the block that shows it.
 */
export async function seedReadingShelf(ctx: LocalMutationCtx, shelf: LocalDocument, today: string): Promise<void> {
  const now = ctx.now();
  const { collection, propertyIds } = await createCollection(ctx, { documentId: shelf.id, name: "Books", seq: shelf.seq, properties: READING_SHELF.properties });
  const viewRanks = rankSequence(3);
  const all = READING_SHELF.properties.map((p) => propertyIds.get(p.key)!);
  const tableView = addView(ctx, collection, { name: "Table", type: "table", visibleProperties: all, rank: viewRanks[0]! });
  addView(ctx, collection, { name: "By status", type: "board", groupBy: propertyIds.get("status"), visibleProperties: [propertyIds.get("author")!, propertyIds.get("rating")!], rank: viewRanks[1]! });
  addView(ctx, collection, { name: "Gallery", type: "gallery", visibleProperties: [propertyIds.get("author")!, propertyIds.get("status")!], rank: viewRanks[2]! });
  ctx.db.put("collections", collection.id, collection);
  const rowRanks = rankSequence(READING_SHELF.rows.length);
  for (const [i, row] of READING_SHELF.rows.entries()) {
    const note = await insertDocument(ctx, {
      title: row.title,
      icon: "📖",
      kind: "collectionRow",
      parentDocumentId: shelf.id,
      collectionId: collection.id,
      blocks: specsToWireBlocks([{ type: "paragraph", md: `Notes on _${row.title}_ by ${row.author}.` }]),
    });
    const values: Record<string, unknown> = {};
    const given: [string, unknown][] = [
      ["author", row.author],
      ["status", row.status],
      ["rating", "rating" in row ? row.rating : undefined],
      ["started", "started" in row && row.started !== undefined ? addDays(today, row.started) : undefined],
      ["format", row.format],
      ["link", "link" in row ? row.link : undefined],
    ];
    for (const [key, value] of given) if (value !== undefined) values[propertyIds.get(key)!] = value;
    putRow(ctx, note, { id: ulid(), collectionId: collection.id, rank: rowRanks[i]!, values, createdAt: now, updatedAt: now, deletedAt: null });
  }
  // As on the server, the block goes in without refreshing the note's counts (they catch up on its next edit).
  const first = (await ctx.db.list("blocks", shelf.id)).sort((a, b) => a.createdAt - b.createdAt)[0];
  const id = ulid();
  ctx.db.put(
    "blocks",
    id,
    {
      id,
      documentId: shelf.id,
      parentId: null,
      rank: `${first?.rank ?? "V"}V`,
      type: "collection",
      schemaVersion: 1,
      text: [],
      props: { collectionId: collection.id, viewId: tableView },
      revision: 1,
      contentRev: 1,
      positionRev: 1,
      seq: shelf.seq,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    },
    shelf.id,
  );
}

// ---- queries ----------------------------------------------------------------------------------------------

defineLocal(api.collections.get, "query", async (ctx, args) => {
  const { collection, host, profile } = await collectionFor(ctx, args.collectionId);
  const props = liveProperties(collection);
  const rows: FunctionReturnType<typeof api.collections.get>["rows"] = [];
  for (const note of (await liveRows(ctx.db, collection.id)).slice(0, COLLECTION_LIMITS.rows)) {
    if (note.inTrash) continue;
    const values: Record<string, unknown> = {};
    for (const p of props) if (Object.hasOwn(note.row.values, p.id)) values[p.id] = note.row.values[p.id];
    rows.push({ id: note.row.id, documentId: note.id, title: note.title, icon: note.icon, cover: note.cover, excerpt: note.excerpt, rank: note.row.rank, values, updatedAt: note.updatedAt });
  }
  return {
    id: collection.id,
    name: collection.name,
    workspaceId: null,
    // One person per library: its owner, who is the only person a person value can name.
    isMember: true,
    people: [{ id: profile.id, name: profile.displayName }],
    hostDocumentId: host.id,
    canEdit: true,
    properties: props.map(propertyOut),
    views: liveViews(collection).map((vw) => ({ id: vw.id, name: vw.name, type: vw.type, config: vw.config })),
    rows,
  };
});

defineLocal(api.collections.rowForDocument, "query", async (ctx, args) => {
  await requireProfile(ctx);
  const doc = await ctx.db.get("documents", args.documentId);
  if (!doc || doc.kind !== "collectionRow" || !doc.collectionId) return null;
  const collection = await ctx.db.get("collections", doc.collectionId);
  if (!collection || collection.deletedAt !== null) return null;
  const row = doc.row;
  if (!row || row.collectionId !== collection.id || row.deletedAt !== null) return null;
  const host = await ctx.db.get("documents", collection.documentId);
  const props = liveProperties(collection);
  const values: Record<string, unknown> = {};
  for (const p of props) if (Object.hasOwn(row.values, p.id)) values[p.id] = row.values[p.id];
  return {
    collection: { id: collection.id, name: collection.name, hostDocumentId: host ? host.id : null, hostTitle: host ? host.title : null },
    canEdit: true,
    row: { id: row.id, documentId: doc.id, title: doc.title, values },
    properties: props.map(propertyOut),
  };
});

// ---- the collection ---------------------------------------------------------------------------------------

/** Creates a collection hosted by a note. The client then inserts a `collection` block pointing at it. */
defineLocal(api.collections.create, "mutation", async (ctx, args) => {
  await requireProfile(ctx);
  const doc = await ctx.db.get("documents", args.documentId);
  if (!doc) fail("not_found", "Document not found.");
  const seq = await ctx.nextSeq();
  const { collection, propertyIds } = await createCollection(ctx, {
    documentId: doc.id,
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
  const status = propertyIds.get("status")!;
  const date = propertyIds.get("date")!;
  const type = args.view ?? "table";
  const viewId = addView(ctx, collection, {
    name: COLLECTION_VIEW_NAMES[type],
    type,
    groupBy: type === "board" ? status : undefined,
    dateBy: type === "calendar" ? date : undefined,
    visibleProperties: [status, date],
    rank: "V",
  });
  ctx.db.put("collections", collection.id, collection);
  return { collectionId: collection.id, viewId };
});

defineLocal(api.collections.rename, "mutation", async (ctx, args) => {
  const { collection } = await collectionFor(ctx, args.collectionId);
  ctx.db.put("collections", collection.id, { ...collection, name: args.name.trim().slice(0, 80) || "Collection", updatedAt: ctx.now() });
  return null;
});

// ---- properties -------------------------------------------------------------------------------------------

/**
 * Adds a property, shown in every view. `id` may be chosen by the client (a property added offline); sending
 * the same add again returns the property it made.
 */
defineLocal(api.collections.addProperty, "mutation", async (ctx, args) => {
  const { collection } = await collectionFor(ctx, args.collectionId);
  if (args.id !== undefined) {
    if (!isValidId(args.id)) fail("invalid_argument", "Invalid property id.");
    if (Object.hasOwn(collection.properties, args.id)) return { id: args.id };
    for (const other of await ctx.db.list("collections")) if (Object.hasOwn(other.properties, args.id)) fail("invalid_argument", "That property id is taken.");
  }
  const existing = Object.values(collection.properties);
  if (existing.filter((p) => p.deletedAt === null).length >= COLLECTION_LIMITS.properties) fail("limit_exceeded", "A collection can have up to 40 properties.");
  const last = existing.map((p) => p.rank).sort().pop() ?? null;
  const id = args.id ?? ulid();
  const next: LocalCollection = { ...collection, properties: { ...collection.properties }, views: { ...collection.views } };
  next.properties[id] = {
    id,
    name: args.name.trim().slice(0, 60) || "Property",
    type: args.type,
    options: [],
    formula: null,
    numberFormat: args.numberFormat && (args.type === "number" || args.type === "formula") ? normalizeCollectionNumberFormat(args.numberFormat) : null,
    rank: rankBetween(last, null),
    createdAt: ctx.now(),
    deletedAt: null,
  };
  if (args.type === "formula") next.properties[id] = { ...next.properties[id]!, formula: checkedFormula(next, id, args.formula ?? "") };
  for (const vw of Object.values(next.views)) next.views[vw.id] = { ...vw, config: { ...vw.config, visibleProperties: [...vw.config.visibleProperties, id] } };
  ctx.db.put("collections", next.id, next);
  return { id };
});

/**
 * A property renamed: every formula that names it names it the new way. Refused when the new name would make
 * formulas depend on each other in a loop. Returns the property's own formula when it changed.
 */
function renameInFormulas(collection: LocalCollection, prop: LocalCollectionProperty, name: string, ownFormula: string | undefined): { updates: Map<string, string>; own: string | undefined } {
  const props = liveProperties(collection);
  const before = formulaInputs(collection);
  const updates = new Map<string, string>();
  for (const p of props) {
    const text = p.id === prop.id && ownFormula !== undefined ? ownFormula : p.formula;
    if (p.type !== "formula" || !text) continue;
    const next = renameInCollectionFormula(text, before, prop.id, name);
    if (next !== p.formula) updates.set(p.id, next);
  }
  const after = before.map((p) => ({ ...p, name: p.id === prop.id ? name : p.name, formula: updates.get(p.id) ?? (p.id === prop.id && ownFormula !== undefined ? ownFormula : p.formula) }));
  const loop = collectionFormulaLoop(after);
  if (loop) fail("invalid_argument", `With that name, formulas would depend on each other in a loop: ${loop.map((n) => `“${n}”`).join(" → ")}.`);
  return { updates, own: updates.get(prop.id) };
}

/**
 * Renames a property, sets its options (the whole list: an option keeps its id), its formula or its number
 * format.
 */
defineLocal(api.collections.updateProperty, "mutation", async (ctx, args) => {
  const { collection } = await collectionFor(ctx, args.collectionId);
  const prop = propertyFor(collection, args.propertyId);
  const patch: Partial<LocalCollectionProperty> = {};
  const next: LocalCollection = { ...collection, properties: { ...collection.properties } };
  if (args.formula !== undefined) {
    if (prop.type !== "formula") fail("invalid_argument", "Only formula properties have a formula.");
    patch.formula = checkedFormula(collection, prop.id, args.formula);
  }
  if (args.numberFormat !== undefined) {
    if (prop.type !== "number" && prop.type !== "formula") fail("invalid_argument", "Only number and formula properties have a number format.");
    patch.numberFormat = args.numberFormat ? normalizeCollectionNumberFormat(args.numberFormat) : null;
  }
  if (args.name !== undefined) {
    patch.name = args.name.trim().slice(0, 60) || prop.name;
    if (patch.name !== prop.name) {
      const { updates, own } = renameInFormulas(collection, prop, patch.name, patch.formula ?? undefined);
      for (const [id, formula] of updates) if (id !== prop.id) next.properties[id] = { ...next.properties[id]!, formula };
      if (own !== undefined) patch.formula = own;
    }
  }
  if (args.options) {
    if (prop.type !== "select" && prop.type !== "multiSelect") fail("invalid_argument", "Only select properties have options.");
    patch.options = normalizeCollectionOptions(args.options);
  }
  next.properties[prop.id] = { ...prop, ...patch };
  ctx.db.put("collections", next.id, next);
  return null;
});

defineLocal(api.collections.deleteProperty, "mutation", async (ctx, args) => {
  const { collection } = await collectionFor(ctx, args.collectionId);
  const prop = propertyFor(collection, args.propertyId);
  ctx.db.put("collections", collection.id, { ...collection, properties: { ...collection.properties, [prop.id]: { ...prop, deletedAt: ctx.now() } } });
  return null;
});

// ---- rows -------------------------------------------------------------------------------------------------

/**
 * Adds a row (a note under the host note). `id` and `documentId` may be chosen by the client, so a row added
 * offline can be filled in first; sending the same add again returns the row it made, once.
 */
defineLocal(api.collections.addRow, "mutation", async (ctx, args) => {
  const { collection, host } = await collectionFor(ctx, args.collectionId);
  if ((args.id !== undefined && !isValidId(args.id)) || (args.documentId !== undefined && !isValidId(args.documentId))) fail("invalid_argument", "Invalid row id.");
  if (args.id !== undefined) {
    const existing = await findRow(ctx.db, args.id);
    if (existing) {
      if (existing.row.collectionId !== collection.id) fail("invalid_argument", "That row id is taken.");
      return { id: existing.row.id, documentId: existing.id };
    }
  }
  const rows = await liveRows(ctx.db, collection.id);
  if (rows.length >= COLLECTION_LIMITS.rows) fail("limit_exceeded", "A collection can have up to 2,000 rows.");
  let rank: string;
  if (args.afterRowId) {
    const idx = rows.findIndex((r) => r.row.id === args.afterRowId);
    rank = rankBetween(rows[idx]?.row.rank ?? null, rows[idx + 1]?.row.rank ?? null);
  } else rank = rankBetween(rows[rows.length - 1]?.row.rank ?? null, null);
  const note = await insertDocument(ctx, {
    id: args.documentId,
    title: (args.title ?? "").slice(0, 300),
    kind: "collectionRow",
    parentDocumentId: host.id,
    collectionId: collection.id,
    // A note whose id the client chose may already be open there, with lines typed into it: it starts empty.
    blocks: args.documentId !== undefined ? [] : specsToWireBlocks([{ type: "paragraph", md: "" }]),
  });
  const now = ctx.now();
  let values: Record<string, unknown> = {};
  for (const [propertyId, value] of Object.entries(args.values ?? {})) values = withValue(values, propertyId, normalizeValue(propertyFor(collection, propertyId), value));
  const id = args.id ?? ulid();
  putRow(ctx, note, { id, collectionId: collection.id, rank, values, createdAt: now, updatedAt: now, deletedAt: null });
  ctx.db.put("collections", collection.id, { ...collection, updatedAt: now });
  return { id, documentId: note.id };
});

defineLocal(api.collections.setValue, "mutation", async (ctx, args) => {
  const { collection } = await collectionFor(ctx, args.collectionId);
  const note = await rowFor(ctx.db, collection, args.rowId);
  const prop = propertyFor(collection, args.propertyId);
  const normalized = normalizeValue(prop, args.value);
  const before = Object.hasOwn(note.row.values, prop.id) ? note.row.values[prop.id] : null;
  putRow(ctx, note, { ...note.row, values: withValue(note.row.values, prop.id, normalized), updatedAt: ctx.now() });
  return { before };
});

defineLocal(api.collections.moveRow, "mutation", async (ctx, args) => {
  const { collection } = await collectionFor(ctx, args.collectionId);
  const note = await rowFor(ctx.db, collection, args.rowId);
  const rows = (await liveRows(ctx.db, collection.id)).filter((r) => r.row.id !== note.row.id);
  const idx = args.afterRowId === null ? -1 : rows.findIndex((r) => r.row.id === args.afterRowId);
  const rank = rankBetween(idx >= 0 ? rows[idx]!.row.rank : null, rows[idx + 1]?.row.rank ?? null);
  let row: LocalCollectionRow = { ...note.row, rank, updatedAt: ctx.now() };
  if (args.groupPropertyId !== undefined) {
    const prop = propertyFor(collection, args.groupPropertyId);
    row = { ...row, values: withValue(row.values, prop.id, normalizeValue(prop, args.groupValue ?? null)) };
  }
  putRow(ctx, note, row);
  return null;
});

type PushResult = FunctionReturnType<typeof api.sync.push>[number];

/** Renames a row (its note's title). Goes through sync.push, so derived text and the title follow as for any edit. */
defineLocal(api.collections.renameRow, "mutation", async (ctx, args) => {
  const { collection } = await collectionFor(ctx, args.collectionId);
  const note = await rowFor(ctx.db, collection, args.rowId);
  if (note.inTrash) fail("not_found", "Row not found.");
  const push = LOCAL_FUNCTIONS.get("sync:push");
  if (!push) throw new Error("sync.push has no local handler.");
  const ops: SyncOp[] = [{ opId: ulid(), kind: "document.update", documentId: note.id, patch: { title: args.title.slice(0, 300) }, baseRevision: null }];
  const deviceId = /^[A-Za-z0-9_-]{8,64}$/.test(ctx.deviceId) ? ctx.deviceId : "this-device";
  const [r] = (await (push.handler as (c: LocalMutationCtx, a: unknown) => Promise<PushResult[]>)(ctx, { scope: { kind: "personal" }, deviceId, ops })) ?? [];
  if (!r || r.status === "rejected") fail("forbidden", r?.error?.message ?? "Couldn't rename this row.");
  const renamed = (await ctx.db.get("documents", note.id)) ?? note;
  putRow(ctx, renamed, { ...note.row, updatedAt: ctx.now() });
  return null;
});

defineLocal(api.collections.deleteRow, "mutation", async (ctx, args) => {
  const { collection } = await collectionFor(ctx, args.collectionId);
  const note = await rowFor(ctx.db, collection, args.rowId);
  const now = ctx.now();
  const row = { ...note.row, deletedAt: now };
  // Its note goes to Trash with it.
  if (!note.inTrash) ctx.db.put("documents", note.id, { ...note, row, inTrash: true, deletedAt: now, seq: await ctx.nextSeq() });
  else putRow(ctx, note, row);
  return null;
});

// ---- views ------------------------------------------------------------------------------------------------

/** Adds a view. `id` may be chosen by the client (a view added offline); sending it again returns that view. */
defineLocal(api.collections.addViewToCollection, "mutation", async (ctx, args) => {
  const { collection } = await collectionFor(ctx, args.collectionId);
  if (args.id !== undefined) {
    if (!isValidId(args.id)) fail("invalid_argument", "Invalid view id.");
    const own = Object.hasOwn(collection.views, args.id) ? collection.views[args.id] : undefined;
    if (own && own.deletedAt === null) return { id: own.id };
    for (const other of await ctx.db.list("collections")) {
      const vw = other.id !== collection.id && Object.hasOwn(other.views, args.id) ? other.views[args.id] : undefined;
      if (vw && vw.deletedAt === null) fail("invalid_argument", "That view id is taken.");
    }
  }
  // Created first, as the server lists them: the first select or date property is the one a view uses.
  const props = Object.values(collection.properties)
    .filter((p) => p.deletedAt === null)
    .sort(byCreation);
  const views = liveViews(collection);
  if (views.length >= COLLECTION_LIMITS.views) fail("limit_exceeded", "Up to 20 views per collection.");
  const groupBy = args.type === "board" ? props.find((p) => p.type === "select")?.id : undefined;
  if (args.type === "board" && !groupBy) fail("invalid_argument", "Add a single-select property to group a board by.");
  const dateBy = args.type === "calendar" ? props.find((p) => p.type === "date")?.id : undefined;
  if (args.type === "calendar" && !dateBy) fail("invalid_argument", "Add a date property to show a calendar.");
  const next: LocalCollection = { ...collection, views: { ...collection.views } };
  const id = addView(ctx, next, {
    name: args.name.trim().slice(0, 40) || "View",
    type: args.type,
    groupBy,
    dateBy,
    visibleProperties: props.map((p) => p.id),
    rank: rankBetween(views.map((vw) => vw.rank).sort().pop() ?? null, null),
    id: args.id,
  });
  ctx.db.put("collections", next.id, next);
  return { id };
});

defineLocal(api.collections.updateView, "mutation", async (ctx, args) => {
  const { collection } = await collectionFor(ctx, args.collectionId);
  const view = Object.hasOwn(collection.views, args.viewId) ? collection.views[args.viewId] : undefined;
  if (!view || view.deletedAt !== null) fail("not_found", "View not found.");
  const patch: Partial<LocalCollectionView> = {};
  if (args.name !== undefined) patch.name = args.name.trim().slice(0, 40) || view.name;
  if (args.config) {
    if (view.type === "board" && args.config.groupBy) {
      const prop = propertyFor(collection, args.config.groupBy);
      if (prop.type !== "select" && prop.type !== "formula") fail("invalid_argument", "Boards group by a single-select or formula property.");
    }
    if (view.type === "calendar" && args.config.dateBy) {
      const prop = propertyFor(collection, args.config.dateBy);
      if (prop.type !== "date") fail("invalid_argument", "Calendars place rows by a date property.");
    }
    patch.config = clampCollectionViewConfig(args.config);
  }
  ctx.db.put("collections", collection.id, { ...collection, views: { ...collection.views, [view.id]: { ...view, ...patch } } });
  return null;
});

defineLocal(api.collections.deleteView, "mutation", async (ctx, args) => {
  const { collection } = await collectionFor(ctx, args.collectionId);
  const views = liveViews(collection);
  // Not found first: a delete sent again (its answer was lost) is told it's done, even when one view is left.
  const view = views.find((vw) => vw.id === args.viewId);
  if (!view) fail("not_found", "View not found.");
  if (views.length <= 1) fail("invalid_argument", "A collection needs at least one view.");
  ctx.db.put("collections", collection.id, { ...collection, views: { ...collection.views, [view.id]: { ...view, deletedAt: ctx.now() } } });
  return null;
});
