"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { blocksToHtml, type WireBlock } from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import type { DocTab } from "@/lib/app/tabs";

/** How wide the page is laid out before it's scaled down (a note's reading width plus margins). */
const PAGE_W = 600;
/** At most this many blocks are drawn: a preview shows a page's top, not all of it. */
const PREVIEW_BLOCKS = 80;

/** The page laid out small: no scroll bars, no pointer, tighter margins than an export. */
const MINI_CSS = `html,body{overflow:hidden!important;pointer-events:none;background:transparent!important}main{max-width:none!important;margin:22px 30px!important;padding:0!important}h1{margin-top:0;font-size:1.9rem}`;

/** A note's blocks: this device's copy at once, else the server's. */
function useNoteBlocksForPreview(documentId: string): WireBlock[] | null {
  const { engine } = useAppState();
  const local = engine?.documentBlocks(documentId) ?? [];
  const server = useQuery(api.blocks.list, local.length ? "skip" : { documentId });
  if (local.length) return local;
  if (server === undefined) return null;
  return (server?.blocks ?? []) as WireBlock[];
}

/**
 * A note as a small picture of its page (the page's top, drawn from the note's blocks): the same render as an
 * export, in a sandboxed frame so nothing in it runs or takes focus.
 */
export function MiniPage({ documentId, title, className = "" }: { documentId: string; title: string; className?: string }) {
  const blocks = useNoteBlocksForPreview(documentId);
  const html = useMemo(() => {
    if (!blocks) return null;
    const top = blocks.length > PREVIEW_BLOCKS ? blocks.slice(0, PREVIEW_BLOCKS) : blocks;
    return blocksToHtml(top, { title: title || "Untitled" }).replace("</style>", `${MINI_CSS}</style>`);
  }, [blocks, title]);
  // Scaled to the box's width (measured before it's painted, so it never shows unscaled or empty first).
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  useLayoutEffect(() => {
    if (box.current) setScale(box.current.clientWidth / PAGE_W);
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScale(el.clientWidth / PAGE_W));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={box} className={`relative overflow-hidden bg-[var(--color-surface-raised)] ${className}`}>
      {html && scale ? (
        <PageFrame title={title} html={html} scale={scale} />
      ) : (
        <div className="space-y-2 p-4">
          <div className="h-4 w-2/3 animate-pulse rounded bg-[var(--glass-hover)]" />
          <div className="h-2.5 w-full animate-pulse rounded bg-[var(--glass-hover)]" />
          <div className="h-2.5 w-5/6 animate-pulse rounded bg-[var(--glass-hover)]" />
        </div>
      )}
    </div>
  );
}

/**
 * The page in its frame. It shows once the frame has drawn it (no blank frame first), and a frame already showing
 * keeps its page until the next one is ready.
 */
function PageFrame({ title, html, scale }: { title: string; html: string; scale: number }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <iframe
      title={`Preview of ${title || "Untitled"}`}
      srcDoc={html}
      sandbox=""
      tabIndex={-1}
      aria-hidden
      onLoad={() => setLoaded(true)}
      className="pointer-events-none absolute left-0 top-0 origin-top-left border-0 bg-transparent"
      style={{ width: PAGE_W, height: PAGE_W * 1.6, transform: `scale(${scale})`, opacity: loaded ? 1 : 0 }}
    />
  );
}

/**
 * A tab's picture for its preview and the Tab Overview: a note's page, joined notes side by side, or a view's
 * name and icon on its own background.
 */
export function TabPicture({ tab, titles, viewIcon, viewName, className = "" }: { tab: DocTab; titles: Record<string, string>; viewIcon: React.ReactNode; viewName: string; className?: string }) {
  if (tab.view) {
    return (
      <div className={`grid place-items-center bg-[var(--color-canvas)] ${className}`}>
        <div className="flex flex-col items-center gap-2 text-muted">
          <span className="grid h-12 w-12 place-items-center rounded-container bg-[var(--glass-hover)] [&>svg]:h-6 [&>svg]:w-6">{viewIcon}</span>
          <span className="text-subheadline font-semibold text-heading">{viewName}</span>
        </div>
      </div>
    );
  }
  const panes = tab.panes ?? [tab.at ?? tab.id];
  return (
    <div className={`flex gap-px bg-[var(--color-line)] ${className}`}>
      {panes.map((id) => (
        <MiniPage key={id} documentId={id} title={titles[id] ?? ""} className="min-w-0 flex-1" />
      ))}
    </div>
  );
}
