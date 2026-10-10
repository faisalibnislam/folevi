"use client";

import { useEffect, useId, useRef, useState } from "react";
import { formatDate } from "@/lib/format";

export interface DailyPoint {
  date: string; // YYYY-MM-DD (UTC)
  value: number;
}

/** The last `days` UTC calendar dates, oldest first. */
export function lastDays(days: number, now = Date.now()): string[] {
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i--) out.push(new Date(now - i * 86_400_000).toISOString().slice(0, 10));
  return out;
}

function niceMax(v: number): number {
  if (v <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * pow >= v) return m * pow;
  return 10 * pow;
}

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(560);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(240, Math.floor(entry.contentRect.width)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

const shortDate = (d: string) => formatDate(d, { month: "short", day: "numeric" });

/**
 * A single-series daily chart (bars for counts, a line for levels) drawn in plain SVG. The SVG is a
 * summarised image for assistive tech; the full values are always available in the data table.
 * `missing: "zero"` treats absent days as 0 (event counters); `"gap"` leaves a gap (daily snapshots).
 */
export function DailyChart({
  title,
  description,
  points,
  kind,
  missing,
  unit,
  emptyMessage,
  days = 30,
}: {
  title: string;
  description: string;
  points: DailyPoint[];
  kind: "bar" | "line";
  missing: "zero" | "gap";
  unit: string;
  emptyMessage: string;
  days?: number;
}) {
  const id = useId();
  const [wrapRef, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const dates = lastDays(days);
  const byDate = new Map(points.map((p) => [p.date, p.value]));
  const values = dates.map((d) => byDate.get(d) ?? (missing === "zero" ? 0 : null));
  const present = values.filter((v): v is number => v !== null);
  const hasData = missing === "zero" ? points.length > 0 : present.length > 0;

  const height = 168;
  const pad = { top: 12, right: 8, bottom: 22, left: 36 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const max = niceMax(Math.max(0, ...present));
  const step = innerW / dates.length;
  const x = (i: number) => pad.left + step * i + step / 2;
  const y = (v: number) => pad.top + innerH - (v / max) * innerH;
  const ticks = [0, max / 2, max];

  const total = present.reduce((a, b) => a + b, 0);
  const peak = present.length ? Math.max(...present) : 0;
  const peakDate = dates[values.indexOf(peak)];
  const latestIndex = values.findLastIndex((v) => v !== null);
  const latest = latestIndex >= 0 ? (values[latestIndex] ?? null) : null;
  const summary = hasData
    ? kind === "bar"
      ? `${title}, last ${days} days: ${total} ${unit} in total, peak ${peak}${peakDate ? ` on ${shortDate(peakDate)}` : ""}.`
      : `${title}, last ${days} days: ${present.length} days recorded, latest ${latest ?? "none"}, peak ${peak}.`
    : `${title}: ${emptyMessage}`;

  // Line segments broken at gaps.
  const segments: string[] = [];
  if (kind === "line") {
    let cur = "";
    values.forEach((v, i) => {
      if (v === null) {
        if (cur) segments.push(cur);
        cur = "";
      } else cur += `${cur ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
    });
    if (cur) segments.push(cur);
  }

  const barW = Math.max(2, Math.min(18, step - 2));
  const hovered = hover !== null ? { date: dates[hover]!, value: values[hover] ?? null } : null;

  return (
    <figure className="min-w-0 ui-card" aria-labelledby={`${id}-t`}>
      <div className="flex items-baseline justify-between gap-3 px-5 pb-2 pt-4">
        <figcaption id={`${id}-t`} className="ui-display text-[17px] leading-snug">
          {title}
        </figcaption>
        <span className="text-[12px] text-muted">{description}</span>
      </div>
      <div ref={wrapRef} className="relative px-2 pt-2">
        {hasData ? (
          <svg
            width={width}
            height={height}
            role="img"
            aria-label={summary}
            className="block max-w-full overflow-visible"
            onMouseMove={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const i = Math.floor((e.clientX - rect.left - pad.left) / step);
              setHover(i >= 0 && i < dates.length ? i : null);
            }}
            onMouseLeave={() => setHover(null)}
          >
            {ticks.map((t) => (
              <g key={t}>
                <line x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} stroke="var(--color-line)" strokeDasharray={t === 0 ? undefined : "2 4"} />
                <text x={pad.left - 6} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--color-ink-muted)" className="tabular-nums">
                  {Number.isInteger(t) ? t : t.toFixed(1)}
                </text>
              </g>
            ))}
            {[0, Math.floor(dates.length / 2), dates.length - 1].map((i) => (
              <text key={i} x={x(i)} y={height - 6} textAnchor={i === 0 ? "start" : i === dates.length - 1 ? "end" : "middle"} fontSize={11} fill="var(--color-ink-muted)">
                {shortDate(dates[i]!)}
              </text>
            ))}
            {hover !== null ? <rect x={pad.left + step * hover} y={pad.top} width={step} height={innerH} fill="var(--color-ink)" opacity={0.05} /> : null}
            {kind === "bar"
              ? values.map((v, i) => {
                  if (!v) return null;
                  const h = Math.max(2, (v / max) * innerH);
                  const r = Math.min(4, barW / 2, h);
                  const x0 = x(i) - barW / 2;
                  const y0 = pad.top + innerH - h;
                  // Rounded data-end, square baseline.
                  const d = `M${x0},${pad.top + innerH}V${y0 + r}Q${x0},${y0} ${x0 + r},${y0}H${x0 + barW - r}Q${x0 + barW},${y0} ${x0 + barW},${y0 + r}V${pad.top + innerH}Z`;
                  return <path key={i} d={d} fill="var(--color-heading)" opacity={hover === null || hover === i ? 1 : 0.55} />;
                })
              : (
                <>
                  {segments.map((d, i) => (
                    <path key={i} d={d} fill="none" stroke="var(--color-heading)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                  ))}
                  {values.map((v, i) =>
                    v === null ? null : (
                      <circle key={i} cx={x(i)} cy={y(v)} r={hover === i ? 5 : 4} fill="var(--color-heading)" stroke="var(--color-surface-raised)" strokeWidth={1.5} />
                    ),
                  )}
                  {latestIndex >= 0 && latest !== null ? (
                    <text x={x(latestIndex) - 8} y={y(latest) - 10} textAnchor="end" fontSize={11.5} fontWeight={600} fill="var(--color-ink)" className="tabular-nums">
                      {latest}
                    </text>
                  ) : null}
                </>
              )}
          </svg>
        ) : (
          <div className="grid h-[168px] place-items-center px-6 text-center text-[13px] text-muted">{emptyMessage}</div>
        )}
        {hovered ? (
          <div
            aria-hidden
            className="pointer-events-none absolute top-2 z-10 -translate-x-1/2 whitespace-nowrap ui-pop rounded-control px-2.5 py-1.5 text-[12px]"
            style={{ left: Math.min(Math.max(x(hover!) + 8, 60), width - 50) }}
          >
            <div className="text-muted">{formatDate(hovered.date, { weekday: "short", month: "short", day: "numeric" })}</div>
            <div className="font-semibold tabular-nums">{hovered.value === null ? "Not recorded" : `${hovered.value} ${unit}`}</div>
          </div>
        ) : null}
      </div>
      <details className="border-t border-line px-5 py-2 text-[13px]">
        <summary className="cursor-pointer rounded-tiny text-muted hover:text-ink">Show data table</summary>
        <div className="mt-2 max-h-56 overflow-y-auto">
          <table className="w-full border-collapse text-[12.5px]">
            <caption className="sr-only">{`${title} by day`}</caption>
            <thead>
              <tr>
                <th scope="col" className="border-b border-line py-1 text-left font-medium text-muted">
                  Date (UTC)
                </th>
                <th scope="col" className="border-b border-line py-1 text-right font-medium text-muted">
                  {unit.charAt(0).toUpperCase() + unit.slice(1)}
                </th>
              </tr>
            </thead>
            <tbody>
              {dates.map((d, i) => (
                <tr key={d}>
                  <th scope="row" className="py-0.5 text-left font-normal">
                    {shortDate(d)}
                  </th>
                  <td className="py-0.5 text-right tabular-nums">{values[i] ?? "No data"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
