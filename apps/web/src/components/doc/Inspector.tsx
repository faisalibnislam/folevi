"use client";

import type { Editor } from "@tiptap/react";
import { useConvex, useMutation, useQuery } from "convex/react";
import { useEffect, useId, useRef, useState } from "react";
import type { FunctionReturnType } from "convex/server";
import {
  Bold,
  CalendarDays,
  Eraser,
  FileText,
  Highlighter,
  Pencil,
  Code2,
  History,
  Italic,
  List,
  ListOrdered,
  Quote,
  Strikethrough,
  Underline,
  UserRound,
  Equal,
  Grip,
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  IndentDecrease,
  IndentIncrease,
  PanelTop,
  Play,
  SquareCheck,
  X,
  StickyNote,
  ChevronRight,
  ImagePlus,
  Loader2,
} from "lucide-react";
import type { DocumentStyle } from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { documentScope } from "@/lib/app/scope";
import { IconButton, Button } from "@/components/ui/Button";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { formatDateTime, formatRelative } from "@/lib/format";
import type { MenuItem } from "@/components/ui/Menu";
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
import { COVER_ART, COVER_IMAGE_HINT, COVER_IMAGE_PLACEHOLDER, coverArtOf, coverArtThumbUrl, pageBackdrop, styleColorsOf } from "@/lib/cover";
import { COVER_IMAGE_ACCEPT, coverImageProblem, uploadCoverImage, useCoverImage } from "@/lib/app/coverImage";

/** The Plain note style: a very light grey page background. */
const PLAIN_CSS = "#F1F1F3";
import { CommentsOverview, type CommentThread } from "./Comments";
import { MovePageDialog } from "./MovePageDialog";
import { InsertPanel } from "./InsertPanel";
import { BlurredBackdrop } from "./BlurredBackdrop";
import { AiPanel } from "@/components/ai/AiPanel";
import { useAiEnabled, type AiRunDetail } from "@/components/ai/useAi";
import { Select } from "@/components/ui/Select";
import { Switch } from "@/components/ui/Switch";
import { colorName, useNotePalette } from "@/components/editor/notePalette";

// The page outline lives in the document sidebar (Table of contents); comments open from the top bar.
export type InspectorTab = "ai" | "insert" | "format" | "style" | "info" | "comments";
type Meta = FunctionReturnType<typeof api.documents.get>;

const TABS: { id: Exclude<InspectorTab, "comments">; label: string }[] = [
  { id: "ai", label: "AI" },
  { id: "insert", label: "Insert" },
  { id: "format", label: "Format" },
  { id: "style", label: "Style" },
  { id: "info", label: "Info" },
];

export function Inspector({
  documentId,
  editor,
  meta,
  tab,
  onTab,
  onOpenThread,
  focusThreadId = null,
  onClose,
  onHistory,
  actions,
  readOnly,
  hideTabs,
  aiRun = null,
  onAiTitle,
}: {
  documentId: string;
  editor: Editor | null;
  meta: Meta | null;
  tab: InspectorTab;
  onTab: (t: InspectorTab) => void;
  /** A thread chosen in the Comments overview (on a block: jump there and open it). */
  onOpenThread: (thread: CommentThread) => void;
  /** A thread to open inside the overview (on the whole note or a deleted block), e.g. from a link. */
  focusThreadId?: string | null;
  onClose: () => void;
  onHistory: () => void;
  /** The page's actions (same as the "…" menu), listed under Info → Actions. */
  actions: (MenuItem | "separator")[];
  readOnly: boolean;
  /** Floating panel opened from the icon rail: the rail picks the tab, so only its name is shown. */
  hideTabs?: boolean;
  /** A rewrite of the selected text, requested from the editor's toolbar (AI tab). */
  aiRun?: (AiRunDetail & { id: number }) | null;
  /** The AI's suggested title was accepted. */
  onAiTitle?: (title: string) => void;
}) {
  const baseId = useId();
  const aiOn = useAiEnabled(meta?.document);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [lastTab, setLastTab] = useState<Exclude<InspectorTab, "comments">>("format");
  useEffect(() => {
    if (tab !== "comments") setLastTab(tab);
  }, [tab]);
  return (
    <div className="flex h-full flex-col">
      <div className="flex-none px-3 pt-2.5">
        {hideTabs && tab !== "comments" ? (
          <div className="flex h-9 items-center gap-1 px-1">
            <h2 id={`${baseId}-tab-${tab}`} className="ui-display flex-1 text-[18px]">
              {TABS.find((t) => t.id === tab)?.label}
            </h2>
            <IconButton label="Close inspector" onClick={onClose} className="!h-7 !w-7">
              <X size={15} aria-hidden />
            </IconButton>
          </div>
        ) : tab === "comments" ? (
          <div className="flex h-9 items-center gap-1">
            <button type="button" onClick={() => onTab(lastTab)} className="inline-flex items-center gap-1 rounded-[6px] px-2 py-1 text-[13px] text-muted hover:bg-accent-soft hover:text-heading">
              <ChevronRight size={14} className="rotate-180" aria-hidden /> {TABS.find((t) => t.id === lastTab)?.label}
            </button>
            <h2 id={`${baseId}-tab-comments`} className="flex-1 text-center text-[13.5px] font-semibold text-heading">
              Comments
            </h2>
            <IconButton label="Close inspector" onClick={onClose} className="!h-7 !w-7">
              <X size={15} aria-hidden />
            </IconButton>
          </div>
        ) : (
        <div className="flex h-9 items-center gap-1 border-b border-line/70">
        <div role="tablist" aria-label="Inspector" className="flex flex-1 items-center gap-0.5">
          {TABS.filter((t) => aiOn || t.id !== "ai").map((t, i) => (
            <button
              key={t.id}
              ref={(el) => {
                tabRefs.current[i] = el;
              }}
              role="tab"
              type="button"
              id={`${baseId}-tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls={`${baseId}-panel`}
              tabIndex={tab === t.id ? 0 : -1}
              onClick={() => onTab(t.id)}
              onKeyDown={(e) => {
                const dir = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
                if (!dir) return;
                e.preventDefault();
                const next = (i + dir + TABS.length) % TABS.length;
                onTab(TABS[next]!.id);
                tabRefs.current[next]?.focus();
              }}
              className={`relative h-9 rounded-[6px] px-2 text-[13px] transition-colors hover:text-heading ${tab === t.id ? "font-semibold text-heading" : "text-muted"}`}
            >
              {t.label}
              {tab === t.id ? <span aria-hidden className="absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-heading" /> : null}
            </button>
          ))}
        </div>
          <IconButton label="Close inspector" onClick={onClose} className="!h-7 !w-7">
            <X size={15} aria-hidden />
          </IconButton>
        </div>
        )}
      </div>
      <div id={`${baseId}-panel`} role={tab === "comments" || hideTabs ? "region" : "tabpanel"} aria-labelledby={`${baseId}-tab-${tab}`} className="relative min-h-0 flex-1 overflow-y-auto px-3 pb-4 pt-3">
        {tab === "ai" && aiOn ? <AiPanel documentId={documentId} editor={editor} readOnly={readOnly} run={aiRun} onTitle={(t) => onAiTitle?.(t)} /> : null}
        {tab === "insert" ? <InsertPanel editor={editor} disabled={readOnly} /> : null}
        {tab === "format" ? <FormatPanel editor={editor} disabled={readOnly} /> : null}
        {tab === "style" ? <StylePanel documentId={documentId} meta={meta} disabled={readOnly} /> : null}
        {tab === "info" ? <InfoPanel documentId={documentId} meta={meta} onHistory={onHistory} actions={actions} disabled={readOnly} /> : null}
        {tab === "comments" ? <CommentsOverview documentId={documentId} onOpenThread={onOpenThread} focusThreadId={focusThreadId} /> : null}
      </div>
    </div>
  );
}

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

function FormatPanel({ editor, disabled }: { editor: Editor | null; disabled: boolean }) {
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

const SHEETS: { id: NonNullable<DocumentStyle["sheet"]>; name: string; color: string }[] = [
  { id: "white", name: "White", color: "#ffffff" },
  { id: "paper", name: "Paper", color: "#fbf8f2" },
  { id: "ivory", name: "Ivory", color: "#f4ecdb" },
  { id: "mist", name: "Mist", color: "#edf1f6" },
  { id: "sage", name: "Sage", color: "#ecf2ea" },
  { id: "blush", name: "Blush", color: "#f8ecec" },
  { id: "night", name: "Night", color: "#161618" },
];
const TEXTS: { id: NonNullable<DocumentStyle["text"]>; name: string; color: string }[] = [
  { id: "ink", name: "Ink", color: "#1c1c1f" },
  { id: "slate", name: "Slate", color: "#3a4758" },
  { id: "navy", name: "Navy", color: "#23406f" },
  { id: "forest", name: "Forest", color: "#25543a" },
  { id: "plum", name: "Plum", color: "#5a2d66" },
  { id: "brown", name: "Brown", color: "#5b3b23" },
  { id: "white", name: "White", color: "#f2f2f4" },
];
const FONTS: { id: DocumentStyle["font"]; glyph: string; name: string; family: string }[] = [
  { id: "sans", glyph: "Aa", name: "System", family: "var(--font-sans)" },
  { id: "serif", glyph: "Ss", name: "Serif", family: "var(--font-serif)" },
  { id: "mono", glyph: "00", name: "Mono", family: "var(--font-mono)" },
  { id: "rounded", glyph: "Rr", name: "Rounded", family: 'ui-rounded, "SF Pro Rounded", "Nunito", var(--font-sans)' },
];
const SEPARATORS: { id: NonNullable<DocumentStyle["separator"]>; name: string; icon: React.ReactNode }[] = [
  { id: "line", name: "Line", icon: <Equal size={15} /> },
  { id: "dots", name: "Dots", icon: <Grip size={15} /> },
  { id: "doodle", name: "Doodle", icon: <Squiggle /> },
];

function Squiggle() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
      <path d="M1 9 Q4 3 7 8 T13 7 T15 6" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

/** Drops undefined keys (Convex values can't carry undefined). */
function cleanStyle(style: DocumentStyle): DocumentStyle {
  return Object.fromEntries(Object.entries(style).filter(([, v]) => v !== undefined)) as DocumentStyle;
}

function StyleRow({ label, swatch, open, onToggle, children, disabled }: { label: string; swatch: React.ReactNode; open: boolean; onToggle: () => void; children: React.ReactNode; disabled: boolean }) {
  const id = useId();
  return (
    <div>
      <button
        type="button"
        disabled={disabled}
        aria-expanded={open}
        aria-controls={id}
        onClick={onToggle}
        className="flex h-10 w-full items-center justify-between rounded-[6px] px-1 text-left text-[13.5px] text-ink transition-colors hover:bg-accent-soft/60 disabled:opacity-50"
      >
        {label}
        <span className="flex items-center gap-2">{swatch}</span>
      </button>
      {open ? (
        <div id={id} className="mb-2 mt-1 rounded-[6px] bg-sunken/70 p-2.5">
          {children}
        </div>
      ) : null}
    </div>
  );
}

function ColorDot({ css, ring }: { css: string; ring?: boolean }) {
  return <span aria-hidden className={`inline-block h-7 w-9 rounded-[6px] shadow-[inset_0_0_0_1px_rgb(0_0_0/0.08)] ${ring ? "ring-2 ring-heading ring-offset-2 ring-offset-[var(--color-surface)]" : ""}`} style={{ background: css }} />;
}

function Choice({ label, on, onPick, children, wide }: { label: string; on: boolean; onPick: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      aria-label={label}
      title={label}
      onClick={onPick}
      className={`relative overflow-hidden rounded-[6px] transition-transform hover:-translate-y-px ${wide ? "h-12" : "h-9"} ${on ? "ring-2 ring-heading ring-offset-2 ring-offset-[var(--color-surface)]" : "shadow-[var(--shadow-hairline)]"}`}
    >
      {children}
    </button>
  );
}

function StylePanel({ documentId, meta, disabled }: { documentId: string; meta: Meta | null; disabled: boolean }) {
  const { engine } = useAppState();
  const client = useConvex();
  const toast = useToast();
  const [open, setOpen] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const { url: imageUrl, palette } = useCoverImage(meta?.document.cover);
  if (!meta) return <p className="text-sm text-muted">Style is available once the document has synced.</p>;
  const style = meta.document.style;
  const cover = meta.document.cover;
  const rev = meta.document.revision;
  const set = (patch: Partial<DocumentStyle>) => engine?.updateDocument(documentId, { style: cleanStyle({ ...style, ...patch }) }, rev);
  // Choosing a cover also sets the page's backdrop: it goes back to following the cover.
  const setCover = (next: typeof cover) => engine?.updateDocument(documentId, { cover: next, style: cleanStyle({ ...style, backdrop: undefined }) }, rev);
  const toggle = (key: string) => setOpen(open === key ? null : key);
  // The note's style is named after its artwork ("Your image" for an uploaded one, "Plain" when it has none).
  const art = coverArtOf(cover);
  const ownImage = cover.kind === "image" && Boolean(cover.value);
  const imageCss = imageUrl ? `url(${JSON.stringify(imageUrl)}) center / cover no-repeat` : COVER_IMAGE_PLACEHOLDER;
  const styleName = art?.name ?? (ownImage ? "Your image" : "Plain");
  const noBackdrop = "linear-gradient(180deg, var(--color-surface-sunken), var(--color-canvas))";
  const hasBackdrop = Boolean(pageBackdrop(style, cover, imageUrl));
  const backdropCss = pageBackdrop(style, cover, imageUrl) ?? noBackdrop;
  // Your own image: checked here, uploaded into this note (online only), then used as its style.
  const uploadImage = async (file: File) => {
    const problem = coverImageProblem(file);
    if (problem) return toast.show(problem, { tone: "error" });
    if (typeof navigator !== "undefined" && !navigator.onLine) return toast.show("Connect to the internet to upload an image.", { tone: "error" });
    setUploading(true);
    try {
      const fileId = await uploadCoverImage(client, { documentId, file });
      setCover({ kind: "image", value: fileId });
    } catch (e) {
      toast.show(errorMessage(e), { tone: "error" });
    } finally {
      setUploading(false);
    }
  };
  // Auto: the page and text colours come from the note style (its artwork, or picked from your image).
  const auto = styleColorsOf(cover, palette);
  const sheetColor = SHEETS.find((s) => s.id === style.sheet)?.color ?? auto?.paper ?? "var(--color-surface)";
  const textColor = TEXTS.find((t) => t.id === style.text)?.color ?? auto?.ink ?? "var(--color-ink)";
  const font = FONTS.find((f) => f.id === style.font) ?? FONTS[0]!;

  return (
    <div className="space-y-5 text-sm">
      <section aria-label="Page style">
        <div aria-hidden className="relative block h-32 w-full overflow-hidden rounded-[6px] shadow-[var(--shadow-card)]" style={{ background: style.blur && hasBackdrop ? undefined : backdropCss }}>
          {style.blur && hasBackdrop ? <BlurredBackdrop background={backdropCss} /> : null}
          <span className="absolute bottom-0 left-1/2 top-3 w-[38%] -translate-x-1/2 rounded-t-[6px] px-2 pt-2 text-left shadow-[0_6px_18px_-6px_rgb(0_0_0/0.35)]" style={{ background: sheetColor, color: textColor, fontFamily: font.family }}>
            <span className="block text-[10.5px] font-semibold leading-tight">{styleName}</span>
            <span className="mt-1.5 block h-1 w-4/5 rounded-full opacity-25" style={{ background: textColor }} />
            <span className="mt-1 block h-1 w-3/5 rounded-full opacity-25" style={{ background: textColor }} />
          </span>
        </div>
      </section>

      <fieldset disabled={disabled}>
        <legend className="ui-caps mb-1 px-1">Note Style</legend>
        {/* One choice: the artwork is the note's cover and its page background. */}
        <StyleRow
          label={styleName}
          swatch={<ColorDot css={art ? `url(${coverArtThumbUrl(art.id)}) center / cover no-repeat` : ownImage ? imageCss : PLAIN_CSS} />}
          open={open === "artwork"}
          onToggle={() => toggle("artwork")}
          disabled={disabled}
        >
          <div role="radiogroup" aria-label="Note style" className="grid grid-cols-4 gap-2">
            <Choice label="Plain" on={cover.kind !== "art" && !ownImage} onPick={() => setCover({ kind: "none" })}>
              <span className="grid h-full place-items-center text-[11px] text-muted" style={{ background: PLAIN_CSS }}>Plain</span>
            </Choice>
            {ownImage ? (
              <Choice label="Note style: Your image" on onPick={() => undefined}>
                <span aria-hidden className="block h-full w-full" style={{ background: imageCss }} />
              </Choice>
            ) : null}
            {COVER_ART.map((a) => (
              <Choice key={a.id} label={`Note style: ${a.name}`} on={art?.id === a.id} onPick={() => setCover({ kind: "art", value: a.id })}>
                <span aria-hidden className="block h-full w-full" style={{ background: `url(${coverArtThumbUrl(a.id)}) center / cover no-repeat` }} />
              </Choice>
            ))}
          </div>
          <input
            ref={fileInput}
            type="file"
            name="note-style-image"
            accept={COVER_IMAGE_ACCEPT}
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void uploadImage(file);
            }}
          />
          <button
            type="button"
            disabled={disabled || uploading}
            aria-busy={uploading || undefined}
            onClick={() => fileInput.current?.click()}
            className="mt-2.5 flex h-9 w-full items-center justify-center gap-2 rounded-[6px] border border-dashed border-[color-mix(in_oklab,var(--color-ink)_22%,transparent)] text-[13px] font-medium text-heading transition-colors hover:bg-accent-soft/60 disabled:opacity-60"
          >
            {uploading ? <Loader2 size={15} aria-hidden className="animate-spin" /> : <ImagePlus size={15} aria-hidden />}
            {uploading ? "Uploading…" : ownImage ? "Replace your image…" : "Upload your own image…"}
          </button>
          <p className="mt-1.5 px-0.5 text-[11.5px] text-faint">{COVER_IMAGE_HINT}</p>
          <p className="mt-2 px-0.5 text-xs text-muted">
            {art
              ? `${art.name}: the cover and page background. Auto colours come from it.`
              : ownImage
                ? "Your image: the cover and page background. Auto colours are picked from it."
                : "Plain: a very light grey page background, no cover."}
          </p>
        </StyleRow>
        {hasBackdrop ? (
          <div className="flex items-center justify-between gap-3 px-1 pt-2">
            <span aria-hidden className="text-[13px] text-heading">
              Blur background
            </span>
            <Switch checked={Boolean(style.blur)} label="Blur background" disabled={disabled} onChange={(on) => set({ blur: on || undefined })} />
          </div>
        ) : null}
      </fieldset>

      <fieldset disabled={disabled}>
        <legend className="ui-caps mb-1 px-1">Color</legend>
        <StyleRow label="Document color" swatch={<ColorDot css={sheetColor} />} open={open === "sheet"} onToggle={() => toggle("sheet")} disabled={disabled}>
          <div role="radiogroup" aria-label="Document color" className="grid grid-cols-4 gap-2">
            <Choice label="Auto (from the note style)" on={!style.sheet} onPick={() => set({ sheet: undefined })}>
              <span className="grid h-full place-items-center text-[11px] text-muted" style={{ background: auto?.paper ?? "var(--color-surface)" }}>Auto</span>
            </Choice>
            {SHEETS.map((s) => (
              <Choice key={s.id} label={`Document color: ${s.name}`} on={style.sheet === s.id} onPick={() => set({ sheet: s.id, ...(s.id === "night" && (!style.text || style.text === "ink") ? { text: "white" as const } : {}), ...(s.id !== "night" && style.text === "white" ? { text: "ink" as const } : {}) })}>
                <span aria-hidden className="block h-full w-full" style={{ background: s.color }} />
              </Choice>
            ))}
          </div>
        </StyleRow>
        <StyleRow label="Text color" swatch={<ColorDot css={textColor} />} open={open === "text"} onToggle={() => toggle("text")} disabled={disabled}>
          <div role="radiogroup" aria-label="Text color" className="grid grid-cols-4 gap-2">
            <Choice label="Auto (from the note style)" on={!style.text} onPick={() => set({ text: undefined })}>
              <span className="grid h-full place-items-center text-[11px] font-semibold" style={{ background: auto?.paper ?? "var(--color-surface)", color: auto?.ink ?? "var(--color-ink)" }}>Auto</span>
            </Choice>
            {TEXTS.map((t) => (
              <Choice key={t.id} label={`Text color: ${t.name}`} on={style.text === t.id} onPick={() => set({ text: t.id })}>
                <span aria-hidden className="grid h-full w-full place-items-center text-[15px] font-semibold" style={{ background: t.id === "white" ? "#1c1c1f" : "#fff", color: t.color }}>
                  A
                </span>
              </Choice>
            ))}
          </div>
        </StyleRow>
      </fieldset>


      <fieldset disabled={disabled}>
        <legend className="ui-caps mb-2 px-1">Separator style</legend>
        <div className="ui-seg ui-well">
          {SEPARATORS.map((s) => {
            const on = (style.separator ?? "line") === s.id;
            return (
              <button key={s.id} type="button" aria-pressed={on} aria-label={`Separator: ${s.name}`} onClick={() => set({ separator: s.id === "line" ? undefined : s.id })} className="!flex-1 gap-1.5">
                <span aria-hidden>{s.icon}</span>
                <span aria-hidden>{s.name}</span>
              </button>
            );
          })}
        </div>
      </fieldset>

      <fieldset disabled={disabled}>
        <legend className="ui-caps mb-2 px-1">Font</legend>
        <div className="ui-seg ui-well">
          {FONTS.map((f) => {
            const on = style.font === f.id;
            return (
              <button key={f.id} type="button" aria-pressed={on} aria-label={`Font: ${f.name}`} onClick={() => set({ font: f.id })} className="!flex-1 !px-1" style={{ fontFamily: f.family }}>
                <span aria-hidden>{f.name}</span>
              </button>
            );
          })}
        </div>
      </fieldset>

      <fieldset disabled={disabled}>
        <legend className="ui-caps mb-2 px-1">Page width</legend>
        <div className="ui-seg ui-well" role="group" aria-label="Page width">
          {(
            [
              ["default", "Narrow"],
              ["wide", "Wide"],
            ] as const
          ).map(([w, name]) => {
            const on = w === "wide" ? style.width === "wide" : style.width !== "wide";
            return (
              <button key={w} type="button" aria-pressed={on} onClick={() => set({ width: w })} className="!flex-1">
                {name}
              </button>
            );
          })}
        </div>
      </fieldset>
    </div>
  );
}

function InfoPanel({ documentId, meta, onHistory, actions, disabled }: { documentId: string; meta: Meta | null; onHistory: () => void; actions: (MenuItem | "separator")[]; disabled: boolean }) {
  const [view, setView] = useState<"page" | "actions">("page");
  return (
    <div className="space-y-4">
      <div role="group" aria-label="Info view" className="ui-seg ui-well">
        <button type="button" aria-pressed={view === "page"} onClick={() => setView("page")}>
          Page info
        </button>
        <button type="button" aria-pressed={view === "actions"} onClick={() => setView("actions")}>
          Actions
        </button>
      </div>
      {view === "page" ? <PageInfo documentId={documentId} meta={meta} onHistory={onHistory} disabled={disabled} /> : <ActionList actions={actions} />}
    </div>
  );
}

function ActionList({ actions }: { actions: (MenuItem | "separator")[] }) {
  return (
    <ul className="space-y-1.5" aria-label="Page actions">
      {actions.map((a, i) =>
        a === "separator" ? (
          <li key={`sep-${i}`} aria-hidden className="!my-3 h-px bg-line/70" />
        ) : (
          <li key={a.label}>
            <button
              type="button"
              disabled={a.disabled}
              onClick={a.onSelect}
              className={`flex h-9 w-full items-center gap-2.5 rounded-[6px] px-3 text-left text-[13px] font-medium transition-colors disabled:opacity-40 ${a.danger ? "bg-coral-soft/60 text-coral-ink hover:bg-coral-soft" : "bg-sunken/70 text-ink hover:bg-accent-soft hover:text-heading"}`}
            >
              <span aria-hidden className={a.danger ? "text-coral-ink" : "text-muted"}>
                {a.icon}
              </span>
              {a.label}
            </button>
          </li>
        ),
      )}
    </ul>
  );
}

function PageInfo({ documentId, meta, onHistory, disabled }: { documentId: string; meta: Meta | null; onHistory: () => void; disabled: boolean }) {
  const info = useQuery(api.documents.info, meta ? { documentId } : "skip");
  // Tags come from the note's own scope (it may be open from another context than the current one).
  const home = meta?.isMember ? documentScope(meta.document) : null;
  const org = useQuery(api.organization.sidebar, home ? { scope: home } : "skip");
  const setTags = useMutation(api.organization.setDocumentTags);
  const createTag = useMutation(api.organization.createTag);
  const move = useMutation(api.documents.move);
  const toast = useToast();
  const [newTag, setNewTag] = useState("");
  const [moveOpen, setMoveOpen] = useState(false);
  if (!meta) return <p className="text-sm text-muted">Details appear once the document has synced.</p>;
  const tags = meta.document.tags;
  const parent = meta.breadcrumbs[meta.breadcrumbs.length - 1] ?? null;
  return (
    <div className="space-y-5 text-sm">
      <section>
        <h3 className="ui-caps mb-2 px-1">Properties</h3>
        <dl className="space-y-1.5 px-1">
          <div className="flex items-center gap-2">
            <CalendarDays size={14} className="flex-none text-faint" aria-hidden />
            <dt className="text-muted">Created:</dt>
            <dd className="min-w-0 truncate" title={info ? formatDateTime(info.createdAt) : undefined}>{info ? formatRelative(info.createdAt) : "-"}</dd>
          </div>
          <div className="flex items-center gap-2">
            <Pencil size={14} className="flex-none text-faint" aria-hidden />
            <dt className="text-muted">Updated:</dt>
            <dd className="min-w-0 truncate">{info ? `${formatRelative(info.updatedAt)} by ${info.lastEditedBy}` : "-"}</dd>
          </div>
          <div className="flex items-center gap-2">
            <UserRound size={14} className="flex-none text-faint" aria-hidden />
            <dt className="text-muted">Author:</dt>
            <dd className="min-w-0 truncate">{info?.createdBy ?? "-"}</dd>
          </div>
        </dl>
      </section>
      <section>
        <h3 className="ui-caps mb-2 px-1">Stats · full document</h3>
        <dl className="grid grid-cols-3 gap-2">
          {[
            ["Words", info?.wordCount.toLocaleString(), "Words in the page body (the title isn’t counted)"],
            ["Characters", info?.charCount.toLocaleString(), undefined],
            ["Blocks", info?.blockCount?.toLocaleString(), undefined],
          ].map(([label, value, title]) => (
            <div key={label} className="rounded-[6px] bg-sunken/70 px-2.5 py-2" title={title}>
              <dt className="text-[11px] text-muted">{label}</dt>
              <dd className="text-[15px] font-semibold tabular-nums text-heading">{value ?? "-"}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section>
        <h3 className="ui-caps mb-2 px-1">Location</h3>
        <Select
          disabled={disabled}
          value={meta.folder?.id ?? ""}
          onChange={(e) => void move({ documentId, folderId: e.target.value || null }).catch((err) => toast.show(errorMessage(err), { tone: "error" }))}
          className="ui-input h-9 w-full rounded-[6px] px-3 text-sm"
          aria-label="Folder"
        >
          <option value="">Drafts</option>
          {org?.folders.map((f) => (
            <option key={f.id} value={f.id}>
              {f.parentFolderId ? "- " : ""}
              {f.name}
            </option>
          ))}
        </Select>
      </section>
      <section>
        <h3 className="sr-only">Parent page</h3>
        <div className="flex items-center gap-2">
          <p className="min-w-0 flex-1 truncate px-1">
            {parent ? (
              <>
                <FileText size={13} aria-hidden className="mr-1 inline align-[-2px] text-muted" />
                {parent.title || "Untitled"}
              </>
            ) : (
              <span className="text-muted">None (top level)</span>
            )}
          </p>
          {!disabled ? (
            <Button size="sm" onClick={() => setMoveOpen(true)}>
              Move…
            </Button>
          ) : null}
        </div>
        <MovePageDialog open={moveOpen} onClose={() => setMoveOpen(false)} documentId={documentId} title={meta.document.title} currentParentId={parent?.id ?? null} home={home} />
      </section>
      <section>
        <h3 className="ui-caps mb-2 px-1">Tags</h3>
        <div className="flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <span key={t.id} className="ui-chip bg-accent-soft text-accent-soft-ink">
              #{t.name}
              {!disabled ? (
                <button
                  type="button"
                  aria-label={`Remove tag ${t.name}`}
                  onClick={() => void setTags({ documentId, tagIds: tags.filter((x) => x.id !== t.id).map((x) => x.id) }).catch((err) => toast.show(errorMessage(err), { tone: "error" }))}
                  className="text-faint hover:text-ink"
                >
                  <X size={11} aria-hidden />
                </button>
              ) : null}
            </span>
          ))}
        </div>
        {!disabled ? (
          <form
            className="mt-2 flex gap-1.5"
            onSubmit={async (e) => {
              e.preventDefault();
              const name = newTag.trim().replace(/^#/, "");
              if (!name) return;
              try {
                const existing = org?.tags.find((t) => t.name.toLowerCase() === name.toLowerCase());
                const id = existing?.id ?? (await createTag({ scope: home ?? documentScope(meta.document), name })).id;
                await setTags({ documentId, tagIds: [...new Set([...tags.map((t) => t.id), id])] });
                setNewTag("");
              } catch (err) {
                toast.show(errorMessage(err), { tone: "error" });
              }
            }}
          >
            <input list="tag-suggestions" value={newTag} onChange={(e) => setNewTag(e.target.value)} placeholder="Add a tag" aria-label="Add a tag" className="ui-input h-8 flex-1 rounded-[6px] px-3 text-sm" />
            <datalist id="tag-suggestions">
              {org?.tags.map((t) => (
                <option key={t.id} value={t.name} />
              ))}
            </datalist>
            <Button size="sm" type="submit">
              Add
            </Button>
          </form>
        ) : null}
      </section>
      <section>
        <h3 className="ui-caps mb-2 flex items-center justify-between px-1">
          Activity
          <button type="button" onClick={onHistory} className="inline-flex items-center gap-1 rounded-[6px] px-2 py-0.5 normal-case tracking-normal text-heading hover:bg-accent-soft">
            <History size={12} aria-hidden /> Version history
          </button>
        </h3>
        <ul className="space-y-1.5">
          {info?.activity.length === 0 ? <li className="text-muted">Versions are saved after a pause in editing.</li> : null}
          {info?.activity.map((a, i) => (
            <li key={i} className="text-muted">
              <span className="text-ink">{a.by}</span> · {a.reason === "idle" ? "saved a version" : a.reason === "before_restore" ? "restored an earlier version" : a.reason === "close" ? "saved on close" : "saved a version"} · {formatRelative(a.at)}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
