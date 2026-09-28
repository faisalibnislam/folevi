"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check } from "lucide-react";

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  shortcut?: string;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** A choice among several (e.g. which workspace): shows a check and is announced as checked. */
  checked?: boolean;
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
  items: (MenuItem | "separator")[];
  align?: "start" | "end";
  /** Open below the trigger (default) or above it (for controls at the bottom of the screen). */
  side?: "bottom" | "top";
  className?: string;
  triggerClassName?: string;
  menuClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<CSSProperties | null>(null);
  // Rendered at the end of the enclosing modal dialog (so it isn't inert) or <body>.
  const [host, setHost] = useState<HTMLElement | null>(null);
  const fullWidth = /(^|\s)w-full(\s|$)/.test(menuClassName ?? "");
  const id = useId();
  const actionable = items.map((it, i) => (it === "separator" || it.disabled ? -1 : i)).filter((i) => i >= 0);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node) && !buttonRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Place the menu next to the trigger (then flip/shift once its size is known), and keep it there.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = wrapRef.current?.getBoundingClientRect();
      const menu = menuRef.current;
      if (!anchor || !menu) return;
      const gap = 8;
      const margin = 8;
      const w = fullWidth ? anchor.width : menu.offsetWidth;
      const h = menu.offsetHeight;
      const below = window.innerHeight - anchor.bottom - gap - margin;
      const above = anchor.top - gap - margin;
      const up = side === "top" ? !(above < h && below > above) : below < h && above > below;
      let left = align === "end" ? anchor.right - w : anchor.left;
      left = Math.min(Math.max(margin, left), window.innerWidth - w - margin);
      let top = up ? anchor.top - gap - h : anchor.bottom + gap;
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
  }, [open, host, align, side, fullWidth]);

  useEffect(() => {
    if (open && pos) menuRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.focus();
  }, [open, active, pos]);

  const close = (refocus = true) => {
    setOpen(false);
    setPos(null);
    if (refocus) buttonRef.current?.focus();
  };

  return (
    <div ref={wrapRef} className={`relative ${className ?? ""}`}>
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        title={label}
        onClick={() => {
          setActive(actionable[0] ?? 0);
          setHost(buttonRef.current?.closest("dialog") ?? document.body);
          if (open) setPos(null);
          setOpen((o) => !o);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive(actionable[0] ?? 0);
            setHost(buttonRef.current?.closest("dialog") ?? document.body);
            setOpen(true);
          }
        }}
        className={triggerClassName ?? "inline-flex h-8 min-w-8 items-center justify-center rounded-[6px] text-muted transition-colors hover:bg-accent-soft hover:text-heading pointer-coarse:h-11 pointer-coarse:min-w-11"}
      >
        {trigger}
      </button>
      {open && host ? createPortal(
        <div
          ref={menuRef}
          id={id}
          role="menu"
          aria-label={label}
          popover="manual"
          style={pos ?? { position: "fixed", left: 0, top: 0, margin: 0, right: "auto", bottom: "auto", visibility: "hidden" }}
          className={`ui-pop z-[100] min-w-56 overflow-y-auto border-0 p-1.5 text-ink animate-[folio-rise_140ms_var(--ease-folio)] motion-reduce:animate-none ${(menuClassName ?? "").replace(/(^|\s)w-full(?=\s|$)/g, " ")}`}
          onKeyDown={(e) => {
            const pos = actionable.indexOf(active);
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive(actionable[(pos + 1) % actionable.length]!);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive(actionable[(pos - 1 + actionable.length) % actionable.length]!);
            } else if (e.key === "Home") {
              e.preventDefault();
              setActive(actionable[0]!);
            } else if (e.key === "End") {
              e.preventDefault();
              setActive(actionable[actionable.length - 1]!);
            } else if (e.key === "Escape" || e.key === "Tab") {
              e.preventDefault();
              close();
            }
          }}
        >
          {items.map((item, i) =>
            item === "separator" ? (
              <div key={`sep-${i}`} role="separator" className="mx-2 my-1.5 h-px bg-line" />
            ) : (
              <button
                key={`${item.label}-${i}`}
                type="button"
                role={item.checked === undefined ? "menuitem" : "menuitemradio"}
                aria-checked={item.checked}
                data-index={i}
                tabIndex={i === active ? 0 : -1}
                disabled={item.disabled}
                onClick={() => {
                  close(false);
                  item.onSelect();
                }}
                className={`ui-menu-item disabled:opacity-40 pointer-coarse:min-h-11 ${item.danger ? "!text-danger" : ""}`}
              >
                {item.icon ? <span className="text-muted" aria-hidden>{item.icon}</span> : null}
                <span className="flex-1">{item.label}</span>
                {item.shortcut ? <span className="text-xs text-faint">{item.shortcut}</span> : null}
                {item.checked ? <Check size={14} strokeWidth={2.5} aria-hidden className="text-heading" /> : null}
              </button>
            ),
          )}
        </div>,
        host,
      ) : null}
    </div>
  );
}
