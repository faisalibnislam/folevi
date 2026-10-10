"use client";

import { useId, useState } from "react";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/lib/convex/api";
import { AppLink } from "@/lib/app/router";
import { Select } from "@/components/ui/Select";
import { creditDate } from "@/components/ai/AiCredits";
import { Card } from "./Card";

// The usage card in Settings > AI (billing.aiUsage): your Personal credits, or your seat in a paid workspace
// (picked here), what's used and left this period, when they reset,
// and what they went on, by feature and by day. The day chart is drawn here (SVG) with a table for
// screen readers.

export type AiUsageData = FunctionReturnType<typeof api.billing.aiUsage>;

/** "Oct 3" for a UTC day key. */
const shortDay = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const credits = (n: number) => `${n.toLocaleString()} ${n === 1 ? "credit" : "credits"}`;

const CHART_H = 96;
const BAR_GAP = 2;

/**
 * Credits per day as bars (one series: no legend, the heading names it). Hover a day for its
 * number. The same numbers are in a table for screen readers.
 */
export function UsageChart({ days }: { days: { day: string; credits: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const tableId = useId();
  const max = Math.max(1, ...days.map((d) => d.credits));
  const width = Math.max(days.length * 12, 120);
  const bar = width / days.length;
  const total = days.reduce((n, d) => n + d.credits, 0);
  const peak = days.reduce((best, d) => (d.credits > best.credits ? d : best), days[0] ?? { day: "", credits: 0 });
  const summary = total ? `Credits used per day, ${shortDay(days[0]!.day)} to ${shortDay(days[days.length - 1]!.day)}: ${credits(total)} in all, most on ${shortDay(peak.day)} (${credits(peak.credits)}).` : "No credits used yet this period.";
  const shown = hover !== null ? days[hover] : null;
  return (
    <figure className="m-0">
      <div className="relative">
        <svg role="img" aria-label={summary} aria-describedby={tableId} viewBox={`0 0 ${width} ${CHART_H}`} preserveAspectRatio="none" className="block h-24 w-full overflow-visible" onMouseLeave={() => setHover(null)}>
          <line x1={0} x2={width} y1={CHART_H - 0.5} y2={CHART_H - 0.5} stroke="var(--color-line)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          {days.map((d, i) => {
            const h = d.credits ? Math.max(2, (d.credits / max) * (CHART_H - 8)) : 0;
            const x = i * bar + BAR_GAP / 2;
            const w = Math.max(1, bar - BAR_GAP);
            return (
              <g key={d.day} data-day={d.day} onMouseEnter={() => setHover(i)}>
                {/* The hover target is the whole column, bigger than the bar. */}
                <rect x={i * bar} y={0} width={bar} height={CHART_H} fill="transparent" />
                {h ? <path d={roundedTop(x, CHART_H - h, w, h, Math.min(4, w / 2, h))} fill={hover === i ? "var(--color-heading)" : "color-mix(in oklab, var(--color-heading) 55%, transparent)"} /> : null}
              </g>
            );
          })}
        </svg>
        {shown ? (
          <p aria-hidden className="pointer-events-none absolute -top-7 rounded-chip bg-[var(--glass-active)] px-2 py-0.5 text-[12px] text-ink shadow-[var(--glass-edge)]" style={{ left: `clamp(0px, calc(${((hover! + 0.5) / days.length) * 100}% - 3.5rem), calc(100% - 7rem))` }}>
            {shortDay(shown.day)}: {credits(shown.credits)}
          </p>
        ) : null}
      </div>
      <figcaption className="mt-1 flex justify-between text-[11.5px] text-faint" aria-hidden>
        <span>{days.length ? shortDay(days[0]!.day) : ""}</span>
        <span>{days.length > 1 ? shortDay(days[days.length - 1]!.day) : ""}</span>
      </figcaption>
      <table id={tableId} className="sr-only">
        <caption>Credits used per day</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">Credits</th>
          </tr>
        </thead>
        <tbody>
          {days.map((d) => (
            <tr key={d.day}>
              <th scope="row">{shortDay(d.day)}</th>
              <td>{d.credits}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/** A bar with rounded top corners, anchored to the baseline. */
function roundedTop(x: number, y: number, w: number, h: number, r: number): string {
  return `M${x},${y + h} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${y + h} Z`;
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12px] text-muted">{label}</dt>
      <dd className="mt-0.5 text-[15px] font-semibold tabular-nums text-heading">{value}</dd>
    </div>
  );
}

/** The usage card's contents for one credit account. */
export function UsageSummary({ usage }: { usage: AiUsageData }) {
  if (!usage.aiIncluded) {
    return (
      <p className="text-sm text-muted">
        {usage.blockedReason ?? "Foli isn't included here."}{" "}
        <AppLink href="/settings/billing" className="underline underline-offset-2 hover:text-heading">
          See plans
        </AppLink>
      </p>
    );
  }
  const most = Math.max(1, ...usage.features.map((f) => f.credits));
  return (
    <div className="space-y-5">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
        <Figure label={usage.trialing ? "Trial credits" : "Monthly credits"} value={usage.allowance.toLocaleString()} />
        <Figure label="Used this period" value={usage.used.toLocaleString()} />
        <Figure label="Extra credits" value={usage.packCredits.toLocaleString()} />
        <Figure label="Left" value={usage.available.toLocaleString()} />
      </dl>
      <p className="text-[12.5px] text-muted">
        {usage.trialing ? `Your trial ends on ${creditDate(usage.resetsAt)}.` : `Monthly credits reset on ${creditDate(usage.resetsAt)}.`} Extra credits are used after the monthly ones.
        {usage.canBuy ? (
          <>
            {" "}
            <AppLink href="/settings/billing" className="underline underline-offset-2 hover:text-heading">
              Buy more
            </AppLink>
          </>
        ) : null}
      </p>
      <section aria-label="Credits by feature this period">
        <p className="ui-caps mb-2">By feature</p>
        <ul className="space-y-1.5">
          {usage.features.map((f) => (
            <li key={f.feature} className="grid grid-cols-[8.5rem_1fr_auto] items-center gap-3 text-[13px]">
              <span className="truncate text-ink">{f.label}</span>
              <span aria-hidden className="h-1.5 overflow-hidden rounded-tiny bg-[var(--glass-hover)]">
                <span className="block h-full rounded-chip bg-[color-mix(in_oklab,var(--color-heading)_55%,transparent)]" style={{ width: `${(f.credits / most) * 100}%` }} />
              </span>
              <span className="tabular-nums text-muted">{f.credits.toLocaleString()}</span>
            </li>
          ))}
        </ul>
      </section>
      <section aria-label="Credits by day this period">
        <p className="ui-caps mb-2">By day</p>
        {usage.days.some((d) => d.credits > 0) ? (
          <UsageChart days={usage.days} />
        ) : (
          <p className="text-[12.5px] text-muted">{usage.used ? "Nothing to show by day yet." : "No credits used yet this period."}</p>
        )}
        {usage.untrackedDays > 0 ? <p className="mt-2 text-[12px] text-faint">{credits(usage.untrackedDays)} used before daily tracking started aren&apos;t in the chart.</p> : null}
      </section>
    </div>
  );
}

/**
 * Settings > AI: what Foli has used. Personal first (the same credits as Plan & billing); a seat in a paid
 * workspace has credits of its own, so it can be picked here too.
 */
export function AiUsageCard() {
  const accounts = useQuery(api.billing.creditAccounts, {});
  const [which, setWhich] = useState<string>("personal");
  const seats = accounts?.accounts.filter((a) => a.kind === "seat" && a.workspaceId) ?? [];
  const pick = seats.find((a) => a.workspaceId === which) ? which : "personal";
  const usage = useQuery(api.billing.aiUsage, { scope: pick === "personal" ? { kind: "personal" } : { kind: "workspace", workspaceId: pick } });
  return (
    <Card
      title="Usage"
      description={usage ? (usage.account === "seat" ? `AI credits for your seat in ${usage.place} (${usage.plan}). Seats have their own credits.` : `Your Personal AI credits (${usage.plan}), the same as in Plan & billing. They're also used in free workspaces and on pages shared with you.`) : undefined}
    >
      {seats.length ? (
        <div className="mb-4">
          <Select value={pick} onChange={(e) => setWhich(e.target.value)} aria-label="Credits for" className="w-56">
            <option value="personal">Personal</option>
            {seats.map((a) => (
              <option key={a.workspaceId} value={a.workspaceId!}>
                {`${a.name} (your seat)`}
              </option>
            ))}
          </Select>
        </div>
      ) : null}
      {usage ? <UsageSummary usage={usage} /> : <p className="text-sm text-muted">Loading your usage…</p>}
    </Card>
  );
}
