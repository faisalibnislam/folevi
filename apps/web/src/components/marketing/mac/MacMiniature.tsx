import type { ReactNode } from "react";
import { Icon, type IconName } from "../icons";
import { MiniBullet, MiniCallout, MiniPageCard, MiniTodo, StatusPill } from "../mini";
import { cx } from "../ui";

/*
 * Live HTML miniatures of the product, used until real screenshots are dropped into
 * public/marketing/screenshots (see ProductShot). Everything here mirrors real product
 * structure: sidebar, editor blocks, inspector with the actual document style options.
 */

function Lights({ inactive }: { inactive?: boolean }) {
  return (
    <span aria-hidden="true" className={cx("mk-lights flex items-center gap-[7px]", inactive && "mk-lights--inactive")}>
      <span />
      <span />
      <span />
    </span>
  );
}

function ToolIcon({ name, label }: { name: IconName; label: string }) {
  return (
    <span className="flex size-7 items-center justify-center rounded-[6px] text-muted" title={label}>
      <Icon name={name} size={16} />
    </span>
  );
}

function SidebarRow({ icon, label, active, depth = 0, count, kbd }: { icon: string; label: string; active?: boolean; depth?: number; count?: string; kbd?: string }) {
  return (
    <div
      className={cx("flex h-[26px] items-center gap-2 rounded-[6px] px-2 text-[12px]", active ? "bg-accent-soft text-accent-soft-ink" : "text-ink")}
      style={{ paddingLeft: 8 + depth * 14 }}
    >
      <span aria-hidden="true" className="w-4 text-center text-[12px]">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count ? <span className="text-[10.5px] text-muted">{count}</span> : null}
      {kbd ? <span className="text-[10.5px] text-faint">{kbd}</span> : null}
    </div>
  );
}

function Sidebar() {
  return (
    <div className="hidden w-[196px] shrink-0 flex-col gap-3 border-r mk-hair bg-sunken/60 p-2.5 @[640px]:flex">
      <div className="space-y-0.5">
        <SidebarRow icon="⌕" label="Search" kbd="⌘K" />
        <SidebarRow icon="◎" label="Today" count="3" />
        <SidebarRow icon="☑" label="Tasks" />
        <SidebarRow icon="▦" label="Calendar" />
        <SidebarRow icon="✎" label="Daily notes" />
      </div>
      <div>
        <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">Pages</p>
        <div className="space-y-0.5">
          <SidebarRow icon="🌱" label="Seed library" active />
          <SidebarRow icon="🗓️" label="Planting calendar" depth={1} />
          <SidebarRow icon="📚" label="Reading list" />
          <SidebarRow icon="📦" label="Studio move" />
          <SidebarRow icon="🗒️" label="Thursday notes" />
        </div>
      </div>
      <div className="mt-auto">
        <SidebarRow icon="◌" label="Unsorted" count="3" />
      </div>
    </div>
  );
}

function Segmented({ options, value }: { options: string[]; value: string }) {
  return (
    <div className="flex rounded-[6px] bg-sunken p-0.5 text-[10.5px]">
      {options.map((option) => (
        <span key={option} className={cx("flex-1 rounded-[5px] py-1 text-center", option === value ? "bg-raised font-medium text-ink shadow-sm" : "text-muted")}>
          {option}
        </span>
      ))}
    </div>
  );
}

function InspectorGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-[10.5px] font-medium text-muted">{title}</p>
      {children}
    </div>
  );
}

function Inspector() {
  return (
    <div className="hidden w-[208px] shrink-0 space-y-4 border-l mk-hair bg-surface p-3.5 @[920px]:block">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-faint">Page style</p>
      <InspectorGroup title="Font">
        <Segmented options={["Sans", "Serif", "Mono"]} value="Serif" />
      </InspectorGroup>
      <InspectorGroup title="Width">
        <Segmented options={["Narrow", "Default", "Wide"]} value="Default" />
      </InspectorGroup>
      <InspectorGroup title="Background">
        <Segmented options={["Paper", "Plain", "Tinted", "Grid"]} value="Paper" />
      </InspectorGroup>
      <InspectorGroup title="Accent">
        <div className="flex gap-1.5">
          {["bg-accent", "bg-moss", "bg-marigold", "bg-plum", "bg-coral"].map((color) => (
            <span key={color} className={cx("size-[18px] rounded-full", color, color === "bg-moss" && "ring-2 ring-moss/40 ring-offset-2 ring-offset-surface")} />
          ))}
        </div>
      </InspectorGroup>
      <div className="space-y-1.5 border-t mk-hair pt-3">
        <p className="text-[10.5px] font-medium text-muted">Backlinks · 2</p>
        <p className="flex items-center gap-1.5 text-[11.5px] text-ink">
          <Icon name="link" size={11} /> Thursday notes
        </p>
        <p className="flex items-center gap-1.5 text-[11.5px] text-ink">
          <Icon name="link" size={11} /> Planting calendar
        </p>
      </div>
    </div>
  );
}

function EditorPage({ compact }: { compact?: boolean }) {
  return (
    <div className="min-w-0 flex-1 overflow-hidden bg-surface">
      <div aria-hidden="true" className="h-[64px] bg-linear-to-r from-moss-soft via-moss-soft to-marigold-soft" />
      <div className={cx("mx-auto max-w-[520px] px-6", compact && "px-5")}>
        <span aria-hidden="true" className="-mt-5 flex size-10 items-center justify-center rounded-[9px] border mk-hair bg-raised text-[20px]">
          🌱
        </span>
        <p className="mt-2 font-display text-[30px] leading-none tracking-[-0.01em] text-ink">Seed library</p>
        <p className="mt-1.5 text-[11.5px] text-muted">Updated 2 minutes ago · Private</p>
        <div className="mt-3.5">
          <MiniCallout icon="📅" tone="moss">
            <span className="font-medium">Swap day</span> — Saturday 4 April, 10:00 at the phone box
          </MiniCallout>
        </div>
        <p className="mt-3.5 text-[13.5px] font-semibold text-ink">Where</p>
        <div className="mt-1 space-y-0.5">
          <MiniBullet>Old phone box on Alder Street</MiniBullet>
          <MiniBullet>Spare shelves from Ines</MiniBullet>
        </div>
        <p className="mt-3 text-[13.5px] font-semibold text-ink">Before swap day</p>
        <div className="mt-1 space-y-0.5">
          <MiniTodo text="Draft the sign-up sheet" checked />
          <MiniTodo text="Print seed labels" date="Mar 28" tone="accent" />
          <MiniTodo text="Confirm shelves with Ines" date="Apr 1" high />
        </div>
        <div className="mt-3 pb-6">
          <MiniPageCard icon="🗓️" title="Planting calendar" meta="Sub-page · 14 blocks" />
        </div>
      </div>
    </div>
  );
}

function OfflineBadge() {
  return (
    <span className="inline-flex h-6 items-center gap-1.5 rounded-[6px] bg-warning-soft px-2 text-[11px] font-medium text-warning">
      <Icon name="offline" size={12} />
      Offline<span className="hidden @[520px]:inline"> · 3 edits on this Mac</span>
    </span>
  );
}

export function MacWindow({ className }: { className?: string }) {
  return (
    <div className={cx("mk-window @container relative", className)} role="img" aria-label="The Folevi Mac app: a sidebar of pages, the Seed library page open in the editor, and the inspector showing page style and backlinks. The toolbar shows the app is offline with 3 edits stored on this Mac.">
      <div aria-hidden="true">
        <div className="flex h-11 items-center gap-2 border-b mk-hair bg-raised px-3.5">
          <Lights />
          <span className="ml-3 hidden items-center @[400px]:flex">
            <ToolIcon name="sidebar" label="Toggle sidebar" />
            <ToolIcon name="chevron-left" label="Back" />
            <ToolIcon name="chevron-right" label="Forward" />
          </span>
          <span className="ml-1 min-w-0 truncate text-[12.5px] font-semibold text-ink">Seed library</span>
          <span className="ml-auto flex items-center gap-1.5">
            <OfflineBadge />
            <span className="hidden @[520px]:flex">
              <ToolIcon name="link" label="Share" />
              <ToolIcon name="inspector" label="Toggle inspector" />
            </span>
          </span>
        </div>
        <div className="flex h-[476px]">
          <Sidebar />
          <EditorPage />
          <Inspector />
        </div>
      </div>
    </div>
  );
}

/** A second, inactive window behind the main one — Folevi supports multiple windows (⇧⌘N). */
export function MacSecondWindow({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cx("mk-window", className)}>
      <div className="flex h-9 items-center gap-2 border-b mk-hair bg-sunken px-3">
        <Lights inactive />
        <span className="ml-2 truncate text-[11.5px] font-medium text-muted">Reading list</span>
        <span className="ml-auto">
          <StatusPill status="Saved" />
        </span>
      </div>
      <div className="space-y-2 bg-surface px-5 py-4">
        <p className="font-display text-[22px] leading-none text-ink">📚 Reading list</p>
        <MiniTodo text="The Overstory" checked />
        <MiniTodo text="Braiding Sweetgrass" />
        <MiniTodo text="A short history of the post" />
        <MiniTodo text="Return The Overstory" />
      </div>
    </div>
  );
}

export function MacWindows() {
  return (
    <div className="relative">
      <MacSecondWindow className="absolute -top-14 right-0 hidden w-[36%] lg:block" />
      <MacWindow className="relative lg:mr-[7%]" />
    </div>
  );
}

export function WebWindow({ className }: { className?: string }) {
  return (
    <div className={cx("mk-window @container", className)} role="img" aria-label="Folevi in a web browser at app.folevi.com, showing the same Seed library page and a sidebar of pages.">
      <div aria-hidden="true">
        <div className="flex h-10 items-center gap-3 border-b mk-hair bg-sunken px-3.5">
          <Lights inactive />
          <span className="mx-auto flex h-6 w-full max-w-[320px] items-center justify-center gap-1.5 rounded-[6px] bg-surface text-[11px] text-muted">
            <Icon name="lock" size={11} /> app.folevi.com
          </span>
          <span className="w-[45px]" />
        </div>
        <div className="flex h-[400px]">
          <Sidebar />
          <EditorPage compact />
        </div>
      </div>
    </div>
  );
}
