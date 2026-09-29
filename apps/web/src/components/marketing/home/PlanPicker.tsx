"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { Check } from "lucide-react";
import { PLANS, PLAN_ORDER, TRIAL_DAYS, TRIAL_TIER, WORKSPACE_PLANS, formatPrice, monthlyEquivalent, yearlySavingPercent, type PersonalPlanCard, type WorkspacePlanCard } from "@/lib/plans";
import { SIGN_UP_URL } from "../site";
import { ButtonLink, cx } from "../ui";

type Audience = "personal" | "team";
type Interval = "month" | "year";

/**
 * A segmented control (the app's .ui-seg look) that behaves as a radio group: one tab stop, arrow keys move
 * the choice. Never an OS control.
 */
function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: Array<{ value: T; label: string }>; onChange: (next: T) => void }) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = options.findIndex((o) => o.value === value);
    const n = options.length;
    const next = e.key === "ArrowRight" || e.key === "ArrowDown" ? (i + 1) % n : e.key === "ArrowLeft" || e.key === "ArrowUp" ? (i - 1 + n) % n : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : -1;
    const option = options[next];
    if (!option) return;
    e.preventDefault();
    onChange(option.value);
    refs.current[next]?.focus();
  };
  return (
    <div role="radiogroup" aria-label={label} className="mk-seg w-fit" onKeyDown={onKeyDown}>
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(o.value)}
            className="mk-seg-item h-8 px-4 text-[13.5px] font-medium"
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function FeatureList({ items }: { items: string[] }) {
  return (
    <ul className="mt-5 flex-1 space-y-2.5 border-t mk-hair pt-5">
      {items.map((item) => (
        <li key={item} className="flex items-start gap-2.5 text-[14.5px] leading-snug text-ink">
          <Check size={16} aria-hidden="true" className="mt-px flex-none text-(--color-heading)" />
          {item}
        </li>
      ))}
    </ul>
  );
}

function PlanCard({ card, audience, interval, headingLevel }: { card: PersonalPlanCard | WorkspacePlanCard; audience: Audience; interval: Interval; headingLevel: "h2" | "h3" }) {
  const Heading = headingLevel;
  const team = audience === "team";
  const free = card.tier === "free";
  // The plan the trial gives is the one highlighted.
  const featured = card.tier === TRIAL_TIER;
  const perMember = team ? "per member " : "";
  let price = formatPrice(0);
  let unit = "";
  let note = team ? "Nobody is billed" : "No card required";
  if (card.tier !== "free") {
    const saving = yearlySavingPercent(card.tier);
    if (interval === "month") {
      price = formatPrice(card.monthlyCents);
      unit = `${perMember}/ month`;
      note = `or ${formatPrice(card.yearlyCents)} ${perMember}a year (save ${saving}%)`;
    } else {
      price = formatPrice(card.yearlyCents);
      unit = `${perMember}/ year`;
      note = `${monthlyEquivalent(card.yearlyCents)} ${perMember}a month, billed yearly (save ${saving}%)`;
    }
  }
  const chip = featured && !team ? `${TRIAL_DAYS}-day free trial` : card.tier === "core" ? "No AI" : null;
  const cta = free ? "Start free" : featured && !team ? `Try ${card.name} free for ${TRIAL_DAYS} days` : `Start with ${card.name}`;
  return (
    <div
      role="group"
      aria-label={`${card.name} plan`}
      className={cx("mk-card flex flex-col p-6 sm:p-7", featured && "shadow-[var(--shadow-card),inset_0_0_0_1.5px_color-mix(in_oklab,var(--color-heading)_22%,transparent)]")}
    >
      <div className="flex min-h-7 items-center gap-2">
        <Heading className="text-[16px] font-semibold text-(--color-heading)">{card.name}</Heading>
        {chip ? <span className="mk-chip ml-auto">{chip}</span> : null}
      </div>
      <p className="mt-5 flex flex-wrap items-baseline gap-x-1.5">
        <span className="mk-display text-[44px] leading-none">{price}</span>
        {unit ? <span className="text-[14.5px] text-muted">{unit}</span> : null}
      </p>
      <p className="mt-2 min-h-[40px] text-[13.5px] leading-snug text-muted">{note}</p>
      <p className="mt-3 text-[14.5px] leading-relaxed text-ink">{card.blurb}</p>
      <FeatureList items={card.features} />
      <ButtonLink href={SIGN_UP_URL} className="mt-7 w-full" icon="arrow-right" size="lg" variant={featured ? undefined : "secondary"}>
        {cta}
      </ButtonLink>
    </div>
  );
}

/**
 * The four plans (marketing home and /pricing), for you or for a team, paid monthly or yearly. Prices,
 * limits and features all come from lib/plans. Team prices are per member.
 */
export function PlanPicker({ headingLevel = "h3", align = "left" }: { headingLevel?: "h2" | "h3"; align?: "left" | "center" }) {
  const [audience, setAudience] = useState<Audience>("personal");
  const [interval, setBilling] = useState<Interval>("month");
  const team = audience === "team";
  return (
    <div>
      <div className={cx("flex flex-wrap items-center gap-3", align === "center" && "justify-center")}>
        <Segmented
          label="Plans for"
          value={audience}
          onChange={setAudience}
          options={[
            { value: "personal", label: "Personal" },
            { value: "team", label: "Team" },
          ]}
        />
        <Segmented
          label="Billing"
          value={interval}
          onChange={setBilling}
          options={[
            { value: "month", label: "Monthly" },
            { value: "year", label: "Yearly" },
          ]}
        />
      </div>
      <p aria-live="polite" className={cx("mt-4 max-w-[64ch] text-[14.5px] leading-relaxed text-muted", align === "center" && "mx-auto text-center")}>
        {team
          ? "For a workspace. Paid plans are billed per member, and every member gets the plan’s storage and AI credits there. Guests are free."
          : "For you: your Personal, your devices and your AI credits. A personal plan never changes a workspace’s plan."}
      </p>
      <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {PLAN_ORDER.map((tier) => (
          <PlanCard key={tier} card={team ? WORKSPACE_PLANS[tier] : PLANS[tier]} audience={audience} interval={interval} headingLevel={headingLevel} />
        ))}
      </div>
    </div>
  );
}
