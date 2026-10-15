import type { ReactNode } from "react";
import { container, cx } from "./ui";

export type TocItem = { id: string; label: string };

/**
 * Long-form layout: the text reads as one note (a single tall card), with its "On this page" list, like the
 * app's table of contents, in a card of its own beside it (it stays in view while the page scrolls).
 */
export function DocShell({ toc, children, className }: { toc: TocItem[]; children: ReactNode; className?: string }) {
  return (
    <div className={cx(container, "grid gap-(--mk-stack-gap) xl:grid-cols-[260px_minmax(0,1fr)]", className)}>
      <nav aria-label="On this page" className="mk-box self-start px-3 py-4 xl:sticky xl:top-8">
        <p className="mk-caps px-2.5 pb-2 xl:pl-3.5">On this page</p>
        <ol className="flex flex-wrap gap-1 mk-hair xl:block xl:space-y-0.5 xl:border-l">
          {toc.map((item) => (
            <li key={item.id}>
              <a
                href={`#${item.id}`}
                className="flex min-h-11 items-center rounded-chip px-2.5 py-1 text-[14px] leading-snug text-muted transition-colors duration-150 hover:bg-(--color-surface-sunken) hover:text-(--color-heading) max-xl:bg-(--color-surface-sunken) xl:-ml-px xl:min-h-8 xl:rounded-l-none xl:border-l xl:border-transparent xl:pl-3.5 xl:hover:border-(--color-heading)"
              >
                {item.label}
              </a>
            </li>
          ))}
        </ol>
      </nav>
      <div className="mk-box min-w-0 px-5 py-8 sm:px-10 sm:py-10 lg:px-14 lg:py-12">
        <div className="mk-prose max-w-[700px]">{children}</div>
      </div>
    </div>
  );
}
