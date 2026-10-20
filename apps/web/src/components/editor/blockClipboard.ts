// Copying and cutting whole blocks (the block menu's Copy and Cut, ⌘C/⌘X on selected blocks or a selected
// block, and selections that take in a table, an image or another whole block).
//
// What goes on the clipboard:
//   application/x-folevi-blocks  the blocks as wire blocks (JSON: { v, documentId, blocks }), so pasting into
//                                any Folevi note (web, the Mac app, the iPhone and iPad app: all the same site)
//                                recreates them exactly, with new ids. Browsers keep custom types for pages
//                                of the same site, which every Folevi app is.
//   text/html                    for other apps: real lists and tables (cells show formulas' results), images,
//                                and a picture of a chart, mind map, flowchart, wireframe or sticky board. It
//                                carries the same wire blocks in a data attribute, the fallback when a custom
//                                type can't be written (the image copy below goes through the async
//                                clipboard, which only takes standard types).
//   text/plain                   Markdown-like text (clipboardText.ts), the text fallback for the pictures.
//   image/png                    a single picture block on its own: its PNG (shared export, canvas/exportImage).
// Pasting reads the custom type first, then the attribute, then everything else as before (paste.ts).
import { Fragment, Slice, type Node as PMNode } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";
import { LIMITS, SCHEMA_VERSION, flattenTree, rankSequence, repairWireBlock, ulid, type WireBlock } from "@folevi/editor-schema";
import { NODE_PROPS, nodeToFlat } from "./convert";
import { clipboardSerializer } from "./clipboardHtml";
import { sliceToText } from "./clipboardText";
import { blockImageFiles, blockImageSvg, IMAGE_BLOCKS } from "./canvas/blockImage";
import { svgToPng } from "./canvas/exportImage";

export const FOLEVI_BLOCKS_MIME = "application/x-folevi-blocks";
const CLIP_ATTR = "data-folevi-blocks";

export interface BlockClip {
  v: 1;
  /** The note the blocks were copied from (its files are shared with the note they're pasted into). */
  documentId: string | null;
  blocks: WireBlock[];
}

/** Top-level editor nodes (each with its depth) as wire blocks: a tree, depths relative to the first. */
export function nodesToBlocks(nodes: readonly PMNode[]): WireBlock[] {
  const flat = nodes
    .map((n) => nodeToFlat(n.attrs.id ? n : n.type.create({ ...n.attrs, id: ulid() }, n.content, n.marks)))
    .filter((f): f is NonNullable<typeof f> => Boolean(f));
  if (!flat.length) return [];
  const base = Math.min(...flat.map((f) => f.depth));
  const stack: { id: string; depth: number }[] = [];
  const placed: { id: string; parentId: string | null; f: (typeof flat)[number] }[] = [];
  for (const f of flat) {
    const depth = Math.min(f.depth - base, stack.length ? stack[stack.length - 1]!.depth + 1 : 0);
    while (stack.length && stack[stack.length - 1]!.depth >= depth) stack.pop();
    const id = ulid();
    placed.push({ id, parentId: depth > 0 && stack.length ? stack[stack.length - 1]!.id : null, f });
    stack.push({ id, depth });
  }
  const counts = new Map<string | null, number>();
  for (const p of placed) counts.set(p.parentId, (counts.get(p.parentId) ?? 0) + 1);
  const ranks = new Map([...counts].map(([k, n]) => [k, rankSequence(n)]));
  return placed.map((p) => ({ id: p.id, type: p.f.type, parentId: p.parentId, rank: ranks.get(p.parentId)!.shift()!, schemaVersion: p.f.schemaVersion, text: p.f.text, props: p.f.props }));
}

function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function fromBase64(b64: string): string {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/**
 * Blocks from the clipboard, made safe: only block types this editor knows, each repaired to what the server
 * accepts (or dropped), within the note's size. Null when the clipboard has no Folevi blocks.
 */
export function readBlockClip(data: DataTransfer | null): BlockClip | null {
  if (!data) return null;
  let raw: string | null;
  try {
    raw = data.getData(FOLEVI_BLOCKS_MIME) || null;
  } catch {
    raw = null;
  }
  if (!raw) {
    const html = data.getData("text/html");
    const m = html ? new RegExp(`${CLIP_ATTR}="([A-Za-z0-9+/=]+)"`).exec(html) : null;
    if (m) {
      try {
        raw = fromBase64(m[1]!);
      } catch {
        raw = null;
      }
    }
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<BlockClip>;
    if (parsed?.v !== 1 || !Array.isArray(parsed.blocks)) return null;
    const blocks: WireBlock[] = [];
    for (const b of parsed.blocks.slice(0, LIMITS.maxBlocksPerDocument)) {
      if (!b || typeof b !== "object" || typeof b.type !== "string" || !NODE_PROPS[b.type]) continue;
      const block: WireBlock = { id: String(b.id), type: b.type, parentId: b.parentId ?? null, rank: String(b.rank), schemaVersion: SCHEMA_VERSION, text: Array.isArray(b.text) ? b.text : [], props: b.props && typeof b.props === "object" ? b.props : {} };
      const { block: fixed, issues } = repairWireBlock(block);
      if (!issues.filter((i) => i.path !== "id" && i.path !== "parentId" && i.path !== "rank").length) blocks.push(fixed);
    }
    if (!blocks.length) return null;
    // Back in tree order (nesting from parentId), whatever order they came in.
    const ordered = flattenTree(blocks).map((e) => e.block);
    return { v: 1, documentId: typeof parsed.documentId === "string" ? parsed.documentId : null, blocks: ordered };
  } catch {
    return null;
  }
}

/** Data URLs for files a copied picture shows, by file id (set by the editor: canvas/imageFiles.ts). */
let clipboardFiles: ((fileIds: string[]) => Promise<Record<string, string>>) | null = null;

/** Lets copied pictures show the images inside them (a flowchart's shapes); null stops it. */
export function setClipboardFiles(resolve: typeof clipboardFiles): void {
  clipboardFiles = resolve;
}

/**
 * A picture block's SVG with the images it shows embedded (a flowchart's shapes), so the PNG on the clipboard
 * has them; without a way to fetch them (or when that fails) the picture keeps its placeholders.
 */
async function pictureWithFiles(node: PMNode, svg: string): Promise<string> {
  const files = blockImageFiles(node.type.name, node.attrs);
  if (!files.length || !clipboardFiles) return svg;
  try {
    const urls = await clipboardFiles(files);
    if (!Object.keys(urls).length) return svg;
    return blockImageSvg(node.type.name, node.attrs, { imageUrl: (id) => urls[id] ?? null }) ?? svg;
  } catch {
    return svg;
  }
}

/** The pictures of picture blocks (chart, mind map, flowchart, wireframe, sticky board) among `nodes`. */
function pictures(nodes: readonly PMNode[]): { node: PMNode; svg: string }[] {
  const out: { node: PMNode; svg: string }[] = [];
  for (const n of nodes) {
    if (!IMAGE_BLOCKS[n.type.name]) continue;
    try {
      const svg = blockImageSvg(n.type.name, n.attrs);
      if (svg) out.push({ node: n, svg });
    } catch {
      /* this block's picture can't be drawn yet: its text stands in */
    }
  }
  return out;
}

/** What the note shows for its image blocks right now (their signed addresses), by block id. */
function shownImages(view: EditorView, nodes: readonly PMNode[]): Map<string, string> {
  const out = new Map<string, string>();
  const ids = new Set(nodes.filter((n) => n.type.name === "image" && n.attrs.fileId).map((n) => String(n.attrs.id)));
  if (!ids.size) return out;
  for (const el of (view.dom as HTMLElement).querySelectorAll<HTMLElement>("[data-block-id]")) {
    const id = el.getAttribute("data-block-id");
    if (!id || !ids.has(id)) continue;
    const src = el.querySelector("img")?.currentSrc || el.querySelector("img")?.src;
    if (src && /^https:\/\//.test(src)) out.set(id, src);
  }
  return out;
}

/**
 * The HTML other apps read for these nodes: the editor's clipboard HTML (lists, tables, links), images where
 * the note has them, the pictures given (data URLs), and the wire blocks for Folevi.
 */
function htmlFor(view: EditorView, nodes: readonly PMNode[], clip: BlockClip, images: Map<string, string> = new Map()): string {
  const fragment = Fragment.fromArray([...nodes]);
  const dom = clipboardSerializer(view.state.schema).serializeFragment(fragment, { document });
  const wrap = document.createElement("div");
  wrap.appendChild(dom);
  const shown = shownImages(view, nodes);
  for (const el of wrap.querySelectorAll<HTMLElement>("[data-block-id]")) {
    const id = el.getAttribute("data-block-id") ?? "";
    const src = images.get(id) ?? shown.get(id);
    if (!src || el.querySelector("img")) continue;
    const img = document.createElement("img");
    img.src = src;
    const node = nodes.find((n) => n.attrs.id === id);
    img.alt = String(node?.attrs.alt || (node && IMAGE_BLOCKS[node.type.name]?.name) || "");
    el.appendChild(img);
  }
  return `<span ${CLIP_ATTR}="${toBase64(JSON.stringify(clip))}"></span>${wrap.innerHTML}`;
}

/** The note's id (the editor's root carries it). */
function documentIdOf(view: EditorView): string | null {
  return (view.dom as HTMLElement).closest("[data-fb-root]")?.getAttribute("data-fb-root") ?? null;
}

/** Whether a slice is whole blocks worth copying as blocks (not part of one line of text). */
export function sliceHasBlocks(slice: Slice): boolean {
  const c = slice.content;
  if (!c.childCount) return false;
  let atom = false;
  c.forEach((n) => {
    if (!n.isTextblock && n.isBlock) atom = true;
  });
  return atom;
}

/**
 * Writes blocks to a copy or cut event: the custom type, HTML and text at once, then (for picture blocks) a
 * richer copy through the async clipboard with their pictures. Returns false when the event can't take data.
 */
export function writeBlocksToEvent(view: EditorView, event: ClipboardEvent, nodes: readonly PMNode[]): boolean {
  const data = event.clipboardData;
  if (!data || !nodes.length) return false;
  const clip: BlockClip = { v: 1, documentId: documentIdOf(view), blocks: nodesToBlocks(nodes) };
  const slice = new Slice(Fragment.fromArray([...nodes]), 0, 0);
  const text = sliceToText(slice);
  const json = JSON.stringify(clip);
  event.preventDefault();
  data.clearData();
  data.setData("text/html", htmlFor(view, nodes, clip));
  data.setData("text/plain", text);
  try {
    data.setData(FOLEVI_BLOCKS_MIME, json);
  } catch {
    /* custom types refused here: the HTML carries the blocks */
  }
  copyPictures(view, nodes, clip, text);
  return true;
}

/**
 * Picture blocks copied: once their PNGs are drawn the clipboard gets HTML with them in (and, for a single
 * picture block, the PNG itself), so other apps paste the picture, with the text as the fallback. Started
 * at once (the ClipboardItem is made while the copy still counts as the person's own, which Safari needs);
 * if the browser refuses, the copy already written stays.
 */
function copyPictures(view: EditorView, nodes: readonly PMNode[], clip: BlockClip, text: string) {
  const list = pictures(nodes);
  if (!list.length || typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) return;
  const pngs = list.map((p) => pictureWithFiles(p.node, p.svg).then(svgToPng));
  const html = Promise.all(pngs.map((p) => p.then(blobDataUrl))).then((urls) => {
    const images = new Map(list.map((p, i) => [String(p.node.attrs.id), urls[i]!]));
    return new Blob([htmlFor(view, nodes, clip, images)], { type: "text/html" });
  });
  const items: Record<string, Promise<Blob> | Blob> = { "text/html": html, "text/plain": new Blob([text], { type: "text/plain" }) };
  if (nodes.length === 1 && list.length === 1) items["image/png"] = pngs[0]!;
  try {
    void navigator.clipboard.write([new ClipboardItem(items)]).catch(() => undefined);
  } catch {
    /* kept: the copy already written */
  }
}

const blobDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
