"use client";

import type { Editor } from "@tiptap/react";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useId, useRef, useState } from "react";
import type { FunctionReturnType } from "convex/server";
import {
  Bold,
  CheckSquare,
  Code2,
  Heading1,
  Heading2,
  Heading3,
  History,
  Info,
  Italic,
  List,
  ListOrdered,
  ListTree,
  MessageSquare,
  Minus,
  Palette,
  Plus,
  Quote,
  Search,
  Strikethrough,
  Table2,
  Text,
  Type,
  Underline,
  X,
  StickyNote,
  ChevronRight,
} from "lucide-react";
import { DocumentAccentValues, DocumentBackgroundValues, DocumentFontValues, DocumentWidthValues, CardStyleValues, type DocumentStyle } from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { IconButton, Button } from "@/components/ui/Button";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { formatDateTime, formatRelative } from "@/lib/format";
import { insertBlockAfterCurrent, insertBlockAt, turnInto } from "@/components/editor/commands";
import { beginPointerDrag } from "@/components/editor/blockDrag";
import { Outline } from "./Outline";

export type InspectorTab = "insert" | "format" | "style" | "outline" | "info" | "comments";
type Meta = FunctionReturnType<typeof api.documents.get>;

const TABS: { id: InspectorTab; label: string; icon: React.ReactNode }[] = [
  { id: "insert", label: "Insert", icon: <Plus size={15} strokeWidth={2.2} /> },
  { id: "format", label: "Format", icon: <Type size={15} /> },
  { id: "style", label: "Style", icon: <Palette size={15} /> },
  { id: "outline", label: "Outline", icon: <ListTree size={15} /> },
  { id: "info", label: "Info", icon: <Info size={15} /> },
  { id: "comments", label: "Comments", icon: <MessageSquare size={15} /> },
];

export function Inspector({
  documentId,
  editor,
  meta,
  tab,
  onTab,
  commentBlock,
  onClearCommentBlock,
  onJumpToBlock,
  onClose,
  onHistory,
  readOnly,
}: {
  documentId: string;
  editor: Editor | null;
  meta: Meta | null;
  tab: InspectorTab;
  onTab: (t: InspectorTab) => void;
  commentBlock: string | null;
  onClearCommentBlock: () => void;
  onJumpToBlock: (id: string) => void;
  onClose: () => void;
  onHistory: () => void;
  readOnly: boolean;
}) {
  const baseId = useId();
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const current = TABS.find((t) => t.id === tab) ?? TABS[0]!;
  return (
    <div className="flex h-full flex-col">
      <div className="flex-none px-3 pt-3">
        <div role="tablist" aria-label="Inspector" className="ui-seg ui-well">
          {TABS.map((t, i) => (
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
              aria-label={t.label}
              title={t.label}
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
              className="!min-h-8 !px-0"
            >
              <span aria-hidden>{t.icon}</span>
            </button>
          ))}
        </div>
        <div className="mt-3 flex items-center justify-between px-1">
          <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-heading">{current.label}</h2>
          <IconButton label="Close inspector" onClick={onClose} className="!h-7 !w-7">
            <X size={15} aria-hidden />
          </IconButton>
        </div>
      </div>
      <div id={`${baseId}-panel`} role="tabpanel" aria-labelledby={`${baseId}-tab-${tab}`} className="min-h-0 flex-1 overflow-y-auto px-3 pb-4 pt-2">
        {tab === "insert" ? <InsertPanel editor={editor} disabled={readOnly} /> : null}
        {tab === "format" ? <FormatPanel editor={editor} disabled={readOnly} /> : null}
        {tab === "style" ? <StylePanel documentId={documentId} meta={meta} disabled={readOnly} /> : null}
        {tab === "outline" ? <Outline documentId={documentId} onJump={onJumpToBlock} variant="panel" /> : null}
        {tab === "info" ? <InfoPanel documentId={documentId} meta={meta} onHistory={onHistory} disabled={readOnly} /> : null}
        {tab === "comments" ? <CommentsPanel documentId={documentId} blockId={commentBlock} onClearBlock={onClearCommentBlock} onJumpToBlock={onJumpToBlock} /> : null}
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
      className={`group flex flex-col items-center gap-1.5 rounded-[14px] px-1 py-2.5 text-[11.5px] font-medium transition-[box-shadow,transform,background-color] duration-150 disabled:opacity-40 ${
        pressed ? "bg-accent-soft text-heading shadow-[inset_0_0_0_1.5px_color-mix(in_oklab,var(--color-accent)_45%,transparent)]" : "ui-raised text-ink hover:-translate-y-px hover:shadow-[var(--shadow-card)]"
      }`}
    >
      <span aria-hidden className={`grid h-7 w-7 place-items-center rounded-[9px] ${TONES[tone] ?? TONES.ink}`}>
        {icon}
      </span>
      {label}
    </button>
  );
}

const TONES: Record<string, string> = {
  ink: "bg-sunken text-heading",
  ember: "bg-ember-soft text-ember-ink",
  moss: "bg-moss-soft text-moss-ink",
  plum: "bg-plum-soft text-plum-ink",
  marigold: "bg-marigold-soft text-marigold-ink",
  coral: "bg-coral-soft text-coral-ink",
};

type InsertItem = { label: string; type: string; attrs?: Record<string, unknown>; icon: React.ReactNode; tone: string; keywords?: string };
const INSERT_SECTIONS: { title: string; items: InsertItem[] }[] = [
  {
    title: "Basics",
    items: [
      { label: "Text", type: "paragraph", icon: <Text size={16} />, tone: "ink", keywords: "paragraph" },
      { label: "Heading 1", type: "heading", attrs: { level: 1 }, icon: <Heading1 size={16} />, tone: "ember", keywords: "title h1" },
      { label: "Heading 2", type: "heading", attrs: { level: 2 }, icon: <Heading2 size={16} />, tone: "ember", keywords: "h2" },
      { label: "Heading 3", type: "heading", attrs: { level: 3 }, icon: <Heading3 size={16} />, tone: "ember", keywords: "h3" },
    ],
  },
  {
    title: "Lists",
    items: [
      { label: "To-do", type: "todo", attrs: { checked: false }, icon: <CheckSquare size={16} />, tone: "moss", keywords: "task checkbox" },
      { label: "Bullets", type: "bulleted", icon: <List size={16} />, tone: "moss", keywords: "bulleted list" },
      { label: "Numbers", type: "numbered", icon: <ListOrdered size={16} />, tone: "moss", keywords: "numbered list" },
      { label: "Toggle", type: "toggle", attrs: { collapsed: false }, icon: <ChevronRight size={16} />, tone: "moss", keywords: "collapse" },
    ],
  },
  {
    title: "Blocks",
    items: [
      { label: "Quote", type: "quote", icon: <Quote size={16} />, tone: "plum" },
      { label: "Callout", type: "callout", attrs: { tone: "note" }, icon: <StickyNote size={16} />, tone: "plum", keywords: "note tip" },
      { label: "Code", type: "code", attrs: { language: "plaintext" }, icon: <Code2 size={16} />, tone: "marigold", keywords: "snippet" },
      { label: "Table", type: "table", attrs: { headerRow: true, rows: [[[], [], []], [[], [], []]] }, icon: <Table2 size={16} />, tone: "marigold", keywords: "grid" },
    ],
  },
  {
    title: "Structure",
    items: [{ label: "Divider", type: "divider", icon: <Minus size={16} />, tone: "coral", keywords: "separator line rule" }],
  },
];

function InsertTile({ item, editor, disabled }: { item: InsertItem; editor: Editor | null; disabled: boolean }) {
  const dragged = useRef(false);
  return (
    <button
      type="button"
      disabled={disabled}
      title={`${item.label} — click to insert below the current block, or drag into the page`}
      onMouseDown={(e) => e.preventDefault()}
      onPointerDown={(e) => {
        if (!editor || disabled || e.button !== 0) return;
        beginPointerDrag({
          editor,
          payload: { kind: "insert", label: item.label },
          event: e,
          onStart: () => (dragged.current = true),
          onDrop: (t) => {
            const index = insertBlockAt(editor, t.index, t.depth, item.type, item.attrs ?? {});
            return index < 0 ? null : { index, count: 1 };
          },
          onEnd: () => window.setTimeout(() => (dragged.current = false), 0),
        });
      }}
      onClick={() => {
        if (dragged.current || !editor) return;
        insertBlockAfterCurrent(editor, item.type, item.attrs ?? {});
      }}
      className="group flex touch-none select-none flex-col items-center gap-1.5 rounded-[14px] px-1 pb-2 pt-2.5 text-[11px] font-medium text-ink transition-[box-shadow,transform] duration-150 ui-raised hover:-translate-y-px hover:shadow-[var(--shadow-card)] active:cursor-grabbing disabled:opacity-40 disabled:hover:translate-y-0"
    >
      <span aria-hidden className={`grid h-8 w-8 place-items-center rounded-[10px] transition-transform group-hover:scale-105 ${TONES[item.tone] ?? TONES.ink}`}>
        {item.icon}
      </span>
      <span className="max-w-full truncate">{item.label}</span>
    </button>
  );
}

function InsertPanel({ editor, disabled }: { editor: Editor | null; disabled: boolean }) {
  const d = disabled || !editor;
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const sections = INSERT_SECTIONS.map((sec) => ({
    ...sec,
    items: sec.items.filter((i) => !query || `${i.label} ${i.keywords ?? ""}`.toLowerCase().includes(query)),
  })).filter((sec) => sec.items.length);
  return (
    <div>
      <label className="ui-well flex h-9 items-center gap-2 rounded-full px-3 text-[13px] text-muted focus-within:shadow-[0_0_0_2px_var(--color-focus)]">
        <Search size={14} aria-hidden />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search blocks" aria-label="Search blocks" className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-[var(--color-ink-faint)]" />
      </label>
      <p className="mt-2 px-1 text-[12px] text-muted">Drag a block into the page, or click to add it below the cursor.</p>
      {sections.map((sec) => (
        <section key={sec.title} className="mt-4">
          <h3 className="ui-caps mb-2 px-1">{sec.title}</h3>
          <div className="grid grid-cols-4 gap-2">
            {sec.items.map((item) => (
              <InsertTile key={item.label} item={item} editor={editor} disabled={d} />
            ))}
          </div>
        </section>
      ))}
      {!sections.length ? <p className="mt-6 text-center text-sm text-muted">No blocks match “{q}”.</p> : null}
    </div>
  );
}

function FormatPanel({ editor, disabled }: { editor: Editor | null; disabled: boolean }) {
  const [, force] = useState(0);
  useEffect(() => {
    if (!editor) return;
    const on = () => force((n) => n + 1);
    editor.on("selectionUpdate", on);
    editor.on("transaction", on);
    return () => {
      editor.off("selectionUpdate", on);
      editor.off("transaction", on);
    };
  }, [editor]);
  if (!editor) return <p className="text-sm text-muted">Place the cursor in the document to format.</p>;
  const d = disabled;
  const node = editor.state.selection.$from.depth >= 1 ? editor.state.selection.$from.node(1) : null;
  const type = node?.type.name;
  const level = node?.attrs.level;
  return (
    <div className="space-y-5">
      <section>
        <h3 className="ui-caps mb-2 px-1">Block</h3>
        <div className="grid grid-cols-3 gap-2">
          <Tile label="Text" icon={<Text size={16} />} disabled={d} pressed={type === "paragraph"} onClick={() => turnInto(editor, "paragraph")} />
          <Tile label="Heading 1" icon={<Heading1 size={16} />} disabled={d} pressed={type === "heading" && level === 1} onClick={() => turnInto(editor, "heading", { level: 1 })} />
          <Tile label="Heading 2" icon={<Heading2 size={16} />} disabled={d} pressed={type === "heading" && level === 2} onClick={() => turnInto(editor, "heading", { level: 2 })} />
          <Tile label="Heading 3" icon={<Heading3 size={16} />} disabled={d} pressed={type === "heading" && level === 3} onClick={() => turnInto(editor, "heading", { level: 3 })} />
          <Tile label="To-do" icon={<CheckSquare size={16} />} disabled={d} pressed={type === "todo"} onClick={() => turnInto(editor, "todo", { checked: false })} />
          <Tile label="Quote" icon={<Quote size={16} />} disabled={d} pressed={type === "quote"} onClick={() => turnInto(editor, "quote")} />
        </div>
      </section>
      <section>
        <h3 className="ui-caps mb-2 px-1">Text</h3>
        <div className="grid grid-cols-5 gap-2">
          <Tile label="Bold" icon={<Bold size={16} />} disabled={d} pressed={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleMark("bold").run()} />
          <Tile label="Italic" icon={<Italic size={16} />} disabled={d} pressed={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleMark("italic").run()} />
          <Tile label="Underline" icon={<Underline size={16} />} disabled={d} pressed={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleMark("underline").run()} />
          <Tile label="Strike" icon={<Strikethrough size={16} />} disabled={d} pressed={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleMark("strike").run()} />
          <Tile label="Code" icon={<Code2 size={16} />} disabled={d} pressed={editor.isActive("code")} onClick={() => editor.chain().focus().toggleMark("code").run()} />
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
      {type === "codeBlock" ? (
        <label className="block text-sm">
          <span className="ui-caps mb-1.5 block px-1">Language</span>
          <select
            disabled={d}
            value={String(node?.attrs.language ?? "plaintext")}
            onChange={(e) => {
              const pos = editor.state.selection.$from.before(1);
              editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node!.attrs, language: e.target.value }));
            }}
            className="ui-input h-9 w-full rounded-full px-3 text-sm"
          >
            {["plaintext", "bash", "c", "cpp", "csharp", "css", "diff", "go", "graphql", "html", "java", "javascript", "json", "kotlin", "latex", "markdown", "mermaid", "php", "python", "ruby", "rust", "sql", "swift", "toml", "typescript", "xml", "yaml"].map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <p className="text-xs text-muted">Shortcuts: ⌘⌥0–3 headings, ⌘⇧7/8/9 lists and to-dos, Tab / ⇧Tab to nest, ⌥⇧↑↓ to move, ⌘. for block options.</p>
    </div>
  );
}

function Swatch({ value, active, onClick, label }: { value: string; active: boolean; onClick: () => void; label: string }) {
  const color = value === "accent" ? "var(--color-ember)" : `var(--color-${value})`;
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={`h-8 w-8 rounded-full shadow-[inset_0_1px_0_rgb(255_255_255/0.4),inset_0_-1px_0_rgb(0_0_0/0.12),0_1px_2px_rgb(0_0_0/0.15)] transition-transform hover:scale-110 ${active ? "ring-2 ring-heading ring-offset-2 ring-offset-[var(--color-surface)]" : ""}`}
      style={{ background: color }}
    />
  );
}

function StylePanel({ documentId, meta, disabled }: { documentId: string; meta: Meta | null; disabled: boolean }) {
  const { engine } = useAppState();
  if (!meta) return <p className="text-sm text-muted">Style is available once the document has synced.</p>;
  const style = meta.document.style;
  const cover = meta.document.cover;
  const set = (patch: Partial<DocumentStyle>) => engine?.updateDocument(documentId, { style: { ...style, ...patch } }, meta.document.revision);
  const seg = <T extends string>(label: string, values: readonly T[], current: T, onPick: (v: T) => void, names: Record<string, string>) => (
    <fieldset className="mb-5" disabled={disabled}>
      <legend className="ui-caps mb-2 px-1">{label}</legend>
      <div className="ui-seg ui-well">
        {values.map((v) => (
          <button key={v} type="button" aria-pressed={current === v} onClick={() => onPick(v)}>
            {names[v] ?? v}
          </button>
        ))}
      </div>
    </fieldset>
  );
  return (
    <div>
      {seg("Font", DocumentFontValues, style.font, (font) => set({ font }), { sans: "Sans", serif: "Serif", mono: "Mono" })}
      {seg("Width", DocumentWidthValues, style.width, (width) => set({ width }), { narrow: "Narrow", default: "Regular", wide: "Wide" })}
      {seg("Page", DocumentBackgroundValues, style.background, (background) => set({ background }), { paper: "Paper", plain: "Plain", tinted: "Tinted", grid: "Grid" })}
      {seg("Card in lists", CardStyleValues, style.card, (card) => set({ card }), { folio: "Folio", plain: "Plain", tinted: "Tinted", outline: "Outline" })}
      <fieldset className="mb-5" disabled={disabled}>
        <legend className="ui-caps mb-2 px-1">Accent</legend>
        <div className="flex gap-2">
          {DocumentAccentValues.map((a) => (
            <Swatch key={a} value={a} label={`Accent ${a === "accent" ? "ember" : a}`} active={style.accent === a} onClick={() => set({ accent: a })} />
          ))}
        </div>
      </fieldset>
      <fieldset disabled={disabled}>
        <legend className="ui-caps mb-2 px-1">Cover</legend>
        <div className="ui-seg ui-well">
          {(
            [
              ["none", "None"],
              ["color", "Color"],
              ["gradient", "Gradient"],
            ] as const
          ).map(([kind, name]) => (
            <button
              key={kind}
              type="button"
              aria-pressed={cover.kind === kind}
              onClick={() => engine?.updateDocument(documentId, { cover: kind === "none" ? { kind: "none" } : { kind, value: style.accent } }, meta.document.revision)}
            >
              {name}
            </button>
          ))}
        </div>
        <p className="mt-2 px-1 text-xs text-muted">The cover uses the accent color, so pages stay readable in both themes.</p>
      </fieldset>
    </div>
  );
}

function InfoPanel({ documentId, meta, onHistory, disabled }: { documentId: string; meta: Meta | null; onHistory: () => void; disabled: boolean }) {
  const info = useQuery(api.documents.info, meta ? { documentId } : "skip");
  const { workspace } = useAppState();
  const org = useQuery(api.organization.sidebar, { workspaceId: workspace.id });
  const setTags = useMutation(api.organization.setDocumentTags);
  const createTag = useMutation(api.organization.createTag);
  const move = useMutation(api.documents.move);
  const toast = useToast();
  const [newTag, setNewTag] = useState("");
  if (!meta) return <p className="text-sm text-muted">Details appear once the document has synced.</p>;
  const tags = meta.document.tags;
  return (
    <div className="space-y-5 text-sm">
      <dl className="ui-card grid grid-cols-2 gap-x-3 gap-y-2 rounded-[14px] p-3.5">
        <dt className="text-muted">Words</dt>
        <dd className="tabular-nums">{info?.wordCount.toLocaleString() ?? "—"}</dd>
        <dt className="text-muted">Characters</dt>
        <dd className="tabular-nums">{info?.charCount.toLocaleString() ?? "—"}</dd>
        <dt className="text-muted">Blocks</dt>
        <dd className="tabular-nums">{info?.blockCount ?? "—"}</dd>
        <dt className="text-muted">Created</dt>
        <dd>{info ? `${formatDateTime(info.createdAt)} by ${info.createdBy}` : "—"}</dd>
        <dt className="text-muted">Last edited</dt>
        <dd>{info ? `${formatRelative(info.updatedAt)} by ${info.lastEditedBy}` : "—"}</dd>
      </dl>
      <section>
        <h3 className="ui-caps mb-2 px-1">Folder</h3>
        <select
          disabled={disabled}
          value={meta.folder?.id ?? ""}
          onChange={(e) => void move({ documentId, folderId: e.target.value || null }).catch((err) => toast.show(errorMessage(err), { tone: "error" }))}
          className="ui-input h-9 w-full rounded-full px-3 text-sm"
          aria-label="Folder"
        >
          <option value="">Unsorted</option>
          {org?.folders.map((f) => (
            <option key={f.id} value={f.id}>
              {f.parentFolderId ? "— " : ""}
              {f.name}
            </option>
          ))}
        </select>
      </section>
      <section>
        <h3 className="ui-caps mb-2 px-1">Tags</h3>
        <div className="flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <span key={t.id} className="ui-chip bg-accent-soft text-accent-soft-ink">
              #{t.name}
              {!disabled ? (
                <button type="button" aria-label={`Remove tag ${t.name}`} onClick={() => void setTags({ documentId, tagIds: tags.filter((x) => x.id !== t.id).map((x) => x.id) })} className="text-faint hover:text-ink">
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
                const id = existing?.id ?? (await createTag({ workspaceId: workspace.id, name })).id;
                await setTags({ documentId, tagIds: [...new Set([...tags.map((t) => t.id), id])] });
                setNewTag("");
              } catch (err) {
                toast.show(errorMessage(err), { tone: "error" });
              }
            }}
          >
            <input list="tag-suggestions" value={newTag} onChange={(e) => setNewTag(e.target.value)} placeholder="Add a tag" aria-label="Add a tag" className="ui-input h-8 flex-1 rounded-full px-3 text-sm" />
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
          <button type="button" onClick={onHistory} className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 normal-case tracking-normal text-ember-ink hover:bg-ember-soft">
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

function CommentsPanel({ documentId, blockId, onClearBlock, onJumpToBlock }: { documentId: string; blockId: string | null; onClearBlock: () => void; onJumpToBlock: (id: string) => void }) {
  const data = useQuery(api.comments.threads, { documentId });
  const create = useMutation(api.comments.create);
  const reply = useMutation(api.comments.reply);
  const setResolved = useMutation(api.comments.setResolved);
  const remove = useMutation(api.comments.remove);
  const markRead = useMutation(api.comments.markRead);
  const toast = useToast();
  const [draft, setDraft] = useState("");
  const [showResolved, setShowResolved] = useState(false);
  const { workspace } = useAppState();
  const members = useQuery(api.workspaces.members, { workspaceId: workspace.id });
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (blockId) inputRef.current?.focus();
  }, [blockId]);
  useEffect(() => {
    if (data?.threads.some((t) => t.unread)) void markRead({ documentId }).catch(() => undefined);
  }, [data, markRead, documentId]);
  if (!data) return <p className="text-sm text-muted">Loading comments…</p>;
  const threads = data.threads.filter((t) => (showResolved ? true : t.status === "open"));
  // "@Name" matching a workspace member becomes a real mention (they're notified).
  const toBody = (text: string) => {
    const people = [...(members?.members ?? [])].sort((a, b) => b.displayName.length - a.displayName.length);
    const out: ({ type: "text"; text: string } | { type: "mention"; userId: string; label: string })[] = [];
    let buf = "";
    for (let i = 0; i < text.length; ) {
      if (text[i] === "@" && (i === 0 || /\s/.test(text[i - 1]!))) {
        const rest = text.slice(i + 1);
        const hit = people.find((m) => rest.toLowerCase().startsWith(m.displayName.toLowerCase()));
        if (hit) {
          if (buf) out.push({ type: "text", text: buf });
          buf = "";
          out.push({ type: "mention", userId: hit.profileId, label: hit.displayName });
          i += 1 + hit.displayName.length;
          continue;
        }
      }
      buf += text[i];
      i++;
    }
    if (buf) out.push({ type: "text", text: buf });
    return out;
  };
  return (
    <div className="space-y-4 text-sm">
      {data.canComment ? (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!draft.trim()) return;
            try {
              await create({ documentId, blockId: blockId ?? undefined, body: toBody(draft.trim()) });
              setDraft("");
              onClearBlock();
            } catch (err) {
              toast.show(errorMessage(err), { tone: "error" });
            }
          }}
        >
          <label htmlFor="new-comment" className="ui-caps mb-1.5 block px-1">
            {blockId ? "Comment on the selected block" : "Comment on this document"}
          </label>
          <textarea ref={inputRef} id="new-comment" rows={3} value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={5000} aria-describedby="comment-hint" className="ui-input w-full rounded-[14px] p-2.5 text-sm" placeholder="Write a comment" />
          <p id="comment-hint" className="text-xs text-muted">Type @ and a member’s name to mention them.</p>
          <div className="mt-1.5 flex justify-between">
            {blockId ? (
              <button type="button" onClick={onClearBlock} className="text-xs text-muted hover:text-ink">
                Comment on the whole document instead
              </button>
            ) : (
              <span />
            )}
            <Button size="sm" variant="primary" type="submit" disabled={!draft.trim()}>
              Comment
            </Button>
          </div>
        </form>
      ) : (
        <p className="text-muted">You can read comments on this document but not add them.</p>
      )}
      <label className="flex items-center gap-2 text-xs text-muted">
        <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} /> Show resolved
      </label>
      {threads.length === 0 ? <p className="text-muted">No {showResolved ? "" : "open "}comments.</p> : null}
      <ul className="space-y-3">
        {threads.map((t) => (
          <li key={t.id} className={`ui-card rounded-[14px] p-3 ${t.status === "resolved" ? "opacity-70" : ""}`}>
            {t.blockId ? (
              <button type="button" onClick={() => onJumpToBlock(t.blockId!)} className="mb-2 rounded-full bg-ember-soft px-2 py-0.5 text-xs font-medium text-ember-ink">
                Go to block
              </button>
            ) : null}
            <ul className="space-y-2">
              {t.comments.map((c) => (
                <li key={c.id}>
                  <p className="text-xs">
                    <span className="font-semibold text-ink">{c.authorName}</span> <span className="text-faint">· {formatRelative(c.createdAt)}{c.editedAt ? " · edited" : ""}</span>
                  </p>
                  <p className={`mt-0.5 whitespace-pre-wrap ${c.deleted ? "italic text-faint" : ""}`}>{c.deleted ? "Comment deleted" : c.body.map((n) => (n.type === "text" ? n.text : n.type === "mention" ? `@${n.label}` : "")).join("")}</p>
                  {c.mine && !c.deleted ? (
                    <button type="button" className="text-[11px] text-faint hover:text-danger" onClick={() => void remove({ commentId: c.id })}>
                      Delete
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
            {data.canComment ? (
              <ReplyBox
                onReply={(text) => reply({ threadId: t.id, body: toBody(text) }).catch((err) => toast.show(errorMessage(err), { tone: "error" }))}
                resolved={t.status === "resolved"}
                onResolve={() => void setResolved({ threadId: t.id, resolved: t.status !== "resolved" })}
              />
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ReplyBox({ onReply, resolved, onResolve }: { onReply: (text: string) => Promise<unknown>; resolved: boolean; onResolve: () => void }) {
  const [text, setText] = useState("");
  return (
    <form
      className="mt-2 flex items-end gap-1.5"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!text.trim()) return;
        await onReply(text.trim());
        setText("");
      }}
    >
      <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Reply" aria-label="Reply" className="ui-input h-8 flex-1 rounded-full px-3 text-sm" />
      <Button size="sm" type="submit" disabled={!text.trim()}>
        Reply
      </Button>
      <Button size="sm" variant="quiet" onClick={onResolve}>
        {resolved ? "Reopen" : "Resolve"}
      </Button>
    </form>
  );
}
