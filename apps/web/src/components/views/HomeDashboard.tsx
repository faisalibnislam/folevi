"use client";

import { startTransition, useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import { useAiEnabled } from "@/components/ai/useAi";
import { ArrowRight, Bookmark, ChartColumn, Clock, Folder, Layers, LayoutTemplate, ListChecks, Users, Waypoints } from "lucide-react";
import { EmptyState } from "@/components/ui/EmptyState";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { AppLink } from "@/lib/app/router";
import { editedText } from "@/lib/format";
import { ViewChrome } from "@/components/app/Shell";
import { NOTE_CARD_LINK, NoteCardFace } from "./DocumentCard";
import { FolderCard } from "./FolderCard";
import { DocMenu, NoteContextMenu, contextPoint, type Summary as DocSummary } from "./DocumentBrowser";
import { startNoteDrag } from "@/lib/app/noteDrag";
import { useOfflineQuery } from "@/lib/sync/queryCache";
import { useNotesWithLocal } from "@/lib/hooks/useLocalNotes";
import { WaitingToSync, waitingOf } from "@/components/sync/WaitingToSync";
import { cardCount, useReviewWindow } from "@/components/study/review";
import { useCardSizes } from "@/lib/cardSize";
import { arrangeHome, homeRows, type HomeBlock, type HomeBlockId } from "@/lib/app/homeLayout";
import { useQuery } from "@/lib/convex/queries";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { AddBlockTile, BlockLink, CaptureField, DnaWeek, HomeBlockFrame, HomeGreeting, HomeTopLine, SectionHead, TasksPreview, TodayCard, useHomePrefs } from "./HomeBlocks";
import { HomeSummary } from "./HomeSummary";
import { HomeStats } from "./HomeStats";
import { SharedList, TemplatesList } from "./HomeLists";

const GAP = 32;

/** Today's reviews as last seen this session (its question moves with the clock, so the cache misses at each step). */
let lastReviews: ReturnType<typeof useOfflineQuery<typeof api.study.summary>>;

/** How many grid columns fit (auto-fill with a minimum width), so a section can show whole rows only. */
function useColumns(min: number, gap = GAP) {
  // A callback ref, so a grid that mounts later (after data loads) is measured too.
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [cols, setCols] = useState(4);
  // Measured before the first paint, so the grid is drawn at the right number of columns instead of 4 and then
  // reflowing (the iPad's portrait width or an open sidebar fits 3).
  useLayoutEffect(() => {
    if (!el) return;
    const measure = () => setCols(Math.max(1, Math.floor((el.clientWidth + gap) / (min + gap))));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el, min, gap]);
  return { ref: setEl, cols };
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
          shape={d.shape}
          kind={d.kind}
          cover={d.cover}
          style={d.style}
          createdAt={d.createdAt}
          time={editedText(d.updatedAt)}
          starred={d.starred}
          folder={d.homeFolder}
          extra={waitingOf(d) ? <WaitingToSync state={waitingOf(d)} /> : undefined}
        />
      </AppLink>
      <div data-card-menu="" className={`absolute top-2 ${d.starred ? "right-[calc(11cqw+4px)]" : "right-2"} opacity-0 transition-[opacity,translate] duration-200 ease-[var(--ease-folio)] group-focus-within:opacity-100 group-hover:-translate-y-0.5 group-hover:opacity-100 pointer-coarse:opacity-100`}>
        <div className="ui-raised rounded-tiny [&_button]:rounded-tiny">
          <DocMenu doc={d} view="all" recent={recent} />
        </div>
      </div>
      {ctx ? <NoteContextMenu doc={d} view="all" recent={recent} at={ctx} onDone={() => setCtx(null)} /> : null}
    </div>
  );
}

/** Recent folders fetched at least (two rows of the widest grid). */
const RECENT_FOLDERS = 12;

/**
 * Today's reviews: how many flashcards are due (from every note you can read), with a way to start. Shown
 * once there's something to study at all.
 */
function TodaysReviews() {
  // (As last seen until the server answers, held across the review window's moves: the card is drawn with Home
  // instead of appearing at the top a moment later and pushing the page down.)
  const live = useOfflineQuery(api.study.summary, useReviewWindow(5 * 60_000));
  if (live !== undefined) lastReviews = live;
  const today = live ?? lastReviews;
  if (!today?.hasCards) return null;
  const waiting = today.due + today.new;
  return (
    <section aria-labelledby="home-reviews" className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-container bg-[var(--glass-active)] px-5 py-4 shadow-[var(--glass-edge),var(--shadow-resting)]">
      <span aria-hidden className="grid h-8 w-8 flex-none place-items-center rounded-chip bg-[var(--glass-hover)] text-heading">
        <Layers size={17} strokeWidth={1.9} />
      </span>
      <div className="min-w-0 flex-1">
        <h2 id="home-reviews" className="text-body font-semibold text-heading">
          Today’s reviews
        </h2>
        <p className="text-subheadline text-muted">
          {waiting ? `${cardCount(waiting)} to review${today.later ? `, ${today.later} more later today` : ""}.` : today.later ? `All caught up. ${cardCount(today.later)} later today.` : "All caught up for today."}
        </p>
      </div>
      {waiting ? (
        <AppLink href="/review" className="ui-btn ui-btn-primary h-control gap-1.5 px-3 text-callout">
          Start review <ArrowRight size={13} aria-hidden />
        </AppLink>
      ) : null}
    </section>
  );
}

/** Notes a row of cards shows on a wide window (as many whole rows as fit narrower: four, then three). */
const ROW_NOTES = 6;
/** One row of cards at each width: 2 (two rows), 3, 5, then 6 on a full-width window; the rest are hidden. */
const ROW_GRID = "grid grid-cols-2 gap-6 @[560px]:grid-cols-3 @[880px]:grid-cols-5 @[1160px]:grid-cols-6";
const rowItem = (i: number) =>
  i >= 5 ? "hidden @[1160px]:block" : i === 4 ? "hidden @[880px]:block" : i === 3 ? "@[560px]:hidden @[880px]:block" : "";

/** A row of note cards, the same size in Recent notes, Bookmarks and Pinned note. */
function NoteRow({ docs, label, recent, empty }: { docs: Summary[] | undefined; label: string; recent?: boolean; empty: ReactNode }) {
  if (docs && !docs.length) return <div className="pt-4">{empty}</div>;
  return (
    <ul aria-label={label} aria-busy={docs === undefined || undefined} className={`mt-5 ${ROW_GRID}`}>
      {docs === undefined
        ? Array.from({ length: ROW_NOTES }, (_, i) => <li key={i} className={`aspect-[25/27] animate-pulse rounded-l-tiny rounded-r-small bg-sunken motion-reduce:animate-none ${rowItem(i)}`} />)
        : docs.slice(0, ROW_NOTES).map((d, i) => (
            <li key={d.id} className={rowItem(i)}>
              <NoteCard d={d} recent={recent} />
            </li>
          ))}
    </ul>
  );
}

/**
 * Pinned note: one note this person keeps on Home (convex/homePrefs.ts), as its card. Until one is chosen (or when
 * it can no longer be opened), a pick of the recent notes.
 */
function PinnedNote({ id, choices, pin }: { id: string | null; choices: Summary[] | undefined; pin: (documentId: string | null) => Promise<unknown> }) {
  const toast = useToast();
  const got = useQuery(api.documents.get, id ? { documentId: id } : "skip");
  const doc = id && got && !got.inTrash ? got.document : null;
  const set = (documentId: string | null) => void pin(documentId).catch((e) => toast.show(errorMessage(e), { tone: "error" }));
  const change = doc ? (
    <button type="button" className="ui-btn ui-btn-quiet h-control-sm px-2.5 text-subheadline" onClick={() => set(null)}>
      Change
    </button>
  ) : undefined;
  return (
    <section aria-labelledby="home-pinned-title">
      <SectionHead id="home-pinned-title" action={change}>
        Pinned note
      </SectionHead>
      {id && got === undefined ? (
        <p className="pt-3 text-subheadline text-muted">Loading…</p>
      ) : doc ? (
        <div className="@container">
          <NoteRow docs={[doc as Summary]} label="Pinned note" empty={null} />
        </div>
      ) : (
        <>
          <p className="pt-3 text-subheadline text-muted">Choose a note to keep here.</p>
          <ul aria-label="Notes to pin" className="mt-1 grid grid-cols-1 gap-x-10 @[640px]:grid-cols-2">
            {(choices ?? []).slice(0, 6).map((d) => (
              <li key={d.id} className="border-b border-[var(--color-line)]">
                <button type="button" className="min-h-11 w-full truncate text-left text-subheadline text-ink hover:text-heading" onClick={() => set(d.id)}>
                  {d.title || "Untitled"}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/**
 * Home (the owner's design version 19): a top line (the date, Customize), the opening (the greeting, the Foli AI
 * summary while Foli AI is on, the capture field), then this person's sections (lib/app/homeLayout.ts): Recent notes,
 * Bookmarks, Recent folders, Today and My tasks beside Foli DNA, and the ones they add (Shared with me, Pinned note,
 * Templates). Each section is a serif title over a hairline with See all; Today and the DNA map are the only tiles.
 */
export function HomeDashboard() {
  const aiOn = useAiEnabled();
  const { scope } = useAppState();
  // The latest edited notes, minus any this person removed from the list.
  // As last seen on this device while there's no live answer (offline), with notes made or renamed here laid
  // over it: a note written offline is in Recent notes at once, marked as waiting to sync.
  const recent = useNotesWithLocal(useOfflineQuery(api.documents.recentNotes, { scope, limit: ROW_NOTES * 2 }), { include: "recent", byUpdated: true, limit: ROW_NOTES * 2 });
  const starredList = useOfflineQuery(api.documents.list, { scope, view: "starred", sort: "updated", paginationOpts: { numItems: ROW_NOTES, cursor: null } });
  const starred = useNotesWithLocal(starredList?.page, { include: "none" });
  const sizes = useCardSizes();
  const folders = useColumns(sizes.folderMin, sizes.gap);
  // Only the most recently changed folders are counted (a fixed minimum, so resizing rarely refetches).
  const org = useOfflineQuery(api.organization.recentFolders, { scope, limit: Math.max(RECENT_FOLDERS, folders.cols * 2) });
  // One row of folder cards (as many as fit, five at most).
  const recentFolders = (org?.folders ?? []).slice(0, ROW_NOTES);
  // Home's first frame (the one the click that opened it waits for) has the opening and the notes; the folder cards
  // come in the background right after (INP, docs/perf/web-results.md).
  const [allCards, setAllCards] = useState(false);
  useEffect(() => {
    if (!allCards) startTransition(() => setAllCards(true));
  }, [allCards]);

  const { prefs, setLayout, setPinnedNote } = useHomePrefs();
  const [editing, setEditing] = useState(false);
  const layout = prefs?.layout;
  const rows = arrangeHome(layout);
  const shown = rows.filter((r) => !r.hidden);
  const saveLayout = (l: { order: string[]; hidden: string[] }) => setLayout({ layout: l });
  const head = (id: string, text: string, href: string, link = "See all", icon?: typeof Clock) => (
    <SectionHead id={id} icon={icon} action={<BlockLink href={href}>{link}</BlockLink>}>
      {text}
    </SectionHead>
  );
  /** A block's content; `paired` when it sits in the two-column row (Today and My tasks beside Foli DNA). */
  const blockBody = (id: HomeBlockId, paired: boolean): ReactNode => {
    switch (id) {
      case "recent":
        return (
          <section aria-labelledby="home-recent-title">
            {head("home-recent-title", "Recent notes", "/notes", "See all", Clock)}
            <NoteRow docs={recent} label="Recent notes" recent empty={<EmptyState size="inline" title="No notes yet" body="Notes you open show up here." />} />
          </section>
        );
      case "bookmarks":
        return (
          <section aria-labelledby="home-bookmarks-title">
            {head("home-bookmarks-title", "Bookmarks", "/starred", "See all", Bookmark)}
            <NoteRow docs={starred} label="Bookmarked notes" empty={
                <div className="flex items-center gap-3 rounded-container border border-dashed border-[var(--color-line)] px-4 py-3.5">
                  <span aria-hidden className="grid size-8 flex-none place-items-center rounded-chip bg-[var(--glass-hover)] text-muted">
                    <Bookmark size={15} />
                  </span>
                  <p className="text-subheadline text-muted">
                    <span className="font-medium text-ink">No bookmarks yet.</span> Bookmark a note from its “…” menu and it stays here, one click away.
                  </p>
                </div>
              } />
          </section>
        );
      case "stats":
        return (
          <section aria-labelledby="home-stats-title">
            <SectionHead id="home-stats-title" icon={ChartColumn}>
              At a glance
            </SectionHead>
            <div className="mt-4">
              <HomeStats />
            </div>
          </section>
        );
      case "today":
        return <TodayCard />;
      case "tasks":
        return (
          <section aria-labelledby="home-tasks-title">
            {head("home-tasks-title", "My tasks", "/tasks", "See all", ListChecks)}
            <TasksPreview twoColumns={!paired} />
          </section>
        );
      case "folders":
        return (
          <section aria-labelledby="home-folders-title">
            {head("home-folders-title", "Recent folders", "/folders", "See all", Folder)}
            {org && !org.total ? (
              <div className="pt-4">
                <EmptyState size="inline" title="No folders yet" body="Folders keep related notes together." />
              </div>
            ) : (
              <div className="mt-5">
                <ul className={ROW_GRID}>
                  {(allCards ? recentFolders : []).map((f, i) => (
                    <li key={f.id} className={rowItem(i)}>
                      <FolderCard folder={f} parentName={f.parentName ?? undefined} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        );
      case "dna":
        return (
          <section aria-labelledby="home-dna-title">
            {head("home-dna-title", "Foli DNA · this week", "/graph", "Open Foli DNA", Waypoints)}
            <div className="mt-4">
              <DnaWeek load={allCards} />
            </div>
          </section>
        );
      case "shared":
        return (
          <section aria-labelledby="home-shared-title">
            {head("home-shared-title", "Shared with me", "/shared", "See all", Users)}
            <SharedList />
          </section>
        );
      case "templates":
        return (
          <section aria-labelledby="home-templates-title">
            {head("home-templates-title", "Templates", "/templates", "See all", LayoutTemplate)}
            <TemplatesList />
          </section>
        );
      case "pinned":
        return <PinnedNote id={prefs?.pinnedNote ?? null} choices={recent} pin={(documentId) => setPinnedNote({ documentId })} />;
    }
  };

  const frame = (block: HomeBlock, paired: boolean) => {
    const i = shown.findIndex((r) => r.block.id === block.id);
    return (
      <HomeBlockFrame key={block.id} block={block} hidden={false} editing={editing} first={i === 0} last={i === shown.length - 1} saved={layout} saveLayout={saveLayout}>
        {blockBody(block.id, paired)}
      </HomeBlockFrame>
    );
  };

  return (
    <ViewChrome
      title={<h1 className="truncate text-subheadline font-semibold">Home</h1>}
      tabTitle="Home"
    >
      <div className="@container mx-auto max-w-[1320px] px-4 pb-[max(4rem,var(--fab-clearance))] pt-3 sm:px-8 xl:px-11">
        <HomeTopLine editing={editing} onToggle={() => setEditing((e) => !e)} onReset={() => void setLayout({ layout: null })} />
        {/* The opening, the page's full width: the greeting, the Foli AI summary (while Foli AI is on), the capture field. */}
        <div className="mt-1 flex min-w-0 flex-col gap-6">
          <HomeGreeting />
          {aiOn ? <HomeSummary /> : null}
          <CaptureField />
          <TodaysReviews />
        </div>
        {/* This person's sections, in their order (lib/app/homeLayout.ts): one per row, except Today and My tasks beside
            Foli DNA while they follow each other. Customize moves them, takes them off Home and adds them back, saved
            per person (convex/homePrefs.ts). */}
        <div className="mt-14 flex flex-col gap-14">
          {homeRows(shown).map((row) =>
            row.kind === "one" ? (
              frame(row.item.block, false)
            ) : (
              <div key={row.main[0]!.block.id} className="grid grid-cols-1 items-start gap-10 @[860px]:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
                <div className="flex min-w-0 flex-col gap-10">{row.main.map((r) => frame(r.block, true))}</div>
                <div className="flex min-w-0 flex-col gap-10">{row.side.map((r) => frame(r.block, true))}</div>
              </div>
            ),
          )}
          {editing ? <AddBlockTile blocks={rows.filter((r) => r.hidden).map((r) => r.block)} saved={layout} saveLayout={saveLayout} /> : null}
        </div>
      </div>
    </ViewChrome>
  );
}
