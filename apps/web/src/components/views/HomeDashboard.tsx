"use client";

import { useQuery } from "convex/react";
import { useEffect, useState, type ReactNode } from "react";
import { CatchUp } from "@/components/ai/CatchUp";
import { useAiEnabled } from "@/components/ai/useAi";
import { ArrowRight, ChevronLeft, ChevronRight, Clock3, Folder, Star } from "lucide-react";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { AppLink } from "@/lib/app/router";
import { ageText } from "@/lib/format";
import { ViewChrome } from "@/components/app/Shell";
import { NOTE_CARD_ASPECT, NOTE_CARD_LINK, NoteCardFace } from "./DocumentCard";
import { FolderCard } from "./OrganizeIndex";
import { DocMenu, NoteContextMenu, contextPoint, type Summary as DocSummary } from "./DocumentBrowser";
import { startNoteDrag } from "@/lib/app/noteDrag";

const CARD_WIDTH = 250;
const FOLDER_MIN = 210;
const GAP = 32;

/** How many grid columns fit (auto-fill with a minimum width), so a section can show whole rows only. */
function useColumns(min: number, gap = GAP) {
  // A callback ref, so a grid that mounts later (after data loads) is measured too.
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [cols, setCols] = useState(4);
  useEffect(() => {
    if (!el) return;
    const measure = () => setCols(Math.max(1, Math.floor((el.clientWidth + gap) / (min + gap))));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el, min, gap]);
  return { ref: setEl, cols };
}

function Section({ title, icon, href, count, children, empty, shelf }: { title: string; icon: ReactNode; href: string; count?: string; children: ReactNode; empty?: ReactNode; shelf?: boolean }) {
  const id = title.toLowerCase().replace(/\s+/g, "-");
  return (
    <section
      aria-labelledby={`home-${id}`}
      className={
        shelf ? "mt-[37px] first:mt-6" : "mt-[46px] first:mt-6"
      }
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 id={`home-${id}`} className="ui-display flex items-center gap-2.5 text-[22px]">
          <span aria-hidden className="grid h-8 w-8 flex-none place-items-center rounded-[8px] bg-[var(--glass-hover)] text-heading">
            {icon}
          </span>
          {title}
          {count ? <span className="ml-2 text-[13px] font-normal text-muted">{count}</span> : null}
        </h2>
        <AppLink href={href} className="inline-flex items-center gap-1 rounded-[6px] px-2.5 py-1 text-[13px] font-medium text-ink transition-colors hover:bg-accent-soft">
          See all <span className="sr-only">{title.toLowerCase()}</span>
          <ArrowRight size={13} aria-hidden />
        </AppLink>
      </div>
      {empty ?? children}
    </section>
  );
}

type Summary = DocSummary;

/**
 * A note on Home. It can be dragged onto a folder in the sidebar, and right-clicked for its actions (the
 * same as its "…" menu; Recent notes adds "Remove from recent").
 */
function NoteCard({ d, recent }: { d: Summary; recent?: boolean }) {
  const [ctx, setCtx] = useState<{ x: number; y: number } | null>(null);
  return (
    <div
      className="group relative [container-type:inline-size]"
      draggable
      onDragStart={(e) => startNoteDrag(e, [d.id])}
      onContextMenu={(e) => {
        e.preventDefault();
        setCtx(contextPoint(e));
      }}
    >
      <AppLink href={`/d/${d.id}`} className={NOTE_CARD_LINK}>
        <NoteCardFace
          title={d.title}
          excerpt={d.excerpt}
          preview={d.preview}
          cover={d.cover}
          style={d.style}
          createdAt={d.createdAt}
          time={ageText(d.updatedAt)}
          starred={d.starred}
          folder={d.homeFolder}
        />
      </AppLink>
      <div className={`absolute top-2 ${d.starred ? "right-[calc(12cqw+8px)]" : "right-2"} opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100`}>
        <div className="ui-raised rounded-[6px]">
          <DocMenu doc={d} view="all" recent={recent} />
        </div>
      </div>
      {ctx ? <NoteContextMenu doc={d} view="all" recent={recent} at={ctx} onDone={() => setCtx(null)} /> : null}
    </div>
  );
}

const CAROUSEL_COUNT = 10;

/**
 * One row of note cards that scrolls sideways, with arrow buttons at either end (shown only when there's
 * more to see that way). Cards are real list items, so Tab moves through them and scrolls them into view.
 */
function NoteCarousel({ docs, label, recent }: { docs: Summary[] | undefined; label: string; recent?: boolean }) {
  const [el, setEl] = useState<HTMLUListElement | null>(null);
  const [edges, setEdges] = useState({ start: true, end: true });
  useEffect(() => {
    if (!el) return;
    const update = () => setEdges({ start: el.scrollLeft <= 2, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 2 });
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [el, docs]);
  const scroll = (dir: 1 | -1) => {
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollBy({ left: dir * Math.max(CARD_WIDTH + GAP, el.clientWidth - CARD_WIDTH / 2), behavior: reduce ? "auto" : "smooth" });
  };
  if (docs === undefined) {
    return (
      <div className="flex gap-8 overflow-hidden pb-7 pt-1" role="status" aria-busy aria-label="Loading">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} style={{ width: CARD_WIDTH }} className={`${NOTE_CARD_ASPECT} flex-none animate-pulse rounded-l-[2px] rounded-r-[12px] bg-sunken motion-reduce:animate-none`} />
        ))}
      </div>
    );
  }
  const arrow = "absolute top-[calc(50%-12px)] z-20 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-[6px] bg-surface text-heading shadow-[0_2px_10px_rgb(0_0_0/0.16),0_0_0_1px_rgb(0_0_0/0.05)] transition-[opacity,transform] hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus";
  return (
    <div className="relative">
      <ul
        ref={setEl}
        aria-label={label}
        className="-mx-2 flex snap-x snap-mandatory scroll-px-2 gap-8 overflow-x-auto px-2 pb-7 pt-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {docs.slice(0, CAROUSEL_COUNT).map((d) => (
          <li key={d.id} style={{ width: CARD_WIDTH }} className="flex-none snap-start">
            <NoteCard d={d} recent={recent} />
          </li>
        ))}
      </ul>
      {/* White fades at either edge while there's more to scroll that way. */}
      <div aria-hidden className={`pointer-events-none absolute -left-2 bottom-0 top-0 z-10 w-16 bg-[linear-gradient(to_right,var(--color-canvas),transparent)] transition-opacity duration-200 ${edges.start ? "opacity-0" : "opacity-100"}`} />
      <div aria-hidden className={`pointer-events-none absolute -right-2 bottom-0 top-0 z-10 w-16 bg-[linear-gradient(to_left,var(--color-canvas),transparent)] transition-opacity duration-200 ${edges.end ? "opacity-0" : "opacity-100"}`} />
      {!edges.start ? (
        <button type="button" aria-label={`Scroll ${label.toLowerCase()} back`} onClick={() => scroll(-1)} className={`${arrow} left-0`}>
          <ChevronLeft size={18} aria-hidden />
        </button>
      ) : null}
      {!edges.end ? (
        <button type="button" aria-label={`Scroll ${label.toLowerCase()} forward`} onClick={() => scroll(1)} className={`${arrow} right-0`}>
          <ChevronRight size={18} aria-hidden />
        </button>
      ) : null}
    </div>
  );
}

/**
 * Home: recent notes and starred notes (the latest 10 each, in a sideways-scrolling row) and recent folders (two rows), each with
 * "See all". Rows are whole rows at any width.
 */
export function HomeDashboard() {
  const aiOn = useAiEnabled();
  const { workspace } = useAppState();
  // The latest edited notes, minus any this person removed from the list.
  const recent = useQuery(api.documents.recentNotes, { workspaceId: workspace.id, limit: CAROUSEL_COUNT });
  const starred = useQuery(api.documents.list, { workspaceId: workspace.id, view: "starred", sort: "updated", paginationOpts: { numItems: CAROUSEL_COUNT, cursor: null } });
  const org = useQuery(api.organization.index, { workspaceId: workspace.id });
  const folders = useColumns(FOLDER_MIN);
  const names = new Map((org?.folders ?? []).map((f) => [f.id, f.name]));
  const recentFolders = [...(org?.folders ?? [])].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, folders.cols * 2);

  return (
    <ViewChrome
      title={<h1 className="truncate text-sm font-semibold">Home</h1>}
      tabTitle="Home"
    >
      <div className="mx-auto max-w-[1400px] px-4 pb-8 pt-2 sm:px-8">
        {aiOn ? <CatchUp /> : null}
        <Section shelf title="Recent notes" icon={<Clock3 size={17} strokeWidth={1.9} />} href="/notes" empty={recent && !recent.length ? <p className="text-sm text-muted">No notes yet. Press New to write your first one.</p> : undefined}>
          <NoteCarousel docs={recent} label="Recent notes" recent />
        </Section>

        <Section shelf title="Starred" icon={<Star size={17} strokeWidth={1.9} />} href="/starred" empty={starred && !starred.page.length ? <p className="text-sm text-muted">Star notes you come back to often and they’ll appear here.</p> : undefined}>
          <NoteCarousel docs={starred?.page} label="Starred notes" />
        </Section>

        <Section
          title="Recent folders"
          href="/folders"
          icon={<Folder size={17} strokeWidth={1.9} />}
          count={org ? `${org.folders.length}` : undefined}
          empty={org && !org.folders.length ? <p className="text-sm text-muted">No folders yet. Create one from the sidebar to group related notes.</p> : undefined}
        >
          <div ref={folders.ref}>
            <ul className="grid gap-x-8 gap-y-10" style={{ gridTemplateColumns: `repeat(${folders.cols}, minmax(0, 1fr))` }}>
              {recentFolders.map((f) => (
                <li key={f.id}>
                  <FolderCard folder={f} parentName={f.parentFolderId ? names.get(f.parentFolderId) : undefined} />
                </li>
              ))}
            </ul>
          </div>
        </Section>
      </div>
    </ViewChrome>
  );
}
