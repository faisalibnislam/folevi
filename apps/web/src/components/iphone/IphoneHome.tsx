"use client";

import { useMemo, useState } from "react";
import { useCanCall, useCapabilities } from "@/lib/mode";
import { useQuery } from "convex/react";
import { Archive, FileDiff, FileText, Files, FolderPlus, Hash, Inbox, Layers, LayoutTemplate, Share2, Trash2, Waypoints } from "lucide-react";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { useFolderTree } from "@/lib/app/folders";
import { useOfflineQuery, useOutboxEntries } from "@/lib/sync/queryCache";
import { overlayFolderIndex } from "@/lib/sync/overlays";
import { AppLink, useAppRouter } from "@/lib/app/router";
import { ageText } from "@/lib/format";
import { useMinute } from "@/lib/hooks/useMinute";
import { ViewChrome, useShell } from "@/components/app/Shell";
import { FolderCard } from "@/components/views/FolderCard";
import { useAiEnabled } from "@/components/ai/useAi";
import { CatchUp } from "@/components/ai/CatchUp";
import { useReviewWindow } from "@/components/study/review";
import { NOTE_CARD_LINK, NoteCardFace } from "@/components/views/DocumentCard";
import { NoteContextMenu, contextPoint, type Summary } from "@/components/views/DocumentBrowser";
import { RootAvatar, RootPill } from "./RootBar";
import { useIphoneActions } from "./IphoneShell";
import { EmptyBox, HomeSection, ListRow, SearchField } from "./Rows";

const CAROUSEL = 10;
const SHOWN = 6;

/** A recent note in Home's row: the note's own card (its look and opening text), a long press for its actions. */
function RecentCard({ doc }: { doc: Summary }) {
  const [ctx, setCtx] = useState<{ x: number; y: number } | null>(null);
  return (
    <li className="w-[156px] flex-none snap-start [container-type:inline-size]">
      <div
        data-lift=""
        className="transition-transform"
        onContextMenu={(e) => {
          e.preventDefault();
          setCtx(contextPoint(e));
        }}
      >
        <AppLink href={`/d/${doc.id}`} className={`${NOTE_CARD_LINK} active:scale-[0.97]`}>
          <NoteCardFace title={doc.title} excerpt={doc.excerpt} preview={doc.preview} cover={doc.cover} style={doc.style} createdAt={doc.createdAt} time={ageText(doc.updatedAt)} starred={doc.starred} folder={doc.homeFolder} />
        </AppLink>
      </div>
      {ctx ? <NoteContextMenu doc={doc} view="all" recent at={ctx} onDone={() => setCtx(null)} /> : null}
    </li>
  );
}

/** A note as a row (Starred), with its actions on a long press. */
export function NoteRow({ doc }: { doc: Summary }) {
  const [ctx, setCtx] = useState<{ x: number; y: number } | null>(null);
  return (
    <>
      <ListRow
        href={`/d/${doc.id}`}
        icon={<FileText />}
        label={doc.title || "Untitled"}
        onContextMenu={(e) => {
          e.preventDefault();
          setCtx(contextPoint(e));
        }}
      />
      {ctx ? <NoteContextMenu doc={doc} view="starred" at={ctx} onDone={() => setCtx(null)} /> : null}
    </>
  );
}

/**
 * Home in the iPhone app: the avatar (account and places) and notifications at the top, a large title, the
 * search field, recent notes as cards in a row, then All notes, Drafts, Shared with Me and Changes as rows,
 * Starred, Folders and Tags sections, and Templates, Archive and Trash at the end.
 */
export function IphoneHome() {
  const { scope, workspace, outbox } = useAppState();
  const { openPalette } = useShell();
  const { openNewFolder } = useIphoneActions();
  const { navigate } = useAppRouter();
  const aiOn = useAiEnabled();
  const recent = useQuery(api.documents.recentNotes, { scope, limit: CAROUSEL });
  const starred = useQuery(api.documents.list, { scope, view: "starred", sort: "updated", paginationOpts: { numItems: SHOWN + 1, cursor: null } });
  const drafts = useQuery(api.organization.draftCount, { scope });
  // Local mode has no Shared with Me or Changes (docs/LOCAL_MODE_PLAN.md §5.2).
  const caps = useCapabilities();
  const graph = useCanCall(api.aiGraph.graph);
  const changes = useQuery(api.changes.list, caps.changes ? {} : "skip");
  const minute = useMinute();
  const proposed = useQuery(api.proposals.count, caps.changes ? { now: minute } : "skip");
  const reviews = useQuery(api.study.summary, useReviewWindow(5 * 60_000));
  const org = useFolderTree(scope);
  // Folders with how many notes each holds (the folder index, with what's waiting to sync laid over it).
  const served = useOfflineQuery(api.organization.index, { scope, only: "folders" });
  const waiting = useOutboxEntries(outbox);
  const index = useMemo(() => (served ? overlayFolderIndex(served, waiting, scope) : served), [served, waiting, scope]);
  const summaries = useMemo(() => new Map((index?.folders ?? []).map((f) => [f.id, f])), [index]);
  const place = workspace ? workspace.name : "Personal";
  const topFolders = (org?.folders ?? []).filter((f) => !f.parentFolderId);
  const tags = org?.tags ?? [];
  const changeCount = (changes?.notes.length ?? 0) + (proposed ?? 0);
  const waitingReviews = reviews ? reviews.due + reviews.new : 0;

  return (
    <ViewChrome
      title="Home"
      tabTitle="Home"
      iphone={{
        title: "Home",
        root: true,
        // The place shows in the avatar; only a workspace names itself above the title.
        eyebrow: workspace ? workspace.name : undefined,
        leading: <RootAvatar />,
        trailing: (
          <RootPill
            more={[
              { label: "New folder", icon: <FolderPlus size={18} />, onSelect: openNewFolder },
              { label: "All folders", icon: <Files size={18} />, onSelect: () => navigate("/folders") },
              ...(graph ? [{ label: "Graph", icon: <Waypoints size={18} />, onSelect: () => navigate("/graph") }] : []),
            ]}
          />
        ),
        header: <SearchField placeholder={`Search in ${place}`} onOpen={openPalette} />,
      }}
    >
      {recent === undefined ? (
        <div className="flex gap-3.5 overflow-hidden px-4 pb-6 pt-3" aria-busy aria-label="Loading">
          {[0, 1, 2].map((i) => (
            <div key={i} className="aspect-[25/27] w-[156px] flex-none animate-pulse rounded-container bg-sunken motion-reduce:animate-none" />
          ))}
        </div>
      ) : recent.length ? (
        <ul aria-label="Recent notes" data-iphone-tappable="" className="flex snap-x snap-mandatory scroll-px-4 gap-3.5 overflow-x-auto px-4 pb-6 pt-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {recent.map((d) => (
            <RecentCard key={d.id} doc={d} />
          ))}
        </ul>
      ) : (
        <div className="pt-3">
          <EmptyBox>Notes you open show up here</EmptyBox>
        </div>
      )}

      <nav aria-label="Notes" data-iphone-tappable="">
        {aiOn ? <CatchUp row /> : null}
        <ListRow href="/notes" icon={<Files />} label="All notes" />
        <ListRow href="/drafts" icon={<Inbox />} label="Drafts" detail={drafts || undefined} />
        {caps.sharing ? <ListRow href="/shared" icon={<Share2 />} label="Shared with Me" /> : null}
        {caps.changes ? <ListRow href="/changes" icon={<FileDiff />} label="Changes" detail={changeCount || undefined} /> : null}
        {reviews?.hasCards ? <ListRow href="/review" icon={<Layers />} label="Reviews" detail={waitingReviews || undefined} /> : null}
      </nav>

      <HomeSection id="starred" title="Starred" href="/starred" empty={starred && !starred.page.length ? <EmptyBox>Star notes to keep them close</EmptyBox> : undefined}>
        {(starred?.page ?? []).slice(0, SHOWN).map((d) => (
          <NoteRow key={d.id} doc={d} />
        ))}
        {starred && starred.page.length > SHOWN ? <ListRow href="/starred" label={<span className="text-muted">See all starred</span>} /> : null}
      </HomeSection>

      <HomeSection
        id="folders"
        title="Folders"
        href="/folders"
        menu={[
          { label: "New folder", icon: <FolderPlus size={18} />, onSelect: openNewFolder },
          { label: "All folders", icon: <Files size={18} />, onSelect: () => navigate("/folders") },
        ]}
        empty={org && !topFolders.length ? <EmptyBox>Folders keep related notes together</EmptyBox> : undefined}
      >
        {/* The app's own folder cards, side by side, as on Home in the browser and the Mac app. */}
        <ul aria-label="Folders" data-iphone-tappable="" className="flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-7 pt-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {topFolders.map((f) => {
            const summary = summaries.get(f.id);
            return (
              <li key={f.id} className="w-[142px] flex-none snap-start">
                <FolderCard folder={summary ?? { id: f.id, name: f.name, color: f.color, parentFolderId: null, updatedAt: 0, documentCount: 0 }} />
              </li>
            );
          })}
        </ul>
      </HomeSection>

      {tags.length ? (
        <HomeSection id="tags" title="Tags" collapsible defaultOpen={false}>
          {tags.map((t) => (
            <ListRow key={t.id} href={`/tags/${t.id}`} icon={<Hash style={{ color: `var(--color-${t.color === "muted" ? "ink-muted" : t.color})` }} />} label={t.name} />
          ))}
        </HomeSection>
      ) : null}

      <nav aria-label="More" data-iphone-tappable="" className="mt-5">
        <ListRow href="/templates" icon={<LayoutTemplate />} label="Templates" />
        <ListRow href="/archive" icon={<Archive />} label="Archive" />
        <ListRow href="/trash" icon={<Trash2 />} label="Trash" />
      </nav>
    </ViewChrome>
  );
}
