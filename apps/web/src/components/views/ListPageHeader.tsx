"use client";

import { Fragment, type ReactNode } from "react";
import { ArrowDownUp, ChevronRight } from "lucide-react";
import { AppLink } from "@/lib/app/router";
import { Select } from "@/components/ui/Select";

/** A step of the way up before a nested folder's name ("Work ›"). */
export interface PathStep {
  label: string;
  href: string;
}

/**
 * The height every control in a title row shares (32 px, 44 on touch), level with the middle of the page's name:
 * the compact Sort, the view switch (with ROW_SEG), the search field and the buttons.
 */
export const ROW_CONTROL = "h-8 pointer-coarse:h-11";
/** The view switch at the row's height: 2 px around 28 px segments (36 px segments and 4 px on touch). */
export const ROW_SEG = "ui-seg ui-well p-0.5 pointer-coarse:p-1 pointer-coarse:[&>*]:min-h-9";
/** An icon-only button in a title row (Share, the folder's "…"). */
export const ROW_ICON_BUTTON = "ui-btn ui-btn-secondary h-8 w-8 flex-none pointer-coarse:h-11 pointer-coarse:w-11";

/**
 * The title row of a folder's page and the Folders page (the owner, 6 November 2026, "A. One compact row"): one line
 * with the folder's glyph, the way up for a nested folder ("Work ›", each step a link), the page's name in the
 * display serif, its count in muted text, and the page's controls at the right (Sort, the view switch, the page's
 * actions). The cards start right under it, on the same left and right edges. On a narrow window the controls wrap
 * onto a line of their own under the name; the name truncates before anything overlaps.
 */
export function ListPageHeader({ title, mark, count, path, controls }: { title: string; mark?: ReactNode; count?: ReactNode; path?: PathStep[]; controls?: ReactNode }) {
  return (
    <header data-page-header="" className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-3">
      <div className="flex min-w-0 flex-[1_1_18rem] items-center gap-2.5">
        {mark}
        {path?.length ? (
          <nav aria-label="Breadcrumb" className="-mr-1 flex min-w-0 flex-shrink-[2] items-center gap-0.5 text-body">
            {path.map((step) => (
              <Fragment key={step.href}>
                <AppLink href={step.href} className="min-w-0 max-w-[12rem] truncate rounded-chip px-1 py-0.5 text-muted transition-colors hover:bg-accent-soft hover:text-heading">
                  {step.label}
                </AppLink>
                <ChevronRight size={13} className="flex-none text-faint" aria-hidden />
              </Fragment>
            ))}
          </nav>
        ) : null}
        {/* Title 1 on the desktop (24), Title 2 in the apps' iOS scale (22): the size of a folder card's name. */}
        <h1 data-page-title="" className="ui-display min-w-0 truncate text-title-1 [:root[data-native]_&]:text-title-2">
          {title}
        </h1>
        {count ? (
          <p role="status" data-page-count="" className="flex-none whitespace-nowrap text-body text-muted">
            {count}
          </p>
        ) : null}
      </div>
      {controls ? <div className="flex flex-none flex-wrap items-center gap-2">{controls}</div> : null}
    </header>
  );
}

/**
 * Sort as one compact control in a title row: the sort icon, the current choice and a chevron, opening the sort
 * menu (no separate "Sort" label; it's the control's name, and its tooltip).
 */
export function RowSort<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: readonly (readonly [T, string])[] }) {
  return (
    <Select
      aria-label="Sort"
      title="Sort"
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      leading={<ArrowDownUp size={14} aria-hidden className="flex-none text-muted" />}
      className={`ui-input ${ROW_CONTROL} flex-none rounded-chip pl-2.5 pr-2 text-callout text-ink`}
    >
      {options.map(([v, label]) => (
        <option key={v} value={v}>
          {label}
        </option>
      ))}
    </Select>
  );
}

/** The small caps heading over a section of a list page (Built-in templates, a folder's Folders). */
export const SECTION_LABEL = "mb-3 text-footnote font-semibold uppercase tracking-[0.06em] text-faint";
