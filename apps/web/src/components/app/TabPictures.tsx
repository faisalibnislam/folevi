"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { useOfflineQuery } from "@/lib/sync/queryCache";
import { editedText, formatRelative } from "@/lib/format";
import { NOTE_CARD_ASPECT, NOTE_CARD_LINK, NoteCardFace } from "@/components/views/DocumentCard";
import { FOLDER_CARD_BOX, FolderCardArt } from "@/components/views/FolderCardArt";
import type { DocTab } from "@/lib/app/tabs";
import { HomePicture } from "./HomePicture";

/*
 * The pictures in Show all tabs (the owner, 2026-11-25): a note's tab is the note's card, the same as Home's
 * Recent notes; notes side by side are their cards side by side; a folder's tab is its folder card with its notes
 * standing in it; Home and every other view are a small drawing of that page. Only faces: no links, menus or
 * focus inside (the picture sits in the overview's button).
 */

/** The size of a tab's picture: a note card's shape, so every tile in the grid lines up. */
export const TAB_PICTURE_BOX = `relative w-full ${NOTE_CARD_ASPECT}`;

export function TabPictureFor({ tab, titles, label, icon }: { tab: DocTab | null; titles: Record<string, string>; label: string; icon: ReactNode }) {
  if (!tab) return <MiniPage title="Home" icon={icon} bare><HomePicture className="h-full w-full" width={640} height={691} columns={3} /></MiniPage>;
  if (tab.view) {
    if (tab.view.kind === "folder") return <FolderTabCard path={tab.view.path} name={label} />;
    return <ViewPicture kind={tab.view.kind} path={tab.view.path} title={label} icon={icon} />;
  }
  const panes = tab.panes ?? [tab.at ?? tab.id];
  if (panes.length === 1) return <NoteTabCard id={panes[0]!} title={titles[panes[0]!]} />;
  return (
    <div className="absolute inset-0 flex items-center gap-[4%]">
      {panes.map((id) => (
        <div key={id} className="min-w-0 flex-1">
          <NoteTabCard id={id} title={titles[id]} />
        </div>
      ))}
    </div>
  );
}

/** A note's card, drawn from the note's details (this device's copy at once, else the server's). */
export function NoteTabCard({ id, title }: { id: string; title?: string }) {
  const meta = useOfflineQuery(api.documents.get, { documentId: id });
  const d = meta?.document;
  return (
    <div className="relative [container-type:inline-size]" data-tab-card="note">
      {d ? (
        <div className={`${NOTE_CARD_LINK} pointer-events-none`}>
          <NoteCardFace
            title={title || d.title}
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
          />
        </div>
      ) : (
        <div className={`${NOTE_CARD_ASPECT} w-full rounded-l-tiny rounded-r-small bg-[var(--glass-hover)] ${meta === undefined ? "animate-pulse motion-reduce:animate-none" : ""}`} />
      )}
    </div>
  );
}

/** The folders of the open place with their notes (the folder index, as the Folders page has it). */
function useFolderSummaries() {
  const { scope } = useAppState();
  const index = useOfflineQuery(api.organization.index, { scope, only: "folders" });
  return index?.folders;
}

/** A folder's tab: its folder card, at the bottom of the tile like a folder standing on a shelf. */
function FolderTabCard({ path, name }: { path: string; name: string }) {
  const id = path.split("/").filter(Boolean)[1] ?? "";
  const folders = useFolderSummaries();
  const f = folders?.find((x) => x.id === id);
  return (
    <div className="absolute inset-0 flex items-end" data-tab-card="folder">
      <div className={`${FOLDER_CARD_BOX} w-full`}>
        <div className="absolute inset-0">
          <FolderCardArt
            name={f?.name ?? name}
            color={f?.color ?? null}
            count={f?.documentCount ?? 0}
            age={f ? formatRelative(f.updatedAt) : ""}
            previews={f?.previews}
            subfolders={f?.childCount ?? 0}
            subfolderColors={f?.childColors}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * A page drawn small: laid out at `WIDTH` px and scaled to the tile, so it reads the same at any size. `bare` hands
 * the whole page to the child (Home draws its own).
 */
const WIDTH = 360;
function MiniPage({ title, icon, children, bare = false }: { title: string; icon: ReactNode; children: ReactNode; bare?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => setScale(el.clientWidth / WIDTH);
    fit();
    const watch = new ResizeObserver(fit);
    watch.observe(el);
    return () => watch.disconnect();
  }, []);
  return (
    <div
      ref={box}
      data-tab-card="view"
      className="absolute inset-0 overflow-hidden rounded-control bg-[var(--color-surface-raised)] shadow-[0_0_0_1px_var(--color-line),var(--shadow-resting)]"
    >
      {bare ? (
        children
      ) : scale > 0 ? (
        <div className="pointer-events-none absolute left-0 top-0 origin-top-left px-7 pt-7" style={{ width: WIDTH, height: (WIDTH * 27) / 25, transform: `scale(${scale})` }}>
          <div className="mb-5 flex items-center gap-2.5 text-heading [&>svg]:h-6 [&>svg]:w-6 [&>svg]:opacity-100">
            {icon}
            <span className="ui-display truncate text-title-1 font-semibold">{title}</span>
          </div>
          {children}
        </div>
      ) : null}
    </div>
  );
}

/** Two rows of two note cards, or faint outlines while there are none. */
function NoteGrid({ docs }: { docs: { id: string; title: string; excerpt: string; preview?: unknown; shape?: unknown; kind?: unknown; cover: unknown; style: unknown; createdAt: number; updatedAt: number; starred?: boolean; homeFolder?: unknown }[] | undefined }) {
  const shown = (docs ?? []).slice(0, 4);
  return (
    <div className="grid grid-cols-2 gap-5">
      {shown.length
        ? shown.map((d) => (
            <div key={d.id} className="relative [container-type:inline-size]">
              <div className={NOTE_CARD_LINK}>
                <NoteCardFace
                  title={d.title}
                  excerpt={d.excerpt}
                  preview={d.preview as never}
                  shape={d.shape as never}
                  kind={d.kind as never}
                  cover={d.cover as never}
                  style={d.style as never}
                  createdAt={d.createdAt}
                  time={editedText(d.updatedAt)}
                  starred={d.starred}
                  folder={d.homeFolder as never}
                />
              </div>
            </div>
          ))
        : [0, 1, 2, 3].map((i) => <div key={i} className={`${NOTE_CARD_ASPECT} rounded-l-tiny rounded-r-small border-2 border-dashed border-line`} />)}
    </div>
  );
}

const LISTED: Record<string, "starred" | "unsorted" | "archive" | "trash" | "templates"> = { starred: "starred", unsorted: "unsorted", archive: "archive", trash: "trash", templates: "templates" };

function ListedNotes({ view, tagId }: { view: "starred" | "unsorted" | "archive" | "trash" | "templates" | "tag"; tagId?: string }) {
  const { scope } = useAppState();
  const list = useOfflineQuery(api.documents.list, { scope, view, ...(tagId ? { tagId } : {}), sort: "updated", paginationOpts: { numItems: 4, cursor: null } });
  return <NoteGrid docs={list?.page} />;
}

function RecentNoteGrid() {
  const { scope } = useAppState();
  const notes = useOfflineQuery(api.documents.recentNotes, { scope, limit: 4 });
  return <NoteGrid docs={notes} />;
}

function FolderGrid() {
  const folders = useFolderSummaries();
  const shown = [...(folders ?? [])].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 4);
  return (
    <div className="grid grid-cols-2 gap-x-5 gap-y-3">
      {shown.map((f) => (
        <div key={f.id} className={FOLDER_CARD_BOX}>
          <div className="absolute inset-0">
            <FolderCardArt name={f.name} color={f.color} count={f.documentCount} age={formatRelative(f.updatedAt)} previews={f.previews} subfolders={f.childCount ?? 0} subfolderColors={f.childColors} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** A grey line standing in for words. */
const Line = ({ w, strong = false }: { w: string; strong?: boolean }) => <span className={`block h-3 rounded-tiny ${strong ? "bg-[color-mix(in_oklab,var(--color-ink)_22%,transparent)]" : "bg-[color-mix(in_oklab,var(--color-ink)_10%,transparent)]"}`} style={{ width: w }} />;

function TasksDrawing() {
  const rows = ["72%", "54%", "64%", "40%", "58%", "46%", "66%"];
  return (
    <div className="space-y-4 pt-1">
      {rows.map((w, i) => (
        <div key={i} className="flex items-center gap-3">
          <span className={`h-5 w-5 flex-none rounded-chip border-2 ${i === 2 ? "border-transparent bg-[var(--color-heading)]" : "border-[color-mix(in_oklab,var(--color-ink)_28%,transparent)]"}`} />
          <Line w={w} strong={i !== 2} />
        </div>
      ))}
    </div>
  );
}

function CalendarDrawing() {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const lead = (first.getDay() + 6) % 7; // weeks start on Monday
  const cells = Array.from({ length: 42 }, (_, i) => i - lead + 1);
  return (
    <div>
      <div className="mb-3 text-title-3 font-semibold text-heading">{now.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</div>
      <div className="grid grid-cols-7 gap-1.5 text-center text-callout">
        {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
          <span key={i} className="pb-1 text-muted">
            {d}
          </span>
        ))}
        {cells.map((n, i) => (
          <span key={i} className={`grid h-11 place-items-center rounded-small ${n === now.getDate() ? "bg-[var(--color-heading)] font-semibold text-canvas" : n >= 1 && n <= days ? "bg-[var(--glass-hover)] text-ink" : ""}`}>
            {n >= 1 && n <= days ? n : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

function SettingsDrawing() {
  const sections = ["Account", "Appearance", "Foli AI", "Library", "Shortcuts", "Privacy", "About"];
  return (
    <div className="flex gap-5">
      <div className="w-40 flex-none space-y-1.5">
        {sections.map((s, i) => (
          <div key={s} className={`rounded-small px-3 py-2 text-callout ${i === 1 ? "bg-[var(--glass-active)] font-semibold text-heading" : "text-ink"}`}>
            {s}
          </div>
        ))}
      </div>
      <div className="min-w-0 flex-1 space-y-4 rounded-panel bg-[var(--color-surface-raised)] p-4 shadow-[0_0_0_0.5px_rgb(0_0_0/0.06)]">
        {["62%", "48%", "70%", "40%", "56%"].map((w, i) => (
          <div key={i} className="flex items-center justify-between gap-3">
            <Line w={w} strong />
            <span className={`h-5 w-9 flex-none rounded-chip ${i % 2 ? "bg-[color-mix(in_oklab,var(--color-ink)_14%,transparent)]" : "bg-[var(--color-heading)]"}`} />
          </div>
        ))}
      </div>
    </div>
  );
}

function GraphDrawing() {
  const nodes: [number, number, number][] = [[220, 160, 16], [110, 90, 10], [330, 80, 11], [90, 250, 9], [350, 260, 12], [230, 330, 10], [40, 170, 7], [410, 170, 8]];
  const links: [number, number][] = [[0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [1, 6], [2, 7], [4, 5], [3, 5]];
  return (
    <svg viewBox="0 0 440 380" className="w-full text-[var(--color-heading)]">
      {links.map(([a, b], i) => (
        <line key={i} x1={nodes[a]![0]} y1={nodes[a]![1]} x2={nodes[b]![0]} y2={nodes[b]![1]} stroke="currentColor" strokeOpacity="0.22" strokeWidth="2" />
      ))}
      {nodes.map(([x, y, r], i) => (
        <circle key={i} cx={x} cy={y} r={r} fill="currentColor" fillOpacity={i === 0 ? 0.85 : 0.35} />
      ))}
    </svg>
  );
}

function ChatDrawing() {
  return (
    <div className="space-y-4 pt-2">
      <div className="ml-auto w-3/5 space-y-2 rounded-panel bg-[var(--color-heading)] p-4 [&>span]:!bg-[color-mix(in_oklab,var(--color-canvas)_45%,transparent)]">
        <Line w="90%" />
        <Line w="60%" />
      </div>
      <div className="w-4/5 space-y-2.5 rounded-panel bg-[var(--color-surface-raised)] p-4 shadow-[0_0_0_0.5px_rgb(0_0_0/0.06)]">
        <Line w="95%" strong />
        <Line w="88%" />
        <Line w="92%" />
        <Line w="50%" />
      </div>
      <div className="ml-auto w-2/5 rounded-panel bg-[var(--color-heading)] p-4 [&>span]:!bg-[color-mix(in_oklab,var(--color-canvas)_45%,transparent)]">
        <Line w="80%" />
      </div>
    </div>
  );
}

function CardsDrawing() {
  return (
    <div className="relative mx-auto mt-6 h-64 w-72">
      {[2, 1, 0].map((i) => (
        <div key={i} className="absolute inset-0 rounded-panel bg-[var(--color-surface-raised)] p-6 shadow-[0_0_0_0.5px_rgb(0_0_0/0.08),var(--shadow-lifted)]" style={{ transform: `translate(${i * 14}px, ${-i * 14}px)` }}>
          {i === 0 ? (
            <div className="space-y-3 pt-12">
              <Line w="80%" strong />
              <Line w="55%" />
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function ChangesDrawing() {
  const rows: ["add" | "del" | "same", string][] = [["same", "70%"], ["del", "58%"], ["add", "66%"], ["add", "44%"], ["same", "62%"], ["del", "38%"], ["add", "72%"]];
  return (
    <div className="space-y-2.5">
      {rows.map(([k, w], i) => (
        <div key={i} className={`flex items-center gap-3 rounded-small px-3 py-2 ${k === "add" ? "bg-[color-mix(in_oklab,#2f9e5b_14%,transparent)]" : k === "del" ? "bg-[color-mix(in_oklab,#d1453b_12%,transparent)]" : ""}`}>
          <span className="w-3 text-callout font-semibold text-muted">{k === "add" ? "+" : k === "del" ? "−" : ""}</span>
          <Line w={w} strong={k !== "same"} />
        </div>
      ))}
    </div>
  );
}

function ViewPicture({ kind, path, title, icon }: { kind: string; path: string; title: string; icon: ReactNode }) {
  let body: ReactNode;
  if (kind === "notes") body = <RecentNoteGrid />;
  else if (LISTED[kind]) body = <ListedNotes view={LISTED[kind]!} />;
  else if (kind === "tag") body = <ListedNotes view="tag" tagId={path.split("/").filter(Boolean)[1]} />;
  else if (kind === "folders") body = <FolderGrid />;
  else if (kind === "tasks") body = <TasksDrawing />;
  else if (kind === "calendar" || kind === "daily") body = <CalendarDrawing />;
  else if (kind === "settings") body = <SettingsDrawing />;
  else if (kind === "graph") body = <GraphDrawing />;
  else if (kind === "ai") body = <ChatDrawing />;
  else if (kind === "review") body = <CardsDrawing />;
  else if (kind === "changes") body = <ChangesDrawing />;
  else if (kind === "shared") body = <NoteGrid docs={[]} />;
  else
    body = (
      <div className="space-y-3 pt-2">
        {["86%", "72%", "90%", "64%", "78%", "52%"].map((w, i) => (
          <Line key={i} w={w} strong={i === 0} />
        ))}
      </div>
    );
  return (
    <MiniPage title={title} icon={icon}>
      {body}
    </MiniPage>
  );
}
