// Foli DNA in a library on this device (docs/LOCAL_MODE_PLAN.md, L3): the notes and the links between them, read
// from the library (LocalDocument.links, kept like the server's documentLinks), with their folders, tags and dates.
// No entities, suggestions or duplicates: those come from Foli AI's index on the server. Saved views live in the
// library's meta ("graphViews"), so they travel with it.
import { ulid } from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";
import { fail } from "../errors";
import { defineLocal } from "../registry";
import { checkScope } from "./shared";

/** As the server's GRAPH_LIMITS: the most notes and links the map gets. */
const NOTES = 500;
const EDGES = 2_500;
const LOCAL_NOTE = "In a library on this device, Foli DNA shows the links between notes.";
const VIEWS_KEY = "graphViews";
type StoredView = { id: string; name: string; settings: string; updatedAt: number };

defineLocal(api.aiGraph.graph, "query", async (ctx, args) => {
  checkScope(args.scope);
  const docs = (await ctx.db.list("documents"))
    .filter((d) => !d.inTrash && d.kind !== "template" && d.kind !== "collectionRow" && !d.pending)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const truncated = docs.length > NOTES;
  const shown = docs.slice(0, NOTES);
  const ids = new Set(shown.map((d) => d.id));
  const edges: { source: string; target: string; kind: "link"; inferred: boolean; createdAt?: number }[] = [];
  const seen = new Set<string>();
  for (const d of shown) {
    for (const l of d.links ?? []) {
      if (!ids.has(l.target) || l.target === d.id) continue;
      const key = [d.id, l.target].sort().join(":");
      if (seen.has(key) || edges.length >= EDGES) continue;
      seen.add(key);
      edges.push({ source: d.id, target: l.target, kind: "link", inferred: false });
    }
  }
  const folderIds = new Set(shown.map((d) => d.folderId).filter((f): f is string => Boolean(f)));
  const folders = (await ctx.db.list("folders")).filter((f) => folderIds.has(f.id) && f.deletedAt === null).map((f) => ({ id: f.id, name: f.name, color: f.color })).sort((a, b) => a.name.localeCompare(b.name));
  const tagIds = new Set(shown.flatMap((d) => d.tagIds));
  const tags = (await ctx.db.list("tags")).filter((t) => tagIds.has(t.id)).map((t) => ({ id: t.id, name: t.name, color: t.color })).sort((a, b) => a.name.localeCompare(b.name));
  return {
    full: false,
    note: LOCAL_NOTE,
    upgrade: false,
    truncated,
    nodes: shown.map((d) => ({ id: d.id, kind: "note" as const, label: d.title || "Untitled", icon: d.icon, folderId: d.folderId, tagIds: [...d.tagIds], createdAt: d.createdAt, updatedAt: d.updatedAt })),
    edges,
    folders,
    tags,
    suggested: [],
    duplicates: [],
  };
});

defineLocal(api.graphViews.list, "query", async (ctx, args) => {
  checkScope(args.scope);
  const views = ((await ctx.db.get("meta", VIEWS_KEY)) as StoredView[] | undefined) ?? [];
  return [...views].sort((a, b) => b.updatedAt - a.updatedAt);
});

defineLocal(api.graphViews.save, "mutation", async (ctx, args) => {
  checkScope(args.scope);
  const name = args.name.trim().slice(0, 60);
  if (!name) fail("invalid_argument", "Give the view a name.");
  const views = [...(((await ctx.db.get("meta", VIEWS_KEY)) as StoredView[] | undefined) ?? [])];
  const now = Date.now();
  const at = args.id ? views.findIndex((v) => v.id === args.id) : -1;
  if (args.id && at < 0) fail("not_found", "That view is gone.");
  if (at < 0 && views.length >= 30) fail("limit_exceeded", "You can keep 30 saved views here. Remove one first.");
  const id = at >= 0 ? views[at]!.id : `gv_${ulid()}`;
  const view = { id, name, settings: args.settings, updatedAt: now };
  if (at >= 0) views[at] = view;
  else views.push(view);
  ctx.db.put("meta", VIEWS_KEY, views);
  return { id };
});

defineLocal(api.graphViews.remove, "mutation", async (ctx, args) => {
  const views = ((await ctx.db.get("meta", VIEWS_KEY)) as StoredView[] | undefined) ?? [];
  const next = views.filter((v) => v.id !== args.id);
  ctx.db.put("meta", VIEWS_KEY, next);
  return { removed: next.length !== views.length };
});
