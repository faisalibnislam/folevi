"use client";

// Writing in a shape: a small rich text editor placed exactly over the label (the shape hides its own
// label meanwhile), with a formatting bar above the shape. The note editor's marks (bold, italic,
// underline, strike, code, links, text colours) and the model's paragraphs (bullets, numbers) and
// alignment; pasted text arrives as plain text, a pasted or dropped image goes into the shape.
//
//   Enter finishes · ⇧Enter new line (continues a list) · Esc finishes · ⌘B ⌘I ⌘U bold, italic, underline
//   ⇧⌘X strike · ⌘E code · ⌘K link · ⇧⌘8 bullets · ⇧⌘7 numbers · ⇧⌘L ⇧⌘E ⇧⌘R align left, centre, right
//   "- " or "1. " at the start of a line starts a list; ⌫ at the start of a list item ends it
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Extension } from "@tiptap/core";
import { AllSelection, Plugin, TextSelection } from "@tiptap/pm/state";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { AlignCenter, AlignLeft, AlignRight, Baseline, Bold, Check, Italic, Link2, List, ListOrdered, Strikethrough, Underline, Unlink, X } from "lucide-react";
import { FLOWCHART_FONT_SIZE, FLOWCHART_LIMITS, FLOWCHART_LINE_HEIGHT, TextColorValues, customFillInk, nodeContentBoxes, nodeTextLayout, type FlowNode, type FlowParagraph, type FlowTextAlign } from "../schema";
import { LABEL_EXTENSIONS, labelDoc, labelParagraphs, pastedLines, type LabelList } from "../richLabel";
import { safeHref } from "../contentOps";
import type { View } from "../controller/types";

/** Keeps a label within the model's limits (characters and lines), whatever is typed or pasted. */
const LabelLimit = Extension.create({
  name: "labelLimit",
  addProseMirrorPlugins: () => [
    new Plugin({
      filterTransaction: (tr) => !tr.docChanged || (tr.doc.childCount <= FLOWCHART_LIMITS.maxParagraphs && tr.doc.textBetween(0, tr.doc.content.size, "\n").length <= FLOWCHART_LIMITS.maxText),
    }),
  ],
});

const IMAGE_TYPES = /^image\/(png|jpe?g|gif|webp)$/i;
const TEXT_COLOR_LABEL: Record<(typeof TextColorValues)[number], string> = { muted: "Grey", accent: "Accent", moss: "Green", marigold: "Orange", plum: "Purple", coral: "Red" };

/**
 * Makes the editor take in a selection the browser has just changed (Shift+arrows, a drag) before a
 * command reads it: ProseMirror otherwise hears of it a moment later.
 */
function readSelection(editor: Editor) {
  (editor.view as unknown as { domObserver?: { flush?: () => void } }).domObserver?.flush?.();
}

/** The paragraph the selection starts in. */
function currentList(editor: Editor): LabelList | null {
  return (editor.state.selection.$from.parent.attrs.list as LabelList | null) ?? null;
}

/** Sets (or, when every selected paragraph already has it, clears) a list on the selected paragraphs. */
function toggleList(editor: Editor, list: LabelList) {
  const { state } = editor;
  const { from, to } = state.selection;
  const paras: { pos: number; list: LabelList | null }[] = [];
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.type.name === "paragraph") paras.push({ pos, list: node.attrs.list as LabelList | null });
    return false;
  });
  const off = paras.every((p) => p.list === list);
  const tr = state.tr;
  for (const p of paras) tr.setNodeAttribute(p.pos, "list", off ? null : list);
  editor.view.dispatch(tr);
}

export function ShapeTextEditor({
  node,
  view,
  typed,
  onChange,
  onAlign,
  onFinish,
  onHistoryKey,
  onImage,
}: {
  node: FlowNode;
  view: View;
  /** Writing started with a keystroke: the caret goes to the end instead of selecting everything. */
  typed?: boolean;
  onChange: (paragraphs: FlowParagraph[]) => void;
  onAlign: (align: FlowTextAlign) => void;
  /** Ends writing; `refocus` gives the keyboard back to the canvas. */
  onFinish: (refocus?: boolean) => void;
  onHistoryKey: (e: React.KeyboardEvent | KeyboardEvent) => boolean;
  /** An image pasted or dropped while writing (it goes into this shape). */
  onImage?: (file: File) => void;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [, setTick] = useState(0);
  const [link, setLink] = useState<{ value: string } | null>(null);
  const [colors, setColors] = useState(false);
  const cb = useRef({ onChange, onAlign, onFinish, onHistoryKey, onImage });
  cb.current = { onChange, onAlign, onFinish, onHistoryKey, onImage };
  const linkRef = useRef<() => void>(() => {});

  // Leaving the label (and its bar) finishes writing. Checked a moment later: focus moving between the
  // label and its bar, or the editor's view being moved while React remounts it, isn't leaving.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const blurred = () => {
    window.setTimeout(() => {
      if (!alive.current) return;
      const a = document.activeElement;
      if (a && (barRef.current?.contains(a) || wrapRef.current?.contains(a))) return;
      cb.current.onFinish(false);
    }, 0);
  };

  const editor = useEditor({
    extensions: [...LABEL_EXTENSIONS, LabelLimit],
    content: labelDoc(node),
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: {
        class: "fc-text-input fc-rt",
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": `Text for this ${node.shape === "text" ? "text" : "shape"}`,
        "data-color": node.color,
        "data-shape": node.shape,
        spellcheck: "true",
      },
      handleKeyDown: (v, e) => {
        if (e.isComposing || e.keyCode === 229) return false;
        const mod = e.metaKey || e.ctrlKey;
        const key = e.key.toLowerCase();
        if (mod && (key === "z" || key === "y")) return cb.current.onHistoryKey(e);
        if (e.key === "Escape" || (e.key === "Enter" && !e.shiftKey && !mod)) {
          e.preventDefault();
          cb.current.onFinish(true);
          return true;
        }
        const ed = editorRef.current;
        if (!ed) return false;
        if (e.key === "Enter" && e.shiftKey) {
          // A new line; an empty list item ends the list instead.
          const { $from, empty } = v.state.selection;
          if (empty && $from.parent.content.size === 0 && $from.parent.attrs.list) v.dispatch(v.state.tr.setNodeAttribute($from.before(), "list", null));
          else ed.commands.splitBlock();
          return true;
        }
        if (e.key === "Backspace" && !mod) {
          const { $from, empty } = v.state.selection;
          if (empty && $from.parentOffset === 0 && $from.parent.attrs.list) {
            v.dispatch(v.state.tr.setNodeAttribute($from.before(), "list", null));
            return true;
          }
        }
        if (mod) readSelection(ed);
        // To the start or end of the label: kept inside it (the browser would carry the caret on into the note).
        if (mod && (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "Home" || e.key === "End")) {
          const end = e.key === "ArrowDown" || e.key === "End";
          const at = end ? TextSelection.atEnd(v.state.doc) : TextSelection.atStart(v.state.doc);
          const sel = e.shiftKey ? TextSelection.create(v.state.doc, v.state.selection.anchor, at.head) : at;
          v.dispatch(v.state.tr.setSelection(sel).scrollIntoView());
          return true;
        }
        if (mod && key === "k") {
          linkRef.current();
          return true;
        }
        if (mod && e.shiftKey && (e.code === "Digit8" || e.code === "Digit7")) {
          toggleList(ed, e.code === "Digit8" ? "bullet" : "ordered");
          return true;
        }
        if (mod && e.shiftKey && (key === "l" || key === "e" || key === "r")) {
          cb.current.onAlign(key === "l" ? "left" : key === "r" ? "right" : "center");
          return true;
        }
        return false;
      },
      handleTextInput: (v, from, to, text) => {
        // "- ", "* " or "1. " at the start of a line starts a list.
        if (text !== " ") return false;
        const $from = v.state.doc.resolve(from);
        const before = $from.parent.textBetween(0, $from.parentOffset);
        const list: LabelList | null = before === "-" || before === "*" ? "bullet" : /^1[.)]$/.test(before) ? "ordered" : null;
        if (!list || $from.parent.attrs.list) return false;
        const start = from - before.length;
        v.dispatch(v.state.tr.delete(start, to).setNodeAttribute($from.before(), "list", list));
        return true;
      },
      handlePaste: (v, e) => {
        const image = [...(e.clipboardData?.files ?? [])].find((f) => IMAGE_TYPES.test(f.type));
        if (image && cb.current.onImage) {
          e.preventDefault();
          cb.current.onImage(image);
          return true;
        }
        // Text arrives plain, one paragraph per line, within the label's limit.
        const text = e.clipboardData?.getData("text/plain") ?? "";
        e.preventDefault();
        if (!text) return true;
        const ed = editorRef.current;
        if (ed) readSelection(ed);
        const room = FLOWCHART_LIMITS.maxText - v.state.doc.textBetween(0, v.state.doc.content.size, "\n").length + (v.state.selection.to - v.state.selection.from);
        const lines = pastedLines(text.slice(0, Math.max(0, room)));
        if (!ed || !lines.join("")) return true;
        if (lines.length === 1) v.dispatch(v.state.tr.insertText(lines[0]!).scrollIntoView());
        else ed.commands.insertContent(lines.map((l) => ({ type: "paragraph", ...(l ? { content: [{ type: "text", text: l }] } : {}) })));
        return true;
      },
      handleDrop: (_v, e) => {
        const image = [...(e.dataTransfer?.files ?? [])].find((f) => IMAGE_TYPES.test(f.type));
        if (image && cb.current.onImage) {
          e.preventDefault();
          cb.current.onImage(image);
          return true;
        }
        // Only plain text is taken from a drop (formatting from elsewhere doesn't come in).
        const text = e.dataTransfer?.getData("text/plain");
        if (!text) return true;
        e.preventDefault();
        const ed = editorRef.current;
        ed?.commands.insertContent(pastedLines(text).join(" "));
        return true;
      },
    },
    onUpdate: ({ editor: ed }) => cb.current.onChange(labelParagraphs(ed.state.doc)),
    onTransaction: () => setTick((t) => t + 1),
    onBlur: () => blurred(),
  });
  const editorRef = useRef<Editor | null>(editor);
  editorRef.current = editor;

  // The keyboard goes to the label at once (keys typed right after a click or a new shape land here).
  const typedAtStart = useRef(typed);
  useLayoutEffect(() => {
    if (!editor) return;
    const { state } = editor;
    const sel = typedAtStart.current ? TextSelection.atEnd(state.doc) : new AllSelection(state.doc);
    editor.view.dispatch(state.tr.setSelection(sel));
    editor.view.focus();
  }, [editor]);

  linkRef.current = () => {
    if (!editor) return;
    readSelection(editor);
    const href = editor.getAttributes("link").href as string | undefined;
    setLink({ value: href ?? "" });
  };

  // Keep the editor's own attributes in step with the shape (colour changes while writing).
  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom as HTMLElement;
    dom.setAttribute("data-color", node.color);
    dom.setAttribute("data-shape", node.shape);
  }, [editor, node.color, node.shape]);

  const applyLink = (raw: string) => {
    if (!editor) return;
    const href = safeHref(raw);
    setLink(null);
    // Back to the label at once (keys typed straight after land there).
    editor.view.focus();
    const chain = editor.chain();
    if (!href) {
      chain.extendMarkRange("link").unsetMark("link").run();
      return;
    }
    if (editor.state.selection.empty && !editor.isActive("link")) {
      // Nothing selected: the address itself goes in as linked text.
      const { from } = editor.state.selection;
      chain.insertContent({ type: "text", text: raw.trim(), marks: [{ type: "link", attrs: { href } }] }).run();
      const to = from + raw.trim().length;
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, to)).removeStoredMark(editor.schema.marks.link!));
      return;
    }
    chain.extendMarkRange("link").setMark("link", { href }).run();
  };

  // Where the label sits: its box (beside an icon, below an image) and its first line, as drawn.
  const k = view.k;
  const box = nodeContentBoxes(node).text;
  const t = nodeTextLayout(node);
  const lines = Math.max(1, t.rich.length);
  const blockTop = t.y - FLOWCHART_LINE_HEIGHT / 2 - FLOWCHART_FONT_SIZE * 0.36 - (t.rich.length ? 0 : FLOWCHART_LINE_HEIGHT / 2);
  const align = node.align ?? "center";
  const ink = customFillInk(node.fill);
  const style: React.CSSProperties = {
    left: box.x * k + view.x,
    top: blockTop * k + view.y,
    width: box.w * k,
    minHeight: lines * FLOWCHART_LINE_HEIGHT * k,
    fontSize: FLOWCHART_FONT_SIZE * k,
    lineHeight: `${FLOWCHART_LINE_HEIGHT * k}px`,
    textAlign: align,
    ...(ink ? ({ "--fc-rt-ink": ink } as React.CSSProperties) : {}),
  };

  // The formatting bar: above the shape, or below it near the top of the canvas.
  const top = node.y * k + view.y;
  const above = top - 52 > 8;
  const barStyle: React.CSSProperties = { left: Math.max(8, (node.x + node.w / 2) * k + view.x), top: above ? top - 48 : (node.y + node.h) * k + view.y + 10 };
  const active = (name: string) => !!editor?.isActive(name);
  const list = editor ? currentList(editor) : null;
  const keep = (e: React.SyntheticEvent) => e.preventDefault();
  const run = (fn: (ed: Editor) => void) => () => {
    if (!editor) return;
    readSelection(editor);
    fn(editor);
  };
  const btn = (label: string, shortcut: string, pressed: boolean, onClick: () => void, icon: React.ReactNode) => (
    <button type="button" className="fc-btn" aria-label={label} aria-pressed={pressed} title={shortcut ? `${label} (${shortcut})` : label} onMouseDown={keep} onPointerDown={keep} onClick={onClick}>
      {icon}
    </button>
  );

  return (
    <>
      <div ref={wrapRef} className="fc-rt-wrap" data-align={align} data-ink={ink ? "" : undefined} style={style} onKeyDown={(e) => e.stopPropagation()} onKeyUp={(e) => e.stopPropagation()}>
        <EditorContent editor={editor} />
      </div>
      <div
        ref={barRef}
        className="fc-bar fc-bar-float fc-rt-bar"
        role="toolbar"
        aria-label="Text formatting"
        style={barStyle}
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape" && !link) {
            e.preventDefault();
            setColors(false);
            editor?.commands.focus();
          }
        }}
        onBlur={() => blurred()}
      >
        {colors ? (
          <span role="group" aria-label="Text colour" className="fc-group">
            {btn("Default colour", "", !editor?.isActive("textColor"), run((ed) => ed.chain().focus().unsetMark("textColor").run()), <span className="fc-rt-swatch">A</span>)}
            {TextColorValues.map((c) => (
              <Fragment key={c}>{btn(`${TEXT_COLOR_LABEL[c]} text`, "", !!editor?.isActive("textColor", { value: c }), run((ed) => ed.chain().focus().setMark("textColor", { value: c }).run()), <span className={`fc-rt-swatch fb-color-${c}`}>A</span>)}</Fragment>
            ))}
            <span className="fc-sep" aria-hidden />
            {btn("Done with colours", "Esc", false, () => setColors(false), <Check size={14} aria-hidden />)}
          </span>
        ) : link ? (
          <form
            className="fc-rt-link"
            onSubmit={(e) => {
              e.preventDefault();
              applyLink(link.value);
            }}
          >
            <Link2 size={14} aria-hidden className="fc-rt-link-icon" />
            <input
              autoFocus
              className="fc-input"
              aria-label="Link address"
              placeholder="Paste or type a link"
              value={link.value}
              spellCheck={false}
              onChange={(e) => setLink({ value: e.target.value })}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Escape") {
                  e.preventDefault();
                  setLink(null);
                  editor?.view.focus();
                }
              }}
            />
            <button type="submit" className="fc-btn" aria-label="Apply link" title="Apply link (Enter)">
              <Check size={14} aria-hidden />
            </button>
            {editor?.isActive("link") ? (
              <button type="button" className="fc-btn" aria-label="Remove link" title="Remove link" onClick={() => applyLink("")}>
                <Unlink size={14} aria-hidden />
              </button>
            ) : (
              <button
                type="button"
                className="fc-btn"
                aria-label="Cancel"
                title="Cancel (Esc)"
                onClick={() => {
                  setLink(null);
                  editor?.view.focus();
                }}
              >
                <X size={14} aria-hidden />
              </button>
            )}
          </form>
        ) : (
          <>
            <span role="group" aria-label="Style" className="fc-group">
              {btn("Bold", "⌘B", active("bold"), run((ed) => ed.chain().focus().toggleMark("bold").run()), <Bold size={15} aria-hidden />)}
              {btn("Italic", "⌘I", active("italic"), run((ed) => ed.chain().focus().toggleMark("italic").run()), <Italic size={15} aria-hidden />)}
              {btn("Underline", "⌘U", active("underline"), run((ed) => ed.chain().focus().toggleMark("underline").run()), <Underline size={15} aria-hidden />)}
              {btn("Strikethrough", "⇧⌘X", active("strike"), run((ed) => ed.chain().focus().toggleMark("strike").run()), <Strikethrough size={15} aria-hidden />)}
            </span>
            <span className="fc-sep" aria-hidden />
            <span role="group" aria-label="Lists" className="fc-group">
              {btn("Bulleted list", "⇧⌘8", list === "bullet", run((ed) => toggleList(ed, "bullet")), <List size={15} aria-hidden />)}
              {btn("Numbered list", "⇧⌘7", list === "ordered", run((ed) => toggleList(ed, "ordered")), <ListOrdered size={15} aria-hidden />)}
            </span>
            <span className="fc-sep" aria-hidden />
            {btn("Link", "⌘K", active("link"), () => linkRef.current(), <Link2 size={15} aria-hidden />)}
            {btn("Text colour", "", active("textColor"), () => setColors(true), <Baseline size={15} aria-hidden />)}
            <span className="fc-sep" aria-hidden />
            <span role="group" aria-label="Alignment" className="fc-group">
              {btn("Align left", "⇧⌘L", align === "left", () => onAlign("left"), <AlignLeft size={15} aria-hidden />)}
              {btn("Align centre", "⇧⌘E", align === "center", () => onAlign("center"), <AlignCenter size={15} aria-hidden />)}
              {btn("Align right", "⇧⌘R", align === "right", () => onAlign("right"), <AlignRight size={15} aria-hidden />)}
            </span>
          </>
        )}
      </div>
    </>
  );
}
