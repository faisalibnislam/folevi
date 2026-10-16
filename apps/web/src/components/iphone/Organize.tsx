"use client";

import { FolderOpen, FolderPlus, Hash, LayoutGrid, List } from "lucide-react";
import { AppLink } from "@/lib/app/router";
import { useLocalStorage } from "@/lib/hooks/useEngine";
import type { MenuEntry } from "@/components/ui/Menu";
import { FolderGlyph } from "@/components/ui/FolderGlyph";
import { EmptyState } from "@/components/ui/EmptyState";
import { ViewChrome } from "@/components/app/Shell";
import { FolderMenu } from "@/components/app/FolderMenu";
import { GlassPill } from "./Glass";
import { MoreMenu } from "./RootBar";
import { ListRow, SearchField } from "./Rows";
import { useIphoneActions } from "./IphoneShell";

const notes = (n: number) => (n === 1 ? "1 note" : `${n.toLocaleString()} notes`);

interface FolderItem {
  id: string;
  name: string;
  color: string | null;
  parentFolderId: string | null;
  updatedAt: number;
  documentCount: number;
}

/**
 * Every folder in the iPhone app: a large title, search, and the folders as tiles (their colour, name and
 * how many notes) or as rows; a folder's long press opens its menu.
 */
export function IphoneFolders<S extends string>({
  folders,
  total,
  query,
  onQuery,
  where,
  sort,
  sorts,
  onSort,
  canEdit,
}: {
  folders: FolderItem[] | undefined;
  total: number;
  query: string;
  onQuery: (q: string) => void;
  /** Where a nested folder is ("Work / Clients"). */
  where: Map<string, string>;
  sort: S;
  sorts: [S, string][];
  onSort: (s: S) => void;
  canEdit: boolean;
}) {
  const [layout, setLayout] = useLocalStorage<"tiles" | "list">("folevi:iphone-folders-layout", "tiles");
  const { openNewFolder } = useIphoneActions();
  const menu: MenuEntry[] = [
    ...(canEdit ? ([{ label: "New folder", icon: <FolderPlus size={18} />, onSelect: openNewFolder }, "separator"] as MenuEntry[]) : []),
    { heading: "View as" },
    { label: "Tiles", icon: <LayoutGrid size={18} />, checked: layout === "tiles", onSelect: () => setLayout("tiles") },
    { label: "List", icon: <List size={18} />, checked: layout === "list", onSelect: () => setLayout("list") },
    "separator",
    { heading: "Sort by" },
    ...sorts.map(([s, label]) => ({ label, checked: sort === s, onSelect: () => onSort(s) })),
  ];
  return (
    <ViewChrome
      title="Folders"
      tabTitle="Folders"
      iphone={{
        title: "Folders",
        trailing: (
          <GlassPill>
            <MoreMenu items={menu} label="Folders options" />
          </GlassPill>
        ),
        header: <SearchField placeholder="Search" value={query} onChange={onQuery} />,
      }}
    >
      <p role="status" className="sr-only">
        {folders === undefined ? "Loading" : `${folders.length} of ${total} folders`}
      </p>
      {folders && !folders.length ? (
        <EmptyState icon={FolderOpen} title={query.trim() ? `No folders match “${query.trim()}”` : "No folders yet"} body={query.trim() ? undefined : "Folders keep related notes together."} />
      ) : layout === "tiles" ? (
        <ul className="grid grid-cols-2 gap-3 px-4 pt-3 [@media(orientation:landscape)]:grid-cols-4" aria-label="Folders">
          {(folders ?? []).map((f) => (
            <li key={f.id} className="relative">
              <AppLink
                href={`/folders/${f.id}`}
                aria-label={`${f.name}${where.get(f.id) ? `, in ${where.get(f.id)}` : ""}, ${notes(f.documentCount)}`}
                className="flex min-h-[124px] flex-col items-center justify-center gap-1 rounded-container bg-[color-mix(in_oklab,var(--color-ink)_4.5%,transparent)] px-3 py-4 text-center outline-none transition-transform active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-focus"
              >
                <FolderGlyph color={f.color} size={34} />
                <span className="mt-2 line-clamp-2 text-[16px] font-semibold leading-tight text-heading">{f.name}</span>
                <span className="text-[13px] text-muted">{notes(f.documentCount)}</span>
              </AppLink>
              {canEdit ? <FolderMenu folder={f} className="absolute right-1 top-1 opacity-70" /> : null}
            </li>
          ))}
        </ul>
      ) : (
        <ul className="pt-2" aria-label="Folders">
          {(folders ?? []).map((f) => (
            <li key={f.id}>
              <ListRow href={`/folders/${f.id}`} icon={<FolderGlyph color={f.color} size={22} />} label={f.name} detail={f.documentCount} />
            </li>
          ))}
        </ul>
      )}
    </ViewChrome>
  );
}

/** Every tag in the iPhone app, as rows with how many notes carry each. */
export function IphoneTags<S extends string>({ tags, query, onQuery, sort, sorts, onSort }: { tags: { id: string; name: string; color: string; documentCount: number }[] | undefined; query: string; onQuery: (q: string) => void; sort: S; sorts: [S, string][]; onSort: (s: S) => void }) {
  const menu: MenuEntry[] = [{ heading: "Sort by" }, ...sorts.map(([s, label]) => ({ label, checked: sort === s, onSelect: () => onSort(s) }))];
  return (
    <ViewChrome
      title="Tags"
      tabTitle="Tags"
      iphone={{
        title: "Tags",
        trailing: (
          <GlassPill>
            <MoreMenu items={menu} label="Tags options" />
          </GlassPill>
        ),
        header: <SearchField placeholder="Search" value={query} onChange={onQuery} />,
      }}
    >
      {tags && !tags.length ? (
        <EmptyState icon={Hash} title={query.trim() ? `No tags match “${query.trim()}”` : "No tags yet"} body={query.trim() ? undefined : "Add tags to a note from its Info panel."} />
      ) : (
        <ul className="pt-2" aria-label="Tags">
          {(tags ?? []).map((t) => (
            <li key={t.id}>
              <ListRow href={`/tags/${t.id}`} icon={<Hash style={{ color: `var(--color-${t.color === "muted" ? "ink-muted" : t.color})` }} />} label={t.name} detail={t.documentCount} />
            </li>
          ))}
        </ul>
      )}
    </ViewChrome>
  );
}
