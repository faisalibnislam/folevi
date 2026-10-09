// Conversions between the canonical Folevi block model and the editor's ProseMirror document.
// The editor is a flat list of block nodes with a `depth` attribute; the canonical model is a tree
// (parentId + fractional rank). assignTreePositions maps between them while preserving existing ranks.
import type { JSONContent } from "@tiptap/core";
import type { Node as PMNode, Schema } from "@tiptap/pm/model";
import {
  SCHEMA_VERSION,
  assignTreePositions,
  canonicalJson,
  flattenTree,
  normalizeInline,
  normalizeLanguage,
  type ChangedField,
  type InlineNode,
  type Mark,
  type WireBlock,
} from "@folevi/editor-schema";

export const blockTypeFor = (nodeName: string) => (nodeName === "codeBlock" ? "code" : nodeName);

export const TEXT_NODES = new Set(["paragraph", "heading", "bulleted", "numbered", "todo", "toggle", "quote", "callout"]);

/** Props each node stores as attributes (besides id/depth). */
const FORMAT = ["decoration", "color", "align", "font", "group"];

export const NODE_PROPS: Record<string, string[]> = {
  paragraph: ["textStyle", ...FORMAT],
  heading: ["level", ...FORMAT],
  bulleted: [...FORMAT],
  numbered: [...FORMAT],
  todo: ["checked", "canceled", "dueDate", "dueTime", "priority", "assigneeId", "reminderAt", "completedAt", ...FORMAT],
  toggle: ["collapsed", "study", ...FORMAT],
  quote: [...FORMAT],
  callout: ["tone", "icon"],
  code: ["language"],
  divider: ["style"],
  pageBreak: [],
  image: ["fileId", "url", "alt", "caption", "width", "naturalWidth", "naturalHeight"],
  file: ["fileId", "name", "size", "mimeType"],
  audio: ["fileId", "name", "size", "mimeType", "duration"],
  table: ["rows", "headerRow"],
  page: ["documentId", "display", "titleCache", "iconCache"],
  bookmark: ["url", "title", "description", "siteName", "image", "icon"],
  collection: ["collectionId", "viewId"],
  formula: ["latex"],
  whiteboard: ["data", "height"],
  flowchart: ["data", "height"],
};

function markToPM(m: Mark): { type: string; attrs?: Record<string, unknown> } {
  switch (m.type) {
    case "link":
      return { type: "link", attrs: { href: m.href } };
    case "color":
      return { type: "textColor", attrs: { value: m.value } };
    case "highlight":
      return { type: "highlight", attrs: { value: m.value } };
    default:
      return { type: m.type };
  }
}

export function inlineToPM(nodes: readonly InlineNode[]): JSONContent[] {
  const out: JSONContent[] = [];
  for (const n of nodes) {
    switch (n.type) {
      case "text": {
        // A "\n" in stored text is a line break inside the block (Shift+Enter).
        const parts = n.text.split("\n");
        parts.forEach((part, i) => {
          if (i > 0) out.push({ type: "hardBreak" });
          if (part) out.push(n.marks?.length ? { type: "text", text: part, marks: n.marks.map(markToPM) } : { type: "text", text: part });
        });
        break;
      }
      case "mention":
        out.push({ type: "mention", attrs: { userId: n.userId, label: n.label } });
        break;
      case "date":
        out.push({ type: "dateMention", attrs: { date: n.date } });
        break;
      case "pageLink":
        out.push({ type: "pageLink", attrs: { documentId: n.documentId, label: n.label } });
        break;
    }
  }
  return out;
}

/** Placeholder marks for a line break until its neighbours are known. */
const BREAK: Mark[] = [];

export function pmInline(node: PMNode): InlineNode[] {
  const out: InlineNode[] = [];
  node.forEach((child) => {
    if (child.isText) {
      const marks: Mark[] = [];
      for (const m of child.marks) {
        const name = m.type.name;
        if (name === "link") marks.push({ type: "link", href: String(m.attrs.href ?? "") });
        else if (name === "textColor") marks.push({ type: "color", value: m.attrs.value });
        else if (name === "highlight") marks.push({ type: "highlight", value: m.attrs.value });
        else if (["bold", "italic", "underline", "strike", "code"].includes(name)) marks.push({ type: name as "bold" });
      }
      out.push(marks.length ? { type: "text", text: child.text ?? "", marks } : { type: "text", text: child.text ?? "" });
    } else if (child.type.name === "mention") {
      out.push({ type: "mention", userId: String(child.attrs.userId), label: String(child.attrs.label) });
    } else if (child.type.name === "dateMention") {
      out.push({ type: "date", date: String(child.attrs.date) });
    } else if (child.type.name === "pageLink") {
      out.push({ type: "pageLink", documentId: String(child.attrs.documentId), label: String(child.attrs.label) });
    } else if (child.type.name === "hardBreak") {
      out.push({ type: "text", text: "\n", marks: BREAK });
    }
  });
  // A line break carries the marks the text on both sides of it shares (so bold "one⏎two" stays one bold
  // run), and none otherwise.
  const resolved = [...out];
  for (let i = 0; i < out.length; i++) {
    const n = out[i]!;
    if (n.type !== "text" || n.marks !== BREAK) continue;
    // Several breaks in a row look past each other.
    let a = i - 1;
    while (a >= 0 && out[a]!.type === "text" && (out[a] as { marks?: Mark[] }).marks === BREAK) a--;
    let b = i + 1;
    while (b < out.length && out[b]!.type === "text" && (out[b] as { marks?: Mark[] }).marks === BREAK) b++;
    const before = out[a];
    const after = out[b];
    const marksOf = (x: InlineNode | undefined) => (x?.type === "text" && x.marks !== BREAK ? (x.marks ?? []) : []);
    const shared = marksOf(before).filter((m) => marksOf(after).some((o) => JSON.stringify(o) === JSON.stringify(m)));
    resolved[i] = shared.length ? { type: "text", text: "\n", marks: shared } : { type: "text", text: "\n" };
  }
  return normalizeInline(resolved);
}

/** Canonical blocks → editor document JSON. */
export function blocksToDoc(blocks: readonly WireBlock[]): JSONContent {
  const flat = flattenTree(blocks);
  const content: JSONContent[] = flat.map(({ block, depth }) => blockToNode(block, depth));
  if (!content.length) content.push({ type: "paragraph", attrs: { id: null, depth: 0 } });
  return { type: "doc", content };
}

export function blockToNode(block: WireBlock, depth: number): JSONContent {
  const props = block.props as Record<string, unknown>;
  const known = NODE_PROPS[block.type];
  if (!known || block.schemaVersion > SCHEMA_VERSION) {
    return { type: "unknownBlock", attrs: { id: block.id, depth, wire: { type: block.type, schemaVersion: block.schemaVersion, text: block.text, props: block.props } } };
  }
  const attrs: Record<string, unknown> = { id: block.id, depth };
  for (const k of known) attrs[k] = props[k] ?? null;
  if (block.type === "code") {
    const code = String(props.code ?? "");
    return { type: "codeBlock", attrs, content: code ? [{ type: "text", text: code }] : [] };
  }
  if (TEXT_NODES.has(block.type)) return { type: block.type, attrs, content: inlineToPM(block.text) };
  return { type: block.type, attrs };
}

export interface FlatBlock {
  id: string;
  depth: number;
  type: string;
  schemaVersion: number;
  text: InlineNode[];
  props: Record<string, unknown>;
}

export function nodeToFlat(node: PMNode): FlatBlock | null {
  const id = node.attrs.id as string | null;
  if (!id) return null;
  const depth = Number(node.attrs.depth ?? 0);
  const type = blockTypeFor(node.type.name);
  if (type === "unknownBlock") {
    const wire = node.attrs.wire as { type: string; schemaVersion: number; text: InlineNode[]; props: Record<string, unknown> };
    return { id, depth, type: wire.type, schemaVersion: wire.schemaVersion, text: wire.text, props: wire.props };
  }
  const props: Record<string, unknown> = {};
  for (const k of NODE_PROPS[type] ?? []) {
    const v = node.attrs[k];
    if (v !== null && v !== undefined) props[k] = v;
  }
  if (type === "code") {
    props.code = node.textContent;
    props.language = normalizeLanguage(String(props.language ?? "plaintext"));
    return { id, depth, type, schemaVersion: SCHEMA_VERSION, text: [], props };
  }
  if (type === "todo") props.checked = Boolean(props.checked);
  if (type === "toggle") props.collapsed = Boolean(props.collapsed);
  if (type === "heading") props.level = Number(props.level ?? 1);
  if (type === "callout" && !props.tone) props.tone = "note";
  if (type === "table" && props.headerRow === undefined) props.headerRow = true;
  if (type === "formula") props.latex = String(props.latex ?? "");
  if (type === "whiteboard") {
    props.data = String(props.data ?? "");
    props.height = Number(props.height ?? 420) || 420;
  }
  if (type === "flowchart") {
    props.data = String(props.data ?? "");
    props.height = Math.round(Number(props.height ?? 440)) || 440;
  }
  return { id, depth, type, schemaVersion: SCHEMA_VERSION, text: TEXT_NODES.has(type) ? pmInline(node) : [], props };
}

/*
 * A long note is saved about once a second while typing, and almost all of it is unchanged each time. Blocks
 * are converted once per node (ProseMirror keeps an unchanged line's node between versions of the document),
 * a converted block comes back as the same object while its place is the same (so comparing it with what was
 * saved is one check), and tree positions are worked out again only when the lines or their nesting change.
 * The results are the ones a full conversion gives. Nothing changes these objects: they're replaced.
 */
const flatOf = new WeakMap<PMNode, FlatBlock | null>();
const wireOf = new WeakMap<FlatBlock, WireBlock>();
let lastTree: { ids: string[]; depths: number[]; positions: Map<string, { parentId: string | null; rank: string }> } | null = null;

/** Tree positions for the lines in order (see assignTreePositions), reusing the last ones while nothing they depend on changed. */
function treePositions(flat: readonly FlatBlock[], previous: ReadonlyMap<string, WireBlock>): Map<string, { parentId: string | null; rank: string }> {
  // Positions are kept exactly when every block still has the place they gave it: then working them out again
  // gives the same.
  const same =
    lastTree !== null &&
    lastTree.ids.length === flat.length &&
    flat.every((f, i) => {
      const prev = previous.get(f.id);
      const pos = lastTree!.positions.get(f.id);
      return lastTree!.ids[i] === f.id && lastTree!.depths[i] === f.depth && prev !== undefined && pos !== undefined && prev.parentId === pos.parentId && prev.rank === pos.rank;
    });
  if (same) return lastTree!.positions;
  const positions = assignTreePositions(
    flat.map((f) => {
      const prev = previous.get(f.id);
      return { id: f.id, depth: f.depth, rank: prev?.rank, parentId: prev?.parentId };
    }),
  );
  lastTree = { ids: flat.map((f) => f.id), depths: flat.map((f) => f.depth), positions };
  return positions;
}

/** Editor document → canonical blocks, keeping ranks of blocks whose position didn't change. */
export function docToBlocks(doc: PMNode, previous: ReadonlyMap<string, WireBlock>): WireBlock[] {
  const flat: FlatBlock[] = [];
  doc.forEach((node) => {
    let f = flatOf.get(node);
    if (f === undefined) {
      f = nodeToFlat(node);
      flatOf.set(node, f);
    }
    if (f) flat.push(f);
  });
  const positions = treePositions(flat, previous);
  return flat.map((f) => {
    const pos = positions.get(f.id)!;
    const known = wireOf.get(f);
    if (known && known.parentId === pos.parentId && known.rank === pos.rank) return known;
    const block = { id: f.id, type: f.type, parentId: pos.parentId, rank: pos.rank, schemaVersion: f.schemaVersion, text: f.text, props: f.props };
    wireOf.set(f, block);
    return block;
  });
}

export interface BlockDiff {
  upserts: { block: WireBlock; fields: ChangedField[] }[];
  deletes: string[];
}

/** Content keys of blocks already compared (blocks are never changed in place, only replaced). */
const keyOf = new WeakMap<object, string>();
export function contentKey(b: Pick<WireBlock, "type" | "text" | "props">): string {
  let key = keyOf.get(b);
  if (key === undefined) {
    key = canonicalJson({ t: b.type, x: b.text, p: b.props });
    keyOf.set(b, key);
  }
  return key;
}

/**
 * Stored text in the shape the editor would save it (a line break and the formatting around it can be
 * written more than one way): comparing in this shape, an unchanged block never counts as edited.
 */
const loadedShape = new WeakMap<WireBlock, string>();
export function storedContentKey(b: WireBlock, schema: Schema | null): string {
  if (!schema || !TEXT_NODES.has(b.type) || !b.text.some((n) => n.type === "text" && n.text.includes("\n"))) return contentKey(b);
  const cached = loadedShape.get(b);
  if (cached !== undefined) return cached;
  let key: string;
  try {
    key = contentKey({ ...b, text: pmInline(schema.nodeFromJSON(blockToNode(b, 0))) });
  } catch {
    key = contentKey(b);
  }
  loadedShape.set(b, key);
  return key;
}

function onlyCollapsed(a: WireBlock, b: WireBlock): boolean {
  return contentKey(a) === contentKey({ ...b, props: { ...b.props, collapsed: a.props.collapsed } });
}

export function diffBlocks(previous: ReadonlyMap<string, WireBlock>, next: readonly WireBlock[], schema: Schema | null = null): BlockDiff {
  const upserts: BlockDiff["upserts"] = [];
  const seen = new Set<string>();
  for (const b of next) {
    seen.add(b.id);
    const prev = previous.get(b.id);
    // The block as it was saved, unchanged (see docToBlocks).
    if (prev === b) continue;
    if (!prev) {
      upserts.push({ block: b, fields: ["content", "position"] });
      continue;
    }
    const fields: ChangedField[] = [];
    // A toggle opened or closed says so ("collapsed"): only that, it never conflicts with an edit of its text.
    if (storedContentKey(prev, schema) !== contentKey(b)) {
      const toggled = prev.type === "toggle" && b.type === "toggle" && Boolean(prev.props.collapsed) !== Boolean(b.props.collapsed);
      if (!toggled || !onlyCollapsed(prev, b)) fields.push("content");
      if (toggled) fields.push("collapsed");
    }
    if (prev.parentId !== b.parentId || prev.rank !== b.rank) fields.push("position");
    if (fields.length) upserts.push({ block: b, fields });
  }
  const deletes: string[] = [];
  for (const id of previous.keys()) if (!seen.has(id)) deletes.push(id);
  return { upserts, deletes };
}

/**
 * What the person changed: the editor's document against the blocks as the editor last showed them (never
 * against newer ones it hasn't shown yet, which it would undo). Deletes come deepest first, so a parent's
 * delete follows those of everything under it, even across batches: whatever is still under it when the
 * server takes it is something this device never saw (and the server keeps it, asking first).
 */
export function localChanges(doc: PMNode, shown: ReadonlyMap<string, WireBlock>, schema: Schema | null = null): BlockDiff & { next: WireBlock[] } {
  const next = docToBlocks(doc, shown);
  const diff = diffBlocks(shown, next, schema);
  const deleted = new Set(diff.deletes);
  const deletes = !deleted.size
    ? []
    : flattenTree([...shown.values()])
        .map((e) => e.block.id)
        .filter((id) => deleted.has(id))
        .reverse();
  return { next, upserts: diff.upserts, deletes };
}
