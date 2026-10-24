// What Quick Add reads in a typed task (components/app/QuickAddTask.tsx useQuickAdd does the same for the web): a
// repeat ("every monday") first, so its day isn't also taken as the due date, then a date ("tomorrow 3pm").
// Pure, so the native Quick Add shows exactly what the web would save.
import { describeRepeat, parseRepeatPhrase, repeatProps, stepOccurrence, type RepeatRule } from "@folevi/editor-schema";
import { parseNaturalDate } from "@/lib/nlDate";

export interface QuickTaskPlan {
  title: string;
  dueDate: string | null;
  dueTime: string | null;
  dateText: string | null;
  repeat: RepeatRule | null;
  repeatLabel: string | null;
  repeatText: string | null;
}

/** A repeat with no date written starts on its first day from today (today itself when it fits). */
function firstDate(rule: RepeatRule, today: string): string {
  if (rule.repeat === "monthly" || rule.repeat === "yearly") return today;
  const yesterday = new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10)) - 86_400_000).toISOString().slice(0, 10);
  return stepOccurrence(rule, yesterday, Number(today.slice(8, 10)));
}

export function planQuickTask(text: string, today: string, o: { keepText?: boolean; dueDate?: string | null; dueTime?: string | null } = {}, now: Date = new Date()): QuickTaskPlan {
  const r = o.keepText ? null : parseRepeatPhrase(text);
  const repeat = r && r.rest ? r : null;
  const body = repeat ? repeat.rest : text;
  const p = o.keepText || o.dueDate !== undefined ? null : parseNaturalDate(body, now);
  const parsed = p && p.rest ? p : null;
  const dueDate = o.dueDate !== undefined ? o.dueDate : (parsed?.date ?? (repeat ? firstDate(repeat.rule, today) : null));
  const dueTime = o.dueTime !== undefined ? o.dueTime : o.dueDate !== undefined ? null : (parsed?.time ?? null);
  return {
    title: (parsed ? parsed.rest : body).trim(),
    dueDate,
    dueTime: dueDate ? dueTime : null,
    dateText: parsed?.text ?? null,
    repeat: repeat?.rule ?? null,
    repeatLabel: repeat ? describeRepeat(repeat.rule) : null,
    repeatText: repeat?.text ?? null,
  };
}

export { repeatProps };
