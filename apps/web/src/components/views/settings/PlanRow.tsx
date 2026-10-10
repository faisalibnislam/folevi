import type { ReactNode } from "react";
import { Check } from "lucide-react";

/**
 * The plans in Settings → Plan & billing (personal and workspace), one full-width row each, stacked.
 * Wide enough (a container query, so it follows the settings column, not the window): name and price on
 * the left, features in the middle, the action on the right. The rows share one grid (subgrid), so the
 * features and the buttons line up from row to row. Narrower, each row stacks.
 */
export function PlanRows({ children }: { children: ReactNode }) {
  return (
    <div className="@container">
      <div className="grid gap-3 @xl:grid-cols-[12rem_minmax(0,1fr)_auto] @xl:gap-x-6">{children}</div>
    </div>
  );
}

export function PlanRow({
  name,
  current,
  highlight,
  price,
  per,
  note,
  blurb,
  features,
  action,
}: {
  name: string;
  current: boolean;
  highlight: boolean;
  price: string;
  per: string;
  note: ReactNode;
  blurb: string;
  features: string[];
  action: ReactNode;
}) {
  return (
    <section
      aria-label={`${name} plan`}
      className={`grid gap-4 rounded-[14px] p-5 @xl:col-span-3 @xl:grid-cols-subgrid @xl:items-center @xl:gap-x-6 ${highlight ? "bg-[linear-gradient(160deg,color-mix(in_oklab,#8b7cf6_12%,transparent),color-mix(in_oklab,#f58ab8_10%,transparent))] shadow-[inset_0_0_0_1.5px_color-mix(in_oklab,#7c6cf0_35%,transparent)]" : "bg-[var(--glass-hover)] shadow-[inset_0_0_0_1px_var(--glass-border)]"}`}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h4 className="ui-display text-[19px]">{name}</h4>
          {current ? <span className="ml-auto rounded-full bg-heading px-2 py-0.5 text-[11px] font-semibold text-canvas @xl:ml-0">Current</span> : null}
        </div>
        <p className="mt-1">
          <span className="text-[28px] font-semibold tracking-tight text-heading">{price}</span>
          <span className="text-sm text-muted">{` / ${per}`}</span>
        </p>
        <p className="text-[12.5px] text-muted">{note}</p>
        <p className="mt-2 text-[13px] text-ink">{blurb}</p>
      </div>
      <div className="@container min-w-0">
        <ul className="grid gap-x-5 gap-y-1.5 text-[13px] @md:grid-cols-2">
          {features.map((f) => (
            <li key={f} className="flex gap-2">
              <Check size={15} aria-hidden className="mt-0.5 flex-none text-[#2f9e62]" /> {f}
            </li>
          ))}
        </ul>
      </div>
      <div className="empty:hidden @xl:flex @xl:min-w-[9.5rem] @xl:max-w-[13rem] @xl:justify-end">{action}</div>
    </section>
  );
}
