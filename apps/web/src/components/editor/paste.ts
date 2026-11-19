// Paste normalization: arbitrary HTML (web pages, Google Docs, Word, other editors) → canonical blocks.
// Only structure and safe inline formatting survive; scripts, styles and unknown markup are dropped.
import { LIMITS, SCHEMA_VERSION, flattenTree, isValidId, markdownToBlocks, normalizeLanguage, normalizeInline, rankSequence, sanitizeHref, splitCode, splitInline, tableCutWarning, textLength, ulid, type InlineNode, type Mark, type WireBlock } from "@folevi/editor-schema";
import { MAX_FILE_BYTES, MAX_IMAGE_BYTES } from "@folevi/editor-schema/fileBytes";
import { NodeSelection, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { closeHistory } from "@tiptap/pm/history";
import type { Node as PMNode, Slice } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";
import { TEXT_NODES, blockToNode } from "./convert";
import { blockAt, normalizeDepths, subtreeRange } from "./commands";
import { afterSubtree, deleteVisibleRange } from "./plugins";
import { blockSelectionKey, blockSelectionRange, hiddenIndices, type BlockSelectionMeta } from "./blockSelectionState";
import { gridFromText, gridFromHtmlTable } from "./table/sheetPaste";
import { documentIdOf, readBlockClip } from "./blockClipboard";
import { pasteAddress } from "./autolink";

/** Tells the person what a paste could not do as asked (Toast.tsx shows these window events). */
function say(message: string): void {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("folevi:error", { detail: message }));
}

/** What reading a paste left out, kept with the blocks it was read into and said once those are in the note. */
const pasteNotes = new WeakMap<WireBlock[], string[]>();
function noted(blocks: WireBlock[], notes: string[]): WireBlock[] {
  if (notes.length) pasteNotes.set(blocks, notes);
  return blocks;
}

const counted = (n: number) => n.toLocaleString("en-US");

/**
 * Says that a paste of `blocks` blocks was not made: the note has room for `room` more. A note holds so many
 * blocks; the server refuses more, and each refused block would vanish after the save.
 */
function sayNoRoom(blocks: number, room: number): void {
  if (room > 0) say(`That paste is too large for this note. It would add ${counted(blocks)} blocks, and the note has room for ${counted(room)} more.`);
  else say(`This note is full, so nothing was pasted. A note holds up to ${counted(LIMITS.maxBlocksPerDocument)} blocks.`);
}

/** What is said when a pasted table had more rows or columns than a table holds. */
export const TABLE_CUT_NOTICE = `That table was too large to paste whole. It was cut to ${LIMITS.maxTableRows} rows and ${LIMITS.maxTableColumns} columns.`;

/** Whether a pasted HTML table has more rows or columns than a table holds (gridFromHtmlTable cuts it). */
export function htmlTableIsCut(table: HTMLTableElement): boolean {
  const rows = [...table.rows];
  if (rows.length > LIMITS.maxTableRows) return true;
  return rows.some((tr) => [...tr.cells].reduce((n, c) => n + Math.max(1, c.colSpan || 1), 0) > LIMITS.maxTableColumns);
}

/** Whether tab-separated text has more rows or columns than a table holds (gridFromText cuts it). */
export function textTableIsCut(text: string): boolean {
  const rows = text.replace(/\r\n?/g, "\n").split("\n").filter((row) => row.trim() !== "");
  return rows.length > LIMITS.maxTableRows || (rows[0]?.split("\t").length ?? 0) > LIMITS.maxTableColumns;
}

/**
 * A paste is an undo step of its own. The step before it is closed on the paste's transaction (closeHistory);
 * this closes the paste itself, so what is typed right after it is the next step and not part of the paste.
 */
function endPaste(view: EditorView): void {
  view.dispatch(closeHistory(view.state.tr));
}

/** Whether the selection is inside one code block. */
function inCode(selection: EditorState["selection"]): boolean {
  return selection.$from.parent.type.name === "codeBlock" && selection.$from.sameParent(selection.$to);
}

/**
 * Text into the code block the selection of `tr` is in, as one undo step. Code over a block's length limit
 * (a longer block would be refused on save, and the paste lost) continues in more code blocks after it.
 */
function insertIntoCode(view: EditorView, tr: Transaction, text: string): void {
  const { $from, $to } = tr.selection;
  const block = $from.parent;
  const before = block.textBetween(0, $from.parentOffset);
  const after = block.textBetween($to.parentOffset, block.content.size);
  closeHistory(tr);
  if (before.length + text.length + after.length <= LIMITS.maxCodeLength) tr.insertText(text);
  else {
    const [head, ...more] = splitCode(before + text + after, LIMITS.maxCodeLength);
    const { schema } = view.state;
    const start = $from.start();
    tr.replaceWith(start, $from.end(), schema.text(head!));
    const blocks = more.map((code) => block.type.create({ ...block.attrs, id: ulid() }, schema.text(code)));
    const at = start + head!.length + 1;
    tr.insert(at, blocks);
    tr.setSelection(TextSelection.create(tr.doc, at + sizeOf(blocks) - 1));
  }
  view.dispatch(tr.scrollIntoView());
  endPaste(view);
}

/** In a code block, any paste is its plain text (formatting and line structure from elsewhere would split it). */
export function pasteIntoCode(view: EditorView, data: DataTransfer | null): boolean {
  if (!inCode(view.state.selection) || !data) return false;
  const text = data.getData("text/plain").replace(/\r\n?/g, "\n");
  if (!text) return false;
  insertIntoCode(view, view.state.tr, text);
  return true;
}

/** Selected blocks (with what is nested under them) give way to one empty line, which the paste then fills. */
function replaceSelectedBlocks(state: EditorState): Transaction | null {
  const range = blockSelectionRange(state);
  if (!range) return null;
  let to = range.to;
  for (let i = range.from; i <= range.to; i++) to = Math.max(to, i + subtreeRange(state, i).count - 1);
  const start = blockAt(state, range.from)!;
  const last = blockAt(state, to)!;
  const line = state.schema.nodes.paragraph!.create({ id: null, depth: Number(start.node.attrs.depth ?? 0) });
  const tr = state.tr.replaceWith(start.pos, last.pos + last.node.nodeSize, line);
  tr.setSelection(TextSelection.create(tr.doc, start.pos + 1)).setMeta(blockSelectionKey, { clear: true } satisfies BlockSelectionMeta);
  normalizeDepths(tr);
  return tr;
}

/**
 * What has to change before a paste goes in, as a transaction that is not dispatched here: the paste adds its
 * own steps to it, so the two are one undo step (and when nothing is pasted after all, nothing was changed).
 *
 * - Selected blocks give way to an empty line (`blocks`: only when there is something to paste over them).
 * - A range through a collapsed toggle loses only its visible part (the hidden blocks stay).
 * - With a whole block selected (an image, a divider, a table…) the paste goes on a new line after it, like
 *   typing does, instead of replacing it.
 * - Several whole blocks pasted at the end of a collapsed toggle go after its hidden blocks.
 *
 * Null when the paste can go in as the note is.
 */
function preparedPaste(state: EditorState, slice: Slice | null, blocks: boolean): Transaction | null {
  if (blockSelectionRange(state)) return blocks ? replaceSelectedBlocks(state) : null;
  let tr = deleteVisibleRange(state);
  // What the note is like after that step (the tabs and toggles that hide blocks are read from it).
  const now = tr ? state.apply(tr) : state;
  const picked = now.selection;
  if (picked instanceof NodeSelection && picked.node.isBlock && picked.$from.depth === 0) {
    const at = afterSubtree(now, picked.$from.index(0));
    tr ??= state.tr;
    tr.insert(at, state.schema.nodes.paragraph!.create({ id: null, depth: picked.node.attrs.depth }));
    return tr.setSelection(TextSelection.create(tr.doc, at + 1));
  }
  const { $from, empty } = picked;
  if (!slice || !empty || $from.depth < 1 || slice.content.childCount < 2) return tr;
  const parent = $from.parent;
  if (parent.type.name !== "toggle" || !parent.attrs.collapsed || $from.parentOffset !== parent.content.size) return tr;
  const index = $from.index(0);
  const hidden = hiddenIndices(now);
  if (!hidden.has(index + 1)) return tr;
  let at = $from.after(1);
  for (let i = index + 1; i < now.doc.childCount && hidden.has(i); i++) at += now.doc.child(i).nodeSize;
  tr ??= state.tr;
  tr.insert(at, state.schema.nodes.paragraph!.create({ id: null, depth: parent.attrs.depth }));
  return tr.setSelection(TextSelection.create(tr.doc, at + 1));
}

/**
 * Makes the note ready for a paste right away (see preparedPaste), for an editor that carries the paste out
 * itself (the demo on the home page). handleEditorPaste keeps this and the paste in one undo step instead.
 */
export function prepareForPaste(view: EditorView, slice: Slice | null): void {
  const tr = preparedPaste(view.state, slice, Boolean(slice?.size));
  if (tr) view.dispatch(tr);
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
  // A link's own underline is how it is drawn, not formatting (Google Docs writes one on every link): only
  // a real <u> underlines linked text, so the text is not left underlined once the link is removed.
  const linked = e.tagName === "A" || marks.some((m) => m.type === "link");
  if (e.tagName === "U" || (!linked && /text-decoration[^;]*underline/.test(style))) next.push({ type: "underline" });
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

/** Whether each element shows the line breaks in its text (worked out once per element, from its style or its parent's). */
const breaksKept = new WeakMap<Element, boolean>();

/**
 * Whether text in `e` keeps its line breaks: white-space pre, pre-wrap, pre-line or break-spaces, or (as
 * newer Chrome writes it) white-space-collapse preserve or preserve-breaks, on it or the nearest element
 * around it that says. Posts, chat messages and prompts are copied this way, with no <br> in them.
 */
function keepsLineBreaks(e: Element | null): boolean {
  if (!e) return false;
  const known = breaksKept.get(e);
  if (known !== undefined) return known;
  let keeps: boolean;
  const collapse = e.hasAttribute("style") ? styleValue(e, "white-space-collapse") : "";
  const space = e.hasAttribute("style") ? styleValue(e, "white-space") : "";
  if (collapse) keeps = /^(preserve|preserve-breaks|break-spaces)$/.test(collapse);
  else if (space) keeps = /^(pre|pre-wrap|pre-line|break-spaces|preserve)\b/.test(space);
  else keeps = keepsLineBreaks(e.parentElement);
  breaksKept.set(e, keeps);
  return keeps;
}

/**
 * The text of some nodes with their formatting. Block elements inside are skipped, or with `flatten`
 * (a table cell) read too, separated by spaces.
 */
function inlineOfNodes(nodes: Iterable<ChildNode>, marks: Mark[] = [], flatten = false): InlineNode[] {
  const out: InlineNode[] = [];
  for (const child of nodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      const raw = child.textContent ?? "";
      // White space runs together as it does on a page; where the page keeps line breaks, so does the paste.
      const text = /[\n\r]/.test(raw) && keepsLineBreaks(child.parentElement) ? raw.replace(/\r\n?/g, "\n").replace(/[^\S\n]+/g, " ") : raw.replace(/\s+/g, " ");
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

/** A pasted table cell's content with its formatting (block elements inside read as text). */
export const cellInline = (el: Element): InlineNode[] => clean(inlineOf(el, [], true));

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

/** The last value an element's style gives a property ("white-space:pre;white-space:pre-wrap" is pre-wrap). */
function styleValue(e: Element, prop: string): string {
  let value = "";
  for (const m of (e.getAttribute("style") ?? "").matchAll(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]*)`, "gi"))) value = m[1]!.trim().toLowerCase();
  return value;
}

/** A font stack of code fonts only ("Menlo, Monaco, 'Courier New', monospace"). */
function monospaceOnly(fonts: string): boolean {
  const list = fonts.split(",").map((f) => f.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
  return list.length > 0 && list.every((f) => /mono|courier|menlo|monaco|consolas|code|lucida console/.test(f));
}

const NOT_CODE_LINES = [...BLOCK_TAGS].filter((t) => t !== "DIV").join(",");

/**
 * A code editor's copy (VS Code and the like): a <div> laid out with white-space:pre or in code fonts only,
 * holding nothing but lines of text (<div>s and <br>s).
 */
function isCodeContainer(e: Element): boolean {
  if (e.tagName !== "DIV" || !e.hasAttribute("style")) return false;
  if (styleValue(e, "white-space") !== "pre" && !monospaceOnly(styleValue(e, "font-family"))) return false;
  return !e.querySelector(NOT_CODE_LINES) && Boolean(e.textContent?.trim());
}

/** Code as written: its text untouched, a line break for each <br> and around each line (<div>, <p>…). */
function codeText(e: Element): string {
  let out = "";
  const visit = (n: Node) => {
    for (const c of n.childNodes) {
      if (c.nodeType === Node.TEXT_NODE) out += c.textContent ?? "";
      if (c.nodeType !== Node.ELEMENT_NODE) continue;
      const el = c as Element;
      if (SKIP.has(el.tagName)) continue;
      if (el.tagName === "BR") {
        out += "\n";
        continue;
      }
      const line = BLOCK_TAGS.has(el.tagName) || el.tagName === "TR";
      if (line && out && !out.endsWith("\n")) out += "\n";
      visit(el);
      if (line && out && !out.endsWith("\n")) out += "\n";
    }
  };
  visit(e);
  // Some sites indent code with no-break spaces.
  return out.replace(/\r\n?/g, "\n").replace(/\u00a0/g, " ").replace(/\n$/, "");
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
  // Line breaks in a row: one is a line break in the paragraph, two or more end the paragraph (text typed
  // into a mail or a form is copied as lines with <br><br> between its paragraphs).
  let breaks = 0;
  for (const child of nodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      if (child.textContent?.trim()) breaks = 0;
      run.push(child);
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const e = child as HTMLElement;
    if (SKIP.has(e.tagName)) continue;
    if (e.tagName === "BR") {
      if (breaks > 0) flush();
      else run.push(child);
      breaks++;
      continue;
    }
    breaks = 0;
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
  if (isCodeContainer(e)) {
    out.push({ type: "code", depth, text: [], props: { language: "plaintext", code: codeText(e) } });
    return;
  }
  // Blocks of every kind keep the depth they're at (a code block or heading inside a list item nests under
  // it), so what follows them nests where it belongs too.
  switch (e.tagName) {
    case "H1":
    case "H2":
    case "H3":
    case "H4":
    case "H5":
    case "H6": {
      const text = clean(inlineOf(e, marks));
      if (text.length) out.push({ type: "heading", depth, text, props: { level: Math.min(3, Number(e.tagName[1])) } });
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
      // Google Docs writes a checklist item as role="checkbox", its mark a small picture.
      const ticked = e.getAttribute("role") === "checkbox" ? e.getAttribute("aria-checked") === "true" : null;
      let inline = clean(inlineOf(e, marks));
      // Block children: the first one is the item's text when it has none of its own; the rest nest under it.
      // (A picture is never the item's text: an item that starts with one keeps the text that follows it.)
      const kids = [...e.children].filter((c) => BLOCK_TAGS.has(c.tagName) && c.tagName !== "UL" && c.tagName !== "OL" && c.tagName !== "IMG");
      let rest = kids;
      let firstKid: Element | null = null;
      if (!inline.length && kids.length) {
        firstKid = kids[0]!;
        inline = clean(inlineOf(firstKid, marks));
        // A wrapper with nothing of its own (just blocks inside): read it whole.
        if (!inline.length) inline = clean(inlineOf(firstKid, marks, true));
        rest = kids.slice(1);
      }
      const type = checkbox || ticked !== null || e.getAttribute("data-checked") !== null || /task-list-item|checklist|to-do/.test(e.className) ? "todo" : (listType ?? "bulleted");
      const props = type === "todo" ? { checked: Boolean(checkbox?.checked) || Boolean(ticked) || e.getAttribute("data-checked") === "true" } : {};
      // Google Docs gives each item its level in aria-level, in one flat list or in lists inside lists. The
      // lists around the item have already given it their levels: only the ones still missing are added.
      const level = Number(e.getAttribute("aria-level"));
      let itemDepth = depth;
      if (level > 1) {
        let lists = 0;
        for (let up = e.parentElement; up; up = up.parentElement) if (up.tagName === "UL" || up.tagName === "OL") lists++;
        itemDepth = depth + Math.max(0, level - 1 - Math.max(0, lists - 1));
      }
      out.push({ type, depth: itemDepth, text: inline, props });
      // Pictures in the item (its own, and those in its line of text) go under it.
      const own = [...e.childNodes].filter((n) => n.nodeType === Node.ELEMENT_NODE && ((n as Element).tagName === "IMG" || (!BLOCK_TAGS.has((n as Element).tagName) && !containsBlock(n as Element))));
      imagesIn(own, itemDepth + 1, out);
      if (firstKid && !containsBlock(firstKid)) imagesIn(firstKid.childNodes, itemDepth + 1, out);
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
      // The code is the <code> inside, when there is one: chat sites put the language's name and a copy
      // button in the <pre> beside it, which are not code.
      const codes = e.querySelectorAll("code");
      const source = codes.length === 1 ? codes[0]! : e;
      const cls = `${source.className} ${e.className}`;
      const lang = normalizeLanguage(/\blang(?:uage)?-([\w+#-]+)/.exec(cls)?.[1] ?? "plaintext");
      out.push({ type: "code", depth, text: [], props: { language: lang, code: codeText(source) } });
      return;
    }
    case "HR":
      out.push({ type: "divider", depth, text: [], props: {} });
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
      // This table's own rows and cells (a table nested in a cell is read as that cell's text), with the
      // formulas Google Sheets and Excel put on their cells (table/sheetPaste.ts).
      const grid = gridFromHtmlTable(e as HTMLTableElement, (c) => clean(inlineOf(c, marks, true)));
      if (grid.rows.length) out.push({ type: "table", depth, text: [], props: { headerRow: grid.headerRow, rows: grid.rows } });
      if (htmlTableIsCut(e as HTMLTableElement)) cutTable = true;
      return;
    }
    default:
      walk(e, depth, out, listType, marks);
  }
}

/**
 * Text over the schema's length limit continues in more blocks, and code over its own in more code blocks
 * (a longer one would be rejected on save).
 */
function withinTextLimit(d: Draft): Draft[] {
  if (d.type === "code") return splitCode(String(d.props.code ?? ""), LIMITS.maxCodeLength).map((code) => ({ ...d, props: { ...d.props, code } }));
  return splitInline(d.text, LIMITS.maxTextLength).map((text, i) => (i === 0 ? { ...d, text } : { type: d.type === "quote" ? "quote" : "paragraph", depth: d.depth, text, props: {} }));
}

/** Whether the HTML being read held a table larger than a table can be (it was cut to size). */
let cutTable = false;

export function htmlToBlocks(html: string): WireBlock[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const drafts: Draft[] = [];
  withBlocks = markBlockContainers(doc.body);
  cutTable = false;
  try {
    walk(doc.body, 0, drafts);
  } finally {
    withBlocks = null;
  }
  const notes = cutTable ? [TABLE_CUT_NOTICE] : [];
  // Convert depth annotations into parents/ranks.
  const blocks: WireBlock[] = [];
  const stack: { id: string; depth: number }[] = [];
  const siblingsCount = new Map<string | null, number>();
  const assigned: { draft: Draft; id: string; parentId: string | null }[] = [];
  for (const d of drafts.flatMap(withinTextLimit)) {
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
  return noted(blocks, notes);
}

/**
 * Plain text: one line per paragraph (a very long line cut in several). One blank line between two lines only
 * separates them, as it does in Markdown; two or more leave one empty line, the gap that was meant. Blank
 * lines at the start and the end are dropped.
 */
function linesToBlocks(text: string): WireBlock[] {
  const kept: string[] = [];
  let blanks = 0;
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    if (!line.trim()) {
      blanks++;
      continue;
    }
    if (blanks > 1 && kept.length) kept.push("");
    blanks = 0;
    kept.push(line);
  }
  const lines = kept.flatMap((line) => splitInline(line ? [{ type: "text", text: line }] : [], LIMITS.maxTextLength));
  const ranks = rankSequence(lines.length);
  return lines.map((line, i) => ({ id: ulid(), type: "paragraph", parentId: null, rank: ranks[i]!, schemaVersion: SCHEMA_VERSION, text: line, props: {} }));
}

/**
 * Whether plain text reads as Markdown. A "# " line alone isn't enough unless a blank line (or the end)
 * follows it, as after a real heading: "# comment" lines in pasted code or notes stay text.
 */
export function looksLikeMarkdown(text: string): boolean {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^#{1,6} \S/.test(line) && !lines[i + 1]?.trim()) return true;
    if (/^\s*([-*+] \S|\d+[.)] \S|> |```|~~~|\[[ x]\] )|^\s*\|.*\|\s*$/.test(line)) return true;
  }
  return /\*\*[^*\s][^*]*\*\*|\[[^\]]+\]\([^)\s]+\)/.test(text);
}

/** A line that starts like a Markdown block ("# ", "- ", "1. ", "> ", a code fence, "[ ] "). */
const BLOCK_MARKER = /^(#{1,3} |[-*+] |\d+[.)] |> |```|\[[ x]\] )/m;

/**
 * Lines that start with a bullet character ("• one", "◦ sub": how PDFs, Messages and Notes write a list as
 * plain text) with Markdown's "- " in its place, so they are read as the list items they are.
 */
function bulletsAsMarkdown(text: string): string {
  return text.replace(/^([ \t]*)[•◦▪▫‣⁃●○∙][ \t]*(?=\S)/gm, "$1- ");
}

/** Whether the caret (or the selection) is inside a line that keeps some of its text: part of a sentence. */
function inSentence(state: EditorState): boolean {
  const { $from, $to } = state.selection;
  const line = $from.parent;
  if ($from.depth < 1 || !TEXT_NODES.has(line.type.name) || line.content.size === 0) return false;
  return !($from.sameParent($to) && $from.parentOffset === 0 && $to.parentOffset === line.content.size);
}

/**
 * The blocks a paste should become when it carries structure the editor handles itself (another app's
 * HTML, Markdown, several lines of text), or null to let ProseMirror paste it (Folevi's own copies, one
 * line of text, anything inside a code block).
 */
export function clipboardBlocks(view: EditorView, data: DataTransfer | null): WireBlock[] | null {
  return blocksFor(view.state, data);
}

/** clipboardBlocks for a note as `state` has it (the note as it will be once the way is clear for the paste). */
function blocksFor(state: EditorState, data: DataTransfer | null): WireBlock[] | null {
  if (!data || state.selection.$from.parent.type.name === "codeBlock") return null;
  // Blocks copied from a Folevi note: exactly as they were (blockClipboard.ts).
  const clip = readBlockClip(data);
  if (clip) return clip.blocks;
  const html = data.getData("text/html");
  const text = data.getData("text/plain");
  let blocks: WireBlock[] | null = null;
  // Folevi's own copies (ProseMirror HTML with Folevi blocks) paste as they are; any other HTML, including
  // other ProseMirror editors', is normalised.
  const ours = html.includes("data-pm-slice") && /data-block="/.test(html);
  if (html && !ours) blocks = htmlToBlocks(html);
  else if (!html && text) blocks = textBlocks(state, text);
  return blocks?.length ? blocks : null;
}

/** Plain text as blocks: a table, Markdown, or its lines. Null for one ordinary line (ProseMirror pastes it). */
function textBlocks(state: EditorState, raw: string): WireBlock[] | null {
  // Rows of tab-separated cells (a spreadsheet's plain copy): a table.
  const table = /\t/.test(raw) && /\n./.test(raw.trim()) ? tsvTable(raw) : null;
  if (table) return table;
  const text = bulletsAsMarkdown(raw);
  const marked = BLOCK_MARKER.test(text);
  // One ordinary line is ProseMirror's to paste, unless it is longer than a block's text may be: then it is
  // cut into several here (a longer block would be refused on save).
  if (!/\n/.test(text) && !marked) return raw.length > LIMITS.maxTextLength ? linesToBlocks(raw) : null;
  // One line that only looks like a heading or a list item, pasted into a sentence: its characters as they
  // are ("see - 5 degrees"), never a new block in the middle of the sentence.
  if (marked && !/\n/.test(text.replace(/\r\n?/g, "\n").replace(/\n+$/, "")) && inSentence(state)) return linesToBlocks(raw);
  if (!looksLikeMarkdown(text)) return linesToBlocks(raw);
  // Pasted text keeps its lines: a line break inside a paragraph stays one (a letter's "Dear John," and the
  // next line stay two lines). And a "---" first line is a divider: pasted text has no front matter, and
  // reading one would drop everything up to the next "---".
  const read = markdownToBlocks(text, { titleFromHeading: false, lineBreaks: true, frontMatter: false });
  return noted(read.blocks, read.warnings.some((w) => w.message === tableCutWarning()) ? [TABLE_CUT_NOTICE] : []);
}

/** Tab-separated rows as a table block, or null (see gridFromText for what counts as rows of cells). */
function tsvTable(text: string): WireBlock[] | null {
  const grid = gridFromText(text);
  if (!grid || grid.rows.length < 2) return null;
  const table: WireBlock = { id: ulid(), type: "table", parentId: null, rank: rankSequence(1)[0]!, schemaVersion: SCHEMA_VERSION, text: [], props: { headerRow: grid.headerRow, rows: grid.rows } };
  return noted([table], textTableIsCut(text) ? [TABLE_CUT_NOTICE] : []);
}

/**
 * Whether a paste that carries files should go in as those files. Word, Excel and PowerPoint put a picture of
 * what was copied beside its HTML and text, and the words are what was meant; so files win only when there
 * is nothing to read beside them: no text at all (a screenshot), HTML that is only a picture ("Copy image" in
 * a browser), or text that is just the files' own names (files copied in Finder or Explorer).
 */
export function pasteIsFiles(data: DataTransfer | null): boolean {
  const files = [...(data?.files ?? [])];
  if (!data || !files.length) return false;
  const html = data.getData("text/html");
  if (html) return !new DOMParser().parseFromString(html, "text/html").body.textContent?.trim();
  const text = data.getData("text/plain").trim();
  if (!text) return true;
  const names = new Set(files.map((f) => f.name));
  return text.split(/\r?\n/).every((raw) => {
    const entry = raw.trim();
    if (!entry || names.has(entry)) return true;
    // A path or a file address: its last part is the name.
    const last = entry.split(/[\\/]/).pop() ?? "";
    try {
      return names.has(last) || names.has(decodeURIComponent(last));
    } catch {
      return false;
    }
  });
}

/**
 * Whether this paste was asked for as plain text: Shift held with the paste shortcut (⇧⌘V, Ctrl+Shift+V).
 * ProseMirror notes the Shift key on each key press; Shift+Insert is an ordinary paste.
 */
export function pasteIsPlain(view: EditorView): boolean {
  const input = (view as unknown as { input?: { shiftKey?: boolean; lastKeyCode?: number | null } }).input;
  return Boolean(input?.shiftKey && input.lastKeyCode !== 45);
}

/**
 * Whether the note would take at least one of these files: the first ten, each within its size (the limits
 * insertFiles in Editor.tsx applies, said there). When none would go in, the paste changes nothing.
 */
export function someFileFits(files: File[]): boolean {
  return files.slice(0, 10).some((f) => f.size <= (/^image\/(png|jpe?g|gif|webp)$/i.test(f.type) ? MAX_IMAGE_BYTES : MAX_FILE_BYTES));
}

/**
 * Pastes text and nothing else: its lines, without formatting, links or blocks (in code, as it is). Over
 * selected blocks it takes their place. False when there is no text to paste.
 */
export function pastePlainText(view: EditorView, text: string): boolean {
  if (!text.trim()) return false;
  const prepared = preparedPaste(view.state, null, true);
  const selection = prepared ? prepared.selection : view.state.selection;
  if (inCode(selection)) insertIntoCode(view, prepared ?? view.state.tr, text.replace(/\r\n?/g, "\n"));
  else insertPastedBlocks(view, linesToBlocks(text), { tr: prepared ?? undefined });
  return true;
}

/** True while ProseMirror pastes at handleEditorPaste's own request (it asks handleEditorPaste again). */
let handingOver = false;

/**
 * A paste into the note, in the order things are tried: code takes plain text; a plain-text paste takes the
 * clipboard's text only; blocks copied in Folevi come back as they were; files with nothing to read beside
 * them are inserted; one web address becomes a link; anything else with structure becomes blocks; the rest
 * (one line of text, Folevi's own copied text) is ProseMirror's own paste. False when nothing was pasted here.
 *
 * Whatever the route, the paste is one undo step of its own: what had to give way to it (selected blocks, a
 * selected range) goes in the same step, the step typed before it is closed, and so is the paste after it.
 * When nothing can be pasted (a file over the size limit, a paste too large for the note), nothing changes.
 */
export function handleEditorPaste(view: EditorView, event: ClipboardEvent, slice: Slice | null, options: { editable: boolean; insertFiles: (files: File[]) => void }): boolean {
  // ProseMirror asking again, in the middle of the paste handed to it below: it is its own to carry out.
  if (handingOver) return false;
  const data = event.clipboardData;
  const html = data?.getData("text/html") ?? "";
  const text = data?.getData("text/plain") ?? "";
  // Selected blocks give way only to something that can be pasted, and never in a note that can't be edited.
  const usable = options.editable && Boolean(data && (text || html || data.files?.length));
  const prepared = preparedPaste(view.state, slice, usable);
  // The note as it will be once the way is clear: what the paste becomes is decided there.
  const state = prepared ? view.state.apply(prepared) : view.state;
  if (inCode(state.selection) && text) {
    event.preventDefault();
    insertIntoCode(view, prepared ?? view.state.tr, text.replace(/\r\n?/g, "\n"));
    return true;
  }
  if (options.editable && pasteIsPlain(view) && text.trim()) {
    event.preventDefault();
    insertPastedBlocks(view, linesToBlocks(text), { tr: prepared ?? undefined });
    return true;
  }
  // Blocks copied in a Folevi note (they may come with a picture of themselves for other apps). Blocks cut
  // from this note come back as themselves, ids included, so their comments move with them.
  const clip = readBlockClip(data);
  if (clip) {
    event.preventDefault();
    const moved = Boolean(clip.cut && clip.documentId && clip.documentId === documentIdOf(view));
    if (options.editable) insertPastedBlocks(view, clip.blocks, { whole: true, keepIds: moved, tr: prepared ?? undefined });
    return true;
  }
  if (options.editable && pasteIsFiles(data)) {
    event.preventDefault();
    const files = [...(data?.files ?? [])];
    // The way is cleared only when a file will go in (one over the size limit is refused, with a message).
    if (prepared && someFileFits(files)) view.dispatch(closeHistory(prepared));
    options.insertFiles(files);
    return true;
  }
  // A plain web address: a link (over the selected text, if any). Asked first on the note as it will be, so
  // the way is only cleared for an address.
  if (pasteAddress({ state, dispatch: () => undefined } as unknown as EditorView, data)) {
    event.preventDefault();
    view.dispatch(closeHistory(prepared ?? view.state.tr));
    pasteAddress(view, data);
    endPaste(view);
    return true;
  }
  const blocks = blocksFor(state, data);
  if (blocks) {
    event.preventDefault();
    insertPastedBlocks(view, blocks, { tr: prepared ?? undefined });
    return true;
  }
  // ProseMirror's own paste. Nothing it could read: nothing changes.
  if (!slice?.size || (!html && !text)) return false;
  // More blocks than the note has room for (a long note's text copied and pasted again): not pasted, and
  // said. (The first of them continues the caret's line, so it is not one more block.)
  const room = LIMITS.maxBlocksPerDocument - state.doc.childCount;
  if (slice.content.childCount - 1 > room) {
    event.preventDefault();
    sayNoRoom(slice.content.childCount, room);
    return true;
  }
  view.dispatch(closeHistory(prepared ?? view.state.tr));
  // It read the clipboard before the way was cleared, for where the caret was then (among selected blocks,
  // the end of one of them, whose formatting the text would take on). So it is asked to paste again, now.
  handingOver = true;
  let pasted: boolean;
  try {
    pasted = html && !(pasteIsPlain(view) && text) ? view.pasteHTML(html, event) : view.pasteText(text, event);
  } finally {
    handingOver = false;
  }
  // (Not pasted: ProseMirror goes on with what it read the first time.)
  if (!pasted) return false;
  endPaste(view);
  event.preventDefault();
  return true;
}

/** Block styling that follows the text onto a new line, as with Enter (splitAttrs in plugins.ts). */
const CARRIED_FORMAT = ["decoration", "color", "align", "font", "group"] as const;
/** What the second half needs to stay the same kind of block. */
const KIND_ATTRS = ["level", "textStyle", "tone", "icon", "collapsed", "language"] as const;

/**
 * The second half of a line a paste splits: a fresh id, the same depth, kind and styling, but none of the
 * line's task details (done, due date, reminder…), which stay with the first half as they do on Enter.
 */
function secondHalfAttrs(from: PMNode): Record<string, unknown> {
  const attrs: Record<string, unknown> = { id: ulid(), depth: from.attrs.depth };
  for (const k of [...CARRIED_FORMAT, ...KIND_ATTRS]) if (from.attrs[k] != null) attrs[k] = from.attrs[k];
  return attrs;
}

/** Lines a pasted plain paragraph becomes one of, when it lands in a line of that kind. */
const LIST_LINES = new Set(["bulleted", "numbered", "todo"]);

const sizeOf = (nodes: PMNode[]) => nodes.reduce((n, node) => n + node.nodeSize, 0);

/**
 * The empty line a paste lands on, holding the first pasted block's text. A plain pasted line leaves the line
 * what it was (a heading stays a heading, a to-do keeps its details); any other kind of block gives the line
 * its own kind. Either way the line keeps its id.
 */
function filledLine(line: PMNode, first: PMNode, plain: boolean): PMNode {
  if (!plain) return first.type.create({ ...first.attrs, id: line.attrs.id ?? first.attrs.id }, first.content);
  const attrs: Record<string, unknown> = { ...line.attrs };
  // Two paragraphs: the pasted one's own styling comes along.
  if (line.type.name === "paragraph") for (const [k, v] of Object.entries(first.attrs)) if (v != null && k !== "id" && k !== "depth") attrs[k] = v;
  return line.type.create(attrs, first.content);
}

/**
 * Inserts pasted blocks where the caret is, the way a sentence is pasted into a sentence:
 *
 * - The first pasted block, when it holds text, continues the caret's line, which stays the kind of line it
 *   was. An empty line becomes the first block instead (see filledLine).
 * - The text after the caret joins the end of the last pasted block, when that one holds text. At the very
 *   start of a line the last pasted block's text goes in front of the line's own, so the line keeps its id.
 * - In a list item or a to-do, pasted plain lines are items of that list.
 * - Around a block without text (an image, a table, a divider, code) the line is split as before: the block
 *   lands between its two halves.
 *
 * - At the end of a line that has text, several blocks that begin with a heading, a list item or a quote
 *   follow the line whole: the line is not what their first block was meant to continue.
 *
 * One block of text therefore goes into the line itself, whatever kind it was. Pasted blocks get fresh ids
 * and nest under the caret's block depth, and the whole paste is one undo step of its own.
 *
 * `whole`: blocks copied as blocks in a Folevi note (blockClipboard.ts). Those come back exactly as they
 * were, each a block of its own with its kind and details (a to-do's date, a heading's level): they never
 * join the line, which is split around them as around a block without text. Only a single plain paragraph
 * still goes into the line.
 *
 * `keepIds`: blocks cut from this same note. Each keeps its id unless a block in the note has it now (a
 * second paste of the same cut), so comments and links that point at a moved block still find it.
 *
 * `tr`: what had to change first (preparedPaste), not yet dispatched: the paste goes on in it.
 *
 * Returns false, with a message and the note unchanged, when the note has no room for the paste.
 */
export function insertPastedBlocks(view: EditorView, blocks: WireBlock[], options: { whole?: boolean; keepIds?: boolean; tr?: Transaction } = {}): boolean {
  const { schema } = view.state;
  const notes = [...(pasteNotes.get(blocks) ?? [])];
  let flat = flattenTree(blocks);
  if (!flat.length) return false;
  // Over a range through a collapsed toggle, only what's visible is replaced.
  const base = options.tr ?? deleteVisibleRange(view.state) ?? view.state.tr;
  // Marked as a paste, so files in pasted blocks are shared with this note (Editor.tsx).
  const tr = closeHistory(base).setMeta("uiEvent", "paste").setMeta("paste", true);
  if (!tr.selection.empty) tr.deleteSelection();
  const $from = tr.selection.$from;
  const line = $from.depth >= 1 && $from.parent.isTextblock ? $from.parent : null;
  // A note holds so many blocks (sayNoRoom): plain lines are kept, together in fewer paragraphs; anything
  // else is not pasted, and said.
  // (An empty line the caret is on makes way for the first pasted block.)
  const room = LIMITS.maxBlocksPerDocument - tr.doc.childCount + (line && line.content.size === 0 ? 1 : 0);
  if (flat.length > room) {
    const folded = foldedLines(flat.map((entry) => entry.block), room);
    if (!folded) {
      sayNoRoom(flat.length, room);
      return false;
    }
    notes.push(`That paste has more lines than this note has room for, so its lines were put together in ${counted(folded.length)} ${folded.length === 1 ? "paragraph" : "paragraphs"}.`);
    flat = flattenTree(folded);
  }
  const lineDepth = $from.depth >= 1 ? Number($from.node(1).attrs.depth ?? 0) : 0;
  let baseDepth = lineDepth;
  // At the end of a line with nested blocks: like Enter, the pasted blocks become its first nested lines,
  // or (a collapsed toggle) go after its hidden blocks.
  let afterHidden: number | null = null;
  if (line && $from.parentOffset === line.content.size && line.content.size > 0) {
    const index = $from.index(0);
    const next = tr.doc.maybeChild(index + 1);
    if (next && Number(next.attrs.depth ?? 0) > baseDepth) {
      if (line.type.name === "toggle" && line.attrs.collapsed) {
        let end = $from.after(1);
        for (let i = index + 1; i < tr.doc.childCount && Number(tr.doc.child(i).attrs.depth ?? 0) > baseDepth; i++) end += tr.doc.child(i).nodeSize;
        afterHidden = end;
      } else baseDepth += 1;
    }
  }
  // Fresh ids, or (blocks moved by cut and paste) their own where the note no longer has them.
  const taken = new Set<string>();
  if (options.keepIds) tr.doc.forEach((n) => void (n.attrs.id && taken.add(String(n.attrs.id))));
  const ids = flat.map(({ block }) => {
    if (!options.keepIds || !isValidId(block.id) || taken.has(block.id)) return ulid();
    taken.add(block.id);
    return block.id;
  });
  const nodeAt = (i: number, base: number) => schema.nodeFromJSON(blockToNode({ ...flat[i]!.block, id: ids[i]! }, base + flat[i]!.depth));
  const nodes = flat.map((_entry, i) => nodeAt(i, baseDepth));
  const atEnd = line !== null && line.content.size > 0 && $from.parentOffset === line.content.size;
  // One plain paragraph goes into the line. But one that was moved here with its id stays the block it was
  // (the id is what its comments hold on to) unless it lands inside a line's text.
  const single = nodes.length === 1 && nodes[0]!.type.name === "paragraph";
  const moved = ids[0] === flat[0]!.block.id && Boolean(options.keepIds);
  const inText = line !== null && $from.parentOffset > 0 && !atEnd;
  // Text joins text: never code (it holds no formatting), and never past a collapsed toggle's hidden lines.
  const asBlocks = options.whole && !(single && (!moved || inText));
  const joins = line !== null && TEXT_NODES.has(line.type.name) && afterHidden === null && !asBlocks;
  // A heading or a list pasted at the end of a line with text ("Shopping:" and then the list) follows it.
  const follows = atEnd && nodes.length > 1 && nodes[0]!.type.name !== "paragraph";
  const joinFirst = joins && TEXT_NODES.has(nodes[0]!.type.name) && !follows;
  const joinLast = joins && TEXT_NODES.has(nodes[nodes.length - 1]!.type.name);
  // What was nested under the first pasted block is nested under the caret's line, which takes its place.
  if (joinFirst && baseDepth !== lineDepth) for (let i = 1; i < flat.length && flat[i]!.depth > 0; i++) nodes[i] = nodeAt(i, lineDepth);
  const plainFirst = nodes[0]!.type.name === "paragraph";
  if (joins && LIST_LINES.has(line.type.name)) {
    flat.forEach(({ depth }, i) => {
      const node = nodes[i]!;
      if (depth > 0 || node.type.name !== "paragraph") return;
      const attrs: Record<string, unknown> = { id: node.attrs.id, depth: node.attrs.depth };
      for (const k of CARRIED_FORMAT) if (node.attrs[k] != null) attrs[k] = node.attrs[k];
      nodes[i] = line.type.create(attrs, node.content);
    });
  }
  const first = nodes[0]!;
  const last = nodes[nodes.length - 1]!;
  /** The caret at the end of the last pasted block (or just after it, for a block without text). */
  const caretAfter = (end: number) => tr.setSelection(TextSelection.near(tr.doc.resolve(last.isTextblock ? end - 1 : Math.min(end + 1, tr.doc.content.size)), -1));
  const finish = () => {
    normalizeDepths(tr);
    view.dispatch(tr.scrollIntoView());
    endPaste(view);
    for (const note of notes) say(note);
    return true;
  };
  if (!line) {
    const at = $from.depth >= 1 ? $from.after(1) : $from.pos;
    tr.insert(at, nodes);
    caretAfter(at + sizeOf(nodes));
    return finish();
  }
  const pos = $from.pos;
  const linePos = $from.before(1);
  if (line.content.size === 0) {
    // An empty line: the pasted blocks take its place.
    const all = joinFirst ? [filledLine(line, first, plainFirst), ...nodes.slice(1)] : nodes;
    tr.replaceWith(linePos, linePos + line.nodeSize, all);
    caretAfter(linePos + sizeOf(all));
    return finish();
  }
  if ($from.parentOffset === 0) {
    // The start of a line: the blocks go above it. The line stays itself, with the last block's text in front.
    if (!joinLast) {
      tr.insert(linePos, nodes);
      caretAfter(linePos + sizeOf(nodes));
      return finish();
    }
    const above = nodes.slice(0, -1);
    tr.insert(pos, last.content);
    tr.insert(linePos, above);
    tr.setSelection(TextSelection.create(tr.doc, pos + sizeOf(above) + last.content.size));
    return finish();
  }
  // In a line, or at its end: the first block's text goes in at the caret.
  let caret = pos;
  let rest = nodes;
  if (joinFirst) {
    tr.insert(pos, first.content);
    caret = pos + first.content.size;
    rest = nodes.slice(1);
  }
  if (!rest.length) {
    tr.setSelection(TextSelection.create(tr.doc, caret));
    return finish();
  }
  const tail = line.content.cut($from.parentOffset);
  let below = rest;
  if (tail.size) {
    tr.delete(caret, caret + tail.size);
    // What followed the caret ends the last pasted block, or (after a block without text) stays the kind
    // of line it was, on a line of its own.
    below = joinLast ? [...rest.slice(0, -1), last.copy(last.content.append(tail))] : [...rest, line.type.create(secondHalfAttrs(line), tail)];
  }
  // Just after the line closes (or after a collapsed toggle's hidden blocks).
  const at = afterHidden ?? caret + 1;
  tr.insert(at, below);
  if (tail.size && joinLast) tr.setSelection(TextSelection.create(tr.doc, at + sizeOf(below) - 1 - tail.size));
  else caretAfter(at + sizeOf(rest));
  return finish();
}

/**
 * Pasted lines for a note without room for each as a block: the same lines, kept together with line breaks
 * in as few paragraphs as their length allows. Null when they are not all plain paragraphs (a list or a
 * table has no such form) or still would not fit.
 */
function foldedLines(blocks: WireBlock[], room: number): WireBlock[] | null {
  if (room < 1 || blocks.some((b) => b.type !== "paragraph" || b.parentId !== null || Object.keys(b.props).length > 0)) return null;
  const paragraphs: InlineNode[][] = [];
  let current: InlineNode[] | null = null;
  let length = 0;
  for (const b of blocks) {
    const size = textLength(b.text);
    if (current && length + 1 + size > LIMITS.maxTextLength) {
      paragraphs.push(current);
      current = null;
    }
    if (current) {
      current.push({ type: "text", text: "\n" }, ...b.text);
      length += 1 + size;
    } else {
      current = [...b.text];
      length = size;
    }
  }
  if (current) paragraphs.push(current);
  if (paragraphs.length > room) return null;
  const ranks = rankSequence(paragraphs.length);
  return paragraphs.map((text, i) => ({ id: ulid(), type: "paragraph", parentId: null, rank: ranks[i]!, schemaVersion: SCHEMA_VERSION, text: normalizeInline(text), props: {} }));
}
