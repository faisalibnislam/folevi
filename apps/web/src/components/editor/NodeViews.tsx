"use client";

import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from "@tiptap/react";
import { NodeSelection } from "@tiptap/pm/state";
import { useAction, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import {
  Download,
  ExternalLink,
  FileText,
  ImageOff,
  Link2,
  Pencil,
  Trash2,
} from "lucide-react";
import { CHART_DEFAULT_HEIGHT, MINDMAP_DEFAULT_HEIGHT, STICKIES_DEFAULT_HEIGHT, WIREFRAME_DEFAULT_HEIGHT, sanitizeHref, type SyncState } from "@folevi/editor-schema";
import { webAddressIn } from "./autolink";
import { api } from "@/lib/convex/api";
import { canCallHere } from "@/lib/mode";
import { useAppState } from "@/lib/app/state";
import { AppLink } from "@/lib/app/router";
import { useEngineSelector } from "@/lib/hooks/useEngine";
import { localPreviewUrl, releaseLocalPreview } from "@/lib/sync/uploads";
import { formatBytes } from "@/lib/format";
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

// The whiteboard, flowchart, the other visual blocks and collections are large and most notes have none: each
// loads the first time a note shows one, in a placeholder of the block's own height so nothing moves when it
// arrives.
const WhiteboardView = lazy(() => import("./WhiteboardView").then((m) => ({ default: m.WhiteboardView })));
const FlowchartView = lazy(() => import("./flowchart/FlowchartView").then((m) => ({ default: m.FlowchartView })));
const MindmapView = lazy(() => import("./mindmap/MindmapView").then((m) => ({ default: m.MindmapView })));
const StickiesView = lazy(() => import("./stickies/StickiesView").then((m) => ({ default: m.StickiesView })));
const ChartView = lazy(() => import("./chart/ChartView").then((m) => ({ default: m.ChartView })));
const WireframeView = lazy(() => import("./wireframe/WireframeView").then((m) => ({ default: m.WireframeView })));
const CollectionEmbed = lazy(() => import("./CollectionEmbed").then((m) => ({ default: m.CollectionEmbed })));
// A synced block runs an editor of its own for its content (synced/SyncedView.tsx).
const SyncedView = lazy(() => import("./synced/SyncedView").then((m) => ({ default: m.SyncedView })));

function LazySynced(props: ReactNodeViewProps) {
  return (
    <Suspense fallback={<LoadingBlock height={72} />}>
      <SyncedView {...props} />
    </Suspense>
  );
}

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

function LazyWhiteboard(props: ReactNodeViewProps) {
  return (
    <Suspense fallback={<LoadingBlock height={Number(props.node.attrs.height) || 420} />}>
      <WhiteboardView {...props} />
    </Suspense>
  );
}

function LazyFlowchart(props: ReactNodeViewProps) {
  return (
    <Suspense fallback={<LoadingBlock height={Number(props.node.attrs.height) || 440} />}>
      <FlowchartView {...props} />
    </Suspense>
  );
}

/** A lazily loaded visual block, with a placeholder of its own height (and the card's height handle) meanwhile. */
function lazyVisual(View: React.ComponentType<ReactNodeViewProps>, fallbackHeight: number) {
  return function LazyVisual(props: ReactNodeViewProps) {
    return (
      <Suspense fallback={<LoadingBlock height={(Number(props.node.attrs.height) || fallbackHeight) + 14} />}>
        <View {...props} />
      </Suspense>
    );
  };
}
const LazyMindmap = lazyVisual(MindmapView, MINDMAP_DEFAULT_HEIGHT);
const LazyStickies = lazyVisual(StickiesView, STICKIES_DEFAULT_HEIGHT);
const LazyChart = lazyVisual(ChartView, CHART_DEFAULT_HEIGHT);
const LazyWireframe = lazyVisual(WireframeView, WIREFRAME_DEFAULT_HEIGHT);

function useNow(bucketMs: number): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / bucketMs) * bucketMs);
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / bucketMs) * bucketMs), bucketMs);
    return () => clearInterval(id);
  }, [bucketMs]);
  return now;
}

type FileInfo = FunctionReturnType<typeof api.files.urls>[string];

/**
 * A file's signed address, renewed every half hour. `missing` once the server has answered without it
 * (deleted, or no longer visible to this person).
 */
function useFileUrl(fileId: string | null): { file: FileInfo | undefined; missing: boolean } {
  const now = useNow(30 * 60_000);
  const urls = useQuery(api.files.urls, fileId ? { fileIds: [fileId], now } : "skip");
  // Each renewal is a new query that starts out unanswered: until it answers, the last address for this file
  // stays, so images don't flash back to loading and playing audio doesn't stop.
  const fresh = fileId && urls ? urls[fileId] : undefined;
  const [last, setLast] = useState<{ fileId: string; file: FileInfo } | null>(null);
  if (fileId && fresh && (last?.fileId !== fileId || last.file.url !== fresh.url)) setLast({ fileId, file: fresh });
  if (!fileId) return { file: undefined, missing: false };
  if (urls) return { file: fresh, missing: !fresh };
  return { file: last?.fileId === fileId ? last.file : undefined, missing: false };
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

function ImageView({ node, selected, updateAttributes, editor, getPos }: ReactNodeViewProps) {
  const a = node.attrs as {
    id: string;
    fileId: string | null;
    url: string | null;
    alt: string;
    caption: string;
    width: number | null;
    uploadId: string | null;
  };
  const { file, missing } = useFileUrl(a.fileId);
  const upload = useUploadState(a.id);
  const preview = useLocalPreview(a.fileId, upload?.uploadId, file?.url);
  const src = file?.url ?? (a.url ? sanitizeHref(a.url) : null) ?? preview;
  const width = a.width ?? 1;
  const editable = useEditable(editor);
  // The note can turn read-only while a field is open: nothing is written then.
  const update = (attrs: Record<string, unknown>) => {
    if (editor.isEditable) updateAttributes(attrs);
  };
  return (
    <Frame selected={selected} label="Image">
      <figure className="my-2" style={{ width: `${Math.round(width * 100)}%` }}>
        {src ? (
          // Never wider than the image itself (a small image isn't stretched); while it's selected its tools
          // float over it, centred, so nothing below moves and a small image's tools stay inside the page.
          <div className="relative mx-auto w-fit max-w-full">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt={a.alt || ""} className="block h-auto max-w-full rounded-chip border border-line bg-sunken" draggable={false} />
            {selected && editable ? (
              <div
                className="ui-pop absolute bottom-2 left-1/2 z-20 flex w-max -translate-x-1/2 max-w-[min(32rem,calc(100vw-2rem))] flex-wrap items-center gap-2 px-2 py-1.5 text-xs text-muted"
                contentEditable={false}
              >
                <label className="flex items-center gap-1">
                  Alt text
                  <DraftInput
                    data-enter-focus=""
                    value={a.alt ?? ""}
                    onCommit={(v) => update({ alt: v })}
                    onExit={() => selectBlock(editor, getPos)}
                    placeholder="Describe the image"
                    className="h-7 w-56 ui-input rounded-chip px-2 text-ink"
                  />
                </label>
                <span>Width</span>
                {[0.5, 0.75, 1].map((w) => (
                  <button
                    key={w}
                    type="button"
                    onClick={() => update({ width: w === 1 ? null : w })}
                    aria-pressed={width === w}
                    className={`h-7 rounded-chip border px-2 ${width === w ? "border-accent text-accent" : "border-line"}`}
                  >
                    {w * 100}%
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="grid h-40 place-items-center rounded-chip border border-dashed border-line-strong text-sm text-muted">
            {a.fileId && !missing ? (
              "Loading image…"
            ) : (
              <span className="flex items-center gap-2">
                <ImageOff size={16} aria-hidden /> Image unavailable
              </span>
            )}
          </div>
        )}
        {upload ? (
          <p className="mt-1 text-xs text-muted" role="status">
            {upload.state === "failed"
              ? `Upload interrupted. Retrying (attempt ${upload.attempts + 1})`
              : navigator.onLine
                ? "Uploading…"
                : "Waiting to upload (offline)"}
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
              className="w-full bg-transparent text-center text-sm text-muted outline-none placeholder:text-faint"
            />
          ) : a.caption ? (
            <span className="block text-center text-sm text-muted">{a.caption}</span>
          ) : null}
        </figcaption>
      </figure>
    </Frame>
  );
}

function FileView({ node, selected }: ReactNodeViewProps) {
  const a = node.attrs as {
    id: string;
    fileId: string | null;
    name: string | null;
    size: number | null;
    mimeType: string | null;
  };
  const { file, missing } = useFileUrl(a.fileId);
  const upload = useUploadState(a.id);
  return (
    <Frame selected={selected} label={`Attachment ${a.name ?? ""}`}>
      <div className="my-1.5 flex items-center gap-3 ui-card rounded-control px-3 py-2.5">
        <FileText size={20} className="text-muted" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{a.name ?? "Attachment"}</p>
          <p className="text-xs text-muted">
            {a.size ? formatBytes(a.size) : ""}
            {upload
              ? upload.state === "failed"
                ? " · Upload interrupted, retrying"
                : " · Uploading…"
              : missing
                ? " · This file was deleted or you no longer have access"
                : ""}
          </p>
        </div>
        {file ? (
          <a
            href={file.url}
            className="inline-flex h-8 items-center gap-1.5 rounded-chip border border-line px-2.5 text-xs hover:bg-surface"
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
  const { file, missing } = useFileUrl(a.fileId);
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
        actions={canTranscribe ? <TranscribeButton onClick={transcription.start} busy={transcription.busy} title={transcription.title} /> : null}
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
        className="group my-2 flex items-start gap-3 ui-card rounded-control p-4 no-underline transition-[border-color,transform] duration-150 hover:-translate-y-px transition-[transform,box-shadow] hover:-translate-y-px hover:shadow-[var(--shadow-pop)]"
        title="Open page (Alt-click opens a new tab)"
      >
        <FileText size={20} aria-hidden className="mt-0.5 flex-none text-muted" />
        <span className="min-w-0 flex-1">
          <span className={`block font-semibold ${gone ? "text-muted line-through" : "text-ink"}`}>{title}</span>
          <span className="line-clamp-2 block text-sm text-muted">
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

/** Bookmarks whose preview this session already asked for (each address once). */
const previewed = new Set<string>();

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

  // The page's own title, description, image and icon, read once per address (on the server). Fields the
  // person wrote themselves are kept; a title that is just the address is replaced.
  const loadPreview = useCallback(
    async (url: string, replaceAll: boolean) => {
      // (Local mode reads previews once bookmarks.preview is ported there: lib/local/registry.ts.)
      if (env.demo || !/^https?:\/\//i.test(url) || !canCallHere(api.bookmarks.preview)) return;
      previewed.add(url);
      try {
        const p = await fetchPreview({ url });
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
        if (Object.keys(patch).length) updateAttributes(patch);
      } catch {
        // No preview (offline, the site didn't answer): the bookmark keeps what it has.
      }
    },
    [env.demo, fetchPreview, getPos, editor, updateAttributes],
  );
  // An address saved broken ("https://Address:https://site.com/", from text pasted after the "https://"
  // the field started with) is repaired, and its page read again.
  useEffect(() => {
    if (!editable || !a.url) return;
    const fixed = webAddressIn(a.url);
    if (!fixed || fixed === a.url || webAddressIn(a.url) === sanitizeHref(a.url)) return;
    updateAttributes({ url: fixed, title: hostOf(fixed), description: null, siteName: null, image: null, icon: null });
    void loadPreview(fixed, true);
  }, [editable, a.url, updateAttributes, loadPreview]);
  useEffect(() => {
    if (!editable || !a.url || previewed.has(a.url)) return;
    // A new bookmark, or one saved before previews (or their images and icons) existed.
    if (a.image || a.icon || (a.description && a.title && a.title !== host && a.title !== a.url)) return;
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

  const showImage = Boolean(a.image) && !imageFailed;
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
          className="flex min-h-[7.5rem] items-stretch no-underline"
        >
          <span className="flex min-w-0 flex-1 flex-col justify-center gap-1 p-4 pr-10">
            {a.icon && !iconFailed ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={a.icon} alt="" referrerPolicy="no-referrer" loading="lazy" onError={() => setIconFailed(true)} className="mb-1 h-6 w-6 flex-none rounded-tiny object-contain" />
            ) : (
              <Link2 size={18} className="mb-1 text-muted" aria-hidden />
            )}
            <span className="block truncate font-semibold text-ink">{a.title || host}</span>
            {a.description ? <span className="line-clamp-2 block text-sm leading-snug text-muted">{a.description}</span> : null}
            <span className="block truncate text-xs text-faint">
              {a.siteName ? `${a.siteName} · ` : ""}
              {host}
            </span>
          </span>
          {showImage ? (
            // The standard social image shape (1.91:1), so the whole picture shows rather than a cropped strip.
            <span className="relative my-3 mr-3 hidden aspect-[1.91/1] w-[34%] max-w-[260px] flex-none self-center overflow-hidden rounded-chip bg-sunken shadow-[inset_0_0_0_1px_var(--color-line)] sm:block" aria-hidden>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={a.image!} alt="" referrerPolicy="no-referrer" loading="lazy" onError={() => setImageFailed(true)} className="absolute inset-0 h-full w-full object-cover" />
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
            className="grid gap-2 border-t border-line p-4 text-xs"
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
                className={`h-8 ui-input rounded-chip px-2 text-sm text-ink ${addressError ? "shadow-[0_0_0_1.5px_var(--color-danger)]" : ""}`}
              />
              {addressError ? (
                <span role="alert" className="text-danger">
                  {addressError}
                </span>
              ) : null}
            </label>
            <label className="grid gap-1">
              Title
              <DraftInput value={a.title ?? ""} onCommit={(v) => editor.isEditable && updateAttributes({ title: v || null })} className="h-8 ui-input rounded-chip px-2 text-sm text-ink" />
            </label>
            <label className="grid gap-1">
              Description
              <DraftInput value={a.description ?? ""} onCommit={(v) => editor.isEditable && updateAttributes({ description: v || null })} className="h-8 ui-input rounded-chip px-2 text-sm text-ink" />
            </label>
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                className="ui-btn ui-btn-quiet h-8 px-3 text-xs"
                onClick={() => {
                  if (a.url) void loadPreview(a.url, true);
                }}
              >
                Refresh preview
              </button>
              <button type="submit" className="ui-btn ui-btn-primary h-8 px-3.5 text-xs">
                Done
              </button>
            </div>
          </form>
        ) : null}
      </div>
    </Frame>
  );
}

function CollectionView({ node, selected, editor }: ReactNodeViewProps) {
  const a = node.attrs as { collectionId: string; viewId: string | null };
  const editable = useEditable(editor);
  return (
    <Frame selected={selected} label="Collection">
      <div contentEditable={false} className="my-3">
        <Suspense fallback={<div aria-busy aria-label="Loading collection" className="h-48 animate-pulse rounded-control bg-sunken motion-reduce:animate-none" />}>
          <CollectionEmbed collectionId={a.collectionId} initialViewId={a.viewId} editable={editable} />
        </Suspense>
      </div>
    </Frame>
  );
}

function UnknownView({ node, selected, deleteNode, editor }: ReactNodeViewProps) {
  const wire = node.attrs.wire as { type?: string } | null;
  const editable = useEditable(editor);
  return (
    <Frame selected={selected} label="Unsupported block">
      <div
        contentEditable={false}
        className="my-2 flex items-center gap-3 rounded-chip border border-dashed border-line-strong bg-sunken px-4 py-3 text-sm text-muted"
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
  if (!(event.target instanceof Element) || !event.target.closest("[data-draft]")) return false;
  const key = event.key.toLowerCase();
  return key === "z" || (key === "y" && !event.shiftKey);
}

type StopEvent = (props: { event: Event }) => boolean;

/**
 * A React block view whose outer element carries the block's id and depth like every other block, so it
 * indents, hides inside a collapsed toggle and lines up with the block handle.
 */
function blockView(component: React.ComponentType<ReactNodeViewProps>, stopEvent?: StopEvent) {
  return ReactNodeViewRenderer(component, {
    attrs: ({ node }) => ({ "data-block-id": String(node.attrs.id ?? ""), "data-depth": String(node.attrs.depth ?? 0), style: `--depth:${Number(node.attrs.depth ?? 0)}` }),
    ...(stopEvent ? { stopEvent: (props: { event: Event }) => !isHistoryKey(props.event) && stopEvent(props) } : {}),
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
    addNodeView: () => blockView(ImageView, ({ event }) => event.target instanceof HTMLInputElement || event.target instanceof HTMLButtonElement),
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
    addNodeView: () => blockView(CollectionView, () => true),
  }),
  // The frame and the Open link handle their own input; a click on the bar selects the block.
  EmbedBlock.extend({
    addNodeView: () => blockView(EmbedView, ({ event }) => event.target instanceof Element && Boolean(event.target.closest("a, iframe"))),
  }),
  UnknownBlock.extend({ addNodeView: () => blockView(UnknownView) }),
  // Its own editor's keys (undo included) and pointer stay with it: no blockView history pass-through.
  SyncedBlock.extend({
    addNodeView: () =>
      ReactNodeViewRenderer(LazySynced, {
        attrs: ({ node }) => ({ "data-block-id": String(node.attrs.id ?? ""), "data-depth": String(node.attrs.depth ?? 0), style: `--depth:${Number(node.attrs.depth ?? 0)}` }),
        stopEvent: ({ event }) => syncedOwnsEvent(event),
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
