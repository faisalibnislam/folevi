import type { CSSProperties, ReactNode } from "react";
import {
  Archive,
  ArrowUp,
  ArrowUpRight,
  Asterisk,
  Bell,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  Ellipsis,
  FileText,
  Files,
  Folder,
  FolderPlus,
  House,
  Inbox,
  Info,
  LayoutList,
  LayoutTemplate,
  List,
  MessageSquare,
  Paintbrush,
  PanelLeft,
  Paperclip,
  Plus,
  Search,
  Share2,
  Star,
  Trash2,
  Type,
  X,
} from "lucide-react";
import { AiIcon } from "@/components/ai/AiIcon";
import { FoleviLogo } from "@/components/brand/FoleviMark";
import { FolderGlyph } from "@/components/ui/FolderGlyph";
import { COVER_ART, type CoverArt } from "@/lib/cover";
import { cx } from "../ui";

/*
 * HTML replicas of the app's own chrome (packages/design-tokens chrome + globals.css glass recipes): the
 * glass canvas lit by the open note's style, the page sidebar, the tab strip, the page tools dock and a
 * note coloured by its style. Illustrations only: nothing here is a control.
 */

export function artById(id: string): CoverArt {
  return COVER_ART.find((a) => a.id === id) ?? COVER_ART[0]!;
}

export const artThumb = (art: CoverArt) => `url("/covers/${art.id}-thumb.webp")`;
const artLarge = (art: CoverArt) => `image-set(url("/covers/${art.id}-thumb.webp") 1x, url("/covers/${art.id}-1x.webp") 2x)`;

/** CSS variables that colour a note like the editor does for a style (editor.css, data-sheet="art"). */
export function artVars(art: CoverArt, size: "thumb" | "large" = "thumb"): CSSProperties {
  const vars: Record<string, string> = {
    "--note-art": size === "large" ? artLarge(art) : artThumb(art),
    "--art-paper": art.paper,
    "--art-ink": art.ink,
    "--art-paper-dark": art.paperDark,
    "--art-ink-dark": art.inkDark,
  };
  if (art.accent) vars["--art-accent"] = art.accent;
  if (art.accentDark) vars["--art-accent-dark"] = art.accentDark;
  if (art.highlight?.[1]) vars["--art-hl"] = art.highlight[1];
  if (art.highlightDark?.[1]) vars["--art-hl-dark"] = art.highlightDark[1];
  if (art.highlight?.[0]) vars["--art-hl-2"] = art.highlight[0];
  if (art.highlightDark?.[0]) vars["--art-hl-2-dark"] = art.highlightDark[0];
  return vars as CSSProperties;
}

export type NoteBlock =
  | { kind: "p"; text: string }
  | { kind: "h"; text: string }
  | { kind: "todo"; text: string; done?: boolean; date?: string }
  | { kind: "callout"; text: string }
  | { kind: "page"; text: string };

export type NoteContent = { title: string; folder: string; blocks: NoteBlock[]; toc: string[] };

export const SEED_NOTE: NoteContent = {
  title: "Seed library",
  folder: "Projects",
  toc: ["Before swap day", "Planting calendar", "Notes from Ines"],
  blocks: [
    { kind: "p", text: "A small seed library in the old phone box on Alder Street. Ines has spare shelves, and the printer can do labels by Friday." },
    { kind: "callout", text: "Swap day is the first Saturday in April." },
    { kind: "h", text: "Before swap day" },
    { kind: "todo", text: "Ask Ines about the shelves", done: true },
    { kind: "todo", text: "Print seed labels", date: "Fri" },
    { kind: "todo", text: "Order glassine envelopes", date: "Mon" },
    { kind: "page", text: "Planting calendar" },
  ],
};

export const READING_NOTE: NoteContent = {
  title: "Reading list",
  folder: "Reading",
  toc: ["Now reading", "Up next", "Notes from the group"],
  blocks: [
    { kind: "p", text: "Books for the winter, and the library copies to return first." },
    { kind: "callout", text: "Library copies are due back on the 12th." },
    { kind: "h", text: "Now reading" },
    { kind: "todo", text: "The Overstory", done: true },
    { kind: "todo", text: "Braiding Sweetgrass", date: "12 Oct" },
    { kind: "todo", text: "A short history of the post", date: "Nov" },
    { kind: "page", text: "Notes from the reading group" },
  ],
};

/* The window --------------------------------------------------------------------------------------- */

export function AppWindow({
  art,
  note = SEED_NOTE,
  sidebar = "page",
  chrome = "web",
  active = "Style",
  className,
  label,
}: {
  art: CoverArt;
  note?: NoteContent;
  sidebar?: "page" | "main" | "none";
  chrome?: "web" | "mac";
  active?: DockItem;
  className?: string;
  /** Describes the illustration for assistive tech. */
  label: string;
}) {
  return (
    <div role="img" aria-label={label} className={cx("mk-app", className)} style={{ ["--app-art" as string]: artThumb(art) }}>
      <div aria-hidden="true" className="mk-app-ambient" />
      <div aria-hidden="true" className="flex h-full gap-2 p-1.5 sm:p-2">
        {sidebar === "page" ? <PageSidebar note={note} chrome={chrome} /> : sidebar === "main" ? <MainSidebar chrome={chrome} /> : null}
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <TabStrip title={note.title} chrome={sidebar === "none" ? chrome : "web"} />
          <div className="mk-note-page min-h-0 flex-1 px-2 pt-3 sm:px-6 sm:pt-5" style={artVars(art, "large")}>
            <NoteSheet art={art} note={note} />
            <Dock active={active} />
          </div>
        </div>
      </div>
    </div>
  );
}

function TrafficLights() {
  return (
    <span className="mk-lights flex gap-2 px-1.5">
      <span />
      <span />
      <span />
    </span>
  );
}

function SidebarTop({ chrome }: { chrome: "web" | "mac" }) {
  return (
    <div className="flex h-10 flex-none items-center gap-1 px-2">
      {chrome === "mac" ? <TrafficLights /> : <FoleviLogo height={22} title={null} className="flex-none text-(--color-heading)" />}
      <span className="flex-1" />
      <span className="grid size-7 place-items-center text-muted">
        <Bell size={15} />
      </span>
      <span className="grid size-7 place-items-center text-muted">
        <PanelLeft size={15} />
      </span>
    </div>
  );
}

function Account() {
  return (
    <div className="mt-auto flex flex-none items-center gap-2.5 px-2 pb-1 pt-2">
      <span className="grid size-7 flex-none place-items-center rounded-full bg-(--color-heading) text-[11px] font-semibold text-(--color-canvas)">A</span>
      <span className="min-w-0 flex-1 leading-tight">
        <span className="block truncate text-[12.5px] font-semibold text-(--color-heading)">Ada Example</span>
        <span className="block truncate text-[11px] text-muted">Personal</span>
      </span>
    </div>
  );
}

/** The page sidebar the app shows while a note is open: the note, its tools and its outline. */
export function PageSidebar({ note, chrome = "web" }: { note: NoteContent; chrome?: "web" | "mac" }) {
  const tools = [List, CircleCheck, Paperclip, Search];
  return (
    <div className="hidden w-[208px] flex-none flex-col md:flex lg:w-[224px]">
      <SidebarTop chrome={chrome} />
      <div className="mk-app-glass mx-1 mt-1 rounded-[8px] px-3 py-2.5">
        <p className="truncate text-[13px] font-semibold text-(--color-heading)">{note.title}</p>
        <p className="mt-0.5 truncate text-[11px] text-muted">In {note.folder}</p>
      </div>
      <div className="mk-app-well mx-1 mt-2.5 flex gap-0.5 rounded-[6px] p-[3px]">
        {tools.map((Tool, i) => (
          <span key={i} className={cx("grid h-7 flex-1 place-items-center rounded-[4px] text-muted", i === 0 && "mk-app-row-on")}>
            <Tool size={14} />
          </span>
        ))}
      </div>
      <p className="mt-4 px-3 text-[12.5px] font-semibold text-(--color-heading)">Table of contents</p>
      <ul className="mt-1.5 space-y-0.5 px-1">
        <li className="mk-app-row-on flex h-8 items-center rounded-[6px] px-2.5 text-[12.5px]">{note.title}</li>
        {note.toc.map((item, i) => (
          <li key={item} className="relative flex h-8 items-center rounded-[6px] pl-5 pr-2 text-[12.5px] text-muted">
            {i === 0 ? <span className="absolute inset-y-1.5 left-0.5 w-[2px] rounded-full bg-(--color-heading)" /> : null}
            <span className={cx("truncate", i === 0 && "text-ink")}>{item}</span>
          </li>
        ))}
      </ul>
      <Account />
    </div>
  );
}

const DEFAULT_FOLDERS = [
  { color: "irises", label: "Projects" },
  { color: "poppy-print", label: "Reading" },
  { color: "harbor-blue", label: "Studio" },
];

/**
 * The main sidebar (Home and the lists), as in the app. `folders` replaces the sample folders; with
 * `sections`, the Folders and Tags headings have the app's chevrons and new-folder button, and `moreFolders`
 * adds the "+N more" row the app shows after its first five folders.
 */
export function MainSidebar({
  chrome = "web",
  activeLabel = "Home",
  folders = DEFAULT_FOLDERS,
  moreFolders = 0,
  sections = false,
}: {
  chrome?: "web" | "mac";
  activeLabel?: string;
  folders?: Array<{ color: string; label: string }>;
  moreFolders?: number;
  sections?: boolean;
}) {
  const rows = [
    { icon: House, label: "Home" },
    { icon: Star, label: "Starred" },
    { icon: Inbox, label: "Drafts", count: 2 },
    { icon: Files, label: "All notes" },
    { icon: CheckSquare, label: "Tasks", count: 3 },
    { icon: Share2, label: "Shared with Me" },
    { icon: LayoutTemplate, label: "Templates" },
  ];
  return (
    <div className="hidden w-[208px] flex-none flex-col md:flex lg:w-[224px]">
      <SidebarTop chrome={chrome} />
      <div className="mk-app-well mx-1 mt-1 flex h-8 items-center gap-2 rounded-[6px] pl-2.5 pr-1.5 text-[12px] text-muted">
        <Search size={13} />
        <span className="flex-1 truncate">Search or jump to…</span>
        <span className="rounded-[5px] bg-(--color-surface-raised) px-1 text-[10px] font-semibold leading-[18px] shadow-[0_0_0_1px_var(--color-line)]">⌘K</span>
      </div>
      <ul className="mt-3 space-y-0.5 px-1">
        {rows.map(({ icon: RowIcon, label, count }) => (
          <li key={label} className={cx("flex h-8 items-center gap-2.5 rounded-[6px] px-2.5 text-[12.5px]", label === activeLabel ? "mk-app-row-on" : "text-ink")}>
            <RowIcon size={15} className={label === activeLabel ? "text-(--color-heading)" : "text-muted"} />
            <span className="flex-1 truncate">{label}</span>
            {count ? <span className="min-w-5 rounded-[6px] bg-(--glass-hover) px-1.5 text-center text-[10.5px] font-semibold leading-5 text-muted">{count}</span> : null}
          </li>
        ))}
      </ul>
      {sections ? (
        <p className="mk-caps mt-4 flex items-center gap-1.5 px-2.5 text-[10.5px]">
          <ChevronDown size={11} />
          <span className={cx("-my-1 flex-1 rounded-[6px] px-1.5 py-1", activeLabel === "Folders" && "bg-(--glass-hover) text-(--color-heading)")}>Folders</span>
          <FolderPlus size={13} className="text-muted" />
        </p>
      ) : (
        <p className="mk-caps mt-4 px-3.5 text-[10.5px]">Folders</p>
      )}
      <ul className="mt-1 space-y-0.5 px-1">
        {folders.map((folder) => (
          <li key={folder.label} className="flex h-8 items-center gap-2.5 rounded-[6px] px-2.5 pl-4 text-[12.5px] text-ink">
            <FolderGlyph color={folder.color} size={16} />
            <span className="truncate">{folder.label}</span>
          </li>
        ))}
        {moreFolders ? <li className="flex h-7 items-center px-2.5 pl-4 text-[11.5px] text-muted">+{moreFolders} more</li> : null}
      </ul>
      {sections ? (
        <p className="mk-caps mt-4 flex items-center gap-1.5 px-2.5 text-[10.5px]">
          <ChevronRight size={11} />
          Tags
        </p>
      ) : null}
      <ul className="mt-4 space-y-0.5 px-1">
        <li className="flex h-8 items-center gap-2.5 rounded-[6px] px-2.5 text-[12.5px] text-ink">
          <Archive size={15} className="text-muted" /> Archive
        </li>
        <li className="flex h-8 items-center gap-2.5 rounded-[6px] px-2.5 text-[12.5px] text-ink">
          <Trash2 size={15} className="text-muted" /> Trash
        </li>
      </ul>
      <Account />
    </div>
  );
}

/** The tab strip across the top: Up, Home, one tab per open page, and New note. */
export function TabStrip({ title, chrome = "web" }: { title: string; chrome?: "web" | "mac" }) {
  return (
    <div className="mk-app-glass flex h-11 flex-none items-center gap-1.5 rounded-[12px] px-1.5">
      {chrome === "mac" ? <TrafficLights /> : null}
      <span className="grid size-8 flex-none place-items-center text-muted md:hidden">
        <PanelLeft size={15} />
      </span>
      <span className="hidden size-8 flex-none place-items-center text-muted md:grid">
        <ArrowUp size={15} />
      </span>
      <span className="h-5 w-px flex-none bg-(--color-line-strong) opacity-60" />
      <span className="mk-app-tab hidden flex-none sm:flex">
        <House size={13} /> Home
      </span>
      <span className="mk-app-tab min-w-0 flex-[0_1_220px]" data-on="true">
        <FileText size={13} className="flex-none opacity-70" />
        <span className="min-w-0 flex-1 truncate">{title}</span>
        <X size={11} className="flex-none text-faint" />
      </span>
      <span className="mk-app-tab hidden min-w-0 flex-[0_1_180px] lg:flex">
        <FileText size={13} className="flex-none opacity-70" />
        <span className="truncate">Reading list</span>
      </span>
      <span className="flex-1" />
      <span className="mk-btn mk-btn-primary h-8 flex-none gap-1.5 px-2.5 text-[12.5px] sm:px-3">
        <Plus size={14} />
        <span className="hidden sm:inline">New note</span>
      </span>
    </div>
  );
}

/** The tab strip while a list is open (Drafts, or the Folders page): a list view shows as the current tab. */
export function ListTabs({ view }: { view: "Drafts" | "Folders" }) {
  return (
    <div className="mk-app-glass flex h-11 flex-none items-center gap-1.5 rounded-[12px] px-1.5">
      <span className="grid size-8 flex-none place-items-center text-muted md:hidden">
        <PanelLeft size={15} />
      </span>
      <span className="hidden size-8 flex-none place-items-center text-muted md:grid">
        <ArrowUp size={15} />
      </span>
      <span className="h-5 w-px flex-none bg-(--color-line-strong) opacity-60" />
      <span className="mk-app-tab hidden flex-none sm:flex">
        <House size={13} /> Home
      </span>
      <span className="mk-app-tab flex-none" data-on="true">
        {view === "Folders" ? <Folder size={13} className="opacity-70" /> : <LayoutList size={13} className="opacity-70" />} {view}
      </span>
      <span className="mk-app-tab hidden min-w-0 flex-[0_1_170px] xl:flex">
        <FileText size={13} className="flex-none opacity-70" />
        <span className="truncate">Lisbon in April</span>
      </span>
      <span className="flex-1" />
      <span className="mk-btn mk-btn-primary h-8 flex-none gap-1.5 px-2.5 text-[12.5px] sm:px-3">
        <Plus size={14} />
        <span className="hidden sm:inline">New note</span>
      </span>
    </div>
  );
}

export type DockItem = "AI" | "Insert" | "Format" | "Style" | "Info" | null;

/** The page tools dock that floats at the bottom of a note. */
export function Dock({ active }: { active: DockItem }) {
  const items: Array<{ label: Exclude<DockItem, null>; icon: ReactNode }> = [
    { label: "AI", icon: <AiIcon size={14} /> },
    { label: "Insert", icon: <Plus size={14} /> },
    { label: "Format", icon: <Type size={14} /> },
    { label: "Style", icon: <Paintbrush size={14} /> },
    { label: "Info", icon: <Info size={14} /> },
  ];
  return (
    <div className="mk-app-pop mk-app-dock absolute bottom-2.5 left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-[12px] p-1 sm:bottom-4">
      {items.map((item) => (
        <span
          key={item.label}
          className={cx(
            "flex h-8 items-center gap-1.5 rounded-[8px] px-2.5 text-[12.5px] font-medium",
            item.label === active ? "mk-app-dock-on" : "text-ink",
            item.label !== active && (item.label === "Format" || item.label === "Info") && "hidden sm:flex",
          )}
        >
          {item.icon}
          <span className={cx(item.label !== active && "hidden sm:inline")}>{item.label}</span>
        </span>
      ))}
      <span className="mx-1 hidden h-5 w-px bg-(--color-line-strong) opacity-60 sm:block" />
      <span className="hidden size-8 place-items-center text-ink sm:grid">
        <MessageSquare size={14} />
      </span>
      <span className="hidden size-8 place-items-center text-ink sm:grid">
        <Share2 size={14} />
      </span>
      <span className="grid size-8 place-items-center text-ink">
        <Ellipsis size={14} />
      </span>
    </div>
  );
}

/* The note ---------------------------------------------------------------------------------------- */

export function NoteSheet({ art, note, className }: { art: CoverArt; note: NoteContent; className?: string }) {
  return (
    <article className={cx("mk-note mx-auto h-[calc(100%+16px)] max-w-[720px] overflow-hidden", className)} style={artVars(art, "large")}>
      <header className="mk-note-cover flex min-h-[112px] items-end px-5 pb-4 pt-10 sm:min-h-[150px] sm:px-12 sm:pb-5" data-tone={art.tone}>
        <p className="mk-note-title text-[27px] sm:text-[38px]">{note.title}</p>
      </header>
      <div className="space-y-2.5 px-5 pb-24 pt-5 text-[13.5px] leading-[1.6] sm:px-12 sm:text-[14.5px]" style={{ fontFamily: "var(--font-serif)" }}>
        {note.blocks.map((block, i) => (
          <NoteBlockView key={i} block={block} />
        ))}
      </div>
    </article>
  );
}

function NoteBlockView({ block }: { block: NoteBlock }) {
  switch (block.kind) {
    case "h":
      return <p className="mk-note-h pt-2 text-[18px] sm:text-[20px]">{block.text}</p>;
    case "callout":
      return (
        <p className="mk-note-callout flex gap-2.5 px-3.5 py-2.5">
          <Asterisk size={15} className="mk-note-accent mt-[3px] flex-none" />
          <span>{block.text}</span>
        </p>
      );
    case "todo":
      return (
        <p className="flex items-center gap-2.5">
          <span className="mk-check" data-checked={block.done ? "true" : undefined}>
            {block.done ? <CheckMark /> : null}
          </span>
          <span className={cx("min-w-0 flex-1", block.done && "mk-note-muted line-through")}>{block.text}</span>
          {block.date ? <span className="mk-note-chip rounded-[5px] px-1.5 font-sans text-[11px] font-medium leading-5">{block.date}</span> : null}
        </p>
      );
    case "page":
      return (
        <p className="flex items-center gap-1.5">
          <ArrowUpRight size={14} className="mk-note-accent flex-none" />
          <span className="mk-note-accent underline underline-offset-[3px]">{block.text}</span>
        </p>
      );
    default:
      return <p>{block.text}</p>;
  }
}

export function CheckMark({ size = 11 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="m2.5 6.2 2.3 2.3 4.7-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* Note cards (Home) ------------------------------------------------------------------------------ */

export function NoteCard({ art, title, lines, folder, when = "Just now" }: { art: CoverArt; title: string; lines: string[]; folder: string; when?: string }) {
  return (
    <div className="mk-note mk-notecard h-full" style={artVars(art)}>
      <span aria-hidden="true" className="mk-notecard-spine" />
      <div className="flex min-w-0 flex-col px-4 pb-3.5 pt-4">
        <p className="mk-note-h text-[18px] leading-tight">{title}</p>
        <p className="mk-note-muted mt-1 text-[12px]">{when}</p>
        <div className="mt-3 flex-1 space-y-2 text-[12.5px] leading-[1.5]">
          {lines.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
        <p className="mt-4 flex items-center justify-between gap-2 text-[11.5px]">
          <span className="mk-note-muted">{art.name}</span>
          <span className="mk-note-chip rounded-[5px] px-1.5 font-medium leading-5">{folder}</span>
        </p>
      </div>
    </div>
  );
}
