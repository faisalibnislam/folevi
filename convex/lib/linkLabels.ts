// Labels of links between pages. A page link stores the title its writer saw — page blocks in
// `props.titleCache` / `iconCache`, inline links (also inside table cells) as the `pageLink` node's
// `label` — but a stored label is never served as it is, because the people reading a page aren't
// necessarily allowed to open every page it links to (a restricted page's title must not reach a member
// who can't open it, in its links or anywhere derived from them):
//
// - to a signed-in reader (blocks.list, sync, exports, versions, the AI): a page they can open shows its
//   current title and icon; anything else — restricted, in a scope they aren't in, gone — shows
//   HIDDEN_PAGE_LABEL and no icon (readerLabels);
// - to everyone who can read the linking page at once (a public link, and the text derived from a page:
//   its excerpt, card preview, search text and task titles): only pages in the same scope that aren't
//   restricted (nor under a restricted page) show their title (sharedLabels).
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { WireBlock } from "@folevi/editor-schema";
import { accessAtLeast, documentAccess, getDocumentByPublicId } from "./auth";
import { hasValidScope, sameScopeRows } from "./scope";

type Ctx = QueryCtx | MutationCtx;

/** What a link to a page the reader can't open says. */
export const HIDDEN_PAGE_LABEL = "Page you can't open";
/** Distinct pages looked up per call; links to any beyond this read as hidden. */
const MAX_TARGETS = 200;

/** A link's label: the page's current title and icon, or null (hidden). */
type Label = { title: string; icon: string | null } | null;

function isPageLink(n: unknown): n is { type: "pageLink"; documentId: string; label?: string } {
  return Boolean(n && typeof n === "object" && (n as { type?: unknown }).type === "pageLink" && typeof (n as { documentId?: unknown }).documentId === "string");
}

function tableRows(block: WireBlock): unknown[][] | null {
  const rows = (block.props as { rows?: unknown }).rows;
  return block.type === "table" && Array.isArray(rows) ? (rows as unknown[][]) : null;
}

/** Every page id the blocks link to (page blocks, inline links, links in table cells). */
export function linkTargets(blocks: WireBlock[]): Set<string> {
  const out = new Set<string>();
  const scan = (nodes: unknown) => {
    if (!Array.isArray(nodes)) return;
    for (const n of nodes) if (isPageLink(n)) out.add(n.documentId);
  };
  for (const b of blocks) {
    const props = b.props as { documentId?: unknown };
    if (b.type === "page" && typeof props.documentId === "string") out.add(props.documentId);
    scan(b.text);
    for (const row of tableRows(b) ?? []) if (Array.isArray(row)) for (const cell of row) scan(cell);
  }
  return out;
}

/** The blocks with every link's label rewritten from `labels` (a page missing from it reads as hidden). */
export function relabel(blocks: WireBlock[], labels: Map<string, Label>): WireBlock[] {
  const title = (id: string) => labels.get(id)?.title ?? HIDDEN_PAGE_LABEL;
  const nodes = (list: unknown): unknown => {
    if (!Array.isArray(list) || !list.some(isPageLink)) return list;
    return list.map((n) => (isPageLink(n) ? { ...n, label: title(n.documentId) } : n));
  };
  return blocks.map((b) => {
    let next = b;
    const props = b.props as Record<string, unknown>;
    if (b.type === "page" && typeof props.documentId === "string") {
      const label = labels.get(props.documentId) ?? null;
      const p: Record<string, unknown> = { ...props, titleCache: label?.title ?? HIDDEN_PAGE_LABEL };
      if (label?.icon) p.iconCache = label.icon;
      else delete p.iconCache;
      next = { ...next, props: p };
    }
    if (Array.isArray(b.text) && b.text.some(isPageLink)) next = { ...next, text: nodes(b.text) as WireBlock["text"] };
    const rows = tableRows(b);
    if (rows && rows.some((r) => Array.isArray(r) && r.some((c) => Array.isArray(c) && c.some(isPageLink)))) {
      next = { ...next, props: { ...(next.props as Record<string, unknown>), rows: rows.map((r) => (Array.isArray(r) ? r.map(nodes) : r)) } };
    }
    return next;
  });
}

const labelOf = (doc: Doc<"documents">): Label => ({ title: doc.title || "Untitled", icon: doc.icon ?? null });

/**
 * Labels as one signed-in reader may see them: the current title of pages they can open, hidden for the
 * rest. Keeps its lookups across calls (one per query or mutation).
 */
export class ReaderLabels {
  private labels = new Map<string, Label>();
  constructor(
    private ctx: Ctx,
    private reader: Doc<"profiles">,
  ) {}

  async blocks(blocks: WireBlock[]): Promise<WireBlock[]> {
    const targets = linkTargets(blocks);
    if (!targets.size) return blocks;
    for (const id of targets) {
      if (this.labels.has(id)) continue;
      if (this.labels.size >= MAX_TARGETS) {
        this.labels.set(id, null);
        continue;
      }
      const doc = await getDocumentByPublicId(this.ctx, id);
      this.labels.set(id, doc && accessAtLeast(await documentAccess(this.ctx, this.reader, doc), "read") ? labelOf(doc) : null);
    }
    return relabel(blocks, this.labels);
  }

  async block(block: WireBlock): Promise<WireBlock> {
    return (await this.blocks([block]))[0]!;
  }
}

/** Whether `doc` or a page above it is restricted to invited people. */
async function underRestriction(ctx: Ctx, doc: Doc<"documents">): Promise<boolean> {
  let cursor: Doc<"documents"> | null = doc;
  for (let depth = 0; cursor && depth < 12; depth++) {
    if (cursor.accessMode === "restricted") return true;
    cursor = cursor.parentDocumentId ? await ctx.db.get(cursor.parentDocumentId) : null;
  }
  return false;
}

/**
 * Whether everyone who can read `source` may see the title of `target`: it's in the same scope and not
 * restricted (nor under a restricted page). Guests of the source page aside, that's everyone who can open
 * the source: the scope's owner or members.
 */
export async function titleIsShared(ctx: Ctx, source: Doc<"documents">, target: Doc<"documents"> | null): Promise<boolean> {
  return Boolean(target && hasValidScope(target) && hasValidScope(source) && sameScopeRows(target, source) && !(await underRestriction(ctx, target)));
}

/** Labels for everyone who can read `source` at once (see the top of this file). */
export async function sharedLabels(ctx: Ctx, source: Doc<"documents">, blocks: WireBlock[]): Promise<WireBlock[]> {
  const targets = linkTargets(blocks);
  if (!targets.size) return blocks;
  const labels = new Map<string, Label>();
  for (const id of targets) {
    if (labels.size >= MAX_TARGETS) break;
    const doc = await getDocumentByPublicId(ctx, id);
    labels.set(id, doc && (await titleIsShared(ctx, source, doc)) ? labelOf(doc) : null);
  }
  return relabel(blocks, labels);
}
