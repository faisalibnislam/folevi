"use client";

import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from "@tiptap/react";
import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { NodeSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { useAction } from "convex/react";
import { useQuery } from "@/lib/convex/queries";
import type { FunctionReturnType } from "convex/server";
import { Component, lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ComponentType, type ReactNode } from "react";
import {
  Download,
  ExternalLink,
  Eye,
  FileText,
  ImageOff,
  Link2,
  Pencil,
  RotateCw,
  Trash2,
} from "lucide-react";
import { CHART_DEFAULT_HEIGHT, MINDMAP_DEFAULT_HEIGHT, STICKIES_DEFAULT_HEIGHT, WIREFRAME_DEFAULT_HEIGHT, imageDescription, looksLikeFileName, sanitizeHref, webUrl, type SyncState } from "@folevi/editor-schema";
import { webAddressIn } from "./autolink";
import { api } from "@/lib/convex/api";
import { canCallHere } from "@/lib/mode";
import { useAppState } from "@/lib/app/state";
import { forgetKeptFileUrl, keptFileUrl } from "@/lib/sync/deviceFiles";
import { AppLink } from "@/lib/app/router";
import { useEngineSelector } from "@/lib/hooks/useEngine";
import { completedUploadFor, localPreviewUrl, releaseLocalPreview, retryUploads } from "@/lib/sync/uploads";
import { formatBytes } from "@/lib/format";
import { macDesktop } from "@/lib/desktop/capabilities";
import {
  AudioBlock,
  BookmarkBlock,
  CollectionBlock,
  EmbedBlock,
  FileBlock,
  ChartBlock,
  FlowchartBlock,
  FormulaBlock,
  ImageBlock,
  MindmapBlock,
  PageBlock,
  StickiesBlock,
  TableBlock,
  UnknownBlock,
  WhiteboardBlock,
  WireframeBlock,
  TabsBlock,
} from "./extensions";
import { TabsView } from "./tabs/TabsView";
import { FormulaView } from "./FormulaView";
import { TableView, tableHandlesEvent } from "./table/TableView";
import { useEditorEnvironment } from "./environment";
import { useDraft } from "./useDraft";
import { useEditable } from "./useEditable";
import { AudioPlayer } from "./AudioPlayer";
import { EmbedFrame } from "./EmbedFrame";
import { TranscribeButton, useCanTranscribe, useTranscription } from "@/components/ai/AudioTranscribe";
import { SyncedBlock } from "./extensions";
import "./image.css";

/**
 * A part of the app that didn't arrive: the website was left open across a new version (the old part is gone
 * from the server), or the connection dropped while it loaded. The one kind of failure asking again can fix.
 */
export function isChunkLoadError(error: unknown): boolean {
  const e = error as { name?: unknown; message?: unknown } | null;
  if (!e || typeof e !== "object") return false;
  return e.name === "ChunkLoadError" || /Loading chunk|Failed to load chunk|dynamically imported module|Importing a module script failed/i.test(String(e.message ?? ""));
}

type Reloadable<P> = ComponentType<P> & { reload: () => void };

/**
 * A view loaded the first time it's shown, that can be asked for again. React.lazy keeps a failed load for
 * good, so after one a new lazy view takes its place when the block's card asks (`reload`). A view that did
 * load is never replaced: every block of its kind would be drawn again from nothing.
 */
export function lazyView<P extends object>(load: () => Promise<{ default: ComponentType<P> }>): Reloadable<P> {
  let failed = false;
  const make = () =>
    lazy(() =>
      load().catch((error: unknown) => {
        failed = true;
        throw error;
      }),
    ) as unknown as ComponentType<P>;
  let View = make();
  function LazyView(props: P) {
    return <View {...props} />;
  }
  return Object.assign(LazyView, {
    reload: () => {
      if (!failed) return;
      failed = false;
      View = make();
    },
  });
}

// The whiteboard, flowchart, the other visual blocks and collections are large and most notes have none: each
// loads the first time a note shows one, in a placeholder of the block's own height so nothing moves when it
// arrives.
const WhiteboardView = lazyView<ReactNodeViewProps>(() => import("./WhiteboardView").then((m) => ({ default: m.WhiteboardView })));
const FlowchartView = lazyView<ReactNodeViewProps>(() => import("./flowchart/FlowchartView").then((m) => ({ default: m.FlowchartView })));
const MindmapView = lazyView<ReactNodeViewProps>(() => import("./mindmap/MindmapView").then((m) => ({ default: m.MindmapView })));
const StickiesView = lazyView<ReactNodeViewProps>(() => import("./stickies/StickiesView").then((m) => ({ default: m.StickiesView })));
const ChartView = lazyView<ReactNodeViewProps>(() => import("./chart/ChartView").then((m) => ({ default: m.ChartView })));
const WireframeView = lazyView<ReactNodeViewProps>(() => import("./wireframe/WireframeView").then((m) => ({ default: m.WireframeView })));
const CollectionEmbed = lazyView<{ collectionId: string; initialViewId: string | null; editable: boolean }>(() => import("./CollectionEmbed").then((m) => ({ default: m.CollectionEmbed })));
// A synced block runs an editor of its own for its content (synced/SyncedView.tsx).
const SyncedView = lazyView<ReactNodeViewProps>(() => import("./synced/SyncedView").then((m) => ({ default: m.SyncedView })));

/** Everything inside a synced block's own editor, and its frame's controls, is theirs (not the note's). */
function syncedOwnsEvent(event: Event): boolean {
  return event.target instanceof Element && Boolean(event.target.closest("[data-synced-body], button, a, [role=menu]"));
}

function LoadingBlock({ height }: { height: number }) {
  return (
    <NodeViewWrapper>
      <div contentEditable={false} aria-busy aria-label="Loading" className="my-3 animate-pulse rounded-control bg-sunken motion-reduce:animate-none" style={{ height }} />
    </NodeViewWrapper>
  );
}

/** A lazily loaded block, with a placeholder of its own height meanwhile (`reload` asks for it again after a failed load). */
function lazyBlock(View: Reloadable<ReactNodeViewProps>, height: (props: ReactNodeViewProps) => number) {
  function LazyBlock(props: ReactNodeViewProps) {
    return (
      <Suspense fallback={<LoadingBlock height={height(props)} />}>
        <View {...props} />
      </Suspense>
    );
  }
  return Object.assign(LazyBlock, { reload: View.reload });
}
const LazySynced = lazyBlock(SyncedView, () => 72);
const LazyWhiteboard = lazyBlock(WhiteboardView, (props) => Number(props.node.attrs.height) || 420);
const LazyFlowchart = lazyBlock(FlowchartView, (props) => Number(props.node.attrs.height) || 440);
/** A visual block's placeholder is its own height plus the card's height handle. */
const lazyVisual = (View: Reloadable<ReactNodeViewProps>, fallbackHeight: number) => lazyBlock(View, (props) => (Number(props.node.attrs.height) || fallbackHeight) + 14);
const LazyMindmap = lazyVisual(MindmapView, MINDMAP_DEFAULT_HEIGHT);
const LazyStickies = lazyVisual(StickiesView, STICKIES_DEFAULT_HEIGHT);
const LazyChart = lazyVisual(ChartView, CHART_DEFAULT_HEIGHT);
const LazyWireframe = lazyVisual(WireframeView, WIREFRAME_DEFAULT_HEIGHT);

interface BlockBoundaryProps {
  /** The block drawn inside: when it changes, what couldn't be drawn is tried again. */
  node: PMNode;
  selected?: boolean;
  /** Asks again for a view whose own code didn't load (lazyView). */
  reload?: () => void;
  /** Loads the whole app again (the page's own reload, unless a test says otherwise). */
  reloadApp?: () => void;
  children: ReactNode;
}

/**
 * Keeps one block's trouble to that block. A view that throws while it draws (its part of the app didn't
 * load, the server refused what it asked, its stored content is something it can't read) used to take the
 * whole app down with it, and a note holding such a block could never be opened on that device. Here the
 * block becomes a plain card instead, the rest of the note stays as it is, and nothing about the block is
 * changed: it is still there to select, move, delete or see on another device. Reload tries the view again
 * (a part of the app that still won't come after that was replaced by a newer version: the app is loaded again).
 */
export class BlockBoundary extends Component<BlockBoundaryProps, { failed: boolean; error: unknown; tries: number }> {
  override state = { failed: false, error: null as unknown, tries: 0 };

  static getDerivedStateFromError(error: unknown) {
    return { failed: true, error };
  }

  override componentDidUpdate(prev: BlockBoundaryProps) {
    // The block changed (an edit here, or a repair arriving from another device): it may draw now.
    if (this.state.failed && prev.node !== this.props.node) this.setState({ failed: false, error: null });
  }

  private retry = () => {
    const chunk = isChunkLoadError(this.state.error);
    if (chunk && this.state.tries > 0 && (typeof navigator === "undefined" || navigator.onLine !== false)) {
      (this.props.reloadApp ?? (() => window.location.reload()))();
      return;
    }
    this.props.reload?.();
    this.setState((s) => ({ failed: false, error: null, tries: s.tries + (chunk ? 1 : 0) }));
  };

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <NodeViewWrapper className={`fb-atom ${this.props.selected ? "fb-atom-selected" : ""}`} data-drag-handle="" data-block-error="" role="group" aria-label="Block that couldn’t be shown">
        <div contentEditable={false} role="status" className="my-2 flex items-center gap-3 rounded-chip border border-dashed border-line-strong bg-sunken px-4 py-3 text-subheadline text-muted">
          <span className="flex-1">This block couldn’t be shown.</span>
          <button type="button" onClick={this.retry} className="inline-flex h-8 flex-none items-center gap-1.5 rounded-chip border border-line px-2.5 text-footnote hover:bg-surface hover:text-heading">
            <RotateCw size={14} aria-hidden /> Reload
          </button>
        </div>
      </NodeViewWrapper>
    );
  }
}

/** A block's view inside its own boundary (one per block: each view is its block's alone). */
function guarded(View: ComponentType<ReactNodeViewProps> & { reload?: () => void }) {
  return function GuardedBlock(props: ReactNodeViewProps) {
    return (
      <BlockBoundary node={props.node} selected={props.selected} reload={View.reload}>
        <View {...props} />
      </BlockBoundary>
    );
  };
}

/**
 * A press on the card a block that couldn't be shown becomes: its Reload button's is the button's own; anywhere
 * else it is the note's (it selects the block, so the block can still be moved or deleted). Null: not that card.
 */
function onErrorCard(event: Event): boolean | null {
  if (!(event.target instanceof Element) || !event.target.closest("[data-block-error]")) return null;
  return Boolean(event.target.closest("button"));
}

/** The app's one clock for file addresses: every view reads it, one timer keeps it. */
const CLOCK_STEP_MS = 5 * 60_000;
/** A file's address is asked for again every half hour (the server's answer changes on the hour). */
const ADDRESS_STEP_MS = 30 * 60_000;
/** An address that works is kept until this close to its end. */
const RENEW_BEFORE_MS = 10 * 60_000;
/** Online, how long the device's own copy of a file waits for the server's answer before it is read. */
const KEPT_LOOKUP_DELAY_MS = 600;

const clock = { now: 0, timer: null as ReturnType<typeof setInterval> | null, listeners: new Set<() => void>() };
const readClock = () => Math.floor(Date.now() / CLOCK_STEP_MS) * CLOCK_STEP_MS;

function tickClock() {
  const now = readClock();
  if (now === clock.now) return;
  clock.now = now;
  for (const listener of [...clock.listeners]) listener();
}

/** The time in five-minute steps (so nothing redraws more often than that for it). */
function clockNow(): number {
  // With no one listening no timer runs: read afresh.
  if (!clock.timer) clock.now = readClock();
  return clock.now;
}

function subscribeClock(listener: () => void): () => void {
  clock.listeners.add(listener);
  if (!clock.timer) {
    clock.now = readClock();
    clock.timer = setInterval(tickClock, 60_000);
    // Back from the background (where timers sleep, on a phone for hours): looked at right away.
    document.addEventListener("visibilitychange", tickClock);
  }
  return () => {
    clock.listeners.delete(listener);
    if (clock.listeners.size || !clock.timer) return;
    clearInterval(clock.timer);
    clock.timer = null;
    document.removeEventListener("visibilitychange", tickClock);
  };
}

type FileInfo = FunctionReturnType<typeof api.files.urls>[string];

/** When a signed file address stops working (the `exp` it carries), or null when it doesn't say. */
export function fileAddressExpiry(url: string): number | null {
  const m = /[?&]exp=(\d{10,})(?:&|$)/.exec(url);
  return m ? Number(m[1]) : null;
}

/**
 * The address to show for a file: the one already on screen for as long as it works, the server's new one once
 * the old is about to end. The server signs a new address every hour, and taking each as it came made every
 * picture and recording in an open note download again hourly, under a new name the browser's cache had never
 * seen. (An address that says nothing of its end is replaced as before.)
 */
export function keepLoadedAddress<T extends { url: string }>(shown: T | null | undefined, fresh: T, now: number): T {
  if (!shown || shown.url === fresh.url) return shown ?? fresh;
  const ends = fileAddressExpiry(shown.url);
  return ends !== null && now < ends - RENEW_BEFORE_MS ? shown : fresh;
}

/**
 * What one note's editor knows of its files' addresses. With a NoteFileUrls next to the editor, every view's
 * file is asked for in one question to the server (not one live question per picture, file and recording),
 * and each view reads its own answer here.
 */
class NoteFiles {
  /** Someone is asking for this note's files in one question. */
  hosted = false;
  /** That question failed (signed out, the server refusing): nothing more is coming for now. */
  failed = false;
  /** The server's word on each file asked for: its details, or null when it answered without it. */
  readonly answers = new Map<string, FileInfo | null>();
  private readonly wanted = new Map<string, number>();
  private key = "";
  private queued = false;
  private readonly listeners = new Set<() => void>();

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };
  readonly isHosted = () => this.hosted;
  readonly hasFailed = () => this.failed;
  /** The files the mounted views show, as one sorted string (the same string until the set changes). */
  readonly wantedKey = () => this.key;

  private notify() {
    for (const listener of [...this.listeners]) listener();
  }

  /** A view shows this file; returns the function that says it no longer does. */
  want(fileId: string): () => void {
    this.wanted.set(fileId, (this.wanted.get(fileId) ?? 0) + 1);
    this.rekey();
    return () => {
      const left = (this.wanted.get(fileId) ?? 1) - 1;
      if (left > 0) this.wanted.set(fileId, left);
      else this.wanted.delete(fileId);
      this.rekey();
    };
  }

  /**
   * Views come and go together (a note opening, a block moved), though not always in the same breath: the set
   * is read a moment later, once they all have, so the question is asked once for all of them.
   */
  private rekey() {
    if (this.queued) return;
    this.queued = true;
    setTimeout(() => {
      this.queued = false;
      const key = [...this.wanted.keys()].sort().join(",");
      if (key === this.key) return;
      this.key = key;
      for (const id of [...this.answers.keys()]) if (!this.wanted.has(id)) this.answers.delete(id);
      this.notify();
    }, 0);
  }

  host(on: boolean) {
    if (this.hosted === on) return;
    this.hosted = on;
    this.failed = false;
    this.notify();
  }

  fail(on: boolean) {
    if (this.failed === on) return;
    this.failed = on;
    this.notify();
  }

  /** The server's answer for some of the files: views redraw only when their own file's address changed. */
  answer(ids: readonly string[], urls: Record<string, FileInfo>) {
    let changed = this.failed;
    this.failed = false;
    for (const id of ids) {
      const next = urls[id] ?? null;
      const had = this.answers.get(id);
      if (had !== undefined && (had === null ? next === null : next !== null && had.url === next.url)) continue;
      this.answers.set(id, next);
      changed = true;
    }
    if (changed) this.notify();
  }
}

const noteFiles = new WeakMap<Editor, NoteFiles>();
function noteFilesOf(editor: Editor): NoteFiles {
  let store = noteFiles.get(editor);
  if (!store) noteFiles.set(editor, (store = new NoteFiles()));
  return store;
}

/** The server takes this many files in one question. */
const FILES_PER_QUESTION = 200;

function FileUrlsQuestion({ store, ids, now }: { store: NoteFiles; ids: string[]; now: number }) {
  const urls = useQuery(api.files.urls, { fileIds: ids, now });
  useEffect(() => {
    if (urls) store.answer(ids, urls);
  }, [store, ids, urls]);
  return null;
}

/** A question the server refused throws while it draws: kept here, away from the editor and the app around it. */
class FileUrlsGuard extends Component<{ onFailed: () => void; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch() {
    this.props.onFailed();
  }
  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

/**
 * Asks the server for the addresses of all of a note's files in one live question (in groups of 200), for the
 * views of the editor it is given. It draws nothing; it sits next to the editor (not around it). Without one,
 * each view asks for its own file, as they all once did.
 */
export function NoteFileUrls({ editor }: { editor: Editor }) {
  const store = noteFilesOf(editor);
  // Before the views draw for the first time (they are drawn after this commit), so none asks for itself.
  useLayoutEffect(() => {
    store.host(true);
    return () => store.host(false);
  }, [store]);
  const key = useSyncExternalStore(store.subscribe, store.wantedKey, store.wantedKey);
  const now = Math.floor(useSyncExternalStore(subscribeClock, clockNow, clockNow) / ADDRESS_STEP_MS) * ADDRESS_STEP_MS;
  const groups: string[][] = [];
  if (key) {
    const ids = key.split(",");
    for (let i = 0; i < ids.length; i += FILES_PER_QUESTION) groups.push(ids.slice(i, i + FILES_PER_QUESTION));
  }
  return (
    // (A new set of files, or a new half hour, asks again after a failure.)
    <FileUrlsGuard key={`${now}:${key}`} onFailed={() => store.fail(true)}>
      {groups.map((ids) => (
        <FileUrlsQuestion key={ids[0]} store={store} ids={ids} now={now} />
      ))}
    </FileUrlsGuard>
  );
}

/**
 * A file's signed address, renewed every half hour and kept on screen until it is about to end. `missing` once
 * the server has answered without it (deleted, or no longer visible to this person). `renew` is told of an
 * address that stopped working (the picture didn't load).
 */
function useFileUrl(editor: Editor, fileId: string | null): { file: FileInfo | undefined; missing: boolean; renew: (url: string) => void } {
  const store = noteFilesOf(editor);
  const hosted = useSyncExternalStore(store.subscribe, store.isHosted, store.isHosted);
  const failed = useSyncExternalStore(store.subscribe, store.hasFailed, store.hasFailed);
  const shared = useSyncExternalStore(
    store.subscribe,
    () => (fileId ? store.answers.get(fileId) : undefined),
    () => undefined,
  );
  useEffect(() => (fileId ? store.want(fileId) : undefined), [store, fileId]);
  const now = useSyncExternalStore(subscribeClock, clockNow, clockNow);
  const own = useQuery(api.files.urls, fileId && !hosted ? { fileIds: [fileId], now: Math.floor(now / ADDRESS_STEP_MS) * ADDRESS_STEP_MS } : "skip");
  const answered = hosted ? shared !== undefined : Boolean(own);
  const fresh = !fileId ? undefined : hosted ? (shared ?? undefined) : own?.[fileId];
  // Each renewal is a new question that starts out unanswered: until it answers, the last address for this file
  // stays, so images don't flash back to loading and playing audio doesn't stop. And an address that still
  // works stays when a new one arrives (keepLoadedAddress), unless it was reported broken.
  const [last, setLast] = useState<{ fileId: string; file: FileInfo } | null>(null);
  const [broken, setBroken] = useState<string | null>(null);
  const had = last?.fileId === fileId && last.file.url !== broken ? last.file : null;
  const shown = fresh ? keepLoadedAddress(had, fresh, now) : had;
  if (fileId && shown && (last?.fileId !== fileId || last.file.url !== shown.url)) setLast({ fileId, file: shown });
  // No answer from the server (offline, or not yet): the copy this device keeps (lib/sync/deviceFiles.ts), if any.
  const { profile } = useAppState();
  const [kept, setKept] = useState<{ fileId: string; file: FileInfo } | null>(null);
  const [keptRead, setKeptRead] = useState(0);
  const waiting = Boolean(fileId) && !answered && last?.fileId !== fileId;
  useEffect(() => {
    if (!waiting || !fileId) return;
    let live = true;
    const read = () =>
      void keptFileUrl(profile.id, fileId).then((k) => {
        if (live && k) setKept({ fileId, file: { ...k, palette: null } as FileInfo });
      });
    // Online, the server's answer is a moment away and this read (the device's database, its file cache, the
    // file's bytes) would be thrown away for every file of every note opened: it waits to see. Offline, or
    // with the server's question failed, it is all there is.
    const offline = typeof navigator !== "undefined" && navigator.onLine === false;
    const timer = offline || failed ? null : setTimeout(read, KEPT_LOOKUP_DELAY_MS);
    if (!timer) read();
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
  }, [waiting, fileId, profile.id, failed, keptRead]);
  const keptFile = kept?.fileId === fileId ? kept.file : undefined;
  const renew = useCallback(
    (url: string) => {
      if (!fileId) return;
      if (url.startsWith("blob:")) {
        // The device's own copy, let go while it waited to load: asked for again.
        forgetKeptFileUrl(profile.id, fileId);
        setKept(null);
        setKeptRead((n) => n + 1);
        return;
      }
      setBroken(url);
      tickClock();
    },
    [fileId, profile.id],
  );
  if (!fileId) return { file: undefined, missing: false, renew };
  if (answered) return { file: shown ?? undefined, missing: !fresh, renew };
  const file = had ?? keptFile;
  // The one question for the note's files failed: with nothing kept to show, the file can't be reached.
  return { file, missing: hosted && failed && !file, renew };
}

/**
 * The copy saved on this device while an upload waits, shown until the server's address arrives; then its
 * object URL is let go.
 */
function useLocalPreview(fileId: string | null, uploadId: string | undefined, serverUrl: string | undefined): string | null {
  const { profile } = useAppState();
  const [preview, setPreview] = useState<{ uploadId: string; url: string } | null>(null);
  useEffect(() => {
    if (fileId || !uploadId) return;
    let live = true;
    void localPreviewUrl(profile.id, uploadId).then((url) => {
      if (live && url) setPreview({ uploadId, url });
    });
    return () => {
      live = false;
    };
  }, [fileId, uploadId, profile.id]);
  useEffect(() => {
    // The view has already switched to the server's address in this render, so nothing shows the copy now.
    if (!serverUrl || !preview) return;
    releaseLocalPreview(preview.uploadId);
    setPreview(null);
  }, [serverUrl, preview]);
  return preview?.url ?? null;
}

// One per attachment in the note: each re-renders only when its own upload changes, not on every keystroke.
function useUploadState(blockId: string | null) {
  const { engine } = useAppState();
  return useEngineSelector(engine, (s) => (blockId ? s.uploads.find((u) => u.blockId === blockId) : undefined), sameUpload);
}

type UploadRecord = SyncState["uploads"][number];

// The sync state copies upload records as it changes: the same upload in the same state is no change.
function sameUpload(a: UploadRecord | undefined, b: UploadRecord | undefined): boolean {
  return a === b || (a !== undefined && b !== undefined && a.uploadId === b.uploadId && a.state === b.state && a.attempts === b.attempts);
}

function Frame({
  selected,
  children,
  label,
  className = "",
}: {
  selected: boolean;
  children: React.ReactNode;
  label: string;
  className?: string;
}) {
  return (
    <NodeViewWrapper
      className={`fb-atom ${className} ${selected ? "fb-atom-selected" : ""}`}
      data-drag-handle=""
      // A label is only read with a role (an image's own <figure> is inside).
      role="group"
      aria-label={label}
    >
      {children}
    </NodeViewWrapper>
  );
}

/** The narrowest an image is saved: a fifth of the text column (the schema's own lower bound). */
const MIN_IMAGE_WIDTH = 0.2;
/** The air between an image and its tools when they float above it. */
const IMAGE_TOOLS_GAP = 8;

/** A dragged width as it's saved: a share of the text column in hundredths, a fifth at least; null for all of it. */
export function imageWidthAttr(share: number): number | null {
  const w = Math.round(Math.min(1, Math.max(MIN_IMAGE_WIDTH, share)) * 100) / 100;
  return w >= 1 ? null : w;
}

/** On a touch screen a drag on a handle has to travel this far before it means anything. */
const TOUCH_RESIZE_SLOP = 8;

/**
 * What a drag that began on a resize handle means so far, from how far it has travelled. With a mouse or
 * trackpad two pixels sideways is a resize, as it always was. A finger is less sure of itself: nothing is
 * decided inside eight pixels, and past them only a mostly sideways move resizes; anything else was the
 * start of a scroll, and the handle lets it go.
 */
export function resizeIntent(dx: number, dy: number, touch: boolean): "resize" | "scroll" | "wait" {
  const ax = Math.abs(dx);
  if (!touch) return ax >= 2 ? "resize" : "wait";
  const ay = Math.abs(dy);
  if (ax < TOUCH_RESIZE_SLOP && ay < TOUCH_RESIZE_SLOP) return "wait";
  return ax >= TOUCH_RESIZE_SLOP && ax > ay * 1.5 ? "resize" : "scroll";
}

/**
 * A picture's size in pixels, when it's known before the picture has loaded: the block's own record of it
 * (naturalWidth and naturalHeight), else the stored file's. The box is given this shape from the start, so
 * the note below doesn't jump when the picture arrives.
 */
export function imageBoxSize(
  attrs: { naturalWidth?: unknown; naturalHeight?: unknown },
  file?: { width?: number | null; height?: number | null } | null,
): { width: number; height: number } | null {
  const sized = (w: unknown, h: unknown) => (typeof w === "number" && typeof h === "number" && Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 ? { width: w, height: h } : null);
  return sized(attrs.naturalWidth, attrs.naturalHeight) ?? sized(file?.width, file?.height);
}

/** Sets a block's attributes without a step of their own to undo (what arrives a moment after the block did). */
function setAttrsQuietly(editor: Editor, getPos: ReactNodeViewProps["getPos"], type: string, attrs: Record<string, unknown>) {
  const pos = typeof getPos === "function" ? getPos() : undefined;
  const live = typeof pos === "number" ? editor.state.doc.nodeAt(pos) : null;
  if (typeof pos !== "number" || !live || live.type.name !== type) return;
  editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...live.attrs, ...attrs }).setMeta("addToHistory", false));
}

/**
 * Gives their files back to blocks that returned without them: an image, attachment or recording taken out by
 * an undo while it was still uploading, whose upload then finished with no block to write the file's id into,
 * and which a redo has brought back. Returns the change to make (no step of its own to undo; it is this
 * person's edit, so it is saved like one), or null when no block is waiting for a file this device uploaded.
 * The editor calls it after its own changes (components/editor/Editor.tsx).
 */
export function restoreUploadedFiles(state: EditorState, documentId: string): Transaction | null {
  let tr: Transaction | null = null;
  state.doc.forEach((node, pos) => {
    if (node.attrs.fileId || !node.attrs.id || !["image", "file", "audio"].includes(node.type.name)) return;
    // (An image that shows a picture from the web has no file to wait for.)
    if (node.type.name === "image" && node.attrs.url) return;
    const fileId = completedUploadFor(documentId, String(node.attrs.id));
    if (!fileId) return;
    tr = (tr ?? state.tr).setNodeMarkup(pos, undefined, { ...node.attrs, fileId, uploadId: null });
  });
  return tr ? (tr as Transaction).setMeta("addToHistory", false) : null;
}

/** "Retry now" beside an interrupted upload: every waiting upload is tried again at once (lib/sync/uploads.ts). */
function RetryUpload({ className = "" }: { className?: string }) {
  return (
    <button type="button" contentEditable={false} onClick={() => retryUploads()} className={`rounded-tiny underline underline-offset-2 hover:text-heading ${className}`}>
      Retry now
    </button>
  );
}

// Printing draws the whole note at once: pictures still waiting to be scrolled to are asked for now.
if (typeof window !== "undefined") {
  window.addEventListener("beforeprint", () => {
    for (const img of document.querySelectorAll<HTMLImageElement>('.fb-image-box img[loading="lazy"]')) img.loading = "eager";
  });
}

/**
 * Where the part of the page an element scrolls in starts, in the window's coordinates: the top of the nearest
 * thing that scrolls or clips it, past what that keeps clear at its top (the page's own bar).
 */
function visibleTop(el: Element): number {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const cs = getComputedStyle(p);
    if (/auto|scroll|hidden|clip/.test(cs.overflowY)) return Math.max(0, p.getBoundingClientRect().top + (parseFloat(cs.scrollPaddingTop) || 0));
  }
  return 0;
}

function ImageView({ node, selected, updateAttributes, editor, getPos }: ReactNodeViewProps) {
  const a = node.attrs as {
    id: string;
    fileId: string | null;
    url: string | null;
    alt: string;
    caption: string;
    width: number | null;
    naturalWidth: number | null;
    naturalHeight: number | null;
    uploadId: string | null;
  };
  const { file, missing, renew } = useFileUrl(editor, a.fileId);
  const upload = useUploadState(a.id);
  const preview = useLocalPreview(a.fileId, upload?.uploadId, file?.url);
  const src = file?.url ?? (a.url ? sanitizeHref(a.url) : null) ?? preview;
  // The picture's shape, known before it loads (from the block, or the stored file), then as it really is.
  const [drawn, setDrawn] = useState<{ src: string; width: number; height: number } | null>(null);
  const size = (drawn && drawn.src === src ? drawn : null) ?? imageBoxSize(a, file);
  const shape = size ? `${size.width} / ${size.height}` : undefined;
  // Nothing to show yet, and a picture is on its way: its address is being asked for, or it's being uploaded
  // from this device (the copy kept here is read a moment after the block appears, and the file's id only
  // arrives once the upload is done). "Unavailable" is for a picture that is really gone.
  const loading = Boolean(upload) || (Boolean(a.fileId) && !missing);
  const width = a.width ?? 1;
  // What the person wrote about the image. Older uploads carry their file's name as alt; that isn't a
  // description, so it's neither read out nor shown in the Description field. Without a description the picture
  // is skipped by screen readers: the block is already called "Image" and its caption is read with it.
  const description = imageDescription(a.alt);
  // The file name this image had as alt when it was opened: the field starts empty over it (and writing replaces it).
  const [fileNameAlt] = useState(() => (a.alt && looksLikeFileName(a.alt) ? a.alt : null));
  const editable = useEditable(editor);
  // The note can turn read-only while a field is open: nothing is written then.
  const update = (attrs: Record<string, unknown>) => {
    if (editor.isEditable) updateAttributes(attrs);
  };

  const figureRef = useRef<HTMLElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const toolsRef = useRef<HTMLDivElement>(null);
  // The width drawn while a handle is dragged: nothing is saved until it's let go. (Letting go clears this and
  // writes the width in the same breath: both are drawn before the browser paints again, so the old width
  // never shows in between.)
  const [live, setLive] = useState<number | null>(null);
  const shown = live ?? width;
  const [gripHeld, setGripHeld] = useState<"left" | "right" | null>(null);
  // A picture narrower than a fifth of the column at its own size can't be made any smaller: no handles.
  const [tiny, setTiny] = useState(false);
  const checkTiny = () => {
    const column = figureRef.current?.parentElement?.getBoundingClientRect().width ?? 0;
    const natural = boxRef.current?.querySelector("img")?.naturalWidth ?? 0;
    setTiny(column > 0 && natural > 0 && natural <= column * MIN_IMAGE_WIDTH);
  };
  const endResize = useRef<((save: boolean) => void) | null>(null);
  useEffect(() => () => endResize.current?.(false), []);

  // Dragging a handle. The picture keeps its left edge (the figure starts at the column's), so a handle moved
  // by some distance changes the width by that distance: the right one outward to widen, the left one the other
  // way round. One write when it's let go (one step to undo); Escape, or the press being taken away, puts
  // the width back.
  const startResize = (e: React.PointerEvent<HTMLElement>, side: "left" | "right") => {
    if (e.button !== 0 || !editor.isEditable || endResize.current) return;
    const column = figureRef.current?.parentElement?.getBoundingClientRect().width ?? 0;
    const picture = boxRef.current?.getBoundingClientRect().width ?? 0;
    if (!column || !picture) return;
    e.preventDefault();
    e.stopPropagation();
    const grip = e.currentTarget;
    const pointer = e.pointerId;
    const startX = e.clientX;
    const startY = e.clientY;
    // A finger's drag is weighed before it resizes anything (resizeIntent): one going up or down is a scroll.
    const touch = e.pointerType === "touch";
    const from = a.width;
    // A small picture is never stretched: it's drawn narrower than its share of the column, the drag starts from
    // what is drawn, and past its own size there's nothing wider to drag to.
    const natural = boxRef.current?.querySelector("img")?.naturalWidth ?? 0;
    const most = natural > 0 && natural < column ? natural / column : 1;
    const start = Math.min(width, picture / column);
    let next = start;
    let moved = false;
    const move = (m: PointerEvent) => {
      if (m.pointerId !== pointer) return;
      const dx = (m.clientX - startX) * (side === "right" ? 1 : -1);
      if (!moved) {
        const intent = resizeIntent(dx, m.clientY - startY, touch);
        if (intent === "wait") return;
        // The start of a scroll: the handle lets go, the width stays, and the block isn't selected for it.
        if (intent === "scroll") return end(false);
        moved = true;
      }
      next = Math.max(Math.min(MIN_IMAGE_WIDTH, most), Math.min(most, start + dx / column));
      setLive(next);
    };
    const end = (save: boolean) => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", up, true);
      window.removeEventListener("keydown", key, true);
      if (grip.hasPointerCapture?.(pointer)) grip.releasePointerCapture(pointer);
      document.documentElement.classList.remove("fb-image-resizing");
      endResize.current = null;
      setGripHeld(null);
      // As wide as the picture goes is "full width": saved as a share, it would shrink the picture on a narrower screen.
      const saved = next >= most - 0.004 ? null : imageWidthAttr(next);
      setLive(null);
      if (save && moved && editor.isEditable && saved !== from) updateAttributes({ width: saved });
      // A press let go where it began is a click on the picture: the block is selected, as anywhere else on it.
      if (save && !moved) selectBlock(editor, getPos);
    };
    const up = (u: PointerEvent) => {
      if (u.pointerId === pointer) end(u.type === "pointerup");
    };
    const key = (k: KeyboardEvent) => {
      if (k.key !== "Escape") return;
      // Only the drag ends: the block stays selected and no dialog around the note closes.
      k.preventDefault();
      k.stopPropagation();
      end(false);
    };
    endResize.current = end;
    // The handle keeps the pointer (so the drag carries on outside the window too); the window is listened to
    // all the same, for a pointer that can't be kept (one already gone by now).
    try {
      grip.setPointerCapture?.(pointer);
    } catch {
      // Not kept: the window's own events still follow it.
    }
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", up, true);
    window.addEventListener("keydown", key, true);
    document.documentElement.classList.add("fb-image-resizing");
    setGripHeld(side);
  };
  const grip = (side: "left" | "right") => (
    // (Not a button: the Width buttons in the image's tools are the same thing for the keyboard and a screen reader.)
    <span
      data-image-grip={side}
      data-active={gripHeld === side ? "" : undefined}
      className={`fb-image-grip fb-image-grip-${side}`}
      aria-hidden
      title="Drag to resize. Double-click for full width"
      onPointerDown={(e) => startResize(e, side)}
      // The press is the handle's alone: no caret, no selection, no drag of the block.
      onMouseDown={(e) => e.preventDefault()}
      onDoubleClick={(e) => {
        e.preventDefault();
        update({ width: null });
      }}
    />
  );

  // The tools float above the picture, clear of it, when there's room for them there (the picture's top is in
  // sight with space over it); otherwise over its bottom edge, as they always did. Sideways they stay centred
  // on the picture as far as the note's own width allows, so a narrow picture's tools aren't cut off at the
  // page's edge. They are placed, never laid out: nothing below the image moves when it's selected.
  const toolsShown = selected && editable && Boolean(src);
  const [place, setPlace] = useState<{ above: boolean; left: number } | null>(null);
  useLayoutEffect(() => {
    if (!toolsShown) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const box = boxRef.current;
      const tools = toolsRef.current;
      if (!box || !tools || editor.isDestroyed) return;
      const picture = box.getBoundingClientRect();
      const size = tools.getBoundingClientRect();
      const page = editor.view.dom.getBoundingClientRect();
      const above = picture.top - visibleTop(box) >= size.height + IMAGE_TOOLS_GAP * 2;
      const left = Math.round(Math.max(page.left, Math.min(page.right - size.width, picture.left + picture.width / 2 - size.width / 2)) - picture.left);
      setPlace((had) => (had && had.above === above && had.left === left ? had : { above, left }));
    };
    const soon = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    // The picture loading or being resized, the window changing, and anything scrolling under it.
    const sized = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(soon);
    if (boxRef.current) sized?.observe(boxRef.current);
    window.addEventListener("scroll", soon, { capture: true, passive: true });
    window.addEventListener("resize", soon);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      sized?.disconnect();
      window.removeEventListener("scroll", soon, true);
      window.removeEventListener("resize", soon);
    };
  }, [toolsShown, editor]);

  return (
    <Frame selected={selected} label="Image">
      <figure ref={figureRef} className="my-2" style={{ width: `${Math.round(shown * 10000) / 100}%` }}>
        {src ? (
          // Never wider than the image itself (a small image isn't stretched), so the handles on its edges
          // hug the picture as it is drawn.
          <div ref={boxRef} className="fb-image-box relative mx-auto w-fit max-w-full" data-selected={selected ? "" : undefined} onPointerEnter={checkTiny}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              alt={description}
              // Pictures further down (or in a tab that isn't open) load when they come near the screen, and
              // are decoded off the main thread: a note of sixty photos no longer fetches and holds them all
              // at once. Their place is kept meanwhile by the size below.
              loading="lazy"
              decoding="async"
              width={size?.width}
              height={size?.height}
              style={shape ? { aspectRatio: shape } : undefined}
              className="ui-img-outline block h-auto max-w-full rounded-chip bg-sunken"
              draggable={false}
              onLoad={(e) => {
                const img = e.currentTarget;
                checkTiny();
                if (!(img.naturalWidth > 0 && img.naturalHeight > 0)) return;
                setDrawn({ src, width: img.naturalWidth, height: img.naturalHeight });
                // A picture just added from this device (still uploading) with no size on record: written with
                // it, once, so its place is kept wherever the note is opened next. Never for a picture that is
                // only being looked at: opening a note doesn't edit it.
                if (upload && editor.isEditable && !imageBoxSize(a)) setAttrsQuietly(editor, getPos, "image", { naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight });
              }}
              onError={() => {
                // The server's address stopped working (it ended while the app slept), or the device's copy was let go.
                if (src === file?.url) renew(src);
              }}
            />
            {editable && !tiny ? (
              <>
                {grip("left")}
                {grip("right")}
              </>
            ) : null}
            {toolsShown ? (
              <div
                ref={toolsRef}
                className={`ui-pop absolute z-20 flex w-max max-w-[min(32rem,calc(100vw-2rem))] flex-wrap items-center gap-2 px-2 py-1.5 text-footnote text-muted ${place ? "" : "bottom-2 left-1/2 -translate-x-1/2"}`}
                style={place ? { left: place.left, bottom: place.above ? `calc(100% + ${IMAGE_TOOLS_GAP}px)` : IMAGE_TOOLS_GAP } : undefined}
                contentEditable={false}
              >
                <label className="flex items-center gap-1">
                  Description
                  <DraftInput
                    data-enter-focus=""
                    value={a.alt === fileNameAlt ? "" : (a.alt ?? "")}
                    onCommit={(v) => update({ alt: v })}
                    onExit={() => selectBlock(editor, getPos)}
                    placeholder="What the image shows"
                    className="h-control-sm w-56 ui-input px-2 text-ink"
                  />
                </label>
                <span>Width</span>
                {[0.5, 0.75, 1].map((w) => (
                  <button
                    key={w}
                    type="button"
                    onClick={() => update({ width: w === 1 ? null : w })}
                    aria-pressed={width === w}
                    className={`h-7 rounded-chip border px-2 ${width === w ? "border-accent text-accent" : "border-line hover:bg-[var(--glass-hover)] hover:text-heading"}`}
                  >
                    {w * 100}%
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <div
            // A picture on its way keeps the place it will take, when its size is known; otherwise a fixed box.
            className={`grid place-items-center rounded-chip border border-dashed border-line-strong text-subheadline text-muted ${loading && size ? "mx-auto max-w-full" : "h-40"}`}
            style={loading && size ? { width: size.width, aspectRatio: shape } : undefined}
            aria-busy={loading || undefined}
          >
            {loading ? (
              "Loading image…"
            ) : (
              <span className="flex items-center gap-2">
                <ImageOff size={16} aria-hidden /> Image unavailable
              </span>
            )}
          </div>
        )}
        {upload ? (
          <p className="mt-1 text-footnote text-muted" role="status">
            {upload.state === "failed"
              ? `Upload interrupted. Retrying (attempt ${upload.attempts + 1})`
              : navigator.onLine
                ? "Uploading…"
                : "Waiting to upload (offline)"}
            {upload.state === "failed" && navigator.onLine ? <RetryUpload className="ml-2" /> : null}
          </p>
        ) : null}
        <figcaption className="mt-1.5">
          {editable ? (
            <DraftInput
              value={a.caption ?? ""}
              onCommit={(v) => update({ caption: v })}
              onExit={() => selectBlock(editor, getPos)}
              placeholder="Add a caption"
              aria-label="Image caption"
              className="w-full bg-transparent text-center text-subheadline text-muted outline-none placeholder:text-faint"
            />
          ) : a.caption ? (
            <span className="block text-center text-subheadline text-muted">{a.caption}</span>
          ) : null}
        </figcaption>
      </figure>
    </Frame>
  );
}

/** The native Mac app's Quick Look on an attachment (its bytes go to the app's preview panel). */
async function quickLookFile(url: string, name: string) {
  try {
    const res = await fetch(url);
    if (!res.ok) return;
    await macDesktop()?.quickLook?.([{ name, bytes: new Uint8Array(await res.arrayBuffer()) }]);
  } catch {
    // The file couldn't be fetched: Download still works.
  }
}

function FileView({ node, selected, editor }: ReactNodeViewProps) {
  const a = node.attrs as {
    id: string;
    fileId: string | null;
    name: string | null;
    size: number | null;
    mimeType: string | null;
  };
  const { file, missing } = useFileUrl(editor, a.fileId);
  const upload = useUploadState(a.id);
  return (
    <Frame selected={selected} label={`Attachment ${a.name ?? ""}`}>
      <div className="my-1.5 flex items-center gap-3 ui-card rounded-control px-3 py-2.5">
        <FileText size={20} className="text-muted" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="truncate text-subheadline font-medium">{a.name ?? "Attachment"}</p>
          <p className="text-footnote text-muted">
            {a.size ? formatBytes(a.size) : ""}
            {upload
              ? upload.state === "failed"
                ? " · Upload interrupted, retrying"
                : " · Uploading…"
              : missing
                ? " · This file was deleted or you no longer have access"
                : ""}
            {upload?.state === "failed" && navigator.onLine ? <RetryUpload className="ml-2" /> : null}
          </p>
        </div>
        {file && macDesktop()?.quickLook ? (
          <button
            type="button"
            onClick={() => void quickLookFile(file.url, a.name ?? "Attachment")}
            className="inline-flex h-8 items-center gap-1.5 rounded-chip border border-line px-2.5 text-footnote hover:bg-surface"
            contentEditable={false}
            title={macDesktop()?.platform === "mac" ? "Quick Look" : "Open"}
          >
            <Eye size={14} aria-hidden /> {macDesktop()?.platform === "mac" ? "Quick Look" : "Open"}
          </button>
        ) : null}
        {file ? (
          <a
            href={file.url}
            className="inline-flex h-8 items-center gap-1.5 rounded-chip border border-line px-2.5 text-footnote hover:bg-surface"
            download={a.name ?? true}
            contentEditable={false}
          >
            <Download size={14} aria-hidden /> Download
          </a>
        ) : null}
      </div>
    </Frame>
  );
}

/**
 * An audio recording: the uploaded file, or the copy saved on this device while it waits to upload. An
 * uploaded one can be transcribed (on request), with the transcript previewed under it.
 */
function AudioView({ node, selected, editor, getPos }: ReactNodeViewProps) {
  const a = node.attrs as {
    id: string;
    fileId: string | null;
    name: string | null;
    size: number | null;
    duration: number | null;
  };
  const { file, missing } = useFileUrl(editor, a.fileId);
  const upload = useUploadState(a.id);
  const preview = useLocalPreview(a.fileId, upload?.uploadId, file?.url);
  const editable = useEditable(editor);
  const canTranscribe = useCanTranscribe(file ? a.fileId : null);
  const transcription = useTranscription({ fileId: a.fileId, editor, getPos, node, editable, enabled: canTranscribe });
  const status = upload
    ? upload.state === "failed"
      ? "Upload interrupted, retrying"
      : navigator.onLine
        ? "Uploading…"
        : "Waiting to upload (offline)"
    : missing
      ? "Unavailable: the recording was deleted or you no longer have access"
      : !a.fileId && !preview
        ? "Not uploaded yet. It uploads from the device that recorded it"
        : null;
  return (
    <Frame selected={selected} label={`Audio recording ${a.name ?? ""}`}>
      <AudioPlayer
        // A renewed address (or the upload finishing) is the same recording: playback carries on.
        sourceId={a.id}
        src={file?.url ?? preview}
        download={file?.url}
        name={a.name}
        size={a.size}
        duration={a.duration}
        status={status}
        actions={
          upload?.state === "failed" && navigator.onLine ? (
            <button
              type="button"
              onClick={() => retryUploads()}
              aria-label="Retry the upload now"
              title="Retry the upload now"
              className="grid size-8 flex-none place-items-center rounded-chip text-muted hover:bg-[var(--glass-hover)] hover:text-heading"
            >
              <RotateCw size={15} aria-hidden />
            </button>
          ) : canTranscribe ? (
            <TranscribeButton onClick={transcription.start} busy={transcription.busy} title={transcription.title} />
          ) : null
        }
        className="my-1.5"
      />
      {transcription.preview}
    </Frame>
  );
}

function PageView({ node, selected }: ReactNodeViewProps) {
  const a = node.attrs as {
    documentId: string;
    display: "link" | "card";
    titleCache: string | null;
    iconCache: string | null;
  };
  const titles = useQuery(
    api.documents.titles,
    a.documentId ? { documentIds: [a.documentId] } : "skip",
  );
  const { engine } = useAppState();
  const info = titles?.[a.documentId];
  const title = info?.title || a.titleCache || "Untitled";
  // Deleted (or no longer shared): the server doesn't know it. A page made here and not yet sent isn't gone.
  const creating = Boolean(engine && [...engine.state.pending, ...engine.state.inflight].some((op) => op.kind === "document.create" && op.document.id === a.documentId));
  const missing = titles !== undefined && !info && !creating;
  const trashed = Boolean(info?.inTrash);
  const gone = missing || trashed;
  if (a.display === "link") {
    return (
      <Frame selected={selected} label={`Page ${title}${trashed ? " (in Trash)" : missing ? " (unavailable)" : ""}`}>
        <AppLink
          href={`/d/${a.documentId}`}
          title={trashed ? "This page is in Trash" : missing ? "This page is unavailable or you no longer have access" : undefined}
          className={`my-0.5 inline-flex items-center gap-2 rounded-chip px-1 py-0.5 font-medium underline decoration-line-strong underline-offset-4 hover:decoration-accent ${gone ? "text-muted line-through" : ""}`}
          contentEditable={false}
        >
          <FileText size={15} aria-hidden className="flex-none text-muted" /> {title}
        </AppLink>
      </Frame>
    );
  }
  return (
    <Frame selected={selected} label={`Page ${title}`}>
      <AppLink
        href={`/d/${a.documentId}`}
        contentEditable={false}
        className="group my-2 flex items-start gap-3 ui-card rounded-control p-4 no-underline transition-[border-color,transform] duration-150 hover:-translate-y-px transition-[transform,box-shadow] hover:-translate-y-px hover:shadow-[var(--shadow-edge),var(--shadow-floating)]"
        title="Open page (Alt-click opens a new tab)"
      >
        <FileText size={20} aria-hidden className="mt-0.5 flex-none text-muted" />
        <span className="min-w-0 flex-1">
          <span className={`block font-semibold ${gone ? "text-muted line-through" : "text-ink"}`}>{title}</span>
          <span className="line-clamp-2 block text-subheadline text-muted">
            {missing
              ? "This page is unavailable or you no longer have access."
              : trashed
                ? "This page is in Trash."
                : info?.excerpt || "Nested page"}
          </span>
        </span>
        <ExternalLink
          size={14}
          className="mt-1 text-faint opacity-0 group-hover:opacity-100"
          aria-hidden
        />
      </AppLink>
    </Frame>
  );
}

/** Asks a bookmark to open its editing fields (the right-click menu's "Edit bookmark…"). */
export const EDIT_BOOKMARK_EVENT = "folevi:edit-bookmark";

/** Bookmarks whose preview this session already asked for (each address once, unless the asking failed). */
const previewed = new Set<string>();

// Pages that turned out to have nothing to preview (no image, no icon, no description): remembered on this
// device, not in the note, so every bookmark to one isn't read again each time the app is opened.
const NO_PREVIEW_KEY = "folevi:bookmarks-without-preview";
const NO_PREVIEW_KEPT = 300;
const NO_PREVIEW_FOR_MS = 30 * 24 * 3_600_000;

function pagesWithoutPreview(): Record<string, number> {
  try {
    const stored = JSON.parse(localStorage.getItem(NO_PREVIEW_KEY) ?? "{}") as unknown;
    return stored && typeof stored === "object" && !Array.isArray(stored) ? (stored as Record<string, number>) : {};
  } catch {
    return {};
  }
}

/** Whether this address was read on this device lately and had nothing to show. */
function knownWithoutPreview(url: string): boolean {
  const at = pagesWithoutPreview()[url];
  return typeof at === "number" && Date.now() - at < NO_PREVIEW_FOR_MS;
}

function rememberWithoutPreview(url: string) {
  try {
    const all = Object.entries({ ...pagesWithoutPreview(), [url]: Date.now() })
      .filter(([, at]) => typeof at === "number")
      .sort((a, b) => b[1] - a[1])
      .slice(0, NO_PREVIEW_KEPT);
    localStorage.setItem(NO_PREVIEW_KEY, JSON.stringify(Object.fromEntries(all)));
  } catch {
    // No storage (private mode, or full): it's read again next time, as before.
  }
}

function BookmarkView({ node, selected, updateAttributes, editor, getPos }: ReactNodeViewProps) {
  const a = node.attrs as {
    url: string;
    title: string | null;
    description: string | null;
    siteName: string | null;
    image: string | null;
    icon: string | null;
  };
  const href = sanitizeHref(a.url ?? "") ?? "#";
  // The picture and the icon are the linked page's own, on the web: any other address (a path here, data:) isn't shown.
  const image = webUrl(a.image);
  const icon = webUrl(a.icon);
  const hostOf = (url: string) => {
    try {
      return new URL(url).host;
    } catch {
      return url;
    }
  };
  const host = hostOf(href);
  const editable = useEditable(editor);
  const env = useEditorEnvironment();
  const fetchPreview = useAction(api.bookmarks.preview);
  const [editing, setEditing] = useState(false);
  const [address, setAddress] = useState(a.url ?? "");
  const [addressError, setAddressError] = useState<string | null>(null);
  const [imageFailed, setImageFailed] = useState(false);
  const [iconFailed, setIconFailed] = useState(false);
  const card = useRef<HTMLDivElement>(null);
  const firstField = useRef<HTMLInputElement>(null);

  // Sets this bookmark's attributes without a step of their own to undo (as a pasted file's copy does when it
  // arrives: pastedFiles.ts). What a page says about itself comes a moment after its link is pasted; as a step,
  // the first ⌘Z after pasting would only take the preview off again and leave the bookmark standing. It is
  // still this person's note changing, so it's saved like any edit (it isn't marked "remote").
  const setQuietly = useCallback((attrs: Record<string, unknown>) => setAttrsQuietly(editor, getPos, "bookmark", attrs), [editor, getPos]);

  // The page's own title, description, image and icon, read once per address (on the server). Fields the
  // person wrote themselves are kept; a title that is just the address is replaced. Read by itself (a new
  // bookmark, a changed address) it's no step to undo; asked for with "Refresh preview" (`undoable`) it is one.
  const loadPreview = useCallback(
    async (url: string, replaceAll: boolean, undoable = false) => {
      // (Local mode reads previews once bookmarks.preview is ported there: lib/local/registry.ts.)
      if (env.demo || !/^https?:\/\//i.test(url) || !canCallHere(api.bookmarks.preview)) return;
      previewed.add(url);
      try {
        const p = await fetchPreview({ url });
        // Nothing to show for this page: not asked again by itself on this device for a while.
        if (!p.image && !p.icon && !p.description) rememberWithoutPreview(url);
        // The note may have turned read-only while the page was read.
        if (!editor.isEditable) return;
        const pos = typeof getPos === "function" ? getPos() : undefined;
        const live = typeof pos === "number" ? editor.state.doc.nodeAt(pos) : null;
        if (!live || live.type.name !== "bookmark" || live.attrs.url !== url) return;
        const now = live.attrs as typeof a;
        const plainTitle = !now.title || now.title === hostOf(url) || now.title === url;
        const patch: Record<string, unknown> = {};
        if (p.title && (replaceAll || plainTitle)) patch.title = p.title;
        if (p.description && (replaceAll || !now.description)) patch.description = p.description;
        if (p.siteName && (replaceAll || !now.siteName)) patch.siteName = p.siteName;
        if (replaceAll || !now.image) patch.image = p.image;
        if (replaceAll || !now.icon) patch.icon = p.icon;
        if (!Object.keys(patch).length) return;
        if (undoable) updateAttributes(patch);
        else setQuietly(patch);
      } catch {
        // No preview (offline, the site didn't answer): the bookmark keeps what it has, and the page is asked
        // again the next time the bookmark is shown (it used to count as asked for the rest of the session).
        previewed.delete(url);
      }
    },
    [env.demo, fetchPreview, getPos, editor, updateAttributes, setQuietly],
  );
  // An address saved broken ("https://Address:https://site.com/", from text pasted after the "https://"
  // the field started with) is repaired, and its page read again. (No step to undo either: undone, the repair
  // would only run again, and ⌘Z could never get past it.)
  useEffect(() => {
    if (!editable || !a.url) return;
    const fixed = webAddressIn(a.url);
    if (!fixed || fixed === a.url || webAddressIn(a.url) === sanitizeHref(a.url)) return;
    setQuietly({ url: fixed, title: hostOf(fixed), description: null, siteName: null, image: null, icon: null });
    void loadPreview(fixed, true);
  }, [editable, a.url, setQuietly, loadPreview]);
  useEffect(() => {
    if (!editable || !a.url || previewed.has(a.url)) return;
    // A new bookmark, or one saved before previews (or their images and icons) existed.
    if (a.image || a.icon || (a.description && a.title && a.title !== host && a.title !== a.url)) return;
    if (knownWithoutPreview(a.url)) return;
    void loadPreview(a.url, false);
  }, [editable, a.url, a.image, a.icon, a.description, a.title, host, loadPreview]);

  const startEditing = () => {
    setAddress(a.url ?? "");
    setAddressError(null);
    setEditing(true);
  };
  useEffect(() => {
    if (editing) firstField.current?.focus();
  }, [editing]);
  useEffect(() => {
    const el = card.current;
    if (!el) return;
    const on = () => editor.isEditable && startEditing();
    el.addEventListener(EDIT_BOOKMARK_EVENT, on);
    return () => el.removeEventListener(EDIT_BOOKMARK_EVENT, on);
  });

  // A changed address is saved once it's a web address, and its page's preview is read again.
  const saveAddress = (): boolean => {
    if (!editor.isEditable) return true;
    const next = webAddressIn(address);
    if (!next) {
      setAddressError("Enter a web address starting with http:// or https://");
      return false;
    }
    if (next !== a.url) {
      updateAttributes({ url: next, title: hostOf(next), description: null, siteName: null, image: null, icon: null });
      setImageFailed(false);
      setIconFailed(false);
      void loadPreview(next, true);
    }
    return true;
  };
  const finish = () => {
    if (!saveAddress()) return;
    setEditing(false);
    selectBlock(editor, getPos);
  };

  const showImage = Boolean(image) && !imageFailed;
  return (
    <Frame selected={selected} label={`Bookmark ${a.title ?? host}`}>
      <div ref={card} className="group/bookmark relative my-2 overflow-hidden ui-card rounded-control" contentEditable={false} data-bookmark="">
        {/* A click opens the page in a new tab (the pen edits it). */}
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer nofollow"
          onClick={(e) => {
            e.preventDefault();
            if (href !== "#") window.open(href, "_blank", "noopener,noreferrer");
          }}
          className="flex min-h-[7.5rem] items-stretch no-underline transition-colors hover:bg-[var(--glass-hover)]"
        >
          <span className="flex min-w-0 flex-1 flex-col justify-center gap-1 p-4 pr-10">
            {icon && !iconFailed ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={icon} alt="" referrerPolicy="no-referrer" loading="lazy" onError={() => setIconFailed(true)} className="mb-1 h-6 w-6 flex-none rounded-tiny object-contain" />
            ) : (
              <Link2 size={18} className="mb-1 text-muted" aria-hidden />
            )}
            <span className="block truncate font-semibold text-ink">{a.title || host}</span>
            {a.description ? <span className="line-clamp-2 block text-subheadline leading-snug text-muted">{a.description}</span> : null}
            <span className="block truncate text-footnote text-faint">
              {a.siteName ? `${a.siteName} · ` : ""}
              {host}
            </span>
          </span>
          {showImage ? (
            // The standard social image shape (1.91:1), so the whole picture shows rather than a cropped strip.
            <span className="relative my-3 mr-3 hidden aspect-[1.91/1] w-[34%] max-w-[260px] flex-none self-center overflow-hidden rounded-chip bg-sunken shadow-[inset_0_0_0_1px_var(--color-line)] sm:block" aria-hidden>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={image!} alt="" referrerPolicy="no-referrer" loading="lazy" onError={() => setImageFailed(true)} className="ui-img-outline absolute inset-0 h-full w-full rounded-[inherit] object-cover" />
            </span>
          ) : null}
        </a>
        {editable && !editing ? (
          <button
            type="button"
            aria-label="Edit bookmark"
            title="Edit bookmark"
            onClick={startEditing}
            className={`absolute right-2.5 top-2.5 grid h-7 w-7 place-items-center rounded-chip text-muted ui-raised transition-opacity hover:text-heading focus-visible:opacity-100 focus-visible:shadow-[0_0_0_2px_var(--color-focus)] focus-visible:outline-none group-hover/bookmark:opacity-100 pointer-coarse:opacity-100 ${selected ? "opacity-100" : "opacity-0"}`}
          >
            <Pencil size={14} aria-hidden />
          </button>
        ) : null}
        {editing && editable ? (
          <form
            className="grid gap-2 border-t border-line p-4 text-footnote"
            onSubmit={(e) => {
              e.preventDefault();
              finish();
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                setEditing(false);
                selectBlock(editor, getPos);
              }
            }}
          >
            <label className="grid gap-1">
              Web address
              <input
                ref={firstField}
                data-draft=""
                value={address}
                onChange={(e) => {
                  setAddress(e.target.value);
                  setAddressError(null);
                }}
                onBlur={() => {
                  if (address.trim() !== (a.url ?? "")) saveAddress();
                }}
                aria-invalid={Boolean(addressError)}
                className={`h-control ui-input px-2 text-callout text-ink ${addressError ? "shadow-[0_0_0_1.5px_var(--color-danger)]" : ""}`}
              />
              {addressError ? (
                <span role="alert" className="text-danger">
                  {addressError}
                </span>
              ) : null}
            </label>
            <label className="grid gap-1">
              Title
              <DraftInput value={a.title ?? ""} onCommit={(v) => editor.isEditable && updateAttributes({ title: v || null })} className="h-control ui-input px-2 text-callout text-ink" />
            </label>
            <label className="grid gap-1">
              Description
              <DraftInput value={a.description ?? ""} onCommit={(v) => editor.isEditable && updateAttributes({ description: v || null })} className="h-control ui-input px-2 text-callout text-ink" />
            </label>
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                className="ui-btn ui-btn-quiet h-control px-3 text-footnote"
                onClick={() => {
                  if (a.url) void loadPreview(a.url, true, true);
                }}
              >
                Refresh preview
              </button>
              <button type="submit" className="ui-btn ui-btn-primary h-control px-3 text-footnote">
                Done
              </button>
            </div>
          </form>
        ) : null}
      </div>
    </Frame>
  );
}

/**
 * A collection the server won't give (deleted, in another workspace, no longer shared): its card says so, rather
 * than the error taking the whole note down with it.
 */
class CollectionGone extends Component<{ children: ReactNode }, { failed: boolean; unloaded: unknown }> {
  override state = { failed: false, unloaded: null as unknown };
  static getDerivedStateFromError(error: unknown) {
    return { failed: true, unloaded: isChunkLoadError(error) ? error : null };
  }
  override render() {
    // The collection's own part of the app didn't load: that isn't a collection that's gone. Passed on to the
    // block's card, which offers to load it again.
    if (this.state.unloaded) throw this.state.unloaded;
    return this.state.failed ? <p className="rounded-chip border border-dashed border-line p-4 text-subheadline text-muted">This collection is unavailable.</p> : this.props.children;
  }
}

function CollectionView({ node, selected, editor }: ReactNodeViewProps) {
  const a = node.attrs as { collectionId: string; viewId: string | null };
  const editable = useEditable(editor);
  return (
    <Frame selected={selected} label="Collection">
      <div contentEditable={false} className="my-3">
        <CollectionGone key={a.collectionId}>
          <Suspense fallback={<div aria-busy aria-label="Loading collection" className="h-48 animate-pulse rounded-control bg-sunken motion-reduce:animate-none" />}>
            <CollectionEmbed collectionId={a.collectionId} initialViewId={a.viewId} editable={editable} />
          </Suspense>
        </CollectionGone>
      </div>
    </Frame>
  );
}

const CollectionBlockView = Object.assign(CollectionView, { reload: CollectionEmbed.reload });

function UnknownView({ node, selected, deleteNode, editor }: ReactNodeViewProps) {
  const wire = node.attrs.wire as { type?: string } | null;
  const editable = useEditable(editor);
  return (
    <Frame selected={selected} label="Unsupported block">
      <div
        contentEditable={false}
        className="my-2 flex items-center gap-3 rounded-chip border border-dashed border-line-strong bg-sunken px-4 py-3 text-subheadline text-muted"
      >
        <span className="flex-1">
          This “{wire?.type ?? "unknown"}” block was created by a newer version of Folevi. It’s kept
          safely and will appear once you update.
        </span>
        {editable ? (
          <button
            type="button"
            onClick={() => editor.isEditable && deleteNode()}
            aria-label="Remove block"
            title="Remove block"
            className="text-faint hover:text-danger"
          >
            <Trash2 size={14} aria-hidden />
          </button>
        ) : null}
      </div>
    </Frame>
  );
}

/** Undo and redo inside a block's own fields (captions, cells, formulas) go to the note's history. */
function isHistoryKey(event: Event): boolean {
  if (!(event instanceof KeyboardEvent) || event.type !== "keydown" || !(event.metaKey || event.ctrlKey) || event.altKey) return false;
  // Only fields bound to the block (captions, cells, a formula); a collection's own inputs keep their own undo.
  // And a tabs block's own tabs and buttons (TabsView marks the block with data-tabs-strip): after a tab is
  // deleted or moved from its menu the keyboard is on one of them, and ⌘Z has to bring the tab back. The field
  // a tab is renamed in is an input, not one of these: its ⌘Z undoes the typing in it.
  if (!(event.target instanceof Element) || !event.target.closest("[data-draft], [data-tabs-strip] button, [data-tabs-strip] [role=tab]")) return false;
  const key = event.key.toLowerCase();
  return key === "z" || (key === "y" && !event.shiftKey);
}

type StopEvent = (props: { event: Event }) => boolean;

/** A press, drag or double click on one of an image's resize handles (ImageView). */
function onImageGrip(event: Event): boolean {
  return /^(pointer|mouse|touch|click|dblclick)/.test(event.type) && event.target instanceof Element && Boolean(event.target.closest("[data-image-grip]"));
}

/**
 * A React block view whose outer element carries the block's id and depth like every other block, so it
 * indents, hides inside a collapsed toggle and lines up with the block handle.
 */
function blockView(component: ComponentType<ReactNodeViewProps> & { reload?: () => void }, stopEvent?: StopEvent) {
  // Every view draws inside its own boundary (BlockBoundary): one block that can't be shown is one card.
  return ReactNodeViewRenderer(guarded(component), {
    attrs: ({ node }) => ({ "data-block-id": String(node.attrs.id ?? ""), "data-depth": String(node.attrs.depth ?? 0), style: `--depth:${Number(node.attrs.depth ?? 0)}` }),
    ...(stopEvent ? { stopEvent: (props: { event: Event }) => onErrorCard(props.event) ?? (!isHistoryKey(props.event) && stopEvent(props)) } : {}),
  });
}

/** A text field bound to a block attribute through a draft (see useDraft). */
function DraftInput({ value, onCommit, onExit, ...rest }: Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> & { value: string; onCommit: (v: string) => void; onExit?: () => void }) {
  const [draft, change] = useDraft(value, onCommit);
  return (
    <input
      {...rest}
      data-draft=""
      value={draft}
      onChange={(e) => change(e.target.value)}
      onKeyDown={(e) => {
        rest.onKeyDown?.(e);
        // Escape or Enter: back to the note with the block selected.
        if (onExit && !e.defaultPrevented && !e.nativeEvent.isComposing && e.keyCode !== 229 && (e.key === "Escape" || e.key === "Enter")) {
          e.preventDefault();
          onExit();
        }
      }}
    />
  );
}

/** Selects the block at `getPos()` and returns focus to the note. */
function selectBlock(editor: ReactNodeViewProps["editor"], getPos: ReactNodeViewProps["getPos"]) {
  const pos = typeof getPos === "function" ? getPos() : undefined;
  if (typeof pos !== "number") return;
  editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)));
  editor.view.focus();
}

/** An embedded video, design file or map. The bar under the frame selects the block; its link opens the original. */
function EmbedView({ node, selected, editor, getPos }: ReactNodeViewProps) {
  const a = node.attrs as { url: string | null; provider: string | null };
  return (
    <Frame selected={selected} label="Embed">
      <div
        contentEditable={false}
        onMouseDown={(e) => {
          if (e.target instanceof Element && e.target.closest("a, iframe")) return;
          e.preventDefault();
          selectBlock(editor, getPos);
        }}
      >
        <EmbedFrame url={a.url ?? ""} />
      </div>
    </Frame>
  );
}

export const NODE_VIEW_EXTENSIONS = [
  ImageBlock.extend({
    // Its fields, its buttons and its resize handles (a press or drag on one is never the note's, or the block
    // would be picked up and dragged away) handle their own input.
    addNodeView: () => blockView(ImageView, ({ event }) => event.target instanceof HTMLInputElement || event.target instanceof HTMLButtonElement || onImageGrip(event)),
  }),
  FileBlock.extend({ addNodeView: () => blockView(FileView) }),
  // The player's buttons, slider and link handle their own input.
  AudioBlock.extend({
    addNodeView: () => blockView(AudioView, ({ event }) => event.target instanceof Element && Boolean(event.target.closest("button, a, [role=slider]"))),
  }),
  // Cells, their editor and the tools handle their own input (table/TableView.tsx).
  TableBlock.extend({ addNodeView: () => blockView(TableView, ({ event }) => tableHandlesEvent(event)) }),
  PageBlock.extend({ addNodeView: () => blockView(PageView) }),
  BookmarkBlock.extend({
    // The link, the pen and the editing fields handle their own clicks and keys.
    addNodeView: () => blockView(BookmarkView, ({ event }) => event.target instanceof Element && Boolean(event.target.closest("a, button, input, form"))),
  }),
  CollectionBlock.extend({
    addNodeView: () => blockView(CollectionBlockView, () => true),
  }),
  // The frame and the Open link handle their own input; a click on the bar selects the block.
  EmbedBlock.extend({
    addNodeView: () => blockView(EmbedView, ({ event }) => event.target instanceof Element && Boolean(event.target.closest("a, iframe"))),
  }),
  UnknownBlock.extend({ addNodeView: () => blockView(UnknownView) }),
  // Its own editor's keys (undo included) and pointer stay with it: no blockView history pass-through.
  SyncedBlock.extend({
    addNodeView: () =>
      ReactNodeViewRenderer(guarded(LazySynced), {
        attrs: ({ node }) => ({ "data-block-id": String(node.attrs.id ?? ""), "data-depth": String(node.attrs.depth ?? 0), style: `--depth:${Number(node.attrs.depth ?? 0)}` }),
        stopEvent: ({ event }) => onErrorCard(event) ?? syncedOwnsEvent(event),
      }),
  }),
  FormulaBlock.extend({
    addNodeView: () =>
      blockView(FormulaView, ({ event }) => event.target instanceof HTMLTextAreaElement || (event.target instanceof Element && Boolean(event.target.closest("button")))),
  }),
  // Drawing needs every pointer event; the toolbar needs its clicks.
  WhiteboardBlock.extend({
    addNodeView: () => blockView(LazyWhiteboard, () => true),
  }),
  // The canvas handles its own pointer, wheel and keyboard input (and its own undo while focused).
  FlowchartBlock.extend({
    addNodeView: () => blockView(LazyFlowchart, () => true),
  }),
  // Mind maps, sticky notes, charts and wireframes handle their own input too (canvas/CanvasCard.tsx).
  MindmapBlock.extend({ addNodeView: () => blockView(LazyMindmap, () => true) }),
  StickiesBlock.extend({ addNodeView: () => blockView(LazyStickies, () => true) }),
  ChartBlock.extend({ addNodeView: () => blockView(LazyChart, () => true) }),
  WireframeBlock.extend({ addNodeView: () => blockView(LazyWireframe, () => true) }),
  // The tab strip's tabs, buttons and rename field handle their own input (tabs/TabsView.tsx).
  TabsBlock.extend({ addNodeView: () => blockView(TabsView, ({ event }) => event.target instanceof Element && Boolean(event.target.closest("button, input, [role=tablist]"))) }),
];
