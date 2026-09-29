import type { ReactNode } from "react";
import { container, cx } from "./ui";

export type TocItem = { id: string; label: string };

/** Long-form layout: an "On this page" list, like the app's table of contents, beside readable prose. */
export function DocShell({ toc, children, className }: { toc: TocItem[]; children: ReactNode; className?: string }) {
  return (
    <div className={cx(container, "grid gap-10 pb-20 pt-2 sm:pb-28 lg:grid-cols-[228px_minmax(0,1fr)] lg:gap-16", className)}>
      <nav aria-label="On this page" className="self-start lg:sticky lg:top-24">
        <p className="mk-caps px-2.5 pb-2 lg:pl-3.5">On this page</p>
        <ol className="flex flex-wrap gap-1 border-b mk-hair pb-6 lg:block lg:space-y-0.5 lg:border-b-0 lg:border-l lg:pb-0">
          {toc.map((item) => (
            <li key={item.id}>
              <a
                href={`#${item.id}`}
                className="flex min-h-11 items-center rounded-[6px] px-2.5 py-1 text-[14px] leading-snug text-muted transition-colors duration-150 hover:bg-(--color-surface-sunken) hover:text-(--color-heading) max-lg:bg-(--color-surface-sunken) lg:-ml-px lg:min-h-8 lg:rounded-l-none lg:border-l lg:border-transparent lg:pl-3.5 lg:hover:border-(--color-heading)"
              >
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
