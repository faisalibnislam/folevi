"use client";

import { useConvex, useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Editor as TiptapEditor } from "@tiptap/react";
import {
  Archive,
  ArchiveRestore,
  ChevronRight,
  Copy,
  FileCode,
  FileText,
  History,
  LayoutTemplate,
  MessageSquare,
  MoreHorizontal,
  PanelRight,
  Printer,
  Share2,
  Star,
  StarOff,
  Trash2,
  Undo2,
} from "lucide-react";
import { DEFAULT_COVER, DEFAULT_DOCUMENT_STYLE, rankForPosition, type DocumentStyle, type WireBlock } from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { AppLink, useAppRouter } from "@/lib/app/router";
import { useEngineState } from "@/lib/hooks/useEngine";
import { localDb } from "@/lib/sync/db";
import { Button, IconButton } from "@/components/ui/Button";
import { MenuButton } from "@/components/ui/Menu";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { ViewChrome, useShell } from "@/components/app/Shell";
import { SyncStatus } from "@/components/app/SyncStatus";
import { Editor, type EditorHandle } from "@/components/editor/Editor";
import type { DecorationInputs } from "@/components/editor/plugins";
import { coverBackground } from "@/lib/cover";
import { PermanentDeleteDialog } from "@/components/views/DocumentBrowser";
import { Inspector, type InspectorTab } from "./Inspector";
import { ShareDialog } from "./ShareDialog";
import { VersionHistory } from "./VersionHistory";
import { exportHtml, exportMarkdown, exportPdf } from "./export";
import "@/components/editor/editor.css";

const IDLE_SNAPSHOT_MS = 2 * 60_000;

export function DocumentView({ documentId }: { documentId: string }) {
  const { engine, profile, online } = useAppState();
  const convex = useConvex();
  const meta = useQuery(api.documents.get, { documentId });
  const server = useQuery(api.blocks.list, { documentId });
  const settings = useQuery(api.settings.status, {});
  const engineState = useEngineState(engine);
  const editorRef = useRef<EditorHandle>(null);
  const [editor, setEditor] = useState<TiptapEditor | null>(null);
  const [cacheLoaded, setCacheLoaded] = useState(false);
  const [reconciled, setReconciled] = useState(false);
  const { inspectorOpen, setInspectorOpen, isNarrow } = useShell();
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("format");
  const [commentBlock, setCommentBlock] = useState<string | null>(null);
  const [focusedBlock, setFocusedBlock] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const recordView = useMutation(api.documents.recordView);
  const createSnapshot = useMutation(api.documents.createSnapshot);
  const heartbeat = useMutation(api.presence.heartbeat);
  const leave = useMutation(api.presence.leave);
  const sessionId = useMemo(() => Math.random().toString(36).slice(2), []);

  const pendingCreateOp = useMemo(
    () => engineState.pending.concat(engineState.inflight).find((op) => op.kind === "document.create" && op.document.id === documentId),
    [engineState, documentId],
  );
  // Remember a page created on this device until the server has it, so the view never flashes "unavailable".
  const localCreate = useRef<typeof pendingCreateOp>(undefined);
  if (pendingCreateOp) localCreate.current = pendingCreateOp;
  if (meta) localCreate.current = undefined;
  const pendingCreate = pendingCreateOp ?? localCreate.current;

  // Offline reload: seed the engine from the last-known copy of this document.
  useEffect(() => {
    if (!engine || server !== undefined || cacheLoaded) return;
    const t = setTimeout(async () => {
      const db = await localDb(profile.id);
      const cached = await db.get("blocks", documentId);
      if (cached && !engine.documentBlocks(documentId).length) engine.reconcileDocument(documentId, cached.blocks);
      setCacheLoaded(true);
    }, online ? 1500 : 0);
    return () => clearTimeout(t);
  }, [engine, server, cacheLoaded, profile.id, documentId, online]);

  // Server → engine → editor. Local keystrokes are flushed into the durable queue first so a remote
  // update can never overwrite unsent typing (the server decides conflicts on base revisions).
  useEffect(() => {
    if (!engine || !server) return;
    editorRef.current?.flush();
    engine.reconcileDocument(documentId, server.blocks);
    editorRef.current?.applyFromEngine();
    setReconciled(true);
    void (async () => {
      const db = await localDb(profile.id);
      await db.put("blocks", { documentId, workspaceId: engine.workspaceId, blocks: server.blocks, cachedAt: Date.now() });
    })();
  }, [engine, server, documentId, profile.id]);

  useEffect(() => {
    if (meta) void recordView({ documentId }).catch(() => undefined);
  }, [meta?.document.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Presence heartbeat with the focused block (never leaves the authorization boundary: server-checked).
  useEffect(() => {
    if (!meta || !online) return;
    const beat = () => void heartbeat({ documentId, sessionId, focusedBlockId: focusedBlock }).catch(() => undefined);
    beat();
    const id = setInterval(beat, 20_000);
    return () => clearInterval(id);
  }, [meta?.document.id, online, focusedBlock]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => void leave({ documentId, sessionId }).catch(() => undefined), []); // eslint-disable-line react-hooks/exhaustive-deps
  const presenceNow = Math.floor(Date.now() / 15_000) * 15_000;
  const presence = useQuery(api.presence.list, meta ? { documentId, now: presenceNow } : "skip");

  // Idle and close snapshots — meaningful versions, never one per keystroke.
  const pendingForDoc = engineState.pending.some((op) => "documentId" in op && op.documentId === documentId) || engineState.inflight.length > 0;
  const lastEditAt = useRef<number | null>(null);
  useEffect(() => {
    if (pendingForDoc) lastEditAt.current = Date.now();
  }, [pendingForDoc]);
  useEffect(() => {
    if (pendingForDoc || !lastEditAt.current || !meta || meta.access === "read" || meta.access === "comment") return;
    const t = setTimeout(() => {
      void createSnapshot({ documentId, reason: "idle" }).catch(() => undefined);
      lastEditAt.current = null;
    }, IDLE_SNAPSHOT_MS);
    return () => clearTimeout(t);
  }, [pendingForDoc, meta, createSnapshot, documentId]);
  useEffect(() => {
    const onHide = () => {
      if (lastEditAt.current && document.visibilityState === "hidden") void createSnapshot({ documentId, reason: "close" }).catch(() => undefined);
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [createSnapshot, documentId]);

  const threads = useQuery(api.comments.threads, meta ? { documentId } : "skip");
  const conflicts = engineState.conflicts.filter((c) => c.documentId === documentId);
  const decorations: DecorationInputs = useMemo(
    () => ({
      presence: (presence ?? []).filter((p) => p.focusedBlockId).map((p) => ({ blockId: p.focusedBlockId!, color: p.color, name: p.name })),
      commentBlocks: new Set((threads?.threads ?? []).filter((t) => t.status === "open" && t.blockId).map((t) => t.blockId!)),
      selectedBlocks: new Set<string>(),
      conflictBlocks: new Set(conflicts.map((c) => c.blockId)),
    }),
    [presence, threads, conflicts],
  );

  // Deep link to a block (#block-<id>).
  useEffect(() => {
    if (!editor) return;
    const m = /^#block-(.+)$/.exec(window.location.hash);
    if (m) setTimeout(() => editorRef.current?.focusBlock(m[1]!), 150);
  }, [editor]);

  const summary = meta?.document ?? null;
  const localTitle = pendingCreate && pendingCreate.kind === "document.create" ? pendingCreate.document.title : "";
  const style: DocumentStyle = summary?.style ?? DEFAULT_DOCUMENT_STYLE;
  const readOnly = Boolean(meta && (meta.access === "read" || meta.access === "comment" || meta.inTrash)) || Boolean(settings?.readOnly && !profile.platformRole);

  const openComments = useCallback(
    (blockId?: string) => {
      setCommentBlock(blockId ?? null);
      setInspectorTab("comments");
      setInspectorOpen(true);
    },
    [setInspectorOpen],
  );

  if (meta === null && !pendingCreate && (server === null || server === undefined) && (online || cacheLoaded)) {
    if (meta === null && server === null) {
      return (
        <ViewChrome title="Unavailable">
          <div className="mx-auto max-w-lg px-6 py-24 text-center">
            <h1 className="font-display text-4xl">This page isn’t available</h1>
            <p className="mt-3 text-muted">It may have been deleted, or you don’t have access. If someone shared it with you, ask them to check the sharing settings.</p>
            <AppLink href="/documents" className="mt-6 inline-block text-accent underline underline-offset-2">
              Back to All Documents
            </AppLink>
          </div>
        </ViewChrome>
      );
    }
  }

  // Mount the editor only once the engine holds this document's blocks (server, local cache, or a new page).
  // A page created on this device (not from a template) is known to be empty, so it can open immediately.
  const freshLocalPage = Boolean(pendingCreate) && pendingCreate?.kind === "document.create" && !pendingCreate.document.templateId;
  const ready = Boolean(engine) && (reconciled || (cacheLoaded && server === undefined) || freshLocalPage || (Boolean(pendingCreate) && !online));

  return (
    <ViewChrome
      title={
        <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1 text-sm">
          {meta?.folder ? (
            <>
              <AppLink href={`/folders/${meta.folder.id}`} className="truncate text-muted hover:text-ink">
                {meta.folder.name}
              </AppLink>
              <ChevronRight size={13} className="flex-none text-faint" aria-hidden />
            </>
          ) : null}
          {meta?.breadcrumbs.map((b) => (
            <span key={b.id} className="flex min-w-0 items-center gap-1">
              <AppLink href={`/d/${b.id}`} className="truncate text-muted hover:text-ink">
                {b.icon ? `${b.icon} ` : ""}
                {b.title || "Untitled"}
              </AppLink>
              <ChevronRight size={13} className="flex-none text-faint" aria-hidden />
            </span>
          ))}
          <span className="truncate font-medium" aria-current="page">
            {summary?.icon ? `${summary.icon} ` : ""}
            {summary?.title || localTitle || "Untitled"}
          </span>
          {readOnly ? <span className="ml-2 rounded-[5px] bg-sunken px-1.5 py-0.5 text-[11px] text-muted">{meta?.inTrash ? "In Trash" : "View only"}</span> : null}
        </nav>
      }
      actions={
        <>
          <PresenceAvatars people={presence ?? []} />
          <SyncStatus documentId={documentId} />
          <IconButton label={`Comments${threads?.threads.some((t) => t.unread) ? " (unread)" : ""}`} onClick={() => openComments()}>
            <span className="relative">
              <MessageSquare size={16} aria-hidden />
              {threads?.threads.some((t) => t.unread && t.status === "open") ? <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-marigold" aria-hidden /> : null}
            </span>
          </IconButton>
          {meta ? (
            <Button size="sm" variant="secondary" onClick={() => setShareOpen(true)} className="hidden sm:inline-flex">
              <Share2 size={14} aria-hidden /> Share
            </Button>
          ) : null}
          {summary ? (
            <DocumentMenu
              documentId={documentId}
              title={summary.title}
              starred={summary.starred}
              archived={Boolean(summary.archivedAt)}
              inTrash={meta?.inTrash ?? false}
              kind={summary.kind}
              canManage={meta?.access === "manage" || meta?.access === "write"}
              blocks={() => engine?.documentBlocks(documentId) ?? []}
              onHistory={() => setHistoryOpen(true)}
              onShare={() => setShareOpen(true)}
              onDelete={() => setDeleteOpen(true)}
              client={convex}
            />
          ) : null}
          <IconButton label={inspectorOpen ? "Hide inspector" : "Show inspector"} shortcut="⌘⌥I" onClick={() => setInspectorOpen(!inspectorOpen)} aria-pressed={inspectorOpen}>
            <PanelRight size={16} aria-hidden />
          </IconButton>
        </>
      }
    >
      <div className="flex min-h-full">
        <div
          className="fb-page flex-1 px-3 pb-10 pt-6 sm:px-6"
          data-font={style.font}
          data-width={style.width}
          style={{
            ["--doc-accent" as string]: style.accent === "accent" ? "var(--color-accent)" : `var(--color-${style.accent})`,
            ["--doc-accent-soft" as string]: style.accent === "accent" ? "var(--color-accent-soft)" : `var(--color-${style.accent}-soft)`,
          }}
        >
          <article
            className="fb-sheet relative mx-auto rounded-[14px] border border-line shadow-[0_1px_0_var(--color-line),0_18px_50px_-36px_rgba(24,32,28,0.45)] animate-[folio-settle_240ms_var(--ease-folio)]"
            data-background={style.background}
            style={{ maxWidth: "calc(var(--editor-width) + 8rem)" }}
          >
            <DocumentHeader
              documentId={documentId}
              title={summary?.title ?? localTitle}
              icon={summary?.icon ?? null}
              cover={summary?.cover ?? DEFAULT_COVER}
              style={style}
              revision={summary?.revision ?? null}
              readOnly={readOnly}
              onEnter={() => editor?.commands.focus("start")}
            />
            {conflicts.length ? <ConflictBanner documentId={documentId} /> : null}
            <div className="px-5 sm:px-16">
              {ready && engine ? (
                <Editor
                  ref={editorRef}
                  documentId={documentId}
                  engine={engine}
                  accountKey={profile.id}
                  editable={!readOnly}
                  decorations={decorations}
                  onFocusBlock={setFocusedBlock}
                  onCommentBlock={(id) => openComments(id)}
                  onEditorReady={setEditor}
                />
              ) : (
                <div className="space-y-3 py-6" aria-busy aria-label="Loading document">
                  {[80, 95, 60, 88].map((w, i) => (
                    <div key={i} className="h-4 animate-pulse rounded bg-sunken motion-reduce:animate-none" style={{ width: `${w}%` }} />
                  ))}
                </div>
              )}
            </div>
          </article>
          <Backlinks documentId={documentId} />
        </div>
        {inspectorOpen ? (
          <aside
            aria-label="Inspector"
            className={`${isNarrow ? "fixed inset-y-0 right-0 z-40 w-[min(92vw,340px)] shadow-2xl" : "sticky top-0 h-[calc(100dvh-3rem)] w-[320px] flex-none"} border-l border-line bg-canvas`}
          >
            <Inspector
              documentId={documentId}
              editor={editor}
              meta={meta ?? null}
              tab={inspectorTab}
              onTab={setInspectorTab}
              commentBlock={commentBlock}
              onClearCommentBlock={() => setCommentBlock(null)}
              onJumpToBlock={(id) => editorRef.current?.focusBlock(id)}
              onClose={() => setInspectorOpen(false)}
              onHistory={() => setHistoryOpen(true)}
              readOnly={readOnly}
            />
          </aside>
        ) : null}
      </div>
      {meta ? <ShareDialog open={shareOpen} onClose={() => setShareOpen(false)} documentId={documentId} title={summary?.title ?? ""} /> : null}
      <VersionHistory open={historyOpen} onClose={() => setHistoryOpen(false)} documentId={documentId} canRestore={!readOnly} />
      <PermanentDeleteDialog open={deleteOpen} onClose={() => setDeleteOpen(false)} documentId={documentId} title={summary?.title ?? ""} />
    </ViewChrome>
  );
}

function PresenceAvatars({ people }: { people: { profileId: string; name: string; color: string }[] }) {
  if (!people.length) return null;
  return (
    <div className="mr-1 flex -space-x-1.5" aria-label={`Also here: ${people.map((p) => p.name).join(", ")}`} role="group">
      {people.slice(0, 4).map((p) => (
        <span key={p.profileId} title={p.name} className="grid h-6 w-6 place-items-center rounded-full border-2 border-canvas text-[10px] font-semibold text-white" style={{ background: `var(--color-${p.color === "accent" ? "accent" : p.color})` }}>
          {p.name.slice(0, 1).toUpperCase()}
        </span>
      ))}
    </div>
  );
}

const ICONS = ["📄", "🌿", "✳︎", "☕️", "🧭", "📚", "⛴", "🔁", "🗒", "💡", "🎯", "🌙", "🪴", "🗺", "✏️", "📌", "🧪", "🎨", "🏡", "📷"];

function DocumentHeader({
  documentId,
  title,
  icon,
  cover,
  style,
  revision,
  readOnly,
  onEnter,
}: {
  documentId: string;
  title: string;
  icon: string | null;
  cover: { kind: string; value?: string };
  style: DocumentStyle;
  revision: number | null;
  readOnly: boolean;
  onEnter: () => void;
}) {
  const { engine } = useAppState();
  const { search, pathname } = useAppRouter();
  const [value, setValue] = useState(title);
  const [iconOpen, setIconOpen] = useState(false);
  // True only while the person has unsaved keystrokes in the title; otherwise the server value wins.
  const typing = useRef(false);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!typing.current) setValue(title);
  }, [title]);
  useEffect(() => {
    if (search.get("new") === "1") {
      titleRef.current?.focus();
      // Drop the one-shot flag so a reload doesn't re-trigger it.
      window.history.replaceState(null, "", pathname);
    }
  }, [search, pathname]);
  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const save = (next: string) => {
    if (timer.current) clearTimeout(timer.current);
    typing.current = true;
    timer.current = setTimeout(() => {
      engine?.updateDocument(documentId, { title: next }, revision);
      typing.current = false;
    }, 300);
  };
  const bg = coverBackground(cover as never, style);
  return (
    <header>
      {bg ? <div className="h-36 rounded-t-[14px] border-b border-line/60 sm:h-44" style={{ background: bg }} aria-hidden /> : <div className="h-10" aria-hidden />}
      <div className="px-5 sm:px-16">
        <div className={`relative ${bg ? "-mt-9" : ""}`}>
          <button
            type="button"
            disabled={readOnly}
            onClick={() => setIconOpen((o) => !o)}
            aria-label={icon ? `Page icon ${icon}. Change icon` : "Add page icon"}
            aria-expanded={iconOpen}
            className={`grid h-16 w-16 place-items-center rounded-[14px] text-[40px] leading-none ${icon ? "bg-raised shadow-[0_1px_0_var(--color-line)]" : "text-faint hover:bg-surface"} disabled:cursor-default`}
          >
            {icon ?? <span className="text-sm">＋ Icon</span>}
          </button>
          {iconOpen ? (
            <div role="dialog" aria-label="Choose an icon" className="absolute left-0 top-full z-30 mt-2 grid w-72 grid-cols-8 gap-1 rounded-[12px] border border-line bg-raised p-2 shadow-xl">
              {ICONS.map((i) => (
                <button key={i} type="button" className="grid h-8 w-8 place-items-center rounded-[6px] text-xl hover:bg-surface" onClick={() => { engine?.updateDocument(documentId, { icon: i }, revision); setIconOpen(false); }} aria-label={`Use ${i}`}>
                  {i}
                </button>
              ))}
              <button type="button" className="col-span-8 mt-1 rounded-[6px] py-1 text-xs text-muted hover:bg-surface" onClick={() => { engine?.updateDocument(documentId, { icon: null }, revision); setIconOpen(false); }}>
                Remove icon
              </button>
            </div>
          ) : null}
        </div>
        <label htmlFor={`title-${documentId}`} className="sr-only">
          Title
        </label>
        <textarea
          id={`title-${documentId}`}
          ref={titleRef}
          rows={1}
          value={value}
          readOnly={readOnly}
          placeholder="Untitled"
          onChange={(e) => {
            const next = e.target.value.replace(/\n/g, "");
            setValue(next);
            save(next);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || (e.key === "ArrowDown" && titleRef.current?.selectionStart === value.length)) {
              e.preventDefault();
              onEnter();
            }
          }}
          className={`mt-3 block w-full resize-none overflow-hidden bg-transparent text-[40px] leading-[1.15] tracking-[-0.015em] text-ink outline-none placeholder:text-faint ${style.font === "sans" ? "font-sans font-semibold tracking-[-0.025em]" : style.font === "mono" ? "font-mono text-[34px]" : "font-display"}`}
          aria-describedby={readOnly ? `ro-${documentId}` : undefined}
        />
        {readOnly ? (
          <p id={`ro-${documentId}`} className="sr-only">
            This document is read-only for you.
          </p>
        ) : null}
        <div className="mb-4 mt-1" />
      </div>
    </header>
  );
}

function ConflictBanner({ documentId }: { documentId: string }) {
  const { engine } = useAppState();
  const state = useEngineState(engine);
  const conflicts = state.conflicts.filter((c) => c.documentId === documentId);
  const [openId, setOpenId] = useState<string | null>(conflicts[0]?.id ?? null);
  if (!conflicts.length || !engine) return null;
  const c = conflicts.find((x) => x.id === openId) ?? conflicts[0]!;
  const text = (b: WireBlock | null) =>
    b ? (b.text.length ? b.text.map((n) => (n.type === "text" ? n.text : n.type === "mention" ? `@${n.label}` : n.type === "date" ? n.date : n.label)).join("") : `(${b.type} block)`) : "(deleted)";
  const keepBoth = () => {
    const blocks = engine.documentBlocks(documentId);
    const server = blocks.find((b) => b.id === c.blockId) ?? c.server;
    const rank = server ? rankForPosition(blocks, server.parentId, server.id) : undefined;
    engine.resolveConflict(c.id, "both", rank);
  };
  return (
    <section role="alert" aria-labelledby={`conflict-${c.id}`} className="mx-5 mb-4 rounded-[12px] border border-plum/40 bg-plum-soft p-4 sm:mx-16">
      <h2 id={`conflict-${c.id}`} className="text-sm font-semibold text-plum-ink">
        {conflicts.length === 1 ? "This block was changed in two places" : `${conflicts.length} blocks were changed in two places`}
      </h2>
      <p className="mt-1 text-sm text-ink">Both versions are kept. Nothing is lost until you choose.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="rounded-[8px] border border-line bg-raised p-3">
          <p className="text-xs font-semibold uppercase tracking-[0.06em] text-muted">{c.reason === "deleted" ? "Deleted elsewhere" : "Version from elsewhere"}</p>
          <p className="mt-1 whitespace-pre-wrap text-sm">{c.reason === "deleted" ? "Someone deleted this block." : text(c.server)}</p>
        </div>
        <div className="rounded-[8px] border border-accent/40 bg-raised p-3">
          <p className="text-xs font-semibold uppercase tracking-[0.06em] text-muted">Your version</p>
          <p className="mt-1 whitespace-pre-wrap text-sm">{text(c.client)}</p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="primary" onClick={() => engine.resolveConflict(c.id, "mine")}>
          Keep mine
        </Button>
        <Button size="sm" onClick={() => engine.resolveConflict(c.id, "theirs")}>
          Keep theirs
        </Button>
        {c.reason !== "deleted" ? (
          <Button size="sm" onClick={keepBoth}>
            Keep both
          </Button>
        ) : null}
        {conflicts.length > 1 ? (
          <select aria-label="Choose conflict" value={c.id} onChange={(e) => setOpenId(e.target.value)} className="ml-auto h-8 rounded-[6px] border border-line bg-raised px-2 text-xs">
            {conflicts.map((x, i) => (
              <option key={x.id} value={x.id}>
                Conflict {i + 1}
              </option>
            ))}
          </select>
        ) : null}
      </div>
    </section>
  );
}

function Backlinks({ documentId }: { documentId: string }) {
  const data = useQuery(api.documents.backlinks, { documentId });
  if (!data || (!data.linked.length && !data.unlinked.length)) return null;
  return (
    <section aria-labelledby="backlinks-title" className="mx-auto mt-8 max-w-[calc(var(--editor-width)+8rem)] px-5 sm:px-16">
      <h2 id="backlinks-title" className="text-[12px] font-semibold uppercase tracking-[0.06em] text-faint">
        Linked from
      </h2>
      <ul className="mt-2 space-y-1">
        {data.linked.map((l) => (
          <li key={l.id}>
            <AppLink href={`/d/${l.id}`} className="flex items-baseline gap-2 rounded-[6px] px-2 py-1 hover:bg-surface">
              <span aria-hidden>{l.icon ?? "📄"}</span>
              <span className="font-medium">{l.title || "Untitled"}</span>
              <span className="truncate text-xs text-muted">{l.excerpt}</span>
            </AppLink>
          </li>
        ))}
        {!data.linked.length ? <li className="px-2 text-sm text-muted">No pages link here yet.</li> : null}
      </ul>
      {data.unlinked.length ? (
        <>
          <h3 className="mt-4 text-[12px] font-semibold uppercase tracking-[0.06em] text-faint">Unlinked mentions</h3>
          <ul className="mt-2 space-y-1">
            {data.unlinked.map((l) => (
              <li key={l.id}>
                <AppLink href={`/d/${l.id}`} className="flex items-baseline gap-2 rounded-[6px] px-2 py-1 hover:bg-surface">
                  <span aria-hidden>{l.icon ?? "📄"}</span>
                  <span className="font-medium">{l.title || "Untitled"}</span>
                </AppLink>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}

function DocumentMenu({
  documentId,
  title,
  starred,
  archived,
  inTrash,
  kind,
  canManage,
  blocks,
  onHistory,
  onShare,
  onDelete,
  client,
}: {
  documentId: string;
  title: string;
  starred: boolean;
  archived: boolean;
  inTrash: boolean;
  kind: string;
  canManage: boolean;
  blocks: () => WireBlock[];
  onHistory: () => void;
  onShare: () => void;
  onDelete: () => void;
  client: ReturnType<typeof useConvex>;
}) {
  const setStarred = useMutation(api.documents.setStarred);
  const setArchived = useMutation(api.documents.setArchived);
  const trash = useMutation(api.documents.moveToTrash);
  const restore = useMutation(api.documents.restoreFromTrash);
  const duplicate = useMutation(api.documents.duplicate);
  const toast = useToast();
  const { navigate } = useAppRouter();
  const act = (p: Promise<unknown>, msg: string, undo?: () => void) =>
    p.then(() => toast.show(msg, undo ? { action: { label: "Undo", onClick: undo } } : undefined), (e) => toast.show(errorMessage(e), { tone: "error" }));
  const exportWith = (fn: typeof exportMarkdown, label: string) =>
    fn(client, title, blocks()).then(
      () => toast.show(`${label} export ready`),
      (e) => toast.show(errorMessage(e), { tone: "error" }),
    );
  const items = inTrash
    ? [
        { label: "Restore from Trash", icon: <Undo2 size={14} />, onSelect: () => void act(restore({ documentId }), "Restored") },
        { label: "Delete permanently…", icon: <Trash2 size={14} />, danger: true, onSelect: onDelete },
      ]
    : [
        starred
          ? { label: "Unstar", icon: <StarOff size={14} />, onSelect: () => void act(setStarred({ documentId, starred: false }), "Removed from Starred") }
          : { label: "Star", icon: <Star size={14} />, onSelect: () => void act(setStarred({ documentId, starred: true }), "Starred") },
        { label: "Share…", icon: <Share2 size={14} />, onSelect: onShare },
        { label: "Version history…", icon: <History size={14} />, onSelect: onHistory },
        "separator" as const,
        { label: "Export as Markdown", icon: <FileText size={14} />, onSelect: () => void exportWith(exportMarkdown, "Markdown") },
        { label: "Export as HTML", icon: <FileCode size={14} />, onSelect: () => void exportWith(exportHtml, "HTML") },
        { label: "Export as PDF (print)", icon: <Printer size={14} />, onSelect: () => void exportWith(exportPdf, "PDF") },
        "separator" as const,
        { label: "Duplicate", icon: <Copy size={14} />, onSelect: () => void duplicate({ documentId }).then((d) => navigate(`/d/${d.id}`), (e) => toast.show(errorMessage(e), { tone: "error" })) },
        ...(kind !== "template" ? [{ label: "Save as template", icon: <LayoutTemplate size={14} />, onSelect: () => void act(duplicate({ documentId, asTemplate: true }), "Saved to Templates") }] : []),
        archived
          ? { label: "Unarchive", icon: <ArchiveRestore size={14} />, onSelect: () => void act(setArchived({ documentId, archived: false }), "Moved out of Archive") }
          : { label: "Archive", icon: <Archive size={14} />, disabled: !canManage, onSelect: () => void act(setArchived({ documentId, archived: true }), "Archived", () => void setArchived({ documentId, archived: false })) },
        {
          label: "Move to Trash",
          icon: <Trash2 size={14} />,
          danger: true,
          disabled: !canManage,
          onSelect: () => void act(trash({ documentId }), "Moved to Trash", () => void restore({ documentId })),
        },
      ];
  return <MenuButton label="Document actions" trigger={<MoreHorizontal size={16} aria-hidden />} items={items} />;
}

