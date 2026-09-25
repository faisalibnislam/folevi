import type { ReactNode } from "react";
import { container, cx } from "./ui";

export type TocItem = { id: string; label: string };

/** Long-form layout: a sticky "On this page" card beside readable prose. */
export function DocShell({ toc, children, className }: { toc: TocItem[]; children: ReactNode; className?: string }) {
  return (
    <div className={cx(container, "grid gap-10 pb-20 pt-4 sm:pb-28 lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-16", className)}>
      <nav aria-label="On this page" className="mk-card self-start rounded-[22px] p-3 lg:sticky lg:top-28">
        <p className="px-3 pb-2 pt-1.5 text-[11px] font-semibold uppercase tracking-[0.07em] text-muted">On this page</p>
        <ol className="flex flex-wrap gap-1 lg:block lg:space-y-0.5">
          {toc.map((item, index) => (
            <li key={item.id}>
              <a
                href={`#${item.id}`}
                className="flex min-h-11 items-center gap-2.5 rounded-[12px] lg:min-h-10 px-3 py-1.5 text-[14px] leading-snug text-muted transition-colors duration-150 hover:bg-accent-soft hover:text-(--color-heading)"
              >
                <span className="text-[11px] font-medium tabular-nums text-faint">{String(index + 1).padStart(2, "0")}</span>
                {item.label}
              </a>
            </li>
          ))}
        </ol>
      </nav>
      <div className="mk-prose min-w-0 max-w-[700px]">{children}</div>
    </div>
  );
}
