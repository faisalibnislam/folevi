"use client";

import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from "@tiptap/react";
import { useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Download, ExternalLink, FileText, ImageOff, Link2, Minus, Plus, Trash2 } from "lucide-react";
import { plainText, sanitizeHref, type InlineNode } from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { AppLink } from "@/lib/app/router";
import { useEngineState } from "@/lib/hooks/useEngine";
import { localPreviewUrl } from "@/lib/sync/uploads";
import { formatBytes } from "@/lib/format";
import { BookmarkBlock, CollectionBlock, FileBlock, FlowchartBlock, FormulaBlock, ImageBlock, PageBlock, TableBlock, UnknownBlock, WhiteboardBlock } from "./extensions";
import { FormulaView } from "./FormulaView";
import { WhiteboardView } from "./WhiteboardView";
import { FlowchartView } from "./flowchart/FlowchartView";
import { CollectionEmbed } from "./CollectionEmbed";

function useNow(bucketMs: number): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / bucketMs) * bucketMs);
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / bucketMs) * bucketMs), bucketMs);
    return () => clearInterval(id);
  }, [bucketMs]);
  return now;
}

function useFileUrl(fileId: string | null) {
  const now = useNow(30 * 60_000);
  const urls = useQuery(api.files.urls, fileId ? { fileIds: [fileId], now } : "skip");
  return fileId ? urls?.[fileId] : undefined;
}

function useUploadState(blockId: string | null) {
  const { engine } = useAppState();
  const state = useEngineState(engine);
  return blockId ? state.uploads.find((u) => u.blockId === blockId) : undefined;
}

function Frame({ selected, children, label }: { selected: boolean; children: React.ReactNode; label: string }) {
  return (
    <NodeViewWrapper className={`fb-atom ${selected ? "fb-atom-selected" : ""}`} data-drag-handle="" aria-label={label}>
      {children}
    </NodeViewWrapper>
  );
}

function ImageView({ node, selected, updateAttributes, editor }: ReactNodeViewProps) {
  const { profile } = useAppState();
  const a = node.attrs as { id: string; fileId: string | null; url: string | null; alt: string; caption: string; width: number | null; uploadId: string | null };
  const file = useFileUrl(a.fileId);
  const upload = useUploadState(a.id);
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    if (!a.fileId && upload) void localPreviewUrl(profile.id, upload.uploadId).then(setPreview);
  }, [a.fileId, upload, profile.id]);
  const src = file?.url ?? (a.url ? sanitizeHref(a.url) : null) ?? preview;
  const width = a.width ?? 1;
  const editable = editor.isEditable;
  return (
    <Frame selected={selected} label="Image">
      <figure className="my-2" style={{ width: `${Math.round(width * 100)}%` }}>
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={a.alt || ""} className="w-full rounded-[6px] border border-line bg-sunken" draggable={false} />
        ) : (
          <div className="grid h-40 place-items-center rounded-[6px] border border-dashed border-line-strong text-sm text-muted">
            {a.fileId ? "Loading image…" : <span className="flex items-center gap-2"><ImageOff size={16} aria-hidden /> Image unavailable</span>}
          </div>
        )}
        {upload ? (
          <p className="mt-1 text-xs text-muted" role="status">
            {upload.state === "failed" ? `Upload interrupted — retrying (attempt ${upload.attempts + 1})` : navigator.onLine ? "Uploading…" : "Waiting to upload (offline)"}
          </p>
        ) : null}
        <figcaption className="mt-1.5">
          {editable ? (
            <input
              value={a.caption ?? ""}
              onChange={(e) => updateAttributes({ caption: e.target.value })}
              placeholder="Add a caption"
              aria-label="Image caption"
              className="w-full bg-transparent text-center text-sm text-muted outline-none placeholder:text-faint"
            />
          ) : a.caption ? (
            <span className="block text-center text-sm text-muted">{a.caption}</span>
          ) : null}
        </figcaption>
      </figure>
      {selected && editable ? (
        <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted" contentEditable={false}>
          <label className="flex items-center gap-1">
            Alt text
            <input value={a.alt ?? ""} onChange={(e) => updateAttributes({ alt: e.target.value })} placeholder="Describe the image" className="h-7 w-56 ui-input rounded-[6px] px-2 text-ink" />
          </label>
          <span>Width</span>
          {[0.5, 0.75, 1].map((w) => (
            <button key={w} type="button" onClick={() => updateAttributes({ width: w === 1 ? null : w })} aria-pressed={width === w} className={`h-7 rounded-[6px] border px-2 ${width === w ? "border-accent text-accent" : "border-line"}`}>
              {w * 100}%
            </button>
          ))}
        </div>
      ) : null}
    </Frame>
  );
}

function FileView({ node, selected }: ReactNodeViewProps) {
  const a = node.attrs as { id: string; fileId: string | null; name: string | null; size: number | null; mimeType: string | null };
  const file = useFileUrl(a.fileId);
  const upload = useUploadState(a.id);
  return (
    <Frame selected={selected} label={`Attachment ${a.name ?? ""}`}>
      <div className="my-1.5 flex items-center gap-3 ui-card rounded-[8px] px-3 py-2.5">
        <FileText size={20} className="text-muted" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{a.name ?? "Attachment"}</p>
          <p className="text-xs text-muted">
            {a.size ? formatBytes(a.size) : ""}
            {upload ? (upload.state === "failed" ? " · Upload interrupted — retrying" : " · Uploading…") : ""}
          </p>
        </div>
        {file ? (
          <a href={file.url} className="inline-flex h-8 items-center gap-1.5 rounded-[6px] border border-line px-2.5 text-xs hover:bg-surface" download={a.name ?? true} contentEditable={false}>
            <Download size={14} aria-hidden /> Download
          </a>
        ) : null}
      </div>
    </Frame>
  );
}

function cellText(cell: InlineNode[] | undefined): string {
  return cell ? plainText(cell) : "";
}

function move<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length || from === to) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

function TableView({ node, selected, updateAttributes, editor }: ReactNodeViewProps) {
  const rows = (node.attrs.rows as InlineNode[][][]) ?? [[[]]];
  const headerRow = Boolean(node.attrs.headerRow);
  const editable = editor.isEditable;
  const width = rows[0]?.length ?? 1;
  const [focusWithin, setFocusWithin] = useState(false);
  // Row/column tools show while the table is selected or being edited.
  const tools = editable && (selected || focusWithin);
  const setCell = (r: number, c: number, value: string) => {
    const next = rows.map((row, ri) => row.map((cell, ci) => (ri === r && ci === c ? (value ? [{ type: "text" as const, text: value }] : []) : cell)));
    updateAttributes({ rows: next });
  };
  const addRow = () => updateAttributes({ rows: [...rows, Array.from({ length: width }, () => [])] });
  const addCol = () => width < 20 && updateAttributes({ rows: rows.map((r) => [...r, []]) });
  const removeRow = (i: number) => rows.length > 1 && updateAttributes({ rows: rows.filter((_, ri) => ri !== i) });
  const removeCol = (i: number) => width > 1 && updateAttributes({ rows: rows.map((r) => r.filter((_, ci) => ci !== i)) });
  const moveRow = (i: number, dir: -1 | 1) => updateAttributes({ rows: move(rows, i, i + dir) });
  const moveCol = (i: number, dir: -1 | 1) => updateAttributes({ rows: rows.map((r) => move(r, i, i + dir)) });
  const tool = "grid h-6 w-6 place-items-center rounded-[6px] text-faint transition-colors hover:bg-accent-soft hover:text-heading disabled:opacity-30 disabled:hover:bg-transparent";
  return (
    <Frame selected={selected} label="Table">
      <div
        className="my-2 overflow-x-auto"
        contentEditable={false}
        onFocus={() => setFocusWithin(true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocusWithin(false);
        }}
      >
        <table className="fb-table w-full border-collapse text-sm">
          {tools ? (
            <thead>
              <tr>
                {rows[0]!.map((_, c) => (
                  <td key={c} className="border-0 px-1 pb-1">
                    <span className="flex items-center justify-center gap-0.5" role="group" aria-label={`Column ${c + 1}`}>
                      <button type="button" className={tool} disabled={c === 0} onClick={() => moveCol(c, -1)} aria-label={`Move column ${c + 1} left`} title="Move column left">
                        <ArrowLeft size={12} aria-hidden />
                      </button>
                      <button type="button" className={tool} disabled={c === width - 1} onClick={() => moveCol(c, 1)} aria-label={`Move column ${c + 1} right`} title="Move column right">
                        <ArrowRight size={12} aria-hidden />
                      </button>
                      <button type="button" className={`${tool} hover:!text-danger`} disabled={width <= 1} onClick={() => removeCol(c)} aria-label={`Delete column ${c + 1}`} title="Delete column">
                        <Trash2 size={12} aria-hidden />
                      </button>
                    </span>
                  </td>
                ))}
                <td className="border-0" />
              </tr>
            </thead>
          ) : null}
          <tbody>
            {rows.map((row, r) => (
              <tr key={r} className="group/row">
                {row.map((cell, c) => {
                  const Tag = headerRow && r === 0 ? "th" : "td";
                  return (
                    <Tag key={c} scope={headerRow && r === 0 ? "col" : undefined} className="border border-line p-0 align-top">
                      {editable ? (
                        <input
                          value={cellText(cell)}
                          onChange={(e) => setCell(r, c, e.target.value)}
                          aria-label={`Row ${r + 1}, column ${c + 1}`}
                          className={`w-full min-w-[6rem] bg-transparent px-2.5 py-1.5 outline-none focus:bg-accent-soft/40 ${headerRow && r === 0 ? "font-semibold" : ""}`}
                        />
                      ) : (
                        <span className={`block px-2.5 py-1.5 ${headerRow && r === 0 ? "font-semibold" : ""}`}>{cellText(cell)}</span>
                      )}
                    </Tag>
                  );
                })}
                {tools ? (
                  <td className="w-[5.5rem] border-0 pl-1">
                    <span className="flex items-center gap-0.5" role="group" aria-label={`Row ${r + 1}`}>
                      <button type="button" className={tool} disabled={r === 0} onClick={() => moveRow(r, -1)} aria-label={`Move row ${r + 1} up`} title="Move row up">
                        <ArrowUp size={12} aria-hidden />
                      </button>
                      <button type="button" className={tool} disabled={r === rows.length - 1} onClick={() => moveRow(r, 1)} aria-label={`Move row ${r + 1} down`} title="Move row down">
                        <ArrowDown size={12} aria-hidden />
                      </button>
                      <button type="button" className={`${tool} hover:!text-danger`} disabled={rows.length <= 1} onClick={() => removeRow(r)} aria-label={`Delete row ${r + 1}`} title="Delete row">
                        <Minus size={12} aria-hidden />
                      </button>
                    </span>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
        {editable ? (
          <div className="mt-1.5 flex flex-wrap gap-2 text-xs text-muted">
            <button type="button" onClick={addRow} className="inline-flex items-center gap-1 rounded-[6px] px-2 py-1 hover:bg-accent-soft hover:text-heading">
              <Plus size={12} aria-hidden /> Row
            </button>
            <button type="button" onClick={addCol} disabled={width >= 20} className="inline-flex items-center gap-1 rounded-[6px] px-2 py-1 hover:bg-accent-soft hover:text-heading disabled:opacity-40">
              <Plus size={12} aria-hidden /> Column
            </button>
            {tools ? (
              <label className="inline-flex items-center gap-1 px-2 py-1">
                <input type="checkbox" checked={headerRow} onChange={(e) => updateAttributes({ headerRow: e.target.checked })} /> Header row
              </label>
            ) : null}
          </div>
        ) : null}
      </div>
    </Frame>
  );
}

function PageView({ node, selected }: ReactNodeViewProps) {
  const a = node.attrs as { documentId: string; display: "link" | "card"; titleCache: string | null; iconCache: string | null };
  const titles = useQuery(api.documents.titles, a.documentId ? { documentIds: [a.documentId] } : "skip");
  const info = titles?.[a.documentId];
  const title = info?.title || a.titleCache || "Untitled";
  const missing = titles !== undefined && !info && !a.titleCache;
  if (a.display === "link") {
    return (
      <Frame selected={selected} label={`Page ${title}`}>
        <AppLink href={`/d/${a.documentId}`} className="my-0.5 inline-flex items-center gap-2 rounded-[6px] px-1 py-0.5 font-medium underline decoration-line-strong underline-offset-4 hover:decoration-accent" contentEditable={false}>
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
        className="group my-2 flex items-start gap-3 ui-card rounded-[8px] p-4 no-underline transition-[border-color,transform] duration-150 hover:-translate-y-px transition-[transform,box-shadow] hover:-translate-y-px hover:shadow-[var(--shadow-pop)]"
        title="Open page (Alt-click opens a new tab)"
      >
        <FileText size={20} aria-hidden className="mt-0.5 flex-none text-muted" />
        <span className="min-w-0 flex-1">
          <span className="block font-semibold text-ink">{title}</span>
          <span className="line-clamp-2 block text-sm text-muted">{missing ? "This page is unavailable or you no longer have access." : info?.excerpt || "Nested page"}</span>
        </span>
        <ExternalLink size={14} className="mt-1 text-faint opacity-0 group-hover:opacity-100" aria-hidden />
      </AppLink>
    </Frame>
  );
}

function BookmarkView({ node, selected, updateAttributes, editor }: ReactNodeViewProps) {
  const a = node.attrs as { url: string; title: string | null; description: string | null; siteName: string | null };
  const href = sanitizeHref(a.url ?? "") ?? "#";
  let host: string;
  try {
    host = new URL(href).host;
  } catch {
    host = a.url;
  }
  return (
    <Frame selected={selected} label={`Bookmark ${a.title ?? host}`}>
      <div className="my-2 ui-card rounded-[8px] p-4" contentEditable={false}>
        <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="flex items-start gap-3 no-underline">
          <Link2 size={18} className="mt-0.5 text-muted" aria-hidden />
          <span className="min-w-0">
            <span className="block truncate font-semibold text-ink">{a.title || host}</span>
            {a.description ? <span className="line-clamp-2 block text-sm text-muted">{a.description}</span> : null}
            <span className="block truncate text-xs text-faint">{a.siteName ? `${a.siteName} · ` : ""}{host}</span>
          </span>
        </a>
        {selected && editor.isEditable ? (
          <div className="mt-3 grid gap-2 text-xs">
            <label className="grid gap-1">
              Title
              <input value={a.title ?? ""} onChange={(e) => updateAttributes({ title: e.target.value || null })} className="h-8 ui-input rounded-[6px] px-2 text-sm text-ink" />
            </label>
            <label className="grid gap-1">
              Description
              <input value={a.description ?? ""} onChange={(e) => updateAttributes({ description: e.target.value || null })} className="h-8 ui-input rounded-[6px] px-2 text-sm text-ink" />
            </label>
          </div>
        ) : null}
      </div>
    </Frame>
  );
}

function CollectionView({ node, selected, editor }: ReactNodeViewProps) {
  const a = node.attrs as { collectionId: string; viewId: string | null };
  return (
    <Frame selected={selected} label="Collection">
      <div contentEditable={false} className="my-3">
        <CollectionEmbed collectionId={a.collectionId} initialViewId={a.viewId} editable={editor.isEditable} />
      </div>
    </Frame>
  );
}

function UnknownView({ node, selected, deleteNode, editor }: ReactNodeViewProps) {
  const wire = node.attrs.wire as { type?: string } | null;
  return (
    <Frame selected={selected} label="Unsupported block">
      <div contentEditable={false} className="my-2 flex items-center gap-3 rounded-[6px] border border-dashed border-line-strong bg-sunken px-4 py-3 text-sm text-muted">
        <span className="flex-1">
          This “{wire?.type ?? "unknown"}” block was created by a newer version of Folevi. It’s kept safely and will appear once you update.
        </span>
        {editor.isEditable ? (
          <button type="button" onClick={deleteNode} aria-label="Remove block" className="text-faint hover:text-danger">
            <Trash2 size={14} aria-hidden />
          </button>
        ) : null}
      </div>
    </Frame>
  );
}

export const NODE_VIEW_EXTENSIONS = [
  ImageBlock.extend({ addNodeView: () => ReactNodeViewRenderer(ImageView, { stopEvent: ({ event }) => event.target instanceof HTMLInputElement || event.target instanceof HTMLButtonElement }) }),
  FileBlock.extend({ addNodeView: () => ReactNodeViewRenderer(FileView) }),
  TableBlock.extend({ addNodeView: () => ReactNodeViewRenderer(TableView, { stopEvent: ({ event }) => event.target instanceof HTMLInputElement || (event.target instanceof Element && Boolean(event.target.closest("button"))) }) }),
  PageBlock.extend({ addNodeView: () => ReactNodeViewRenderer(PageView) }),
  BookmarkBlock.extend({ addNodeView: () => ReactNodeViewRenderer(BookmarkView, { stopEvent: ({ event }) => event.target instanceof HTMLInputElement }) }),
  CollectionBlock.extend({ addNodeView: () => ReactNodeViewRenderer(CollectionView, { stopEvent: () => true }) }),
  UnknownBlock.extend({ addNodeView: () => ReactNodeViewRenderer(UnknownView) }),
  FormulaBlock.extend({
    addNodeView: () =>
      ReactNodeViewRenderer(FormulaView, { stopEvent: ({ event }) => event.target instanceof HTMLTextAreaElement || (event.target instanceof Element && Boolean(event.target.closest("button"))) }),
  }),
  // Drawing needs every pointer event; the toolbar needs its clicks.
  WhiteboardBlock.extend({ addNodeView: () => ReactNodeViewRenderer(WhiteboardView, { stopEvent: () => true }) }),
  // The canvas handles its own pointer, wheel and keyboard input (and its own undo while focused).
  FlowchartBlock.extend({ addNodeView: () => ReactNodeViewRenderer(FlowchartView, { stopEvent: () => true }) }),
];
