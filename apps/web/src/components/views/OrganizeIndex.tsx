"use client";

import { useQuery } from "convex/react";
import { useCallback, useId, useMemo, useState } from "react";
import { Hash, LayoutGrid, Rows3, Search, X, FolderOpen } from "lucide-react";
import { folderAncestors } from "@folevi/editor-schema";
import { FolderGlyph } from "@/components/ui/FolderGlyph";
import { FolderCard, type FolderSummary } from "./FolderCard";
import { FolderMenu } from "@/components/app/FolderMenu";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { useOfflineQuery, useOutboxEntries } from "@/lib/sync/queryCache";
import { overlayFolderIndex } from "@/lib/sync/overlays";
import { AppLink } from "@/lib/app/router";
import { folderTabClicks, useOpenInBackground } from "@/lib/app/tabs";
import { useLocalStorage } from "@/lib/hooks/useEngine";
import { ageText } from "@/lib/format";
import { NewFolderButton } from "@/components/app/NewFolderButton";
import { ViewChrome } from "@/components/app/Shell";
import { ListPageHeader, ROW_CONTROL, ROW_SEG, RowSort } from "./ListPageHeader";
import { Select } from "@/components/ui/Select";
import { EmptyState } from "@/components/ui/EmptyState";
import { useIphoneApp } from "@/lib/iphone";
import { IphoneFolders, IphoneTags } from "@/components/iphone/Organize";
import { useFolderActions } from "@/lib/app/folders";
import { folderPlace } from "@/lib/app/folderDrop";
import { FOLDER_SORTS, byFolderRank, folderSortOf, orderMoves, reorderIds, sortFolders, type FolderSort, type OrderMove } from "@/lib/app/folderOrder";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { ReorderGap, reorderedCards, useFolderReorder, type FolderReorder } from "./useFolderReorder";

type TagSort = "name" | "count" | "created";

const tagColor = (color: string) => `var(--color-${color === "muted" ? "ink-muted" : color})`;
const pages = (n: number) => (n === 1 ? "1 page" : `${n.toLocaleString()} pages`);

function SearchField({ value, onChange, label, inRow = false }: { value: string; onChange: (v: string) => void; label: string; inRow?: boolean }) {
  const id = useId();
  return (
    // In a title row: as tall as the row's other controls, its width following the window's up to 300 px.
    <div className={inRow ? "relative w-[clamp(10rem,26vw,300px)] min-w-0 flex-none" : "relative min-w-0 flex-1 max-sm:basis-full sm:max-w-sm"}>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" aria-hidden />
      <input id={id} type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder={label} autoComplete="off" className={`ui-input ${inRow ? ROW_CONTROL : "h-9"} w-full rounded-chip pl-8 pr-8 text-callout`} />
      {value ? (
        <button type="button" aria-label="Clear search" onClick={() => onChange("")} className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-chip text-faint hover:text-ink">
          <X size={13} aria-hidden />
        </button>
      ) : null}
    </div>
  );
}

/**
 * The Folders page's cards put in order by dragging (useFolderReorder): the folder goes in the gap it's dropped in.
 * `list` is the cards on show (in `sort`'s order), `all` every folder in manual order. In Name or Recent the order
 * on screen, with the move, becomes the manual order (the folders take new ranks) and the page switches to Manual.
 */
function useFolderCardOrder<T extends FolderSummary>({ list, all, sort, setSort, enabled }: { list: T[]; all: readonly T[]; sort: FolderSort; setSort: (s: FolderSort) => void; enabled: boolean }): FolderReorder {
  const actions = useFolderActions();
  const toast = useToast();
  const ids = useMemo(() => list.map((f) => f.id), [list]);
  const commit = useCallback(
    (draggedId: string, gap: number) => {
      const shown = new Set(ids);
      const manual = all.filter((f) => shown.has(f.id)).map((f) => f.id);
      const target = reorderIds(ids, draggedId, gap);
      const moves = orderMoves(manual, target);
      if (!moves.length && sort === "manual") return;
      // A folder dragged in from the sidebar (a nested one) comes up to the top level; Undo puts it back.
      const outside = !shown.has(draggedId);
      const was = outside ? folderPlace(all, draggedId) : null;
      const name = all.find((f) => f.id === draggedId)?.name ?? "the folder";
      const send = (list: OrderMove[]) => {
        for (const m of list) actions.move(m.id, null, m.afterId);
      };
      try {
        send(moves);
      } catch (e) {
        toast.show(errorMessage(e), { tone: "error" });
        return;
      }
      const before = sort;
      if (sort !== "manual") setSort("manual");
      toast.show(sort === "manual" ? `Moved “${name}”` : `Moved “${name}”. Folders are now in manual order.`, {
        action: {
          label: "Undo",
          onClick: () => {
            try {
              if (was) actions.move(draggedId, was.parentFolderId, was.afterFolderId);
              send(orderMoves(target.filter((id) => !outside || id !== draggedId), manual));
              if (before !== "manual") setSort(before);
            } catch (e) {
              toast.show(errorMessage(e), { tone: "error" });
            }
          },
        },
      });
    },
    [ids, all, sort, setSort, actions, toast],
  );
  return useFolderReorder({ key: "folders", ids, enabled, commit });
}

function SortSelect<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <label className="flex items-center gap-2 text-subheadline text-muted">
      Sort
      <Select value={value} onChange={(e) => onChange(e.target.value as T)} className="ui-input h-9 rounded-chip px-3 text-callout text-ink">
        {options.map(([v, label]) => (
          <option key={v} value={v}>
            {label}
          </option>
        ))}
      </Select>
    </label>
  );
}

/**
 * The folders of the current context (Personal or a workspace), as Finder shows a folder: the top-level ones, each
 * nested folder inside its parent's page. A search looks through every level and says where each match is.
 */
export function FoldersIndex() {
  const { scope, canEdit, outbox } = useAppState();
  const openInBackground = useOpenInBackground();
  const served = useOfflineQuery(api.organization.index, { scope, only: "folders" });
  const waiting = useOutboxEntries(outbox);
  // In their own order (by rank) before the waiting changes go on, so a move made here lands where it's dropped.
  const data = useMemo(() => (served ? overlayFolderIndex({ ...served, folders: byFolderRank(served.folders) }, waiting, scope) : served), [served, waiting, scope]);
  const [q, setQ] = useState("");
  const [saved, setSort] = useLocalStorage<string>("folevi:folders-sort", "manual");
  const sort = folderSortOf(saved);
  const [layout, setLayout] = useLocalStorage<"grid" | "list">("folevi:folders-layout", "grid");

  // Where each nested folder is ("Work / Clients"), shown with its name.
  const names = useMemo(() => {
    const folders = data?.folders ?? [];
    return new Map(folders.map((f) => [f.id, folderAncestors(folders, f.id).map((a) => a.name).join(" / ")]));
  }, [data]);
  const searching = q.trim() !== "";
  const list = useMemo(() => {
    const needle = q.trim().toLocaleLowerCase();
    const all = data?.folders ?? [];
    const ids = new Set(all.map((f) => f.id));
    // (A folder whose parent isn't in the list counts as top level, as the sidebar's tree does.)
    const rows = needle ? all.filter((f) => f.name.toLocaleLowerCase().includes(needle)) : all.filter((f) => !f.parentFolderId || !ids.has(f.parentFolderId));
    return sortFolders(rows, sort);
  }, [data, q, sort]);

  // Dragging a card between others puts it there (not while searching: a folder still goes inside a card).
  const reorder = useFolderCardOrder({ list, all: data?.folders ?? [], sort, setSort, enabled: canEdit && !searching && data !== undefined });

  const iphone = useIphoneApp();
  if (iphone)
    return (
      <IphoneFolders
        folders={data ? list : undefined}
        total={data ? list.length : 0}
        query={q}
        onQuery={setQ}
        where={names}
        sort={sort}
        onSort={setSort}
        canEdit={canEdit}
        sorts={FOLDER_SORTS}
        reorder={reorder}
      />
    );
  return (
    // The page names itself in one compact title row (the owner, 6 November 2026): Folders and its count, then the
    // search, Sort, the view switch and New folder (the top bar keeps only New note here).
    <ViewChrome title={null} tabTitle="Folders">
      <div className="mx-auto max-w-[1180px] px-4 pb-[max(6rem,var(--fab-clearance))] pt-3 sm:px-8">
        <ListPageHeader
          title="Folders"
          count={data === undefined ? "Loading…" : q.trim() ? `${list.length} of ${data.folders.length} folders` : `${list.length} ${list.length === 1 ? "folder" : "folders"}`}
          controls={
            <>
              <SearchField value={q} onChange={setQ} label="Search folders" inRow />
              <RowSort<FolderSort> value={sort} onChange={setSort} options={FOLDER_SORTS} />
              <div className={ROW_SEG} role="group" aria-label="Layout">
                <button type="button" aria-pressed={layout === "grid"} aria-label="Grid" title="Grid" onClick={() => setLayout("grid")}>
                  <LayoutGrid size={15} aria-hidden />
                </button>
                <button type="button" aria-pressed={layout === "list"} aria-label="List" title="List" onClick={() => setLayout("list")}>
                  <Rows3 size={15} aria-hidden />
                </button>
              </div>
              <NewFolderButton parentId={null} inPage />
            </>
          }
        />

        {data && !list.length ? (
          <EmptyState icon={FolderOpen} title={q.trim() ? `No folders match “${q.trim()}”` : "No folders yet"} body={q.trim() ? undefined : "Create one to group related pages."} />
        ) : layout === "grid" ? (
          <ul {...reorder.listProps} className="relative grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-x-8 gap-y-10" aria-label="Folders">
            {reorderedCards(list, reorder).map((f) =>
              typeof f === "string" ? (
                <ReorderGap key={f} id={f} />
              ) : (
                <li key={f.id} data-reorder-id={f.id} className={reorder.dragged === f.id ? "opacity-40" : undefined}>
                  <FolderCard folder={f} parentName={f.parentFolderId ? names.get(f.id) || undefined : undefined} />
                  {/* A search finds folders at every level: a nested one says where it is. */}
                  {f.parentFolderId && names.get(f.id) ? (
                    <p className="mt-2 truncate text-footnote text-muted" aria-hidden>
                      in {names.get(f.id)}
                    </p>
                  ) : null}
                </li>
              ),
            )}
          </ul>
        ) : (
          <ul className="ui-card divide-y divide-line overflow-hidden rounded-chip" aria-label="Folders">
            {list.map((f) => (
              <li key={f.id} data-ctx-host="" className="group relative">
                <AppLink href={`/folders/${f.id}`} {...folderTabClicks(openInBackground, f)} className="flex items-center gap-3 py-2.5 pl-4 pr-14 hover:bg-accent-soft/50 focus-visible:bg-accent-soft/60 focus-visible:outline-none">
                  <FolderGlyph color={f.color} size={24} />
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {f.name}
                    {f.parentFolderId ? <span className="ml-2 text-footnote font-normal text-muted">in {names.get(f.id) || "a folder"}</span> : null}
                  </span>
                  <span className="w-20 text-right text-footnote tabular-nums text-muted">{pages(f.documentCount)}</span>
                  <span className="hidden w-32 text-right text-footnote text-faint sm:block">{ageText(f.updatedAt)}</span>
                </AppLink>
                <FolderMenu folder={f} className="absolute right-3 top-1/2 -translate-y-1/2 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100" />
              </li>
            ))}
          </ul>
        )}
      </div>
    </ViewChrome>
  );
}

/** Every tag in the current context, with search and sorting. */
export function TagsIndex() {
  const { scope } = useAppState();
  const data = useQuery(api.organization.index, { scope, only: "tags" });
  const [q, setQ] = useState("");
  const [sort, setSort] = useLocalStorage<TagSort>("folevi:tags-sort", "name");
  const list = useMemo(() => {
    const needle = q.trim().replace(/^#/, "").toLocaleLowerCase();
    const rows = (data?.tags ?? []).filter((t) => !needle || t.name.toLocaleLowerCase().includes(needle));
    return rows.sort((a, b) => (sort === "count" ? b.documentCount - a.documentCount || a.name.localeCompare(b.name) : sort === "created" ? b.createdAt - a.createdAt : a.name.localeCompare(b.name, undefined, { sensitivity: "base" })));
  }, [data, q, sort]);

  const iphone = useIphoneApp();
  if (iphone)
    return (
      <IphoneTags
        tags={data ? list : undefined}
        query={q}
        onQuery={setQ}
        sort={sort}
        onSort={setSort}
        sorts={[
          ["name", "Name"],
          ["count", "Most used"],
          ["created", "Newest"],
        ]}
      />
    );
  return (
    <ViewChrome
      title={<h1 className="text-subheadline font-semibold">Tags</h1>}
      tabTitle="Tags"
    >
      <div className="mx-auto max-w-[1180px] px-4 pb-[max(6rem,var(--fab-clearance))] pt-3 sm:px-8">
        <div className="flex flex-wrap items-center gap-3">
          <SearchField value={q} onChange={setQ} label="Search tags" />
          <p role="status" className="min-w-0 truncate text-subheadline text-muted">
            {data === undefined ? "Loading…" : q.trim() ? `${list.length} of ${data.tags.length} tags` : `${data.tags.length} ${data.tags.length === 1 ? "tag" : "tags"}`}
          </p>
          <span className="flex-1" />
          <SortSelect<TagSort>
            value={sort}
            onChange={setSort}
            options={[
              ["name", "Name"],
              ["count", "Most used"],
              ["created", "Newest"],
            ]}
          />
        </div>
        {data && !list.length ? (
          <EmptyState icon={Hash} title={q.trim() ? `No tags match “${q.trim()}”` : "No tags yet"} body={q.trim() ? undefined : "Add tags to a page from its Info panel."} />
        ) : (
          <ul className="mt-6 flex flex-wrap gap-2" aria-label="Tags">
            {list.map((t) => (
              <li key={t.id}>
                <AppLink href={`/tags/${t.id}`} className="ui-raised inline-flex h-9 items-center gap-2 rounded-chip pl-3 pr-2 text-body outline-none transition-colors hover:bg-accent-soft focus-visible:ring-2 focus-visible:ring-focus">
                  <Hash size={14} style={{ color: tagColor(t.color) }} aria-hidden />
                  <span className="font-medium text-ink">{t.name}</span>
                  <span className="rounded-chip bg-sunken px-2 py-0.5 text-caption-2 tabular-nums text-muted">
                    <span className="sr-only">, </span>
                    {pages(t.documentCount)}
                  </span>
                </AppLink>
              </li>
            ))}
          </ul>
        )}
      </div>
    </ViewChrome>
  );
}
