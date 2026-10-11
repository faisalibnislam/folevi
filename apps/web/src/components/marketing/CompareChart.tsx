import Link from "next/link";
import { COMPARE_CHECKED, COMPETITORS, FOLEVI_ROWS, comparePath } from "./content/compare";
import { formatDay } from "./site";
import { cx } from "./ui";

// Every product side by side (the /compare page): one row per topic, Folevi first and highlighted, then each
// product as its own page has it. A topic a product's page doesn't cover reads "Not listed". The topic names
// stay put while the table scrolls sideways (it's wider than a phone).

const KEYS = Object.keys(FOLEVI_ROWS) as (keyof typeof FOLEVI_ROWS)[];
const cell = "border-b mk-hair px-4 py-3.5 align-top text-[13.5px] leading-relaxed";

export function CompareChart() {
  return (
    <div className="mk-card overflow-x-auto" role="region" aria-label="Folevi and other notes apps, side by side" tabIndex={0}>
      <table className="w-full min-w-[1320px] border-collapse text-left">
        <caption className="sr-only">
          Folevi next to {COMPETITORS.map((x) => x.name).join(", ")}, one topic per row. Other products’ details are from their websites on {formatDay(COMPARE_CHECKED)}; each product’s page lists the sources.
        </caption>
        <thead>
          <tr>
            <th scope="col" className="sticky left-0 z-10 w-[160px] bg-(--color-surface) px-4 py-3.5">
              <span className="sr-only">Topic</span>
            </th>
            <th scope="col" className="w-[220px] bg-(--color-surface-sunken) px-4 py-3.5 text-[14px] font-semibold text-(--color-heading)">
              Folevi
            </th>
            {COMPETITORS.map((x) => (
              <th key={x.slug} scope="col" className="w-[190px] px-4 py-3.5 text-[14px] font-semibold text-(--color-heading)">
                <Link href={comparePath(x.slug)} className="mk-link">
                  {x.name}
                </Link>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {KEYS.map((key) => (
            <tr key={key}>
              <th scope="row" className={cx(cell, "sticky left-0 z-10 bg-(--color-surface) font-semibold text-(--color-heading)")}>
                {FOLEVI_ROWS[key].label}
              </th>
              <td className={cx(cell, "bg-(--color-surface-sunken) text-ink")}>{FOLEVI_ROWS[key].value}</td>
              {COMPETITORS.map((x) => {
                const row = x.rows.find((r) => r.key === key);
                return (
                  <td key={x.slug} className={cx(cell, row ? "text-ink" : "text-faint")}>
                    {row ? row.them : "Not listed"}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
