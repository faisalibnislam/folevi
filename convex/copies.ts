// Copy to: a note (and, if asked, its sub-pages) copied into another place, your Personal or a workspace
// where you can add pages. Personal and workspaces never share rows (docs/ACCOUNT_MODEL_PLAN.md), so this
// makes new notes owned there, like Duplicate does in the same place:
//
// - blocks get new ids; images, files and recordings get files of their own in the destination, counted
//   toward its storage (FileCopies: refused when they don't fit);
// - links between the copied pages point at the copies; links to anything else stay as they are (they may
//   not open for people in the destination, the way a link to a page they can't open never does);
// - a collection (database) becomes a plain table of what it showed: the person's view of its rows and
//   values. Its rows are notes of the original place, which a copy can't share;
// - comments, version history, tags, stars and sharing stay with the original;
// - a note theme the destination's plan doesn't include falls back to Plain.
//
// Moving between places isn't offered: a copy leaves the original where it was.
import { v } from "convex/values";
import { mutation, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { LIMITS, SCHEMA_VERSION, evaluateCollectionFormulas, ulid, type InlineNode, type WireBlock } from "@folevi/editor-schema";
import { assertWritable, getDocumentByPublicId, PageReader, requireDocument, requireProfile, resolveScope } from "./lib/auth";
import { DEFAULTS, liveBlocks, toWireBlock } from "./lib/documents";
import { cloneBlocks, createDocument } from "./lib/create";
import { FileCopies } from "./lib/fileCopies";
import { effectiveTheme, scopePlan } from "./lib/noteThemes";
import { planAllows } from "./lib/themes";
import { syncLinks } from "./lib/syncEngine";
import { fail } from "./lib/errors";
import { consume } from "./lib/rateLimit";
import { inScope, sameScope, scopeOfRow, vScopeArg, type Scope } from "./lib/scope";

/** Pages one copy may make (the note and its sub-pages), and blocks across them. */
export const MAX_COPY_PAGES = 50;
export const MAX_COPY_BLOCKS = 5000;

type Ctx = MutationCtx;

/**
 * The note and (with `withSubpages`) every sub-page under it the person can open, parents before their
 * children and siblings in their order. Collection rows aren't sub-pages here: their collection becomes a
 * table in the copy. Pages in Trash stay behind.
 */
async function pagesToCopy(ctx: Ctx, reader: PageReader, root: Doc<"documents">, withSubpages: boolean): Promise<Doc<"documents">[]> {
  const out = [root];
  if (!withSubpages) return out;
  for (let i = 0; i < out.length; i++) {
    const children = (
      await ctx.db
        .query("documents")
        .withIndex("by_parent", (q) => q.eq("parentDocumentId", out[i]!._id))
        .collect()
    )
      .filter((d) => !d.inTrash && d.kind !== "collectionRow")
      .sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : a._creationTime - b._creationTime));
    for (const child of children) {
      if (!(await reader.canOpen(child))) continue;
      out.push(child);
      if (out.length > MAX_COPY_PAGES) fail("limit_exceeded", `A copy can take up to ${MAX_COPY_PAGES} pages. Copy this note without its sub-pages, or copy its sub-pages one at a time.`);
    }
  }
  return out;
}

const isPageLink = (n: unknown): n is { type: "pageLink"; documentId: string } =>
  Boolean(n && typeof n === "object" && (n as { type?: unknown }).type === "pageLink" && typeof (n as { documentId?: unknown }).documentId === "string");

/** Links to pages that were copied too point at their copies. */
function remapLinks(blocks: WireBlock[], ids: Map<string, string>): WireBlock[] {
  const nodes = (list: unknown): unknown =>
    Array.isArray(list) && list.some((n) => isPageLink(n) && ids.has(n.documentId)) ? list.map((n) => (isPageLink(n) && ids.has(n.documentId) ? { ...n, documentId: ids.get(n.documentId)! } : n)) : list;
  return blocks.map((b) => {
    let next = b;
    const props = b.props as Record<string, unknown>;
    if (b.type === "page" && typeof props.documentId === "string" && ids.has(props.documentId)) next = { ...next, props: { ...props, documentId: ids.get(props.documentId)! } };
    if (Array.isArray(b.text)) next = { ...next, text: nodes(b.text) as WireBlock["text"] };
    const rows = (next.props as { rows?: unknown }).rows;
    if (b.type === "table" && Array.isArray(rows)) next = { ...next, props: { ...(next.props as Record<string, unknown>), rows: rows.map((r) => (Array.isArray(r) ? r.map(nodes) : r)) } };
    return next;
  });
}

const cell = (text: string): InlineNode[] => (text ? [{ type: "text", text: text.slice(0, 2000) }] : []);

/**
 * A collection block as a plain table of what the person sees in it: a Name column and one column per
 * property, a row per row page they can open. Rows and columns past the table limits are left out.
 */
async function collectionTable(ctx: Ctx, reader: PageReader, block: WireBlock): Promise<WireBlock> {
  const collectionId = (block.props as { collectionId?: unknown }).collectionId;
  const collection =
    typeof collectionId === "string"
      ? await ctx.db
          .query("collections")
          .withIndex("by_public_id", (q) => q.eq("publicId", collectionId))
          .unique()
      : null;
  const properties = collection
    ? (
        await ctx.db
          .query("collectionProperties")
          .withIndex("by_collection", (q) => q.eq("collectionId", collection._id))
          .collect()
      )
        .filter((p) => !p.deletedAt)
        .sort((a, b) => (a.rank < b.rank ? -1 : 1))
        .slice(0, LIMITS.maxTableColumns - 1)
    : [];
  const rows: InlineNode[][][] = [[cell("Name"), ...properties.map((p) => cell(p.name))]];
  if (collection && !collection.deletedAt) {
    const rowDocs = (
      await ctx.db
        .query("collectionRows")
        .withIndex("by_collection", (q) => q.eq("collectionId", collection._id))
        .take(2000)
    )
      .filter((r) => !r.deletedAt)
      .sort((a, b) => (a.rank < b.rank ? -1 : 1));
    const names = new Map<string, string>();
    const kept: { title: string; values: Map<Id<"collectionProperties">, unknown> }[] = [];
    for (const r of rowDocs) {
      if (kept.length + 1 >= LIMITS.maxTableRows) break;
      const doc = await ctx.db.get(r.documentId);
      if (!doc || doc.inTrash || !(await reader.canOpen(doc))) continue;
      const values = new Map<Id<"collectionProperties">, unknown>();
      for (const val of await ctx.db
        .query("collectionValues")
        .withIndex("by_row", (q) => q.eq("rowId", r._id))
        .collect()) {
        values.set(val.propertyId, val.value);
      }
      kept.push({ title: doc.title, values });
    }
    // Formula columns hold what the formulas show (the copy is a plain table). People are named first, so
    // a formula that uses a person sees their name.
    const formulas = properties.some((p) => p.type === "formula")
      ? evaluateCollectionFormulas(
          properties.map((p) => ({ id: p.publicId, name: p.name, type: p.type, options: p.options, formula: p.formula ?? null, numberFormat: p.numberFormat ?? null })),
          await Promise.all(
            kept.map(async (k) => {
              const values: Record<string, unknown> = {};
              for (const p of properties) {
                const value = k.values.get(p._id);
                values[p.publicId] = p.type === "person" ? await valueText(ctx, reader, p, value, names) : value;
              }
              return { title: k.title, values };
            }),
          ),
        )
      : null;
    for (const [i, k] of kept.entries()) {
      const line = [cell(k.title)];
      for (const p of properties) line.push(cell(p.type === "formula" ? (formulas?.[i]?.[p.publicId]?.display ?? "") : await valueText(ctx, reader, p, k.values.get(p._id), names)));
      rows.push(line);
    }
  }
  return { id: block.id, type: "table", parentId: block.parentId, rank: block.rank, schemaVersion: SCHEMA_VERSION, text: [], props: { rows, headerRow: true } };
}

/** A collection value as text, the way the collection shows it. */
async function valueText(ctx: Ctx, reader: PageReader, property: Doc<"collectionProperties">, value: unknown, names: Map<string, string>): Promise<string> {
  if (value === undefined || value === null) return "";
  const option = (id: unknown) => property.options.find((o) => o.id === id)?.name ?? "";
  switch (property.type) {
    case "checkbox":
      return value === true ? "Yes" : "No";
    case "number":
      return typeof value === "number" ? String(value) : "";
    case "select":
      return option(value);
    case "multiSelect":
      return Array.isArray(value) ? value.map(option).filter(Boolean).join(", ") : "";
    case "person": {
      if (typeof value !== "string") return "";
      if (!names.has(value)) {
        const id = ctx.db.normalizeId("profiles", value);
        const p = id ? await ctx.db.get(id) : null;
        names.set(value, p && p.status !== "deleted" ? p.displayName : "");
      }
      return names.get(value)!;
    }
    case "relation": {
      if (!Array.isArray(value)) return "";
      const titles: string[] = [];
      for (const id of value.slice(0, 20)) {
        const doc = typeof id === "string" ? await getDocumentByPublicId(ctx, id) : null;
        if (doc && !doc.inTrash && (await reader.canOpen(doc))) titles.push(doc.title || "Untitled");
      }
      return titles.join(", ");
    }
    default:
      return typeof value === "string" ? value : "";
  }
}

/** The note theme the copy can keep: an artwork the destination's plan includes, else Plain. */
async function coverFor(ctx: Ctx, scope: Scope, cover: Doc<"documents">["cover"]): Promise<Doc<"documents">["cover"]> {
  if (cover.kind !== "art" || !cover.value) return cover;
  const theme = await effectiveTheme(ctx, cover.value);
  if (!theme || theme.status !== "published") return DEFAULTS.cover;
  if (theme.plan !== "free" && !planAllows(await scopePlan(ctx, scope), theme.plan)) return DEFAULTS.cover;
  return cover;
}

export const copyTo = mutation({
  args: {
    documentId: v.string(),
    /** Personal (always your own) or a workspace where you can add pages. */
    destination: vScopeArg,
    /** A folder there for the copy (default: Drafts). */
    folderId: v.optional(v.union(v.string(), v.null())),
    /** Copy the sub-pages too (default yes). */
    includeSubpages: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    // Reading the note is enough to copy it; adding pages where it goes takes edit rights there.
    const { doc: root } = await requireDocument(ctx, profile, args.documentId, "read");
    if (root.inTrash) fail("invalid_argument", "Restore this note from Trash before copying it.");
    const destination = await resolveScope(ctx, profile, args.destination, "edit");
    const scope = destination.scope;
    await consume(ctx, "bulk", profile._id);
    let folderId: Id<"folders"> | undefined;
    if (args.folderId) {
      const folder = await ctx.db
        .query("folders")
        .withIndex("by_public_id", (q) => q.eq("publicId", args.folderId!))
        .unique();
      if (!folder || !inScope(folder, scope) || folder.deletedAt) fail("not_found", "Folder not found.");
      folderId = folder._id;
    }

    const reader = await PageReader.forScope(ctx, profile, scopeOfRow(root));
    const pages = await pagesToCopy(ctx, reader, root, args.includeSubpages ?? true);
    // Every copied page gets its id up front, so links between them can point at the copies.
    const ids = new Map(pages.map((p) => [p.publicId, ulid()] as const));
    const copies = new Map<Id<"documents">, Doc<"documents">>();
    const here = sameScope(scopeOfRow(root), scope);
    let blockCount = 0;
    for (const page of pages) {
      const source = await liveBlocks(ctx, page._id);
      blockCount += source.length;
      if (blockCount > MAX_COPY_BLOCKS) fail("limit_exceeded", "This note is too long to copy with its sub-pages. Copy it without them, or copy its sub-pages one at a time.");
      let blocks = remapLinks(cloneBlocks(source.map(toWireBlock)), ids);
      const tables: WireBlock[] = [];
      for (const b of blocks) tables.push(b.type === "collection" ? await collectionTable(ctx, reader, b) : b);
      blocks = tables;
      const files = new FileCopies(ctx, profile);
      blocks = await files.blocks(blocks);
      let cover = await files.cover(page.cover);
      // A theme image that couldn't be copied (not one of a note's files) stays where it was: Plain instead.
      if (!here && cover?.kind === "image" && cover.value === page.cover.value) cover = DEFAULTS.cover;
      const isRoot = page._id === root._id;
      const copy = await createDocument(ctx, {
        scope,
        actor: profile,
        publicId: ids.get(page.publicId)!,
        title: isRoot && here ? `${page.title || "Untitled"} (copy)` : page.title,
        icon: page.icon,
        kind: page.kind === "template" ? "template" : "document",
        parentDocumentId: isRoot ? undefined : copies.get(page.parentDocumentId!)!._id,
        folderId: isRoot && page.kind !== "template" ? folderId : undefined,
        style: page.style,
        cover: cover ? await coverFor(ctx, scope, cover) : undefined,
        blocks,
      });
      await files.commit(copy);
      copies.set(page._id, copy);
      // Backlinks for the copy's links (Linked from on the pages it links to).
      for (const row of await liveBlocks(ctx, copy._id)) {
        const linked = row.type === "page" || JSON.stringify(row.text).includes('"pageLink"') || (row.type === "table" && JSON.stringify(row.props).includes('"pageLink"'));
        if (linked) await syncLinks(ctx, copy, row);
      }
    }
    const copy = copies.get(root._id)!;
    const place = destination.workspace ? destination.workspace.name : "Personal";
    return { id: copy.publicId, title: copy.title, pages: pages.length, place };
  },
});
