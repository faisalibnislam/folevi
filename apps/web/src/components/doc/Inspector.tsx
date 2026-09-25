"use client";

import type { Editor } from "@tiptap/react";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useId, useRef, useState } from "react";
import type { FunctionReturnType } from "convex/server";
import { Bold, CheckSquare, Code2, Heading1, Heading2, Heading3, History, Italic, List, ListOrdered, Minus, Quote, Strikethrough, Table2, Text, Underline, X, StickyNote, ChevronRight } from "lucide-react";
import { DocumentAccentValues, DocumentBackgroundValues, DocumentFontValues, DocumentWidthValues, CardStyleValues, type DocumentStyle } from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { IconButton, Button } from "@/components/ui/Button";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { formatDateTime, formatRelative } from "@/lib/format";
import { insertBlockAfterCurrent, turnInto } from "@/components/editor/commands";

export type InspectorTab = "insert" | "format" | "style" | "info" | "comments";
type Meta = FunctionReturnType<typeof api.documents.get>;

const TABS: { id: InspectorTab; label: string }[] = [
  { id: "insert", label: "Insert" },
  { id: "format", label: "Format" },
  { id: "style", label: "Style" },
  { id: "info", label: "Info" },
  { id: "comments", label: "Comments" },
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
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-b border-line px-2">
        <div role="tablist" aria-label="Inspector" className="flex flex-1 overflow-x-auto">
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
              className={`relative h-11 px-2.5 text-[13px] ${tab === t.id ? "font-semibold text-ink after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-accent" : "text-muted hover:text-ink"}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <IconButton label="Close inspector" onClick={onClose}>
          <X size={15} aria-hidden />
        </IconButton>
      </div>
      <div id={`${baseId}-panel`} role="tabpanel" aria-labelledby={`${baseId}-tab-${tab}`} className="min-h-0 flex-1 overflow-y-auto p-3">
        {tab === "insert" ? <InsertPanel editor={editor} disabled={readOnly} /> : null}
        {tab === "format" ? <FormatPanel editor={editor} disabled={readOnly} /> : null}
        {tab === "style" ? <StylePanel documentId={documentId} meta={meta} disabled={readOnly} /> : null}
        {tab === "info" ? <InfoPanel documentId={documentId} meta={meta} onHistory={onHistory} disabled={readOnly} /> : null}
        {tab === "comments" ? <CommentsPanel documentId={documentId} blockId={commentBlock} onClearBlock={onClearCommentBlock} onJumpToBlock={onJumpToBlock} /> : null}
      </div>
    </div>
  );
}

function Tile({ label, icon, onClick, disabled, pressed }: { label: string; icon: React.ReactNode; onClick: () => void; disabled?: boolean; pressed?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={pressed}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`flex flex-col items-center gap-1 rounded-[8px] border px-2 py-2.5 text-xs disabled:opacity-40 ${pressed ? "border-accent bg-accent-soft text-accent-soft-ink" : "border-line bg-raised hover:border-line-strong"}`}
    >
      <span aria-hidden>{icon}</span>
      {label}
    </button>
  );
}

function InsertPanel({ editor, disabled }: { editor: Editor | null; disabled: boolean }) {
  const d = disabled || !editor;
  const ins = (type: string, attrs: Record<string, unknown> = {}) => editor && insertBlockAfterCurrent(editor, type, attrs);
  return (
    <div>
      <p className="mb-2 text-xs text-muted">Inserts below the current block. Or type / in the document.</p>
      <div className="grid grid-cols-3 gap-2">
        <Tile label="Text" icon={<Text size={16} />} disabled={d} onClick={() => ins("paragraph")} />
        <Tile label="Heading" icon={<Heading1 size={16} />} disabled={d} onClick={() => ins("heading", { level: 1 })} />
        <Tile label="To-do" icon={<CheckSquare size={16} />} disabled={d} onClick={() => ins("todo", { checked: false })} />
        <Tile label="Bullets" icon={<List size={16} />} disabled={d} onClick={() => ins("bulleted")} />
        <Tile label="Numbers" icon={<ListOrdered size={16} />} disabled={d} onClick={() => ins("numbered")} />
        <Tile label="Toggle" icon={<ChevronRight size={16} />} disabled={d} onClick={() => ins("toggle", { collapsed: false })} />
        <Tile label="Quote" icon={<Quote size={16} />} disabled={d} onClick={() => ins("quote")} />
        <Tile label="Callout" icon={<StickyNote size={16} />} disabled={d} onClick={() => ins("callout", { tone: "note" })} />
        <Tile label="Code" icon={<Code2 size={16} />} disabled={d} onClick={() => ins("code", { language: "plaintext" })} />
        <Tile label="Divider" icon={<Minus size={16} />} disabled={d} onClick={() => ins("divider")} />
        <Tile label="Table" icon={<Table2 size={16} />} disabled={d} onClick={() => ins("table", { headerRow: true, rows: [[[], [], []], [[], [], []]] })} />
      </div>
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
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.06em] text-faint">Block</h3>
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
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.06em] text-faint">Text</h3>
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
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.06em] text-faint">Callout tone</h3>
          <div className="flex flex-wrap gap-2">
            {["note", "info", "success", "warning", "danger"].map((tone) => (
              <button key={tone} type="button" disabled={d} aria-pressed={node?.attrs.tone === tone} onClick={() => turnInto(editor, "callout", { tone })} className={`h-8 rounded-[6px] border px-2.5 text-xs capitalize ${node?.attrs.tone === tone ? "border-accent" : "border-line"}`}>
                {tone}
              </button>
            ))}
          </div>
        </section>
      ) : null}
      {type === "codeBlock" ? (
        <label className="block text-sm">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.06em] text-faint">Language</span>
          <select
            disabled={d}
            value={String(node?.attrs.language ?? "plaintext")}
            onChange={(e) => {
              const pos = editor.state.selection.$from.before(1);
              editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node!.attrs, language: e.target.value }));
            }}
            className="h-8 w-full rounded-[6px] border border-line bg-surface px-2"
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
  const color = value === "accent" ? "var(--color-accent)" : `var(--color-${value})`;
  return (
    <button type="button" aria-label={label} aria-pressed={active} onClick={onClick} className={`h-8 w-8 rounded-full border-2 ${active ? "border-ink" : "border-transparent"}`} style={{ background: color }} />
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
      <legend className="mb-2 text-xs font-semibold uppercase tracking-[0.06em] text-faint">{label}</legend>
      <div className="grid grid-cols-3 gap-1.5">
        {values.map((v) => (
          <button key={v} type="button" aria-pressed={current === v} onClick={() => onPick(v)} className={`h-9 rounded-[7px] border text-xs ${current === v ? "border-accent bg-accent-soft text-accent-soft-ink" : "border-line bg-raised hover:border-line-strong"}`}>
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
        <legend className="mb-2 text-xs font-semibold uppercase tracking-[0.06em] text-faint">Accent</legend>
        <div className="flex gap-2">
          {DocumentAccentValues.map((a) => (
            <Swatch key={a} value={a} label={`Accent ${a === "accent" ? "ultramarine" : a}`} active={style.accent === a} onClick={() => set({ accent: a })} />
          ))}
        </div>
      </fieldset>
      <fieldset disabled={disabled}>
        <legend className="mb-2 text-xs font-semibold uppercase tracking-[0.06em] text-faint">Cover</legend>
        <div className="grid grid-cols-3 gap-1.5">
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
              className={`h-9 rounded-[7px] border text-xs ${cover.kind === kind ? "border-accent bg-accent-soft text-accent-soft-ink" : "border-line bg-raised"}`}
            >
              {name}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted">The cover uses the accent color, so pages stay readable in both themes.</p>
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
      <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
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
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.06em] text-faint">Folder</h3>
        <select
          disabled={disabled}
          value={meta.folder?.id ?? ""}
          onChange={(e) => void move({ documentId, folderId: e.target.value || null }).catch((err) => toast.show(errorMessage(err), { tone: "error" }))}
          className="h-8 w-full rounded-[6px] border border-line bg-surface px-2"
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
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.06em] text-faint">Tags</h3>
        <div className="flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <span key={t.id} className="inline-flex items-center gap-1 rounded-[6px] bg-sunken px-2 py-0.5 text-xs">
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
            <input list="tag-suggestions" value={newTag} onChange={(e) => setNewTag(e.target.value)} placeholder="Add a tag" aria-label="Add a tag" className="h-8 flex-1 rounded-[6px] border border-line bg-surface px-2" />
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
        <h3 className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-[0.06em] text-faint">
          Activity
          <button type="button" onClick={onHistory} className="inline-flex items-center gap-1 normal-case tracking-normal text-accent hover:underline">
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
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (blockId) inputRef.current?.focus();
  }, [blockId]);
  useEffect(() => {
    if (data?.threads.some((t) => t.unread)) void markRead({ documentId }).catch(() => undefined);
  }, [data, markRead, documentId]);
  if (!data) return <p className="text-sm text-muted">Loading comments…</p>;
  const threads = data.threads.filter((t) => (showResolved ? true : t.status === "open"));
  const toBody = (text: string) => [{ type: "text" as const, text }];
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
          <label htmlFor="new-comment" className="mb-1 block text-xs font-semibold uppercase tracking-[0.06em] text-faint">
            {blockId ? "Comment on the selected block" : "Comment on this document"}
          </label>
          <textarea ref={inputRef} id="new-comment" rows={3} value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={5000} className="w-full rounded-[8px] border border-line bg-surface p-2 outline-none focus:border-accent" placeholder="Write a comment" />
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
          <li key={t.id} className={`rounded-[10px] border p-3 ${t.status === "resolved" ? "border-line opacity-70" : "border-line bg-raised"}`}>
            {t.blockId ? (
              <button type="button" onClick={() => onJumpToBlock(t.blockId!)} className="mb-2 text-xs text-accent hover:underline">
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
      <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Reply" aria-label="Reply" className="h-8 flex-1 rounded-[6px] border border-line bg-surface px-2" />
      <Button size="sm" type="submit" disabled={!text.trim()}>
        Reply
      </Button>
      <Button size="sm" variant="quiet" onClick={onResolve}>
        {resolved ? "Reopen" : "Resolve"}
      </Button>
    </form>
  );
}
