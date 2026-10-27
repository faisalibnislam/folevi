// Revision 13: the Graph and Reviews pages for the Mac's native screens (all native but the editor). `graph` is
// aiGraph.graph with every node placed by the web's own force layout (lib/graph/layout.ts, deterministic), so the
// Mac draws exactly the picture the web draws; `reviews` is study.queue for the person's day on this device.
// Their commands: review.rate and review.setNewPerDay.
import { api } from "@/lib/convex/api";
import { degrees, Simulation, type GraphEdgeData, type GraphNodeData, type Point } from "@/lib/graph/layout";
import type { CommandDef } from "./commands";
import { requireSpace, source, type ValueViewDef } from "./views";
import { BridgeError, id, num, oneOf, only, optionalId } from "./validate";
import type { CommandName, GraphValue, ReviewCard, ReviewsValue, ViewName } from "./protocol";

type Args = Record<string, unknown>;

const ENTITY_KINDS = ["person", "project", "organization", "topic", "decision"] as const;

export function parseGraphArgs(args: Args): Args {
  only(args, ["space", "kinds"]);
  const out: Args = {};
  const space = optionalId(args, "space");
  if (space !== undefined) out.space = space;
  if (args.kinds !== undefined) {
    if (!Array.isArray(args.kinds) || args.kinds.some((k) => typeof k !== "string" || !(ENTITY_KINDS as readonly string[]).includes(k))) throw new BridgeError("invalid_args", "kinds: people, projects, organizations, topics or decisions.");
    out.kinds = [...new Set(args.kinds as string[])];
  }
  return out;
}

type GraphData = { full: boolean; note: string | null; upgrade: boolean; truncated: boolean; nodes: GraphNodeData[]; edges: GraphEdgeData[] } | null;

/** The layout the web's GraphCanvas settles on for a graph seen for the first time. */
export function layOut(nodes: readonly GraphNodeData[], edges: readonly GraphEdgeData[]): ReadonlyMap<string, Point> {
  const sim = new Simulation(
    nodes.map((n) => n.id),
    edges,
  );
  while (!sim.settled) sim.tick();
  return sim.positions();
}

export function graphValue(d: NonNullable<GraphData>, positions: ReadonlyMap<string, Point>): GraphValue {
  const deg = degrees(d.edges);
  return {
    full: Boolean(d.full),
    note: d.note ?? null,
    upgrade: Boolean(d.upgrade),
    truncated: Boolean(d.truncated),
    nodes: d.nodes.map((n) => {
      const p = positions.get(n.id) ?? { x: 0, y: 0 };
      return { id: n.id, kind: n.kind, label: n.label ?? "", x: p.x, y: p.y, degree: deg.get(n.id) ?? 0 };
    }),
    edges: d.edges.map((e) => ({ source: e.source, target: e.target, kind: e.kind, inferred: Boolean(e.inferred) })),
  };
}

const graph: ValueViewDef = {
  kind: "value",
  parse: parseGraphArgs,
  create: (ctx, args) => {
    const space = requireSpace(ctx.deps(), args.space as string | undefined);
    const kinds = args.kinds as string[] | undefined;
    const src = source<GraphData>(ctx, api.aiGraph.graph, { scope: space.scope, kinds: kinds && kinds.length < ENTITY_KINDS.length ? kinds : undefined }, space.scope);
    // The layout is the slow part: kept while the graph's shape stays the same.
    let laid: { key: string; positions: ReadonlyMap<string, Point> } | null = null;
    return {
      signals: [src],
      compute: () => {
        const s = src.snapshot();
        if (s.error) return { value: undefined, stale: false, error: s.error };
        if (s.value === undefined) return { value: undefined, stale: s.stale, error: null };
        const d = s.value ?? { full: false, note: null, upgrade: false, truncated: false, nodes: [], edges: [] };
        const key = `${d.nodes.map((n) => n.id).join(",")}|${d.edges.map((e) => `${e.source}>${e.target}`).join(",")}`;
        if (laid?.key !== key) laid = { key, positions: layOut(d.nodes, d.edges) };
        return { value: graphValue(d, laid.positions), stale: s.stale, error: null };
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

export const SCREEN_VALUE_VIEWS = { graph, reviews } satisfies Partial<Record<ViewName, ValueViewDef>>;

const NEW_PER_DAY = [0, 10, 20, 30, 50, 100];

export const SCREEN_COMMANDS = {
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
