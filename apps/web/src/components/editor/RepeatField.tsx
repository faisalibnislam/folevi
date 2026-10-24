"use client";

import { describeRepeat, type RepeatRule } from "@folevi/editor-schema";
import { Select } from "@/components/ui/Select";

type Choice = "none" | "daily" | "weekdays" | "weekly" | "biweekly" | "monthly" | "yearly";

const DAYS = [
  { n: 1, short: "M", name: "Monday" },
  { n: 2, short: "T", name: "Tuesday" },
  { n: 3, short: "W", name: "Wednesday" },
  { n: 4, short: "T", name: "Thursday" },
  { n: 5, short: "F", name: "Friday" },
  { n: 6, short: "S", name: "Saturday" },
  { n: 7, short: "S", name: "Sunday" },
];

function choiceOf(rule: RepeatRule | null): Choice {
  if (!rule) return "none";
  if (rule.repeat === "weekly") return (rule.every ?? 1) === 2 ? "biweekly" : "weekly";
  return rule.repeat;
}

/** ISO weekday of a YYYY-MM-DD date (Monday = 1). */
const isoDay = (date: string) => {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return ((new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7) + 1;
};

/**
 * The Repeat row of a to-do's details: never, every day, weekday, week (on chosen days), two weeks, month
 * or year. Checking a repeating to-do off brings it back at its next date (convex/tasks.ts repeatTask).
 */
export function RepeatField({ rule, dueDate, onChange }: { rule: RepeatRule | null; dueDate: string | null; onChange: (rule: RepeatRule | null) => void }) {
  const choice = choiceOf(rule);
  const weekly = choice === "weekly" || choice === "biweekly";
  const days = rule?.days ?? [];
  const pick = (next: Choice) => {
    if (next === "none") return onChange(null);
    if (next === "weekly" || next === "biweekly") {
      return onChange({ repeat: "weekly", ...(next === "biweekly" ? { every: 2 } : {}), days: days.length ? days : dueDate ? [isoDay(dueDate)] : [] });
    }
    onChange({ repeat: next });
  };
  return (
    <div className="grid gap-1">
      <label className="grid gap-1">
        <span className="text-footnote text-muted">Repeat</span>
        <Select value={choice} onChange={(e) => pick(e.target.value as Choice)} className="h-8 ui-input rounded-chip px-3">
          <option value="none">Never</option>
          <option value="daily">Every day</option>
          <option value="weekdays">Every weekday</option>
          <option value="weekly">Every week</option>
          <option value="biweekly">Every 2 weeks</option>
          <option value="monthly">Every month</option>
          <option value="yearly">Every year</option>
        </Select>
      </label>
      {weekly ? (
        <div role="group" aria-label="Repeat on" className="mt-1 flex gap-1">
          {DAYS.map((d) => {
            const on = days.includes(d.n);
            return (
              <button
                key={d.n}
                type="button"
                aria-pressed={on}
                aria-label={d.name}
                onClick={() => {
                  const next = on ? days.filter((x) => x !== d.n) : [...days, d.n].sort((a, b) => a - b);
                  onChange({ repeat: "weekly", ...(choice === "biweekly" ? { every: 2 } : {}), ...(next.length ? { days: next } : {}) });
                }}
                className={`grid h-7 w-7 place-items-center rounded-chip text-footnote font-medium transition-colors ${on ? "bg-heading text-canvas" : "text-muted hover:bg-[var(--glass-hover)] hover:text-ink"}`}
              >
                {d.short}
              </button>
            );
          })}
        </div>
      ) : null}
      {rule ? <p className="text-footnote text-muted">{describeRepeat(rule)}. Checking it off brings it back on the next date.</p> : null}
    </div>
  );
}
