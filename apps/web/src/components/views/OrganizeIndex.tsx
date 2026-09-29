"use client";

import { useMutation, useQuery } from "convex/react";
import { useId, useMemo, useState } from "react";
import { FolderPlus, Hash, LayoutGrid, MoreHorizontal, Rows3, Search, X } from "lucide-react";
import { FolderGlyph } from "@/components/ui/FolderGlyph";
import { folderHex } from "@/lib/folderColors";
import type { DocumentCover } from "@folevi/editor-schema";
import { coverArtOf, coverArtThumbUrl, styleColorsOf } from "@/lib/cover";
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
  previews?: { cover: DocumentCover; title?: string; excerpt?: string }[];
}

/** "23 mins ago" / "1 hour ago" / "Sep 10" — the short age shown on folder covers. */
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
 * A folder card drawn as a real folder (portrait): a lighter back cover offset behind, paper sheets along
 * the right edge, the front cover with its stepped top-right tab, and a strap with a button. The page
 * count sits in a badge top-left, the last update top-right, and the name bottom-left in large serif
 * (up to three lines, then "…"). Everything scales with the card width (container query units).
 */
/** One note inside a folder, drawn small: its page colour, style image down the spine, title and opening text. */
function FolderNote({ note, index }: { note: { cover: DocumentCover; title?: string; excerpt?: string }; index: number }) {
  const colors = styleColorsOf(note.cover);
  const art = coverArtOf(note.cover);
  const place = [
    "left-[9%] top-[8%] -rotate-[4deg] group-hover:-translate-y-[5%]",
    "left-[14%] top-[10%] rotate-[3deg] group-hover:-translate-y-[3.5%]",
    "left-[11%] top-[12.5%] -rotate-[1deg] group-hover:-translate-y-[2%]",
  ][index]!;
  const ink = colors?.ink ?? "#1c1c1f";
  return (
    <div
      aria-hidden
      className={`absolute h-[70%] w-[78%] overflow-hidden rounded-[2.4cqw] shadow-[0_1px_2px_rgb(0_0_0/0.12),0_6px_14px_-6px_rgb(0_0_0/0.25)] transition-transform duration-300 ease-[var(--ease-folio)] ${place}`}
      style={{ background: colors?.paper ?? "#ffffff" }}
    >
      {art ? <div className="absolute inset-y-0 left-0 w-[7%]" style={{ background: `url(${coverArtThumbUrl(art.id)}) center / cover no-repeat` }} /> : null}
      <div className="absolute inset-0 left-[13%] right-[7%] top-[7%] overflow-hidden">
        <p className="line-clamp-2 font-serif text-[5.4cqw] font-medium leading-[1.2]" style={{ color: ink }}>
          {note.title || "Untitled"}
        </p>
        <p className="mt-[2cqw] whitespace-pre-line break-words text-[3.2cqw] leading-[1.45]" style={{ color: `color-mix(in oklab, ${ink} 82%, ${colors?.paper ?? "#ffffff"})` }}>
          {note.excerpt || ""}
        </p>
      </div>
    </div>
  );
}

/**
 * A folder card: a tinted back with a tab, up to three of the notes inside (faint and soft, fanned), and a
 * frosted-glass front cover in the folder's colour that the notes show through. Count, last update and name
 * sit on the front. On hover the notes rise a little out of the folder.
 */
export function FolderCard({ folder: f, parentName }: { folder: FolderSummary; parentName?: string }) {
  const base = folderHex(f.color);
  const backTone = `color-mix(in oklab, ${base} 80%, #8e94a3)`;
  const label = `${f.name}${parentName ? `, in ${parentName}` : ""}, ${pages(f.documentCount)}, updated ${formatRelative(f.updatedAt)}`;
  const previews = (f.previews ?? []).slice(0, 3);
  return (
    <div className="group relative aspect-[820/912] [container-type:inline-size]">
      <AppLink
        href={`/folders/${f.id}`}
        aria-label={label}
        title={parentName ? `${f.name} (in ${parentName})` : f.name}
        className="absolute inset-0 block rounded-[4cqw] outline-none transition-transform duration-200 ease-[var(--ease-folio)] [filter:drop-shadow(0_8px_14px_rgb(20_20_30/0.1))_drop-shadow(0_1px_2px_rgb(20_20_30/0.06))] hover:-translate-y-1 focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-4 focus-visible:ring-offset-canvas"
      >
        {/* back, with its tab */}
        <div aria-hidden className="absolute left-0 top-0 h-[9%] w-[44%] rounded-t-[3.5cqw] shadow-[inset_0_0_0_1px_rgb(0_0_0/0.08)]" style={{ background: backTone }} />
        <div aria-hidden className="absolute inset-x-0 bottom-0 top-[5%] rounded-[4cqw] rounded-tl-none shadow-[inset_0_0_0_1px_rgb(0_0_0/0.08)]" style={{ background: backTone }} />
        {/* the notes inside, faint and soft */}
        <div aria-hidden className="absolute inset-0">
          {previews.length ? (
            [...previews].reverse().map((p, i) => <FolderNote key={i} note={p} index={previews.length - 1 - i} />)
          ) : (
            <div className="absolute left-[12%] top-[12%] h-[60%] w-[76%] rounded-[2.4cqw] bg-white/60" />
          )}
        </div>
        {/* frosted front cover */}
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0 top-[46%] rounded-[4cqw] shadow-[inset_0_1px_0_rgb(255_255_255/0.75),inset_0_0_0_1px_rgb(0_0_0/0.08),0_-6px_16px_-10px_rgb(0_0_0/0.25)] [-webkit-backdrop-filter:blur(9px)_saturate(1.3)] [backdrop-filter:blur(9px)_saturate(1.3)]"
          style={{ background: `linear-gradient(180deg, color-mix(in oklab, ${base} 62%, transparent), color-mix(in oklab, ${base} 86%, transparent))` }}
        />
        {/* page count */}
        <span
          aria-hidden
          className="absolute left-[7%] top-[51%] inline-flex items-center rounded-[1.4cqw] px-[2.2cqw] py-[1.3cqw] font-serif text-[clamp(12px,5.4cqw,22px)] font-semibold leading-none tabular-nums text-[#111114]"
          style={{ background: `color-mix(in oklab, ${base} 55%, #8e94a3)` }}
        >
          {f.documentCount.toLocaleString()}
        </span>
        {/* last update */}
        <span aria-hidden className="absolute right-[7%] top-[51.6%] -mt-[0.15em] max-w-[55%] truncate pb-[0.1em] font-serif text-[clamp(11px,5.6cqw,24px)] leading-[1.2]" style={{ color: `color-mix(in oklab, ${base} 25%, #3c4250)` }}>
          {shortAge(f.updatedAt)}
        </span>
        {/* name */}
        <span aria-hidden className="absolute bottom-[6.2%] left-[7%] right-[7%] line-clamp-2 break-words font-serif text-[clamp(16px,9.4cqw,40px)] leading-[1.12] tracking-[-0.01em] text-[#0d0d10]">
          {f.name}
        </span>
      </AppLink>
      <FolderMenu
        folder={f}
        trigger={<MoreHorizontal size={16} aria-hidden />}
        className="absolute left-1/2 top-[70%] z-10 -translate-x-1/2 -translate-y-1/2 rounded-[6px] bg-white/90 text-[#17171a] opacity-0 pointer-events-none shadow-[0_1px_3px_rgb(0_0_0/0.18)] transition-opacity focus-within:pointer-events-auto focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100 pointer-coarse:pointer-events-auto pointer-coarse:opacity-100 [&>div>button]:text-[#17171a]/75 [&>div>button:hover]:text-[#17171a]"
      />
    </div>
  );
}

/** Every folder in the current context (Personal or a workspace), with search and sorting (the sidebar only lists the first few). */
export function FoldersIndex() {
  const { scope, role } = useAppState();
  const data = useQuery(api.organization.index, { scope });
  const createFolder = useMutation(api.organization.createFolder);
  const { navigate } = useAppRouter();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [sort, setSort] = useLocalStorage<FolderSort>("folevi:folders-sort", "name");
  const [layout, setLayout] = useLocalStorage<"grid" | "list">("folevi:folders-layout", "grid");
  const [creating, setCreating] = useState(false);
  const canEdit = role !== "viewer" && role !== "commenter";

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
