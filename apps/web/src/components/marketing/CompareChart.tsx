import Link from "next/link";
import { Check, Minus, X } from "lucide-react";
import { PLAN_CATALOG, PRICES, formatPrice } from "@/lib/plans";
import { BUILT_IN_TEMPLATES } from "@/lib/templates";
import { COMPARE_CHECKED, COMPARE_LAST_CHECKED, COMPETITORS, comparePath } from "./content/compare";
import { formatDay } from "./site";
import { cx } from "./ui";
import { Sticker } from "./fun";

// Every product side by side (the /compare page), short: a tick, a cross or a dash and a few words per cell.
// Each cell condenses a sourced fact on that product's own page (content/compare.tsx), where the full
// sentence and its source are. Folevi's column comes from the plan catalog and what the apps do today.

type Mark = "yes" | "no" | "some" | "none";
type Cell = { mark: Mark; text: string };
type Row = { label: string; folevi: Cell; them: Record<string, Cell> };

const VERSION_DAYS = PLAN_CATALOG.personal_free.entitlements.versionHistoryDays;

const ROWS: Row[] = [
  {
    label: "Free plan",
    folevi: { mark: "yes", text: "Free apps, no limit on notes" },
    them: { notion: { mark: "yes", text: "Free, 5 MB uploads" }, obsidian: { mark: "yes", text: "Free app, even for work" } },
  },
  {
    label: "No account needed",
    folevi: { mark: "yes", text: "In the Mac, iPhone and iPad apps" },
    them: { notion: { mark: "no", text: "Notion account" }, obsidian: { mark: "yes", text: "No sign-up" } },
  },
  {
    label: "Your notes as files",
    folevi: { mark: "yes", text: "iCloud, Dropbox, Drive or any folder" },
    them: { notion: { mark: "none", text: "Not listed" }, obsidian: { mark: "yes", text: "Markdown in a folder" } },
  },
  {
    label: "Paid plans from",
    folevi: { mark: "yes", text: `${formatPrice(PRICES.core.month)} a month` },
    them: { notion: { mark: "some", text: "$12 per member a month" }, obsidian: { mark: "some", text: "Sync from $5 a month" } },
  },
  {
    label: "Docs, tasks and databases",
    folevi: { mark: "yes", text: "Pages, tasks, calendar, table, board, gallery" },
    them: { notion: { mark: "yes", text: "Pages and databases" }, obsidian: { mark: "some", text: "Notes, plus plugins" } },
  },
  {
    label: "AI assistant",
    folevi: { mark: "yes", text: "Foli AI, on-device or your own key" },
    them: { notion: { mark: "some", text: "Included on Business" }, obsidian: { mark: "no", text: "None built in" } },
  },
  {
    label: "Works offline",
    folevi: { mark: "yes", text: "Fully, web app too" },
    them: { notion: { mark: "some", text: "Pages you download" }, obsidian: { mark: "yes", text: "Local files" } },
  },
  {
    label: "Apps",
    folevi: { mark: "yes", text: "Mac, iPhone, iPad and web" },
    them: { notion: { mark: "yes", text: "Web, Mac, Windows, iOS, Android" }, obsidian: { mark: "yes", text: "Mac, Windows, Linux, iOS, Android" } },
  },
  {
    label: "Work together",
    folevi: { mark: "yes", text: "Workspaces, comments, free guests" },
    them: { notion: { mark: "yes", text: "Presence, comments, guests" }, obsidian: { mark: "some", text: "Shared vaults with Sync" } },
  },
  {
    label: "Publish to the web",
    folevi: { mark: "yes", text: "Public links, password, expiry" },
    them: { notion: { mark: "yes", text: "Custom domain $8 a month" }, obsidian: { mark: "some", text: "Publish, $10 a month" } },
  },
  {
    label: "End-to-end encryption",
    folevi: { mark: "yes", text: "Opt-in, every plan" },
    them: { notion: { mark: "none", text: "At rest and in transit" }, obsidian: { mark: "yes", text: "Sync, by default" } },
  },
  {
    label: "Version history",
    folevi: { mark: "yes", text: `${VERSION_DAYS} days, every plan` },
    them: { notion: { mark: "some", text: "7 days on Free" }, obsidian: { mark: "some", text: "With Sync" } },
  },
  {
    label: "Templates",
    folevi: { mark: "yes", text: `${BUILT_IN_TEMPLATES.length} built in, plus yours` },
    them: { notion: { mark: "yes", text: "A big gallery" }, obsidian: { mark: "yes", text: "Core plugin" } },
  },
];

const MARK_LABEL: Record<Mark, string> = { yes: "Yes", no: "No", some: "Partly", none: "Not listed" };

function Value({ cell }: { cell: Cell }) {
  return (
    <span className="flex items-start gap-2">
      <span
        className={cx(
          "mt-0.5 grid size-[18px] flex-none place-items-center rounded-chip",
          cell.mark === "yes" && "bg-(--mk-violet-strong) text-white",
          cell.mark === "no" && "bg-(--color-surface-sunken) text-muted",
          cell.mark === "some" && "bg-[#fdf0d8] text-[#9a6412]",
          cell.mark === "none" && "text-faint",
        )}
      >
        {cell.mark === "yes" ? <Check size={11} strokeWidth={3} aria-hidden="true" /> : cell.mark === "no" ? <X size={11} strokeWidth={3} aria-hidden="true" /> : <Minus size={11} strokeWidth={3} aria-hidden="true" />}
        <span className="sr-only">{MARK_LABEL[cell.mark]}: </span>
      </span>
      <span className={cell.mark === "none" ? "text-faint" : "text-ink"}>{cell.text}</span>
    </span>
  );
}

const cell = "border-b mk-hair px-4 py-3 align-top text-[14px] leading-snug";
// Folevi's column: a light wash of the accent, so the eye finds it first.
const us = "bg-[color-mix(in_oklab,var(--mk-violet)_9%,var(--color-surface))]";

export function CompareChart() {
  return (
    <div className="mk-card overflow-x-auto" role="region" aria-label="Folevi, Notion and Obsidian, side by side" tabIndex={0}>
      <table className="w-full min-w-[720px] border-collapse text-left">
        <caption className="sr-only">
          Folevi next to {COMPETITORS.map((x) => x.name).join(" and ")}, one topic per row. Other products’ details are from their websites, checked between {formatDay(COMPARE_CHECKED)} and {formatDay(COMPARE_LAST_CHECKED)}; each product’s page has the full details and sources.
        </caption>
        <thead>
          <tr>
            <th scope="col" className="sticky left-0 z-10 w-[190px] bg-(--color-surface) px-4 py-3.5">
              <span className="sr-only">Topic</span>
            </th>
            <th scope="col" className={cx("px-4 pb-3.5 pt-5 text-[15px] font-semibold text-(--color-heading)", us)}>
              <span className="flex items-center gap-2.5">
                Folevi
                <span aria-hidden="true">
                  <Sticker tone="violet" rotate={-6} className="px-2.5 py-1 text-[12px]">
                    That’s us
                  </Sticker>
                </span>
              </span>
            </th>
            {COMPETITORS.map((x) => (
              <th key={x.slug} scope="col" className="px-4 py-3.5 text-[15px] font-semibold text-(--color-heading)">
                <Link href={comparePath(x.slug)} className="mk-link">
                  {x.name}
                </Link>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ROWS.map((row) => (
            <tr key={row.label}>
              <th scope="row" className={cx(cell, "sticky left-0 z-10 bg-(--color-surface) font-semibold text-(--color-heading)")}>
                {row.label}
              </th>
              <td className={cx(cell, us)}>
                <Value cell={row.folevi} />
              </td>
              {COMPETITORS.map((x) => (
                <td key={x.slug} className={cell}>
                  <Value cell={row.them[x.slug] ?? { mark: "none", text: "Not listed" }} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
