"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, MoreHorizontal, Search } from "lucide-react";
import { AppLink } from "@/lib/app/router";
import { useLocalStorage } from "@/lib/hooks/useEngine";
import { MenuButton, type MenuEntry } from "@/components/ui/Menu";

/**
 * A plain list row, as on Home (All notes, a folder): an icon, the label, a count and a chevron, with a
 * hairline under it that starts where the label does.
 */
export function ListRow({ href, onClick, icon, label, detail, chevron = true, onContextMenu, ariaLabel, children }: { href?: string; onClick?: () => void; icon?: ReactNode; label: ReactNode; detail?: ReactNode; chevron?: boolean; onContextMenu?: (e: React.MouseEvent) => void; ariaLabel?: string; children?: ReactNode }) {
  const inner = (
    <>
      {icon ? <span aria-hidden className="grid w-7 flex-none place-items-center text-muted [&_svg]:h-[22px] [&_svg]:w-[22px]">{icon}</span> : null}
      <span className="ui-row-sep flex min-h-[50px] min-w-0 flex-1 items-center gap-2 pr-1">
        <span className="min-w-0 flex-1 truncate text-[17px] text-ink">{label}</span>
        {detail !== undefined && detail !== null && detail !== "" ? <span className="flex-none text-[17px] tabular-nums text-muted">{detail}</span> : null}
        {chevron ? <ChevronRight size={18} strokeWidth={2.2} aria-hidden className="flex-none text-faint" /> : null}
      </span>
      {children}
    </>
  );
  const cls = "flex w-full items-center gap-3 pl-5 pr-4 text-left outline-none transition-colors active:bg-[var(--liquid-press)] focus-visible:bg-[var(--liquid-active)]";
  if (href)
    return (
      <AppLink href={href} onClick={onClick} onContextMenu={onContextMenu} aria-label={ariaLabel} className={cls}>
        {inner}
      </AppLink>
    );
  return (
    <button type="button" onClick={onClick} onContextMenu={onContextMenu} aria-label={ariaLabel} className={cls}>
      {inner}
    </button>
  );
}

/**
 * A section on Home: its title (a link to the whole list, with a chevron), a "…" menu, and its rows, or a
 * quiet grey box saying what will be here. `collapsible` sections fold away (remembered on this device).
 */
export function HomeSection({ id, title, href, menu, children, empty, collapsible, defaultOpen = true }: { id: string; title: string; href?: string; menu?: MenuEntry[]; children?: ReactNode; empty?: ReactNode; collapsible?: boolean; defaultOpen?: boolean }) {
  const [stored, setStored] = useLocalStorage<boolean | null>(`folevi:iphone-home:${id}`, null);
  const open = collapsible ? (stored ?? defaultOpen) : true;
  const heading = (
    <>
      <span className="ui-display text-[22px] leading-7 text-heading">{title}</span>
      {collapsible ? (
        open ? <ChevronDown size={19} strokeWidth={2.4} aria-hidden className="text-faint" /> : <ChevronRight size={19} strokeWidth={2.4} aria-hidden className="text-faint" />
      ) : href ? (
        <ChevronRight size={19} strokeWidth={2.4} aria-hidden className="text-faint" />
      ) : null}
    </>
  );
  return (
    <section aria-labelledby={`home-${id}`} className="mt-7">
      <div className="flex items-center gap-2 pl-5 pr-3">
        <h2 id={`home-${id}`} className="min-w-0 flex-1">
          {collapsible ? (
            <button type="button" aria-expanded={open} onClick={() => setStored(!open)} className="flex h-11 items-center gap-1 rounded-chip outline-none focus-visible:ring-2 focus-visible:ring-focus">
              {heading}
            </button>
          ) : href ? (
            <AppLink href={href} className="flex h-11 w-fit items-center gap-1 rounded-chip outline-none focus-visible:ring-2 focus-visible:ring-focus">
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
            triggerClassName="grid h-11 w-11 place-items-center rounded-capsule text-faint outline-none active:bg-[var(--liquid-press)] focus-visible:ring-2 focus-visible:ring-focus"
            trigger={<MoreHorizontal size={22} aria-hidden />}
            items={menu}
          />
        ) : null}
      </div>
      {open ? <div className="mt-1">{empty ?? children}</div> : null}
    </section>
  );
}

/** The quiet grey box an empty section shows. */
export function EmptyBox({ children }: { children: ReactNode }) {
  return <p className="mx-4 mt-1 grid min-h-[88px] place-items-center rounded-container bg-[color-mix(in_oklab,var(--color-ink)_4.5%,transparent)] px-6 text-center text-[15px] italic text-faint">{children}</p>;
}

/** The search field under a large title: a button that opens search (Home), or a field that filters a list. */
export function SearchField({ placeholder, onOpen, value, onChange, trailing }: { placeholder: string; onOpen?: () => void; value?: string; onChange?: (v: string) => void; trailing?: ReactNode }) {
  const [focused, setFocused] = useState(false);
  const box = "flex h-11 items-center gap-2 rounded-panel bg-[color-mix(in_oklab,var(--color-ink)_6.5%,transparent)] px-3 text-[17px]";
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
          className="h-11 flex-none px-1 text-[17px] text-heading"
        >
          Cancel
        </button>
      ) : null}
    </div>
  );
}
