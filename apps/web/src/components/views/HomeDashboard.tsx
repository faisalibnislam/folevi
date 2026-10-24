"use client";

import { useQuery } from "convex/react";
import { useEffect, useState, type ReactNode } from "react";
import { CatchUp } from "@/components/ai/CatchUp";
import { useAiEnabled } from "@/components/ai/useAi";
import { ArrowRight, ChevronLeft, ChevronRight, Clock3, Folder, Layers, Star } from "lucide-react";
import { EmptyState } from "@/components/ui/EmptyState";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { AppLink } from "@/lib/app/router";
import { ageText } from "@/lib/format";
import { ViewChrome } from "@/components/app/Shell";
import { NOTE_CARD_ASPECT, NOTE_CARD_LINK, NoteCardFace } from "./DocumentCard";
import { FolderCard } from "./FolderCard";
import { DocMenu, NoteContextMenu, contextPoint, type Summary as DocSummary } from "./DocumentBrowser";
import { startNoteDrag } from "@/lib/app/noteDrag";
import { useOfflineQuery } from "@/lib/sync/queryCache";
import { useNotesWithLocal } from "@/lib/hooks/useLocalNotes";
import { WaitingToSync, waitingOf } from "@/components/sync/WaitingToSync";
import { cardCount, useReviewWindow } from "@/components/study/review";

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
          <span aria-hidden className="grid h-8 w-8 flex-none place-items-center rounded-chip bg-[var(--glass-hover)] text-heading">
            {icon}
          </span>
          {title}
          {count ? <span className="ml-2 text-[13px] font-normal text-muted">{count}</span> : null}
        </h2>
        <AppLink href={href} className="inline-flex items-center gap-1 rounded-chip px-2.5 py-1 text-[13px] font-medium text-ink transition-colors hover:bg-accent-soft">
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
      onDragStart={(e) => startNoteDrag(e, [d.id], () => d.title)}
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
          extra={waitingOf(d) ? <WaitingToSync state={waitingOf(d)} /> : undefined}
        />
      </AppLink>
      <div data-card-menu="" className={`absolute top-2 ${d.starred ? "right-[calc(12cqw+8px)]" : "right-2"} opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100`}>
        <div className="ui-raised rounded-chip">
          <DocMenu doc={d} view="all" recent={recent} />
        </div>
      </div>
      {ctx ? <NoteContextMenu doc={d} view="all" recent={recent} at={ctx} onDone={() => setCtx(null)} /> : null}
    </div>
  );
}

const CAROUSEL_COUNT = 10;
/** Recent folders fetched at least (two rows of the widest grid). */
const RECENT_FOLDERS = 12;

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
      <div className="flex gap-8 overflow-hidden pb-7 pt-2" role="status" aria-busy aria-label="Loading">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} style={{ width: CARD_WIDTH }} className={`${NOTE_CARD_ASPECT} flex-none animate-pulse rounded-l-tiny rounded-r-panel bg-sunken motion-reduce:animate-none`} />
        ))}
      </div>
    );
  }
  // The cards fade out at either edge while there's more to scroll that way. A mask on the row, not a
  // coloured overlay, so the fade matches whatever is behind it (the glass panel, a note's artwork).
  const fadeMask = `linear-gradient(to right, ${edges.start ? "#000" : "transparent"} 0, #000 64px, #000 calc(100% - 64px), ${edges.end ? "#000" : "transparent"} 100%)`;
  const arrow = "absolute top-[calc(50%-10px)] z-20 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-chip bg-surface text-heading shadow-[0_2px_10px_rgb(0_0_0/0.16),0_0_0_1px_rgb(0_0_0/0.05)] transition-[opacity,transform] hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus";
  return (
    <div className="relative">
      <ul
        ref={setEl}
        aria-label={label}
        style={{ maskImage: fadeMask, WebkitMaskImage: fadeMask }}
        className="-mx-4 -mb-5 flex snap-x snap-mandatory scroll-px-4 gap-8 overflow-x-auto px-4 pb-12 pt-2 [scrollbar-width:none] sm:-mx-6 sm:scroll-px-6 sm:px-6 [&::-webkit-scrollbar]:hidden"
      >
        {docs.slice(0, CAROUSEL_COUNT).map((d) => (
          <li key={d.id} style={{ width: CARD_WIDTH }} className="flex-none snap-start">
            <NoteCard d={d} recent={recent} />
          </li>
        ))}
      </ul>
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
 * Today's reviews: how many flashcards are due (from every note you can read), with a way to start. Shown
 * once there's something to study at all.
 */
function TodaysReviews() {
  const today = useQuery(api.study.summary, useReviewWindow(5 * 60_000));
  if (!today?.hasCards) return null;
  const waiting = today.due + today.new;
  return (
    <section aria-labelledby="home-reviews" className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-container bg-[var(--glass-active)] px-5 py-4 shadow-[var(--glass-edge),var(--glass-shadow)]">
      <span aria-hidden className="grid h-8 w-8 flex-none place-items-center rounded-chip bg-[var(--glass-hover)] text-heading">
        <Layers size={17} strokeWidth={1.9} />
      </span>
      <div className="min-w-0 flex-1">
        <h2 id="home-reviews" className="text-[14px] font-semibold text-heading">
          Today’s reviews
        </h2>
        <p className="text-[13px] text-muted">
          {waiting ? `${cardCount(waiting)} to review${today.later ? `, ${today.later} more later today` : ""}.` : today.later ? `All caught up. ${cardCount(today.later)} later today.` : "All caught up for today."}
        </p>
      </div>
      {waiting ? (
        <AppLink href="/review" className="ui-btn ui-btn-primary h-8 gap-1.5 px-3.5 text-[13px]">
          Start review <ArrowRight size={13} aria-hidden />
        </AppLink>
      ) : null}
    </section>
  );
}

/**
 * Home: recent notes and starred notes (the latest 10 each, in a sideways-scrolling row) and recent folders (two rows), each with
 * "See all". Rows are whole rows at any width.
 */
export function HomeDashboard() {
  const aiOn = useAiEnabled();
  const { scope } = useAppState();
  // The latest edited notes, minus any this person removed from the list.
  // As last seen on this device while there's no live answer (offline), with notes made or renamed here laid
  // over it: a note written offline is in Recent notes at once, marked as waiting to sync.
  const recent = useNotesWithLocal(useOfflineQuery(api.documents.recentNotes, { scope, limit: CAROUSEL_COUNT }), { include: "recent", byUpdated: true, limit: CAROUSEL_COUNT });
  const starredList = useOfflineQuery(api.documents.list, { scope, view: "starred", sort: "updated", paginationOpts: { numItems: CAROUSEL_COUNT, cursor: null } });
  const starredPage = useNotesWithLocal(starredList?.page, { include: "none" });
  const starred = starredList && starredPage ? { ...starredList, page: starredPage } : starredList;
  const folders = useColumns(FOLDER_MIN);
  // Only the most recently changed folders are counted (a fixed minimum, so resizing rarely refetches).
  const org = useOfflineQuery(api.organization.recentFolders, { scope, limit: Math.max(RECENT_FOLDERS, folders.cols * 2) });
  const recentFolders = (org?.folders ?? []).slice(0, folders.cols * 2);

  return (
    <ViewChrome
      title={<h1 className="truncate text-sm font-semibold">Home</h1>}
      tabTitle="Home"
    >
      <div className="mx-auto max-w-[1400px] px-4 pb-[max(2rem,var(--fab-clearance))] pt-2 sm:px-8">
        {aiOn ? <CatchUp /> : null}
        <TodaysReviews />
        <Section shelf title="Recent notes" icon={<Clock3 size={17} strokeWidth={1.9} />} href="/notes" empty={recent && !recent.length ? <EmptyState size="inline" title="No notes yet" body="Press New to write your first one." /> : undefined}>
          <NoteCarousel docs={recent} label="Recent notes" recent />
        </Section>

        <Section shelf title="Starred" icon={<Star size={17} strokeWidth={1.9} />} href="/starred" empty={starred && !starred.page.length ? <EmptyState size="inline" title="Nothing starred yet" body="Star notes you come back to often and they’ll appear here." /> : undefined}>
          <NoteCarousel docs={starred?.page} label="Starred notes" />
        </Section>

        <Section
          title="Recent folders"
          href="/folders"
          icon={<Folder size={17} strokeWidth={1.9} />}
          count={org ? `${org.total}` : undefined}
          empty={org && !org.total ? <EmptyState size="inline" title="No folders yet" body="Create one from the sidebar to group related notes." /> : undefined}
        >
          <div ref={folders.ref}>
            <ul className="grid gap-x-8 gap-y-10" style={{ gridTemplateColumns: `repeat(${folders.cols}, minmax(0, 1fr))` }}>
              {recentFolders.map((f) => (
                <li key={f.id}>
                  <FolderCard folder={f} parentName={f.parentName ?? undefined} />
                </li>
              ))}
            </ul>
          </div>
        </Section>
      </div>
    </ViewChrome>
  );
}
