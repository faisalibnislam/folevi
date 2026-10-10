import type { DocumentCover } from "@folevi/editor-schema";
import { ChevronDown, FolderPlus, LayoutGrid, Rows3, Search } from "lucide-react";
import { FOLDER_CARD_BOX, FOLDER_CARD_FRAME, FOLDER_CARD_MENU, FolderCardArt, FolderCardMenuLook, type FolderPreview } from "@/components/views/FolderCardArt";
import { COVER_ART } from "@/lib/cover";
import { DEMO_FOLDERS, type DemoFolder, type DemoNote } from "../content/demoFolders";
import { cx } from "../ui";
import { ListTabs, MainSidebar, artById, artThumb } from "./Replica";

/*
 * An HTML replica of the app's Folders page (components/views/OrganizeIndex.tsx, FoldersIndex, grid
 * layout, sorted by name) with the main sidebar. The folder cards are the app's own drawing
 * (views/FolderCardArt.tsx), so they look and move as in the app: hover one and it lifts, its notes rise
 * out of the folder and the "…" menu appears. Nothing here is a control: the picture is one image for
 * assistive tech, and pointer hover is the only thing it responds to.
 */

/** The sidebar lists the first five folders, then "+N more" (components/app/Sidebar.tsx). */
const SIDEBAR_FOLDERS = 5;

const coverFor = (style: string | undefined): DocumentCover => {
  const art = style ? COVER_ART.find((a) => a.name === style) : undefined;
  return art ? { kind: "art", value: art.id } : { kind: "none" };
};

/** The newest three notes, newest first (the order FolderCard gets them in). */
const previewsOf = (notes: DemoNote[]): FolderPreview[] =>
  notes
    .slice(-3)
    .reverse()
    .map((n) => ({ cover: coverFor(n.style), title: n.title, excerpt: `${n.lines[0]} ${n.lines[1]}` }));

/** One demo folder drawn as the app's folder card: it lifts on hover and its newest notes rise out of it. */
export function DemoFolderCard({ folder }: { folder: DemoFolder }) {
  return (
    <div className={FOLDER_CARD_BOX}>
      <div className={FOLDER_CARD_FRAME}>
        <FolderCardArt name={folder.name} color={folder.color} count={folder.notes.length} age={folder.age} previews={previewsOf(folder.notes)} />
      </div>
      <span className={FOLDER_CARD_MENU}>
        <FolderCardMenuLook />
      </span>
    </div>
  );
}

export function FoldersPageReplica({ className }: { className?: string }) {
  const folders = [...DEMO_FOLDERS].sort((a, b) => a.name.localeCompare(b.name));
  const names = folders.map((f) => f.name);
  const label = `The Folders page in Folevi. ${folders.length} folders are shown as cards, each in its own colour: ${names.slice(0, -1).join(", ")} and ${names.at(-1)}. Each card shows how many notes the folder holds, when it last changed, and its newest notes showing through the front cover. The sidebar lists the first five folders and ${folders.length - SIDEBAR_FOLDERS} more.`;
  return (
    <div role="img" aria-label={label} className={cx("mk-app", className)} style={{ ["--app-art" as string]: artThumb(artById("art-44")) }}>
      <div aria-hidden="true" className="mk-app-ambient" />
      <div aria-hidden="true" className="flex h-full gap-2 p-1.5 sm:p-2">
        <MainSidebar
          activeLabel="Folders"
          folders={DEMO_FOLDERS.slice(0, SIDEBAR_FOLDERS).map((f) => ({ color: f.color, label: f.name }))}
          moreFolders={DEMO_FOLDERS.length - SIDEBAR_FOLDERS}
          sections
        />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <ListTabs view="Folders" />
          <div className="mk-app-content min-h-0 flex-1 rounded-[14px] px-3 pb-6 pt-3 sm:px-6 sm:pb-8 sm:pt-4">
            <div className="flex justify-end">
              <span className="mk-btn mk-btn-primary h-8 gap-1.5 px-3 text-[12.5px]">
                <FolderPlus size={14} /> New folder
              </span>
            </div>
            <div className="mt-3 flex items-center gap-2.5">
              <span className="relative flex h-8 min-w-0 flex-1 items-center rounded-[6px] bg-(--color-surface) pl-7 text-[12.5px] text-faint shadow-[inset_0_1px_2px_color-mix(in_oklab,var(--color-heading)_8%,transparent),0_0_0_1px_var(--color-line)] sm:max-w-[300px]">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" />
                <span className="truncate">Search folders</span>
              </span>
              <span className="hidden flex-none text-[12px] text-muted sm:inline">{folders.length} folders</span>
              <span className="hidden flex-1 sm:block" />
              <span className="hidden items-center gap-2 text-[12px] text-muted md:flex">
                Sort
                <span className="flex h-8 items-center gap-1.5 rounded-[6px] bg-(--color-surface) px-2.5 text-ink shadow-[0_0_0_1px_var(--color-line)]">
                  Name <ChevronDown size={12} className="text-muted" />
                </span>
              </span>
              <span className="mk-app-well flex flex-none rounded-[10px] p-1">
                <span className="grid h-7 w-8 place-items-center rounded-[4px] bg-(--color-surface-raised) text-(--color-heading) shadow-[var(--shadow-control)]">
                  <LayoutGrid size={14} />
                </span>
                <span className="grid h-7 w-8 place-items-center text-muted">
                  <Rows3 size={14} />
                </span>
              </span>
            </div>
            <ul className="mt-5 grid grid-cols-2 gap-x-4 gap-y-6 sm:mt-6 sm:grid-cols-3 sm:gap-x-6 sm:gap-y-8 lg:grid-cols-4 lg:gap-x-8 lg:gap-y-10">
              {folders.map((folder, i) => (
                // Phones show the first six folders.
                <li key={folder.name} className={cx(i >= 6 && "hidden sm:block")}>
                  <DemoFolderCard folder={folder} />
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
