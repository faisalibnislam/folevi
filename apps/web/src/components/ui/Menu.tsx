"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Check } from "lucide-react";
import { keyLabel } from "@/lib/shortcuts";
import { visibleBottom } from "@/lib/hooks/useVisualViewport";
import { nativeApp } from "@/lib/nativeApp";
import { safeInsets } from "@/lib/iphone";
import { feel } from "@/lib/native/ui";
import { heldLiftRect, placeAroundLift, reportLiftPlacement } from "@/lib/native/lift";
import { SPRINGS, prefersReducedMotion } from "@/lib/native/physics";
import { springFrames } from "@/components/iphone/sheetMotion";

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  shortcut?: string;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** A choice among several (e.g. Personal or a workspace): shows a check and is announced as checked. */
  checked?: boolean;
  /** With `checked`: one of several choices that can be on together (a part linking to several screens), so it
   * is announced as a checkbox (menuitemcheckbox) rather than a radio item. */
  multi?: boolean;
  /** A second, quieter line under the label (e.g. your name and plan). */
  description?: string;
  /** Quiet text at the end of the row (e.g. your role in a workspace). */
  detail?: string;
  /** Sits under the item above it (a workspace under its account). */
  indent?: boolean;
  /** A count at the end of the row (unread notifications in another place); 0 shows nothing. */
  badge?: number;
  /** A dot at the end of the row (something waiting there, without a count). */
  dot?: boolean;
  /** Means nothing inside the iPhone, iPad and Android apps (a new browser tab, Back, Reload): left out there. */
  desktopOnly?: boolean;
}

/** A small caps label above a group of items (not focusable). */
export interface MenuHeading {
  heading: string;
}

export type MenuEntry = MenuItem | MenuHeading | "separator";

function isHeading(entry: MenuEntry): entry is MenuHeading {
  return typeof entry !== "string" && "heading" in entry;
}

/** Items that only make sense in a browser or the Mac app, by their words, where a caller hasn't marked them. */
const DESKTOP_ONLY = new Set(["Open in new tab", "Open in new browser tab", "Open in new window", "Back", "Forward", "Reload"]);

/**
 * The entries a menu shows here: inside the iOS and Android apps without the desktop's items (new tabs and
 * windows, Back, Forward, Reload; docs/IOS_POLISH_PLAN.md §7), and without the separators and headings that
 * leaves with nothing between them.
 */
export function menuEntriesHere(items: MenuEntry[], inApp: boolean = nativeApp() !== null): MenuEntry[] {
  if (!inApp) return items;
  const kept = items.filter((it) => it === "separator" || isHeading(it) || !(it.desktopOnly ?? DESKTOP_ONLY.has(it.label)));
  const out: MenuEntry[] = [];
  for (let i = 0; i < kept.length; i++) {
    const it = kept[i]!;
    if (it === "separator" || isHeading(it)) {
      // A break (or a heading) only between items: not first, not doubled, not last.
      const next = kept.slice(i + 1).find((n) => n === "separator" || !isHeading(n));
      const prev = out[out.length - 1];
      if (it === "separator" && (!prev || prev === "separator" || next === undefined || next === "separator")) continue;
      if (isHeading(it) && (next === undefined || next === "separator")) continue;
    }
    out.push(it);
  }
  while (out.length && (out[out.length - 1] === "separator" || isHeading(out[out.length - 1]!))) out.pop();
  return out;
}

/** The iPhone, iPad and Android apps draw menus as iOS does (globals.css, "iOS polish WP3"). */
const appMenus = () => typeof document !== "undefined" && document.documentElement.matches('[data-iphone], [data-native="ios"]');

/**
 * Menu button following the WAI-ARIA menu pattern: arrow keys move, Enter/Space select, Escape closes
 * and returns focus to the trigger. The menu opens in the top layer (Popover API), positioned against the
 * trigger, so no panel, scroll area or stacking order can clip or cover it; it flips and shifts to stay in
 * the window.
 */
export function MenuButton({
  label,
  trigger,
  items,
  align = "end",
  side = "bottom",
  className,
  triggerClassName,
  menuClassName,
}: {
  label: string;
  trigger: ReactNode;
  items: MenuEntry[];
  align?: "start" | "end";
  /** Open below the trigger (default) or above it (for controls at the bottom of the screen). */
  side?: "bottom" | "top";
  className?: string;
  triggerClassName?: string;
  menuClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  // Rendered at the end of the enclosing modal dialog (so it isn't inert) or <body>.
  const [host, setHost] = useState<HTMLElement | null>(null);
  const id = useId();

  const show = () => {
    setHost(buttonRef.current?.closest("dialog") ?? document.body);
    setOpen(true);
  };
  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  };

  return (
    // Positioned by the caller (absolute, fixed…) or relative, as the menu's anchor.
    <div ref={wrapRef} className={/\b(absolute|fixed|sticky)\b/.test(className ?? "") ? className : `relative ${className ?? ""}`}>
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        title={label}
        onClick={() => (open ? close(false) : show())}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            show();
          } else if (e.key === "Escape" && open) {
            // Focus stays here when every item is unavailable: Escape still closes the menu (and only that).
            e.preventDefault();
            e.stopPropagation();
            close();
          }
        }}
        className={triggerClassName ?? "inline-flex h-8 min-w-8 items-center justify-center rounded-chip text-muted transition-colors hover:bg-accent-soft hover:text-heading pointer-coarse:h-11 pointer-coarse:min-w-11"}
      >
        {trigger}
      </button>
      {open && host ? (
        <MenuPanel
          id={id}
          label={label}
          items={items}
          host={host}
          // Opened by holding a card or row on a touch screen (lib/touchContextMenu.ts marks what lifted): beside
          // that, not over it from its hidden "…".
          anchor={() => (wrapRef.current?.closest<HTMLElement>("[data-held-lift]") ?? wrapRef.current)?.getBoundingClientRect() ?? null}
          beside={() => !!wrapRef.current?.closest("[data-held-lift]")}
          ignore={buttonRef}
          align={align}
          side={side}
          menuClassName={menuClassName}
          onClose={close}
        />
      ) : null}
    </div>
  );
}

/**
 * A right-click (or Shift+F10 / context-menu key) menu at a point: the same menu as MenuButton's, opened
 * where the pointer is. Escape or an outside click closes it and focus returns to where it was.
 */
export function ContextMenu({ at, label, items, onClose, host }: { at: { x: number; y: number }; label: string; items: (MenuItem | "separator")[]; onClose: () => void; /** Where it renders: inside an open dialog it must be in the dialog to be usable. */ host?: HTMLElement }) {
  const id = useId();
  // Whatever had focus when the menu opened (the card), to return to on Escape.
  const [opener] = useState(() => (document.activeElement instanceof HTMLElement ? document.activeElement : null));
  return (
    <MenuPanel
      id={id}
      label={label}
      items={items}
      host={host ?? document.body}
      anchor={() => new DOMRect(at.x, at.y, 0, 0)}
      align="start"
      side="bottom"
      onClose={(refocus) => {
        onClose();
        if (refocus && opener?.isConnected) opener.focus({ preventScroll: true });
      }}
    />
  );
}

function MenuPanel({
  id,
  label,
  items,
  host,
  anchor,
  ignore,
  align,
  side,
  menuClassName,
  onClose,
  beside,
}: {
  id: string;
  label: string;
  items: MenuEntry[];
  host: HTMLElement;
  anchor: () => DOMRect | null;
  /** Clicks here don't count as "outside" (the trigger toggles the menu itself). */
  ignore?: RefObject<HTMLElement | null>;
  align: "start" | "end";
  side: "bottom" | "top";
  menuClassName?: string;
  onClose: (refocus?: boolean) => void;
  /** Keep clear of the anchor (a lifted card): scroll inside the room beside it rather than cover it. */
  beside?: () => boolean;
}) {
  const besideRef = useRef(beside);
  besideRef.current = beside;
  const [inApp] = useState(() => nativeApp() !== null);
  items = menuEntriesHere(items, inApp);
  // A leading column for the checkmarks when any item can be checked (iOS puts them before the words).
  const checks = items.some((it) => it !== "separator" && !isHeading(it) && it.checked !== undefined);
  const actionable = items.map((it, i) => (it === "separator" || isHeading(it) || it.disabled ? -1 : i)).filter((i) => i >= 0);
  const [active, setActive] = useState(actionable[0] ?? 0);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<CSSProperties | null>(null);
  const fullWidth = /(^|\s)w-full(\s|$)/.test(menuClassName ?? "");
  const anchorRef = useRef(anchor);
  anchorRef.current = anchor;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node) && !ignore?.current?.contains(e.target as Node)) onCloseRef.current(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [ignore]);

  // Place the menu next to its anchor (then flip/shift once its size is known), and keep it there.
  useLayoutEffect(() => {
    const place = () => {
      const a = anchorRef.current();
      const menu = menuRef.current;
      if (!a || !menu) return;
      const gap = a.width || a.height ? 8 : 2;
      const margin = 8;
      // Opened by holding something (lib/touchContextMenu.ts): never over what lifted (in the app it's the app's
      // picture, drawn above the page), below, above or beside it, on screen (WP0, lib/native/lift.ts).
      const held = heldLiftRect();
      if (held) {
        const view = { left: margin, top: margin + safeInsets().top, right: window.innerWidth - margin, bottom: visibleBottom() - margin };
        const size = { width: fullWidth ? held.right - held.left : menu.offsetWidth, height: Math.max(menu.offsetHeight, menu.scrollHeight) };
        const p = placeAroundLift(held, size, view, align);
        setPos({ position: "fixed", left: p.left, top: p.top, width: fullWidth ? size.width : undefined, maxHeight: p.maxHeight, margin: 0, right: "auto", bottom: "auto", transformOrigin: p.origin });
        reportLiftPlacement(p);
        return;
      }
      const w = fullWidth ? a.width : menu.offsetWidth;
      const h = menu.offsetHeight;
      // Above the on-screen keyboard, where there is one.
      const bottom = visibleBottom();
      const below = bottom - a.bottom - gap - margin;
      const above = a.top - gap - margin;
      const up = side === "top" ? !(above < h && below > above) : below < h && above > below;
      let left = align === "end" ? a.right - w : a.left;
      left = Math.min(Math.max(margin, left), window.innerWidth - w - margin);
      let top = up ? a.top - gap - h : a.bottom + gap;
      // (In the iPhone app, below the status bar.)
      const safeTop = safeInsets().top;
      // Beside a lifted card: in the roomier side of it, scrolling there if it's too long, unless that side is
      // too small to be a menu at all.
      const room = up ? a.top - gap - margin - safeTop : below;
      if (besideRef.current?.() && h > room && room >= 160) {
        top = up ? margin + safeTop : a.bottom + gap;
        setPos({ position: "fixed", left, top, width: fullWidth ? w : undefined, maxHeight: room, margin: 0, right: "auto", bottom: "auto", transformOrigin: `${align === "end" ? "right" : "left"} ${up ? "bottom" : "top"}` });
        return;
      }
      top = Math.min(Math.max(margin + safeTop, top), bottom - h - margin);
      setPos({ position: "fixed", left, top, width: fullWidth ? w : undefined, maxHeight: bottom - margin * 2 - safeTop, margin: 0, right: "auto", bottom: "auto", transformOrigin: `${align === "end" ? "right" : "left"} ${up ? "bottom" : "top"}` });
    };
    try {
      if (menuRef.current && !menuRef.current.matches(":popover-open")) menuRef.current.showPopover();
    } catch {
      /* Popover API missing: the menu still renders, positioned fixed. */
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    window.visualViewport?.addEventListener("resize", place);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      window.visualViewport?.removeEventListener("resize", place);
    };
  }, [host, align, side, fullWidth]);

  useEffect(() => {
    if (pos) menuRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.focus();
  }, [active, pos]);

  // In the apps (§2.4): the menu grows out of what opened it on a spring (scale 0.5 to 1), and when it closes a
  // picture of it shrinks to 0.9 and fades over 160 ms while whatever was chosen goes ahead. Reduce Motion: fades.
  const entered = useRef(false);
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!pos || entered.current || !menu || !appMenus()) return;
    entered.current = true;
    if (prefersReducedMotion()) {
      menu.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150, easing: "linear" });
      return;
    }
    const { progress, ms } = springFrames(SPRINGS.menu);
    menu.animate(
      progress.map((k, i) => ({ transform: `scale(${0.5 + 0.5 * k})`, opacity: Math.min(1, (i / Math.max(1, progress.length - 1)) * 3.2) })),
      { duration: ms, easing: "linear" },
    );
  }, [pos]);
  useLayoutEffect(() => {
    const menu = menuRef.current;
    const opened = performance.now();
    return () => {
      // (A menu shown for a moment only, React's development double mount, has nothing to fade.)
      if (!menu || !appMenus() || performance.now() - opened < 80 || !host.isConnected) return;
      const ghost = menu.cloneNode(true) as HTMLElement;
      ghost.removeAttribute("id");
      ghost.removeAttribute("role");
      ghost.setAttribute("aria-hidden", "true");
      ghost.inert = true;
      ghost.style.pointerEvents = "none";
      host.appendChild(ghost);
      try {
        ghost.showPopover();
      } catch {
        /* Popover API missing: it's fixed in place already. */
      }
      const fade = prefersReducedMotion()
        ? ghost.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 150, easing: "linear", fill: "forwards" })
        : ghost.animate([{ opacity: 1, transform: "scale(1)" }, { opacity: 0, transform: "scale(0.9)" }], { duration: 160, easing: "ease-in", fill: "forwards" });
      fade.onfinish = () => ghost.remove();
      fade.oncancel = () => ghost.remove();
    };
  }, [host]);

  return createPortal(
    <div
      ref={menuRef}
      id={id}
      role="menu"
      aria-label={label}
      popover="manual"
      data-checks={checks || undefined}
      style={pos ?? { position: "fixed", left: 0, top: 0, margin: 0, right: "auto", bottom: "auto", visibility: "hidden" }}
      className={`ui-pop z-[100] min-w-56 overflow-y-auto border-0 p-1.5 text-ink animate-[folio-rise_140ms_var(--ease-folio)] motion-reduce:animate-none ${(menuClassName ?? "").replace(/(^|\s)w-full(?=\s|$)/g, " ")}`}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        const at = actionable.indexOf(active);
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setActive(actionable[(at + 1) % actionable.length]!);
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          setActive(actionable[(at - 1 + actionable.length) % actionable.length]!);
        } else if (e.key === "Home") {
          e.preventDefault();
          setActive(actionable[0]!);
        } else if (e.key === "End") {
          e.preventDefault();
          setActive(actionable[actionable.length - 1]!);
        } else if (e.key === "Escape" || e.key === "Tab") {
          e.preventDefault();
          // Don't let Escape also clear a selection or close a panel behind the menu.
          e.stopPropagation();
          onClose();
        }
      }}
    >
      {items.map((item, i) =>
        item === "separator" ? (
          <div key={`sep-${i}`} role="separator" className="mx-2 my-1.5 h-px bg-line" />
        ) : isHeading(item) ? (
          // Visual only: the items it labels name themselves (a menu may only hold items, groups and separators).
          <div key={`heading-${i}`} aria-hidden className="ui-caps px-2.5 pb-1 pt-2">
            {item.heading}
          </div>
        ) : (
          <button
            key={`${item.label}-${i}`}
            type="button"
            role={item.checked === undefined ? "menuitem" : item.multi ? "menuitemcheckbox" : "menuitemradio"}
            aria-checked={item.checked}
            // The label names the item; the quieter lines are read as its description.
            aria-label={item.description || item.detail ? item.label : undefined}
            aria-description={[item.description, item.detail, item.badge ? `${item.badge} unread` : null, item.dot && !item.badge ? "something new" : null].filter(Boolean).join(" · ") || undefined}
            data-index={i}
            tabIndex={i === active ? 0 : -1}
            disabled={item.disabled}
            onClick={() => {
              // Focus goes back to the menu button first, so a dialog the item opens returns it there when it closes.
              onClose(true);
              if (item.danger) feel("destructive");
              else if (item.checked !== undefined) feel("choose");
              item.onSelect();
            }}
            // A row with a second line (a workspace and its plan) gets room to breathe.
            className={`ui-menu-item disabled:opacity-40 pointer-coarse:min-h-11 ${item.description ? "!gap-3 py-2" : ""} ${item.indent ? "!pl-8" : ""} ${item.danger ? "!text-danger" : ""}`}
          >
            {/* The checkmark: at the end on the desktop; in the apps, in a column before the words (globals.css). */}
            {checks ? (
              <span data-menu-part="check" aria-hidden className={item.checked ? "order-last flex-none text-heading" : "hidden"}>
                {item.checked ? <Check size={14} strokeWidth={2.5} /> : null}
              </span>
            ) : null}
            {item.icon ? <span data-menu-part="icon" className="text-muted" aria-hidden>{item.icon}</span> : null}
            {item.description ? (
              <span data-menu-part="label" className="min-w-0 flex-1 leading-tight">
                <span className="block truncate">{item.label}</span>
                <span data-menu-part="description" className="mt-0.5 block truncate text-[11.5px] text-muted">{item.description}</span>
              </span>
            ) : (
              <span data-menu-part="label" className="flex-1">{item.label}</span>
            )}
            {item.detail ? <span data-menu-part="detail" className="flex-none text-xs text-muted">{item.detail}</span> : null}
            {item.badge ? (
              <span data-menu-part="badge" aria-hidden className="grid h-4 min-w-4 flex-none place-items-center rounded-chip bg-coral px-1 text-[10px] font-semibold leading-none text-white">
                {item.badge > 99 ? "99+" : item.badge}
              </span>
            ) : item.dot ? (
              <span data-menu-part="badge" aria-hidden className="h-2 w-2 flex-none rounded-tiny bg-coral" />
            ) : null}
            {item.shortcut ? <span className="text-xs text-faint pointer-coarse:hidden">{keyLabel(item.shortcut)}</span> : null}
          </button>
        ),
      )}
    </div>,
    host,
  );
}
