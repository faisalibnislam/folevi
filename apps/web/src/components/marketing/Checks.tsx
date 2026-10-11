import type { ReactNode } from "react";
import { cx } from "./ui";

/**
 * Short lines with a check in front, like finished to-dos: the website's main pages say what a feature does
 * this way instead of in paragraphs.
 */
export function Checks({ items, className, size = "md" }: { items: ReactNode[]; className?: string; size?: "sm" | "md" }) {
  if (!items.length) return null;
  return (
    <ul className={cx("mk-checks", size === "sm" ? "space-y-2 text-[14px]" : "space-y-2.5 text-[15px]", className)}>
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-2.5 leading-snug text-ink [&_b]:font-medium [&_b]:text-(--color-heading)">
          <span aria-hidden="true" className="mk-checks-tick">
            <svg viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2.5 6.2 5 8.5l4.5-5" />
            </svg>
          </span>
          <span className="min-w-0">{item}</span>
        </li>
      ))}
    </ul>
  );
}
