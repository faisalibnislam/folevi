"use client";

import { startTransition, useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import { useAiEnabled } from "@/components/ai/useAi";
import { ArrowRight, Bookmark, CalendarClock, CalendarDays, Clock3, Folder, LayoutTemplate, Layers, Pin, Share2, SquareCheckBig, Waypoints } from "lucide-react";
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
import { arrangeHome, type HomeBlockId } from "@/lib/app/homeLayout";
import { useQuery } from "@/lib/convex/queries";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { AddBlockTile, BlockLink, BlockTitle, CaptureField, DnaWeek, HomeBlockFrame, HomeHeader, TasksPreview, TodayAgenda, UpNextList, useHomePrefs } from "./HomeBlocks";
import { HomeSummary } from "./HomeSummary";
import { BookmarksList, SharedList, TemplatesList } from "./HomeLists";

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

function Section({ title, icon, href, count, children, empty, shelf }: { title: string; icon: ReactNode; href: string; count?: string; children: ReactNode; empty?: ReactNode; shelf?: boolean }) {
  const id = title.toLowerCase().replace(/\s+/g, "-");
  return (
    <section aria-labelledby={`home-${id}`} data-shelf={shelf ? "" : undefined}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 id={`home-${id}`} className="ui-display flex items-center gap-2.5 text-title-2">
          <span aria-hidden className="grid h-8 w-8 flex-none place-items-center rounded-chip bg-[var(--glass-hover)] text-heading">
            {icon}
          </span>
          {title}
          {count ? <span className="ml-2 text-subheadline font-normal text-muted">{count}</span> : null}
        </h2>
        <AppLink href={href} className="ui-hit inline-flex items-center gap-1 rounded-chip px-2.5 py-1 text-subheadline font-medium text-ink transition-colors hover:bg-accent-soft">
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

const CAROUSEL_COUNT = 10;
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
    <section aria-labelledby="home-reviews" className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-container bg-[var(--glass-active)] px-5 py-4 shadow-[var(--glass-edge),var(--glass-shadow)]">
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
      <BlockTitle id="home-pinned-title" icon={<Pin size={17} strokeWidth={1.9} />} action={change}>
        Pinned note
      </BlockTitle>
      {id && got === undefined ? (
        <p className="text-subheadline text-muted">Loading…</p>
      ) : doc ? (
        <div className="mx-auto max-w-[220px]">
          <NoteCard d={doc as Summary} />
        </div>
      ) : (
        <>
          <p className="mb-2 text-subheadline text-muted">Choose a note to keep here.</p>
          <ul aria-label="Notes to pin" className="flex flex-col">
            {(choices ?? []).slice(0, 5).map((d) => (
              <li key={d.id} className="border-b border-[var(--color-line)] last:border-b-0">
                <button type="button" className="w-full truncate py-2 text-left text-subheadline text-ink hover:text-heading" onClick={() => set(d.id)}>
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
 * Home: the greeting and capture field, then this person's blocks (lib/app/homeLayout.ts): Recent notes, the Foli AI
 * summary (while Foli AI is on) and Bookmarks, Up next, Today and My tasks, Foli DNA of the week, Recent folders, and
 * the ones they add (Shared with me, Pinned note, Templates).
 */
export function HomeDashboard() {
  const aiOn = useAiEnabled();
  const { scope } = useAppState();
  // The latest edited notes, minus any this person removed from the list.
  // As last seen on this device while there's no live answer (offline), with notes made or renamed here laid
  // over it: a note written offline is in Recent notes at once, marked as waiting to sync.
  const recent = useNotesWithLocal(useOfflineQuery(api.documents.recentNotes, { scope, limit: CAROUSEL_COUNT }), { include: "recent", byUpdated: true, limit: CAROUSEL_COUNT });
  const sizes = useCardSizes();
  const folders = useColumns(sizes.folderMin, sizes.gap);
  // Only the most recently changed folders are counted (a fixed minimum, so resizing rarely refetches).
  const org = useOfflineQuery(api.organization.recentFolders, { scope, limit: Math.max(RECENT_FOLDERS, folders.cols * 2) });
  // One row of folder cards (as many as fit).
  const recentFolders = (org?.folders ?? []).slice(0, folders.cols);
  // Home's first frame (the one the click that opened it waits for) has the notes a screen shows; the cards past the
  // rows' edges and the folder cards, the last section, come in the background right after (INP,
  // docs/perf/web-results.md). Nothing sits below the folders, so nothing moves when they come.
  const [allCards, setAllCards] = useState(false);
  useEffect(() => {
    if (!allCards) startTransition(() => setAllCards(true));
  }, [allCards]);

  const { prefs, setLayout, setPinnedNote } = useHomePrefs();
  const [editing, setEditing] = useState(false);
  const layout = prefs?.layout;
  // The Foli AI summary is only on Home while Foli AI is on.
  const without: HomeBlockId[] = aiOn ? [] : ["summary"];
  const rows = arrangeHome(layout, without);
  const shown = rows.filter((r) => !r.hidden);
  const saveLayout = (l: { order: string[]; hidden: string[] }) => setLayout({ layout: l });
  const title = (id: string, icon: ReactNode, text: string, href?: string, link?: string) => (
    <BlockTitle id={id} icon={icon} action={href ? <BlockLink href={href}>{link}</BlockLink> : undefined}>
      {text}
    </BlockTitle>
  );
  const blockBody = (id: HomeBlockId): ReactNode => {
    switch (id) {
      case "recent":
        return (
          <section aria-labelledby="home-recent-title">
            {title("home-recent-title", <Clock3 size={17} strokeWidth={1.9} />, "Recent notes", "/notes", "See all")}
            {recent && !recent.length ? (
              <EmptyState size="inline" title="No notes yet" body="Notes you open show up here." />
            ) : (
              // Five notes on a wide window (as many whole rows as fit narrower: four, then three).
              <ul aria-label="Recent notes" className="grid grid-cols-2 gap-4 @[560px]:grid-cols-3 @[880px]:grid-cols-5">
                {(recent ?? []).slice(0, 5).map((d) => (
                  <li key={d.id} className="[&:nth-child(5)]:hidden @[560px]:[&:nth-child(4)]:hidden @[880px]:[&:nth-child(4)]:block @[880px]:[&:nth-child(5)]:block">
                    <NoteCard d={d} recent />
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      case "upnext":
        return (
          <section aria-labelledby="home-upnext-title">
            {title("home-upnext-title", <CalendarClock size={17} strokeWidth={1.9} />, "Up next")}
            <UpNextList />
          </section>
        );
      case "today":
        return (
          <section aria-labelledby="home-today-title">
            {title("home-today-title", <CalendarDays size={17} strokeWidth={1.9} />, "Today", "/calendar", "Calendar")}
            <TodayAgenda />
          </section>
        );
      case "tasks":
        return (
          <section aria-labelledby="home-tasks-title">
            {title("home-tasks-title", <SquareCheckBig size={17} strokeWidth={1.9} />, "My tasks", "/tasks", "All tasks")}
            <TasksPreview />
          </section>
        );
      case "dna":
        return (
          <section aria-labelledby="home-dna-title">
            {title("home-dna-title", <Waypoints size={17} strokeWidth={1.9} />, "Foli DNA · this week", "/graph", "Open Foli DNA")}
            <DnaWeek load={allCards} />
          </section>
        );
      case "folders":
        return (
          <Section title="Recent folders" href="/folders" icon={<Folder size={17} strokeWidth={1.9} />} empty={org && !org.total ? <EmptyState size="inline" title="No folders yet" body="Folders keep related notes together." /> : undefined}>
            <div ref={folders.ref}>
              <ul className="grid" style={{ gridTemplateColumns: `repeat(${folders.cols}, minmax(0, 1fr))`, columnGap: sizes.gap, rowGap: sizes.rowGap }}>
                {(allCards ? recentFolders : []).map((f) => (
                  <li key={f.id}>
                    <FolderCard folder={f} parentName={f.parentName ?? undefined} />
                  </li>
                ))}
              </ul>
            </div>
          </Section>
        );
      case "summary":
        return <HomeSummary />;
      case "bookmarks":
        return (
          <section aria-labelledby="home-bookmarks-title">
            {title("home-bookmarks-title", <Bookmark size={17} strokeWidth={1.9} />, "Bookmarks", "/starred", "See all")}
            <BookmarksList />
          </section>
        );
      case "shared":
        return (
          <section aria-labelledby="home-shared-title">
            {title("home-shared-title", <Share2 size={17} strokeWidth={1.9} />, "Shared with me", "/shared", "See all")}
            <SharedList />
          </section>
        );
      case "templates":
        return (
          <section aria-labelledby="home-templates-title">
            {title("home-templates-title", <LayoutTemplate size={17} strokeWidth={1.9} />, "Templates", "/templates", "See all")}
            <TemplatesList />
          </section>
        );
      case "pinned":
        return <PinnedNote id={prefs?.pinnedNote ?? null} choices={recent} pin={(documentId) => setPinnedNote({ documentId })} />;
    }
  };

  return (
    <ViewChrome
      title={<h1 className="truncate text-subheadline font-semibold">Home</h1>}
      tabTitle="Home"
    >
      <div className="mx-auto max-w-[1180px] px-4 pb-[max(2rem,var(--fab-clearance))] pt-2 sm:px-8">
        <HomeHeader editing={editing} onToggle={() => setEditing((e) => !e)} />
        <CaptureField />
        {/* With Home from its first frame (it used to arrive a moment later and push everything below down). */}
        <div className="mx-auto max-w-[680px]">
          <TodaysReviews />
        </div>
        {/* One grid of blocks in this person's order (lib/app/homeLayout.ts): three columns on a wide window, one on a
            narrow one. Customize moves them, takes them off Home and adds them back, saved per person
            (convex/homePrefs.ts). */}
        <div className="@container mt-12">
          <div className="grid grid-cols-1 gap-x-6 gap-y-10 @[760px]:grid-cols-3">
            {shown.map(({ block, hidden }, i) => (
              <HomeBlockFrame key={block.id} block={block} hidden={hidden} editing={editing} first={i === 0} last={i === shown.length - 1} saved={layout} saveLayout={saveLayout} panel={block.span !== 3} without={without}>
                {blockBody(block.id)}
              </HomeBlockFrame>
            ))}
            {editing ? <AddBlockTile blocks={rows.filter((r) => r.hidden).map((r) => r.block)} saved={layout} saveLayout={saveLayout} /> : null}
          </div>
        </div>
        {editing ? (
          <div className="mt-8 flex justify-end">
            <button type="button" className="ui-btn ui-btn-quiet h-control px-3 text-callout" onClick={() => void setLayout({ layout: null })}>
              Reset to the default Home
            </button>
          </div>
        ) : null}
      </div>
    </ViewChrome>
  );
}
