// Revision 13: the Graph and Reviews pages for the Mac's native screens (all native but the editor). `graph` is
// aiGraph.graph with every node placed by the web's own force layout (lib/graph/layout.ts, deterministic), so the
// Mac draws exactly the picture the web draws; `reviews` is study.queue for the person's day on this device.
// Their commands: review.rate and review.setNewPerDay. And `recent.viewed`, the notes opened last (⌘K's Recent).
import { api } from "@/lib/convex/api";
import { degrees, Simulation, type GraphEdgeData, type GraphNodeData, type Point } from "@/lib/graph/layout";
import { bridges, clusters, type DnaEdge, type DnaNode } from "@/lib/graph/analysis";
import type { CommandDef } from "./commands";
import { requireSpace, source, type ValueViewDef } from "./views";
import { BridgeError, id, num, oneOf, only, optionalId, text } from "./validate";
import type { CommandName, GraphValue, ReviewCard, ReviewsValue, ViewName } from "./protocol";

type Args = Record<string, unknown>;

const ENTITY_KINDS = ["person", "project", "organization", "topic", "decision"] as const;

export function parseGraphArgs(args: Args): Args {
  only(args, ["space", "kinds", "spacing", "pull"]);
  const out: Args = {};
  if (args.spacing !== undefined) out.spacing = num(args, "spacing", { min: 0.5, max: 2 });
  if (args.pull !== undefined) out.pull = num(args, "pull", { min: 0.25, max: 3 });
  const space = optionalId(args, "space");
  if (space !== undefined) out.space = space;
  if (args.kinds !== undefined) {
    if (!Array.isArray(args.kinds) || args.kinds.some((k) => typeof k !== "string" || !(ENTITY_KINDS as readonly string[]).includes(k))) throw new BridgeError("invalid_args", "kinds: people, projects, organizations, topics or decisions.");
    out.kinds = [...new Set(args.kinds as string[])];
  }
  return out;
}

type Group = { id: string; name: string; color: string | null };
type GraphData = {
  full: boolean;
  note: string | null;
  upgrade: boolean;
  truncated: boolean;
  nodes: DnaNode[];
  edges: DnaEdge[];
  folders?: Group[];
  tags?: Group[];
  suggested?: { source: string; target: string; entities: string[] }[];
  duplicates?: { a: string; b: string; score: number }[];
} | null;
type ViewsData = { id: string; name: string; settings: string }[] | null;

/** The layout the web's GraphCanvas settles on for a graph seen for the first time (or, with `previous`, again). */
export function layOut(nodes: readonly GraphNodeData[], edges: readonly GraphEdgeData[], opts: { previous?: ReadonlyMap<string, Point>; spacing?: number; pull?: number } = {}): ReadonlyMap<string, Point> {
  const spacing = opts.spacing ?? 1;
  const sim = new Simulation(
    nodes.map((n) => n.id),
    edges,
    { previous: opts.previous, linkDistance: 70 * spacing, repulsion: 900 * spacing * spacing, pull: opts.pull ?? 1 },
  );
  while (!sim.settled) sim.tick();
  return sim.positions();
}

export function graphValue(d: NonNullable<GraphData>, positions: ReadonlyMap<string, Point>, views: ViewsData = []): GraphValue {
  const deg = degrees(d.edges);
  const found = clusters(d.nodes, d.edges);
  const across = bridges(d.edges, found.of);
  return {
    full: Boolean(d.full),
    note: d.note ?? null,
    upgrade: Boolean(d.upgrade),
    truncated: Boolean(d.truncated),
    nodes: d.nodes.map((n) => {
      const p = positions.get(n.id) ?? { x: 0, y: 0 };
      return {
        id: n.id,
        kind: n.kind,
        label: n.label ?? "",
        x: p.x,
        y: p.y,
        degree: deg.get(n.id) ?? 0,
        folderId: n.folderId ?? null,
        tagIds: n.tagIds ?? [],
        createdAt: n.createdAt ?? null,
        updatedAt: n.updatedAt ?? null,
        cluster: found.of.get(n.id) ?? null,
        bridge: across.has(n.id),
      };
    }),
    edges: d.edges.map((e) => ({ source: e.source, target: e.target, kind: e.kind, inferred: Boolean(e.inferred), createdAt: e.createdAt ?? null })),
    folders: (d.folders ?? []).map((g) => ({ id: g.id, name: g.name, color: g.color ?? null })),
    tags: (d.tags ?? []).map((g) => ({ id: g.id, name: g.name, color: g.color ?? null })),
    clusters: found.clusters.map((c) => ({ id: c.id, name: c.name, size: c.members.length })),
    suggested: (d.suggested ?? []).map((x) => ({ source: x.source, target: x.target, entities: [...x.entities] })),
    duplicates: (d.duplicates ?? []).map((x) => ({ a: x.a, b: x.b, percent: Math.round(x.score * 100) })),
    views: (views ?? []).map((v) => ({ id: v.id, name: v.name, settings: v.settings })),
  };
}

const graph: ValueViewDef = {
  kind: "value",
  parse: parseGraphArgs,
  create: (ctx, args) => {
    const space = requireSpace(ctx.deps(), args.space as string | undefined);
    const kinds = args.kinds as string[] | undefined;
    const src = source<GraphData>(ctx, api.aiGraph.graph, { scope: space.scope, kinds: kinds && kinds.length < ENTITY_KINDS.length ? kinds : undefined }, space.scope);
    const saved = source<ViewsData>(ctx, api.graphViews.list, { scope: space.scope }, space.scope);
    const spacing = (args.spacing as number | undefined) ?? 1;
    const pull = (args.pull as number | undefined) ?? 1;
    // The layout is the slow part: kept while the graph's shape stays the same, and laid out again from where
    // things were (a new [[link]] moves its notes, not the whole map).
    let laid: { key: string; positions: ReadonlyMap<string, Point> } | null = null;
    return {
      signals: [src, saved],
      compute: () => {
        const s = src.snapshot();
        if (s.error) return { value: undefined, stale: false, error: s.error };
        if (s.value === undefined) return { value: undefined, stale: s.stale, error: null };
        const d = s.value ?? { full: false, note: null, upgrade: false, truncated: false, nodes: [], edges: [] };
        const key = `${d.nodes.map((n) => n.id).join(",")}|${d.edges.map((e) => `${e.source}>${e.target}`).join(",")}`;
        if (laid?.key !== key) laid = { key, positions: layOut(d.nodes, d.edges, { previous: laid?.positions, spacing, pull }) };
        // Saved views are extra: the map shows without them (and while they load).
        const v = saved.snapshot();
        return { value: graphValue(d, laid.positions, v.error ? [] : (v.value ?? [])), stale: s.stale, error: null };
      },
    };
  },
};

// ---- reviews

/** The person's day by this device's clock (components/study/review.ts reviewWindow): now to the minute. */
export function reviewWindow(at: number): { now: number; dayStart: number; dayEnd: number } {
  const start = new Date(at);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { now: at - (at % 60_000), dayStart: start.getTime(), dayEnd: end.getTime() };
}

export function parseReviewsArgs(args: Args): Args {
  only(args, ["noteId", "space"]);
  const noteId = optionalId(args, "noteId");
  const space = optionalId(args, "space");
  if (noteId !== undefined && space !== undefined) throw new BridgeError("invalid_args", "A note or a space, not both.");
  return { ...(noteId !== undefined ? { noteId } : {}), ...(space !== undefined ? { space } : {}) };
}

type QueueData = {
  cards: { blockId: string; kind: string; documentId: string; documentTitle: string; front: string; back: string; isNew: boolean; lastReview: number | null; intervals: Record<"again" | "hard" | "good" | "easy", number> }[];
  counts: { due: number; new: number; later: number };
  total: number;
  hasCards: boolean;
  documentTitle: string | null;
  newPerDay: number;
} | null;

export function reviewsValue(d: QueueData): ReviewsValue {
  if (!d) return { found: false, cards: [], due: 0, new: 0, later: 0, total: 0, hasCards: false, noteTitle: null, newPerDay: 20 };
  return {
    found: true,
    cards: d.cards.map(
      (c): ReviewCard => ({
        blockId: c.blockId,
        kind: c.kind,
        noteId: c.documentId,
        noteTitle: c.documentTitle ?? "",
        front: c.front ?? "",
        back: c.back ?? "",
        isNew: Boolean(c.isNew),
        lastReview: c.lastReview ?? null,
        intervals: { again: c.intervals.again, hard: c.intervals.hard, good: c.intervals.good, easy: c.intervals.easy },
      }),
    ),
    due: d.counts.due,
    new: d.counts.new,
    later: d.counts.later,
    total: d.total,
    hasCards: Boolean(d.hasCards),
    noteTitle: d.documentTitle ?? null,
    newPerDay: d.newPerDay,
  };
}

const reviews: ValueViewDef = {
  kind: "value",
  parse: parseReviewsArgs,
  create: (ctx, args) => {
    const target: Args = args.noteId ? { documentId: args.noteId } : args.space ? { scope: requireSpace(ctx.deps(), args.space as string).scope } : {};
    const src = source<QueueData>(ctx, api.study.queue, { ...target, ...reviewWindow(Date.now()), limit: 20 }, null);
    return {
      signals: [src],
      compute: () => {
        const s = src.snapshot();
        if (s.error) return { value: undefined, stale: false, error: s.error };
        return { value: s.value === undefined ? undefined : reviewsValue(s.value), stale: s.stale, error: null };
      },
    };
  },
};

// ---- recent.viewed

type RecentData = { id: string; title: string; icon: string | null; updatedAt: number }[];

export function parseRecentViewedArgs(args: Args): Args {
  only(args, ["space", "limit"]);
  const space = optionalId(args, "space");
  return { ...(space !== undefined ? { space } : {}), limit: num(args, "limit", { min: 1, max: 30, fallback: 8 }) };
}

const recentViewed: ValueViewDef = {
  kind: "value",
  parse: parseRecentViewedArgs,
  create: (ctx, args) => {
    const space = requireSpace(ctx.deps(), args.space as string | undefined);
    const src = source<RecentData>(ctx, api.documents.recent, { scope: space.scope, limit: args.limit }, space.scope);
    return {
      signals: [src],
      compute: () => {
        const s = src.snapshot();
        if (s.error) return { value: undefined, stale: false, error: s.error };
        return { value: s.value === undefined ? undefined : { rows: s.value.map((r) => ({ id: r.id, title: r.title ?? "", icon: r.icon ?? null, updatedAt: r.updatedAt })) }, stale: s.stale, error: null };
      },
    };
  },
};

// ---- graph.views

const graphViews: ValueViewDef = {
  kind: "value",
  parse: (args) => {
    only(args, ["space"]);
    const space = optionalId(args, "space");
    return space !== undefined ? { space } : {};
  },
  create: (ctx, args) => {
    const space = requireSpace(ctx.deps(), args.space as string | undefined);
    const src = source<ViewsData>(ctx, api.graphViews.list, { scope: space.scope }, space.scope);
    return {
      signals: [src],
      compute: () => {
        const s = src.snapshot();
        if (s.error) return { value: { views: [] }, stale: false, error: null };
        return { value: s.value === undefined ? undefined : { views: (s.value ?? []).map((v) => ({ id: v.id, name: v.name, settings: v.settings })) }, stale: s.stale, error: null };
      },
    };
  },
};

export const SCREEN_VALUE_VIEWS = { graph, "graph.views": graphViews, reviews, "recent.viewed": recentViewed } satisfies Partial<Record<ViewName, ValueViewDef>>;

const NEW_PER_DAY = [0, 10, 20, 30, 50, 100];

export const SCREEN_COMMANDS = {
  "graph.link": {
    async run(deps, args) {
      only(args, ["noteId", "targetId"]);
      await deps.client.mutation(api.aiGraph.linkNote, { documentId: id(args, "noteId"), targetId: id(args, "targetId") });
      return { ok: true };
    },
  },
  "graph.saveView": {
    async run(deps, args) {
      only(args, ["space", "id", "name", "settings"]);
      const space = requireSpace(deps, optionalId(args, "space"));
      const viewId = optionalId(args, "id");
      const name = text(args, "name", { max: 60 }) ?? "";
      const settings = text(args, "settings", { max: 8000 }) ?? "{}";
      const r = (await deps.client.mutation(api.graphViews.save, { scope: space.scope, ...(viewId ? { id: viewId } : {}), name, settings })) as { id: string };
      return { id: r.id };
    },
  },
  "graph.tag": {
    async run(deps, args) {
      only(args, ["notes", "tagId"]);
      const tagId = id(args, "tagId");
      if (!Array.isArray(args.notes) || args.notes.length > 200) throw new BridgeError("invalid_args", "notes: up to 200 notes.");
      let tagged = 0;
      for (const raw of args.notes as unknown[]) {
        const n = (raw ?? {}) as Record<string, unknown>;
        const noteId = id(n, "id");
        const current = Array.isArray(n.tagIds) ? n.tagIds.filter((t): t is string => typeof t === "string") : [];
        if (current.includes(tagId)) continue;
        await deps.client.mutation(api.organization.setDocumentTags, { documentId: noteId, tagIds: [...current, tagId] });
        tagged++;
      }
      return { tagged };
    },
  },
  "graph.removeView": {
    async run(deps, args) {
      only(args, ["id"]);
      await deps.client.mutation(api.graphViews.remove, { id: id(args, "id") });
      return { ok: true };
    },
  },
  "review.rate": {
    async run(deps, args) {
      only(args, ["blockId", "rating", "lastReview"]);
      const lastReview = args.lastReview === null ? null : num(args, "lastReview");
      await deps.client.mutation(api.study.review, { blockId: id(args, "blockId"), rating: oneOf(args, "rating", ["again", "hard", "good", "easy"] as const), lastReview });
      return { ok: true };
    },
  },
  "review.setNewPerDay": {
    async run(deps, args) {
      only(args, ["value"]);
      const value = num(args, "value");
      if (!NEW_PER_DAY.includes(value)) throw new BridgeError("invalid_args", "value: 0, 10, 20, 30, 50 or 100.");
      await deps.client.mutation(api.study.setNewPerDay, { value });
      return { ok: true };
    },
  },
} satisfies Partial<Record<CommandName, CommandDef>>;
