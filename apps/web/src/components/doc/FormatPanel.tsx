"use client";

import type { Editor } from "@tiptap/react";
import { useEffect, useId, useState } from "react";
import {
  Bold,
  Eraser,
  FileText,
  Highlighter,
  Code2,
  Italic,
  List,
  ListOrdered,
  Quote,
  Strikethrough,
  Underline,
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  IndentDecrease,
  IndentIncrease,
  PanelTop,
  Play,
  SquareCheck,
  StickyNote,
  ChevronRight,
  Link2,
  Unlink,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import {
  HIGHLIGHT_COLORS,
  TEXT_COLORS,
  applyLink,
  changeDepth,
  clearFormatting,
  removeLink,
  selectedBlockFormat,
  setBlockFormat,
  setHighlight,
  setTextColor,
  turnInto,
} from "@/components/editor/commands";
import { colorName, useNotePalette } from "@/components/editor/notePalette";
import { useActiveCellEditor } from "@/components/editor/table/cellEditorStore";
import { useIphoneApp } from "@/lib/iphone";
import { askText, feel } from "@/lib/native/ui";
import { useToast } from "@/components/ui/Toast";

/*
 * The page tools' Format panel: turn the current block into another kind, format the selected text, its
 * colour and highlight, links, and the block's alignment, indent and style. It only needs the editor, so
 * the app's Inspector and the site's editable note both use it.
 */

function Tile({ label, icon, onClick, disabled, pressed, tone = "ink" }: { label: string; icon: React.ReactNode; onClick: () => void; disabled?: boolean; pressed?: boolean; tone?: string }) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={pressed}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`group flex flex-col items-center gap-1.5 rounded-chip px-1 py-2.5 text-footnote font-medium transition-[box-shadow,transform,background-color] duration-150 disabled:opacity-40 ${
        pressed ? "bg-accent-soft text-heading shadow-[inset_0_0_0_1.5px_color-mix(in_oklab,var(--color-accent)_45%,transparent)]" : "ui-raised text-ink hover:-translate-y-px hover:shadow-[var(--shadow-card)]"
      }`}
    >
      <span aria-hidden className={`grid h-7 w-7 place-items-center rounded-chip ${TONES[tone] ?? TONES.ink}`}>
        {icon}
      </span>
      {label}
    </button>
  );
}

// The app chrome is black and white; tiles don't carry colour of their own.
const TONES: Record<string, string> = {
  ink: "bg-sunken text-heading",
  ember: "bg-sunken text-heading",
  moss: "bg-sunken text-heading",
  plum: "bg-sunken text-heading",
  marigold: "bg-sunken text-heading",
  coral: "bg-sunken text-heading",
};

export function FormatPanel({ editor, disabled }: { editor: Editor | null; disabled: boolean }) {
  const palette = useNotePalette();
  const [, force] = useState(0);
  const [href, setHref] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  const linkId = useId();
  const phone = useIphoneApp();
  const toast = useToast();
  // A table cell being edited takes the text formatting (its own editor, table/CellEditor.tsx); the block
  // tools are for the note's lines and wait until the cell is closed.
  const cell = useActiveCellEditor(editor);
  const marks = (cell as Editor | null) ?? editor;
  useEffect(() => {
    if (!editor) return;
    const on = () => force((n) => n + 1);
    const target = marks ?? editor;
    // The link field follows the selection: it shows the address of the link under the cursor.
    const onSelection = () => {
      setHref(String(target.getAttributes("link").href ?? ""));
      setLinkError(null);
    };
    onSelection();
    for (const ed of new Set([editor, target])) {
      ed.on("selectionUpdate", on);
      ed.on("transaction", on);
    }
    target.on("selectionUpdate", onSelection);
    return () => {
      for (const ed of new Set([editor, target])) {
        ed.off("selectionUpdate", on);
        ed.off("transaction", on);
      }
      target.off("selectionUpdate", onSelection);
    };
  }, [editor, marks]);
  if (!editor || !marks) return <p className="text-subheadline text-muted">Place the cursor in the document to format.</p>;
  const d = disabled || Boolean(cell);
  const node = editor.state.selection.$from.depth >= 1 ? editor.state.selection.$from.node(1) : null;
  const type = node?.type.name;
  const level = node?.attrs.level;
  const inCode = type === "codeBlock" && !cell;
  const marksOff = disabled || inCode;
  const linkActive = marks.isActive("link");
  const fmt = selectedBlockFormat(editor);
  const formattable = ["paragraph", "heading", "bulleted", "numbered", "todo", "toggle", "quote"].includes(type ?? "");
  const blockOff = d || !formattable;
  const textStyle = type === "paragraph" ? (fmt.textStyle ?? "body") : null;
  const seg = "flex rounded-control bg-sunken/80 p-1";
  const segBtn = (on: boolean) =>
    `grid h-9 flex-1 place-items-center rounded-chip text-subheadline transition-colors focus-visible:outline-none focus-visible:shadow-[0_0_0_2px_var(--color-focus)] disabled:opacity-40 ${on ? "bg-accent-soft font-semibold text-heading shadow-[inset_0_0_0_1.5px_color-mix(in_oklab,var(--color-accent)_35%,transparent)]" : "text-ink hover:bg-surface"}`;
  const toggleList = (t: string, attrs: Record<string, unknown> = {}) => (type === t ? turnInto(editor, "paragraph") : turnInto(editor, t, attrs));
  if (phone) {
    // The iPhone layout (docs/IOS_POLISH_PLAN.md §3 Format): one system. Text styles as a row of preview
    // tiles, then rows of 44 pt buttons in capsules (the chosen one filled), then the rest as rows.
    const pick = (run: () => unknown) => () => {
      feel("choose");
      run();
    };
    const styles = [
      ["Title", type === "heading" && level === 1, () => turnInto(editor, "heading", { level: 1 }), "font-[family-name:var(--font-display)] text-title-2 font-semibold leading-none"],
      ["Subtitle", type === "heading" && level === 2, () => turnInto(editor, "heading", { level: 2 }), "text-headline font-semibold leading-none"],
      ["Heading", type === "heading" && level === 3, () => turnInto(editor, "heading", { level: 3 }), "text-subheadline font-semibold leading-none"],
      ["Strong", textStyle === "strong", () => turnInto(editor, "paragraph", { textStyle: "strong" }), "text-subheadline font-semibold leading-none"],
      ["Body", textStyle === "body", () => turnInto(editor, "paragraph", { textStyle: null }), "text-subheadline leading-none"],
      ["Caption", textStyle === "caption", () => turnInto(editor, "paragraph", { textStyle: "caption" }), "text-footnote leading-none opacity-70"],
    ] as const;
    const iconBtn = (label: string, icon: React.ReactNode, on: boolean, run: () => unknown, off = false, swatch = false) => (
      <button key={label} type="button" aria-label={label} aria-pressed={on} disabled={off} onMouseDown={(e) => e.preventDefault()} onClick={pick(run)} className={`iphone-fmt-btn ${swatch ? "is-swatch" : ""} ${on ? "is-on" : ""}`}>
        {icon}
      </button>
    );
    const ic = { size: 20, strokeWidth: 2, "aria-hidden": true } as const;
    const row = (label: string, icon: React.ReactNode, on: boolean, run: () => unknown, off = false) => (
      <button key={label} type="button" aria-pressed={on} disabled={off} onMouseDown={(e) => e.preventDefault()} onClick={pick(run)} className="iphone-fmt-row">
        <span aria-hidden className="grid w-7 flex-none place-items-center text-heading">
          {icon}
        </span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {on ? <span aria-hidden className="h-2 w-2 flex-none iphone-round bg-heading" /> : null}
      </button>
    );
    const link = async () => {
      const current = String(marks.getAttributes("link").href ?? "");
      const next = await askText({ title: current ? "Edit link" : "Add link", value: current, placeholder: "Paste or type a link", confirm: current ? "Update" : "Link", capitalize: "none", maxLength: 2000 });
      if (next === null) return;
      if (!applyLink(marks, next)) toast.show("That doesn’t look like a web address.", { tone: "error" });
    };
    return (
      <div
        className="iphone-format space-y-3 pb-2"
        data-cell-tools=""
        onMouseDown={(e) => {
          const t = e.target as Element;
          if (t.closest("button") && !t.closest("[aria-haspopup], [role=combobox], input, textarea, select")) e.preventDefault();
        }}
      >
        <div role="group" aria-label="Text style" className="-mx-4 flex snap-x gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {styles.map(([label, on, run, cls]) => (
            <button key={label} type="button" aria-pressed={on} disabled={d || inCode} onMouseDown={(e) => e.preventDefault()} onClick={pick(run)} className={`iphone-fmt-style snap-start ${on ? "is-on" : ""}`}>
              <span className={cls}>{label}</span>
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div role="group" aria-label="Text marks" className="iphone-fmt-group col-span-2">
            {iconBtn("Bold", <Bold {...ic} strokeWidth={2.4} />, marks.isActive("bold"), () => marks.chain().focus().toggleMark("bold").run(), marksOff)}
            {iconBtn("Italic", <Italic {...ic} />, marks.isActive("italic"), () => marks.chain().focus().toggleMark("italic").run(), marksOff)}
            {iconBtn("Underline", <Underline {...ic} />, marks.isActive("underline"), () => marks.chain().focus().toggleMark("underline").run(), marksOff)}
            {iconBtn("Strikethrough", <Strikethrough {...ic} />, marks.isActive("strike"), () => marks.chain().focus().toggleMark("strike").run(), marksOff)}
            {iconBtn("Inline code", <Code2 {...ic} />, marks.isActive("code"), () => marks.chain().focus().toggleMark("code").run(), marksOff)}
          </div>
          <div role="group" aria-label="Lists" className="iphone-fmt-group col-span-2">
            {iconBtn("To-do", <SquareCheck {...ic} />, type === "todo", () => toggleList("todo", { checked: false }), d || inCode)}
            {iconBtn("Toggle", <Play size={16} aria-hidden className="fill-current" />, type === "toggle", () => toggleList("toggle", { collapsed: false }), d || inCode)}
            {iconBtn("Bullets", <List {...ic} />, type === "bulleted", () => toggleList("bulleted"), d || inCode)}
            {iconBtn("Numbers", <ListOrdered {...ic} />, type === "numbered", () => toggleList("numbered"), d || inCode)}
          </div>
          <div role="group" aria-label="Indent" className="iphone-fmt-group">
            {iconBtn("Outdent", <IndentDecrease {...ic} />, false, () => changeDepth(editor, -1), d)}
            {iconBtn("Indent", <IndentIncrease {...ic} />, false, () => changeDepth(editor, 1), d)}
          </div>
          <div role="group" aria-label="Group" className="iphone-fmt-group">
            {iconBtn("Page", <span className="flex items-center gap-1.5 text-subheadline"><FileText size={17} strokeWidth={2} aria-hidden /> Page</span>, fmt.group !== "card", () => setBlockFormat(editor, { group: null }), blockOff)}
            {iconBtn("Card", <span className="flex items-center gap-1.5 text-subheadline"><PanelTop size={17} strokeWidth={2} aria-hidden /> Card</span>, fmt.group === "card", () => setBlockFormat(editor, { group: fmt.group === "card" ? null : "card" }), blockOff)}
          </div>
          <div role="group" aria-label="Alignment" className="iphone-fmt-group col-span-2">
            {(
              [
                ["left", "Align left", <AlignLeft key="l" {...ic} />],
                ["center", "Align center", <AlignCenter key="c" {...ic} />],
                ["right", "Align right", <AlignRight key="r" {...ic} />],
                ["justify", "Justify", <AlignJustify key="j" {...ic} />],
              ] as const
            ).map(([value, label, icon]) => iconBtn(label, icon, (fmt.align ?? "left") === value, () => setBlockFormat(editor, { align: value === "left" ? null : value }), blockOff))}
          </div>
        </div>
        <div role="group" aria-label="Text color" className="iphone-fmt-group" {...palette?.attrs}>
          {iconBtn("Default text color", <span className="text-headline font-semibold">A</span>, !marks.isActive("textColor"), () => setTextColor(marks, null), marksOff, true)}
          {TEXT_COLORS.map((c) => iconBtn(`Text color: ${colorName(palette, c)}`, <span className={`fb-color-${c} text-headline font-semibold`}>A</span>, marks.isActive("textColor", { value: c }), () => setTextColor(marks, c), marksOff, true))}
        </div>
        <div role="group" aria-label="Highlight" className="iphone-fmt-group" {...palette?.attrs}>
          {iconBtn("No highlight", <span className="h-[18px] w-[18px] iphone-round shadow-[inset_0_0_0_1.5px_var(--color-ink-faint)]" />, !marks.isActive("highlight"), () => setHighlight(marks, null), marksOff, true)}
          {HIGHLIGHT_COLORS.map((h) => iconBtn(`Highlight: ${colorName(palette, h)}`, <span className={`fb-hl-${h} fb-swatch h-[18px] w-[18px] iphone-round`} />, marks.isActive("highlight", { value: h }), () => setHighlight(marks, h), marksOff, true))}
        </div>
        <div className="iphone-fmt-list" role="group" aria-label="More">
          {row("Quote", <Quote {...ic} />, type === "quote", () => turnInto(editor, "quote"), d)}
          {row("Callout", <StickyNote {...ic} />, type === "callout", () => turnInto(editor, "callout", { tone: "note" }), d)}
          {row("Code block", <Code2 {...ic} />, inCode, () => turnInto(editor, "code", { language: "plaintext" }), d)}
          {row("Focus line", <span className="h-4 w-[3px] iphone-round bg-current" />, fmt.decoration === "focus", () => setBlockFormat(editor, { decoration: fmt.decoration === "focus" ? null : "focus" }), blockOff)}
          {row("Block background", <span className="h-3.5 w-5 rounded-tiny bg-[var(--glass-active)] shadow-[inset_0_0_0_1px_var(--glass-border)]" />, fmt.decoration === "block", () => setBlockFormat(editor, { decoration: fmt.decoration === "block" ? null : "block" }), blockOff)}
          <button type="button" aria-haspopup="dialog" disabled={marksOff} onMouseDown={(e) => e.preventDefault()} onClick={() => void link()} className="iphone-fmt-row">
            <span aria-hidden className="grid w-7 flex-none place-items-center text-heading">
              <Link2 {...ic} />
            </span>
            <span className="min-w-0 flex-1 truncate">{linkActive ? "Edit link" : "Link"}</span>
          </button>
          {linkActive ? row("Remove link", <Unlink {...ic} />, false, () => removeLink(marks), marksOff) : null}
          {row("Clear formatting", <Eraser {...ic} />, false, () => clearFormatting(marks), marksOff)}
        </div>
        {type === "callout" ? (
          <div role="group" aria-label="Callout tone" className="iphone-fmt-group">
            {["note", "info", "success", "warning", "danger"].map((tone) => (
              <button key={tone} type="button" disabled={d} aria-pressed={node?.attrs.tone === tone} onMouseDown={(e) => e.preventDefault()} onClick={pick(() => turnInto(editor, "callout", { tone }))} className={`iphone-fmt-btn !w-auto flex-1 px-2 text-subheadline capitalize ${node?.attrs.tone === tone ? "is-on" : ""}`}>
                {tone}
              </button>
            ))}
          </div>
        ) : null}
        {inCode ? (
          <label className="block">
            <span className="ui-caption-caps mb-1.5 block px-1">Language</span>
            <Select
              disabled={d}
              value={String(node?.attrs.language ?? "plaintext")}
              onChange={(e) => {
                const pos = editor.state.selection.$from.before(1);
                editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node!.attrs, language: e.target.value }));
              }}
              className="ui-input h-11 w-full rounded-control px-3 text-body"
            >
              {["plaintext", "bash", "c", "cpp", "csharp", "css", "diff", "go", "graphql", "html", "java", "javascript", "json", "kotlin", "latex", "markdown", "mermaid", "php", "python", "ruby", "rust", "sql", "swift", "toml", "typescript", "xml", "yaml"].map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </Select>
          </label>
        ) : null}
      </div>
    );
  }
  return (
    // Its buttons don't take focus from the note (dropdowns and fields do): what's typed next goes on where
    // the caret was, and a Space can't press a button.
    <div
      className="space-y-5"
      data-cell-tools=""
      onMouseDown={(e) => {
        const t = e.target as Element;
        if (t.closest("button") && !t.closest("[aria-haspopup], [role=combobox], input, textarea, select")) e.preventDefault();
      }}
    >
      <section>
        <h3 className="ui-caps mb-2 px-1">Text</h3>
        <div className="grid grid-cols-3 gap-1.5" role="group" aria-label="Text style">
          {(
            [
              ["Title", type === "heading" && level === 1, () => turnInto(editor, "heading", { level: 1 }), "text-headline font-bold"],
              ["Subtitle", type === "heading" && level === 2, () => turnInto(editor, "heading", { level: 2 }), "text-body font-semibold"],
              ["Heading", type === "heading" && level === 3, () => turnInto(editor, "heading", { level: 3 }), "text-body font-semibold"],
              ["Strong", textStyle === "strong", () => turnInto(editor, "paragraph", { textStyle: "strong" }), "font-semibold"],
              ["Body", textStyle === "body", () => turnInto(editor, "paragraph", { textStyle: null }), ""],
              ["Caption", textStyle === "caption", () => turnInto(editor, "paragraph", { textStyle: "caption" }), "text-footnote text-muted"],
            ] as const
          ).map(([label, on, run, cls]) => (
            <button key={label} type="button" disabled={d || inCode} aria-pressed={on} onMouseDown={(e) => e.preventDefault()} onClick={run} className={`h-10 rounded-chip ${on ? "bg-accent-soft text-heading shadow-[inset_0_0_0_1.5px_color-mix(in_oklab,var(--color-accent)_35%,transparent)]" : "bg-sunken/80 text-ink hover:bg-accent-soft/70"} disabled:opacity-40 ${cls}`}>
              {label}
            </button>
          ))}
        </div>
      </section>

      <section>
        <h3 className="ui-caps mb-2 px-1">Groups</h3>
        <div className="grid grid-cols-2 gap-1.5" role="group" aria-label="Group">
          <button type="button" disabled={blockOff} aria-pressed={fmt.group !== "card"} onMouseDown={(e) => e.preventDefault()} onClick={() => setBlockFormat(editor, { group: null })} className={`flex h-11 items-center justify-center gap-2 rounded-chip text-body disabled:opacity-40 ${fmt.group !== "card" ? "bg-accent-soft font-semibold text-heading" : "bg-sunken/80 text-ink hover:bg-accent-soft/70"}`}>
            <FileText size={15} aria-hidden /> Page
          </button>
          <button type="button" disabled={blockOff} aria-pressed={fmt.group === "card"} onMouseDown={(e) => e.preventDefault()} onClick={() => setBlockFormat(editor, { group: fmt.group === "card" ? null : "card" })} className={`flex h-11 items-center justify-center gap-2 rounded-chip text-body disabled:opacity-40 ${fmt.group === "card" ? "bg-heading font-semibold text-canvas" : "bg-sunken/80 text-ink hover:bg-accent-soft/70"}`}>
            Card <PanelTop size={15} aria-hidden />
          </button>
        </div>
      </section>

      <section className="space-y-1.5" aria-label="Text and block formatting">
        <div className={seg} role="group" aria-label="Text marks">
          {(
            [
              ["Bold", "bold", <Bold key="b" size={15} />],
              ["Italic", "italic", <Italic key="i" size={15} />],
              ["Strikethrough", "strike", <Strikethrough key="s" size={15} />],
              ["Inline code", "code", <Code2 key="c" size={15} />],
            ] as const
          ).map(([label, mark, icon]) => (
            <button key={mark} type="button" aria-label={label} title={label} disabled={marksOff} aria-pressed={marks.isActive(mark)} onMouseDown={(e) => e.preventDefault()} onClick={() => marks.chain().focus().toggleMark(mark).run()} className={segBtn(marks.isActive(mark))}>
              {icon}
            </button>
          ))}
        </div>
        <div className={seg} role="group" aria-label="Lists">
          {(
            [
              ["To-do", "todo", { checked: false }, <SquareCheck key="t" size={15} />],
              ["Toggle", "toggle", { collapsed: false }, <Play key="g" size={13} className="fill-current" />],
              ["Bullets", "bulleted", {}, <List key="l" size={15} />],
              ["Numbers", "numbered", {}, <ListOrdered key="n" size={15} />],
            ] as const
          ).map(([label, t, attrs, icon]) => (
            <button key={t} type="button" aria-label={label} title={label} disabled={d || inCode} aria-pressed={type === t} onMouseDown={(e) => e.preventDefault()} onClick={() => toggleList(t, attrs)} className={segBtn(type === t)}>
              {icon}
            </button>
          ))}
        </div>
        <div className="flex gap-1.5">
          <div className={`${seg} w-[34%]`} role="group" aria-label="Indent">
            <button type="button" aria-label="Outdent" title="Outdent (⇧Tab)" disabled={d} onMouseDown={(e) => e.preventDefault()} onClick={() => changeDepth(editor, -1)} className={segBtn(false)}>
              <IndentDecrease size={15} />
            </button>
            <button type="button" aria-label="Indent" title="Indent (Tab)" disabled={d} onMouseDown={(e) => e.preventDefault()} onClick={() => changeDepth(editor, 1)} className={segBtn(false)}>
              <IndentIncrease size={15} />
            </button>
          </div>
          <div className={`${seg} flex-1`} role="group" aria-label="Alignment">
            {(
              [
                ["left", "Align left", <AlignLeft key="l" size={15} />],
                ["center", "Align center", <AlignCenter key="c" size={15} />],
                ["right", "Align right", <AlignRight key="r" size={15} />],
                ["justify", "Justify", <AlignJustify key="j" size={15} />],
              ] as const
            ).map(([value, label, icon]) => {
              const on = (fmt.align ?? "left") === value;
              return (
                <button key={value} type="button" aria-label={label} title={label} disabled={blockOff} aria-pressed={on} onMouseDown={(e) => e.preventDefault()} onClick={() => setBlockFormat(editor, { align: value === "left" ? null : value })} className={segBtn(on)}>
                  {icon}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <section>
        <h3 className="ui-caps mb-2 px-1">Decorations</h3>
        <div className="grid grid-cols-2 gap-1.5" role="group" aria-label="Decoration">
          <button type="button" disabled={blockOff} aria-pressed={fmt.decoration === "focus"} onMouseDown={(e) => e.preventDefault()} onClick={() => setBlockFormat(editor, { decoration: fmt.decoration === "focus" ? null : "focus" })} className={`flex h-10 items-center justify-center gap-2 rounded-chip text-body disabled:opacity-40 ${fmt.decoration === "focus" ? "bg-accent-soft font-semibold text-heading shadow-[inset_0_0_0_1.5px_color-mix(in_oklab,var(--color-accent)_35%,transparent)]" : "bg-sunken/80 text-ink hover:bg-accent-soft/70"}`}>
            <span aria-hidden className="h-4 w-[3px] rounded-chip bg-current" /> Focus
          </button>
          <button type="button" disabled={blockOff} aria-pressed={fmt.decoration === "block"} onMouseDown={(e) => e.preventDefault()} onClick={() => setBlockFormat(editor, { decoration: fmt.decoration === "block" ? null : "block" })} className={`h-10 rounded-chip text-body disabled:opacity-40 ${fmt.decoration === "block" ? "bg-accent-soft font-semibold text-heading shadow-[inset_0_0_0_1.5px_color-mix(in_oklab,var(--color-accent)_35%,transparent)]" : "bg-sunken/80 text-ink hover:bg-accent-soft/70"}`}>
            <span className="rounded-chip bg-[var(--glass-active)] px-3 py-1 shadow-[inset_0_0_0_1px_var(--glass-border)]">Block</span>
          </button>
        </div>
      </section>

      <details className="group rounded-chip bg-sunken/50 px-2.5 py-2">
        <summary className="cursor-pointer list-none text-subheadline font-medium text-ink marker:hidden">
          <span className="inline-flex items-center gap-1.5">
            <ChevronRight size={14} className="transition-transform group-open:rotate-90" aria-hidden /> More: quote, callout, code, links, highlight
          </span>
        </summary>
        <div className="mt-3 space-y-5">
      <section>
        <h3 className="ui-caps mb-2 px-1">Blocks</h3>
        <div className="grid grid-cols-4 gap-2">
          <Tile label="Quote" icon={<Quote size={16} />} tone="plum" disabled={d} pressed={type === "quote"} onClick={() => turnInto(editor, "quote")} />
          <Tile label="Callout" icon={<StickyNote size={16} />} tone="plum" disabled={d} pressed={type === "callout"} onClick={() => turnInto(editor, "callout", { tone: "note" })} />
          <Tile label="Code block" icon={<Code2 size={16} />} tone="marigold" disabled={d} pressed={inCode} onClick={() => turnInto(editor, "code", { language: "plaintext" })} />
          <Tile label="Underline" icon={<Underline size={16} />} disabled={marksOff} pressed={marks.isActive("underline")} onClick={() => marks.chain().focus().toggleMark("underline").run()} />
          <Tile label="Highlight" icon={<Highlighter size={16} />} tone="marigold" disabled={marksOff} pressed={marks.isActive("highlight")} onClick={() => marks.chain().focus().toggleMark("highlight", { value: "yellow" }).run()} />
          <Tile label="Clear" icon={<Eraser size={16} />} disabled={marksOff} onClick={() => clearFormatting(marks)} />
        </div>
      </section>
      <section>
        <h3 className="ui-caps mb-2 px-1">
          <label htmlFor={linkId}>Link</label>
        </h3>
        <form
          className="flex gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (!href.trim()) {
              if (linkActive) removeLink(marks);
              return;
            }
            if (!applyLink(marks, href)) setLinkError("That doesn’t look like a web address.");
          }}
        >
          <input
            id={linkId}
            value={href}
            disabled={marksOff}
            onChange={(e) => {
              setHref(e.target.value);
              setLinkError(null);
            }}
            placeholder={marks.state.selection.empty && !linkActive ? "Address to insert as a link" : "Paste or type a link"}
            aria-invalid={Boolean(linkError)}
            aria-describedby={`${linkId}-hint`}
            className="ui-input h-8 min-w-0 flex-1 rounded-chip px-3 text-callout disabled:opacity-50"
          />
          <Button size="sm" type="submit" disabled={marksOff || !href.trim()}>
            {linkActive ? "Update" : "Link"}
          </Button>
          {linkActive ? (
            <Button size="sm" variant="quiet" disabled={marksOff} onClick={() => removeLink(marks)}>
              Remove
            </Button>
          ) : null}
        </form>
        <p id={`${linkId}-hint`} className={`mt-1 px-1 text-footnote ${linkError ? "text-danger" : "text-muted"}`} role={linkError ? "alert" : undefined}>
          {linkError ?? "Links the selected text. Shortcut: ⌘⇧K."}
        </p>
      </section>
      {/* Text colours and highlights come from the note's theme (its own colours and names) when it has
          them; "Default" (the page's text colour / no highlight) is the starting choice. */}
      <section {...palette?.attrs}>
        <h3 className="ui-caps mb-2 px-1">Text color</h3>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Text color">
          <button type="button" disabled={marksOff} onMouseDown={(e) => e.preventDefault()} onClick={() => setTextColor(marks, null)} aria-pressed={!marks.isActive("textColor")} className={`ui-chip ui-raised text-ink disabled:opacity-40 ${!marks.isActive("textColor") ? "shadow-[inset_0_0_0_1.5px_var(--color-accent)]" : ""}`}>
            Default
          </button>
          {TEXT_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              disabled={marksOff}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setTextColor(marks, c)}
              aria-label={`Text color: ${colorName(palette, c)}`}
              aria-pressed={marks.isActive("textColor", { value: c })}
              title={colorName(palette, c)}
              className={`grid h-8 w-8 place-items-center rounded-chip ui-raised disabled:opacity-40 ${marks.isActive("textColor", { value: c }) ? "shadow-[inset_0_0_0_1.5px_var(--color-accent)]" : ""}`}
            >
              <span className={`fb-color-${c} text-subheadline font-semibold`} aria-hidden>
                A
              </span>
            </button>
          ))}
        </div>
      </section>
      <section {...palette?.attrs}>
        <h3 className="ui-caps mb-2 px-1">Highlight</h3>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Highlight">
          <button type="button" disabled={marksOff} onMouseDown={(e) => e.preventDefault()} onClick={() => setHighlight(marks, null)} aria-pressed={!marks.isActive("highlight")} className={`ui-chip ui-raised text-ink disabled:opacity-40 ${!marks.isActive("highlight") ? "shadow-[inset_0_0_0_1.5px_var(--color-accent)]" : ""}`}>
            Default
          </button>
          {HIGHLIGHT_COLORS.map((h) => (
            <button
              key={h}
              type="button"
              disabled={marksOff}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setHighlight(marks, h)}
              aria-label={`Highlight: ${colorName(palette, h)}`}
              aria-pressed={marks.isActive("highlight", { value: h })}
              title={colorName(palette, h)}
              className={`grid h-8 w-8 place-items-center rounded-chip ui-raised disabled:opacity-40 ${marks.isActive("highlight", { value: h }) ? "shadow-[inset_0_0_0_1.5px_var(--color-accent)]" : ""}`}
            >
              <span className={`fb-hl-${h} fb-swatch h-4 w-4 rounded-tiny`} aria-hidden />
            </button>
          ))}
        </div>
      </section>
      {type === "callout" ? (
        <section>
          <h3 className="ui-caps mb-2 px-1">Callout tone</h3>
          <div className="flex flex-wrap gap-2">
            {["note", "info", "success", "warning", "danger"].map((tone) => (
              <button key={tone} type="button" disabled={d} aria-pressed={node?.attrs.tone === tone} onClick={() => turnInto(editor, "callout", { tone })} className={`ui-chip capitalize ${node?.attrs.tone === tone ? "bg-accent-soft text-heading shadow-[inset_0_0_0_1.5px_var(--color-accent)]" : "ui-raised text-ink"}`}>
                {tone}
              </button>
            ))}
          </div>
        </section>
      ) : null}
      {inCode ? (
        <label className="block text-subheadline">
          <span className="ui-caps mb-1.5 block px-1">Language</span>
          <Select
            disabled={d}
            value={String(node?.attrs.language ?? "plaintext")}
            onChange={(e) => {
              const pos = editor.state.selection.$from.before(1);
              editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node!.attrs, language: e.target.value }));
            }}
            className="ui-input h-9 w-full rounded-chip px-3 text-callout"
          >
            {["plaintext", "bash", "c", "cpp", "csharp", "css", "diff", "go", "graphql", "html", "java", "javascript", "json", "kotlin", "latex", "markdown", "mermaid", "php", "python", "ruby", "rust", "sql", "swift", "toml", "typescript", "xml", "yaml"].map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </Select>
        </label>
      ) : null}
        </div>
      </details>
      <p className="ui-shortcut-hint px-1 text-footnote text-muted">Shortcuts: ⌘⌥0–3 headings, ⌘⇧7/8/9 lists and to-dos, Tab / ⇧Tab to nest, ⌥⇧↑↓ to move, ⌘⇧K link, ⌥F10 formatting toolbar, Esc then ⇧↑↓ to select blocks, ⌘. for block options.</p>
    </div>
  );
}
