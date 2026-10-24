"use client";

import { useState, type ReactNode } from "react";
import { ChevronRight, MoreHorizontal, Search, type LucideIcon } from "lucide-react";
import { AppLink } from "@/lib/app/router";
import { useLocalStorage } from "@/lib/hooks/useEngine";
import { MenuButton, type MenuEntry } from "@/components/ui/Menu";

/** The disclosure chevron at the end of a row: small, light and faint, as iOS draws it. */
export function RowChevron() {
  return <ChevronRight size={20} strokeWidth={2.4} absoluteStrokeWidth aria-hidden className="-mr-1 flex-none text-faint" />;
}

/**
 * A plain list row, as on Home (All notes, a folder): an icon, the label, a count and a chevron, with a
 * hairline under it that starts where the label does.
 */
export function ListRow({ href, onClick, icon, label, detail, chevron = true, onContextMenu, ariaLabel, children }: { href?: string; onClick?: () => void; icon?: ReactNode; label: ReactNode; detail?: ReactNode; chevron?: boolean; onContextMenu?: (e: React.MouseEvent) => void; ariaLabel?: string; children?: ReactNode }) {
  const inner = (
    <>
      {icon ? <span aria-hidden className="grid w-7 flex-none place-items-center text-muted [&_svg]:h-[22px] [&_svg]:w-[22px]">{icon}</span> : null}
      <span className="ui-row-sep flex min-h-[52px] min-w-0 flex-1 items-center gap-2 pr-1">
        <span className="min-w-0 flex-1 truncate text-body leading-[22px] text-ink">{label}</span>
        {detail !== undefined && detail !== null && detail !== "" ? <span className="flex-none text-body leading-[22px] tabular-nums text-muted">{detail}</span> : null}
        {chevron ? <RowChevron /> : null}
      </span>
      {children}
    </>
  );
  const cls = "ui-key-focus flex w-full items-center gap-3 pl-5 pr-4 text-left outline-none transition-colors duration-150 active:bg-[var(--liquid-press)] active:duration-0";
  if (href)
    return (
      <AppLink href={href} onClick={onClick} onContextMenu={onContextMenu} aria-label={ariaLabel} data-iphone-tappable="" className={cls}>
        {inner}
      </AppLink>
    );
  return (
    <button type="button" onClick={onClick} onContextMenu={onContextMenu} aria-label={ariaLabel} data-iphone-tappable="" className={cls}>
      {inner}
    </button>
  );
}

/**
 * A section on Home: its title (a link to the whole list, with a chevron), a "…" menu, and its rows, or a
 * one-line note saying what will be here. `collapsible` sections fold away (remembered on this device): folded,
 * the section is just its 44-point heading row.
 */
export function HomeSection({ id, title, href, menu, children, empty, collapsible, defaultOpen = true }: { id: string; title: string; href?: string; menu?: MenuEntry[]; children?: ReactNode; empty?: ReactNode; collapsible?: boolean; defaultOpen?: boolean }) {
  const [stored, setStored] = useLocalStorage<boolean | null>(`folevi:iphone-home:${id}`, null);
  const open = collapsible ? (stored ?? defaultOpen) : true;
  const chevron = <ChevronRight size={20} strokeWidth={2.6} absoluteStrokeWidth aria-hidden className={`mt-px flex-none text-faint transition-transform duration-200 motion-reduce:transition-none ${collapsible && open ? "rotate-90" : ""}`} />;
  const heading = (
    <>
      <span className="ui-display text-title-2 leading-7 tracking-[-0.01em] text-heading">{title}</span>
      {collapsible || href ? chevron : null}
    </>
  );
  return (
    <section aria-labelledby={`home-${id}`} data-iphone-tappable="" className="mt-7">
      {/* The heading row: the title at the screen's 20-point inset, the "…" drawn at the same inset on the right
          (its 44-point target reaches past it). */}
      <div className="flex items-center gap-2 pl-5 pr-[5px]">
        <h2 id={`home-${id}`} className="min-w-0 flex-1">
          {collapsible ? (
            <button type="button" aria-expanded={open} onClick={() => setStored(!open)} className="flex h-11 items-center gap-1 rounded-chip outline-none">
              {heading}
            </button>
          ) : href ? (
            <AppLink href={href} className="flex h-11 w-fit items-center gap-1 rounded-chip outline-none">
              {heading}
            </AppLink>
          ) : (
            <span className="flex h-11 items-center gap-1">{heading}</span>
          )}
        </h2>
        {menu?.length ? (
          <MenuButton
            label={`${title} options`}
            align="end"
            triggerClassName="grid h-11 w-11 place-items-center rounded-capsule text-muted outline-none transition-colors active:bg-[var(--liquid-press)]"
            trigger={<MoreHorizontal size={22} strokeWidth={2.2} aria-hidden />}
            items={menu}
          />
        ) : null}
      </div>
      {open ? <div>{empty ?? children}</div> : null}
    </section>
  );
}

/** What an empty Home section says: one quiet line in a 56-point box (§2.1). */
export function EmptyBox({ children }: { children: ReactNode }) {
  return <p className="mx-4 grid min-h-14 place-items-center rounded-container bg-[color-mix(in_oklab,var(--color-ink)_4%,transparent)] px-5 text-center font-serif text-subheadline italic leading-5 text-muted">{children}</p>;
}

/** The search field under a large title: a button that opens search (Home), or a field that filters a list. */
export function SearchField({ placeholder, onOpen, value, onChange, trailing }: { placeholder: string; onOpen?: () => void; value?: string; onChange?: (v: string) => void; trailing?: ReactNode }) {
  const [focused, setFocused] = useState(false);
  const box = "flex h-11 items-center gap-2 rounded-panel bg-[color-mix(in_oklab,var(--color-ink)_6.5%,transparent)] px-3 text-body";
  if (onOpen)
    return (
      <div className="px-4 pb-1 pt-2">
        <button type="button" onClick={onOpen} className={`${box} w-full text-left text-faint outline-none focus-visible:ring-2 focus-visible:ring-focus`}>
          <Search size={19} strokeWidth={2.1} aria-hidden />
          <span className="min-w-0 flex-1 truncate">{placeholder}</span>
          {trailing}
        </button>
      </div>
    );
  return (
    <div className="flex items-center gap-2 px-4 pb-1 pt-2">
      <label className={`${box} min-w-0 flex-1 text-faint`}>
        <Search size={19} strokeWidth={2.1} aria-hidden className="flex-none" />
        <span className="sr-only">{placeholder}</span>
        <input
          type="search"
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={placeholder}
          enterKeyHint="search"
          autoComplete="off"
          className="h-full min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-faint [&::-webkit-search-cancel-button]:hidden"
        />
      </label>
      {focused || value ? (
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            onChange?.("");
            (document.activeElement as HTMLElement | null)?.blur();
          }}
          className="h-11 flex-none px-1 text-body text-heading"
        >
          Cancel
        </button>
      ) : null}
    </div>
  );
}

/**
 * A whole screen with nothing in it (Archive, Starred, a folder): one centred block, an icon, a title and a
 * line of help, 280 points wide (§2.1).
 */
export function ScreenEmpty({ icon: Icon, title, body, action }: { icon?: LucideIcon; title: ReactNode; body?: ReactNode; action?: ReactNode }) {
  return (
    <div data-empty-state="" className="mx-auto flex w-[280px] max-w-full flex-col items-center px-0 pb-10 pt-[min(18vh,140px)] text-center">
      {Icon ? (
        <span aria-hidden className="mb-3 grid h-11 w-11 place-items-center text-faint">
          <Icon size={40} strokeWidth={1.5} />
        </span>
      ) : null}
      <h2 className="text-headline font-semibold leading-[22px] text-heading">{title}</h2>
      {body ? <p className="mt-1 text-subheadline leading-5 text-muted">{body}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
