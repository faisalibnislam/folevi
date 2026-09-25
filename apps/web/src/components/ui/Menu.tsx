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
        className="inline-flex h-8 min-w-8 items-center justify-center rounded-full text-muted transition-colors hover:bg-accent-soft hover:text-heading pointer-coarse:h-11 pointer-coarse:min-w-11"
      >
        {trigger}
      </button>
      {open ? (
        <div
          ref={menuRef}
          id={id}
          role="menu"
          aria-label={label}
          className={`ui-pop absolute z-50 mt-2 min-w-56 p-1.5 animate-[folio-rise_140ms_var(--ease-folio)] ${align === "end" ? "right-0 origin-top-right" : "left-0 origin-top-left"}`}
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
                className={`ui-menu-item disabled:opacity-40 pointer-coarse:min-h-11 ${item.danger ? "!text-danger" : ""}`}
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
