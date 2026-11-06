"use client";

import type { ReactNode } from "react";
import { ArrowDownUp, ChevronDown, FolderTree, LayoutGrid } from "lucide-react";
import { useAppRouter } from "@/lib/app/router";
import { Select } from "@/components/ui/Select";
import { MenuButton, type MenuItem } from "@/components/ui/Menu";
import { FolderGlyph } from "@/components/ui/FolderGlyph";

/** A folder above a nested folder's page, from the top level down ("Work", then "Clients"). */
export interface PathStep {
  label: string;
  href: string;
  /** The folder's colour, for its glyph in the path menu. */
  color?: string | null;
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
 * A title row's page controls in one quiet rounded tray (the owner, 6 November 2026: "inside a rounded rectangle
 * but nimble and less prominent"): a faint tint and hairline around controls that drop their own boxes
 * (globals.css .row-tray), with thin dividers (RowTraySep) between the groups. The row's height.
 */
export function RowTray({ children }: { children: ReactNode }) {
  return <div className="row-tray">{children}</div>;
}

/** The hairline between groups in a RowTray. */
export function RowTraySep() {
  return <span aria-hidden className="row-tray-sep" />;
}

/**
 * Where a nested folder sits, as Finder's path menu shows it (the owner, 6 November 2026): a button at the start of
 * the tray listing this folder, then each folder above it up to All folders, each with its glyph; choosing one
 * opens it.
 */
function PathMenu({ title, mark, path }: { title: string; mark?: string | null; path: PathStep[] }) {
  const { navigate } = useAppRouter();
  const items: MenuItem[] = [
    { label: title, icon: <FolderGlyph color={mark} size={14} />, checked: true, onSelect: () => {} },
    ...[...path].reverse().map((step) => ({ label: step.label, icon: <FolderGlyph color={step.color} size={14} />, onSelect: () => navigate(step.href) })),
    { label: "All folders", icon: <LayoutGrid size={14} aria-hidden />, onSelect: () => navigate("/folders") },
  ];
  return (
    <MenuButton
      label={`Where ${title} is`}
      tooltip="Enclosing folders"
      align="start"
      trigger={
        <>
          <FolderTree size={15} aria-hidden />
          <ChevronDown size={12} aria-hidden className="-ml-0.5 text-faint" />
        </>
      }
      triggerClassName={`ui-btn ui-btn-secondary row-tray-path ${ROW_CONTROL} flex-none gap-0.5 px-1.5`}
      items={items}
    />
  );
}
/**
 * The title row of a folder's page and the Folders page (the owner, 6 November 2026, "A. One compact row"): one line
 * with the folder's glyph, the way up for a nested folder ("Work ›", each step a link), the page's name in the
 * display serif, its count in muted text, and the page's controls at the right (Sort, the view switch, the page's
 * actions). The cards start right under it, on the same left and right edges. On a narrow window the controls wrap
 * onto a line of their own under the name; the name truncates before anything overlaps.
 */
export function ListPageHeader({
  title,
  mark,
  markColor,
  count,
  path,
  before,
  controls,
  after,
}: {
  title: string;
  mark?: ReactNode;
  /** The folder's colour, for its own row in the path menu. */
  markColor?: string | null;
  count?: ReactNode;
  /** The folders above this one: a path menu at the start of the tray. */
  path?: PathStep[];
  /** Controls before the tray (the Folders page's search). */
  before?: ReactNode;
  /** The page's controls, in one quiet tray. */
  controls?: ReactNode;
  /** Controls after the tray (the Folders page's New folder). */
  after?: ReactNode;
}) {
  const tray = path?.length || controls;
  return (
    // 20 px above the row on the page's 12 (the owner, 6 November 2026: "give more space on the top").
    <header data-page-header="" className="mb-6 mt-5 flex flex-wrap items-center gap-x-4 gap-y-3">
      <div className="flex min-w-0 flex-[1_1_18rem] items-center gap-2.5">
        {mark}
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
      {tray || before || after ? (
        <div className="flex flex-none flex-wrap items-center gap-2">
          {before}
          {tray ? (
            <RowTray>
              {path?.length ? (
                <>
                  <PathMenu title={title} mark={markColor} path={path} />
                  {controls ? <RowTraySep /> : null}
                </>
              ) : null}
              {controls}
            </RowTray>
          ) : null}
          {after}
        </div>
      ) : null}
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
