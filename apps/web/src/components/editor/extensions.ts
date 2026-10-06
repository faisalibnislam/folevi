// Folevi editor schema for Tiptap/ProseMirror. One node per canonical block type, all top-level and
// flat, with `id` (stable block id) and `depth` (nesting) attributes. See convert.ts for the mapping.
import { Extension, Mark, Node, mergeAttributes, type Attributes, type Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { normalizeLanguage, sanitizeHref } from "@folevi/editor-schema";
import { codeBlockNodeView, mermaidFocusPlugin } from "./codeView";

const blockAttrs = (extra: Attributes = {}): Attributes => ({
  id: { default: null, keepOnSplit: false, parseHTML: (el) => el.getAttribute("data-block-id"), renderHTML: (a) => (a.id ? { "data-block-id": a.id } : {}) },
  depth: {
    default: 0,
    parseHTML: (el) => Number(el.getAttribute("data-depth") ?? 0) || 0,
    renderHTML: (a) => ({ "data-depth": a.depth, style: `--depth:${a.depth ?? 0}` }),
  },
  ...extra,
});

/** Node views build their own DOM, so they copy the Format panel's block styling onto it here. */
function applyBlockFormat(dom: HTMLElement, attrs: Record<string, unknown>) {
  for (const [prop, attr] of [
    ["decoration", "data-decoration"],
    ["color", "data-color"],
    ["align", "data-align"],
    ["font", "data-font"],
    ["group", "data-group"],
  ] as const) {
    const v = attrs[prop];
    if (v === null || v === undefined) dom.removeAttribute(attr);
    else dom.setAttribute(attr, String(v));
  }
}

const plain = (name: string) => ({ default: null, parseHTML: (el: HTMLElement) => el.getAttribute(`data-${name}`), renderHTML: (a: Record<string, unknown>) => (a[name] !== null && a[name] !== undefined ? { [`data-${name}`]: String(a[name]) } : {}) });
const hidden = { default: null, rendered: false };
/** For attributes whose data-* name differs from the attribute name (renderHTML reads the attribute). */
const camel = (attr: string, dataName: string, kind: "string" | "number" = "string") => ({
  renderHTML: (a: Record<string, unknown>) => (a[attr] === null || a[attr] === undefined ? {} : { [`data-${dataName}`]: String(a[attr]) }),
  parseHTML: (el: HTMLElement) => {
    const v = el.getAttribute(`data-${dataName}`);
    if (v === null) return null;
    return kind === "number" ? (Number.isFinite(Number(v)) ? Number(v) : null) : v;
  },
});

export const Doc = Node.create({ name: "doc", topNode: true, content: "block+" });
export const Text = Node.create({ name: "text", group: "inline" });

export const HardBreak = Node.create({
  name: "hardBreak",
  inline: true,
  group: "inline",
  selectable: false,
  parseHTML: () => [{ tag: "br" }],
  renderHTML: () => ["br"],
  addKeyboardShortcuts() {
    return {
      // In code a soft line break is just a newline (code holds plain text only).
      "Shift-Enter": () =>
        this.editor.state.selection.$from.parent.type.name === "codeBlock"
          ? this.editor.commands.command(({ tr }) => {
              tr.insertText("\n");
              return true;
            })
          : this.editor.commands.insertContent({ type: "hardBreak" }),
    };
  },
});

function textBlock(name: string, tag: string, extraAttrs: Attributes = {}, parse: { tag: string; getAttrs?: (el: HTMLElement) => Record<string, unknown> | false }[] = []) {
  return Node.create({
    name,
    group: "block",
    content: "inline*",
    defining: true,
    addAttributes: () => blockAttrs(extraAttrs),
    parseHTML: () => [{ tag: `${tag}[data-block="${name}"]` }, ...parse],
    renderHTML: ({ HTMLAttributes }) => [tag, mergeAttributes(HTMLAttributes, { "data-block": name, class: `fb fb-${name}` }), 0],
  });
}

export const Paragraph = textBlock("paragraph", "p", {}, [{ tag: "p" }]);
export const Heading = Node.create({
  name: "heading",
  group: "block",
  content: "inline*",
  defining: true,
  // Folevi writes a level-N heading as <h(N+1)> (the page title is the h1), marked data-block="heading";
  // headings from elsewhere keep their own level. Levels go up to 3.
  addAttributes: () =>
    blockAttrs({
      level: {
        default: 1,
        parseHTML: (el) => Math.max(1, Math.min(3, (Number(el.tagName.slice(1)) || 1) - (el.getAttribute("data-block") === "heading" ? 1 : 0))),
        rendered: false,
      },
    }),
  parseHTML: () => [1, 2, 3, 4, 5, 6].map((l) => ({ tag: `h${l}`, attrs: { level: Math.min(3, l) } })),
  renderHTML: ({ node, HTMLAttributes }) => [`h${Math.min(3, Number(node.attrs.level) || 1) + 1}`, mergeAttributes(HTMLAttributes, { "data-block": "heading", class: `fb fb-heading fb-h${node.attrs.level}` }), 0],
});
export const Bulleted = textBlock("bulleted", "div", {}, [{ tag: "li[data-list=bulleted]" }]);
export const Numbered = textBlock("numbered", "div", { index: { default: 1, rendered: false } }, [{ tag: "li[data-list=numbered]" }]);
export const Quote = textBlock("quote", "blockquote", {}, [{ tag: "blockquote" }]);

/** Checklist/task block. The checkbox is a real, labelled control inside a light DOM node view. */
export const Todo = Node.create({
  name: "todo",
  group: "block",
  content: "inline*",
  defining: true,
  addAttributes: () =>
    blockAttrs({
      checked: { default: false, keepOnSplit: false, parseHTML: (el) => el.getAttribute("data-checked") === "true", renderHTML: (a) => ({ "data-checked": a.checked ? "true" : "false" }) },
      canceled: { ...r("canceled", "boolean"), keepOnSplit: false },
      dueDate: { ...r("due-date"), keepOnSplit: false, ...camel("dueDate", "due-date") },
      dueTime: { ...r("due-time"), keepOnSplit: false, ...camel("dueTime", "due-time") },
      priority: { ...r("priority"), keepOnSplit: false },
      assigneeId: { ...r("assignee"), keepOnSplit: false, ...camel("assigneeId", "assignee") },
      reminderAt: { ...r("reminder", "number"), keepOnSplit: false, ...camel("reminderAt", "reminder", "number") },
      completedAt: { ...r("completed-at", "number"), keepOnSplit: false, ...camel("completedAt", "completed-at", "number") },
    }),
  parseHTML: () => [{ tag: 'div[data-block="todo"]' }, { tag: "li[data-list=todo]" }],
  renderHTML: ({ HTMLAttributes }) => ["div", mergeAttributes(HTMLAttributes, { "data-block": "todo", class: "fb fb-todo" }), 0],
  addNodeView() {
    return ({ node, getPos, editor }) => {
      let current = node;
      const dom = document.createElement("div");
      dom.className = "fb fb-todo";
      dom.dataset.block = "todo";
      const box = document.createElement("button");
      box.type = "button";
      box.className = "fb-check";
      box.contentEditable = "false";
      box.setAttribute("role", "checkbox");
      const meta = document.createElement("span");
      meta.className = "fb-task-meta";
      meta.contentEditable = "false";
      const content = document.createElement("div");
      content.className = "fb-content";
      dom.append(box, content, meta);
      const render = () => {
        dom.dataset.blockId = current.attrs.id ?? "";
        dom.dataset.depth = String(current.attrs.depth ?? 0);
        dom.style.setProperty("--depth", String(current.attrs.depth ?? 0));
        dom.dataset.checked = current.attrs.checked ? "true" : "false";
        applyBlockFormat(dom, current.attrs);
        box.setAttribute("aria-checked", current.attrs.checked ? "true" : "false");
        box.setAttribute("aria-label", current.attrs.checked ? "Mark as not done" : "Mark as done");
        const parts: string[] = [];
        if (current.attrs.dueDate) parts.push(`${current.attrs.dueDate}${current.attrs.dueTime ? ` ${current.attrs.dueTime}` : ""}`);
        if (current.attrs.priority && current.attrs.priority !== "none") parts.push(`${current.attrs.priority} priority`);
        meta.textContent = "";
        meta.dataset.hasDue = current.attrs.dueDate ? "true" : "false";
        meta.dataset.priority = current.attrs.priority ?? "";
        if (parts.length) {
          const chip = document.createElement("button");
          chip.type = "button";
          chip.className = "fb-due-chip";
          chip.dataset.action = "task-details";
          chip.textContent = formatChip(current.attrs.dueDate, current.attrs.dueTime, current.attrs.priority);
          chip.setAttribute("aria-label", `Task details: ${parts.join(", ")}`);
          meta.append(chip);
        }
      };
      render();
      box.addEventListener("mousedown", (e) => e.preventDefault());
      box.addEventListener("click", () => {
        const pos = typeof getPos === "function" ? getPos() : null;
        if (pos === null || pos === undefined || !editor.isEditable) return;
        const checked = !current.attrs.checked;
        editor.view.dispatch(
          editor.view.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, checked, completedAt: checked ? Date.now() : null }),
        );
      });
      meta.addEventListener("mousedown", (e) => e.preventDefault());
      meta.addEventListener("click", (e) => {
        const pos = typeof getPos === "function" ? getPos() : null;
        if (pos === null || pos === undefined) return;
        dom.dispatchEvent(new CustomEvent("folevi:task-details", { bubbles: true, detail: { pos, blockId: current.attrs.id, anchor: e.target } }));
      });
      return {
        dom,
        contentDOM: content,
        update(updated) {
          if (updated.type.name !== "todo") return false;
          current = updated;
          render();
          return true;
        },
        ignoreMutation: (m) => !content.contains(m.target as globalThis.Node),
      };
    };
  },
});

function formatChip(date: string | null, time: string | null, priority: string | null): string {
  let s = "";
  if (date) {
    const [y, m, d] = date.split("-").map(Number) as [number, number, number];
    s = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
    if (time) {
      const [h, min] = time.split(":").map(Number) as [number, number];
      s += ` · ${new Date(Date.UTC(2000, 0, 1, h, min)).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", timeZone: "UTC" })}`;
    }
  }
  if (priority && priority !== "none") s += `${s ? " · " : ""}${priority === "high" ? "!!!" : priority === "medium" ? "!!" : "!"}`;
  return s;
}

/** Toggle (disclosure) block: its nested blocks are hidden when collapsed (see plugins.ts). */
export const Toggle = Node.create({
  name: "toggle",
  group: "block",
  content: "inline*",
  defining: true,
  addAttributes: () =>
    blockAttrs({ collapsed: { default: false, keepOnSplit: false, parseHTML: (el) => el.getAttribute("data-collapsed") === "true", renderHTML: (a) => ({ "data-collapsed": a.collapsed ? "true" : "false" }) } }),
  parseHTML: () => [{ tag: 'div[data-block="toggle"]' }, { tag: "details" }],
  renderHTML: ({ HTMLAttributes }) => ["div", mergeAttributes(HTMLAttributes, { "data-block": "toggle", class: "fb fb-toggle" }), 0],
  addNodeView() {
    return ({ node, getPos, editor }) => {
      let current = node;
      const dom = document.createElement("div");
      dom.className = "fb fb-toggle";
      dom.dataset.block = "toggle";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "fb-disclosure";
      btn.contentEditable = "false";
      const content = document.createElement("div");
      content.className = "fb-content";
      dom.append(btn, content);
      const render = () => {
        dom.dataset.blockId = current.attrs.id ?? "";
        dom.dataset.depth = String(current.attrs.depth ?? 0);
        dom.style.setProperty("--depth", String(current.attrs.depth ?? 0));
        dom.dataset.collapsed = current.attrs.collapsed ? "true" : "false";
        applyBlockFormat(dom, current.attrs);
        btn.setAttribute("aria-expanded", current.attrs.collapsed ? "false" : "true");
        btn.setAttribute("aria-label", current.attrs.collapsed ? "Expand" : "Collapse");
      };
      render();
      btn.addEventListener("mousedown", (e) => e.preventDefault());
      btn.addEventListener("click", () => {
        const pos = typeof getPos === "function" ? getPos() : null;
        if (pos === null || pos === undefined) return;
        editor.view.dispatch(editor.view.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, collapsed: !current.attrs.collapsed }).setMeta("addToHistory", false));
      });
      return {
        dom,
        contentDOM: content,
        update(updated) {
          if (updated.type.name !== "toggle") return false;
          current = updated;
          render();
          return true;
        },
        ignoreMutation: (m) => !content.contains(m.target as globalThis.Node),
      };
    };
  },
});

export const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "inline*",
  defining: true,
  addAttributes: () => blockAttrs({ tone: { ...plain("tone"), default: "note" }, icon: plain("icon") }),
  // Folevi's own callouts: the text is in .fb-content (the icon beside it isn't part of it).
  parseHTML: () => [{ tag: 'div[data-block="callout"]', contentElement: ".fb-content" }, { tag: 'aside[data-block="callout"]', contentElement: ".fb-content" }, { tag: "aside" }],
  // A note, not a complementary landmark (an <aside> per callout would clutter landmark navigation).
  renderHTML: ({ node, HTMLAttributes }) => [
    "div",
    mergeAttributes(HTMLAttributes, { "data-block": "callout", role: "note", class: `fb fb-callout fb-tone-${node.attrs.tone ?? "note"}` }),
    ["span", { class: "fb-callout-icon", contenteditable: "false", "aria-hidden": "true" }, node.attrs.icon ?? calloutIcon(node.attrs.tone)],
    ["div", { class: "fb-content" }, 0],
  ],
});

export function calloutIcon(tone: string | null): string {
  switch (tone) {
    case "info":
      return "ℹ︎";
    case "success":
      return "✓";
    case "warning":
      return "!";
    case "danger":
      return "‼︎";
    default:
      return "✳︎";
  }
}

export const Code = Node.create({
  name: "codeBlock",
  group: "block",
  content: "text*",
  marks: "",
  code: true,
  defining: true,
  addAttributes: () => blockAttrs({ language: { default: "plaintext", parseHTML: (el) => normalizeLanguage(el.getAttribute("data-language") ?? el.querySelector("code")?.className.replace(/^language-/, "") ?? "plaintext"), renderHTML: (a) => ({ "data-language": a.language }) } }),
  parseHTML: () => [{ tag: "pre", preserveWhitespace: "full" }],
  renderHTML: ({ HTMLAttributes }) => ["pre", mergeAttributes(HTMLAttributes, { "data-block": "code", class: "fb fb-code" }), ["code", {}, 0]],
  // Same DOM as renderHTML; Mermaid blocks become a diagram card with foldable source (codeView.ts).
  addNodeView: () => codeBlockNodeView,
  addProseMirrorPlugins: () => [mermaidFocusPlugin],
  addKeyboardShortcuts() {
    return {
      // Two spaces at the caret, or at the start of every selected line.
      Tab: () => (this.editor.isActive("codeBlock") ? indentCode(this.editor) : false),
      // Leaving code: ↓ or → at the very end of the last block, or Enter on a second empty last line,
      // continues with a text line below.
      ArrowDown: () => exitCode(this.editor, "down"),
      ArrowRight: () => exitCode(this.editor, "right"),
      Enter: () => {
        const { $from, empty } = this.editor.state.selection;
        if (!empty || $from.parent.type.name !== "codeBlock" || $from.parentOffset !== $from.parent.content.size || !$from.parent.textContent.endsWith("\n\n")) return false;
        const after = $from.after();
        return this.editor
          .chain()
          .command(({ tr }) => {
            tr.delete($from.pos - 2, $from.pos);
            tr.insert(after - 2, this.editor.schema.nodes.paragraph!.create({ id: null, depth: $from.parent.attrs.depth }));
            tr.setSelection(TextSelection.create(tr.doc, after - 1));
            return true;
          })
          .scrollIntoView()
          .run();
      },
      "Mod-Enter": () => {
        if (!this.editor.isActive("codeBlock")) return false;
        const { $from } = this.editor.state.selection;
        const after = $from.after();
        return this.editor.chain().insertContentAt(after, { type: "paragraph", attrs: { id: null, depth: $from.parent.attrs.depth } }).focus(after + 1).run();
      },
    };
  },
});

function indentCode(editor: Editor): boolean {
  const { state } = editor;
  const { $from, $to, empty } = state.selection;
  if (empty || $from.parent !== $to.parent) {
    editor.view.dispatch(state.tr.insertText("  "));
    return true;
  }
  const start = $from.start();
  const text = $from.parent.textContent;
  const lines: number[] = [];
  let at = text.lastIndexOf("\n", $from.parentOffset - 1) + 1;
  // A selection ending at the very start of a line doesn't include that line.
  const last = text[$to.parentOffset - 1] === "\n" ? $to.parentOffset - 1 : $to.parentOffset;
  for (;;) {
    lines.push(at);
    const nl = text.indexOf("\n", at);
    if (nl < 0 || nl >= last) break;
    at = nl + 1;
  }
  const tr = state.tr;
  for (const line of lines.reverse()) tr.insertText("  ", start + line);
  editor.view.dispatch(tr);
  return true;
}

function exitCode(editor: Editor, dir: "down" | "right"): boolean {
  const { state, view } = editor;
  const { $from, empty } = state.selection;
  if (!empty || $from.parent.type.name !== "codeBlock" || $from.parentOffset !== $from.parent.content.size) return false;
  if (dir === "down" && !view.endOfTextblock("down")) return false;
  const after = $from.after();
  if (after < state.doc.content.size) return false;
  const tr = state.tr.insert(after, state.schema.nodes.paragraph!.create({ id: null, depth: $from.parent.attrs.depth }));
  tr.setSelection(TextSelection.create(tr.doc, after + 1));
  view.dispatch(tr.scrollIntoView());
  return true;
}

function atom(name: string, attrs: Attributes) {
  return Node.create({
    name,
    group: "block",
    atom: true,
    selectable: true,
    draggable: false,
    addAttributes: () => blockAttrs(attrs),
    parseHTML: () => [{ tag: `div[data-block="${name}"]` }],
    renderHTML: ({ HTMLAttributes }) => ["div", mergeAttributes(HTMLAttributes, { "data-block": name, class: `fb fb-${name}` })],
  });
}

/**
 * A block attribute kept as `data-<name>` in the HTML the editor copies, so pasting (in this note or another)
 * brings the block back whole. Numbers, booleans and JSON values are written as text and read back typed.
 */
const r = (name: string, kind: "string" | "number" | "boolean" | "json" = "string", fallback: unknown = null) => ({
  default: fallback,
  parseHTML: (el: HTMLElement) => {
    const v = el.getAttribute(`data-${name}`);
    if (v === null) return fallback;
    if (kind === "number") return Number.isFinite(Number(v)) ? Number(v) : fallback;
    if (kind === "boolean") return v === "true";
    if (kind === "json") {
      try {
        return JSON.parse(v);
      } catch {
        return fallback;
      }
    }
    return v;
  },
  renderHTML: (a: Record<string, unknown>) => {
    const v = a[name];
    if (v === null || v === undefined) return {};
    return { [`data-${name}`]: kind === "json" ? JSON.stringify(v) : String(v) };
  },
});

/** Divider line; `style` (extralight · light · regular · strong) overrides the page's separator style. */
export const Divider = Node.create({
  name: "divider",
  group: "block",
  atom: true,
  selectable: true,
  addAttributes: () =>
    blockAttrs({
      style: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-style"),
        renderHTML: (a) => (a.style ? { "data-style": String(a.style) } : {}),
      },
    }),
  parseHTML: () => [{ tag: 'div[data-block="divider"]' }, { tag: "hr" }],
  renderHTML: ({ HTMLAttributes }) => ["div", mergeAttributes(HTMLAttributes, { "data-block": "divider", class: "fb fb-divider", role: "separator" }), ["hr"]],
});

/** A page break: a visible gap between two "sheets" in the editor, `break-after: page` in print/PDF. */
export const PageBreak = Node.create({
  name: "pageBreak",
  group: "block",
  atom: true,
  selectable: true,
  addAttributes: () => blockAttrs(),
  parseHTML: () => [{ tag: 'div[data-block="pageBreak"]' }],
  renderHTML: ({ HTMLAttributes }) => [
    "div",
    mergeAttributes(HTMLAttributes, { "data-block": "pageBreak", class: "fb fb-page-break", role: "separator", "aria-label": "Page break" }),
    ["span", { class: "fb-page-break-label", "aria-hidden": "true" }, "Page break"],
  ],
});
export const ImageBlock = atom("image", { fileId: r("fileId"), url: r("url"), alt: r("alt", "string", ""), caption: r("caption", "string", ""), width: r("width", "number"), naturalWidth: r("naturalWidth", "number"), naturalHeight: r("naturalHeight", "number"), uploadId: hidden });
export const FileBlock = atom("file", { fileId: r("fileId"), name: r("name"), size: r("size", "number"), mimeType: r("mimeType"), uploadId: hidden });
export const AudioBlock = atom("audio", { fileId: r("fileId"), name: r("name"), size: r("size", "number"), mimeType: r("mimeType"), duration: r("duration", "number"), uploadId: hidden });
/** Table rows from pasted HTML: only a list of rows of cells (each a list of inline nodes) is accepted. */
const tableRows = {
  ...r("rows", "json", [[[], []], [[], []]]),
  parseHTML: (el: HTMLElement) => {
    const fallback = [[[], []], [[], []]];
    try {
      const v = JSON.parse(el.getAttribute("data-rows") ?? "null") as unknown;
      const ok = Array.isArray(v) && v.length > 0 && v.every((row) => Array.isArray(row) && row.length > 0 && row.every((cell) => Array.isArray(cell) && cell.every((n) => n && typeof n === "object" && typeof (n as { type?: unknown }).type === "string")));
      return ok ? v : fallback;
    } catch {
      return fallback;
    }
  },
};
export const TableBlock = atom("table", { rows: tableRows, headerRow: r("headerRow", "boolean", true) });
export const PageBlock = atom("page", { documentId: r("documentId"), display: r("display", "string", "card"), titleCache: r("titleCache"), iconCache: r("iconCache") });
export const BookmarkBlock = atom("bookmark", { url: r("url"), title: r("title"), description: r("description"), siteName: r("siteName"), image: r("image"), icon: r("icon") });
export const CollectionBlock = atom("collection", { collectionId: r("collectionId"), viewId: r("viewId") });
// Formula, whiteboard and flowchart content is written to data-* attributes so copy & paste inside Folevi keeps it.
const kept = (name: string, fallback: string | number) => ({
  default: fallback,
  parseHTML: (el: HTMLElement) => {
    const v = el.getAttribute(`data-${name}`);
    return v === null ? fallback : typeof fallback === "number" ? Number(v) || fallback : v;
  },
  renderHTML: (a: Record<string, unknown>) => ({ [`data-${name}`]: String(a[name] ?? fallback) }),
});
export const FormulaBlock = atom("formula", { latex: kept("latex", "") });
export const WhiteboardBlock = atom("whiteboard", { data: kept("data", ""), height: kept("height", 420) });
export const FlowchartBlock = atom("flowchart", { data: kept("data", ""), height: kept("height", 440) });
export const UnknownBlock = atom("unknownBlock", { wire: { default: null, rendered: false } });

// ------------------------------------------------------------------ inline atoms

export const Mention = Node.create({
  name: "mention",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes: () => ({
    userId: { default: null, parseHTML: (el) => el.getAttribute("data-mention") },
    label: { default: "", parseHTML: (el) => (el.textContent ?? "").replace(/^@/, "") },
  }),
  parseHTML: () => [{ tag: "span[data-mention]" }],
  renderHTML: ({ node }) => ["span", { "data-mention": node.attrs.userId, class: "fb-mention" }, `@${node.attrs.label}`],
  renderText: ({ node }) => `@${node.attrs.label}`,
});

export const DateMention = Node.create({
  name: "dateMention",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes: () => ({ date: { default: null } }),
  parseHTML: () => [{ tag: "time[data-date]", getAttrs: (el) => ({ date: (el as HTMLElement).getAttribute("datetime") }) }],
  renderHTML: ({ node }) => {
    const [y, m, d] = String(node.attrs.date).split("-").map(Number) as [number, number, number];
    const label = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
    return ["time", { "data-date": "", datetime: node.attrs.date, class: "fb-date" }, label];
  },
  renderText: ({ node }) => String(node.attrs.date),
});

export const PageLink = Node.create({
  name: "pageLink",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes: () => ({ documentId: { default: null }, label: { default: "Untitled" } }),
  // Ahead of the link mark's rule for <a href>, so a copied page link pastes as a page link.
  parseHTML: () => [{ tag: "a[data-page-link]", priority: 60, getAttrs: (el) => ({ documentId: (el as HTMLElement).getAttribute("data-page-link"), label: (el as HTMLElement).textContent }) }],
  renderHTML: ({ node }) => ["a", { "data-page-link": node.attrs.documentId, href: `/d/${node.attrs.documentId}`, class: "fb-page-link" }, node.attrs.label || "Untitled"],
  renderText: ({ node }) => `[[${node.attrs.label}]]`,
});

// ------------------------------------------------------------------ marks

const simpleMark = (name: string, tags: string[], render: string, shortcut: string) =>
  Mark.create({
    name,
    parseHTML: () => tags.map((tag) => ({ tag })),
    renderHTML: () => [render, 0],
    addKeyboardShortcuts() {
      return { [shortcut]: () => this.editor.commands.toggleMark(name) };
    },
  });

export const Bold = simpleMark("bold", ["strong", "b"], "strong", "Mod-b");
export const Italic = simpleMark("italic", ["em", "i"], "em", "Mod-i");
export const Underline = simpleMark("underline", ["u"], "u", "Mod-u");
export const Strike = simpleMark("strike", ["s", "del", "strike"], "s", "Mod-Shift-x");
export const InlineCode = Mark.create({
  name: "code",
  excludes: "_",
  code: true,
  parseHTML: () => [{ tag: "code" }],
  renderHTML: () => ["code", { class: "fb-inline-code" }, 0],
  addKeyboardShortcuts() {
    return { "Mod-e": () => this.editor.commands.toggleMark("code") };
  },
});

export const Link = Mark.create({
  name: "link",
  inclusive: false,
  addAttributes: () => ({ href: { default: null } }),
  parseHTML: () => [
    {
      tag: "a[href]",
      getAttrs: (el) => {
        const href = sanitizeHref((el as HTMLElement).getAttribute("href") ?? "");
        return href ? { href } : false;
      },
    },
  ],
  renderHTML: ({ mark }) => ["a", { href: sanitizeHref(String(mark.attrs.href ?? "")) ?? "#", rel: "noopener noreferrer nofollow", target: "_blank", class: "fb-link" }, 0],
});

export const TextColor = Mark.create({
  name: "textColor",
  addAttributes: () => ({ value: { default: "accent" } }),
  parseHTML: () => [{ tag: "span[data-color]", getAttrs: (el) => ({ value: (el as HTMLElement).getAttribute("data-color") }) }],
  renderHTML: ({ mark }) => ["span", { "data-color": mark.attrs.value, class: `fb-color-${mark.attrs.value}` }, 0],
});

export const Highlight = Mark.create({
  name: "highlight",
  addAttributes: () => ({ value: { default: "yellow" } }),
  parseHTML: () => [{ tag: "mark", getAttrs: (el) => ({ value: (el as HTMLElement).getAttribute("data-highlight") ?? "yellow" }) }],
  renderHTML: ({ mark }) => ["mark", { "data-highlight": mark.attrs.value, class: `fb-hl-${mark.attrs.value}` }, 0],
  addKeyboardShortcuts() {
    return { "Mod-Shift-h": () => this.editor.commands.toggleMark("highlight", { value: "yellow" }) };
  },
});

export const ALL_NODES = [
  Doc,
  Text,
  HardBreak,
  Paragraph,
  Heading,
  Bulleted,
  Numbered,
  Todo,
  Toggle,
  Quote,
  Callout,
  Code,
  Divider,
  PageBreak,
  ImageBlock,
  FileBlock,
  AudioBlock,
  TableBlock,
  PageBlock,
  BookmarkBlock,
  CollectionBlock,
  FormulaBlock,
  WhiteboardBlock,
  FlowchartBlock,
  UnknownBlock,
  Mention,
  DateMention,
  PageLink,
];
export const ALL_MARKS = [Bold, Italic, Underline, Strike, InlineCode, Link, TextColor, Highlight];

export const FoleviMarker = Extension.create({ name: "foleviMarker" });

/** Text blocks that carry the Format panel's block styling (decoration, colour, alignment, font, group). */
export const FORMATTABLE_NODES = ["paragraph", "heading", "bulleted", "numbered", "todo", "toggle", "quote"] as const;

const dataAttr = (prop: string, attr: string) => ({
  default: null,
  keepOnSplit: true,
  parseHTML: (el: HTMLElement) => el.getAttribute(attr),
  renderHTML: (a: Record<string, unknown>) => (a[prop] !== null && a[prop] !== undefined ? { [attr]: String(a[prop]) } : {}),
});

/**
 * Block styling from the Format panel, stored as optional block props and drawn with data-* attributes
 * (editor.css): text style (Strong / Caption), decoration (Focus bar / Block background), colour,
 * alignment, font, and group (Card).
 */
export const BlockFormat = Extension.create({
  name: "blockFormat",
  addGlobalAttributes: () => [
    {
      types: [...FORMATTABLE_NODES],
      attributes: {
        decoration: dataAttr("decoration", "data-decoration"),
        color: dataAttr("color", "data-color"),
        align: dataAttr("align", "data-align"),
        font: dataAttr("font", "data-font"),
        group: dataAttr("group", "data-group"),
      },
    },
    { types: ["paragraph"], attributes: { textStyle: dataAttr("textStyle", "data-text-style") } },
  ],
});
