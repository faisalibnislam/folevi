"use client";

import { FileText } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { CheckMark } from "../product/Replica";
import { Icon } from "../icons";
import { DateChip, type ChipTone } from "../mini";
import { cx } from "../ui";
import { LiveRegion } from "./DemoCard";
import { isStill } from "./autoplay";

const DOCS = [
  { id: "seed", title: "Seed library", body: "Swap day is the first Saturday in April. Labels and glassine envelopes come from the printer on Alder Street." },
  { id: "thursday", title: "Thursday notes", body: "The printer can do the seed labels by Friday. Ask about recycled envelopes and a small run of sign-up cards." },
  { id: "studio", title: "Studio move", body: "Boxes for the plan chest, the reading lamp and the old printer. Keys from Ines on Friday morning." },
  { id: "reading", title: "Reading list", body: "The Overstory, Braiding Sweetgrass, and a short history of envelopes, stamps and the post." },
  { id: "calendar", title: "Planting calendar", body: "Sow sweet peas in March. Beans after the last frost, usually mid-April. Label every tray." },
];

type Task = { id: string; text: string; page: string; when: string; tone: ChipTone; section: "today" | "next" };

const TASKS: Task[] = [
  { id: "t1", text: "Print seed labels", page: "Seed library", when: "Overdue · Mon", tone: "coral", section: "today" },
  { id: "t2", text: "Pick up keys from Ines", page: "Studio move", when: "Today", tone: "accent", section: "today" },
  { id: "t3", text: "Order glassine envelopes", page: "Seed library", when: "Today · 16:00", tone: "accent", section: "today" },
  { id: "t4", text: "Return The Overstory", page: "Reading list", when: "Tomorrow", tone: "neutral", section: "next" },
];

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function highlight(text: string, terms: string[]): ReactNode {
  if (terms.length === 0) return text;
  const pattern = new RegExp(`(${terms.map(escapeRegExp).join("|")})`, "gi");
  return text.split(pattern).map((part, i) => (i % 2 === 1 ? <mark key={i}>{part}</mark> : <span key={i}>{part}</span>));
}

function snippet(body: string, terms: string[]): string {
  const lower = body.toLowerCase();
  const first = terms.map((t) => lower.indexOf(t)).filter((i) => i >= 0).sort((a, b) => a - b)[0];
  if (first === undefined || first < 48) return body;
  const start = body.lastIndexOf(" ", first - 30);
  return `…${body.slice(start + 1)}`;
}

/** What the demo types by itself, with the task it ticks after each search (if any). */
const AUTOPLAY: Array<{ query: string; tick?: string }> = [
  { query: "labels", tick: "t1" },
  { query: "printer" },
  { query: "april" },
  { query: "keys", tick: "t2" },
];

export function ReturnDemo() {
  const baseId = useId();
  const [query, setQuery] = useState("labels");
  const [done, setDone] = useState<Set<string>>(() => new Set());
  const [taskMessage, setTaskMessage] = useState("");
  const [auto, setAuto] = useState(true);
  const root = useRef<HTMLDivElement>(null);

  // Until someone touches it, the demo searches by itself while it's on screen: it types a query, the
  // results narrow with each letter, a matching task gets ticked, then it erases and tries the next one.
  useEffect(() => {
    if (!auto || !root.current || isStill(root.current)) return;
    let alive = true;
    let visible = false;
    const io = new IntersectionObserver(([e]) => (visible = Boolean(e?.isIntersecting)), { threshold: 0.25 });
    if (root.current) io.observe(root.current);
    const sleep = async (ms: number) => {
      let left = ms;
      while (alive && left > 0) {
        await new Promise((r) => setTimeout(r, Math.min(left, 100)));
        if (visible && !document.hidden) left -= 100;
      }
      if (!alive) throw new Error("stopped");
    };
    (async () => {
      let current = "labels";
      await sleep(1800);
      for (;;) {
        setDone(new Set());
        for (const step of AUTOPLAY) {
          while (current.length) {
            current = current.slice(0, -1);
            setQuery(current);
            await sleep(45);
          }
          await sleep(350);
          for (const ch of step.query) {
            current += ch;
            setQuery(current);
            await sleep(130);
          }
          await sleep(1300);
          if (step.tick) {
            const id = step.tick;
            setDone((d) => new Set(d).add(id));
            await sleep(1100);
          }
          await sleep(900);
        }
      }
    })().catch(() => undefined);
    return () => {
      alive = false;
      io.disconnect();
    };
  }, [auto]);
  const takeOver = () => setAuto(false);

  const terms = useMemo(
    () =>
      query
        .toLowerCase()
        .split(/\s+/)
        .filter((t) => t.length >= 2),
    [query],
  );

  const results = useMemo(() => {
    if (terms.length === 0) return [];
    return DOCS.map((doc) => {
      const title = doc.title.toLowerCase();
      const body = doc.body.toLowerCase();
      let score = 0;
      for (const term of terms) {
        if (!title.includes(term) && !body.includes(term)) return null;
        if (title.includes(term)) score += 3;
        score += body.split(term).length - 1;
      }
      return { doc, score };
    })
      .filter((r): r is { doc: (typeof DOCS)[number]; score: number } => r !== null)
      .sort((a, b) => b.score - a.score);
  }, [terms]);

  const summary = terms.length === 0 ? "Type to search five sample pages." : `${results.length} ${results.length === 1 ? "page matches" : "pages match"} “${query.trim()}”.`;
  const left = TASKS.filter((t) => t.section === "today" && !done.has(t.id)).length;

  const toggle = (task: Task) => {
    setDone((current) => {
      const next = new Set(current);
      if (next.has(task.id)) next.delete(task.id);
      else next.add(task.id);
      return next;
    });
    setTaskMessage(`${task.text} marked ${done.has(task.id) ? "not done" : "done"}.`);
  };

  return (
    // Any touch, click or key hands the demo over to the visitor and stops the autoplay.
    <div ref={root} onPointerDown={takeOver} onKeyDown={takeOver} onFocus={takeOver} className="grid gap-3 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] md:gap-4">
      <div className="mk-card overflow-hidden">
        <div className="flex items-center gap-2.5 border-b mk-hair px-4">
          <Icon name="search" size={17} className="shrink-0 text-muted" />
          <label htmlFor={`${baseId}-q`} className="sr-only">
            Search sample pages
          </label>
          <input
            id={`${baseId}-q`}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search pages…"
            autoComplete="off"
            spellCheck={false}
            className="h-12 min-w-0 flex-1 appearance-none bg-transparent text-[15px] text-ink outline-none placeholder:text-faint [&::-webkit-search-cancel-button]:hidden"
          />
          <kbd className="mk-kbd shrink-0">⌘K</kbd>
        </div>
        <p className="border-b mk-hair px-4 py-2 text-[12px] text-muted" aria-live="polite">
          {summary}
        </p>
        <ul className="min-h-[244px] divide-y divide-line" aria-label="Search results">
          {results.map(({ doc }) => (
            <li key={doc.id} className="mk-appear px-4 py-3">
              <p className="flex items-center gap-2 text-[14px] font-medium text-ink">
                <FileText size={14} aria-hidden="true" className="shrink-0 text-muted" />
                {highlight(doc.title, terms)}
              </p>
              <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-muted">{highlight(snippet(doc.body, terms), terms)}</p>
            </li>
          ))}
          {terms.length > 0 && results.length === 0 ? (
            <li className="px-4 py-8 text-center text-[13.5px] text-muted">No pages match. Try “printer” or “April”.</li>
          ) : null}
        </ul>
      </div>

      <div className="mk-card overflow-hidden">
        <div className="flex h-12 items-center gap-2 border-b mk-hair px-4">
          <Icon name="calendar" size={16} className="text-muted" />
          <h4 className="text-[14px] font-semibold text-(--color-heading)">Today</h4>
          <span className="ml-auto text-[12px] text-muted">{left === 0 ? "All done" : `${left} left`}</span>
        </div>
        <TaskGroup label="Due today and overdue" tasks={TASKS.filter((t) => t.section === "today")} done={done} onToggle={toggle} />
        <TaskGroup label="Next" tasks={TASKS.filter((t) => t.section === "next")} done={done} onToggle={toggle} muted />
        <LiveRegion message={taskMessage} />
      </div>
    </div>
  );
}

function TaskGroup({
  label,
  tasks,
  done,
  onToggle,
  muted,
}: {
  label: string;
  tasks: Task[];
  done: Set<string>;
  onToggle: (task: Task) => void;
  muted?: boolean;
}) {
  return (
    <div className={cx("px-2 py-2", muted && "border-t mk-hair bg-(--mk-well)")}>
      <p className="mk-caps px-2 pb-1 pt-1">{label}</p>
      <ul>
        {tasks.map((task) => {
          const isDone = done.has(task.id);
          return (
            <li key={task.id}>
              <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-control px-2 py-2 hover:bg-sunken">
                <input type="checkbox" checked={isDone} onChange={() => onToggle(task)} className="mk-check-input sr-only" />
                <span aria-hidden="true" className="mk-check mt-[2px]" data-checked={isDone ? "true" : undefined}>
                  {isDone ? <CheckMark /> : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={cx("block text-[14px]", isDone ? "text-faint line-through" : "text-ink")}>{task.text}</span>
                  <span className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-muted">
                    <DateChip tone={isDone ? "neutral" : task.tone}>{task.when}</DateChip>
                    <span className="truncate">{task.page}</span>
                  </span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
