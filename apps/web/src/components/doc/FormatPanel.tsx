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
      className={`group flex flex-col items-center gap-1.5 rounded-[6px] px-1 py-2.5 text-[11.5px] font-medium transition-[box-shadow,transform,background-color] duration-150 disabled:opacity-40 ${
        pressed ? "bg-accent-soft text-heading shadow-[inset_0_0_0_1.5px_color-mix(in_oklab,var(--color-accent)_45%,transparent)]" : "ui-raised text-ink hover:-translate-y-px hover:shadow-[var(--shadow-card)]"
      }`}
    >
      <span aria-hidden className={`grid h-7 w-7 place-items-center rounded-[6px] ${TONES[tone] ?? TONES.ink}`}>
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
  useEffect(() => {
    if (!editor) return;
    const on = () => force((n) => n + 1);
    // The link field follows the selection: it shows the address of the link under the cursor.
    const onSelection = () => {
      setHref(String(editor.getAttributes("link").href ?? ""));
      setLinkError(null);
    };
    onSelection();
    editor.on("selectionUpdate", on);
    editor.on("selectionUpdate", onSelection);
    editor.on("transaction", on);
    return () => {
      editor.off("selectionUpdate", on);
      editor.off("selectionUpdate", onSelection);
      editor.off("transaction", on);
    };
  }, [editor]);
  if (!editor) return <p className="text-sm text-muted">Place the cursor in the document to format.</p>;
  const d = disabled;
  const node = editor.state.selection.$from.depth >= 1 ? editor.state.selection.$from.node(1) : null;
  const type = node?.type.name;
  const level = node?.attrs.level;
  const inCode = type === "codeBlock";
  const marksOff = d || inCode;
  const linkActive = editor.isActive("link");
  const fmt = selectedBlockFormat(editor);
  const formattable = ["paragraph", "heading", "bulleted", "numbered", "todo", "toggle", "quote"].includes(type ?? "");
  const blockOff = d || !formattable;
  const textStyle = type === "paragraph" ? (fmt.textStyle ?? "body") : null;
  const seg = "flex overflow-hidden rounded-[6px] bg-sunken/80 p-0.5";
  const segBtn = (on: boolean) =>
    `grid h-9 flex-1 place-items-center rounded-[6px] text-[13px] transition-colors disabled:opacity-40 ${on ? "bg-accent-soft font-semibold text-heading shadow-[inset_0_0_0_1.5px_color-mix(in_oklab,var(--color-accent)_35%,transparent)]" : "text-ink hover:bg-surface"}`;
  const toggleList = (t: string, attrs: Record<string, unknown> = {}) => (type === t ? turnInto(editor, "paragraph") : turnInto(editor, t, attrs));
  return (
    <div className="space-y-5">
      <section>
        <h3 className="ui-caps mb-2 px-1">Text</h3>
        <div className="grid grid-cols-3 gap-1.5" role="group" aria-label="Text style">
          {(
            [
              ["Title", type === "heading" && level === 1, () => turnInto(editor, "heading", { level: 1 }), "text-[15px] font-bold"],
              ["Subtitle", type === "heading" && level === 2, () => turnInto(editor, "heading", { level: 2 }), "text-[14px] font-semibold"],
              ["Heading", type === "heading" && level === 3, () => turnInto(editor, "heading", { level: 3 }), "text-[13.5px] font-semibold"],
              ["Strong", textStyle === "strong", () => turnInto(editor, "paragraph", { textStyle: "strong" }), "font-semibold"],
              ["Body", textStyle === "body", () => turnInto(editor, "paragraph", { textStyle: null }), ""],
              ["Caption", textStyle === "caption", () => turnInto(editor, "paragraph", { textStyle: "caption" }), "text-[12px] text-muted"],
            ] as const
          ).map(([label, on, run, cls]) => (
            <button key={label} type="button" disabled={d || inCode} aria-pressed={on} onMouseDown={(e) => e.preventDefault()} onClick={run} className={`h-10 rounded-[6px] ${on ? "bg-accent-soft text-heading shadow-[inset_0_0_0_1.5px_color-mix(in_oklab,var(--color-accent)_35%,transparent)]" : "bg-sunken/80 text-ink hover:bg-accent-soft/70"} disabled:opacity-40 ${cls}`}>
              {label}
            </button>
          ))}
        </div>
      </section>

      <section>
        <h3 className="ui-caps mb-2 px-1">Groups</h3>
        <div className="grid grid-cols-2 gap-1.5" role="group" aria-label="Group">
          <button type="button" disabled={blockOff} aria-pressed={fmt.group !== "card"} onMouseDown={(e) => e.preventDefault()} onClick={() => setBlockFormat(editor, { group: null })} className={`flex h-11 items-center justify-center gap-2 rounded-[6px] text-[13.5px] disabled:opacity-40 ${fmt.group !== "card" ? "bg-accent-soft font-semibold text-heading" : "bg-sunken/80 text-ink hover:bg-accent-soft/70"}`}>
            <FileText size={15} aria-hidden /> Page
          </button>
          <button type="button" disabled={blockOff} aria-pressed={fmt.group === "card"} onMouseDown={(e) => e.preventDefault()} onClick={() => setBlockFormat(editor, { group: fmt.group === "card" ? null : "card" })} className={`flex h-11 items-center justify-center gap-2 rounded-[6px] text-[13.5px] disabled:opacity-40 ${fmt.group === "card" ? "bg-heading font-semibold text-canvas" : "bg-sunken/80 text-ink hover:bg-accent-soft/70"}`}>
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
            <button key={mark} type="button" aria-label={label} title={label} disabled={marksOff} aria-pressed={editor.isActive(mark)} onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().toggleMark(mark).run()} className={segBtn(editor.isActive(mark))}>
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
          <button type="button" disabled={blockOff} aria-pressed={fmt.decoration === "focus"} onMouseDown={(e) => e.preventDefault()} onClick={() => setBlockFormat(editor, { decoration: fmt.decoration === "focus" ? null : "focus" })} className={`flex h-10 items-center justify-center gap-2 rounded-[6px] text-[13.5px] disabled:opacity-40 ${fmt.decoration === "focus" ? "bg-accent-soft font-semibold text-heading shadow-[inset_0_0_0_1.5px_color-mix(in_oklab,var(--color-accent)_35%,transparent)]" : "bg-sunken/80 text-ink hover:bg-accent-soft/70"}`}>
            <span aria-hidden className="h-4 w-[3px] rounded-full bg-current" /> Focus
          </button>
          <button type="button" disabled={blockOff} aria-pressed={fmt.decoration === "block"} onMouseDown={(e) => e.preventDefault()} onClick={() => setBlockFormat(editor, { decoration: fmt.decoration === "block" ? null : "block" })} className={`h-10 rounded-[6px] text-[13.5px] disabled:opacity-40 ${fmt.decoration === "block" ? "bg-accent-soft font-semibold text-heading shadow-[inset_0_0_0_1.5px_color-mix(in_oklab,var(--color-accent)_35%,transparent)]" : "bg-sunken/80 text-ink hover:bg-accent-soft/70"}`}>
            <span className="rounded-[6px] bg-line/80 px-3 py-1">Block</span>
          </button>
        </div>
      </section>

      <section>
        <h3 className="ui-caps mb-2 px-1">Font</h3>
        <div className="ui-seg ui-well" role="group" aria-label="Block font">
          {(
            [
              ["system", "Aa", "System", "var(--font-sans)"],
              ["serif", "Ss", "Serif", "var(--font-serif)"],
              ["mono", "00", "Mono", "var(--font-mono)"],
              ["rounded", "Rr", "Rounded", "var(--font-rounded)"],
            ] as const
          ).map(([id, , name, family]) => {
            const on = fmt.font === id;
            return (
              <button key={id} type="button" aria-label={`Font: ${name}`} disabled={blockOff} aria-pressed={on} onMouseDown={(e) => e.preventDefault()} onClick={() => setBlockFormat(editor, { font: on ? null : id })} className="!flex-1 !px-1" style={{ fontFamily: family }}>
                <span aria-hidden>{name}</span>
              </button>
            );
          })}
        </div>
      </section>

      <details className="group rounded-[6px] bg-sunken/50 px-2.5 py-2">
        <summary className="cursor-pointer list-none text-[13px] font-medium text-ink marker:hidden">
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
          <Tile label="Underline" icon={<Underline size={16} />} disabled={marksOff} pressed={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleMark("underline").run()} />
          <Tile label="Highlight" icon={<Highlighter size={16} />} tone="marigold" disabled={marksOff} pressed={editor.isActive("highlight")} onClick={() => editor.chain().focus().toggleMark("highlight", { value: "yellow" }).run()} />
          <Tile label="Clear" icon={<Eraser size={16} />} disabled={marksOff} onClick={() => clearFormatting(editor)} />
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
              if (linkActive) removeLink(editor);
              return;
            }
            if (!applyLink(editor, href)) setLinkError("That doesn’t look like a web address.");
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
            placeholder={editor.state.selection.empty && !linkActive ? "Address to insert as a link" : "Paste or type a link"}
            aria-invalid={Boolean(linkError)}
            aria-describedby={`${linkId}-hint`}
            className="ui-input h-8 min-w-0 flex-1 rounded-[6px] px-3 text-sm disabled:opacity-50"
          />
          <Button size="sm" type="submit" disabled={marksOff || !href.trim()}>
            {linkActive ? "Update" : "Link"}
          </Button>
          {linkActive ? (
            <Button size="sm" variant="quiet" disabled={marksOff} onClick={() => removeLink(editor)}>
              Remove
            </Button>
          ) : null}
        </form>
        <p id={`${linkId}-hint`} className={`mt-1 px-1 text-xs ${linkError ? "text-danger" : "text-muted"}`} role={linkError ? "alert" : undefined}>
          {linkError ?? "Links the selected text. Shortcut: ⌘⇧K."}
        </p>
      </section>
      {/* Text colours and highlights come from the note's style (its own colours and names) when it has
          them; "Default" (the page's text colour / no highlight) is the starting choice. */}
      <section {...palette?.attrs}>
        <h3 className="ui-caps mb-2 px-1">Text color</h3>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Text color">
          <button type="button" disabled={marksOff} onMouseDown={(e) => e.preventDefault()} onClick={() => setTextColor(editor, null)} aria-pressed={!editor.isActive("textColor")} className={`ui-chip ui-raised text-ink disabled:opacity-40 ${!editor.isActive("textColor") ? "shadow-[inset_0_0_0_1.5px_var(--color-accent)]" : ""}`}>
            Default
          </button>
          {TEXT_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              disabled={marksOff}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setTextColor(editor, c)}
              aria-label={`Text color: ${colorName(palette, c)}`}
              aria-pressed={editor.isActive("textColor", { value: c })}
              title={colorName(palette, c)}
              className={`grid h-8 w-8 place-items-center rounded-[6px] ui-raised disabled:opacity-40 ${editor.isActive("textColor", { value: c }) ? "shadow-[inset_0_0_0_1.5px_var(--color-accent)]" : ""}`}
            >
              <span className={`fb-color-${c} text-sm font-semibold`} aria-hidden>
                A
              </span>
            </button>
          ))}
        </div>
      </section>
      <section {...palette?.attrs}>
        <h3 className="ui-caps mb-2 px-1">Highlight</h3>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Highlight">
          <button type="button" disabled={marksOff} onMouseDown={(e) => e.preventDefault()} onClick={() => setHighlight(editor, null)} aria-pressed={!editor.isActive("highlight")} className={`ui-chip ui-raised text-ink disabled:opacity-40 ${!editor.isActive("highlight") ? "shadow-[inset_0_0_0_1.5px_var(--color-accent)]" : ""}`}>
            Default
          </button>
          {HIGHLIGHT_COLORS.map((h) => (
            <button
              key={h}
              type="button"
              disabled={marksOff}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setHighlight(editor, h)}
              aria-label={`Highlight: ${colorName(palette, h)}`}
              aria-pressed={editor.isActive("highlight", { value: h })}
              title={colorName(palette, h)}
              className={`grid h-8 w-8 place-items-center rounded-[6px] ui-raised disabled:opacity-40 ${editor.isActive("highlight", { value: h }) ? "shadow-[inset_0_0_0_1.5px_var(--color-accent)]" : ""}`}
            >
              <span className={`fb-hl-${h} h-4 w-4 rounded-[4px]`} aria-hidden />
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
        <label className="block text-sm">
          <span className="ui-caps mb-1.5 block px-1">Language</span>
          <Select
            disabled={d}
            value={String(node?.attrs.language ?? "plaintext")}
            onChange={(e) => {
              const pos = editor.state.selection.$from.before(1);
              editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node!.attrs, language: e.target.value }));
            }}
            className="ui-input h-9 w-full rounded-[6px] px-3 text-sm"
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
      <p className="text-xs text-muted">Shortcuts: ⌘⌥0–3 headings, ⌘⇧7/8/9 lists and to-dos, Tab / ⇧Tab to nest, ⌥⇧↑↓ to move, ⌘⇧K link, ⌥F10 formatting toolbar, Esc then ⇧↑↓ to select blocks, ⌘. for block options.</p>
    </div>
  );
}
