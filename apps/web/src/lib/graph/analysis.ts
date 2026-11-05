// Foli DNA's analysis (components/views/GraphView.tsx, and through the engine the Mac, iPad and iPhone): the
// view around one note, filters, clusters and their names, bridges, hubs, orphans, time, and the map as Markdown
// or SVG. Pure functions over the graph's nodes and edges (lib/graph/layout.ts), tested directly.
import { degrees, foldText, type GraphEdgeData, type GraphNodeData, type Point } from "./layout";

/** A node with what the filters read (notes only; entities leave them out). */
export interface DnaNode extends GraphNodeData {
  /** The note's folder (public id), or null. */
  folderId?: string | null;
  /** The note's tags (public ids). */
  tagIds?: string[];
  createdAt?: number | null;
  updatedAt?: number | null;
}

export interface DnaEdge extends GraphEdgeData {
  /** When a link was made (links only). */
  createdAt?: number | null;
}

/** Edges people wrote ([[links]]); the rest are Foli AI's finds. */
export const isWritten = (e: { kind: string }) => e.kind === "link";

export interface DnaFilter {
  /** Only notes in these folders (and the entities they mention). Empty: every folder. */
  folders?: readonly string[];
  /** Only notes with at least one of these tags. Empty: any. */
  tags?: readonly string[];
  /** Only notes edited at or after this time (ms). */
  editedSince?: number | null;
  /** Only links people wrote, no entities or Foli AI's finds. */
  linksOnly?: boolean;
  /** Leave out notes with no connections. */
  hideOrphans?: boolean;
  /**
   * Leave out Foli AI's weaker lines between two notes (similar, related, refers to): the map was too busy with
   * them. Contradicts and replaces stay (they ask for something to be done), and so do mentions.
   */
  hideAiLines?: boolean;
}

/** Foli AI's lines between notes that `hideAiLines` leaves out. */
export const isWeakAiLine = (e: { kind: string; inferred: boolean }) => e.inferred && (e.kind === "similar" || e.kind === "related" || e.kind === "references");

/**
 * The graph with a filter applied: notes that pass it, the entities still joined to one of them, and the edges
 * between what's left. Orphans are judged after the rest of the filter (a note whose only links go to notes
 * filtered out is an orphan here).
 */
export function filterGraph<N extends DnaNode, E extends DnaEdge>(nodes: readonly N[], edges: readonly E[], f: DnaFilter): { nodes: N[]; edges: E[] } {
  const folders = f.folders?.length ? new Set(f.folders) : null;
  const tags = f.tags?.length ? new Set(f.tags) : null;
  const notePass = (n: N) =>
    (!folders || (n.folderId != null && folders.has(n.folderId))) &&
    (!tags || (n.tagIds ?? []).some((t) => tags.has(t))) &&
    (f.editedSince == null || (n.updatedAt ?? 0) >= f.editedSince);
  const notes = new Set(nodes.filter((n) => n.kind === "note" && notePass(n)).map((n) => n.id));
  let kept = edges.filter((e) => (!f.linksOnly || isWritten(e)) && !(f.hideAiLines && isWeakAiLine(e)) && (notes.has(e.source) || notes.has(e.target)));
  const entities = new Set<string>();
  if (!f.linksOnly) {
    for (const e of kept) {
      for (const [a, b] of [
        [e.source, e.target],
        [e.target, e.source],
      ] as const) {
        if (notes.has(a) && !notes.has(b)) {
          const other = nodes.find((n) => n.id === b);
          if (other && other.kind !== "note") entities.add(b);
        }
      }
    }
  }
  const ids = new Set([...notes, ...entities]);
  kept = kept.filter((e) => ids.has(e.source) && ids.has(e.target));
  if (f.hideOrphans) {
    const deg = degrees(kept);
    for (const id of [...ids]) if (!deg.get(id)) ids.delete(id);
  }
  return { nodes: nodes.filter((n) => ids.has(n.id)), edges: kept.filter((e) => ids.has(e.source) && ids.has(e.target)) };
}

/** Notes with no connections at all in this graph. */
export function orphans(nodes: readonly DnaNode[], edges: readonly DnaEdge[]): DnaNode[] {
  const deg = degrees(edges);
  return nodes.filter((n) => n.kind === "note" && !deg.get(n.id)).sort((a, b) => a.label.localeCompare(b.label));
}

/** Each node's neighbours. */
export function adjacency(edges: readonly { source: string; target: string }[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const add = (a: string, b: string) => {
    const s = out.get(a) ?? new Set<string>();
    s.add(b);
    out.set(a, s);
  };
  for (const e of edges) {
    if (e.source === e.target) continue;
    add(e.source, e.target);
    add(e.target, e.source);
  }
  return out;
}

/** How many steps each node is from `from` (only those within `depth`), `from` itself at 0. */
export function stepsFrom(edges: readonly { source: string; target: string }[], from: string, depth: number): Map<string, number> {
  const adj = adjacency(edges);
  const out = new Map<string, number>([[from, 0]]);
  let ring = [from];
  for (let d = 1; d <= depth && ring.length; d++) {
    const next: string[] = [];
    for (const id of ring) for (const n of adj.get(id) ?? []) if (!out.has(n)) {
      out.set(n, d);
      next.push(n);
    }
    ring = next;
  }
  return out;
}

/** The view around one note: it and everything within `depth` steps (1 to 3), and the edges between them. */
export function localGraph<N extends GraphNodeData, E extends GraphEdgeData>(nodes: readonly N[], edges: readonly E[], center: string, depth: number): { nodes: N[]; edges: E[] } {
  const near = stepsFrom(edges, center, Math.max(1, Math.min(3, Math.round(depth))));
  if (!nodes.some((n) => n.id === center)) return { nodes: [], edges: [] };
  return { nodes: nodes.filter((n) => near.has(n.id)), edges: edges.filter((e) => near.has(e.source) && near.has(e.target)) };
}

export interface Cluster {
  /** 0, 1, 2… biggest first. */
  id: number;
  name: string;
  members: string[];
}

/** Clusters under this size aren't shaded or named (a pair of notes isn't a theme). */
export const MIN_CLUSTER = 3;

/**
 * Communities by modularity (one level of Louvain, deterministic: nodes visited in id order, ties to the first
 * community met): each node moves to the neighbouring community that gains the most, until nothing moves.
 * Clusters of MIN_CLUSTER or more, biggest first, each named by what its notes share: the entity most joined in
 * it, else its best-connected note's title.
 */
export function clusters(nodes: readonly GraphNodeData[], edges: readonly GraphEdgeData[]): { clusters: Cluster[]; of: Map<string, number> } {
  const adj = adjacency(edges);
  const ids = nodes.map((n) => n.id).sort();
  const known = new Set(ids);
  let m2 = 0;
  const k = new Map<string, number>();
  for (const id of ids) {
    const d = [...(adj.get(id) ?? [])].filter((n) => known.has(n)).length;
    k.set(id, d);
    m2 += d;
  }
  const label = new Map(ids.map((id) => [id, id]));
  if (m2 > 0) {
    const tot = new Map(ids.map((id) => [id, k.get(id)!]));
    for (let pass = 0; pass < 25; pass++) {
      let moved = false;
      for (const id of ids) {
        const ki = k.get(id)!;
        if (!ki) continue;
        const own = label.get(id)!;
        tot.set(own, tot.get(own)! - ki);
        const links = new Map<string, number>();
        for (const n of adj.get(id) ?? []) {
          if (!known.has(n)) continue;
          const c = label.get(n)!;
          links.set(c, (links.get(c) ?? 0) + 1);
        }
        const gain = (c: string) => (links.get(c) ?? 0) - ((tot.get(c) ?? 0) * ki) / m2;
        let best = own;
        let bestGain = gain(own);
        for (const c of [...links.keys()].sort()) {
          const g = gain(c);
          if (g > bestGain + 1e-9) {
            best = c;
            bestGain = g;
          }
        }
        tot.set(best, (tot.get(best) ?? 0) + ki);
        if (best !== own) {
          label.set(id, best);
          moved = true;
        }
      }
      if (!moved) break;
    }
  }
  const groups = new Map<string, string[]>();
  for (const id of ids) groups.set(label.get(id)!, [...(groups.get(label.get(id)!) ?? []), id]);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const deg = degrees(edges);
  const sorted = [...groups.values()].filter((m) => m.length >= MIN_CLUSTER).sort((a, b) => b.length - a.length || a[0]!.localeCompare(b[0]!));
  const of = new Map<string, number>();
  const out: Cluster[] = sorted.map((members, i) => {
    for (const m of members) of.set(m, i);
    return { id: i, name: clusterName(members, byId, deg), members };
  });
  return { clusters: out, of };
}

function clusterName(members: readonly string[], byId: ReadonlyMap<string, GraphNodeData>, deg: ReadonlyMap<string, number>): string {
  const ranked = [...members].sort((a, b) => (deg.get(b) ?? 0) - (deg.get(a) ?? 0) || a.localeCompare(b));
  const entity = ranked.find((id) => byId.get(id)?.kind !== "note");
  const pick = entity ?? ranked[0];
  return (byId.get(pick ?? "")?.label || "Untitled").slice(0, 40);
}

/** Nodes joined to two or more clusters other than their own: they bridge themes. */
export function bridges(edges: readonly GraphEdgeData[], of: ReadonlyMap<string, number>): Set<string> {
  const adj = adjacency(edges);
  const out = new Set<string>();
  for (const [id, near] of adj) {
    const own = of.get(id);
    const others = new Set<number>();
    for (const n of near) {
      const c = of.get(n);
      if (c !== undefined && c !== own) others.add(c);
    }
    if (others.size >= (own === undefined ? 2 : 1) && near.size >= 2) out.add(id);
  }
  return out;
}

/** The best-connected nodes, most first (ties by name). */
export function hubs<N extends GraphNodeData>(nodes: readonly N[], edges: readonly GraphEdgeData[], count = 10): (N & { degree: number })[] {
  const deg = degrees(edges);
  return nodes
    .map((n) => ({ ...n, degree: deg.get(n.id) ?? 0 }))
    .filter((n) => n.degree > 0)
    .sort((a, b) => b.degree - a.degree || a.label.localeCompare(b.label))
    .slice(0, count);
}

/** The graph as it stood at `at`: notes made by then, links made by then (other edges follow their ends). */
export function asOf<N extends DnaNode, E extends DnaEdge>(nodes: readonly N[], edges: readonly E[], at: number): { nodes: N[]; edges: E[] } {
  const notes = new Set(nodes.filter((n) => n.kind === "note" && (n.createdAt ?? 0) <= at).map((n) => n.id));
  const kept = edges.filter((e) => (e.kind !== "link" || (e.createdAt ?? 0) <= at) && (notes.has(e.source) || notes.has(e.target)));
  const ids = new Set(notes);
  for (const e of kept) for (const id of [e.source, e.target]) if (!notes.has(id) && nodes.find((n) => n.id === id)?.kind !== "note") ids.add(id);
  return { nodes: nodes.filter((n) => ids.has(n.id)), edges: kept.filter((e) => ids.has(e.source) && ids.has(e.target)) };
}

/** The time-lapse's span: the first and last note made. */
export function timeSpan(nodes: readonly DnaNode[]): { start: number; end: number } | null {
  const times = nodes.filter((n) => n.kind === "note" && n.createdAt).map((n) => n.createdAt!);
  return times.length ? { start: Math.min(...times), end: Math.max(...times) } : null;
}

/** What's new since `since`: notes made since, and both ends of links made since. */
export function newSince(nodes: readonly DnaNode[], edges: readonly DnaEdge[], since: number): { nodes: Set<string>; edges: Set<number> } {
  const out = new Set(nodes.filter((n) => n.kind === "note" && (n.createdAt ?? 0) >= since).map((n) => n.id));
  const e = new Set<number>();
  edges.forEach((x, i) => {
    if (x.kind === "link" && (x.createdAt ?? 0) >= since) {
      e.add(i);
      out.add(x.source);
      out.add(x.target);
    }
  });
  return { nodes: out, edges: e };
}

/** Nodes within `steps` of `id` (focus mode dims the rest). */
export const within = (edges: readonly GraphEdgeData[], id: string, steps = 2) => new Set(stepsFrom(edges, id, steps).keys());

/** A node's colour group: its folder or its first tag ("" for none), for colour by folder or tag. */
export function groupOf(n: DnaNode, by: "kind" | "folder" | "tag"): string | null {
  if (by === "kind" || n.kind !== "note") return null;
  return by === "folder" ? (n.folderId ?? "") : (n.tagIds?.[0] ?? "");
}

/** A saved view's settings: what's filtered, how it's coloured, laid out and where it's looking. */
export interface DnaSettings {
  filter: DnaFilter;
  kinds?: string[];
  colorBy: "kind" | "folder" | "tag";
  arrows: boolean;
  clusters: boolean;
  spacing: number;
  pull: number;
  center?: string | null;
  depth?: number;
}

/** A fresh map is calmer: notes with no links and Foli AI's weaker lines start hidden (the Show menu brings them back). */
export const DEFAULT_SETTINGS: DnaSettings = { filter: { hideOrphans: true, hideAiLines: true }, colorBy: "kind", arrows: false, clusters: true, spacing: 1, pull: 1, center: null, depth: 1 };

/** Settings read back from storage (or a saved view), anything unknown or out of range dropped. */
export function cleanSettings(raw: unknown): DnaSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const f = (r.filter && typeof r.filter === "object" ? r.filter : {}) as Record<string, unknown>;
  const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 200) : undefined);
  const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
  return {
    filter: {
      folders: strs(f.folders),
      tags: strs(f.tags),
      editedSince: typeof f.editedSince === "number" ? f.editedSince : null,
      linksOnly: f.linksOnly === true,
      hideOrphans: f.hideOrphans === true,
      hideAiLines: f.hideAiLines === true,
    },
    kinds: strs(r.kinds),
    colorBy: r.colorBy === "folder" || r.colorBy === "tag" ? r.colorBy : "kind",
    arrows: r.arrows === true,
    clusters: r.clusters !== false,
    spacing: num(r.spacing, 0.5, 2, 1),
    pull: num(r.pull, 0.25, 3, 1),
    center: typeof r.center === "string" ? r.center : null,
    depth: num(r.depth, 1, 3, 1),
  };
}

const EDGE_WORD: Record<string, string> = { link: "links to", mention: "mentions", similar: "is similar to", related: "is related to", references: "refers to", contradicts: "contradicts", supersedes: "replaces" };

/** The map as a Markdown list: each note with what it's joined to ([[links]] for notes). */
export function toMarkdown(nodes: readonly GraphNodeData[], edges: readonly GraphEdgeData[], title = "Foli DNA"): string {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const name = (n: GraphNodeData) => (n.kind === "note" ? `[[${n.label || "Untitled"}]]` : `${n.label} (${n.kind})`);
  const lines = [`# ${title}`, ""];
  const sorted = [...nodes].sort((a, b) => Number(a.kind !== "note") - Number(b.kind !== "note") || a.label.localeCompare(b.label));
  for (const n of sorted) {
    lines.push(`- ${name(n)}`);
    for (const e of edges) {
      const other = e.source === n.id ? byId.get(e.target) : e.target === n.id && e.kind !== "link" && e.kind !== "mention" ? byId.get(e.source) : null;
      if (other) lines.push(`  - ${EDGE_WORD[e.kind] ?? "is joined to"} ${name(other)}`);
    }
  }
  return lines.join("\n") + "\n";
}

const escapeXml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);

/** The map as an SVG file (positions as laid out; colours given per kind, light theme). */
export function toSvg(nodes: readonly GraphNodeData[], edges: readonly GraphEdgeData[], positions: ReadonlyMap<string, Point>, colors: Record<string, string>, opts: { radius: (id: string) => number; labelled: Set<string> }): string {
  const pts = [...positions.values()];
  const minX = Math.min(...pts.map((p) => p.x), 0) - 60;
  const minY = Math.min(...pts.map((p) => p.y), 0) - 60;
  const maxX = Math.max(...pts.map((p) => p.x), 0) + 60;
  const maxY = Math.max(...pts.map((p) => p.y), 0) + 60;
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${maxX - minX} ${maxY - minY}" width="${Math.round(maxX - minX)}" height="${Math.round(maxY - minY)}">`, `<rect x="${minX}" y="${minY}" width="${maxX - minX}" height="${maxY - minY}" fill="#ffffff"/>`];
  for (const e of edges) {
    const a = positions.get(e.source);
    const b = positions.get(e.target);
    if (a && b) out.push(`<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" stroke="${e.kind === "contradicts" ? colors.person : "#c9c9c9"}" stroke-width="1"/>`);
  }
  for (const n of nodes) {
    const p = positions.get(n.id);
    if (!p) continue;
    const r = opts.radius(n.id);
    out.push(`<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${r.toFixed(1)}" fill="${colors[n.kind] ?? colors.note}" stroke="#ffffff" stroke-width="1.5"/>`);
    if (opts.labelled.has(n.id)) out.push(`<text x="${p.x.toFixed(1)}" y="${(p.y + r + 12).toFixed(1)}" font-family="-apple-system, system-ui, sans-serif" font-size="11.5" text-anchor="middle" fill="#333333">${escapeXml((n.label || "Untitled").slice(0, 40))}</text>`);
  }
  out.push("</svg>");
  return out.join("\n");
}

/** Matches a saved view's name against what's typed (the sidebar's filter). */
export const nameMatches = (name: string, q: string) => foldText(name).includes(foldText(q));

// --- Labels and fitting (the owner's report on 1.2.32, 5 November 2026: most notes were bare dots, a cluster's
// name ran under the filter bar, the map sat to one side). The Mac, iPad and iPhone map uses the same rules
// (GraphScreen.swift GraphMath.labelPlan, extent).

/** A node's label on the map: at most 40 characters, cut with an ellipsis. */
export function shortLabel(label: string): string {
  const l = label || "Untitled";
  return l.length > 40 ? `${l.slice(0, 39).trimEnd()}…` : l;
}

/** A cluster's wash: its members' middle and the farthest of them plus a margin. */
export function clusterCircle(points: readonly Point[]): { x: number; y: number; r: number } | null {
  if (points.length < MIN_CLUSTER) return null;
  const x = points.reduce((s, p) => s + p.x, 0) / points.length;
  const y = points.reduce((s, p) => s + p.y, 0) / points.length;
  return { x, y, r: Math.max(...points.map((p) => Math.hypot(p.x - x, p.y - y))) + 28 };
}

/** What the map fits to: every node, and each cluster's wash with room for its name above it. */
export function fitPoints(points: Iterable<Point>, clusterPoints: readonly (readonly Point[])[]): Point[] {
  const out = [...points];
  for (const pts of clusterPoints) {
    const c = clusterCircle(pts);
    if (c) out.push({ x: c.x - c.r, y: c.y - c.r - 22 }, { x: c.x + c.r, y: c.y + c.r });
  }
  return out;
}

/**
 * How many labels the map may show at a zoom (beyond the ones that must show): fewer when zoomed out, where they
 * only crowded each other; every one that has room once zoomed in to read.
 */
export function labelBudget(k: number, count: number): number {
  if (k < 0.45) return Math.min(count, 12);
  if (k < 0.8) return Math.min(count, 30);
  return count;
}

export type Box = { x: number; y: number; w: number; h: number };
const meets = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Which nodes get a label, in screen pixels: first the ones that must (`always`: the one in the middle, what's
 * searched for, what's near the pointer), then, in `order` (best-connected first), every other one whose label has
 * room: inside `bounds`, clear of placed labels and `blocked` room (the clusters' names), and of other dots unless
 * it's `preferred` (a hub). A label sits centred under its node.
 */
export function labelPlan(
  order: readonly string[],
  opts: {
    always?: ReadonlySet<string>;
    preferred?: ReadonlySet<string>;
    bounds?: Box;
    blocked?: readonly Box[];
    center: (id: string) => Point | null | undefined;
    radius: (id: string) => number;
    width: (id: string) => number;
    limit?: number;
  },
): Set<string> {
  const H = 14;
  const rect = (id: string): Box | null => {
    const c = opts.center(id);
    if (!c) return null;
    const w = opts.width(id);
    return { x: c.x - w / 2, y: c.y + opts.radius(id) + 12 - H + 2, w, h: H };
  };
  const discs = order.flatMap((id) => {
    const c = opts.center(id);
    return c ? [{ id, c, r: opts.radius(id) }] : [];
  });
  const placed: Box[] = [...(opts.blocked ?? [])];
  const out = new Set<string>();
  const always = opts.always ?? new Set<string>();
  for (const id of order) {
    if (!always.has(id)) continue;
    const r = rect(id);
    if (r) {
      placed.push(r);
      out.add(id);
    }
  }
  const limit = opts.limit ?? Infinity;
  for (const id of order) {
    if (always.has(id) || out.size >= limit) continue;
    const r = rect(id);
    if (!r) continue;
    const room = { x: r.x - 3, y: r.y - 1, w: r.w + 6, h: r.h + 2 };
    const b = opts.bounds;
    if (b && (r.x < b.x || r.y < b.y || r.x + r.w > b.x + b.w || r.y + r.h > b.y + b.h)) continue;
    if (placed.some((p) => meets(p, room))) continue;
    if (!opts.preferred?.has(id) && discs.some((d) => d.id !== id && d.c.x >= room.x - d.r && d.c.x <= room.x + room.w + d.r && d.c.y >= room.y - d.r && d.c.y <= room.y + room.h + d.r)) continue;
    placed.push(r);
    out.add(id);
  }
  return out;
}
