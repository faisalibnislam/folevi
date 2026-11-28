"use client";

import { useEffect, useRef, useState } from "react";
import { PlatformMark, type PlatformMarkName } from "./PlatformMark";
import { container, cx } from "./ui";

export type DownloadsBarItem = {
  /** The section's id on the page. */
  id: string;
  title: string;
  mark: PlatformMarkName;
  beta?: boolean;
};

/**
 * The downloads page's platform bar: it stays at the bottom of the window, one button per platform with its
 * real mark, and marks the platform whose section is in view. Where the names don't fit (phones, narrow
 * windows) the row scrolls sideways and keeps that platform in sight. Without script it is a row of jump links.
 */
export function DownloadsBar({ items }: { items: DownloadsBarItem[] }) {
  const [current, setCurrent] = useState<string | null>(null);
  const list = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const sections = items.map((item) => document.getElementById(item.id)).filter((el): el is HTMLElement => el !== null);
    if (sections.length === 0 || typeof IntersectionObserver === "undefined") return;
    const visible = new Map<string, number>();
    // A section counts once it reaches the middle band of the window; the highest one in the band wins.
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.set(entry.target.id, entry.boundingClientRect.top);
          else visible.delete(entry.target.id);
        }
        const top = [...visible.entries()].sort((a, b) => a[1] - b[1])[0];
        setCurrent(top ? top[0] : null);
      },
      { rootMargin: "-35% 0px -55% 0px" },
    );
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [items]);

  // Keep the current platform in sight when the row scrolls (sideways only: the page never moves).
  useEffect(() => {
    const row = list.current;
    const link = current ? row?.querySelector<HTMLElement>(`a[href="#${current}"]`) : null;
    if (!row || !link || row.scrollWidth <= row.clientWidth) return;
    const left = link.offsetLeft - (row.clientWidth - link.offsetWidth) / 2;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    row.scrollTo({ left, behavior: reduce ? "auto" : "smooth" });
  }, [current]);

  return (
    <nav aria-label="Platforms" className={cx(container, "pointer-events-none sticky bottom-3 z-30 mt-2 flex justify-center sm:bottom-5")}>
      <ul ref={list} className="mk-downloads-bar pointer-events-auto flex max-w-full gap-1 overflow-x-auto rounded-control p-1">
        {items.map((item) => (
          <li key={item.id} className="flex-none">
            <a
              href={`#${item.id}`}
              aria-current={current === item.id ? "location" : undefined}
              className={cx(
                "mk-downloads-bar-link flex h-11 items-center gap-2 whitespace-nowrap rounded-control px-3 text-[14px] font-medium sm:h-10",
                current === item.id && "is-active",
              )}
            >
              <PlatformMark name={item.mark} size={18} className="shrink-0" />
              {item.title}
              {item.beta ? <span className="sr-only"> (Early Beta)</span> : null}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
