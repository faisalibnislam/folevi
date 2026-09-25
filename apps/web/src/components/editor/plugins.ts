import { Extension, InputRule, type Editor } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { LIMITS, ulid } from "@folevi/editor-schema";
import { blocksInSelection, changeDepth, deleteBlocks, duplicateBlocks, moveBlock, normalizeDepths, turnInto } from "./commands";
import { TEXT_NODES } from "./convert";

/** Every top-level block has a unique id; depth is always valid. Runs after every transaction. */
export const BlockIdentity = Extension.create({
  name: "blockIdentity",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("blockIdentity"),
        appendTransaction: (transactions, _old, state) => {
          if (!transactions.some((t) => t.docChanged)) return null;
          const tr = state.tr;
          const seen = new Set<string>();
          let pos = 0;
          let prevDepth = -1;
          state.doc.forEach((node) => {
            const id = node.attrs.id as string | null;
            let depth = Number(node.attrs.depth ?? 0);
            const max = Math.min(LIMITS.maxDepth, prevDepth + 1);
            const fixDepth = depth > max || depth < 0;
            if (fixDepth) depth = Math.max(0, max);
            if (!id || seen.has(id) || fixDepth) {
              tr.setNodeMarkup(pos, undefined, { ...node.attrs, id: !id || seen.has(id) ? ulid() : id, depth });
            }
            seen.add(id && !seen.has(id) ? id : "");
            prevDepth = depth;
            pos += node.nodeSize;
          });
          if (!tr.docChanged) return null;
          tr.setMeta("addToHistory", false);
          if (transactions.every((t) => t.getMeta("remote"))) tr.setMeta("remote", true);
          return tr;
        },
      }),
    ];
  },
});

export interface DecorationInputs {
  presence: { blockId: string; color: string; name: string }[];
  commentBlocks: Set<string>;
  selectedBlocks: Set<string>;
  conflictBlocks: Set<string>;
}

export const decorationsKey = new PluginKey<DecorationInputs>("foleviDecorations");

/** Numbering, collapsed toggles, presence, comment markers, block selection and conflict markers. */
export const BlockDecorations = Extension.create({
  name: "blockDecorations",
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationInputs>({
        key: decorationsKey,
        state: {
          init: () => ({ presence: [], commentBlocks: new Set(), selectedBlocks: new Set(), conflictBlocks: new Set() }),
          apply: (tr, value) => (tr.getMeta(decorationsKey) as DecorationInputs | undefined) ?? value,
        },
        props: {
          decorations: (state) => {
            const inputs = decorationsKey.getState(state)!;
            const decos: Decoration[] = [];
            const counters: number[] = [];
            let hideBelow: number | null = null;
            let pos = 0;
            state.doc.forEach((node) => {
              const depth = Number(node.attrs.depth ?? 0);
              const id = node.attrs.id as string | null;
              const end = pos + node.nodeSize;
              if (hideBelow !== null && depth <= hideBelow) hideBelow = null;
              const attrs: Record<string, string> = {};
              const classes: string[] = [];
              if (hideBelow !== null) classes.push("fb-hidden");
              if (node.type.name === "numbered") {
                counters.length = depth + 1;
                counters[depth] = (counters[depth] ?? 0) + 1;
                attrs["data-index"] = String(counters[depth]);
              } else {
                counters.length = depth;
              }
              if (node.type.name === "toggle" && node.attrs.collapsed && hideBelow === null) hideBelow = depth;
              if (id && inputs.selectedBlocks.has(id)) classes.push("fb-selected");
              if (id && inputs.conflictBlocks.has(id)) classes.push("fb-conflict");
              if (id && inputs.commentBlocks.has(id)) attrs["data-has-comments"] = "true";
              const who = id ? inputs.presence.find((p) => p.blockId === id) : undefined;
              if (who) {
                classes.push("fb-presence");
                attrs.style = `--presence:var(--color-${who.color === "accent" ? "accent" : who.color})`;
                attrs["data-presence"] = who.name;
              }
              if (classes.length || Object.keys(attrs).length) decos.push(Decoration.node(pos, end, { ...attrs, class: classes.join(" ") }));
              pos = end;
            });
            return DecorationSet.create(state.doc, decos);
          },
        },
      }),
    ];
  },
});

function currentBlock(state: EditorState) {
  const $from = state.selection.$from;
  if ($from.depth < 1) return null;
  return { node: $from.parent, pos: $from.before(1), atStart: $from.parentOffset === 0, empty: $from.parent.content.size === 0 };
}

const LIST_TYPES = new Set(["bulleted", "numbered", "todo"]);

export const BlockKeymap = Extension.create({
  name: "blockKeymap",
  priority: 1000,
  addKeyboardShortcuts() {
    const editor = this.editor as Editor;
    return {
      Enter: () => {
        const cur = currentBlock(editor.state);
        if (!cur) return false;
        const type = cur.node.type.name;
        if (type === "codeBlock") return false;
        if (LIST_TYPES.has(type) || type === "quote" || type === "toggle" || type === "callout") {
          if (cur.empty) {
            // An empty list item ends the list (or outdents when nested).
            if (Number(cur.node.attrs.depth ?? 0) > 0) return changeDepth(editor, -1);
            return turnInto(editor, "paragraph");
          }
          const nextType = type === "toggle" || type === "callout" || type === "quote" ? "paragraph" : type;
          const depth = Number(cur.node.attrs.depth ?? 0) + (type === "toggle" && !cur.node.attrs.collapsed ? 1 : 0);
          return editor
            .chain()
            .splitBlock()
            .command(({ tr, state }) => {
              const $pos = state.selection.$from;
              const pos = $pos.before(1);
              const nodeType = state.schema.nodes[nextType]!;
              tr.setNodeMarkup(pos, nodeType, { id: ulid(), depth, checked: false });
              return true;
            })
            .run();
        }
        if (type === "heading" && cur.node.content.size && editor.state.selection.$from.parentOffset === cur.node.content.size) {
          return editor
            .chain()
            .splitBlock()
            .command(({ tr, state }) => {
              const pos = state.selection.$from.before(1);
              tr.setNodeMarkup(pos, state.schema.nodes.paragraph!, { id: ulid(), depth: cur.node.attrs.depth });
              return true;
            })
            .run();
        }
        return false;
      },
      Backspace: () => {
        const { state } = editor;
        const cur = currentBlock(state);
        if (!cur || !state.selection.empty || !cur.atStart) return false;
        const type = cur.node.type.name;
        if (type !== "paragraph" && TEXT_NODES.has(type)) return turnInto(editor, "paragraph");
        if (type === "codeBlock" && cur.empty) return turnInto(editor, "paragraph");
        if (Number(cur.node.attrs.depth ?? 0) > 0) return changeDepth(editor, -1);
        // Deleting into an atom block above selects it instead of merging.
        const index = state.selection.$from.index(0);
        if (index > 0) {
          const prev = state.doc.child(index - 1);
          if (prev.isAtom) {
            if (cur.empty) return deleteBlocks(editor, [index]);
            return false;
          }
        }
        return false;
      },
      Tab: () => (editor.isActive("code") ? false : changeDepth(editor, 1)),
      "Shift-Tab": () => changeDepth(editor, -1),
      "Alt-Shift-ArrowUp": () => moveBlock(editor, -1),
      "Alt-Shift-ArrowDown": () => moveBlock(editor, 1),
      "Mod-Alt-0": () => turnInto(editor, "paragraph"),
      "Mod-Alt-1": () => turnInto(editor, "heading", { level: 1 }),
      "Mod-Alt-2": () => turnInto(editor, "heading", { level: 2 }),
      "Mod-Alt-3": () => turnInto(editor, "heading", { level: 3 }),
      "Mod-Shift-7": () => turnInto(editor, "numbered"),
      "Mod-Shift-8": () => turnInto(editor, "bulleted"),
      "Mod-Shift-9": () => turnInto(editor, "todo", { checked: false }),
      "Mod-Enter": () => {
        const cur = currentBlock(editor.state);
        if (!cur) return false;
        if (cur.node.type.name === "todo") {
          const checked = !cur.node.attrs.checked;
          editor.view.dispatch(editor.state.tr.setNodeMarkup(cur.pos, undefined, { ...cur.node.attrs, checked, completedAt: checked ? Date.now() : null }));
          return true;
        }
        if (cur.node.type.name === "toggle") {
          editor.view.dispatch(editor.state.tr.setNodeMarkup(cur.pos, undefined, { ...cur.node.attrs, collapsed: !cur.node.attrs.collapsed }));
          return true;
        }
        return false;
      },
      "Mod-d": () => duplicateBlocks(editor),
      "Mod-Shift-Backspace": () => deleteBlocks(editor),
    };
  },
});

function blockRule(find: RegExp, type: string, attrs: (m: RegExpMatchArray) => Record<string, unknown> = () => ({})) {
  return new InputRule({
    find,
    handler: ({ state, range, match }) => {
      const $start = state.doc.resolve(range.from);
      const node = $start.parent;
      if ($start.depth !== 1) return null;
      if (!TEXT_NODES.has(node.type.name)) return null;
      const pos = $start.before(1);
      const schemaType = state.schema.nodes[type]!;
      const tr = state.tr.delete(range.from, range.to);
      if (type === "codeBlock") {
        tr.replaceWith(pos, pos + tr.doc.nodeAt(pos)!.nodeSize, schemaType.create({ id: node.attrs.id, depth: node.attrs.depth, ...attrs(match) }));
        tr.setSelection(TextSelection.near(tr.doc.resolve(pos + 1)));
      } else {
        tr.setNodeMarkup(pos, schemaType, { id: node.attrs.id, depth: node.attrs.depth, ...attrs(match) });
      }
    },
  });
}

/** Markdown-style shortcuts at the start of a block. */
export const MarkdownShortcuts = Extension.create({
  name: "markdownShortcuts",
  addInputRules() {
    return [
      blockRule(/^(#{1,3})\s$/, "heading", (m) => ({ level: m[1]!.length })),
      blockRule(/^[-*+]\s$/, "bulleted"),
      blockRule(/^1[.)]\s$/, "numbered"),
      blockRule(/^\[( |x)?\]\s$/, "todo", (m) => ({ checked: m[1] === "x" })),
      blockRule(/^>\s$/, "quote"),
      blockRule(/^!!\s$/, "callout", () => ({ tone: "note" })),
      blockRule(/^```([a-z]*)\s$/, "codeBlock", (m) => ({ language: m[1] || "plaintext" })),
      new InputRule({
        find: /^(---|\*\*\*)$/,
        handler: ({ state, range }) => {
          const $start = state.doc.resolve(range.from);
          if ($start.depth !== 1 || $start.parent.type.name !== "paragraph") return null;
          const pos = $start.before(1);
          const node = $start.parent;
          const tr = state.tr;
          const divider = state.schema.nodes.divider!.create({ id: node.attrs.id, depth: node.attrs.depth });
          const para = state.schema.nodes.paragraph!.create({ id: ulid(), depth: node.attrs.depth });
          tr.replaceWith(pos, pos + node.nodeSize, [divider, para]);
          tr.setSelection(TextSelection.near(tr.doc.resolve(pos + divider.nodeSize + 1)));
        },
      }),
      // Inline marks: **bold**, _italic_, `code`, ~~strike~~
      markRule(/(?:^|\s)(\*\*([^*]+)\*\*)$/, "bold"),
      markRule(/(?:^|\s)(_([^_]+)_)$/, "italic"),
      markRule(/(?:^|\s)(`([^`]+)`)$/, "code"),
      markRule(/(?:^|\s)(~~([^~]+)~~)$/, "strike"),
    ];
  },
});

function markRule(find: RegExp, mark: string) {
  return new InputRule({
    find,
    handler: ({ state, range, match }) => {
      const full = match[1]!;
      const inner = match[2]!;
      const start = range.to - full.length;
      const markType = state.schema.marks[mark]!;
      const tr = state.tr;
      tr.replaceWith(start, range.to, state.schema.text(inner, [markType.create()]));
      tr.removeStoredMark(markType);
    },
  });
}

export type TriggerKind = "slash" | "page" | "mention";
export interface TriggerState {
  kind: TriggerKind;
  query: string;
  from: number;
  to: number;
}

export const triggerKey = new PluginKey<TriggerState | null>("foleviTrigger");

/** Detects "/" (block menu), "[[" (page link) and "@" (mention/date) while typing. */
export const Triggers = Extension.create<{ onChange: (t: TriggerState | null) => void }>({
  name: "triggers",
  addOptions: () => ({ onChange: () => undefined }),
  addProseMirrorPlugins() {
    const onChange = this.options.onChange;
    let last: string | null = null;
    return [
      new Plugin({
        key: triggerKey,
        view: () => ({
          update: (view) => {
            const { state } = view;
            const sel = state.selection;
            let found: TriggerState | null = null;
            if (sel.empty && sel.$from.parent.isTextblock && sel.$from.parent.type.name !== "codeBlock") {
              const text = sel.$from.parent.textBetween(0, sel.$from.parentOffset, "\n", "￼");
              const start = sel.from - sel.$from.parentOffset;
              let m = /(?:^|\s)\/([\w-]{0,24})$/.exec(text);
              if (m) found = { kind: "slash", query: m[1]!, from: start + text.length - m[1]!.length - 1, to: sel.from };
              m = /\[\[([^\]\n]{0,60})$/.exec(text);
              if (m) found = { kind: "page", query: m[1]!, from: start + text.length - m[1]!.length - 2, to: sel.from };
              m = /(?:^|\s)@([\w .-]{0,30})$/.exec(text);
              if (m && !found) found = { kind: "mention", query: m[1]!, from: start + text.length - m[1]!.length - 1, to: sel.from };
            }
            const key = found ? `${found.kind}:${found.from}:${found.query}` : null;
            if (key !== last) {
              last = key;
              onChange(found);
            }
          },
        }),
      }),
    ];
  },
});

export { blocksInSelection, normalizeDepths };
