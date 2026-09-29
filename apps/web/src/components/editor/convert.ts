// Conversions between the canonical Folevi block model and the editor's ProseMirror document.
// The editor is a flat list of block nodes with a `depth` attribute; the canonical model is a tree
// (parentId + fractional rank). assignTreePositions maps between them while preserving existing ranks.
import type { JSONContent } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import {
  SCHEMA_VERSION,
  assignTreePositions,
  canonicalJson,
  flattenTree,
  normalizeInline,
  type ChangedField,
  type InlineNode,
  type Mark,
  type WireBlock,
} from "@folevi/editor-schema";

/** The editor names the code block node "codeBlock" (the inline mark is "code"); canonically it is "code". */
export const nodeNameFor = (type: string) => (type === "code" ? "codeBlock" : type);
export const blockTypeFor = (nodeName: string) => (nodeName === "codeBlock" ? "code" : nodeName);

export const TEXT_NODES = new Set(["paragraph", "heading", "bulleted", "numbered", "todo", "toggle", "quote", "callout"]);
export const ATOM_NODES = new Set(["divider", "pageBreak", "image", "file", "table", "page", "bookmark", "collection", "formula", "whiteboard", "flowchart", "unknownBlock"]);

/** Props each node stores as attributes (besides id/depth). */
const FORMAT = ["decoration", "color", "align", "font", "group"];

export const NODE_PROPS: Record<string, string[]> = {
  paragraph: ["textStyle", ...FORMAT],
  heading: ["level", ...FORMAT],
  bulleted: [...FORMAT],
  numbered: [...FORMAT],
  todo: ["checked", "canceled", "dueDate", "dueTime", "priority", "assigneeId", "reminderAt", "completedAt", ...FORMAT],
  toggle: ["collapsed", ...FORMAT],
  quote: [...FORMAT],
  callout: ["tone", "icon"],
  code: ["language"],
  divider: ["style"],
  pageBreak: [],
  image: ["fileId", "url", "alt", "caption", "width", "naturalWidth", "naturalHeight"],
  file: ["fileId", "name", "size", "mimeType"],
  table: ["rows", "headerRow"],
  page: ["documentId", "display", "titleCache", "iconCache"],
  bookmark: ["url", "title", "description", "siteName"],
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
      case "text":
        if (n.text) out.push(n.marks?.length ? { type: "text", text: n.text, marks: n.marks.map(markToPM) } : { type: "text", text: n.text });
        break;
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
      out.push({ type: "text", text: "\n" });
    }
  });
  return normalizeInline(out);
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
    if (!props.language) props.language = "plaintext";
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

/** Editor document → canonical blocks, keeping ranks of blocks whose position didn't change. */
export function docToBlocks(doc: PMNode, previous: ReadonlyMap<string, WireBlock>): WireBlock[] {
  const flat: FlatBlock[] = [];
  doc.forEach((node) => {
    const f = nodeToFlat(node);
    if (f) flat.push(f);
  });
  const positions = assignTreePositions(
    flat.map((f) => {
      const prev = previous.get(f.id);
      return { id: f.id, depth: f.depth, rank: prev?.rank, parentId: prev?.parentId };
    }),
  );
  return flat.map((f) => {
    const pos = positions.get(f.id)!;
    return { id: f.id, type: f.type, parentId: pos.parentId, rank: pos.rank, schemaVersion: f.schemaVersion, text: f.text, props: f.props };
  });
}

export interface BlockDiff {
  upserts: { block: WireBlock; fields: ChangedField[] }[];
  deletes: string[];
}

export function contentKey(b: Pick<WireBlock, "type" | "text" | "props">): string {
  return canonicalJson({ t: b.type, x: b.text, p: b.props });
}

export function diffBlocks(previous: ReadonlyMap<string, WireBlock>, next: readonly WireBlock[]): BlockDiff {
  const upserts: BlockDiff["upserts"] = [];
  const seen = new Set<string>();
  for (const b of next) {
    seen.add(b.id);
    const prev = previous.get(b.id);
    if (!prev) {
      upserts.push({ block: b, fields: ["content", "position"] });
      continue;
    }
    const fields: ChangedField[] = [];
    if (contentKey(prev) !== contentKey(b)) fields.push("content");
    if (prev.parentId !== b.parentId || prev.rank !== b.rank) fields.push("position");
    if (fields.length) upserts.push({ block: b, fields });
  }
  const deletes: string[] = [];
  for (const id of previous.keys()) if (!seen.has(id)) deletes.push(id);
  return { upserts, deletes };
}
