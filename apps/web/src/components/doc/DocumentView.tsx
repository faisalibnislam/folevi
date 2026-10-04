"use client";

import { useConvex, useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Editor as TiptapEditor } from "@tiptap/react";
import { AiIcon } from "@/components/ai/AiIcon";
import {
  Archive,
  ArchiveRestore,
  ChevronRight,
  Copy,
  FileCode,
  FileText,
  Folder,
  FolderInput,
  History,
  LayoutTemplate,
  Info,
  MoreHorizontal,
  Printer,
  Search,
  Share2,
  Star,
  StarOff,
  Trash2,
  Undo2,
  House as Home,
} from "lucide-react";
import { DEFAULT_COVER, DEFAULT_DOCUMENT_STYLE, rankForPosition, type DocumentStyle, type WireBlock } from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { documentScope, inCurrentScope, type DocumentHome } from "@/lib/app/scope";
import { AppLink, useAppRouter } from "@/lib/app/router";
import { useEngineState } from "@/lib/hooks/useEngine";
import { localDb } from "@/lib/sync/db";
import { Button } from "@/components/ui/Button";
import { MenuButton, type MenuItem } from "@/components/ui/Menu";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { ViewChrome, useShell } from "@/components/app/Shell";
import { Editor, type EditorHandle } from "@/components/editor/Editor";
import { CollectionRowProperties } from "@/components/editor/CollectionEmbed";
import type { DecorationInputs } from "@/components/editor/plugins";
import { coverArtOf, coverArtThumbUrl, coverBackground, pageBackdrop, sheetProps, styleColorsOf } from "@/lib/cover";
import { BlurredBackdrop } from "./BlurredBackdrop";
import { NotePaletteProvider } from "@/components/editor/notePalette";
import { useCoverImage } from "@/lib/app/coverImage";
import { PermanentDeleteDialog } from "@/components/views/DocumentBrowser";
import { Inspector, type InspectorTab } from "./Inspector";
import { BlockThread, useNoteNotifyItems } from "./Comments";
import { AI_OPEN_EVENT, AI_RUN_EVENT, useAi, useAiEnabled, type AiRunDetail } from "@/components/ai/useAi";
import { DocumentSidebar, type Crumb, type DocSidebarTab } from "./DocumentSidebar";
import { useDocTab } from "@/lib/app/tabs";
import { ShareDialog } from "./ShareDialog";
import { TitleAi, TitleAiPill, type TitleRange } from "./TitleAi";
import { VersionHistory } from "./VersionHistory";
import { MovePageDialog } from "./MovePageDialog";
import { FindBar } from "./FindBar";
import { MoveToFolderDialog } from "@/components/views/MoveToFolderDialog";
import { useNoteActions } from "@/components/views/noteActions";
import { exportHtml, exportMarkdown, exportPdf } from "./export";
import { PageDock } from "./PageDock";
import "@/components/editor/editor.css";
import "@/components/editor/insert-blocks.css";
import "@/components/editor/flowchart/flowchart.css";
import { Select } from "@/components/ui/Select";

const IDLE_SNAPSHOT_MS = 2 * 60_000;

export function DocumentView({ documentId }: { documentId: string }) {
  const { engine, profile, online, scopeKey } = useAppState();
  const convex = useConvex();
  const meta = useQuery(api.documents.get, { documentId });
  const server = useQuery(api.blocks.list, { documentId });
  const settings = useQuery(api.settings.status, {});
  const engineState = useEngineState(engine);
  const editorRef = useRef<EditorHandle>(null);
  const [editor, setEditor] = useState<TiptapEditor | null>(null);
  const [cacheLoaded, setCacheLoaded] = useState(false);
  const [reconciled, setReconciled] = useState(false);
  const { inspectorOpen, setInspectorOpen, sidebarSlot, sidebarOpen, toggleSidebar, drawerMode } = useShell();
  const sidebarOpenRef = useRef(sidebarOpen);
  sidebarOpenRef.current = sidebarOpen;
  const toggleSidebarRef = useRef(toggleSidebar);
  toggleSidebarRef.current = toggleSidebar;
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("format");
  // The comment thread floating under a block (threadId null: the block's latest open thread, or a new one).
  const [openThread, setOpenThread] = useState<{ blockId: string; threadId: string | null } | null>(null);
  // A thread to open inside the Comments panel (on the whole note or a deleted block).
  const [focusThreadId, setFocusThreadId] = useState<string | null>(null);
  // Opening comments switches the page sidebar to its Comments tab (showing the sidebar first if it's hidden).
  const [sidebarRequest, setSidebarRequest] = useState<{ tab: DocSidebarTab; at: number } | null>(null);
  const showCommentsTab = useCallback(
    (threadId: string | null) => {
      setFocusThreadId(threadId);
      if (!sidebarOpenRef.current) toggleSidebarRef.current();
      setSidebarRequest({ tab: "comments", at: Date.now() });
    },
    [],
  );
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  const [focusedBlock, setFocusedBlock] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [folderOpen, setFolderOpen] = useState(false);
  // The find & replace bar: open with or without the replace row; `key` bumps on every ⌘F to refocus it.
  const [findBar, setFindBar] = useState<{ replace: boolean; key: number } | null>(null);
  const noteRef = useRef<HTMLDivElement>(null);
  const notes = useNoteActions();
  const inspectorRef = useRef<HTMLDivElement>(null);
  // Below 1200px the inspector folds into an icon rail on the note, and opens as a floating panel.
  const dockButtons = useRef<Partial<Record<InspectorTab, HTMLButtonElement | null>>>({});
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
      await db.put("blocks", { documentId, blocks: server.blocks, cachedAt: Date.now() });
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

  // Idle and close snapshots: meaningful versions, never one per keystroke.
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

  // Leaving the page inside the app (another page, Home…) also saves a "close" version, after the
  // page's queued edits have reached the server, so the version includes them.
  const canSnapshot = Boolean(meta && meta.access !== "read" && meta.access !== "comment");
  const canSnapshotRef = useRef(canSnapshot);
  canSnapshotRef.current = canSnapshot;
  useEffect(() => {
    return () => {
      if (!lastEditAt.current || !canSnapshotRef.current) return;
      lastEditAt.current = null;
      const snap = () => void createSnapshot({ documentId, reason: "close" }).catch(() => undefined);
      // Let the editor flush its last keystrokes into the queue first (its cleanup may run after ours).
      setTimeout(() => {
        if (!engine || !engine.hasLocalWork(documentId)) return snap();
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          unsubscribe();
          clearTimeout(timer);
          snap();
        };
        const unsubscribe = engine.subscribe(() => {
          if (!engine.hasLocalWork(documentId)) finish();
        });
        const timer = setTimeout(finish, 30_000);
      }, 0);
    };
  }, [documentId, engine, createSnapshot]);

  const threads = useQuery(api.comments.threads, meta ? { documentId } : "skip");
  const openBlockThread = useCallback((blockId: string, threadId: string | null = null) => setOpenThread({ blockId, threadId }), []);
  // Memoized so the editor's decorations aren't re-sent on every render of this view.
  const conflicts = useMemo(() => engineState.conflicts.filter((c) => c.documentId === documentId), [engineState.conflicts, documentId]);
  const decorations: DecorationInputs = useMemo(
    () => ({
      presence: (presence ?? []).filter((p) => p.focusedBlockId).map((p) => ({ blockId: p.focusedBlockId!, color: p.color, name: p.name })),
      commentBlocks: new Set((threads?.threads ?? []).filter((t) => t.status === "open" && t.blockId).map((t) => t.blockId!)),
      selectedBlocks: new Set<string>(),
      conflictBlocks: new Set(conflicts.map((c) => c.blockId)),
      commentSummaries: new Map((threads?.blocks ?? []).map((b) => [b.blockId, { count: b.comments, lastActivityAt: b.lastActivityAt, unread: b.unread, authors: b.authors }])),
      onOpenComments: openBlockThread,
    }),
    [presence, threads, conflicts, openBlockThread],
  );

  // Deep links: a block (#block-<id>) or a comment thread (#comment-<thread id>). Also re-run when a
  // notification for this note is opened while it's already showing (it dispatches "hashchange").
  const [hashTick, setHashTick] = useState(0);
  useEffect(() => {
    const onHash = () => setHashTick((n) => n + 1);
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const handledHash = useRef<string | null>(null);
  useEffect(() => {
    if (!editor) return;
    const hash = window.location.hash;
    const key = `${documentId}${hash}:${hashTick}`;
    if (!hash || handledHash.current === key) return;
    const block = /^#block-(.+)$/.exec(hash);
    if (block) {
      handledHash.current = key;
      setTimeout(() => editorRef.current?.focusBlock(block[1]!), 150);
      return;
    }
    const comment = /^#comment-(.+)$/.exec(hash);
    if (!comment || !threads) return;
    handledHash.current = key;
    const t = threads.threads.find((x) => x.id === comment[1]);
    if (!t) return;
    if (t.blockId && t.blockExists) {
      // The thread scrolls itself (and its block) into view once the block is on screen.
      setOpenThread({ blockId: t.blockId, threadId: t.id });
    } else showCommentsTab(t.id);
  }, [editor, threads, hashTick, documentId, showCommentsTab]);

  // A folder inside another folder shows its parent in the breadcrumb too (folders nest one level).
  // Read from the note's own scope (it may be open from another context than the current one).
  const org = useQuery(api.organization.sidebar, meta?.folder && meta.isMember ? { scope: documentScope(meta.document) } : "skip");
  const folderInfo = meta?.folder ? org?.folders.find((f) => f.id === meta.folder!.id) : undefined;
  const parentFolder = folderInfo?.parentFolderId ? (org?.folders.find((f) => f.id === folderInfo.parentFolderId) ?? null) : null;

  const summary = meta?.document ?? null;
  const localTitle = pendingCreate && pendingCreate.kind === "document.create" ? pendingCreate.document.title : "";
  const style: DocumentStyle = summary?.style ?? DEFAULT_DOCUMENT_STYLE;
  useDocTab(
    documentId,
    summary?.title || localTitle || "",
    meta === undefined ? (pendingCreate?.kind === "document.create" && !pendingCreate.document.parentDocumentId ? null : undefined) : meta?.breadcrumbs[0] ? { id: meta.breadcrumbs[0].id, title: meta.breadcrumbs[0].title || "Untitled" } : null,
  );
  // Page and text colours: the chosen ones, or on Auto, taken from the note's artwork.
  // A note style can be the person's own image: its signed URL comes from the server, and its page and
  // text colours are picked from it.
  const { url: coverImageUrl, palette: coverPalette } = useCoverImage(summary?.cover);
  const sheetAttrs = sheetProps(style, summary?.cover ?? DEFAULT_COVER, coverPalette);
  const blurredBackdrop = style.blur ? pageBackdrop(style, summary?.cover ?? DEFAULT_COVER, coverImageUrl) : undefined;
  // The note's style lights the glass chrome around it (a small image: it's heavily blurred anyway).
  const { setAmbient } = useShell();
  const ambientCover = summary?.cover ?? DEFAULT_COVER;
  const ambientArt = coverArtOf(ambientCover);
  const ambient = ambientArt
    ? `url(${coverArtThumbUrl(ambientArt.id)}) center / cover no-repeat`
    : ambientCover.kind === "image"
      ? (coverImageUrl ? `url(${JSON.stringify(coverImageUrl)}) center / cover no-repeat` : null)
      : (pageBackdrop(style, ambientCover, coverImageUrl) ?? null);
  useEffect(() => {
    setAmbient(ambient);
  }, [ambient, setAmbient]);
  useEffect(() => () => setAmbient(null), [setAmbient]);
  const readOnly = Boolean(meta && (meta.access === "read" || meta.access === "comment" || meta.inTrash)) || Boolean(settings?.readOnly && !profile.platformRole);

  // Move focus from the title into the body synchronously (Tiptap's focus() waits a frame, and keystrokes
  // typed in between would land in the title). If the editor isn't mounted yet, focus it when it is.
  const wantsBodyFocus = useRef(false);
  const everReady = useRef(false);
  const focusEditorStart = useCallback(() => {
    if (!editor) {
      wantsBodyFocus.current = true;
      return;
    }
    editor.view.focus();
    editor.commands.setTextSelection(1);
  }, [editor]);
  useEffect(() => {
    if (editor && wantsBodyFocus.current) {
      wantsBodyFocus.current = false;
      editor.view.focus();
      editor.commands.setTextSelection(1);
    }
  }, [editor]);

  // The page tools open as a floating panel above the bottom dock: focus moves into it when it opens,
  // Escape closes it and returns focus to the dock button that opened it.
  const wasOpen = useRef(inspectorOpen);
  const inspectorOpener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const opened = inspectorOpen && !wasOpen.current;
    wasOpen.current = inspectorOpen;
    if (opened && document.activeElement instanceof HTMLElement) inspectorOpener.current = document.activeElement;
    if (!opened) return;
    const id = requestAnimationFrame(() => {
      const aside = inspectorRef.current;
      if (aside && !aside.contains(document.activeElement)) aside.querySelector<HTMLElement>('[role="tab"][aria-selected="true"], button, input, select')?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [inspectorOpen]);
  const closeInspector = useCallback(() => {
    setInspectorOpen(false);
    // Back to whatever had focus when it opened (the editor after a click, the dock button from the
    // keyboard), or the dock button for this tab.
    requestAnimationFrame(() => {
      const opener = inspectorOpener.current;
      (opener?.isConnected && opener !== document.body && !inspectorRef.current?.contains(opener) ? opener : (dockButtons.current[inspectorTab] ?? dockButtons.current.format))?.focus();
    });
  }, [setInspectorOpen, inspectorTab]);

  // AI: a selection rewrite from the editor's toolbar, or "ask AI to write" from the slash menu, opens the
  // AI panel (and runs the rewrite there).
  const [aiRun, setAiRun] = useState<(AiRunDetail & { id: number }) | null>(null);
  // AI follows the note's own scope (your Personal: your Personal plan; a team: its workspace plan).
  const aiOn = useAiEnabled(meta?.document);
  // AI turned off while its panel is open: show another tool instead.
  useEffect(() => {
    if (!aiOn && inspectorTab === "ai") setInspectorTab("format");
  }, [aiOn, inspectorTab]);
  useEffect(() => {
    if (!aiOn) return;
    const onRun = (e: Event) => {
      setAiRun({ ...(e as CustomEvent<AiRunDetail>).detail, id: Date.now() });
      setInspectorTab("ai");
      setInspectorOpen(true);
    };
    const onOpen = () => {
      setInspectorTab("ai");
      setInspectorOpen(true);
    };
    window.addEventListener(AI_RUN_EVENT, onRun);
    window.addEventListener(AI_OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener(AI_RUN_EVENT, onRun);
      window.removeEventListener(AI_OPEN_EVENT, onOpen);
    };
  }, [setInspectorOpen, aiOn]);

  // ⌘F finds in the note and ⌘⌥F replaces, while focus is in the note (or nowhere in particular);
  // anywhere else the browser's own find still works.
  const openFind = useCallback((replace: boolean) => setFindBar((f) => ({ replace, key: (f?.key ?? 0) + 1 })), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.code !== "KeyF" || !editor) return;
      const active = document.activeElement;
      if (active && active !== document.body && !noteRef.current?.contains(active)) return;
      e.preventDefault();
      openFind(e.altKey);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editor, openFind]);

  // A block: its thread floats under it. Otherwise the Comments panel (every thread in the note).
  const openComments = useCallback(
    (blockId?: string) => {
      if (blockId) {
        openBlockThread(blockId);
        return;
      }
      showCommentsTab(null);
    },
    [showCommentsTab, openBlockThread],
  );
  const closeThread = useCallback(() => setOpenThread(null), []);

  // ⌘⌥M: comment on the block with the caret (or open the Comments panel).
  const canComment = Boolean(threads?.canComment);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || !e.altKey || e.shiftKey || e.code !== "KeyM") return;
      e.preventDefault();
      const $from = editor?.state.selection.$from;
      const inEditor = Boolean(editor && editor.view.dom.contains(document.activeElement));
      const blockId = inEditor && $from && $from.depth >= 1 ? ($from.node(1).attrs.id as string | null) : null;
      if (blockId && canComment) openBlockThread(blockId);
      else openComments();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editor, canComment, openBlockThread, openComments]);

  const noteNotify = useNoteNotifyItems(documentId, Boolean(meta));
  const docActions = useDocumentActions({
    documentId,
    title: meta?.document.title ?? "",
    starred: meta?.document.starred ?? false,
    archived: Boolean(meta?.document.archivedAt),
    inTrash: meta?.inTrash ?? false,
    kind: meta?.document.kind ?? "document",
    canManage: meta?.access === "manage" || meta?.access === "write",
    blocks: () => engine?.documentBlocks(documentId) ?? [],
    onHistory: () => setHistoryOpen(true),
    onShare: () => setShareOpen(true),
    onInfo: () => {
      setInspectorTab("info");
      setInspectorOpen(true);
    },
    onDelete: () => setDeleteOpen(true),
    onMove: () => setMoveOpen(true),
    onFind: editor ? () => openFind(!readOnly) : undefined,
    // Top-level notes of the current context (Personal or a workspace) can be filed; nested pages follow their parent page.
    onMoveToFolder:
      meta && !readOnly && inCurrentScope(meta.document, meta.isMember, scopeKey) && !meta.document.parentDocumentId && meta.document.kind !== "template" && (meta.access === "write" || meta.access === "manage")
        ? () => setFolderOpen(true)
        : undefined,
    client: convex,
  });
  // Plus following or muting this note's comment notifications.
  const actions: (MenuItem | "separator")[] = noteNotify.length ? [...docActions, "separator", ...noteNotify] : docActions;

  if (meta === null && !pendingCreate && (server === null || server === undefined) && (online || cacheLoaded)) {
    if (meta === null && server === null) {
      return (
        <ViewChrome title="Unavailable">
          {sidebarSlot
            ? createPortal(
                <DocumentSidebar documentId={documentId} title="Unavailable page" trail={[{ href: "/documents", label: "Home" }]} editor={null} readOnly onJump={() => undefined} onHide={toggleSidebar} onNavigate={drawerMode ? toggleSidebar : undefined} />,
                sidebarSlot,
              )
            : null}
          <div className="mx-auto max-w-lg px-6 py-24 text-center">
            <h1 className="ui-display text-4xl">This page isn’t available</h1>
            <p className="mt-3 text-muted">It may have been deleted, or you don’t have access. If someone shared it with you, ask them to check the sharing settings.</p>
            <AppLink href="/documents" className="mt-6 inline-block text-accent underline underline-offset-2">
              Back to Home
            </AppLink>
          </div>
        </ViewChrome>
      );
    }
  }

  // Mount the editor only once the engine holds this document's blocks (server, local cache, or a new page).
  // A page created on this device (not from a template) is known to be empty, so it can open immediately.
  const freshLocalPage = Boolean(pendingCreate) && pendingCreate?.kind === "document.create" && !pendingCreate.document.templateId;
  const readyNow = Boolean(engine) && (reconciled || (cacheLoaded && server === undefined) || freshLocalPage || (Boolean(pendingCreate) && !online));
  // Once mounted, the editor stays mounted: remounting would drop focus and unflushed keystrokes while
  // the page's queries settle (e.g. metadata arriving before its block list right after creation).
  if (readyNow) everReady.current = true;
  const ready = everReady.current;

  const trail: Crumb[] = [
    ...(parentFolder ? [{ href: `/folders/${parentFolder.id}`, label: parentFolder.name }] : []),
    meta?.folder ? { href: `/folders/${meta.folder.id}`, label: meta.folder.name } : { href: "/drafts", label: "Drafts" },
    ...(meta?.breadcrumbs ?? []).map((b) => ({ href: `/d/${b.id}`, label: b.title || "Untitled", icon: null })),
  ];
  const pageTitle = summary?.title || localTitle || "Untitled";

  return (
    <NotePaletteProvider colors={styleColorsOf(summary?.cover ?? DEFAULT_COVER, coverPalette)} active={sheetAttrs["data-palette"] !== undefined}>
    <ViewChrome
      tabTitle={pageTitle}
      title={
        sidebarOpen ? (
          readOnly ? <span className="ui-chip h-6 bg-sunken text-[11px] text-muted">{meta?.inTrash ? "In Trash" : "View only"}</span> : null
        ) : (
        <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-0.5 text-[13.5px]">
          {parentFolder ? (
            <>
              <AppLink href={`/folders/${parentFolder.id}`} className="flex min-w-0 max-w-[10rem] items-center gap-1.5 truncate rounded-[6px] px-2 py-1 text-muted transition-colors hover:bg-accent-soft hover:text-heading">
                <Folder size={14} className="flex-none" aria-hidden />
                <span className="truncate">{parentFolder.name}</span>
              </AppLink>
              <ChevronRight size={13} className="flex-none text-faint" aria-hidden />
            </>
          ) : null}
          <AppLink href={meta?.folder ? `/folders/${meta.folder.id}` : "/documents"} className="flex min-w-0 max-w-[12rem] items-center gap-1.5 truncate rounded-[6px] px-2 py-1 text-muted transition-colors hover:bg-accent-soft hover:text-heading">
            {meta?.folder ? (
              <>
                <Folder size={14} className="flex-none" aria-hidden />
                <span className="truncate">{meta.folder.name}</span>
              </>
            ) : (
              <>
                <Home size={14} className="flex-none" aria-hidden />
                <span className="truncate">Home</span>
              </>
            )}
          </AppLink>
          <ChevronRight size={13} className="flex-none text-faint" aria-hidden />
          {meta?.breadcrumbs.map((b) => (
            <span key={b.id} className="flex min-w-0 items-center gap-0.5">
              <AppLink href={`/d/${b.id}`} className="max-w-[12rem] truncate rounded-[6px] px-2 py-1 text-muted transition-colors hover:bg-accent-soft hover:text-heading">
                {b.title || "Untitled"}
              </AppLink>
              <ChevronRight size={13} className="flex-none text-faint" aria-hidden />
            </span>
          ))}
          <span className="truncate rounded-[6px] px-2 py-1 font-semibold text-heading" aria-current="page">
            {summary?.title || localTitle || "Untitled"}
          </span>
          {readOnly ? <span className="ui-chip ml-1 h-6 flex-none bg-sunken text-[11px] text-muted">{meta?.inTrash ? "In Trash" : "View only"}</span> : null}
        </nav>
        )
      }
    >
      {sidebarSlot
        ? createPortal(
            <DocumentSidebar
              documentId={documentId}
              title={pageTitle}
              trail={trail}
              editor={editor}
              readOnly={readOnly}
              onJump={(id) => {
                editorRef.current?.focusBlock(id);
                if (drawerMode) toggleSidebar();
              }}
              onHide={toggleSidebar}
              onNavigate={drawerMode ? toggleSidebar : undefined}
              request={sidebarRequest}
              focusThreadId={focusThreadId}
              onOpenThread={(t) => {
                if (!t.blockId) return;
                if (drawerMode) toggleSidebar();
                editorRef.current?.focusBlock(t.blockId);
                setOpenThread({ blockId: t.blockId, threadId: t.id });
              }}
            />,
            sidebarSlot,
          )
        : null}
      {/* The note floats on its backdrop in a rounded panel; the chrome (sidebars, inspector) sits flat behind. */}
      <div className="flex h-full min-h-0">
        <div ref={noteRef} className="relative min-w-0 flex-1 px-1.5 pb-2 sm:px-0 sm:pb-0">
        {findBar && editor ? <FindBar editor={editor} withReplace={findBar.replace} focusKey={findBar.key} readOnly={readOnly} onClose={() => setFindBar(null)} /> : null}

        {/* Blur background: the backdrop sits blurred behind the scrolling page, which is then see-through. */}
        {blurredBackdrop ? <BlurredBackdrop background={blurredBackdrop} className="inset-x-1.5 bottom-2 top-0 rounded-[14px] sm:inset-0" /> : null}
        <div
          id="doc-scroll"
          ref={setScrollEl}
          className={`fb-page relative h-full overflow-y-auto rounded-[14px] px-3 pt-8 shadow-[var(--glass-edge),var(--glass-shadow)] ${inspectorOpen ? "pb-[min(700px,70vh)]" : "pb-28"} sm:px-8`}
          data-backdrop={pageBackdrop(style, summary?.cover ?? DEFAULT_COVER, coverImageUrl) ? (blurredBackdrop ? "blur" : "on") : undefined}
          data-font={style.font}
          data-width={style.width}
          style={{
            ["--doc-accent" as string]: style.accent === "accent" ? "var(--color-ember)" : `var(--color-${style.accent})`,
            ["--doc-accent-ink" as string]: style.accent === "accent" ? "var(--color-ember-ink)" : `var(--color-${style.accent}-ink)`,
            ["--doc-accent-soft" as string]: style.accent === "accent" ? "var(--color-ember-soft)" : `var(--color-${style.accent}-soft)`,
            background: blurredBackdrop ? "transparent" : (pageBackdrop(style, summary?.cover ?? DEFAULT_COVER, coverImageUrl) ?? "var(--color-surface-sunken)"),
          }}
        >
          <article
            className="fb-sheet ui-sheet relative mx-auto animate-[folio-settle_240ms_var(--ease-folio)]"
            data-background={style.background}
            {...sheetAttrs}
            data-separator={style.separator}
            style={{ ...sheetAttrs.style, maxWidth: "calc(var(--editor-width) + 8rem)" }}
          >
            <DocumentHeader
              documentId={documentId}
              note={meta?.document}
              title={summary?.title ?? localTitle}
              cover={summary?.cover ?? DEFAULT_COVER}
              style={style}
              revision={summary?.revision ?? null}
              readOnly={readOnly}
              onEnter={focusEditorStart}
              hasContent={Boolean(summary?.excerpt?.trim())}
            />
            {conflicts.length ? <ConflictBanner documentId={documentId} /> : null}
            <div className="px-5 sm:px-16">
              <CollectionRowProperties documentId={documentId} editable={!readOnly} />
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
                  onExitTop={() => {
                    // ↑ from the first line goes to the end of the title.
                    const title = document.getElementById(`title-${documentId}`) as HTMLTextAreaElement | null;
                    if (!title || title.readOnly) return false;
                    title.focus();
                    title.setSelectionRange(title.value.length, title.value.length);
                    return true;
                  }}
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
          {openThread && threads ? (
            <BlockThread
              key={openThread.blockId}
              documentId={documentId}
              data={threads}
              blockId={openThread.blockId}
              threadId={openThread.threadId}
              scrollEl={scrollEl}
              editor={editor}
              onSelect={(threadId) => setOpenThread({ blockId: openThread.blockId, threadId })}
              onClose={closeThread}
              onMissing={() => {
                // The block isn't on screen (deleted or folded away): show the thread in the Comments tab.
                closeThread();
                showCommentsTab(openThread.threadId);
              }}
            />
          ) : null}
        </div>
        <PageDock
          ai={aiOn}
          tab={inspectorTab}
          open={inspectorOpen}
          onPick={(t) => {
            if (inspectorOpen && inspectorTab === t) closeInspector();
            else {
              setInspectorTab(t);
              setInspectorOpen(true);
            }
          }}
          buttonRef={(t, el) => {
            dockButtons.current[t] = el;
          }}
          extra={
            <div role="group" aria-label="Page" className="flex items-center gap-0.5">
              <PresenceAvatars people={presence ?? []} />
              {summary ? (
                <MenuButton
                  label="Document actions"
                  side="top"
                  align="end"
                  triggerClassName="grid h-10 w-10 place-items-center rounded-[6px] text-ink transition-colors hover:bg-accent-soft hover:text-heading focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                  trigger={<MoreHorizontal size={16} aria-hidden />}
                  items={actions}
                />
              ) : null}
            </div>
          }
        />
        {inspectorOpen ? (
          <div
            ref={inspectorRef}
            id="document-inspector"
            onKeyDown={(e) => {
              if (e.key === "Escape" && !e.defaultPrevented) {
                e.preventDefault();
                closeInspector();
              }
            }}
            className="ui-pop absolute bottom-[84px] left-1/2 z-30 flex max-h-[min(640px,calc(100%-112px))] w-[min(400px,calc(100%-24px))] -translate-x-1/2 flex-col overflow-hidden rounded-[14px] animate-[folio-rise_180ms_var(--ease-folio)] motion-reduce:animate-none [&>div]:min-h-0"
          >
            <Inspector
              documentId={documentId}
              editor={editor}
              meta={meta ?? null}
              tab={inspectorTab}
              onTab={setInspectorTab}
              focusThreadId={focusThreadId}
              onOpenThread={(t) => {
                if (!t.blockId) return;
                // The panel floats over the note: step aside so the thread under its block is visible.
                setInspectorOpen(false);
                editorRef.current?.focusBlock(t.blockId);
                setOpenThread({ blockId: t.blockId, threadId: t.id });
              }}
              onClose={closeInspector}
              onHistory={() => setHistoryOpen(true)}
              actions={actions}
              readOnly={readOnly}
              hideTabs
              aiRun={aiRun}
              onAiTitle={(title) => engine?.updateDocument(documentId, { title }, meta?.document.revision ?? null)}
            />
          </div>
        ) : null}
        </div>
      </div>
      {meta ? <ShareDialog open={shareOpen} onClose={() => setShareOpen(false)} documentId={documentId} title={summary?.title ?? ""} personal={meta.document.workspaceId === null} /> : null}
      <VersionHistory open={historyOpen} onClose={() => setHistoryOpen(false)} documentId={documentId} canRestore={!readOnly} />
      {meta && !readOnly ? (
        <MovePageDialog open={moveOpen} onClose={() => setMoveOpen(false)} documentId={documentId} title={summary?.title ?? ""} currentParentId={meta.breadcrumbs[meta.breadcrumbs.length - 1]?.id ?? null} home={meta.isMember ? documentScope(meta.document) : null} />
      ) : null}
      <PermanentDeleteDialog open={deleteOpen} onClose={() => setDeleteOpen(false)} documentId={documentId} title={summary?.title ?? ""} />
      {meta ? (
        <MoveToFolderDialog
          open={folderOpen}
          onClose={() => setFolderOpen(false)}
          noteTitle={summary?.title ?? ""}
          currentFolderId={meta.document.folderId}
          onPick={(folder) => void notes.moveTo([documentId], folder)}
        />
      ) : null}
    </ViewChrome>
    </NotePaletteProvider>
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



function DocumentHeader({
  documentId,
  note,
  title,
  cover,
  style,
  revision,
  readOnly,
  onEnter,
  hasContent = false,
}: {
  documentId: string;
  /** Where the note lives (decides whether AI is included). */
  note?: DocumentHome;
  /** The note has body text (so the AI has something to title). */
  hasContent?: boolean;
  title: string;
  cover: { kind: string; value?: string };
  style: DocumentStyle;
  revision: number | null;
  readOnly: boolean;
  onEnter: () => void;
}) {
  const { engine } = useAppState();
  const { search } = useAppRouter();
  const [value, setValue] = useState(title);
  // The title we last saved locally; the server value is ignored until it catches up to it.
  const pendingTitle = useRef<string | null>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  // Every title this field saved. The server's copy can arrive late, and out of order with newer saves: one
  // of these coming back is our own earlier version, never a reason to replace what's being typed.
  const savedTitles = useRef(new Set<string>());
  useEffect(() => {
    if (pendingTitle.current !== null) {
      if (title !== pendingTitle.current) return;
      pendingTitle.current = null;
    }
    const field = titleRef.current;
    if (field && document.activeElement === field && savedTitles.current.has(title) && title !== field.value) return;
    setValue(title);
  }, [title]);
  // If the server refuses our title (e.g. conflict), show what the server has.
  useEffect(() => {
    if (!engine) return;
    return engine.subscribe((e) => {
      if (e.type !== "document-result") return;
      const doc = (e.result as { document?: { id: string; title: string } }).document;
      if (doc?.id === documentId && e.result.status !== "applied" && e.result.status !== "duplicate") {
        pendingTitle.current = null;
        setValue(doc.title);
      }
    });
  }, [engine, documentId]);
  // Focus the title once for a brand-new page (never again, so it can't steal focus later).
  const focusedOnce = useRef(false);
  useEffect(() => {
    if (focusedOnce.current || search.get("new") !== "1") return;
    focusedOnce.current = true;
    titleRef.current?.focus();
  }, [search]);
  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushTitle = useRef<(() => void) | null>(null);
  const aiOn = useAiEnabled(note);
  const { write } = useAi();
  const toast = useToast();
  const [suggesting, setSuggesting] = useState(false);
  // The title's own AI menu (the editor's selection menu doesn't reach this textarea).
  const [titleSel, setTitleSel] = useState<TitleRange | null>(null);
  const [titleAi, setTitleAi] = useState<TitleRange | null>(null);
  const readSel = (): TitleRange => {
    const el = titleRef.current;
    return { start: el?.selectionStart ?? 0, end: el?.selectionEnd ?? 0 };
  };
  const save = (next: string) => {
    // What the server will store (it replaces control characters and keeps 300 characters), so its echo matches.
    pendingTitle.current = next.replace(/[\u0000-\u001F\u007F]/g, " ").slice(0, 300);
    savedTitles.current.add(pendingTitle.current);
    if (timer.current) clearTimeout(timer.current);
    const key = `title:${documentId}`;
    const commit = () => {
      timer.current = null;
      flushTitle.current = null;
      engine?.updateDocument(documentId, { title: next }, revision);
      engine?.setEditing(key, false);
    };
    engine?.setEditing(key, true);
    flushTitle.current = commit;
    timer.current = setTimeout(commit, 300);
  };
  // Leaving the page (or the tab) never drops a title still waiting for its debounce.
  useEffect(() => {
    const onHide = () => {
      if (timer.current) clearTimeout(timer.current);
      flushTitle.current?.();
    };
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      onHide();
    };
  }, [documentId]);
  const { url: imageUrl, palette } = useCoverImage(cover as never);
  const bg = coverBackground(cover as never, style, imageUrl);
  // With a cover, the title sits on it over a soft shade: white on deep covers, the style's dark ink on
  // light ones, chosen by how light the band behind the title reads (a person's image: white until known).
  const art = coverArtOf(cover as never);
  const onCover = Boolean(bg);
  const ownImage = (cover as { kind?: string }).kind === "image";
  const tone = art ? art.tone : ownImage ? (palette?.tone ?? "deep") : null;
  const lightImage = tone === "light";
  const whiteTitle = tone === "deep";
  const titleColor = !onCover || !tone ? undefined : whiteTitle ? "#ffffff" : (art?.ink ?? palette?.ink);
  const titleField = (
    <>
      <label htmlFor={`title-${documentId}`} className="sr-only">
        Title
      </label>
      {/* The page title is the page's h1 (content headings start at h2); editing stays a textarea. */}
      <h1 aria-label={value || "Untitled"} className="m-0 p-0 font-[inherit] text-[length:inherit]">
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
          onSelect={() => {
            const r = readSel();
            setTitleSel(r.start !== r.end ? r : null);
          }}
          onBlur={() => setTitleSel(null)}
          onKeyDown={(e) => {
            if (!readOnly && aiOn && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "j") {
              // In the title, ⌘J edits the title (the app-wide ⌘J opens Ask AI).
              e.preventDefault();
              e.stopPropagation();
              setTitleAi(readSel());
              return;
            }
            // Enter that confirms an input method's composition (Chinese, Japanese…) stays in the title.
            if (e.nativeEvent.isComposing || e.keyCode === 229) return;
            if (e.key === "Enter" || (e.key === "ArrowDown" && titleRef.current?.selectionStart === value.length)) {
              e.preventDefault();
              onEnter();
            }
          }}
          style={titleColor ? { color: titleColor, textShadow: whiteTitle ? "0 1px 14px rgb(0 0 0 / 0.4)" : "0 1px 12px rgb(255 255 255 / 0.5)" } : undefined}
          className={`block w-full resize-none overflow-hidden bg-transparent text-[40px] font-semibold leading-[1.12] outline-none ${titleColor ? "placeholder:text-current placeholder:opacity-55" : "text-heading placeholder:text-[var(--color-ink-faint)]"} ${onCover ? "" : "mt-4"} ${style.font === "mono" ? "font-mono text-[34px] tracking-[-0.02em]" : style.font === "rounded" ? "font-rounded tracking-[-0.02em]" : "font-serif tracking-[-0.012em]"}`}
          aria-describedby={readOnly ? `ro-${documentId}` : undefined}
        />
      </h1>
      {!readOnly && aiOn && titleSel && !titleAi ? <TitleAiPill anchor={titleRef.current} onOpen={() => setTitleAi(titleSel)} /> : null}
      {!readOnly && aiOn && titleAi ? (
        <TitleAi
          anchor={titleRef.current}
          documentId={documentId}
          title={value}
          range={titleAi}
          hasContent={hasContent}
          onClose={() => setTitleAi(null)}
          onApply={(next) => {
            const before = value;
            setTitleAi(null);
            setTitleSel(null);
            if (next === before) return;
            setValue(next);
            save(next);
            titleRef.current?.focus();
            toast.show("Title updated", {
              action: {
                label: "Undo",
                onClick: () => {
                  setValue(before);
                  save(before);
                },
              },
            });
          }}
        />
      ) : null}
      {readOnly ? (
        <p id={`ro-${documentId}`} className="sr-only">
          This document is read-only for you.
        </p>
      ) : null}
      {/* An untitled note with some writing: the AI can name it. */}
      {!readOnly && aiOn && hasContent && !value.trim() ? (
        <button
          type="button"
          disabled={suggesting}
          onClick={async () => {
            setSuggesting(true);
            try {
              const { text } = await write("title", { documentId });
              if (text && !pendingTitle.current?.trim()) {
                setValue(text);
                save(text);
              }
            } catch (e) {
              toast.show(errorMessage(e), { tone: "error" });
            } finally {
              setSuggesting(false);
            }
          }}
          className={`mt-2 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12.5px] font-medium backdrop-blur-md transition-colors disabled:opacity-60 ${titleColor ? "bg-black/20 text-white hover:bg-black/30" : "bg-[var(--glass-hover)] text-ink hover:bg-[var(--glass-active)]"}`}
        >
          <AiIcon size={13} aria-hidden className={suggesting ? "animate-pulse motion-reduce:animate-none" : ""} />
          {suggesting ? "Thinking of a title…" : "Suggest a title"}
        </button>
      ) : null}
    </>
  );
  return (
    <header>
      {onCover ? (
        <div className="relative isolate flex min-h-40 items-end overflow-hidden rounded-t-[6px] border-b border-line/60 px-5 pb-6 pt-14 sm:min-h-48 sm:px-16">
          {/* The style's image under a film grain (dark specks on covers that read deep, white on light ones),
              with a shade under the title. */}
          <div aria-hidden data-cover-image="" className="absolute inset-0 -z-10" style={{ background: bg }} />
          <div aria-hidden data-tone={tone ?? "deep"} className="fb-cover-grain absolute inset-0 -z-10" />
          {tone ? (
            <div aria-hidden className="absolute inset-0 -z-10" style={{ background: `linear-gradient(180deg, transparent 35%, ${lightImage ? "rgb(255 255 255 / 0.45)" : "rgb(0 0 0 / 0.4)"})` }} />
          ) : null}
          <div className="w-full">{titleField}</div>
        </div>
      ) : (
        <>
          <div className="h-10" aria-hidden />
          <div className="px-5 sm:px-16">{titleField}</div>
        </>
      )}
      <div className="px-5 sm:px-16">
        <div className={onCover ? "mb-2 mt-4" : "mb-4 mt-1"} />
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
    <section role="alert" aria-labelledby={`conflict-${c.id}`} className="mx-5 mb-5 rounded-[6px] bg-plum-soft p-4 shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--color-plum)_30%,transparent)] sm:mx-16">
      <h2 id={`conflict-${c.id}`} className="text-sm font-semibold text-plum-ink">
        {conflicts.length === 1 ? "This block was changed in two places" : `${conflicts.length} blocks were changed in two places`}
      </h2>
      <p className="mt-1 text-sm text-ink">Both versions are kept. Nothing is lost until you choose.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="ui-card rounded-[8px] p-3">
          <p className="ui-caps">{c.reason === "deleted" ? "Deleted elsewhere" : "Version from elsewhere"}</p>
          <p className="mt-1 whitespace-pre-wrap text-sm">{c.reason === "deleted" ? "Someone deleted this block." : text(c.server)}</p>
        </div>
        <div className="ui-card rounded-[8px] p-3 shadow-[var(--shadow-card),0_0_0_2px_color-mix(in_oklab,var(--color-ember)_45%,transparent)]">
          <p className="ui-caps">Your version</p>
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
          <Select aria-label="Choose conflict" value={c.id} onChange={(e) => setOpenId(e.target.value)} className="ml-auto h-8 ui-raised rounded-[6px] px-3 text-xs">
            {conflicts.map((x, i) => (
              <option key={x.id} value={x.id}>
                Conflict {i + 1}
              </option>
            ))}
          </Select>
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
              <FileText size={14} aria-hidden className="flex-none text-muted" />
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
                  <FileText size={14} aria-hidden className="flex-none text-muted" />
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

/** The page's actions, shown in the "…" menu and in Info → Actions. */
function useDocumentActions({
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
  onInfo,
  onDelete,
  onMove,
  onFind,
  onMoveToFolder,
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
  /** Opens the page's Info panel (words, dates, backlinks…). */
  onInfo?: () => void;
  onDelete: () => void;
  onMove: () => void;
  /** Opens the find & replace bar (absent until the editor is ready). */
  onFind?: () => void;
  /** Opens the folder picker (absent where a note can't be filed: nested pages, templates, view-only). */
  onMoveToFolder?: () => void;
  client: ReturnType<typeof useConvex>;
}): (MenuItem | "separator")[] {
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
      (r) => {
        const n = r.missingAssets.length;
        if (!n) toast.show(`${label} export ready`);
        else
          toast.show(
            `${label} export ready, but ${n === 1 ? `“${r.missingAssets[0]}” couldn’t be included` : `${n} attachments couldn’t be included`} (not available or not uploaded yet).`,
            { tone: "error", duration: 10_000 },
          );
      },
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
        ...(onInfo ? [{ label: "Info", icon: <Info size={14} />, onSelect: onInfo }] : []),
        { label: "Version history…", icon: <History size={14} />, onSelect: onHistory },
        ...(onFind ? [{ label: canManage ? "Find and replace…" : "Find in note…", icon: <Search size={14} />, shortcut: canManage ? "⌘⌥F" : "⌘F", onSelect: onFind }] : []),
        ...(onMoveToFolder ? [{ label: "Move to folder…", icon: <Folder size={14} />, onSelect: onMoveToFolder }] : []),
        { label: "Move to page…", icon: <FolderInput size={14} />, disabled: !canManage, onSelect: onMove },
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
  return items;
}

