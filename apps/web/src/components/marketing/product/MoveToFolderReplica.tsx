import { Check, ChevronDown, Inbox, LayoutGrid, List, PencilLine, Rows3, Search, X } from "lucide-react";
import { FolderGlyph } from "@/components/ui/FolderGlyph";
import { DEMO_DRAFT, DEMO_FOLDERS } from "../content/demoFolders";
import { cx } from "../ui";
import { ListTabs, MainSidebar, artById, artThumb } from "./Replica";

/*
 * An HTML replica of the app's Move to folder dialog (components/views/MoveToFolderDialog.tsx inside
 * components/ui/Dialog.tsx, size "sm") over the Drafts page, with the main sidebar beside it. The folders
 * and colours are the demo account's (content/demoFolders.ts), as in the Folders page screenshot.
 * Illustration only: nothing here is a control.
 */

/** The sidebar lists the first five folders, then "+N more" (components/app/Sidebar.tsx). */
const SIDEBAR_FOLDERS = 5;

const WELCOME = {
  title: "Welcome to Folevi",
  lines: [
    "Folevi is a quiet place for ideas that keep growing. Start with a loose thought, give it shape when you are ready, and find it again when you need it.",
    "Everything you type here is saved as you go.",
  ],
};

export function MoveToFolderReplica({ className }: { className?: string }) {
  const names = DEMO_FOLDERS.map((f) => f.name);
  const label = `The Move to folder dialog in Folevi, open over the Drafts page. It asks where “${DEMO_DRAFT.title}” should live, has a Search folders field, and lists No folder (Drafts), marked as current, then the folders ${names.slice(0, -1).join(", ")} and ${names.at(-1)}, each with its colour.`;
  return (
    <div role="img" aria-label={label} className={cx("mk-app", className)} style={{ ["--app-art" as string]: artThumb(artById("art-44")) }}>
      <div aria-hidden="true" className="mk-app-ambient" />
      <div aria-hidden="true" className="flex h-full gap-2 p-1.5 sm:p-2">
        <MainSidebar
          activeLabel="Drafts"
          folders={DEMO_FOLDERS.slice(0, SIDEBAR_FOLDERS).map((f) => ({ color: f.color, label: f.name }))}
          moreFolders={DEMO_FOLDERS.length - SIDEBAR_FOLDERS}
          sections
        />
        <div className="relative flex min-w-0 flex-1 flex-col gap-2">
          <ListTabs view="Drafts" />
          <div className="mk-app-content min-h-0 flex-1 overflow-hidden rounded-[12px] px-3 pt-3 sm:px-5 sm:pt-4">
            <div className="flex items-center gap-2.5">
              <p className="mr-auto text-[12px] text-muted">2 notes</p>
              <span className="hidden items-center gap-2 text-[12px] text-muted sm:flex">
                Sort
                <span className="flex h-7 items-center gap-1.5 rounded-[6px] bg-(--color-surface) px-2.5 text-ink shadow-[0_0_0_1px_var(--color-line)]">
                  Last edited <ChevronDown size={12} className="text-muted" />
                </span>
              </span>
              <span className="mk-app-well flex rounded-[6px] p-0.5">
                <span className="grid h-6 w-8 place-items-center rounded-[5px] bg-(--color-surface-raised) text-(--color-heading) shadow-[var(--shadow-control)]">
                  <LayoutGrid size={13} />
                </span>
                <span className="grid h-6 w-8 place-items-center text-muted">
                  <Rows3 size={13} />
                </span>
                <span className="grid h-6 w-8 place-items-center text-muted">
                  <List size={13} />
                </span>
              </span>
            </div>
            <ul className="mt-4 grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-[repeat(2,minmax(0,200px))]">
              <DraftCard title={DEMO_DRAFT.title} lines={DEMO_DRAFT.lines} when="Just now" />
              <DraftCard title={WELCOME.title} lines={WELCOME.lines} when="1 min ago" />
            </ul>
          </div>
          {/* Centred over the page below the tab strip (the app centres it in the window). */}
          <div className="absolute inset-x-0 bottom-0 top-[52px] grid place-items-center px-3">
            <Dialog />
          </div>
        </div>
      </div>
    </div>
  );
}

/** A note card on a list page (a plain note: no style, so a grey spine), with its Draft badge. */
function DraftCard({ title, lines, when }: { title: string; lines: readonly string[]; when: string }) {
  return (
    <li className="mk-note mk-notecard h-[216px] sm:h-[236px]" style={{ ["--note-art" as string]: "linear-gradient(var(--color-surface-sunken), var(--color-surface-sunken))" }}>
      <span className="mk-notecard-spine" />
      <div className="flex min-w-0 flex-col px-3 pb-3 pt-3.5 sm:px-4">
        <p className="mk-note-h text-[15px] leading-tight sm:text-[16px]">{title}</p>
        <p className="mk-note-muted mt-1 text-[11px]">{when}</p>
        <div className="mt-2.5 min-h-0 flex-1 space-y-1.5 overflow-hidden text-[10.5px] leading-[1.5]">
          {lines.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
        <p className="mt-2 flex items-center justify-between gap-2 text-[10.5px]">
          <span className="mk-note-muted">{when}</span>
          <span className="inline-flex items-center gap-1 rounded-[6px] bg-(--color-surface-sunken) px-1.5 font-medium leading-5 text-muted">
            <PencilLine size={10} /> Draft
          </span>
        </p>
      </div>
    </li>
  );
}

/** The dialog: Dialog.tsx (sm: 384 px, 14 px corners, glass) holding the folder picker's search and list. */
function Dialog() {
  return (
    <div className="mk-app-pop w-full max-w-[384px] rounded-[14px] shadow-[var(--glass-edge),0_16px_48px_rgb(0_0_0/0.1),0_2px_8px_rgb(0_0_0/0.1)]">
      <div className="flex items-start gap-3 px-5 pb-2 pt-5 sm:px-6">
        <div className="min-w-0 flex-1">
          <p className="mk-display text-[19px] leading-snug text-(--color-heading) sm:text-[21px]">Move to folder</p>
          <p className="mt-1 text-[13px] text-muted sm:text-[14px]">Choose where “{DEMO_DRAFT.title}” should live.</p>
        </div>
        <span className="-mr-1 grid size-8 flex-none place-items-center rounded-[6px] text-muted">
          <X size={16} />
        </span>
      </div>
      <div className="px-5 py-4 sm:px-6">
        <div className="relative flex h-10 items-center rounded-[6px] bg-(--color-surface) pl-8 text-[14px] text-faint shadow-[0_1px_3px_rgb(0_0_0/0.08),0_0_0_1.5px_color-mix(in_oklab,var(--color-heading)_16.5%,transparent)]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" />
          Search folders
        </div>
        <ul className="mt-3 max-h-[236px] space-y-0.5 overflow-hidden sm:max-h-[304px]">
          <li className="flex min-h-8 items-center gap-[0.6rem] rounded-[6px] bg-(--glass-hover) px-[0.6rem] text-[13.5px] text-(--color-heading) opacity-60">
            <Inbox size={15} className="flex-none text-muted" />
            <span className="min-w-0 flex-1 truncate">No folder (Drafts)</span>
            <span className="inline-flex items-center gap-1 text-[12px] text-muted">
              <Check size={13} strokeWidth={2.5} /> Current
            </span>
          </li>
          {DEMO_FOLDERS.map((folder) => (
            <li key={folder.name} className="flex min-h-8 items-center gap-[0.6rem] rounded-[6px] px-[0.6rem] text-[13.5px] text-ink">
              <FolderGlyph color={folder.color} size={17} />
              <span className="min-w-0 flex-1 truncate">{folder.name}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
