"use client";

import { useMutation, useQuery } from "convex/react";
import { useId, useMemo, useState } from "react";
import { FolderPlus, Hash, LayoutGrid, MoreHorizontal, Rows3, Search, X } from "lucide-react";
import { FolderGlyph } from "@/components/ui/FolderGlyph";
import { FOLDER_CARD_BOX, FOLDER_CARD_FRAME, FOLDER_CARD_MENU, FolderCardArt, type FolderPreview } from "./FolderCardArt";
import { FolderMenu } from "@/components/app/FolderMenu";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { AppLink, useAppRouter } from "@/lib/app/router";
import { useLocalStorage } from "@/lib/hooks/useEngine";
import { formatRelative } from "@/lib/format";
import { Button } from "@/components/ui/Button";
import { PromptDialog } from "@/components/ui/PromptDialog";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { ViewChrome } from "@/components/app/Shell";
import { Select } from "@/components/ui/Select";

type FolderSort = "name" | "updated" | "count" | "created";
type TagSort = "name" | "count" | "created";

const tagColor = (color: string) => `var(--color-${color === "muted" ? "ink-muted" : color})`;
const pages = (n: number) => (n === 1 ? "1 page" : `${n.toLocaleString()} pages`);

function SearchField({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const id = useId();
  return (
    <div className="relative min-w-0 flex-1 sm:max-w-sm">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" aria-hidden />
      <input id={id} type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder={label} autoComplete="off" className="ui-input h-9 w-full rounded-[6px] pl-8 pr-8 text-sm" />
      {value ? (
        <button type="button" aria-label="Clear search" onClick={() => onChange("")} className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-[6px] text-faint hover:text-ink">
          <X size={13} aria-hidden />
        </button>
      ) : null}
    </div>
  );
}

function SortSelect<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <label className="flex items-center gap-2 text-sm text-muted">
      Sort
      <Select value={value} onChange={(e) => onChange(e.target.value as T)} className="ui-input h-9 rounded-[6px] px-3 text-sm text-ink">
        {options.map(([v, label]) => (
          <option key={v} value={v}>
            {label}
          </option>
        ))}
      </Select>
    </label>
  );
}

export interface FolderSummary {
  id: string;
  name: string;
  color: string | null;
  parentFolderId: string | null;
  updatedAt: number;
  documentCount: number;
  /** Up to three of the notes inside (most recently edited first), drawn faintly through the cover. */
  previews?: FolderPreview[];
}

/** "23 mins ago" / "1 hour ago" / "Sep 10": the short age shown on folder covers. */
function shortAge(t: number): string {
  const mins = Math.max(0, Math.round((Date.now() - t) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min${mins === 1 ? "" : "s"} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * A folder card drawn as a real folder (portrait): the drawing (FolderCardArt, shared with the site's
 * replica) inside a link to the folder, with the folder's menu over the cover on hover. The page count sits
 * top-left of the front cover, the last update top-right, and the name bottom-left in large serif.
 */
export function FolderCard({ folder: f, parentName }: { folder: FolderSummary; parentName?: string }) {
  const label = `${f.name}${parentName ? `, in ${parentName}` : ""}, ${pages(f.documentCount)}, updated ${formatRelative(f.updatedAt)}`;
  return (
    <div className={FOLDER_CARD_BOX}>
      <AppLink
        href={`/folders/${f.id}`}
        aria-label={label}
        title={parentName ? `${f.name} (in ${parentName})` : f.name}
        className={`${FOLDER_CARD_FRAME} focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-4 focus-visible:ring-offset-canvas`}
      >
        <FolderCardArt name={f.name} color={f.color} count={f.documentCount} age={shortAge(f.updatedAt)} previews={f.previews} />
      </AppLink>
      <FolderMenu
        folder={f}
        trigger={<MoreHorizontal size={16} aria-hidden />}
        className={`${FOLDER_CARD_MENU} pointer-events-none focus-within:pointer-events-auto focus-within:opacity-100 group-hover:pointer-events-auto pointer-coarse:pointer-events-auto [&>div>button]:text-[#17171a]/75 [&>div>button:hover]:text-[#17171a]`}
      />
    </div>
  );
}

/** Every folder in the current context (Personal or a workspace), with search and sorting (the sidebar only lists the first few). */
export function FoldersIndex() {
  const { scope, canEdit } = useAppState();
  const data = useQuery(api.organization.index, { scope });
  const createFolder = useMutation(api.organization.createFolder);
  const { navigate } = useAppRouter();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [sort, setSort] = useLocalStorage<FolderSort>("folevi:folders-sort", "name");
  const [layout, setLayout] = useLocalStorage<"grid" | "list">("folevi:folders-layout", "grid");
  const [creating, setCreating] = useState(false);

  const names = useMemo(() => new Map((data?.folders ?? []).map((f) => [f.id, f.name])), [data]);
  const list = useMemo(() => {
    const needle = q.trim().toLocaleLowerCase();
    const rows = (data?.folders ?? []).filter((f) => !needle || f.name.toLocaleLowerCase().includes(needle));
    return rows.sort((a, b) => {
      switch (sort) {
        case "updated":
          return b.updatedAt - a.updatedAt;
        case "count":
          return b.documentCount - a.documentCount || a.name.localeCompare(b.name);
        case "created":
          return b.createdAt - a.createdAt;
        default:
          return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      }
    });
  }, [data, q, sort]);

  return (
    <ViewChrome
      title={<h1 className="text-sm font-semibold">Folders</h1>}
      tabTitle="Folders"
      actions={
        canEdit ? (
          <Button size="sm" variant="primary" onClick={() => setCreating(true)}>
            <FolderPlus size={14} aria-hidden /> New folder
          </Button>
        ) : null
      }
    >
      <div className="mx-auto max-w-6xl px-4 pb-24 pt-3 sm:px-8">
        <div className="flex flex-wrap items-center gap-3">
          <SearchField value={q} onChange={setQ} label="Search folders" />
          <p role="status" className="min-w-0 truncate text-[13px] text-muted">
            {data === undefined ? "Loading…" : q.trim() ? `${list.length} of ${data.folders.length} folders` : `${data.folders.length} ${data.folders.length === 1 ? "folder" : "folders"}`}
          </p>
          <span className="flex-1" />
          <SortSelect<FolderSort>
            value={sort}
            onChange={setSort}
            options={[
              ["name", "Name"],
              ["updated", "Last updated"],
              ["count", "Most pages"],
              ["created", "Newest"],
            ]}
          />
          <div className="ui-seg ui-well" role="group" aria-label="Layout">
            <button type="button" aria-pressed={layout === "grid"} aria-label="Grid" title="Grid" onClick={() => setLayout("grid")}>
              <LayoutGrid size={15} aria-hidden />
            </button>
            <button type="button" aria-pressed={layout === "list"} aria-label="List" title="List" onClick={() => setLayout("list")}>
              <Rows3 size={15} aria-hidden />
            </button>
          </div>
        </div>

        {data && !list.length ? (
          <p className="mt-16 text-center text-sm text-muted">{q.trim() ? `No folders match “${q.trim()}”.` : "No folders yet. Create one to group related pages."}</p>
        ) : layout === "grid" ? (
          <ul className="mt-6 grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-x-8 gap-y-10" aria-label="Folders">
            {list.map((f) => (
              <li key={f.id}>
                <FolderCard folder={f} parentName={f.parentFolderId ? names.get(f.parentFolderId) : undefined} />
              </li>
            ))}
          </ul>
        ) : (
          <ul className="ui-card mt-6 divide-y divide-line overflow-hidden rounded-[6px]" aria-label="Folders">
            {list.map((f) => (
              <li key={f.id} className="group relative">
                <AppLink href={`/folders/${f.id}`} className="flex items-center gap-3 py-2.5 pl-4 pr-14 hover:bg-accent-soft/50 focus-visible:bg-accent-soft/60 focus-visible:outline-none">
                  <FolderGlyph color={f.color} size={24} />
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {f.name}
                    {f.parentFolderId ? <span className="ml-2 text-xs font-normal text-muted">in {names.get(f.parentFolderId) ?? "a folder"}</span> : null}
                  </span>
                  <span className="w-20 text-right text-xs tabular-nums text-muted">{pages(f.documentCount)}</span>
                  <span className="hidden w-32 text-right text-xs text-faint sm:block">{formatRelative(f.updatedAt)}</span>
                </AppLink>
                <FolderMenu folder={f} className="absolute right-3 top-1/2 -translate-y-1/2 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100" />
              </li>
            ))}
          </ul>
        )}
      </div>
      <PromptDialog
        open={creating}
        title="New folder"
        label="Folder name"
        confirmLabel="Create folder"
        onClose={() => setCreating(false)}
        onSubmit={async (name) => {
          try {
            const r = await createFolder({ scope, name });
            setCreating(false);
            navigate(`/folders/${r.id}`);
          } catch (e) {
            toast.show(errorMessage(e), { tone: "error" });
          }
        }}
      />
    </ViewChrome>
  );
}

/** Every tag in the current context, with search and sorting. */
export function TagsIndex() {
  const { scope } = useAppState();
  const data = useQuery(api.organization.index, { scope });
  const [q, setQ] = useState("");
  const [sort, setSort] = useLocalStorage<TagSort>("folevi:tags-sort", "name");
  const list = useMemo(() => {
    const needle = q.trim().replace(/^#/, "").toLocaleLowerCase();
    const rows = (data?.tags ?? []).filter((t) => !needle || t.name.toLocaleLowerCase().includes(needle));
    return rows.sort((a, b) => (sort === "count" ? b.documentCount - a.documentCount || a.name.localeCompare(b.name) : sort === "created" ? b.createdAt - a.createdAt : a.name.localeCompare(b.name, undefined, { sensitivity: "base" })));
  }, [data, q, sort]);

  return (
    <ViewChrome
      title={<h1 className="text-sm font-semibold">Tags</h1>}
      tabTitle="Tags"
    >
      <div className="mx-auto max-w-6xl px-4 pb-24 pt-3 sm:px-8">
        <div className="flex flex-wrap items-center gap-3">
          <SearchField value={q} onChange={setQ} label="Search tags" />
          <p role="status" className="min-w-0 truncate text-[13px] text-muted">
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
          <p className="mt-16 text-center text-sm text-muted">{q.trim() ? `No tags match “${q.trim()}”.` : "No tags yet. Add tags to a page from its Info panel."}</p>
        ) : (
          <ul className="mt-6 flex flex-wrap gap-2" aria-label="Tags">
            {list.map((t) => (
              <li key={t.id}>
                <AppLink href={`/tags/${t.id}`} className="ui-raised inline-flex h-9 items-center gap-2 rounded-[6px] pl-3 pr-2 text-[13.5px] outline-none transition-colors hover:bg-accent-soft focus-visible:ring-2 focus-visible:ring-focus">
                  <Hash size={14} style={{ color: tagColor(t.color) }} aria-hidden />
                  <span className="font-medium text-ink">{t.name}</span>
                  <span className="rounded-[6px] bg-sunken px-2 py-0.5 text-[11px] tabular-nums text-muted">
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
