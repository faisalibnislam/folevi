// Data derived from a note's blocks: its card preview, search text, counts and excerpt, the pages it links
// to, and its title and rank as stored. Pure, so the server (convex/lib/documents.ts, lib/syncEngine.ts)
// and the local backend compute exactly the same thing from the same blocks.
import type { InlineNode } from "./generated/schema";
import type { WireBlock } from "./types";
import { plainText, wordCount } from "./richtext";
import { flattenTree, type FlatEntry } from "./tree";
import { liftColumns } from "./columns";
import { mindmapRoot, parseMindmap } from "./mindmap";
import { parseChart } from "./chart";
import { documentSearchText } from "./search";
import { rankBetween } from "./rank";

/** One line of a page thumbnail: block type, trimmed text, and just enough shape to draw it. */
export interface PreviewLine {
  t: string;
  x: string;
  l?: number;
  c?: boolean;
  d?: number;
  rows?: string[][];
}

const PREVIEW_LINES = 14;

/** The first blocks of a page, trimmed, so document cards can show a miniature of the page itself. */
export function buildPreview(entries: { block: WireBlock; depth: number }[]): PreviewLine[] {
  const out: PreviewLine[] = [];
  // A column's blocks are drawn at their row's level, one column after another (rows themselves draw nothing).
  for (const { block: b, depth } of liftColumns(entries)) {
    if (out.length >= PREVIEW_LINES) break;
    if (b.type === "columns" || b.type === "column") continue;
    const p = b.props as { level?: number; checked?: boolean; rows?: InlineNode[][][]; name?: string; title?: string; url?: string; titleCache?: string };
    const line: PreviewLine = { t: b.type, x: plainText(b.text).slice(0, 160) };
    if (depth) line.d = Math.min(depth, 4);
    if (b.type === "heading") line.l = Number(p.level ?? 1);
    if (b.type === "todo") line.c = Boolean(p.checked);
    if (b.type === "table") line.rows = (p.rows ?? []).slice(0, 6).map((r) => r.slice(0, 5).map((c) => plainText(c).slice(0, 24)));
    if (b.type === "file" || b.type === "audio") line.x = String(p.name ?? "File").slice(0, 80);
    if (b.type === "bookmark") line.x = String(p.title ?? p.url ?? "").slice(0, 80);
    if (b.type === "embed") line.x = String(p.url ?? "").slice(0, 80);
    if (b.type === "page") line.x = String(p.titleCache ?? "Page").slice(0, 80);
    if (b.type === "formula") line.x = String((p as { latex?: string }).latex ?? "").slice(0, 160);
    // A mind map shows its central idea, a chart its title.
    if (b.type === "mindmap") line.x = (mindmapRoot(parseMindmap(String((p as { data?: string }).data ?? "")))?.text ?? "").slice(0, 80);
    if (b.type === "chart") line.x = parseChart(String((p as { data?: string }).data ?? "")).title.slice(0, 80);
    out.push(line);
  }
  return out;
}

/** What a note's blocks say about it: what search reads, its counts, its excerpt and its card preview. */
export interface DerivedText {
  searchText: string;
  wordCount: number;
  charCount: number;
  excerpt: string;
  preview: PreviewLine[];
}

/**
 * The derived text of a note from its blocks as its readers see them (synced content in place, link labels
 * every reader may see). A synced block's own content is never found as a page (`synced`): the notes
 * showing it are. Counts are of the body only (the title isn't part of the page's word count).
 */
export function deriveDocumentText(title: string, blocks: readonly WireBlock[], opts: { synced?: boolean } = {}): DerivedText {
  const flat: FlatEntry<WireBlock>[] = flattenTree(blocks);
  const ordered = flat.map((e) => e.block);
  const text = ordered.map((b) => plainText(b.text)).filter(Boolean);
  const joined = text.join("\n");
  return {
    searchText: opts.synced ? "" : documentSearchText(title, ordered),
    wordCount: wordCount(joined),
    charCount: joined.length,
    excerpt: text.join(" ").replace(/\s+/g, " ").slice(0, 240),
    preview: buildPreview(flat),
  };
}

/** A title as stored: control characters become spaces, at most 300 characters. */
export function sanitizeTitle(title: string): string {
  return title.replace(/[\u0000-\u001F\u007F]/g, " ").slice(0, 300);
}

/** The rank of a new top-level note, after the latest one (or the first rank when that one's is unusable). */
export function newDocumentRank(after: string | null): string {
  try {
    return rankBetween(after, null);
  } catch {
    return rankBetween(null, null);
  }
}

/** The parts of a block that can link to a page. */
export interface LinkSource {
  type: string;
  text?: unknown;
  props?: unknown;
}

const isPageLink = (n: unknown): boolean => Boolean(n) && typeof n === "object" && (n as { type?: string }).type === "pageLink";

/** Whether a block links to a page (a page card, a synced block, or page links in its text or table cells). */
export function hasLinkTargets(block: LinkSource): boolean {
  if (block.type === "page" || block.type === "synced") return true;
  const scan = (nodes: unknown): boolean => Array.isArray(nodes) && nodes.some(isPageLink);
  if (scan(block.text)) return true;
  return block.type === "table" && ((block.props as { rows?: unknown[][] }).rows ?? []).some((r) => r.some(scan));
}

/**
 * The public ids of the pages a block links to: a page card's page, the content a synced block shows (how
 * the notes showing it are found), and every page link in its text or table cells. The backlink index holds
 * one row per target (the note's own id left out by the caller).
 */
export function blockLinkTargets(block: LinkSource): Set<string> {
  const targets = new Set<string>();
  const props = block.props as { documentId?: unknown; sourceId?: unknown; rows?: unknown[][] } | null | undefined;
  if (block.type === "page" && typeof props?.documentId === "string") targets.add(props.documentId);
  if (block.type === "synced" && typeof props?.sourceId === "string") targets.add(props.sourceId);
  const scan = (nodes: unknown) => {
    if (!Array.isArray(nodes)) return;
    for (const n of nodes) {
      if (isPageLink(n)) {
        const id = (n as { documentId?: unknown }).documentId;
        if (typeof id === "string") targets.add(id);
      }
    }
  };
  scan(block.text);
  if (block.type === "table") for (const r of props?.rows ?? []) for (const c of r) scan(c);
  return targets;
}

/**
 * What changes in a block that links to a page once that page's title or icon changes: a page card's
 * cached title and icon, and the label of every link to it in the block's text or table cells. Empty when
 * nothing changes. `title` is the page's title as shown ("Untitled" for none), `icon` null for none.
 */
export function pageLinkLabelPatch(block: LinkSource, documentId: string, title: string, icon: string | null): { text?: unknown; props?: Record<string, unknown> } {
  const patch: { text?: unknown; props?: Record<string, unknown> } = {};
  const relabel = (nodes: unknown): { nodes: unknown; changed: boolean } => {
    if (!Array.isArray(nodes)) return { nodes, changed: false };
    let changed = false;
    const out = nodes.map((n) => {
      if (isPageLink(n) && (n as { documentId?: string }).documentId === documentId) {
        if ((n as { label?: string }).label !== title) {
          changed = true;
          return { ...(n as object), label: title };
        }
      }
      return n;
    });
    return { nodes: out, changed };
  };
  const props = block.props as Record<string, unknown>;
  if (block.type === "page" && props.documentId === documentId) {
    const nextProps: Record<string, unknown> = { ...props, titleCache: title };
    if (icon) nextProps.iconCache = icon;
    else delete nextProps.iconCache;
    if (props.titleCache !== title || (props.iconCache ?? null) !== icon) patch.props = nextProps;
  }
  const text = relabel(block.text);
  if (text.changed) patch.text = text.nodes;
  if (block.type === "table") {
    const rows = (props.rows as unknown[][] | undefined) ?? [];
    let changed = false;
    const nextRows = rows.map((r) =>
      r.map((cell) => {
        const c = relabel(cell);
        if (c.changed) changed = true;
        return c.nodes;
      }),
    );
    if (changed) patch.props = { ...(patch.props ?? props), rows: nextRows };
  }
  return patch;
}
