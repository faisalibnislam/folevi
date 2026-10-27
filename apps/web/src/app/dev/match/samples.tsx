"use client";


import type { ReactNode } from "react";
import { Check, ChevronDown, Copy, Plus, Trash, X } from "lucide-react";
import { Button, IconButton } from "@/components/ui/Button";

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
