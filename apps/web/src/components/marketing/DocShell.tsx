import type { ReactNode } from "react";
import { container, cx } from "./ui";

export type TocItem = { id: string; label: string };

/** Long-form layout: a sticky "On this page" index beside readable prose. */
export function DocShell({ toc, children, className }: { toc: TocItem[]; children: ReactNode; className?: string }) {
  return (
    <div className={cx(container, "grid gap-10 py-14 sm:py-20 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-16", className)}>
      <nav aria-label="On this page" className="lg:sticky lg:top-24 lg:self-start">
        <p className="text-[12px] font-medium uppercase tracking-[0.14em] text-muted">On this page</p>
        <ol className="mt-4 flex flex-wrap gap-x-4 gap-y-1 border-l-0 lg:block lg:space-y-0.5 lg:border-l lg:border-line">
          {toc.map((item, index) => (
            <li key={item.id}>
              <a
                href={`#${item.id}`}
                className="-ml-px flex min-h-9 items-center gap-2.5 border-l border-transparent text-[14px] text-muted transition-colors duration-150 hover:text-ink lg:pl-4 lg:hover:border-ink"
              >
                <span className="font-mono text-[11px] text-faint">{String(index + 1).padStart(2, "0")}</span>
                {item.label}
              </a>
            </li>
          ))}
        </ol>
      </nav>
      <div className="mk-prose max-w-[720px] min-w-0">{children}</div>
    </div>
  );
}
