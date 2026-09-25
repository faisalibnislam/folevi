"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  shortcut?: string;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}

/**
 * Menu button following the WAI-ARIA menu pattern: arrow keys move, Enter/Space select, Escape closes
 * and returns focus to the trigger.
 */
export function MenuButton({
  label,
  trigger,
  items,
  align = "end",
  className,
}: {
  label: string;
  trigger: ReactNode;
  items: (MenuItem | "separator")[];
  align?: "start" | "end";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
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

  useEffect(() => {
    if (open) menuRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.focus();
  }, [open, active]);

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  };

  return (
    <div className={`relative ${className ?? ""}`}>
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
          setOpen((o) => !o);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive(actionable[0] ?? 0);
            setOpen(true);
          }
        }}
        className="inline-flex h-8 min-w-8 items-center justify-center rounded-[6px] text-muted hover:bg-[color-mix(in_oklab,var(--color-ink)_6%,transparent)] hover:text-ink pointer-coarse:h-11 pointer-coarse:min-w-11"
      >
        {trigger}
      </button>
      {open ? (
        <div
          ref={menuRef}
          id={id}
          role="menu"
          aria-label={label}
          className={`absolute z-50 mt-1 min-w-52 rounded-[10px] border border-line bg-raised p-1 shadow-[0_16px_48px_-20px_rgba(0,0,0,0.45)] ${align === "end" ? "right-0" : "left-0"}`}
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
              <div key={`sep-${i}`} role="separator" className="my-1 h-px bg-line" />
            ) : (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                data-index={i}
                tabIndex={i === active ? 0 : -1}
                disabled={item.disabled}
                onClick={() => {
                  close(false);
                  item.onSelect();
                }}
                className={`flex w-full items-center gap-2.5 rounded-[6px] px-2.5 py-1.5 text-left text-sm outline-none focus:bg-accent-soft focus:text-accent-soft-ink disabled:opacity-40 pointer-coarse:py-3 ${item.danger ? "text-danger" : "text-ink"}`}
              >
                {item.icon ? <span className="text-muted" aria-hidden>{item.icon}</span> : null}
                <span className="flex-1">{item.label}</span>
                {item.shortcut ? <span className="text-xs text-faint">{item.shortcut}</span> : null}
              </button>
            ),
          )}
        </div>
      ) : null}
    </div>
  );
}
