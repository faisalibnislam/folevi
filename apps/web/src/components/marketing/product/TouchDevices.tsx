import type { CSSProperties, ReactNode } from "react";
import { CalendarDays, ChevronLeft, Ellipsis, FileText, Files, Funnel, House, Inbox, LayoutGrid, LayoutList, PanelLeft, Plus, Search, SquareCheckBig, X } from "lucide-react";
import { FolderGlyph } from "@/components/ui/FolderGlyph";
import { artById, artThumb, artVars } from "./Replica";
import { cx } from "../ui";

/*
 * Folevi for iPad and iPhone as they look since 1.5.50, drawn from the site's own pieces (no screenshots, so they
 * follow the page's theme). The iPad has the Mac's layout: the sidebar on the translucent material, tabs along the
 * top with floating glass controls, and the list in its card, with Filter notes (1.5.52). The iPhone is native
 * iOS 26: a large system-font title, the Filter notes field (1.5.51) and the Liquid Glass tab bar with Search in a
 * circle of its own (PhoneFrameView.swift). Each is drawn larger and scaled down into the picture. Illustrations
 * only: nothing here is a control.
 */

const SYSTEM_FONT = "-apple-system, 'SF Pro Text', system-ui, sans-serif";

/** A fixed-size drawing scaled into its box (from its top left). */
function Scaled({ width, height, scale, children }: { width: number; height: number; scale: number; children: ReactNode }) {
  return (
    <div className="relative flex-none" style={{ width: width * scale, height: height * scale }}>
      <div className="absolute left-0 top-0 origin-top-left" style={{ width, height, transform: `scale(${scale})` }}>
        {children}
      </div>
    </div>
  );
}

const NOTES = [
  { art: "art-30", title: "Trip sketch", line: "A long weekend on the coast.", when: "1 hour ago", folder: "Trips", color: "blue" },
  { art: "art-39", title: "Studio move", line: "Boxes for the plan chest and the lamp.", when: "2 hours ago", folder: "Studio", color: "coral" },
  { art: "art-03", title: "Seed library", line: "Swap day is the first Saturday in April.", when: "Yesterday", folder: "Projects", color: "irises" },
  { art: "art-30", title: "Ferry times", line: "The 8:40 from the north pier.", when: "Yesterday", folder: "Trips", color: "blue" },
  { art: "art-39", title: "Lamp parts", line: "A new cord and a brass switch.", when: "Nov 3", folder: "Studio", color: "coral" },
  { art: "art-03", title: "Reading list", line: "Books for the winter.", when: "Nov 1", folder: "Projects", color: "irises" },
];

/** The filter field every note list has: the funnel and "Filter notes", always in sight. */
function FilterNotes({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <span className={cx("flex items-center gap-2", className)} style={style}>
      <Funnel size={15} strokeWidth={2} aria-hidden="true" className="flex-none opacity-70" />
      <span className="truncate">Filter notes</span>
    </span>
  );
}

/* The iPad -------------------------------------------------------------------------------------- */

const PAD_W = 760;
const PAD_H = 540;

function PadSidebar() {
  const rows = [
    { icon: House, label: "Home" },
    { icon: Files, label: "All notes", on: true },
    { icon: Inbox, label: "Drafts", count: 2 },
    { icon: SquareCheckBig, label: "Tasks", count: 3 },
    { icon: CalendarDays, label: "Calendar" },
  ];
  return (
    <div className="mk-app-glass flex w-[188px] flex-none flex-col rounded-container px-2 pb-3 pt-3">
      <ul className="space-y-1">
        {rows.map(({ icon: Icon, label, on, count }) => (
          <li key={label} className={cx("flex h-10 items-center gap-3 rounded-control px-3 text-[15px]", on ? "mk-app-row-on" : "text-ink")}>
            <Icon size={18} className={on ? "text-(--color-heading)" : "text-muted"} aria-hidden="true" />
            <span className="flex-1 truncate">{label}</span>
            {count ? <span className="text-[13px] font-semibold text-muted">{count}</span> : null}
          </li>
        ))}
      </ul>
      <p className="mt-5 px-3 text-[13px] font-semibold text-muted">Folders</p>
      <ul className="mt-1.5 space-y-1">
        {[
          { color: "blue", label: "Trips" },
          { color: "coral", label: "Studio" },
          { color: "irises", label: "Projects" },
        ].map((f) => (
          <li key={f.label} className="flex h-10 items-center gap-3 rounded-control px-3 text-[15px] text-ink">
            <FolderGlyph color={f.color} size={19} />
            <span className="truncate">{f.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PadTabs() {
  return (
    <div className="flex h-12 flex-none items-center gap-2">
      <span className="mk-app-glass grid size-12 flex-none place-items-center rounded-capsule text-muted">
        <PanelLeft size={19} aria-hidden="true" />
      </span>
      <span className="mk-app-glass flex h-12 min-w-0 flex-1 items-center gap-1.5 rounded-capsule p-1.5">
        <span className="mk-app-tab h-9! rounded-capsule! text-[14px]!">
          <House size={15} aria-hidden="true" /> Home
        </span>
        <span className="mk-app-tab h-9! rounded-capsule! text-[14px]!" data-on="true">
          <Files size={15} aria-hidden="true" /> All notes
        </span>
        <span className="mk-app-tab h-9! min-w-0 rounded-capsule! text-[14px]!">
          <FileText size={15} className="flex-none opacity-70" aria-hidden="true" />
          <span className="truncate">Trip sketch</span>
          <X size={12} className="flex-none text-faint" aria-hidden="true" />
        </span>
      </span>
      <span className="grid size-12 flex-none place-items-center rounded-capsule bg-(--color-heading) text-(--color-canvas) shadow-[var(--shadow-raised)]">
        <Plus size={20} strokeWidth={2.4} aria-hidden="true" />
      </span>
    </div>
  );
}

function PadCard({ note }: { note: (typeof NOTES)[number] }) {
  const art = artById(note.art);
  return (
    <div className="mk-note mk-notecard h-[150px]" style={artVars(art)}>
      <span className="mk-notecard-spine" />
      <div className="flex min-w-0 flex-col px-3.5 pb-3 pt-3.5">
        <p className="mk-note-h truncate text-[17px] leading-tight">{note.title}</p>
        <p className="mk-note-muted mt-0.5 text-[11px]">{note.when}</p>
        <p className="mt-2.5 line-clamp-2 flex-1 text-[12px] leading-[1.45]">{note.line}</p>
        <p className="flex justify-end">
          <span className="mk-note-chip rounded-tiny px-1.5 text-[11px] font-medium leading-5">{note.folder}</span>
        </p>
      </div>
    </div>
  );
}

export function IpadPicture() {
  return (
    <div className="rounded-float bg-[#111113] p-[14px] shadow-[0_0_0_1px_rgb(255_255_255/0.08)_inset,var(--shadow-overlay)]" style={{ width: PAD_W, height: PAD_H }}>
      <div className="mk-app flex h-full flex-col rounded-sheet! shadow-none!" style={{ ["--app-art" as string]: artThumb(artById("art-30")), fontFamily: SYSTEM_FONT }}>
        <div className="mk-app-ambient" />
        <div className="flex h-7 flex-none items-center justify-between px-6 pt-1 text-[12px] font-semibold text-(--color-heading)">
          <span>9:41</span>
          <span className="h-[11px] w-[22px] rounded-tiny border border-current opacity-70" />
        </div>
        <div className="flex min-h-0 flex-1 gap-2.5 px-2.5 pb-2.5">
          <PadSidebar />
          <div className="flex min-w-0 flex-1 flex-col gap-2.5">
            <PadTabs />
            <div className="mk-app-content flex min-h-0 flex-1 flex-col overflow-hidden rounded-container px-4 pt-4">
              <div className="flex items-center gap-2.5 text-[13px]">
                <span className="flex-1 text-muted">6 notes</span>
                <FilterNotes className="h-9 w-[200px] rounded-control bg-(--color-surface-raised) px-3 text-faint shadow-[inset_0_0_0_1px_var(--color-line)]" />
                <span className="mk-app-well flex h-9 items-center gap-0.5 rounded-control p-1 text-muted">
                  <span className="mk-app-row-on grid h-7 w-8 place-items-center rounded-small">
                    <LayoutGrid size={15} aria-hidden="true" />
                  </span>
                  <span className="grid h-7 w-8 place-items-center">
                    <LayoutList size={15} aria-hidden="true" />
                  </span>
                </span>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-3">
                {NOTES.map((n) => (
                  <PadCard key={n.title} note={n} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* The iPhone ------------------------------------------------------------------------------------ */

const PHONE_W = 472;
const PHONE_H = 1000;

function PhoneTabBar() {
  const tabs = [
    { label: "Home", icon: House, on: true },
    { label: "Tasks", icon: SquareCheckBig },
    { label: "Calendar", icon: CalendarDays },
  ];
  return (
    <div className="absolute inset-x-6 bottom-6 flex h-[76px] gap-3">
      <div className="mk-ios-glass rounded-capsule mk-ios-glass-auto relative flex flex-1 p-1">
        <span className="absolute inset-y-1 left-1 w-[calc((100%-8px)/3)] rounded-capsule bg-[color-mix(in_oklab,var(--color-heading)_8%,transparent)]" />
        {tabs.map(({ label, icon: Icon, on }) => (
          <span key={label} className={cx("relative flex flex-1 flex-col items-center justify-center gap-0.5", on ? "text-(--color-heading)" : "text-muted")}>
            <Icon size={28} strokeWidth={2} aria-hidden="true" />
            <span className="text-[13px] font-semibold leading-[18px]">{label}</span>
          </span>
        ))}
      </div>
      <span className="mk-ios-glass rounded-capsule mk-ios-glass-auto grid w-[76px] flex-none place-items-center text-(--color-heading)">
        <Search size={28} strokeWidth={2.2} aria-hidden="true" />
      </span>
    </div>
  );
}

export function IphonePicture() {
  return (
    <div className="mk-phone bg-[#111113] p-2.5 shadow-[0_0_0_2px_rgb(255_255_255/0.08)_inset,var(--shadow-overlay)]" style={{ width: PHONE_W, height: PHONE_H }}>
      <div className="mk-phone-screen relative h-full overflow-hidden bg-(--color-surface) text-(--color-heading)" style={{ fontFamily: SYSTEM_FONT }}>
        {/* The status bar, with the Dynamic Island. */}
        <div className="relative flex h-[68px] items-center justify-between px-11 pt-2 text-[20px] font-semibold">
          <span>9:41</span>
          <span className="absolute left-1/2 top-4 h-9 w-32 -translate-x-1/2 rounded-capsule bg-black" />
          <span className="h-3.5 w-[30px] rounded-tiny border-2 border-current opacity-70" />
        </div>
        {/* The top bar's glass buttons: Back, and the list's menu. */}
        <div className="flex h-[60px] items-center justify-between px-5">
          <span className="mk-ios-glass rounded-capsule mk-ios-glass-auto grid size-[52px] place-items-center">
            <ChevronLeft size={30} strokeWidth={2.2} aria-hidden="true" />
          </span>
          <span className="mk-ios-glass rounded-capsule mk-ios-glass-auto grid size-[52px] place-items-center">
            <Ellipsis size={28} strokeWidth={2.2} aria-hidden="true" />
          </span>
        </div>
        <p className="px-6 pt-2 text-[48px] font-bold leading-[60px] tracking-[-0.015em]">All notes</p>
        <FilterNotes className="mx-6 mt-3 h-12 rounded-control bg-[color-mix(in_oklab,var(--color-heading)_6%,transparent)] px-4 text-[21px] text-faint [&_svg]:size-[22px]" />
        <ul className="mt-3">
          {NOTES.map((n) => (
            <li key={n.title} className="flex items-center gap-4 pl-6">
              <FileText size={30} strokeWidth={1.8} aria-hidden="true" className="flex-none text-muted" />
              <span className="min-w-0 flex-1 border-b-2 border-(--color-line) py-3 pr-6">
                <span className="block truncate text-[23px] leading-[30px]">{n.title}</span>
                <span className="block truncate text-[18px] leading-6 text-muted">
                  {n.when} · {n.folder}
                </span>
              </span>
            </li>
          ))}
        </ul>
        <PhoneTabBar />
        <span className="absolute bottom-2 left-1/2 h-1.5 w-[152px] -translate-x-1/2 rounded-capsule bg-(--color-heading) opacity-80" />
      </div>
    </div>
  );
}

/** The iPad with the iPhone in front of its lower right corner, sized for the apps page's picture. */
export function TouchDevicesPicture() {
  return (
    <div className="relative h-[262px] w-[420px] max-sm:[zoom:0.62]">
      <div className="absolute left-0 top-0">
        <Scaled width={PAD_W} height={PAD_H} scale={0.46}>
          <IpadPicture />
        </Scaled>
      </div>
      <div className="absolute bottom-0 right-0">
        <Scaled width={PHONE_W} height={PHONE_H} scale={0.25}>
          <IphonePicture />
        </Scaled>
      </div>
    </div>
  );
}
