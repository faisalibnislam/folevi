import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { rankSequence, ulid } from "@folevi/editor-schema";
import { fail } from "./errors";
import { insertScoped, scopeOfRow, type Scope } from "./scope";
import { nextSeq } from "./seq";

export type PropertyType = Doc<"collectionProperties">["type"];

/** Validates and normalizes a collection cell value for its property type. */
export function normalizeValue(
  property: Pick<Doc<"collectionProperties">, "type" | "options">,
  value: unknown,
): unknown {
  if (value === null || value === undefined || value === "") return null;
  switch (property.type) {
    case "text":
      if (typeof value !== "string") fail("invalid_argument", "Expected text.");
      return value.slice(0, 2000);
    case "number": {
      const n = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(n)) fail("invalid_argument", "Expected a number.");
      return n;
    }
    case "checkbox":
      if (typeof value !== "boolean") fail("invalid_argument", "Expected true or false.");
      return value;
    case "date":
      if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail("invalid_argument", "Expected a date (YYYY-MM-DD).");
      return value;
    case "select":
      if (typeof value !== "string" || !property.options.some((o) => o.id === value)) fail("invalid_argument", "Unknown option.");
      return value;
    case "multiSelect": {
      if (!Array.isArray(value)) fail("invalid_argument", "Expected a list of options.");
      const ids = [...new Set(value.filter((x): x is string => typeof x === "string"))];
      if (ids.some((id) => !property.options.some((o) => o.id === id))) fail("invalid_argument", "Unknown option.");
      return ids;
    }
    case "url":
      if (typeof value !== "string" || !/^https?:\/\/\S+$/i.test(value) || value.length > 2048) fail("invalid_argument", "Expected a web address.");
      return value;
    case "person":
      if (typeof value !== "string") fail("invalid_argument", "Expected a person.");
      return value;
    case "relation": {
      if (!Array.isArray(value)) fail("invalid_argument", "Expected a list of documents.");
      return [...new Set(value.filter((x): x is string => typeof x === "string"))].slice(0, 50);
    }
  }
}

export async function createCollection(
  ctx: MutationCtx,
  input: {
    /** The hosting document's scope. */
    scope: Scope;
    documentId: Id<"documents">;
    name: string;
    seq: number;
    properties: { key?: string; name: string; type: PropertyType; options?: { id: string; name: string; color: string }[] }[];
  },
): Promise<{ collectionId: Id<"collections">; publicId: string; propertyIds: Map<string, Id<"collectionProperties">>; propertyPublicIds: Map<string, string> }> {
  const now = Date.now();
  const publicId = ulid();
  const collectionId = await insertScoped(ctx, "collections", input.scope, {
    publicId,
    documentId: input.documentId,
    name: input.name,
    createdAt: now,
    updatedAt: now,
    seq: input.seq,
  });
  const ranks = rankSequence(input.properties.length);
  const propertyIds = new Map<string, Id<"collectionProperties">>();
  const propertyPublicIds = new Map<string, string>();
  for (const [i, p] of input.properties.entries()) {
    const pid = ulid();
    const id = await ctx.db.insert("collectionProperties", {
      publicId: pid,
      collectionId,
      name: p.name,
      type: p.type,
      options: p.options ?? [],
      rank: ranks[i]!,
      createdAt: now,
    });
    propertyIds.set(p.key ?? p.name, id);
    propertyPublicIds.set(p.key ?? p.name, pid);
  }
  return { collectionId, publicId, propertyIds, propertyPublicIds };
}

export async function addView(
  ctx: MutationCtx,
  collectionId: Id<"collections">,
  view: { name: string; type: Doc<"collectionViews">["type"]; groupBy?: string; visibleProperties: string[]; rank: string },
): Promise<string> {
  const publicId = ulid();
  await ctx.db.insert("collectionViews", {
    publicId,
    collectionId,
    name: view.name,
    type: view.type,
    config: {
      filters: [],
      sorts: [],
      groupBy: view.groupBy,
      visibleProperties: view.visibleProperties,
      cardPreview: view.type === "gallery" ? "cover" : "none",
      cardSize: "medium",
    },
    rank: view.rank,
    createdAt: Date.now(),
  });
  return publicId;
}

/**
 * A copied page (Duplicate, or a page made from a template) gets collections of its own: the same
 * properties and views, without the rows. Its cloned blocks still name the original's collections, and
 * sharing them meant a row deleted in the copy was deleted in the original too.
 */
export async function copyCollectionsInto(ctx: MutationCtx, doc: Doc<"documents">): Promise<void> {
  const rows = await ctx.db
    .query("blocks")
    .withIndex("by_document", (q) => q.eq("documentId", doc._id))
    .collect();
  for (const row of rows) {
    if (row.type !== "collection" || row.deletedAt !== undefined) continue;
    const props = (row.props ?? {}) as { collectionId?: string; viewId?: string };
    if (!props.collectionId) continue;
    const source = await ctx.db
      .query("collections")
      .withIndex("by_public_id", (q) => q.eq("publicId", props.collectionId!))
      .unique();
    if (!source || source.documentId === doc._id) continue;
    const now = Date.now();
    const publicId = ulid();
    const collectionId = await insertScoped(ctx, "collections", scopeOfRow(doc), {
      publicId,
      documentId: doc._id,
      name: source.name,
      createdAt: now,
      updatedAt: now,
      seq: await nextSeq(ctx, scopeOfRow(doc)),
    });
    const propertyIds = new Map<string, string>();
    const properties = await ctx.db
      .query("collectionProperties")
      .withIndex("by_collection", (q) => q.eq("collectionId", source._id))
      .collect();
    for (const p of properties) {
      if (p.deletedAt !== undefined) continue;
      const pid = ulid();
      propertyIds.set(p.publicId, pid);
      await ctx.db.insert("collectionProperties", { publicId: pid, collectionId, name: p.name, type: p.type, options: p.options, rank: p.rank, createdAt: now });
    }
    const mapId = (id: string) => propertyIds.get(id);
    let viewId: string | undefined;
    let firstView: string | undefined;
    const views = await ctx.db
      .query("collectionViews")
      .withIndex("by_collection", (q) => q.eq("collectionId", source._id))
      .collect();
    for (const vw of views) {
      const vid = ulid();
      if (vw.publicId === props.viewId) viewId = vid;
      firstView ??= vid;
      const c = vw.config;
      await ctx.db.insert("collectionViews", {
        publicId: vid,
        collectionId,
        name: vw.name,
        type: vw.type,
        rank: vw.rank,
        createdAt: now,
        config: {
          ...c,
          filters: c.filters.filter((f) => mapId(f.propertyId)).map((f) => ({ ...f, propertyId: mapId(f.propertyId)! })),
          sorts: c.sorts.filter((x) => mapId(x.propertyId)).map((x) => ({ ...x, propertyId: mapId(x.propertyId)! })),
          groupBy: c.groupBy ? mapId(c.groupBy) : undefined,
          visibleProperties: c.visibleProperties.map(mapId).filter((x): x is string => Boolean(x)),
        },
      });
    }
    viewId ??= firstView;
    await ctx.db.patch(row._id, { props: { ...props, collectionId: publicId, ...(viewId ? { viewId } : {}) } });
  }
}
