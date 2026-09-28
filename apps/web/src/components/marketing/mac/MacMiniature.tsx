import type { ReactNode } from "react";
import { FoleviMark } from "@/components/brand/FoleviMark";
import { Icon, type IconName } from "../icons";
import { MiniBullet, MiniCallout, MiniPageCard, MiniTodo, StatusPill } from "../mini";
import { cx } from "../ui";

/*
 * Live HTML miniatures of the product, used until real screenshots are dropped into
 * public/marketing/screenshots (see ProductShot). They mirror the app's "Warm Folio" layout:
 * a tinted sidebar with a raised active pill, a transparent breadcrumb toolbar, the page lifted
 * off the canvas as a sheet, and a floating inspector card with segmented tabs.
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

function ToolIcon({ name }: { name: IconName }) {
  return (
    <span className="flex size-7 items-center justify-center rounded-full text-muted">
      <Icon name={name} size={15} />
    </span>
  );
}

function SidebarRow({ icon, label, active, depth = 0, count }: { icon: ReactNode; label: string; active?: boolean; depth?: number; count?: string }) {
  return (
    <div
      className={cx(
        "flex h-[28px] items-center gap-2 rounded-[9px] px-2 text-[12px]",
        active ? "mk-mini-raised font-semibold text-(--color-heading)" : "text-ink",
      )}
      style={{ paddingLeft: 8 + depth * 14 }}
    >
      <span aria-hidden="true" className={cx("flex w-4 justify-center text-[12px]", active ? "mk-ember-ink" : "text-muted")}>
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count ? <span className="text-[10.5px] font-medium text-muted">{count}</span> : null}
    </div>
  );
}

function Caps({ children }: { children: ReactNode }) {
  return <p className="px-2 pb-1 text-[9.5px] font-semibold uppercase tracking-[0.07em] text-faint">{children}</p>;
}

function Sidebar({ lights = false }: { lights?: boolean }) {
  return (
    <div className="hidden w-[204px] shrink-0 flex-col gap-3 border-r mk-hair bg-(--color-sidebar) px-2.5 pb-3 @[640px]:flex">
      <div className={cx("flex items-center gap-2 px-1.5", lights ? "h-11" : "h-3")}>{lights ? <Lights /> : null}</div>
      <div className="flex items-center gap-2 px-1.5">
        <FoleviMark size={24} className="flex-none" />
        <span className="truncate text-[12.5px] font-semibold text-(--color-heading)">Garden club</span>
        <Icon name="chevron-right" size={11} className="ml-auto rotate-90 text-faint" />
      </div>
      <div className="mk-mini-sunken flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[11px] text-faint">
        <Icon name="search" size={11} />
        <span className="flex-1">Search</span>
        <span className="mk-mini-raised rounded-[5px] px-1 text-[9.5px] text-muted">⌘K</span>
      </div>
      <div className="mk-mini-raised flex h-7 items-center justify-center gap-1.5 rounded-full text-[11px] font-semibold text-(--color-heading)">
        <Icon name="plus" size={11} /> New page
      </div>
      <div className="space-y-0.5">
        <SidebarRow icon={<Icon name="page" size={12} />} label="Home" />
        <SidebarRow icon={<Icon name="check" size={12} />} label="Tasks" count="3" />
        <SidebarRow icon={<Icon name="calendar" size={12} />} label="Calendar" />
      </div>
      <div>
        <Caps>Pages</Caps>
        <div className="space-y-0.5">
          <SidebarRow icon="🌱" label="Seed library" active />
          <SidebarRow icon="🗓️" label="Planting calendar" depth={1} />
          <SidebarRow icon="📚" label="Reading list" />
          <SidebarRow icon="📦" label="Studio move" />
          <SidebarRow icon="🗒️" label="Thursday notes" />
        </div>
      </div>
      <div className="mt-auto">
        <SidebarRow icon={<Icon name="page" size={12} />} label="Drafts" count="3" />
      </div>
    </div>
  );
}

function Segmented({ options, value, size = "sm" }: { options: string[]; value: string; size?: "sm" | "xs" }) {
  return (
    <div className="mk-mini-sunken flex rounded-full p-[3px]">
      {options.map((option) => (
        <span
          key={option}
          className={cx(
            "flex-1 rounded-full text-center",
            size === "xs" ? "py-[3px] text-[9.5px]" : "py-1 text-[10.5px]",
            option === value ? "mk-mini-raised font-semibold text-(--color-heading)" : "text-muted",
          )}
        >
          {option}
        </span>
      ))}
    </div>
  );
}

function InspectorGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-[9.5px] font-semibold uppercase tracking-[0.07em] text-faint">{title}</p>
      {children}
    </div>
  );
}

function Inspector() {
  return (
    <div className="mk-mini-inspector absolute bottom-3 right-3 top-[52px] hidden w-[212px] space-y-4 p-3 @[920px]:block">
      <Segmented options={["Insert", "Style", "Outline", "Info"]} value="Style" size="xs" />
      <InspectorGroup title="Font">
        <Segmented options={["Sans", "Serif", "Mono"]} value="Sans" />
      </InspectorGroup>
      <InspectorGroup title="Width">
        <Segmented options={["Narrow", "Default", "Wide"]} value="Default" />
      </InspectorGroup>
      <InspectorGroup title="Accent">
        <div className="flex gap-2 px-0.5">
          {["bg-(--color-ember)", "bg-moss", "bg-marigold", "bg-plum", "bg-coral"].map((color) => (
            <span
              key={color}
              className={cx(
                "size-[18px] rounded-full shadow-[inset_0_1px_0_rgb(255_255_255/0.35)]",
                color,
                color === "bg-moss" && "ring-2 ring-moss/40 ring-offset-2 ring-offset-(--color-surface)",
              )}
            />
          ))}
        </div>
      </InspectorGroup>
      <InspectorGroup title="Outline">
        <div className="space-y-1 text-[11px]">
          <p className="flex items-center gap-2 font-medium text-(--color-heading)">
            <span className="h-3.5 w-[3px] rounded-full bg-(--color-ember)" />
            Where
          </p>
          <p className="pl-[11px] text-muted">Before swap day</p>
          <p className="pl-[11px] text-muted">Planting calendar</p>
        </div>
      </InspectorGroup>
    </div>
  );
}

function Toolbar({ status, lights }: { status: ReactNode; lights?: boolean }) {
  return (
    <div className="flex h-[48px] shrink-0 items-center gap-2 px-3">
      {lights ? (
        <span className="mr-1 @[640px]:hidden">
          <Lights />
        </span>
      ) : null}
      <span className="mk-mini-raised hidden items-center rounded-full px-0.5 @[400px]:flex">
        <ToolIcon name="chevron-left" />
        <ToolIcon name="chevron-right" />
      </span>
      <span className="ml-1 flex min-w-0 items-center gap-1.5 truncate text-[12px] text-muted">
        <span className="hidden @[520px]:inline">Pages</span>
        <span className="hidden text-faint @[520px]:inline">›</span>
        <span aria-hidden="true">🌱</span>
        <span className="truncate font-semibold text-(--color-heading)">Seed library</span>
      </span>
      <span className="ml-auto flex items-center gap-1.5">
        {status}
        <span className="hidden h-7 items-center rounded-full bg-linear-to-b from-[color-mix(in_oklab,var(--color-accent)_92%,white)] to-(--color-accent) px-3 text-[11px] font-semibold text-(--color-accent-ink) shadow-(--shadow-primary) @[520px]:inline-flex">
          Share
        </span>
        <span className="hidden @[640px]:flex">
          <ToolIcon name="inspector" />
        </span>
      </span>
    </div>
  );
}

function EditorSheet({ withInspector }: { withInspector?: boolean }) {
  return (
    <div className={cx("min-w-0 flex-1 overflow-hidden px-3 pt-1 @[640px]:px-6", withInspector && "@[920px]:pr-[236px]")}>
      <div className="mk-mini-sheet mx-auto max-w-[520px] overflow-hidden">
        <div aria-hidden="true" className="h-[70px] bg-linear-to-br from-moss-soft via-moss-soft to-marigold-soft" />
        <div className="px-6 pb-6">
          <span aria-hidden="true" className="mk-mini-raised -mt-5 flex size-10 items-center justify-center rounded-[11px] text-[20px]">
            🌱
          </span>
          <p className="mt-2.5 text-[28px] font-semibold leading-none tracking-[-0.03em] text-(--color-heading)">Seed library</p>
          <p className="mt-2 text-[11.5px] text-muted">Updated 2 minutes ago · Private</p>
          <div className="mt-3.5">
            <MiniCallout icon="📅" tone="moss">
              <span className="font-medium">Swap day</span> — Saturday 4 April, 10:00 at the phone box
            </MiniCallout>
          </div>
          <p className="mt-3.5 text-[13.5px] font-semibold text-(--color-heading)">Where</p>
          <div className="mt-1 space-y-0.5">
            <MiniBullet>Old phone box on Alder Street</MiniBullet>
            <MiniBullet>Spare shelves from Ines</MiniBullet>
          </div>
          <p className="mt-3 text-[13.5px] font-semibold text-(--color-heading)">Before swap day</p>
          <div className="mt-1 space-y-0.5">
            <MiniTodo text="Draft the sign-up sheet" checked />
            <MiniTodo text="Print seed labels" date="Mar 28" tone="ember" />
            <MiniTodo text="Confirm shelves with Ines" date="Apr 1" high />
          </div>
          <div className="mt-3">
            <MiniPageCard icon="🗓️" title="Planting calendar" meta="Sub-page · 14 blocks" />
          </div>
        </div>
      </div>
    </div>
  );
}

export function MacWindow({ className }: { className?: string }) {
  return (
    <div
      className={cx("mk-window @container relative", className)}
      role="img"
      aria-label="The Folevi Mac app: a sidebar of pages, the Seed library page open on a lifted page sheet, and a floating inspector showing page style. The toolbar shows the app is offline with 3 edits stored on this Mac."
    >
      <div aria-hidden="true" className="flex h-[500px]">
        <Sidebar lights />
        <div className="relative flex min-w-0 flex-1 flex-col">
          <Toolbar lights status={<StatusPill status="Offline" detail="3 edits on this Mac" />} />
          <EditorSheet withInspector />
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
      <div className="flex h-10 items-center gap-2 bg-(--color-sidebar) px-3.5">
        <Lights inactive />
        <span className="ml-2 truncate text-[11.5px] font-semibold text-muted">Reading list</span>
        <span className="ml-auto">
          <StatusPill status="Saved" />
        </span>
      </div>
      <div className="p-3">
        <div className="mk-mini-sheet space-y-2 px-5 py-4">
          <p className="text-[20px] font-semibold leading-none tracking-[-0.025em] text-(--color-heading)">📚 Reading list</p>
          <MiniTodo text="The Overstory" checked />
          <MiniTodo text="Braiding Sweetgrass" />
          <MiniTodo text="A short history of the post" />
          <MiniTodo text="Return The Overstory" />
        </div>
      </div>
    </div>
  );
}

export function MacWindows() {
  return (
    <div className="relative">
      <MacSecondWindow className="absolute -top-14 right-0 hidden w-[34%] lg:block" />
      <MacWindow className="relative lg:mr-[7%]" />
    </div>
  );
}

export function WebWindow({ className }: { className?: string }) {
  return (
    <div
      className={cx("mk-window @container", className)}
      role="img"
      aria-label="Folevi in a web browser at app.folevi.com, showing the same Seed library page and a sidebar of pages."
    >
      <div aria-hidden="true">
        <BrowserBar />
        <div className="flex h-[420px]">
          <Sidebar />
          <div className="relative flex min-w-0 flex-1 flex-col">
            <Toolbar status={<StatusPill status="Saved" />} />
            <EditorSheet />
          </div>
        </div>
      </div>
    </div>
  );
}

/** A quiet browser title bar used around web screenshots and the web miniature. */
export function BrowserBar() {
  return (
    <div className="mk-browser-bar flex h-11 items-center gap-3 px-4">
      <Lights inactive />
      <span className="mk-mini-sunken mx-auto flex h-7 w-full max-w-[340px] items-center justify-center gap-1.5 rounded-full text-[11.5px] text-muted">
        <Icon name="lock" size={11} /> app.folevi.com
      </span>
      <span className="w-[45px]" />
    </div>
  );
}
