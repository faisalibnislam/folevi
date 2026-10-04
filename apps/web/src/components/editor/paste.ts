// Paste normalization: arbitrary HTML (web pages, Google Docs, Word, other editors) → canonical blocks.
// Only structure and safe inline formatting survive; scripts, styles and unknown markup are dropped.
import { SCHEMA_VERSION, flattenTree, markdownToBlocks, normalizeLanguage, normalizeInline, rankSequence, sanitizeHref, ulid, type InlineNode, type Mark, type WireBlock } from "@folevi/editor-schema";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import type { Slice } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";
import { blockToNode } from "./convert";
import { normalizeDepths } from "./commands";
import { afterSubtree, deleteVisibleRange } from "./plugins";
import { hiddenIndices } from "./blockSelectionState";

/**
 * Before any paste: a range through a collapsed toggle loses only its visible part (the hidden blocks stay),
 * and several whole blocks pasted at the end of a collapsed toggle go after its hidden blocks.
 */
/** In a code block, any paste is its plain text (formatting and line structure from elsewhere would split it). */
export function pasteIntoCode(view: EditorView, data: DataTransfer | null): boolean {
  const { $from, $to } = view.state.selection;
  if ($from.parent.type.name !== "codeBlock" || !$from.sameParent($to) || !data) return false;
  const text = data.getData("text/plain").replace(/\r\n?/g, "\n");
  if (!text) return false;
  view.dispatch(view.state.tr.insertText(text).scrollIntoView());
  return true;
}

export function prepareForPaste(view: EditorView, slice: Slice | null): void {
  const visible = deleteVisibleRange(view.state);
  if (visible) view.dispatch(visible);
  // Pasting while a whole block (an image, a divider, a table…) is selected goes on a new line after it,
  // like typing does, instead of replacing it.
  const picked = view.state.selection;
  if (picked instanceof NodeSelection && picked.node.isBlock && picked.$from.depth === 0) {
    const at = afterSubtree(view.state, picked.$from.index(0));
    const tr = view.state.tr.insert(at, view.state.schema.nodes.paragraph!.create({ id: null, depth: picked.node.attrs.depth }));
    tr.setSelection(TextSelection.create(tr.doc, at + 1));
    view.dispatch(tr);
  }
  const { state } = view;
  const { $from, empty } = state.selection;
  if (!slice || !empty || $from.depth < 1 || slice.content.childCount < 2) return;
  const parent = $from.parent;
  if (parent.type.name !== "toggle" || !parent.attrs.collapsed || $from.parentOffset !== parent.content.size) return;
  const index = $from.index(0);
  if (!hiddenIndices(state).has(index + 1)) return;
  let at = $from.after(1);
  for (let i = index + 1; i < state.doc.childCount && hiddenIndices(state).has(i); i++) at += state.doc.child(i).nodeSize;
  const tr = state.tr.insert(at, state.schema.nodes.paragraph!.create({ id: null, depth: parent.attrs.depth }));
  tr.setSelection(TextSelection.create(tr.doc, at + 1));
  view.dispatch(tr);
}

interface Draft {
  type: string;
  depth: number;
  text: InlineNode[];
  props: Record<string, unknown>;
}

const BLOCK_TAGS = new Set(["P", "DIV", "H1", "H2", "H3", "H4", "H5", "H6", "LI", "BLOCKQUOTE", "PRE", "HR", "UL", "OL", "TABLE", "IMG", "FIGURE", "SECTION", "ARTICLE", "HEADER", "FOOTER", "ASIDE", "DETAILS"]);
const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "IFRAME", "OBJECT", "EMBED", "SVG", "CANVAS", "BUTTON", "INPUT", "SELECT", "TEXTAREA", "META", "LINK", "HEAD", "TITLE"]);

/** The marks an inline element adds (bold, italic, a link…), on top of `marks`. */
function marksFor(e: HTMLElement, marks: Mark[]): Mark[] {
  const next = [...marks];
  const style = e.getAttribute("style") ?? "";
  if (e.tagName === "STRONG" || e.tagName === "B" || /font-weight:\s*(bold|[6-9]00)/.test(style)) next.push({ type: "bold" });
  if (e.tagName === "EM" || e.tagName === "I" || /font-style:\s*italic/.test(style)) next.push({ type: "italic" });
  if (e.tagName === "U" || /text-decoration[^;]*underline/.test(style)) next.push({ type: "underline" });
  if (e.tagName === "S" || e.tagName === "DEL" || e.tagName === "STRIKE" || /line-through/.test(style)) next.push({ type: "strike" });
  if (e.tagName === "CODE" || e.tagName === "KBD" || e.tagName === "SAMP") next.push({ type: "code" });
  if (e.tagName === "MARK") next.push({ type: "highlight", value: "yellow" });
  if (e.tagName === "A") {
    const href = sanitizeHref(e.getAttribute("href") ?? "");
    if (href && !href.startsWith("#")) next.push({ type: "link", href });
  }
  // Google Docs wraps a whole paste in <b style="font-weight:normal">: that isn't bold.
  if (e.tagName === "B" && /font-weight:\s*(normal|[1-4]00)/.test(style)) next.splice(next.findIndex((m) => m.type === "bold"), 1);
  return next;
}

/**
 * The text of some nodes with their formatting. Block elements inside are skipped, or with `flatten`
 * (a table cell) read too, separated by spaces.
 */
function inlineOfNodes(nodes: Iterable<ChildNode>, marks: Mark[] = [], flatten = false): InlineNode[] {
  const out: InlineNode[] = [];
  for (const child of nodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = (child.textContent ?? "").replace(/\s+/g, " ");
      if (text) out.push(marks.length ? { type: "text", text, marks: [...marks] } : { type: "text", text });
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const e = child as HTMLElement;
    // Word's own list markers ("·", "1.") are drawn text, marked mso-list:Ignore.
    if (SKIP.has(e.tagName) || e.tagName === "IMG" || /mso-list:\s*Ignore/i.test(e.getAttribute("style") ?? "")) continue;
    if (BLOCK_TAGS.has(e.tagName) || e.tagName === "TR" || e.tagName === "TD" || e.tagName === "TH") {
      if (!flatten) continue;
      if (out.length) out.push({ type: "text", text: " " });
      out.push(...inlineOfNodes(e.childNodes, marks, true));
      continue;
    }
    if (e.tagName === "BR") {
      out.push({ type: "text", text: "\n" });
      continue;
    }
    out.push(...inlineOfNodes(e.childNodes, marksFor(e, marks), flatten));
  }
  return out;
}

const inlineOf = (el: Node, marks: Mark[] = [], flatten = false) => inlineOfNodes(el.childNodes, marks, flatten);

function clean(nodes: InlineNode[]): InlineNode[] {
  const normalized = normalizeInline(nodes);
  // Trim leading/trailing whitespace of the block.
  const first = normalized[0];
  if (first?.type === "text") first.text = first.text.replace(/^\s+/, "");
  const last = normalized[normalized.length - 1];
  if (last?.type === "text") last.text = last.text.replace(/\s+$/, "");
  return normalizeInline(normalized);
}

const BLOCK_SELECTOR = [...BLOCK_TAGS].filter((t) => t !== "IMG").join(",");

/** Elements with a block inside them, worked out once per paste (asking each element would be very slow on
 * deeply nested HTML). Null outside a paste: then each element is asked. */
let withBlocks: WeakSet<Element> | null = null;
function containsBlock(e: Element): boolean {
  return withBlocks ? withBlocks.has(e) : Boolean(e.querySelector(BLOCK_SELECTOR));
}
function markBlockContainers(root: Element): WeakSet<Element> {
  const set = new WeakSet<Element>();
  const all = [...root.querySelectorAll("*")].reverse();
  for (const el of all) {
    for (const c of el.children) {
      if ((BLOCK_TAGS.has(c.tagName) && c.tagName !== "IMG") || set.has(c)) {
        set.add(el);
        break;
      }
    }
  }
  return set;
}

/** Images inside inline content (a linked picture, a picture in a paragraph) become image blocks. */
function imagesIn(nodes: Iterable<ChildNode>, depth: number, out: Draft[]) {
  for (const n of nodes) {
    if (n.nodeType !== Node.ELEMENT_NODE) continue;
    const e = n as HTMLElement;
    const imgs = e.tagName === "IMG" ? [e] : [...e.querySelectorAll("img")];
    for (const img of imgs) {
      const src = img.getAttribute("src") ?? "";
      if (/^https:\/\//i.test(src)) out.push({ type: "image", depth, text: [], props: { url: src, alt: img.getAttribute("alt") ?? "", caption: "" } });
    }
  }
}

function walk(el: Element, depth: number, out: Draft[], listType: "bulleted" | "numbered" | null = null, marks: Mark[] = []): void {
  walkNodes([...el.childNodes], depth, out, listType, marks);
}

/** Consecutive text and inline elements form one paragraph; block elements become blocks. */
function walkNodes(nodes: ChildNode[], depth: number, out: Draft[], listType: "bulleted" | "numbered" | null, marks: Mark[]): void {
  let run: ChildNode[] = [];
  const flush = () => {
    if (!run.length) return;
    const text = clean(inlineOfNodes(run, marks));
    if (text.length) out.push({ type: "paragraph", depth, text, props: {} });
    imagesIn(run, depth, out);
    run = [];
  };
  for (const child of nodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      run.push(child);
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const e = child as HTMLElement;
    if (SKIP.has(e.tagName)) continue;
    const isBlock = BLOCK_TAGS.has(e.tagName) && e.tagName !== "IMG";
    if (!isBlock && e.tagName !== "IMG" && !containsBlock(e)) {
      run.push(child);
      continue;
    }
    flush();
    if (!isBlock && e.tagName !== "IMG") {
      // An inline element wrapping blocks (a link around a card, <b> around paragraphs): its marks apply inside.
      walk(e, depth, out, listType, marksFor(e, marks));
      continue;
    }
    block(e, depth, out, listType, marks);
  }
  flush();
}

function block(e: HTMLElement, depth: number, out: Draft[], listType: "bulleted" | "numbered" | null, marks: Mark[]): void {
  switch (e.tagName) {
    case "H1":
    case "H2":
    case "H3":
    case "H4":
    case "H5":
    case "H6": {
      const text = clean(inlineOf(e, marks));
      if (text.length) out.push({ type: "heading", depth: 0, text, props: { level: Math.min(3, Number(e.tagName[1])) } });
      return;
    }
    case "P": {
      // Word writes list items as paragraphs: "mso-list:l0 level2 lfo1" with the marker in an ignored span.
      const wordList = /mso-list:\s*l\d+\s+level(\d+)/i.exec(e.getAttribute("style") ?? "");
      if (wordList) {
        const marker = [...e.querySelectorAll<HTMLElement>("[style*='mso-list']")].find((m) => /Ignore/i.test(m.getAttribute("style") ?? ""))?.textContent?.trim() ?? "";
        const text = clean(inlineOf(e, marks));
        if (text.length) out.push({ type: /^[\dA-Za-z]{1,3}[.)]$/.test(marker) ? "numbered" : "bulleted", depth: depth + Number(wordList[1]) - 1, text, props: {} });
        return;
      }
      const text = clean(inlineOf(e, marks));
      if (text.length) out.push({ type: "paragraph", depth, text, props: {} });
      imagesIn(e.childNodes, depth, out);
      return;
    }
    case "UL":
    case "OL":
      walk(e, listType ? depth + 1 : depth, out, e.tagName === "OL" ? "numbered" : "bulleted", marks);
      return;
    case "LI": {
      const checkbox = e.querySelector(":scope > input[type=checkbox], :scope > p > input[type=checkbox], :scope > label > input[type=checkbox]") as HTMLInputElement | null;
      let inline = clean(inlineOf(e, marks));
      // Block children: the first one is the item's text when it has none of its own; the rest nest under it.
      const kids = [...e.children].filter((c) => BLOCK_TAGS.has(c.tagName) && c.tagName !== "UL" && c.tagName !== "OL");
      let rest = kids;
      let firstKid: Element | null = null;
      if (!inline.length && kids.length) {
        firstKid = kids[0]!;
        inline = clean(inlineOf(firstKid, marks));
        // A wrapper with nothing of its own (just blocks inside): read it whole.
        if (!inline.length) inline = clean(inlineOf(firstKid, marks, true));
        rest = kids.slice(1);
      }
      const type = checkbox || e.getAttribute("data-checked") !== null || /task-list-item|checklist|to-do/.test(e.className) ? "todo" : (listType ?? "bulleted");
      const props = type === "todo" ? { checked: Boolean(checkbox?.checked) || e.getAttribute("data-checked") === "true" } : {};
      // Google Docs keeps nested items in one flat list, with their level in aria-level.
      const level = Number(e.getAttribute("aria-level"));
      const itemDepth = level > 1 && !e.parentElement?.closest("li") ? depth + level - 1 : depth;
      out.push({ type, depth: itemDepth, text: inline, props });
      // Lists and blocks inside the item's first wrapper (<li><div>Two<ul>…</ul></div>) nest under it.
      if (firstKid && clean(inlineOf(firstKid, marks)).length) {
        for (const n of [...firstKid.children]) {
          if (n.tagName === "UL" || n.tagName === "OL") walk(n, itemDepth + 1, out, n.tagName === "OL" ? "numbered" : "bulleted", marks);
          else if (BLOCK_TAGS.has(n.tagName) && n.tagName !== "IMG") block(n as HTMLElement, itemDepth + 1, out, null, marks);
        }
      }
      for (const k of rest) block(k as HTMLElement, itemDepth + 1, out, null, marks);
      for (const n of [...e.children]) if (n.tagName === "UL" || n.tagName === "OL") walk(n, itemDepth + 1, out, n.tagName === "OL" ? "numbered" : "bulleted", marks);
      return;
    }
    case "BLOCKQUOTE": {
      if (!containsBlock(e)) {
        const text = clean(inlineOf(e, marks));
        if (text.length) out.push({ type: "quote", depth, text, props: {} });
        return;
      }
      // A quote of several paragraphs: each paragraph is a quote line.
      const inner: Draft[] = [];
      walk(e, depth, inner, null, marks);
      for (const d of inner) out.push(d.type === "paragraph" ? { ...d, type: "quote" } : d);
      return;
    }
    case "PRE": {
      const code = e.textContent ?? "";
      const cls = e.querySelector("code")?.className ?? "";
      const lang = normalizeLanguage(/language-([\w+#-]+)/.exec(cls)?.[1] ?? "plaintext");
      out.push({ type: "code", depth: 0, text: [], props: { language: lang, code: code.replace(/\n$/, "") } });
      return;
    }
    case "HR":
      out.push({ type: "divider", depth: 0, text: [], props: {} });
      return;
    case "DETAILS": {
      // A disclosure (<details><summary>) is a toggle with the rest nested inside it.
      const summary = e.querySelector(":scope > summary");
      out.push({ type: "toggle", depth, text: summary ? clean(inlineOf(summary, marks)) : [], props: { collapsed: !(e as HTMLDetailsElement).open } });
      walkNodes([...e.childNodes].filter((n) => n !== summary), depth + 1, out, null, marks);
      return;
    }
    case "IMG":
      imagesIn([e], depth, out);
      return;
    case "TABLE": {
      // This table's own rows and cells (a table nested in a cell is read as that cell's text).
      const table = e as HTMLTableElement;
      const rows = [...table.rows].slice(0, 200).map((tr) => [...tr.cells].slice(0, 20).map((c) => clean(inlineOf(c, marks, true))));
      const width = Math.max(1, ...rows.map((r) => r.length));
      const header = [...table.rows][0]?.cells[0]?.tagName === "TH";
      if (rows.length) out.push({ type: "table", depth: 0, text: [], props: { headerRow: header, rows: rows.map((r) => [...r, ...Array.from({ length: width - r.length }, () => [])]) } });
      return;
    }
    default:
      walk(e, depth, out, listType, marks);
  }
}

export function htmlToBlocks(html: string): WireBlock[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const drafts: Draft[] = [];
  withBlocks = markBlockContainers(doc.body);
  try {
    walk(doc.body, 0, drafts);
  } finally {
    withBlocks = null;
  }
  // Convert depth annotations into parents/ranks.
  const blocks: WireBlock[] = [];
  const stack: { id: string; depth: number }[] = [];
  const siblingsCount = new Map<string | null, number>();
  const assigned: { draft: Draft; id: string; parentId: string | null }[] = [];
  for (const d of drafts) {
    const depth = Math.min(d.depth, stack.length ? stack[stack.length - 1]!.depth + 1 : 0);
    while (stack.length && stack[stack.length - 1]!.depth >= depth) stack.pop();
    const parentId = depth > 0 && stack.length ? stack[stack.length - 1]!.id : null;
    const id = ulid();
    assigned.push({ draft: d, id, parentId });
    siblingsCount.set(parentId, (siblingsCount.get(parentId) ?? 0) + 1);
    stack.push({ id, depth });
  }
  const rankPools = new Map<string | null, string[]>();
  for (const [parent, count] of siblingsCount) rankPools.set(parent, rankSequence(count));
  for (const a of assigned) {
    const rank = rankPools.get(a.parentId)!.shift()!;
    blocks.push({ id: a.id, type: a.draft.type, parentId: a.parentId, rank, schemaVersion: SCHEMA_VERSION, text: a.draft.text, props: a.draft.props });
  }
  return blocks;
}

/** Plain text: one line per paragraph (blank lines kept, trailing ones dropped). */
function linesToBlocks(text: string): WireBlock[] {
  const lines = text.replace(/\r\n?/g, "\n").replace(/\n+$/, "").split("\n");
  const ranks = rankSequence(lines.length);
  return lines.map((line, i) => ({ id: ulid(), type: "paragraph", parentId: null, rank: ranks[i]!, schemaVersion: SCHEMA_VERSION, text: line ? [{ type: "text", text: line }] : [], props: {} }));
}

function looksLikeMarkdown(text: string): boolean {
  return /^(#{1,6} |[-*+] |\d+[.)] |> |```|\[[ x]\] |\|.*\|)/m.test(text) || /\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\)/.test(text);
}

/**
 * The blocks a paste should become when it carries structure the editor handles itself (another app's
 * HTML, Markdown, several lines of text), or null to let ProseMirror paste it (Folevi's own copies, one
 * line of text, anything inside a code block).
 */
export function clipboardBlocks(view: EditorView, data: DataTransfer | null): WireBlock[] | null {
  if (!data || view.state.selection.$from.parent.type.name === "codeBlock") return null;
  const html = data.getData("text/html");
  const text = data.getData("text/plain");
  let blocks: WireBlock[] | null = null;
  // Folevi's own copies (ProseMirror HTML with Folevi blocks) paste as they are; any other HTML, including
  // other ProseMirror editors', is normalised.
  const ours = html.includes("data-pm-slice") && /data-block="/.test(html);
  if (html && !ours) blocks = htmlToBlocks(html);
  else if (!html && text && (/\n/.test(text) || /^(#{1,3} |[-*+] |\d+[.)] |> |```|\[[ x]\] )/m.test(text))) {
    blocks = looksLikeMarkdown(text) ? markdownToBlocks(text, { titleFromHeading: false }).blocks : linesToBlocks(text);
  }
  return blocks?.length ? blocks : null;
}

/**
 * Inserts pasted blocks where the caret is: replacing the selection, filling an empty line, or splitting
 * the line at the caret so the pasted blocks land between its two halves. A single pasted paragraph goes
 * into the line itself. Pasted blocks get fresh ids and nest under the caret's block depth.
 */
export function insertPastedBlocks(view: EditorView, blocks: WireBlock[]): void {
  const { schema } = view.state;
  // Over a range through a collapsed toggle, only what's visible is replaced.
  const visible = deleteVisibleRange(view.state);
  const tr = visible ?? view.state.tr;
  if (!tr.selection.empty) tr.deleteSelection();
  const $from = tr.selection.$from;
  const flat = flattenTree(blocks);
  let baseDepth = $from.depth >= 1 ? Number($from.node(1).attrs.depth ?? 0) : 0;
  const inText = $from.depth >= 1 && $from.parent.isTextblock;
  // At the end of a line with nested blocks: like Enter, the pasted blocks become its first nested lines,
  // or (a collapsed toggle) go after its hidden blocks.
  let afterHidden: number | null = null;
  if (inText && $from.parentOffset === $from.parent.content.size && $from.parent.content.size > 0) {
    const index = $from.index(0);
    const next = tr.doc.maybeChild(index + 1);
    if (next && Number(next.attrs.depth ?? 0) > baseDepth) {
      if ($from.parent.type.name === "toggle" && $from.parent.attrs.collapsed) {
        let end = $from.after(1);
        for (let i = index + 1; i < tr.doc.childCount && Number(tr.doc.child(i).attrs.depth ?? 0) > baseDepth; i++) end += tr.doc.child(i).nodeSize;
        afterHidden = end;
      } else baseDepth += 1;
    }
  }
  const nodes = flat.map(({ block, depth }) => schema.nodeFromJSON(blockToNode({ ...block, id: ulid() }, baseDepth + depth)));
  if (inText && nodes.length === 1 && nodes[0]!.type.name === "paragraph" && $from.parent.type.name !== "codeBlock") {
    // One plain paragraph: its text (with its formatting) goes into the current line.
    tr.insert($from.pos, nodes[0]!.content);
    view.dispatch(tr.scrollIntoView());
    return;
  }
  let at: number;
  let replaceEmpty = false;
  if (!inText) {
    at = $from.depth >= 1 ? $from.after(1) : $from.pos;
  } else if ($from.parent.content.size === 0) {
    at = $from.before(1);
    replaceEmpty = true;
  } else if ($from.parentOffset === 0) {
    at = $from.before(1);
  } else if ($from.parentOffset === $from.parent.content.size) {
    at = afterHidden ?? $from.after(1);
  } else {
    // Split the line at the caret; the second half keeps the block's type on a new line.
    tr.split($from.pos);
    // Between the two halves: just after the first one closes.
    at = tr.mapping.map($from.pos, -1) + 1;
  }
  if (replaceEmpty) tr.replaceWith(at, at + $from.parent.nodeSize, nodes);
  else tr.insert(at, nodes);
  const end = at + nodes.reduce((n, node) => n + node.nodeSize, 0);
  // Caret at the end of the last pasted block (or just after it, for a block without text).
  const last = nodes[nodes.length - 1]!;
  const caret = last.isTextblock ? end - 1 : Math.min(end + 1, tr.doc.content.size);
  tr.setSelection(TextSelection.near(tr.doc.resolve(caret), -1));
  normalizeDepths(tr);
  view.dispatch(tr.scrollIntoView());
}
