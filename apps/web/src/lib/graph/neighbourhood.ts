// Foli DNA around one note (components/views/GraphView.tsx, and through the engine the Mac, iPad and iPhone):
// what a note is connected to and why, in words. One hop out from the note: the notes it links to and the ones
// linking to it, what it mentions (Pro), what Foli AI found related, suggested links, notes sharing one of its
// tags and notes in its folder. Pure functions over the graph's nodes and edges, tested directly
// (test/foli-dna-around.test.ts). The same rules are in the native apps' GraphScreen.swift (DnaAround).
import type { DnaEdge, DnaNode } from "./analysis";

/** Why two nodes are connected, from the first one's side. */
export type Reason =
  | { kind: "link" }
  | { kind: "backlink" }
  | { kind: "mention" }
  | { kind: "mentionedIn" }
  | { kind: "ai"; relation: string }
  | { kind: "suggested"; entities: string[] }
  | { kind: "tag"; tagId: string }
  | { kind: "folder"; folderId: string };

export interface Connection {
  id: string;
  reasons: Reason[];
}

/** The order reasons are told in and connections sorted by: written links first, a shared folder last. */
const RANK: Record<Reason["kind"], number> = { link: 0, backlink: 1, mention: 2, mentionedIn: 2, ai: 3, suggested: 4, tag: 5, folder: 6 };
export const reasonRank = (r: Reason) => RANK[r.kind];

/** At most this many notes are shown for one shared tag or one folder (the most recently edited). */
export const SHARED_LIMIT = 8;
/** At most this many neighbours around one note (written links always come first). */
export const AROUND_LIMIT = 60;

export interface DnaIndex {
  byId: Map<string, DnaNode>;
  /** Each node's edges, from its side. */
  adj: Map<string, { other: string; edge: DnaEdge; out: boolean }[]>;
  byTag: Map<string, string[]>;
  byFolder: Map<string, string[]>;
  suggested: { source: string; target: string; entities: string[] }[];
}

/** Built once per map: who is joined to whom, and which notes share each tag and folder (newest first). */
export function indexGraph(nodes: readonly DnaNode[], edges: readonly DnaEdge[], suggested: readonly { source: string; target: string; entities: string[] }[] = []): DnaIndex {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const adj: DnaIndex["adj"] = new Map();
  const add = (id: string, v: { other: string; edge: DnaEdge; out: boolean }) => {
    const list = adj.get(id);
    if (list) list.push(v);
    else adj.set(id, [v]);
  };
  for (const e of edges) {
    if (e.source === e.target || !byId.has(e.source) || !byId.has(e.target)) continue;
    add(e.source, { other: e.target, edge: e, out: true });
    add(e.target, { other: e.source, edge: e, out: false });
  }
  const byTag = new Map<string, string[]>();
  const byFolder = new Map<string, string[]>();
  const notes = nodes.filter((n) => n.kind === "note").sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0) || a.id.localeCompare(b.id));
  for (const n of notes) {
    for (const t of n.tagIds ?? []) byTag.set(t, [...(byTag.get(t) ?? []), n.id]);
    if (n.folderId) byFolder.set(n.folderId, [...(byFolder.get(n.folderId) ?? []), n.id]);
  }
  return { byId, adj, byTag, byFolder, suggested: suggested.filter((s) => byId.has(s.source) && byId.has(s.target)) };
}

/** What `id` is connected to and why, strongest first (then most recently edited). `ai: false` leaves out Foli AI's finds (links only). */
export function connectionsOf(index: DnaIndex, id: string, opts: { ai?: boolean; shared?: boolean; limit?: number } = {}): Connection[] {
  const me = index.byId.get(id);
  if (!me) return [];
  const ai = opts.ai !== false;
  const out = new Map<string, Reason[]>();
  const add = (other: string, r: Reason) => {
    if (other === id || !index.byId.has(other)) return;
    const list = out.get(other) ?? [];
    if (!list.some((x) => JSON.stringify(x) === JSON.stringify(r))) list.push(r);
    out.set(other, list);
  };
  for (const { other, edge, out: mine } of index.adj.get(id) ?? []) {
    if (edge.kind === "link") add(other, { kind: mine ? "link" : "backlink" });
    else if (!ai) continue;
    // Mentions run from the entity to the note.
    else if (edge.kind === "mention") add(other, { kind: me.kind === "note" ? "mention" : "mentionedIn" });
    else add(other, { kind: "ai", relation: edge.kind });
  }
  if (ai)
    for (const s of index.suggested) {
      if (s.source === id) add(s.target, { kind: "suggested", entities: s.entities });
      else if (s.target === id) add(s.source, { kind: "suggested", entities: s.entities });
    }
  if (me.kind === "note" && opts.shared !== false) {
    for (const t of me.tagIds ?? []) for (const other of (index.byTag.get(t) ?? []).filter((x) => x !== id).slice(0, SHARED_LIMIT)) add(other, { kind: "tag", tagId: t });
    if (me.folderId) for (const other of (index.byFolder.get(me.folderId) ?? []).filter((x) => x !== id).slice(0, SHARED_LIMIT)) add(other, { kind: "folder", folderId: me.folderId });
  }
  const list = [...out.entries()].map(([other, reasons]) => ({ id: other, reasons: reasons.sort((a, b) => reasonRank(a) - reasonRank(b)) }));
  list.sort((a, b) => reasonRank(a.reasons[0]!) - reasonRank(b.reasons[0]!) || (index.byId.get(b.id)?.updatedAt ?? 0) - (index.byId.get(a.id)?.updatedAt ?? 0) || (index.byId.get(a.id)?.label ?? "").localeCompare(index.byId.get(b.id)?.label ?? ""));
  return list.slice(0, opts.limit ?? AROUND_LIMIT);
}

/** A line on the map around a note: an edge of the graph, or one drawn for a shared tag, folder or suggestion. */
export interface AroundEdge extends DnaEdge {
  /** Why, in a word or two, written beside the line. */
  label: string;
}

export interface Names {
  tag?: (id: string) => string | undefined;
  folder?: (id: string) => string | undefined;
}

/** A reason in a word or two, for the line between two nodes (from the first one's side). */
export function reasonWord(r: Reason, names: Names = {}): string {
  switch (r.kind) {
    case "link":
      return "links to";
    case "backlink":
      return "links here";
    case "mention":
      return "mentions";
    case "mentionedIn":
      return "mentioned in";
    case "ai":
      return AI_WORD[r.relation] ?? "related";
    case "suggested":
      return "could link";
    case "tag":
      return `#${names.tag?.(r.tagId) ?? "tag"}`;
    case "folder":
      return "same folder";
  }
}
const AI_WORD: Record<string, string> = { similar: "similar", related: "related", references: "refers to", contradicts: "contradicts", supersedes: "replaces" };

/** The words on a line: the strongest two reasons ("links to · #pricing"); a link both ways says so. */
export function lineLabel(reasons: readonly Reason[], names: Names = {}): string {
  const kinds = new Set(reasons.map((r) => r.kind));
  const rest = reasons.filter((r) => !(kinds.has("link") && kinds.has("backlink") && (r.kind === "link" || r.kind === "backlink")));
  const words = [...(kinds.has("link") && kinds.has("backlink") ? ["links both ways"] : []), ...rest.map((r) => reasonWord(r, names))];
  return [...new Set(words)].slice(0, 2).join(" · ");
}

const edgeKindOf = (r: Reason): string => (r.kind === "link" || r.kind === "backlink" ? "link" : r.kind === "mention" || r.kind === "mentionedIn" ? "mention" : r.kind === "ai" ? r.relation : r.kind);
const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/**
 * The map around one note: it in the middle, what it's connected to one hop out, and for each neighbour in
 * `expanded`, that neighbour's own connections too. One line per pair, labelled with why; lines that already join
 * two of the notes shown are kept as they are. Null when the note isn't in the map.
 */
export function neighbourhood(
  index: DnaIndex,
  center: string,
  opts: { expanded?: ReadonlySet<string>; ai?: boolean; names?: Names } = {},
): { nodes: DnaNode[]; edges: AroundEdge[]; connections: Connection[]; expandable: Set<string> } | null {
  if (!index.byId.has(center)) return null;
  const connections = connectionsOf(index, center, { ai: opts.ai });
  const shown = new Set([center, ...connections.map((c) => c.id)]);
  const lines = new Map<string, AroundEdge>();
  const draw = (from: string, c: Connection) => {
    const key = pairKey(from, c.id);
    if (lines.has(key)) return;
    const first = c.reasons[0]!;
    const kind = edgeKindOf(first);
    // A written link and a mention keep their real direction (a backlink points at the middle).
    const reverse = first.kind === "backlink" || first.kind === "mention";
    const real = (index.adj.get(from) ?? []).find((x) => x.other === c.id && x.edge.kind === kind)?.edge;
    lines.set(key, {
      source: reverse ? c.id : from,
      target: reverse ? from : c.id,
      kind,
      inferred: first.kind === "ai" || first.kind === "suggested" || first.kind === "mention" || first.kind === "mentionedIn" ? true : (real?.inferred ?? false),
      ...(real?.createdAt != null ? { createdAt: real.createdAt } : {}),
      label: lineLabel(c.reasons, opts.names),
    });
  };
  for (const c of connections) draw(center, c);
  for (const id of opts.expanded ?? []) {
    if (!shown.has(id) || id === center) continue;
    for (const c of connectionsOf(index, id, { ai: opts.ai, limit: 24 })) {
      shown.add(c.id);
      draw(id, c);
    }
  }
  // Lines already joining two of the notes shown (two neighbours that link to each other), unlabelled.
  for (const id of shown)
    for (const { other, edge } of index.adj.get(id) ?? []) {
      if (!shown.has(other) || lines.has(pairKey(id, other))) continue;
      if (opts.ai === false && edge.kind !== "link") continue;
      lines.set(pairKey(id, other), { ...edge, label: "" });
    }
  const expandable = new Set([...shown].filter((id) => id !== center && index.byId.get(id)?.kind === "note" && !(opts.expanded?.has(id) ?? false)));
  return { nodes: [...shown].map((id) => index.byId.get(id)!), edges: [...lines.values()], connections, expandable };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
function sentence(parts: string[]): string {
  if (!parts.length) return "";
  const s = parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
  return `${s[0]!.toUpperCase()}${s.slice(1)}.`;
}
function nameList(names: string[]): string {
  if (names.length <= 2) return names.join(" and ");
  return `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
}

export interface ExplainGroup {
  title: string;
  ids: string[];
}

/**
 * Why a node is connected to the others, in words: one sentence ("Links to 3 notes, linked from 2 and shares the
 * tag #pricing with 4.") and the connections listed by reason, each group in the order the sentence tells them.
 */
export function explain(index: DnaIndex, id: string, names: Names = {}, opts: { ai?: boolean } = {}): { summary: string; groups: ExplainGroup[] } {
  const me = index.byId.get(id);
  if (!me) return { summary: "", groups: [] };
  const conns = connectionsOf(index, id, { ai: opts.ai, limit: Infinity });
  const by = (pred: (r: Reason) => boolean) => conns.filter((c) => c.reasons.some(pred)).map((c) => c.id);
  const label = (x: string) => index.byId.get(x)?.label || "Untitled";
  const links = by((r) => r.kind === "link");
  const back = by((r) => r.kind === "backlink");
  const mentions = by((r) => r.kind === "mention");
  const mentionedIn = by((r) => r.kind === "mentionedIn");
  const ai = by((r) => r.kind === "ai");
  const suggested = by((r) => r.kind === "suggested");
  const parts: string[] = [];
  const groups: ExplainGroup[] = [];
  if (links.length) {
    parts.push(`links to ${plural(links.length, "note")}`);
    groups.push({ title: "Links to", ids: links });
  }
  if (back.length) {
    parts.push(`linked from ${links.length ? back.length : plural(back.length, "note")}`);
    groups.push({ title: "Linked from", ids: back });
  }
  if (mentions.length) {
    parts.push(`mentions ${nameList(mentions.map(label))}`);
    groups.push({ title: "Mentions", ids: mentions });
  }
  if (mentionedIn.length) {
    parts.push(`mentioned in ${plural(mentionedIn.length, "note")}`);
    groups.push({ title: "Mentioned in", ids: mentionedIn });
  }
  if (ai.length) {
    parts.push(`Foli AI finds it related to ${plural(ai.length, "note")}`);
    groups.push({ title: "Foli AI found", ids: ai });
  }
  if (suggested.length) {
    parts.push(`could link to ${suggested.length}`);
    groups.push({ title: "Could link to", ids: suggested });
  }
  if (me.kind === "note") {
    // Tags most shared first (counted over every note with them, not only those shown).
    const tags = [...(me.tagIds ?? [])].map((t) => ({ t, ids: (index.byTag.get(t) ?? []).filter((x) => x !== id) })).filter((x) => x.ids.length).sort((a, b) => b.ids.length - a.ids.length);
    tags.forEach((x, i) => {
      const name = `#${names.tag?.(x.t) ?? "tag"}`;
      if (i < 2) parts.push(`shares the tag ${name} with ${x.ids.length}`);
      groups.push({ title: `Also tagged ${name}`, ids: x.ids });
    });
    const folder = me.folderId ? (index.byFolder.get(me.folderId) ?? []).filter((x) => x !== id) : [];
    if (folder.length) {
      const name = names.folder?.(me.folderId!);
      parts.push(name ? `is in ${name} with ${folder.length} more` : `shares its folder with ${plural(folder.length, "note")}`);
      groups.push({ title: name ? `Also in ${name}` : "Same folder", ids: folder });
    }
  }
  const summary = sentence(parts) || (me.kind === "note" ? "Not connected to anything yet. Type [[ in it to link another note." : "Not mentioned in any note shown.");
  return { summary, groups };
}
