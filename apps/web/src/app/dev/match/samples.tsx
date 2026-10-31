"use client";


import type { ReactNode } from "react";
import { AtSign, Bell, CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, Copy, House, Image as ImageIcon, IndentDecrease, IndentIncrease, Link2, MessageCircle, MoreHorizontal, Paintbrush, Plus, Redo2, SquareCheck, SquareCheckBig, Trash, Type, Undo2, X } from "lucide-react";
import { Button, IconButton } from "@/components/ui/Button";
import { AiIcon } from "@/components/ai/AiIcon";
import { GlassCircle, GlassPill, GlassTextButton, PillButton } from "@/components/iphone/Glass";
import { FolderGlyph } from "@/components/ui/FolderGlyph";
import { AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, Code2, Eraser, FileText, Italic, List, ListOrdered, PanelTop, Play, Quote, StickyNote, Strikethrough, Underline } from "lucide-react";
import { NATIVE_INSERT_SECTIONS } from "@/components/doc/InsertPanel";
import { InsertPreview } from "@/components/doc/insertPreviews";
import "@/components/editor/editor.css";
import "@/components/editor/insert-blocks.css";
import "@/components/iphone/editor-phone.css";

/**
 * Development only: the web app's components as samples for Folevi for Mac (docs/MAC_REBUILD_PLAN.md section 3).
 * Each element carrying `data-style` is read by scripts/web-styles.mjs (its computed style, light and dark,
 * as the Mac app shows the web) into apps/native-kit FoleviDesign Generated/WebStyles.swift, and each sample is
 * also a specimen of the screenshot diffs. Real components where they render statically; otherwise the same
 * markup and classes the component draws (an open menu's panel and rows).
 */
type Sample = { id: string; node: ReactNode };

const buttonVariants = ["primary", "secondary", "ghost", "quiet", "danger"] as const;

const SAMPLES: Sample[] = [
  ...buttonVariants.flatMap((variant) => [
    {
      id: `button.${variant}.md`,
      node: (
        <Button variant={variant} size="md" data-style={`button.${variant}.md`}>
          Save changes
        </Button>
      ),
    },
    {
      id: `button.${variant}.sm`,
      node: (
        <Button variant={variant} size="sm" data-style={`button.${variant}.sm`}>
          <Plus size={15} aria-hidden data-style={`button.${variant}.sm.icon`} />
          New note
        </Button>
      ),
    },
  ]),
  {
    id: "button.quiet.icon",
    node: (
      <IconButton label="Close" data-style="button.quiet.icon">
        <X size={16} aria-hidden />
      </IconButton>
    ),
  },
  {
    id: "button.quiet.icon.pressed",
    node: (
      <IconButton label="Pinned" aria-pressed data-style="button.quiet.icon.pressed">
        <Copy size={16} aria-hidden />
      </IconButton>
    ),
  },
  {
    id: "select.trigger",
    node: (
      <button type="button" className="ui-input inline-flex h-8 min-w-40 items-center justify-between gap-1.5 px-2.5 text-left text-callout" data-style="select.trigger">
        <span className="min-w-0 truncate" data-style="select.trigger.label">
          Newest first
        </span>
        <ChevronDown size={14} aria-hidden className="flex-none opacity-60" data-style="select.trigger.chevron" />
      </button>
    ),
  },
  {
    id: "input",
    node: <input readOnly className="ui-input h-8 w-60 px-2.5 text-body" defaultValue="Kyoto in November" data-style="input" />,
  },
  {
    id: "menu",
    node: (
      <div role="menu" className="ui-pop w-56 border-0 p-1.5 text-ink" data-style="menu.panel">
        <div aria-hidden className="ui-caps px-2.5 pb-1 pt-2" data-style="menu.heading">
          Note
        </div>
        <button type="button" role="menuitem" className="ui-menu-item w-full" data-style="menu.item">
          <span data-menu-part="icon" className="text-muted" aria-hidden data-style="menu.item.icon">
            <Copy size={15} />
          </span>
          <span data-menu-part="label" className="flex-1" data-style="menu.item.label">
            Duplicate
          </span>
          <span data-menu-part="shortcut" data-style="menu.item.shortcut">
            ⌘D
          </span>
        </button>
        <button type="button" role="menuitem" data-highlighted="true" className="ui-menu-item w-full" data-style="menu.item.highlighted">
          <span data-menu-part="icon" className="text-muted" aria-hidden>
            <Check size={15} />
          </span>
          <span data-menu-part="label" className="flex-1">
            Mark as done
          </span>
        </button>
        <div role="separator" className="mx-2 my-1.5 h-px bg-line" data-style="menu.separator" />
        <button type="button" role="menuitem" className="ui-menu-item w-full !text-danger" data-style="menu.item.danger">
          <span data-menu-part="icon" className="text-muted" aria-hidden>
            <Trash size={15} />
          </span>
          <span data-menu-part="label" className="flex-1">
            Move to Trash
          </span>
        </button>
      </div>
    ),
  },
  {
    id: "dialog",
    node: (
      <div className="ui-pop w-[440px] rounded-panel p-0 text-ink shadow-[var(--glass-edge),0_16px_48px_rgb(0_0_0/0.1),0_2px_8px_rgb(0_0_0/0.1)]" data-style="dialog.panel">
        <header className="flex items-start gap-3 px-6 pb-2 pt-5" data-style="dialog.header">
          <div className="min-w-0 flex-1">
            <h2 className="ui-display text-title-2 leading-snug" data-style="dialog.title">
              Rename folder
            </h2>
            <div className="mt-1 text-subheadline text-muted" data-style="dialog.description">
              Notes inside keep their links.
            </div>
          </div>
        </header>
        <div className="px-6 py-4" data-style="dialog.body">
          <input readOnly className="ui-input h-8 w-full px-2.5 text-body" defaultValue="Travel" />
        </div>
        <footer className="flex justify-end gap-2 bg-[color-mix(in_oklab,var(--color-surface-sunken)_60%,transparent)] px-6 py-3.5 shadow-[inset_0_1px_0_var(--color-line)]" data-style="dialog.footer">
          <Button variant="secondary">Cancel</Button>
          <Button variant="primary">Rename</Button>
        </footer>
      </div>
    ),
  },
  {
    id: "card",
    node: (
      <div className="ui-card w-64 p-4" data-style="card">
        <div className="ui-display text-title-3" data-style="card.title">
          Kyoto in November
        </div>
        <div className="mt-1 text-subheadline text-muted" data-style="card.subtitle">
          Edited 2 days ago
        </div>
      </div>
    ),
  },
  {
    id: "chip",
    node: (
      <span className="ui-chip bg-accent-soft text-heading" data-style="chip">
        Travel
      </span>
    ),
  },
  {
    id: "kbd",
    node: (
      <kbd className="ui-kbd" data-style="kbd">
        ⌘K
      </kbd>
    ),
  },
  // The iPhone app's floating controls (components/iphone/Glass.tsx, the real ones), and its tab bar as TabBar.tsx
  // draws it with Home chosen (its markup and classes, without the router).
  {
    id: "iphone.circle",
    node: (
      <GlassCircle label="Back">
        <ChevronLeft size={24} strokeWidth={2.2} aria-hidden />
      </GlassCircle>
    ),
  },
  {
    id: "iphone.pill",
    node: (
      <GlassPill label="Screen actions">
        <PillButton label="Notifications">
          <Bell size={21} strokeWidth={1.9} aria-hidden />
        </PillButton>
        <PillButton label="More">
          <MoreHorizontal size={24} strokeWidth={2.2} aria-hidden />
        </PillButton>
      </GlassPill>
    ),
  },
  {
    id: "iphone.text",
    node: (
      <div className="flex gap-3">
        <GlassTextButton>Select</GlassTextButton>
        <GlassTextButton strong>Done</GlassTextButton>
      </div>
    ),
  },
  {
    id: "iphone.tabbar",
    node: (
      <div className="flex w-[393px] items-end justify-between gap-3 px-4">
        <nav aria-label="Tabs" className="ui-liquid iphone-tab-pill flex h-16 items-center gap-0.5 rounded-capsule p-1">
          <span
            aria-hidden
            className="pointer-events-none absolute left-1 top-1 h-14 w-16 rounded-capsule bg-[var(--liquid-lens)] shadow-[inset_0_1px_0_rgb(255_255_255/0.55),inset_0_0_0_0.5px_rgb(255_255_255/0.35)] dark:shadow-[inset_0_1px_0_rgb(255_255_255/0.14),inset_0_0_0_0.5px_rgb(255_255_255/0.08)]"
          />
          <a href="#" aria-label="Home" title="Home" className="relative grid h-14 w-16 place-items-center rounded-capsule text-heading">
            <House size={24} strokeWidth={2.3} aria-hidden />
          </a>
          <a href="#" aria-label="Tasks" title="Tasks" className="relative grid h-14 w-16 place-items-center rounded-capsule text-muted">
            <SquareCheckBig size={23} strokeWidth={1.9} aria-hidden />
          </a>
          <a href="#" aria-label="Calendar" title="Calendar" className="relative grid h-14 w-16 place-items-center rounded-capsule text-muted">
            <CalendarDays size={23} strokeWidth={1.9} aria-hidden />
          </a>
        </nav>
        <div role="group" aria-label="Create" className="ui-liquid iphone-tab-pill flex h-16 items-center gap-1 rounded-capsule p-1">
          <button type="button" aria-label="Foli AI" title="Foli AI" className="grid h-14 w-14 place-items-center rounded-capsule">
            <AiIcon size={26} />
          </button>
          <button type="button" aria-label="Create" className="grid h-14 w-14 place-items-center rounded-capsule">
            <span className="grid h-10 w-10 place-items-center rounded-capsule bg-heading text-canvas shadow-[0_2px_6px_rgb(0_0_0/0.18)]">
              <Plus size={22} strokeWidth={2.6} aria-hidden />
            </span>
          </button>
        </div>
      </div>
    ),
  },
  // A note's bars (components/iphone/NoteChrome.tsx's place chip, NoteBars.tsx's tool bars and the bar on the
  // keyboard: their markup and classes, without the editor). On the keyboard bar the line is a to-do and there's
  // nothing to redo.
  {
    id: "iphone.place",
    node: (
      <a href="#" aria-label="In Travel" title="In Travel" className="ui-liquid flex h-8 max-w-full items-center gap-1.5 rounded-capsule pl-2.5 pr-2 text-footnote font-medium text-heading">
        <FolderGlyph color="moss" size={15} />
        <span className="min-w-0 truncate">Travel</span>
        <ChevronRight size={13} strokeWidth={2.4} aria-hidden className="flex-none text-faint" />
      </a>
    ),
  },
  {
    id: "iphone.notebars",
    node: (
      <div className="flex w-[393px] items-end justify-between gap-3 px-4">
        <div role="toolbar" aria-label="Note tools" className="ui-liquid flex h-[60px] items-center gap-0.5 rounded-capsule p-1">
          <PillButton label="Comments" className="!h-[52px] !min-w-[52px]">
            <MessageCircle size={23} strokeWidth={2} aria-hidden />
          </PillButton>
          <PillButton label="Style" className="!h-[52px] !min-w-[52px]">
            <Paintbrush size={22} strokeWidth={1.85} aria-hidden />
          </PillButton>
          <PillButton label="Format" className="!h-[52px] !min-w-[52px]">
            <Type size={24} strokeWidth={2} aria-hidden />
          </PillButton>
        </div>
        <div role="toolbar" aria-label="Add to the note" className="ui-liquid flex h-[60px] items-center gap-0.5 rounded-capsule p-1">
          <PillButton label="Foli AI" className="!h-[52px] !min-w-[52px]">
            <AiIcon size={26} />
          </PillButton>
          <PillButton label="Insert" className="!h-[52px] !min-w-[52px]">
            <span className="grid h-[38px] w-[38px] place-items-center rounded-capsule bg-heading text-canvas shadow-[0_2px_6px_rgb(0_0_0/0.18)]">
              <Plus size={22} strokeWidth={2.4} aria-hidden />
            </span>
          </PillButton>
        </div>
      </div>
    ),
  },
  {
    id: "iphone.keybar",
    node: (
      <div className="w-[393px] px-2 pb-2">
        <div role="toolbar" aria-label="Writing tools" className="ui-liquid flex h-12 items-center rounded-capsule px-0.5">
          <div className="flex min-w-0 flex-1 items-center overflow-hidden">
            {(
              [
                ["Insert", <Plus key="i" size={23} strokeWidth={2.2} aria-hidden />],
                ["Format", <span key="f" className="text-headline font-semibold leading-none tracking-[-0.01em]">Aa</span>],
                ["Foli AI", <AiIcon key="a" size={22} />],
                ["To-do", <SquareCheck key="t" size={22} strokeWidth={2} aria-hidden />, "on"],
                ["Indent", <IndentIncrease key="in" size={22} strokeWidth={2} aria-hidden />],
                ["Outdent", <IndentDecrease key="out" size={22} strokeWidth={2} aria-hidden />],
                ["Link", <Link2 key="l" size={22} strokeWidth={2} aria-hidden />],
                ["Mention a date or page", <AtSign key="m" size={22} strokeWidth={2} aria-hidden />],
                ["Image", <ImageIcon key="im" size={22} strokeWidth={2} aria-hidden />],
                ["Undo", <Undo2 key="u" size={22} strokeWidth={2} aria-hidden />],
                ["Redo", <Redo2 key="r" size={22} strokeWidth={2} aria-hidden />, "off"],
              ] as [string, ReactNode, string?][]
            ).map(([label, icon, state]) => (
              <button key={label} type="button" aria-label={label} title={label} disabled={state === "off"} className={`grid h-11 w-11 flex-none place-items-center rounded-capsule text-heading disabled:opacity-30 ${state === "on" ? "bg-heading !text-canvas" : ""}`}>
                {icon}
              </button>
            ))}
          </div>
          <span aria-hidden className="mx-0.5 h-6 w-px flex-none bg-[var(--iphone-separator)]" />
          <button type="button" aria-label="Hide keyboard" title="Hide keyboard" className="grid h-11 w-11 flex-none place-items-center rounded-capsule text-heading">
            <ChevronDown size={24} strokeWidth={2.2} aria-hidden />
          </button>
        </div>
      </div>
    ),
  },
  // A note's Insert and Format tools as their iPhone sheets draw them (components/doc/InsertPanel.tsx's phone tiles
  // with the real pictures, FormatPanel.tsx's phone layout: its markup and classes, for a body line in bold with
  // the moss text colour).
  {
    id: "iphone.insert",
    node: (
      <div className="w-[393px] px-4 pb-4 pt-1">
        {NATIVE_INSERT_SECTIONS.filter((s) => s.title === "Suggested" || s.title === "Visuals").map((s, i) => (
          <div key={s.title} role="group" aria-label={s.title} className={i ? "mt-6" : ""}>
            <h3 className="ui-caption-caps mb-2.5 px-1">{s.title}</h3>
            <div className="grid grid-cols-4 gap-x-2 gap-y-3.5">
              {s.tiles.map((t) => (
                <button key={t.kind} type="button" aria-label={t.name ?? t.label} className="group flex min-w-0 select-none flex-col items-center gap-1 rounded-chip">
                  <span aria-hidden className="iphone-insert-art grid h-14 w-full place-items-center overflow-hidden rounded-panel" style={t.hue ? ({ color: `var(--color-${t.hue})`, ["--color-accent" as string]: `var(--color-${t.hue})` } as React.CSSProperties) : undefined}>
                    {t.preview ? <InsertPreview kind={t.preview} /> : null}
                  </span>
                  <span className="line-clamp-2 w-full break-words px-0.5 text-center text-subheadline leading-4 text-ink">{t.label}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    ),
  },
  {
    id: "iphone.format",
    node: (() => {
      const ic = { size: 20, strokeWidth: 2, "aria-hidden": true } as const;
      const btn = (label: string, icon: ReactNode, on = false, swatch = false) => (
        <button key={label} type="button" aria-label={label} title={label} aria-pressed={on} className={`iphone-fmt-btn ${swatch ? "is-swatch" : ""} ${on ? "is-on" : ""}`}>
          {icon}
        </button>
      );
      const row = (label: string, icon: ReactNode) => (
        <button key={label} type="button" className="iphone-fmt-row">
          <span aria-hidden className="grid w-7 flex-none place-items-center text-heading">
            {icon}
          </span>
          <span className="min-w-0 flex-1 truncate">{label}</span>
        </button>
      );
      const styles: [string, boolean, string][] = [
        ["Title", false, "font-[family-name:var(--font-display)] text-title-2 font-semibold leading-none"],
        ["Subtitle", false, "text-headline font-semibold leading-none"],
        ["Heading", false, "text-subheadline font-semibold leading-none"],
        ["Strong", false, "text-subheadline font-semibold leading-none"],
        ["Body", true, "text-subheadline leading-none"],
        ["Caption", false, "text-footnote leading-none opacity-70"],
      ];
      return (
        <div className="w-[393px] px-4 pb-4 pt-1">
          <div className="iphone-format space-y-3 pb-2">
            <div role="group" aria-label="Text style" className="-mx-4 flex gap-2 overflow-hidden px-4 pb-1">
              {styles.map(([label, on, cls]) => (
                <button key={label} type="button" aria-pressed={on} className={`iphone-fmt-style ${on ? "is-on" : ""}`}>
                  <span className={cls}>{label}</span>
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div role="group" aria-label="Text marks" className="iphone-fmt-group col-span-2">
                {btn("Bold", <Bold {...ic} strokeWidth={2.4} />, true)}
                {btn("Italic", <Italic {...ic} />)}
                {btn("Underline", <Underline {...ic} />)}
                {btn("Strikethrough", <Strikethrough {...ic} />)}
                {btn("Inline code", <Code2 {...ic} />)}
              </div>
              <div role="group" aria-label="Lists" className="iphone-fmt-group col-span-2">
                {btn("To-do", <SquareCheck {...ic} />)}
                {btn("Toggle", <Play size={16} aria-hidden className="fill-current" />)}
                {btn("Bullets", <List {...ic} />)}
                {btn("Numbers", <ListOrdered {...ic} />)}
              </div>
              <div role="group" aria-label="Indent" className="iphone-fmt-group">
                {btn("Outdent", <IndentDecrease {...ic} />)}
                {btn("Indent", <IndentIncrease {...ic} />)}
              </div>
              <div role="group" aria-label="Group" className="iphone-fmt-group">
                {btn("Page", <span className="flex items-center gap-1.5 text-subheadline"><FileText size={17} strokeWidth={2} aria-hidden /> Page</span>, true)}
                {btn("Card", <span className="flex items-center gap-1.5 text-subheadline"><PanelTop size={17} strokeWidth={2} aria-hidden /> Card</span>)}
              </div>
              <div role="group" aria-label="Alignment" className="iphone-fmt-group col-span-2">
                {btn("Align left", <AlignLeft {...ic} />, true)}
                {btn("Align center", <AlignCenter {...ic} />)}
                {btn("Align right", <AlignRight {...ic} />)}
                {btn("Justify", <AlignJustify {...ic} />)}
              </div>
            </div>
            <div role="group" aria-label="Text color" className="iphone-fmt-group">
              {btn("Default text color", <span className="text-headline font-semibold">A</span>, false, true)}
              {["muted", "accent", "moss", "marigold", "plum", "coral"].map((c) => btn(`Text color: ${c}`, <span className={`fb-color-${c} text-headline font-semibold`}>A</span>, c === "moss", true))}
            </div>
            <div role="group" aria-label="Highlight" className="iphone-fmt-group">
              {btn("No highlight", <span className="h-[18px] w-[18px] iphone-round shadow-[inset_0_0_0_1.5px_var(--color-ink-faint)]" />, true, true)}
              {["yellow", "green", "blue", "pink"].map((h) => btn(`Highlight: ${h}`, <span className={`fb-hl-${h} fb-swatch h-[18px] w-[18px] iphone-round`} />, false, true))}
            </div>
            <div className="iphone-fmt-list" role="group" aria-label="More">
              {row("Quote", <Quote {...ic} />)}
              {row("Callout", <StickyNote {...ic} />)}
              {row("Code block", <Code2 {...ic} />)}
              {row("Focus line", <span className="h-4 w-[3px] iphone-round bg-current" />)}
              {row("Block background", <span className="h-3.5 w-5 rounded-tiny bg-[var(--glass-active)] shadow-[inset_0_0_0_1px_var(--glass-border)]" />)}
              {row("Link", <Link2 {...ic} />)}
              {row("Clear formatting", <Eraser {...ic} />)}
            </div>
          </div>
        </div>
      );
    })(),
  },
];

/** The samples with these ids (all of them by default), in a column `gap` apart. */
export function Samples({ ids, gap }: { ids?: string[]; gap: number }) {
  const list = ids ? ids.map((id) => SAMPLES.find((s) => s.id === id)).filter((s): s is Sample => Boolean(s)) : SAMPLES;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap }}>
      {list.map((s) => (
        <div key={s.id} data-sample={s.id} style={{ display: "flex" }}>
          {s.node}
        </div>
      ))}
    </div>
  );
}
