// Folevi editor schema for Tiptap/ProseMirror. One node per canonical block type, all top-level and
// flat, with `id` (stable block id) and `depth` (nesting) attributes. See convert.ts for the mapping.
import { Extension, Mark, Node, mergeAttributes, type Attributes } from "@tiptap/core";
import { sanitizeHref } from "@folevi/editor-schema";

const blockAttrs = (extra: Attributes = {}): Attributes => ({
  id: { default: null, keepOnSplit: false, parseHTML: (el) => el.getAttribute("data-block-id"), renderHTML: (a) => (a.id ? { "data-block-id": a.id } : {}) },
  depth: {
    default: 0,
    parseHTML: (el) => Number(el.getAttribute("data-depth") ?? 0) || 0,
    renderHTML: (a) => ({ "data-depth": a.depth, style: `--depth:${a.depth ?? 0}` }),
  },
  ...extra,
});

const plain = (name: string) => ({ default: null, parseHTML: (el: HTMLElement) => el.getAttribute(`data-${name}`), renderHTML: (a: Record<string, unknown>) => (a[name] !== null && a[name] !== undefined ? { [`data-${name}`]: String(a[name]) } : {}) });
const hidden = { default: null, rendered: false };

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
    return { "Shift-Enter": () => this.editor.commands.insertContent({ type: "hardBreak" }) };
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
  addAttributes: () => blockAttrs({ level: { default: 1, parseHTML: (el) => Number(el.tagName.slice(1)) || 1, rendered: false } }),
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
      canceled: { ...hidden, keepOnSplit: false },
      dueDate: { default: null, keepOnSplit: false, rendered: false },
      dueTime: { default: null, keepOnSplit: false, rendered: false },
      priority: { default: null, keepOnSplit: false, rendered: false },
      assigneeId: { default: null, keepOnSplit: false, rendered: false },
      reminderAt: { default: null, keepOnSplit: false, rendered: false },
      completedAt: { default: null, keepOnSplit: false, rendered: false },
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
    if (time) s += ` · ${time}`;
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
  parseHTML: () => [{ tag: 'aside[data-block="callout"]' }, { tag: "aside" }],
  renderHTML: ({ node, HTMLAttributes }) => [
    "aside",
    mergeAttributes(HTMLAttributes, { "data-block": "callout", class: `fb fb-callout fb-tone-${node.attrs.tone ?? "note"}` }),
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
  addAttributes: () => blockAttrs({ language: { default: "plaintext", parseHTML: (el) => el.getAttribute("data-language") ?? el.querySelector("code")?.className.replace(/^language-/, "") ?? "plaintext", renderHTML: (a) => ({ "data-language": a.language }) } }),
  parseHTML: () => [{ tag: "pre", preserveWhitespace: "full" }],
  renderHTML: ({ HTMLAttributes }) => ["pre", mergeAttributes(HTMLAttributes, { "data-block": "code", class: "fb fb-code" }), ["code", {}, 0]],
  addKeyboardShortcuts() {
    return {
      Tab: () => (this.editor.isActive("codeBlock") ? this.editor.commands.insertContent("  ") : false),
      "Mod-Enter": () => {
        if (!this.editor.isActive("codeBlock")) return false;
        const { $from } = this.editor.state.selection;
        const after = $from.after();
        return this.editor.chain().insertContentAt(after, { type: "paragraph", attrs: { id: null, depth: $from.parent.attrs.depth } }).focus(after + 1).run();
      },
    };
  },
});

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

const r = (name: string) => ({ default: null, rendered: false, parseHTML: (el: HTMLElement) => el.getAttribute(`data-${name}`) });

export const Divider = Node.create({
  name: "divider",
  group: "block",
  atom: true,
  selectable: true,
  addAttributes: () => blockAttrs(),
  parseHTML: () => [{ tag: "hr" }],
  renderHTML: ({ HTMLAttributes }) => ["div", mergeAttributes(HTMLAttributes, { "data-block": "divider", class: "fb fb-divider", role: "separator" }), ["hr"]],
});
export const ImageBlock = atom("image", { fileId: r("fileId"), url: r("url"), alt: { ...r("alt"), default: "" }, caption: { ...r("caption"), default: "" }, width: r("width"), naturalWidth: r("naturalWidth"), naturalHeight: r("naturalHeight"), uploadId: hidden });
export const FileBlock = atom("file", { fileId: r("fileId"), name: r("name"), size: r("size"), mimeType: r("mimeType"), uploadId: hidden });
export const TableBlock = atom("table", { rows: { default: [[[], []], [[], []]], rendered: false }, headerRow: { default: true, rendered: false } });
export const PageBlock = atom("page", { documentId: r("documentId"), display: { ...r("display"), default: "card" }, titleCache: r("titleCache"), iconCache: r("iconCache") });
export const BookmarkBlock = atom("bookmark", { url: r("url"), title: r("title"), description: r("description"), siteName: r("siteName") });
export const CollectionBlock = atom("collection", { collectionId: r("collectionId"), viewId: r("viewId") });
export const UnknownBlock = atom("unknownBlock", { wire: { default: null, rendered: false } });

// ------------------------------------------------------------------ inline atoms

export const Mention = Node.create({
  name: "mention",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes: () => ({ userId: { default: null }, label: { default: "" } }),
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
  parseHTML: () => [{ tag: "a[data-page-link]", getAttrs: (el) => ({ documentId: (el as HTMLElement).getAttribute("data-page-link"), label: (el as HTMLElement).textContent }) }],
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
  ImageBlock,
  FileBlock,
  TableBlock,
  PageBlock,
  BookmarkBlock,
  CollectionBlock,
  UnknownBlock,
  Mention,
  DateMention,
  PageLink,
];
export const ALL_MARKS = [Bold, Italic, Underline, Strike, InlineCode, Link, TextColor, Highlight];

export const FoleviMarker = Extension.create({ name: "foleviMarker" });
