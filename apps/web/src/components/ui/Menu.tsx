"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Check } from "lucide-react";
import { keyLabel } from "@/lib/shortcuts";

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  shortcut?: string;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** A choice among several (e.g. Personal or a workspace): shows a check and is announced as checked. */
  checked?: boolean;
  /** A second, quieter line under the label (e.g. your name and plan). */
  description?: string;
  /** Quiet text at the end of the row (e.g. your role in a workspace). */
  detail?: string;
}

/** A small caps label above a group of items (not focusable). */
export interface MenuHeading {
  heading: string;
}

export type MenuEntry = MenuItem | MenuHeading | "separator";

function isHeading(entry: MenuEntry): entry is MenuHeading {
  return typeof entry !== "string" && "heading" in entry;
}

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
          }
        }}
        className={triggerClassName ?? "inline-flex h-8 min-w-8 items-center justify-center rounded-[6px] text-muted transition-colors hover:bg-accent-soft hover:text-heading pointer-coarse:h-11 pointer-coarse:min-w-11"}
      >
        {trigger}
      </button>
      {open && host ? (
        <MenuPanel
          id={id}
          label={label}
          items={items}
          host={host}
          anchor={() => wrapRef.current?.getBoundingClientRect() ?? null}
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
export function ContextMenu({ at, label, items, onClose }: { at: { x: number; y: number }; label: string; items: (MenuItem | "separator")[]; onClose: () => void }) {
  const id = useId();
  // Whatever had focus when the menu opened (the card), to return to on Escape.
  const [opener] = useState(() => (document.activeElement instanceof HTMLElement ? document.activeElement : null));
  return (
    <MenuPanel
      id={id}
      label={label}
      items={items}
      host={document.body}
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
}) {
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
      const w = fullWidth ? a.width : menu.offsetWidth;
      const h = menu.offsetHeight;
      const below = window.innerHeight - a.bottom - gap - margin;
      const above = a.top - gap - margin;
      const up = side === "top" ? !(above < h && below > above) : below < h && above > below;
      let left = align === "end" ? a.right - w : a.left;
      left = Math.min(Math.max(margin, left), window.innerWidth - w - margin);
      let top = up ? a.top - gap - h : a.bottom + gap;
      top = Math.min(Math.max(margin, top), window.innerHeight - h - margin);
      setPos({ position: "fixed", left, top, width: fullWidth ? w : undefined, maxHeight: window.innerHeight - margin * 2, margin: 0, right: "auto", bottom: "auto", transformOrigin: `${align === "end" ? "right" : "left"} ${up ? "bottom" : "top"}` });
    };
    try {
      if (menuRef.current && !menuRef.current.matches(":popover-open")) menuRef.current.showPopover();
    } catch {
      /* Popover API missing: the menu still renders, positioned fixed. */
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [host, align, side, fullWidth]);

  useEffect(() => {
    if (pos) menuRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.focus();
  }, [active, pos]);

  return createPortal(
    <div
      ref={menuRef}
      id={id}
      role="menu"
      aria-label={label}
      popover="manual"
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
            role={item.checked === undefined ? "menuitem" : "menuitemradio"}
            aria-checked={item.checked}
            // The label names the item; the quieter lines are read as its description.
            aria-label={item.description || item.detail ? item.label : undefined}
            aria-description={[item.description, item.detail].filter(Boolean).join(" · ") || undefined}
            data-index={i}
            tabIndex={i === active ? 0 : -1}
            disabled={item.disabled}
            onClick={() => {
              // Focus goes back to the menu button first, so a dialog the item opens returns it there when it closes.
              onClose(true);
              item.onSelect();
            }}
            className={`ui-menu-item disabled:opacity-40 pointer-coarse:min-h-11 ${item.danger ? "!text-danger" : ""}`}
          >
            {item.icon ? <span className="text-muted" aria-hidden>{item.icon}</span> : null}
            {item.description ? (
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block truncate">{item.label}</span>
                <span className="block truncate text-[11.5px] text-muted">{item.description}</span>
              </span>
            ) : (
              <span className="flex-1">{item.label}</span>
            )}
            {item.detail ? <span className="flex-none text-xs text-muted">{item.detail}</span> : null}
            {item.shortcut ? <span className="text-xs text-faint">{keyLabel(item.shortcut)}</span> : null}
            {item.checked ? <Check size={14} strokeWidth={2.5} aria-hidden className="text-heading" /> : null}
          </button>
        ),
      )}
    </div>,
    host,
  );
}
