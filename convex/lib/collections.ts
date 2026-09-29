import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { rankSequence, ulid } from "@folevi/editor-schema";
import { fail } from "./errors";
import { insertScoped, type Scope } from "./scope";

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
