"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { FoleviMark } from "@/components/brand/FoleviMark";
import { cx } from "../ui";
import { MAC_MENUS } from "./shortcuts";

/**
 * An illustration of the Mac app's menu bar. Menus open on click; ←/→ move between them and Escape
 * closes. The items are descriptive (they show real shortcuts), not commands, so they're a plain list.
 */
export function MacMenuBar({ initial = "Block" }: { initial?: string }) {
  const baseId = useId();
  const [open, setOpen] = useState<string | null>(initial);
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(null);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  const onKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const count = MAC_MENUS.length;
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      const step = event.key === "ArrowRight" ? 1 : -1;
      let next = (index + step + count) % count;
      // Skip menus hidden at this width (Window is hidden on small screens).
      while (next !== index && !buttons.current[next]?.offsetParent) next = (next + step + count) % count;
      buttons.current[next]?.focus();
      if (open) setOpen(MAC_MENUS[next]!.name);
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(null);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(MAC_MENUS[index]!.name);
    }
  };

  return (
    <div ref={root} className="relative z-20">
      <div className="mk-glass flex h-9 items-center gap-0.5 rounded-[10px] px-1.5 text-[13px] sm:px-2">
        <span className="flex h-7 shrink-0 items-center px-1.5 text-ink sm:px-2" aria-hidden="true">
          <FoleviMark size={15} accent="var(--color-accent)" />
        </span>
        <span className="hidden shrink-0 px-2 font-semibold text-ink sm:inline">Folevi</span>
        <ul className="flex items-center" aria-label="Mac app menus">
          {MAC_MENUS.map((menu, index) => {
            const isOpen = open === menu.name;
            return (
              <li key={menu.name} className={cx("sm:relative", menu.name === "Window" && "hidden sm:block")}>
                <button
                  ref={(node) => {
                    buttons.current[index] = node;
                  }}
                  type="button"
                  aria-expanded={isOpen}
                  aria-controls={`${baseId}-${menu.name}`}
                  onClick={() => setOpen(isOpen ? null : menu.name)}
                  onKeyDown={(event) => onKey(event, index)}
                  className={cx(
                    "h-7 shrink-0 rounded-[6px] px-2 transition-colors duration-100 sm:px-2.5",
                    isOpen ? "bg-accent text-accent-ink" : "text-ink hover:bg-ink/5",
                  )}
                >
                  {menu.name}
                </button>
                <div
                  id={`${baseId}-${menu.name}`}
                  hidden={!isOpen}
                  className="mk-glass mk-appear absolute inset-x-0 top-[42px] rounded-[10px] p-1.5 sm:left-0 sm:right-auto sm:top-[35px] sm:w-[244px]"
                >
                  <ul className="text-[13px]" aria-label={`${menu.name} menu`}>
                    {menu.items.map((item, i) =>
                      item === "separator" ? (
                        <li key={`sep-${i}`} aria-hidden="true" className="mx-2 my-1 h-px bg-line" />
                      ) : (
                        <li key={item.label} className="flex h-7 items-center justify-between gap-4 rounded-[6px] px-2.5 text-ink">
                          <span>{item.label}</span>
                          {item.keys ? <span className="tracking-[0.08em] text-muted">{item.keys}</span> : null}
                        </li>
                      ),
                    )}
                  </ul>
                </div>
              </li>
            );
          })}
        </ul>
        <span className="ml-auto hidden shrink-0 items-center gap-2 pr-1.5 text-muted md:flex" title="Quick Add in the menu bar">
          <span className="flex size-6 items-center justify-center rounded-[5px] bg-ink/5">
            <FoleviMark size={13} />
          </span>
          <span className="text-[12px]">Quick Add</span>
        </span>
      </div>
    </div>
  );
}
