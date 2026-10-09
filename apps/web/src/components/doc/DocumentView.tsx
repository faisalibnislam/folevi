"use client";

import { useConvex, useMutation, useQuery } from "convex/react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Editor as TiptapEditor } from "@tiptap/react";
import { AiIcon } from "@/components/ai/AiIcon";
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  ChevronRight,
  Copy,
  FileCode,
  FileText,
  Folder,
  FolderInput,
  History,
  LayoutTemplate,
  Info,
  Link2,
  Lock,
  MoreHorizontal,
  Printer,
  Search,
  MessageSquare,
  Share2,
  Star,
  StarOff,
  Trash2,
  Undo2,
  Users,
  House as Home,
} from "lucide-react";
import { DEFAULT_COVER, DEFAULT_DOCUMENT_STYLE, rankForPosition, type DocumentStyle, type WireBlock } from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";
import { formatRelative } from "@/lib/format";
import { Avatar } from "@/components/ui/Avatar";
import { useAppState } from "@/lib/app/state";
import { documentScope, inCurrentScope, type DocumentHome } from "@/lib/app/scope";
import { AppLink, useAppRouter } from "@/lib/app/router";
import { sameItems, useEngineSelector, useLocalStorage } from "@/lib/hooks/useEngine";
import { useMediaQuery } from "@/lib/hooks/useMediaQuery";
import { localDb } from "@/lib/sync/db";
import { Button } from "@/components/ui/Button";
import { MenuButton, type MenuItem } from "@/components/ui/Menu";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { ViewChrome, useShell } from "@/components/app/Shell";
import { setBlockHighlight } from "@/components/editor/blockHighlight";
import { usePageBreakMask } from "./usePageBreakMask";
import { Editor, type EditorHandle } from "@/components/editor/Editor";
import type { DecorationInputs } from "@/components/editor/plugins";
import { coverArtOf, coverArtThumbUrl, coverBackground, pageBackdrop, sheetProps, styleColorsOf } from "@/lib/cover";
import { BlurredBackdrop } from "./BlurredBackdrop";
import { NotePaletteProvider } from "@/components/editor/notePalette";
import { useCoverImage } from "@/lib/app/coverImage";
import { PermanentDeleteDialog } from "@/components/views/DocumentBrowser";
import { Inspector, type InspectorTab } from "./Inspector";
import { BlockThread, useNoteNotifyItems } from "./Comments";
import { AI_OPEN_EVENT, AI_RUN_EVENT, NoteAiContext, useAi, useAiEnabled, type AiRunDetail, type NoteAi } from "@/components/ai/useAi";
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
import { useKeyboardInset } from "@/lib/hooks/useVisualViewport";
import "@/components/editor/editor.css";
import "@/components/editor/insert-blocks.css";
import "@/components/editor/flowchart/flowchart.css";
import { Select } from "@/components/ui/Select";

// Only a collection's row pages have properties; the collection code loads for those alone.
const CollectionRowProperties = lazy(() => import("@/components/editor/CollectionEmbed").then((m) => ({ default: m.CollectionRowProperties })));

const IDLE_SNAPSHOT_MS = 2 * 60_000;

/** When the pointer last went down (to tell a panel opened by mouse from one opened by keyboard). */
let lastPointerDown = 0;

export function DocumentView({ documentId }: { documentId: string }) {
  const { engine, profile, online, scopeKey } = useAppState();
  const convex = useConvex();
  const meta = useQuery(api.documents.get, { documentId });
  const server = useQuery(api.blocks.list, { documentId });
  const settings = useQuery(api.settings.status, {});
  // Who else can open it (the bar's Share button says "Shared"); once the server knows the note.
  const sharing = useQuery(api.sharing.get, meta ? { documentId } : "skip");
  const editorRef = useRef<EditorHandle>(null);
  const [editor, setEditor] = useState<TiptapEditor | null>(null);
  const [cacheLoaded, setCacheLoaded] = useState(false);
  const [reconciled, setReconciled] = useState(false);
  const { inspectorOpen, setInspectorOpen, sidebarSlot, sidebarOpen, toggleSidebar, drawerMode, docSidebarMode, setDocSidebarMode, setNoteAi } = useShell();
  const sidebarOpenRef = useRef(sidebarOpen);
  sidebarOpenRef.current = sidebarOpen;
  const toggleSidebarRef = useRef(toggleSidebar);
  toggleSidebarRef.current = toggleSidebar;
  // The page dock and its panels sit above the on-screen keyboard.
  useKeyboardInset();
  const sidebarModeRef = useRef({ mode: docSidebarMode, set: setDocSidebarMode });
  sidebarModeRef.current = { mode: docSidebarMode, set: setDocSidebarMode };
  // The tools panel (right sidebar) keeps what it showed and its width from note to note.
  const [inspectorTab, setInspectorTab] = useLocalStorage<InspectorTab>("folevi:inspector-tab", "format");
  const [panelWidth, setPanelWidth] = useLocalStorage<number>("folevi:inspector-width", PANEL_DEFAULT);
  const panelOverlays = useMediaQuery("(max-width: 1199px)");
  // The comment thread floating under a block (threadId null: the block's latest open thread, or a new one).
  const [openThread, setOpenThread] = useState<{ blockId: string; threadId: string | null } | null>(null);
  // A thread to open inside the Comments panel (on the whole note or a deleted block).
  const [focusThreadId, setFocusThreadId] = useState<string | null>(null);
  // Opening comments switches the page sidebar to its Comments tab (showing the sidebar first if it's hidden).
  const [sidebarRequest, setSidebarRequest] = useState<{ tab: DocSidebarTab; at: number } | null>(null);
  const showCommentsTab = useCallback(
    (threadId: string | null) => {
      setFocusThreadId(threadId);
      // The left sidebar may be showing folders: switch it back to the page's own (which opens it too).
      if (sidebarModeRef.current.mode === "folders") sidebarModeRef.current.set("document");
      else if (!sidebarOpenRef.current) toggleSidebarRef.current();
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

  // Only what this view shows of the sync state, so a change elsewhere in the account doesn't re-render the note.
  // A queued create never changes, but a flush hands back a copy of it: the same op id is the same create.
  const pendingCreateOp = useEngineSelector(
    engine,
    (s) => s.pending.find((op) => op.kind === "document.create" && op.document.id === documentId) ?? s.inflight.find((op) => op.kind === "document.create" && op.document.id === documentId),
    (a, b) => a?.opId === b?.opId,
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
  // A result whose page counters and block revisions are all unchanged (the query re-ran for something
  // else) has nothing new for the engine. Block revisions count too: renaming a linked page relabels
  // blocks here without touching this page's own counters.
  const reconciledAt = useRef<{ engine: unknown; at: string } | null>(null);
  const cacheWrite = useRef<{ timer: ReturnType<typeof setTimeout>; run: () => void } | null>(null);
  useEffect(() => {
    if (!engine || !server) return;
    let revisions = 0;
    for (const b of server.blocks) revisions += b.revision ?? 0;
    const at = `${server.revision}:${server.contentSeq}:${server.blocks.length}:${revisions}`;
    if (reconciledAt.current?.engine === engine && reconciledAt.current.at === at) return;
    reconciledAt.current = { engine, at };
    editorRef.current?.flush();
    engine.reconcileDocument(documentId, server.blocks);
    editorRef.current?.applyFromEngine();
    setReconciled(true);
    // The offline copy is the whole note: written once typing (and its echoes) settles, not per save.
    const blocks = server.blocks;
    const accountKey = profile.id;
    const run = () => {
      cacheWrite.current = null;
      void (async () => {
        const db = await localDb(accountKey);
        await db.put("blocks", { documentId, blocks, cachedAt: Date.now() });
      })();
    };
    if (cacheWrite.current) clearTimeout(cacheWrite.current.timer);
    cacheWrite.current = { timer: setTimeout(run, 2000), run };
  }, [engine, server, documentId, profile.id]);
  // Leaving the note writes the copy still waiting.
  useEffect(
    () => () => {
      const pending = cacheWrite.current;
      if (!pending) return;
      clearTimeout(pending.timer);
      pending.run();
    },
    [],
  );

  useEffect(() => {
    if (meta) void recordView({ documentId }).catch(() => undefined);
  }, [meta?.document.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Presence heartbeat with the focused block (never leaves the authorization boundary: server-checked).
  const focusedRef = useRef(focusedBlock);
  focusedRef.current = focusedBlock;
  const sentFocus = useRef<string | null | undefined>(undefined);
  const beat = () => {
    sentFocus.current = focusedRef.current;
    void heartbeat({ documentId, sessionId, focusedBlockId: focusedRef.current }).catch(() => undefined);
  };
  useEffect(() => {
    if (!meta || !online) return;
    beat();
    const id = setInterval(beat, 20_000);
    return () => clearInterval(id);
  }, [meta?.document.id, online]); // eslint-disable-line react-hooks/exhaustive-deps
  // Moving through the note tells others where the caret is once it rests, not at every block it passes.
  useEffect(() => {
    if (!meta || !online || focusedBlock === sentFocus.current) return;
    const t = setTimeout(beat, 1500);
    return () => clearTimeout(t);
  }, [meta?.document.id, online, focusedBlock]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => void leave({ documentId, sessionId }).catch(() => undefined), []); // eslint-disable-line react-hooks/exhaustive-deps
  const presenceNow = Math.floor(Date.now() / 15_000) * 15_000;
  const livePresence = useQuery(api.presence.list, meta ? { documentId, now: presenceNow } : "skip");
  // Every 15 seconds `now` moves on and the query starts again from nothing: keep showing the last answer
  // meanwhile, so presence doesn't blink off and on.
  const lastPresence = useRef(livePresence);
  if (livePresence !== undefined) lastPresence.current = livePresence;
  const presence = meta ? (livePresence ?? lastPresence.current) : undefined;

  // Idle and close snapshots: meaningful versions, never one per keystroke.
  const pendingForDoc = useEngineSelector(engine, (s) => s.pending.some((op) => "documentId" in op && op.documentId === documentId) || s.inflight.length > 0);
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
  // The note's conflicted blocks, kept as the same array while they don't change, so the editor's
  // decorations aren't re-sent on every render of this view.
  const conflictBlockIds = useEngineSelector(engine, (s) => s.conflicts.filter((c) => c.documentId === documentId).map((c) => c.blockId), sameItems);
  // "Show editors": who last changed each block, in their colour (people who can edit the page only, like
  // version history).
  const canEditPage = meta?.access === "write" || meta?.access === "manage";
  const [showEditors, setShowEditors] = useState(false);
  const blockAuthors = useQuery(api.documents.blockAuthors, showEditors && canEditPage ? { documentId } : "skip");
  const authorMarks = useMemo(() => {
    if (!blockAuthors) return undefined;
    const marks = new Map<string, { color: string; label: string }>();
    for (const [blockId, key, at] of blockAuthors.authors) {
      const who = blockAuthors.people[key];
      marks.set(blockId, { color: who?.color ?? "ink-muted", label: `${who?.name ?? "Someone"} · ${formatRelative(at)}` });
    }
    return marks;
  }, [blockAuthors]);
  const decorations: DecorationInputs = useMemo(
    () => ({
      presence: (presence ?? []).filter((p) => p.focusedBlockId).map((p) => ({ blockId: p.focusedBlockId!, color: p.color, name: p.name })),
      commentBlocks: new Set((threads?.threads ?? []).filter((t) => t.status === "open" && t.blockId).map((t) => t.blockId!)),
      selectedBlocks: new Set<string>(),
      conflictBlocks: new Set(conflictBlockIds),
      commentSummaries: new Map((threads?.blocks ?? []).map((b) => [b.blockId, { count: b.comments, lastActivityAt: b.lastActivityAt, unread: b.unread, authors: b.authors }])),
      onOpenComments: openBlockThread,
      authors: authorMarks,
    }),
    [presence, threads, conflictBlockIds, openBlockThread, authorMarks],
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
  // How dark the art reads: the style's own tone, or for a person's image, the one picked from it.
  const ambientTone = ambientArt ? ambientArt.tone : ambientCover.kind === "image" ? (coverPalette?.tone ?? null) : null;
  useEffect(() => {
    setAmbient(ambient, ambientTone);
  }, [ambient, ambientTone, setAmbient]);
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
    const onDown = () => {
      lastPointerDown = Date.now();
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, []);
  useEffect(() => {
    const opened = inspectorOpen && !wasOpen.current;
    wasOpen.current = inspectorOpen;
    if (opened && document.activeElement instanceof HTMLElement) inspectorOpener.current = document.activeElement;
    if (!opened) return;
    // Opened with the mouse (the dock keeps the caret in the note): focus stays where the person is
    // writing, so the panel's buttons act on the text and typing carries on. From the keyboard, it moves in.
    if (Date.now() - lastPointerDown < 600 && document.activeElement?.closest(".fb-editor")) return;
    const id = requestAnimationFrame(() => {
      const aside = inspectorRef.current;
      if (aside && !aside.contains(document.activeElement)) (aside.querySelector<HTMLElement>("[data-autofocus]") ?? aside.querySelector<HTMLElement>('[role="tab"][aria-selected="true"], button, input, select'))?.focus();
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

  // AI on a note lives in its right sidebar (the "AI" tool), about this note. A selection rewrite from the
  // editor's toolbar, "ask AI to write" from the slash menu and ⌘J open it.
  const [aiRun, setAiRun] = useState<(AiRunDetail & { id: number }) | null>(null);
  // AI follows the note's own scope (your Personal: your Personal plan; a team: its workspace plan).
  const aiOn = useAiEnabled(meta?.document);
  // The editor's AI (slash commands, ⌘J, the selection toolbar) follows this note too, and a page it writes
  // into an empty note can name it.
  const noteDoc = meta?.document;
  const noteAi = useMemo<NoteAi>(
    () => ({ home: noteDoc ?? null, title: noteDoc?.title ?? "", setTitle: (title) => engine?.updateDocument(documentId, { title }, noteDoc?.revision ?? null) }),
    [noteDoc, engine, documentId],
  );
  // AI in a note is always about this note: its tools open in the sidebar.
  const openAi = useCallback(() => {
    setInspectorTab("ai");
    setInspectorOpen(true);
  }, [setInspectorTab, setInspectorOpen]);
  // AI turned off while its tool is open: show another one instead.
  useEffect(() => {
    if (!aiOn && inspectorTab === "ai") setInspectorTab("format");
  }, [aiOn, inspectorTab, setInspectorTab]);
  useEffect(() => {
    if (!aiOn) return;
    setNoteAi(() => openAi());
    return () => setNoteAi(null);
  }, [aiOn, setNoteAi, openAi]);
  useEffect(() => {
    if (!aiOn) return;
    const onRun = (e: Event) => {
      setAiRun({ ...(e as CustomEvent<AiRunDetail>).detail, id: Date.now() });
      openAi();
    };
    const onOpen = () => openAi();
    window.addEventListener(AI_RUN_EVENT, onRun);
    window.addEventListener(AI_OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener(AI_RUN_EVENT, onRun);
      window.removeEventListener(AI_OPEN_EVENT, onOpen);
    };
  }, [openAi, aiOn]);

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
  // Page breaks cut the sheet so the note's background shows between pages.
  const [sheetEl, setSheetEl] = useState<HTMLElement | null>(null);
  usePageBreakMask(sheetEl);
  // A resolved thread has no comment line under its block: while it's open, its block is highlighted instead.
  const highlightId =
    openThread?.threadId && threads?.threads.some((t) => t.id === openThread.threadId && t.status === "resolved") ? openThread.blockId : null;
  useEffect(() => {
    if (editor && !editor.isDestroyed) setBlockHighlight(editor.view, highlightId);
  }, [editor, highlightId]);

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
    onHistory: canEditPage ? () => setHistoryOpen(true) : undefined,
    onToggleEditors: canEditPage ? () => setShowEditors((on) => !on) : undefined,
    showingEditors: showEditors,
    onShare: () => setShareOpen(true),
    onComments: () => showCommentsTab(null),
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
  // A note this device already holds (opened before, or synced here) shows at once from that copy, and catches
  // up when the server's arrives: switching tabs never waits on the network.
  const heldHere = Boolean(engine) && !pendingCreate && engine!.documentBlocks(documentId).length > 0;
  const readyNow = Boolean(engine) && (reconciled || heldHere || (cacheLoaded && server === undefined) || freshLocalPage || (Boolean(pendingCreate) && !online));
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
  // Shared once anyone else can open it: a public link, people (or a pending invitation), the whole workspace, or
  // it's someone else's page you were given.
  const shareState: "link" | "people" | null = !sharing
    ? null
    : sharing.links.some((l) => !l.expired)
      ? "link"
      : sharing.youAreGuest || sharing.people.some((p) => !p.isYou) || sharing.pendingInvites.length || (sharing.accessMode === "workspace" && meta?.document.workspaceId)
        ? "people"
        : null;
  const others = presence ?? [];
  const pageGroup = (
    <div role="group" aria-label="Page" className="flex items-center gap-0.5">
      {/* Who's here, like Google Docs: you and the others, only while someone else has the note open. */}
      {others.length ? (
        <>
          <BarAvatars me={{ name: profile.displayName, avatarUrl: profile.avatarUrl ?? null, color: personColorOf(profile.id) }} others={others} />
          <span aria-hidden className="mx-1 h-6 w-px bg-line" />
        </>
      ) : null}
      {meta ? (
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setShareOpen(true)}
          title={shareState === "link" ? "Anyone with the link can view" : shareState === "people" ? "Shared with other people" : "Only you can open this"}
          className={`inline-flex h-10 items-center gap-2 rounded-[6px] px-3 text-[13.5px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-focus pointer-coarse:h-11 ${
            shareState ? "bg-accent-soft text-heading hover:bg-[color-mix(in_oklab,var(--color-accent-soft)_80%,var(--color-ink)_8%)]" : "text-ink hover:bg-accent-soft hover:text-heading"
          }`}
        >
          {shareState === "link" ? <Link2 size={15} aria-hidden /> : shareState === "people" ? <Users size={15} aria-hidden /> : <Lock size={14} aria-hidden />}
          <span className="max-sm:sr-only">{shareState ? "Shared" : "Share"}</span>
        </button>
      ) : null}
      {summary ? (
        <MenuButton
          label="Document actions"
          side="top"
          align="end"
          triggerClassName="grid h-10 w-10 place-items-center rounded-[6px] text-ink pointer-coarse:h-11 pointer-coarse:w-11 transition-colors hover:bg-accent-soft hover:text-heading focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          trigger={<MoreHorizontal size={16} aria-hidden />}
          items={actions}
        />
      ) : null}
    </div>
  );

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
      <div className="relative flex h-full min-h-0">
        <div ref={noteRef} className="relative min-w-0 flex-1 px-1.5 pb-2 sm:px-0 sm:pb-0">
        {findBar && editor ? <FindBar editor={editor} withReplace={findBar.replace} focusKey={findBar.key} readOnly={readOnly} onClose={() => setFindBar(null)} /> : null}

        {/* Blur background: the backdrop sits blurred behind the scrolling page, which is then see-through. */}
        {blurredBackdrop ? <BlurredBackdrop background={blurredBackdrop} className="inset-x-1.5 bottom-2 top-0 rounded-[14px] sm:inset-0" /> : null}
        <div
          id="doc-scroll"
          ref={setScrollEl}
          className={`fb-page relative h-full overflow-y-auto rounded-[14px] px-3 pt-8 shadow-[var(--glass-edge),var(--glass-shadow)] ${inspectorOpen && drawerMode ? "pb-[min(700px,70vh)]" : "pb-28"} sm:px-8`}
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
          {meta?.breadcrumbs.length ? <NestedPath crumbs={meta.breadcrumbs} title={pageTitle} /> : null}
          <article
            ref={setSheetEl}
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
            {conflictBlockIds.length ? (
              <ConflictBanner
                documentId={documentId}
                onResolvedAll={(blockId) => {
                  editorRef.current?.focusBlock(blockId);
                  if (!editorRef.current?.editor?.isFocused) editorRef.current?.editor?.commands.focus();
                }}
              />
            ) : null}
            {showEditors && blockAuthors ? <EditorsBar authors={blockAuthors} onHide={() => setShowEditors(false)} /> : null}
            <div className="px-5 sm:px-16">
              {summary?.kind === "collectionRow" ? (
                <Suspense fallback={null}>
                  <CollectionRowProperties documentId={documentId} editable={!readOnly} />
                </Suspense>
              ) : null}
              {ready && engine ? (
                <NoteAiContext.Provider value={noteAi}>
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
                </NoteAiContext.Provider>
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
        {/* The floating bar: AI, Insert, Format and Style, then the note's people, Share and its "…" menu. A tool opens
            in the right sidebar (on a phone, a sheet above the bar); AI opens the assistant on this note. */}
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
          extra={pageGroup}
        />
        {/* On a phone the tools are a sheet above the dock; elsewhere they're the right sidebar (below). */}
        {inspectorOpen && drawerMode ? (
          <div
            ref={inspectorRef}
            id="document-inspector"
            onKeyDown={(e) => {
              if (e.key === "Escape" && !e.defaultPrevented) {
                e.preventDefault();
                closeInspector();
              }
            }}
            className="ui-pop absolute bottom-[calc(84px+var(--kb-inset,0px))] left-1/2 z-30 flex max-h-[min(640px,calc(100%-112px-var(--kb-inset,0px)))] w-[min(400px,calc(100%-24px))] -translate-x-1/2 flex-col overflow-hidden rounded-[14px] animate-[folio-rise_180ms_var(--ease-folio)] motion-reduce:animate-none [&>div]:min-h-0"
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
                // On a phone the panel covers the note: it steps aside so the thread under its block shows.
                if (drawerMode) setInspectorOpen(false);
                editorRef.current?.focusBlock(t.blockId);
                setOpenThread({ blockId: t.blockId, threadId: t.id });
              }}
              onClose={closeInspector}
              aiRun={aiRun}
              onAiTitle={(title) => engine?.updateDocument(documentId, { title }, meta?.document.revision ?? null)}
              onHistory={canEditPage ? () => setHistoryOpen(true) : undefined}
              actions={actions}
              readOnly={readOnly}
              hideTabs
            />
          </div>
        ) : null}
        </div>
        {/* The tools (AI, Insert, Format, Style) as a right sidebar: the note makes room for it on wide windows,
            and it slides over the note's edge on narrower ones. It stays open across notes until closed. */}
        {inspectorOpen && !drawerMode ? (
          <RightPanel width={panelWidth} onWidth={setPanelWidth} overlay={panelOverlays}>
            <div
              ref={inspectorRef}
              id="document-inspector"
              onKeyDown={(e) => {
                if (e.key === "Escape" && !e.defaultPrevented) {
                  e.preventDefault();
                  closeInspector();
                }
              }}
              className="flex h-full min-h-0 flex-col [&>div]:min-h-0 [&>div]:flex-1"
            >
              <Inspector
                bare={!panelOverlays}
                hideTabs
                documentId={documentId}
                editor={editor}
                meta={meta ?? null}
                tab={inspectorTab}
                onTab={setInspectorTab}
                focusThreadId={focusThreadId}
                onOpenThread={(t) => {
                  if (!t.blockId) return;
                  // On a phone the panel covers the note: it steps aside so the thread under its block shows.
                  if (drawerMode) setInspectorOpen(false);
                  editorRef.current?.focusBlock(t.blockId);
                  setOpenThread({ blockId: t.blockId, threadId: t.id });
                }}
                onClose={closeInspector}
                aiRun={aiRun}
                onAiTitle={(title) => engine?.updateDocument(documentId, { title }, meta?.document.revision ?? null)}
                onHistory={canEditPage ? () => setHistoryOpen(true) : undefined}
                actions={actions}
                readOnly={readOnly}
              />
            </div>
          </RightPanel>
        ) : null}
      </div>
      {meta ? <ShareDialog open={shareOpen} onClose={() => setShareOpen(false)} documentId={documentId} title={summary?.title ?? ""} personal={meta.document.workspaceId === null} /> : null}
      {canEditPage ? <VersionHistory open={historyOpen} onClose={() => setHistoryOpen(false)} documentId={documentId} title={summary?.title ?? ""} style={style} cover={summary?.cover ?? DEFAULT_COVER} /> : null}
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

const PANEL_MIN = 280;
const PANEL_MAX = 520;
const PANEL_DEFAULT = 340;

/**
 * The right sidebar the page tools open in. On wide windows the note makes room for it; on narrower ones it
 * slides over the note's right edge. Its inner edge resizes it (drag, or ← / → on it).
 */
function RightPanel({ width, onWidth, overlay, children }: { width: number; onWidth: (w: number) => void; overlay: boolean; children: React.ReactNode }) {
  const panel = useRef<HTMLElement>(null);
  const w = Math.min(PANEL_MAX, Math.max(PANEL_MIN, Number.isFinite(width) ? width : PANEL_DEFAULT));
  // The floating AI button and chat keep clear of it.
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--tools-panel", `${w + 8}px`);
    return () => {
      root.style.removeProperty("--tools-panel");
    };
  }, [w]);
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    let next = w;
    const move = (ev: PointerEvent) => {
      next = Math.min(PANEL_MAX, Math.max(PANEL_MIN, w + (startX - ev.clientX)));
      if (panel.current) panel.current.style.width = `${next}px`;
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      if (next !== w) onWidth(next);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };
  return (
    <aside
      ref={panel}
      aria-label="Page tools"
      style={{ width: w }}
      // Like the left sidebar: straight on the canvas, no card. Over the note (narrower windows) it needs a ground.
      className={`flex min-h-0 flex-none flex-col ${overlay ? "ui-pop absolute inset-y-0 right-0 z-30 max-w-[calc(100%-24px)] overflow-hidden rounded-[14px] animate-[folio-settle_180ms_var(--ease-folio)] motion-reduce:animate-none" : "relative h-full"}`}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the tools panel"
        aria-valuemin={PANEL_MIN}
        aria-valuemax={PANEL_MAX}
        aria-valuenow={w}
        tabIndex={0}
        onPointerDown={startResize}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") onWidth(Math.min(PANEL_MAX, w + 16));
          if (e.key === "ArrowRight") onWidth(Math.max(PANEL_MIN, w - 16));
        }}
        className="absolute inset-y-3 -left-[3px] z-10 w-1 cursor-col-resize rounded-full outline-none transition-colors hover:bg-heading/20 focus-visible:bg-heading/30"
      />
      {children}
    </aside>
  );
}

/** "Show editors" is on: who edited this page (each in their colour), and a way to turn it off. */
function EditorsBar({ authors, onHide }: { authors: { authors: [string, string, number][]; people: Record<string, { name: string; color: string; avatarUrl: string | null }> }; onHide: () => void }) {
  const counts = new Map<string, number>();
  for (const [, key] of authors.authors) counts.set(key, (counts.get(key) ?? 0) + 1);
  const people = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return (
    <div role="status" className="mx-5 mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[8px] bg-[color-mix(in_oklab,var(--color-ink)_5%,transparent)] px-3 py-2 text-xs text-muted sm:mx-16">
      <span>Each line shows who last edited it.</span>
      {people.map(([key]) => (
        <span key={key} className="inline-flex items-center gap-1.5 text-ink">
          <Avatar name={authors.people[key]?.name ?? "Someone"} url={authors.people[key]?.avatarUrl} size={16} ring={`var(--color-${authors.people[key]?.color ?? "ink-muted"})`} />
          {authors.people[key]?.name ?? "Someone"}
        </span>
      ))}
      <button type="button" onClick={onHide} className="ml-auto rounded-[6px] px-2 py-0.5 font-medium text-heading hover:bg-accent-soft">
        Hide editors
      </button>
    </div>
  );
}

// A person's colour, as the server picks it (convex/lib/authors.ts personColor): the same everywhere they appear.
const PERSON_COLORS = ["accent", "moss", "marigold", "plum", "coral", "ember"] as const;
const personColorOf = (profileId: string) => PERSON_COLORS[parseInt(profileId.slice(-2), 36) % PERSON_COLORS.length] ?? "accent";

/** You and whoever else has the note open: pictures (or initials) ringed in each person's colour, up to four, then +N. */
function BarAvatars({ me, others }: { me: { name: string; avatarUrl: string | null; color: string }; others: { profileId: string; name: string; color: string; avatarUrl?: string | null }[] }) {
  const people = [{ key: "me", name: `${me.name} (you)`, avatarUrl: me.avatarUrl, color: me.color }, ...others.map((p) => ({ key: p.profileId, name: p.name, avatarUrl: p.avatarUrl ?? null, color: p.color }))];
  const shown = people.slice(0, 4);
  const more = people.length - shown.length;
  return (
    <div role="group" aria-label={`Here now: ${people.map((p) => p.name).join(", ")}`} className="flex items-center px-1.5">
      <div className="flex -space-x-1.5">
        {shown.map((p) => (
          <span key={p.key} title={p.name} className="rounded-full bg-[var(--color-surface-raised)] p-[1.5px]">
            <Avatar name={p.name} url={p.avatarUrl} size={24} ring={`var(--color-${p.color})`} />
          </span>
        ))}
      </div>
      {more > 0 ? <span className="ml-1.5 text-xs font-medium text-muted">+{more}</span> : null}
    </div>
  );
}



/**
 * Where a nested page sits, above its sheet: back to the page it's in, then the way down from the top-level
 * note. Each step opens in the same tab.
 */
function NestedPath({ crumbs, title }: { crumbs: { id: string; title: string }[]; title: string }) {
  const parent = crumbs[crumbs.length - 1]!;
  return (
    <nav aria-label="Page path" className="relative mx-auto -mt-5 mb-2.5" style={{ maxWidth: "calc(var(--editor-width) + 8rem)" }}>
      <ol className="ui-glass inline-flex max-w-full min-w-0 items-center gap-0.5 rounded-[8px] p-0.5 text-[12.5px]">
        <li className="flex-none">
          <AppLink href={`/d/${parent.id}`} aria-label={`Back to ${parent.title || "Untitled"}`} title={`Back to ${parent.title || "Untitled"}`} className="grid h-6 w-6 place-items-center rounded-[6px] text-muted transition-colors hover:bg-[var(--glass-hover)] hover:text-heading">
            <ArrowLeft size={13} aria-hidden />
          </AppLink>
        </li>
        {crumbs.map((c) => (
          <li key={c.id} className="flex min-w-0 items-center gap-0.5">
            <AppLink href={`/d/${c.id}`} className="max-w-[14rem] truncate rounded-[6px] px-1.5 py-0.5 text-muted transition-colors hover:bg-[var(--glass-hover)] hover:text-heading">
              {c.title || "Untitled"}
            </AppLink>
            <ChevronRight size={12} aria-hidden className="flex-none text-faint" />
          </li>
        ))}
        <li aria-current="page" className="min-w-0 truncate px-1.5 py-0.5 font-semibold text-heading">
          {title}
        </li>
      </ol>
    </nav>
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
  /** Titles this page sent, by op, so a refused one can be offered back. */
  const sentTitles = useRef(new Map<string, string>());
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
        // Someone renamed the page while this edit was on its way (or offline): say so, and offer ours back.
        const mine = sentTitles.current.get(e.opId);
        if (e.result.status === "conflict" && mine !== undefined && mine !== doc.title) {
          const base = e.result.revision ?? null;
          toastRef.current?.show("Someone else renamed this page, so your title wasn't saved.", {
            action: {
              label: "Use my title",
              onClick: () => {
                setValue(mine);
                engine.updateDocument(documentId, { title: mine }, base);
              },
            },
          });
        }
      }
      sentTitles.current.delete(e.opId);
    });
  }, [engine, documentId]);
  // Focus the title once for a brand-new page (never again, so it can't steal focus later).
  const focusedOnce = useRef(false);
  const freshTitle = useRef(false);
  useEffect(() => {
    if (focusedOnce.current || search.get("new") !== "1") return;
    focusedOnce.current = true;
    freshTitle.current = true;
    titleRef.current?.focus();
  }, [search]);
  // A new page from a template already has a title: it's selected (typing replaces it), also when it arrives
  // a moment after the page opens. Once the person types or moves the caret, it's theirs.
  useEffect(() => {
    const el = titleRef.current;
    if (!freshTitle.current || !el || document.activeElement !== el || !value) return;
    el.setSelectionRange(0, el.value.length);
  }, [value]);
  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleSince = useRef(0);
  const flushTitle = useRef<(() => void) | null>(null);
  const aiOn = useAiEnabled(note);
  const { write } = useAi();
  const toast = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;
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
      const opId = engine?.updateDocument(documentId, { title: next }, revision);
      if (opId) sentTitles.current.set(opId, next);
      engine?.setEditing(key, false);
    };
    engine?.setEditing(key, true);
    flushTitle.current = commit;
    // Saved 300ms after the last key, and at least once a second while typing.
    if (!titleSince.current) titleSince.current = Date.now();
    timer.current = setTimeout(() => {
      titleSince.current = 0;
      commit();
    }, Math.max(0, Math.min(300, titleSince.current + 1000 - Date.now())));
  };
  // Leaving the page (or the tab) never drops a title still waiting for its debounce.
  useEffect(() => {
    const onHide = () => {
      if (timer.current) clearTimeout(timer.current);
      titleSince.current = 0;
      flushTitle.current?.();
    };
    const onVisibility = () => document.visibilityState === "hidden" && onHide();
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onVisibility);
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
            freshTitle.current = false;
            // A pasted line break is a space, so the words on either side don't run together.
            const next = e.target.value.replace(/\s*\n\s*/g, " ");
            setValue(next);
            save(next);
          }}
          onSelect={() => {
            const r = readSel();
            setTitleSel(r.start !== r.end ? r : null);
          }}
          onBlur={() => {
            freshTitle.current = false;
            setTitleSel(null);
          }}
          onMouseDown={() => {
            freshTitle.current = false;
          }}
          onKeyDown={(e) => {
            freshTitle.current = false;
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

function ConflictBanner({ documentId, onResolvedAll }: { documentId: string; /** The last conflict was settled from here: focus goes back to its block. */ onResolvedAll: (blockId: string) => void }) {
  const { engine } = useAppState();
  const conflicts = useEngineSelector(engine, (s) => s.conflicts.filter((c) => c.documentId === documentId), sameItems);
  const [openId, setOpenId] = useState<string | null>(conflicts[0]?.id ?? null);
  const shown = conflicts.find((x) => x.id === openId) ?? conflicts[0];
  // The other version as it is now (it may have been edited again since the conflict began): what
  // "Keep theirs" keeps, and what "Keep mine" replaces.
  const live = useEngineSelector(engine, (s) => (shown ? s.blocks[shown.blockId] : undefined));
  const sectionRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const focusNext = useRef(false);
  // After settling one of several, focus goes to the next one's heading (not lost to the page).
  useEffect(() => {
    if (!focusNext.current) return;
    focusNext.current = false;
    headingRef.current?.focus();
  }, [shown?.id]);
  if (!shown || !engine) return null;
  const c = shown;
  const theirs = live && !live.deleted ? live.block : c.server;
  const text = (b: WireBlock | null) =>
    b ? (b.text.length ? b.text.map((n) => (n.type === "text" ? n.text : n.type === "mention" ? `@${n.label}` : n.type === "date" ? n.date : n.label)).join("") : `(${b.type} block)`) : "(deleted)";
  const resolve = (choice: "mine" | "theirs" | "both", rank?: string) => {
    const hadFocus = sectionRef.current?.contains(document.activeElement) ?? false;
    engine.resolveConflict(c.id, choice, rank);
    if (!hadFocus) return;
    if (conflicts.length === 1) onResolvedAll(c.blockId);
    else focusNext.current = true;
  };
  const keepBoth = () => {
    const blocks = engine.documentBlocks(documentId);
    const server = blocks.find((b) => b.id === c.blockId) ?? c.server;
    const rank = server ? rankForPosition(blocks, server.parentId, server.id) : undefined;
    resolve("both", rank);
  };
  // Not an alert: the sync status already announces conflicts.
  return (
    <section ref={sectionRef} aria-labelledby={`conflict-${c.id}`} className="mx-5 mb-5 rounded-[6px] bg-plum-soft p-4 shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--color-plum)_30%,transparent)] sm:mx-16">
      <h2 ref={headingRef} id={`conflict-${c.id}`} tabIndex={-1} className="text-sm font-semibold text-plum-ink outline-none">
        {conflicts.length === 1 ? "This block was changed in two places" : `${conflicts.length} blocks were changed in two places`}
      </h2>
      <p className="mt-1 text-sm text-ink">Both versions are kept. Nothing is lost until you choose.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="ui-card rounded-[8px] p-3">
          <p className="ui-caps">{c.reason === "deleted" ? "Deleted elsewhere" : c.reason === "edited" ? "Edited elsewhere" : "Version from elsewhere"}</p>
          <p className="mt-1 whitespace-pre-wrap text-sm">{c.reason === "deleted" ? "Someone deleted this block." : text(theirs)}</p>
        </div>
        <div className="ui-card rounded-[8px] p-3 shadow-[var(--shadow-card),0_0_0_2px_color-mix(in_oklab,var(--color-ember)_45%,transparent)]">
          <p className="ui-caps">{c.reason === "edited" ? "You deleted it" : "Your version"}</p>
          <p className={`mt-1 whitespace-pre-wrap text-sm ${c.reason === "edited" ? "text-muted line-through" : ""}`}>{text(c.client)}</p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {c.reason === "edited" ? (
          <>
            <Button size="sm" variant="primary" onClick={() => resolve("theirs")}>
              Keep it
            </Button>
            <Button size="sm" onClick={() => resolve("mine")}>
              Delete anyway
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" variant="primary" onClick={() => resolve("mine")}>
              Keep mine
            </Button>
            <Button size="sm" onClick={() => resolve("theirs")}>
              Keep theirs
            </Button>
          </>
        )}
        {c.reason !== "deleted" && c.reason !== "edited" ? (
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
  onToggleEditors,
  showingEditors,
  onShare,
  onComments,
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
  /** Opens version history (absent for people who can't edit the page). */
  onHistory?: () => void;
  /** Turns "Show editors" on or off (absent for people who can't edit the page). */
  onToggleEditors?: () => void;
  showingEditors?: boolean;
  onShare: () => void;
  /** Opens the Comments tab in the page's sidebar. */
  onComments?: () => void;
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
        ...(onComments ? [{ label: "Comments", icon: <MessageSquare size={14} />, onSelect: onComments }] : []),
        ...(onInfo ? [{ label: "Info", icon: <Info size={14} />, onSelect: onInfo }] : []),
        ...(onHistory ? [{ label: "Version history…", icon: <History size={14} />, onSelect: onHistory }] : []),
        ...(onToggleEditors ? [{ label: showingEditors ? "Hide editors" : "Show editors", icon: <Users size={14} />, onSelect: onToggleEditors }] : []),
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

