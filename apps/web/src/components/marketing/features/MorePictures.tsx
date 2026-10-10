import { ArrowRight, ArrowUp, Check, ChevronDown, ChevronLeft, ChevronRight, FileText, MoreHorizontal, Search, X } from "lucide-react";
import { cx } from "../ui";

/*
 * HTML replicas of four app surfaces, for their feature pages and cards. Labels are the app's own:
 * the ⌘K palette (components/app/CommandPalette.tsx), the calendar (views/CalendarView.tsx), a comment
 * thread (doc/Comments.tsx) and version history (doc/VersionHistory.tsx). All are pictures, not controls.
 */

const keycap = "rounded-[4px] bg-(--color-surface) px-1.5 py-0.5 font-sans text-[11px] text-muted shadow-(--shadow-control)";
const mark = "rounded-[4px] bg-[var(--color-highlight-yellow)] px-0.5 text-inherit";

/* ⌘K palette ------------------------------------------------------------------------------------------ */

export function PalettePicture() {
  return (
    <div
      role="img"
      aria-label="The search palette with “cal” typed. Filters for folder, tag and time sit under the field. Documents: Planting calendar and Reading list, with the matching words highlighted. Actions: Go to Calendar."
      className="mk-app-pop mx-auto max-w-[580px] overflow-hidden rounded-[14px] text-[13.5px]"
    >
      <div aria-hidden="true">
        <div className="flex h-14 items-center gap-3 border-b border-(--color-line) px-4">
          <Search size={18} className="text-muted" />
          <span className="flex-1 text-[15px] text-ink">
            cal<span className="ml-px inline-block h-[17px] w-px translate-y-[3px] bg-(--color-heading)" />
          </span>
          <kbd className={keycap}>Esc</kbd>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 border-b border-(--color-line) px-3 py-2 text-[12px] text-ink">
          {["Any folder", "Any tag", "Any time"].map((f) => (
            <span key={f} className="inline-flex h-7 items-center gap-1 rounded-[6px] bg-(--color-surface) px-2 shadow-(--shadow-control)">
              {f} <ChevronDown size={12} className="text-muted" />
            </span>
          ))}
          <span className="ml-auto text-muted">Personal</span>
        </div>
        <div className="p-1.5">
          <p className="px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-faint">Documents</p>
          {[
            { title: <>Planting <mark className={mark}>cal</mark>endar</>, snippet: <>Sow sweet peas in March. Beans after the last frost, usually mid-April. Label every tray.</>, on: true },
            { title: <>Reading list</>, snippet: <>The Overstory, Braiding Sweetgrass, and a short history of <mark className={mark}>cal</mark>endars, stamps and the post.</>, on: false },
          ].map((row, i) => (
            <div key={i} className={cx("flex items-start gap-3 rounded-[10px] px-2.5 py-2", row.on && "bg-(--color-accent-soft) shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--color-accent)_14%,transparent)]")}>
              <FileText size={16} className="mt-0.5 flex-none text-muted" />
              <div className="min-w-0 flex-1">
                <p className="font-medium text-(--color-heading)">{row.title}</p>
                <p className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-muted">{row.snippet}</p>
              </div>
              {row.on ? <ArrowRight size={14} className="mt-1 text-muted" /> : null}
            </div>
          ))}
          <p className="px-2.5 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-faint">Actions</p>
          <div className="flex items-center gap-3 rounded-[10px] px-2.5 py-2 text-ink">
            <ArrowRight size={16} className="text-muted" />
            <span className="flex-1">
              Go to <mark className={mark}>Cal</mark>endar
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* Calendar -------------------------------------------------------------------------------------------- */

type Pill = { time?: string; text: string; done?: boolean };
/** October 2026 from Monday 28 September, with the sample week's tasks. Today is the 1st. */
const DAYS: Array<{ n: number; out?: boolean; pills?: Pill[] }> = [
  { n: 28, out: true },
  { n: 29, out: true },
  { n: 30, out: true, pills: [{ text: "Print seed labels", done: true }] },
  { n: 1, pills: [{ time: "09:00", text: "Standup" }, { text: "Pick up keys" }] },
  { n: 2, pills: [{ time: "16:00", text: "Order envelopes" }] },
  { n: 3, pills: [{ text: "Seed swap" }] },
  { n: 4 },
  { n: 5, pills: [{ text: "Book the hall" }] },
  { n: 6 },
  { n: 7, pills: [{ time: "10:30", text: "Movers" }, { text: "Label boxes" }, { text: "Return keys" }] },
  { n: 8 },
  { n: 9, pills: [{ text: "Ferry to the coast" }] },
  { n: 10 },
  { n: 11 },
  { n: 12, pills: [{ text: "Return The Overstory" }] },
  { n: 13 },
  { n: 14, pills: [{ text: "Pricing page live" }] },
  { n: 15 },
  { n: 16 },
  { n: 17 },
  { n: 18, pills: [{ text: "Coast trip" }] },
];

export function CalendarPicture() {
  return (
    <div
      role="img"
      aria-label="The calendar in month layout for October 2026. Tasks with dates sit in their days, today is the 1st, and the panel beside it lists the tasks due on Wednesday 7 October: Movers at 10:30, Label boxes and Return keys."
      className="mk-app-pop mx-auto max-w-[900px] overflow-hidden rounded-[14px] text-[12px]"
    >
      <div aria-hidden="true">
        <div className="flex items-center gap-3 border-b border-(--color-line) px-5 py-3">
          <div className="flex-1">
            <p className="mk-display text-[22px] text-(--color-heading)">Calendar</p>
            <p className="text-[12.5px] text-muted">October 2026</p>
          </div>
          <span className="flex rounded-[6px] bg-(--color-surface-sunken) p-0.5 text-[12px]">
            <span className="rounded-[4px] bg-(--color-surface-raised) px-2.5 py-1 font-medium text-(--color-heading) shadow-(--shadow-control)">Month</span>
            <span className="px-2.5 py-1 text-muted">Agenda</span>
          </span>
          <span className="flex items-center gap-1 text-ink">
            <ChevronLeft size={16} className="text-muted" />
            <span className="rounded-[6px] px-2 py-1 shadow-(--shadow-control)">Today</span>
            <ChevronRight size={16} className="text-muted" />
          </span>
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_220px]">
          <div className="p-3">
            <div className="grid grid-cols-7 pb-1 text-center text-[11px] font-medium text-muted">
              {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
                <span key={d}>{d}</span>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-px overflow-hidden rounded-[10px] bg-(--color-line)">
              {DAYS.map((d) => (
                <div key={`${d.out ? "s" : "o"}${d.n}`} className={cx("min-h-[78px] bg-(--color-surface) p-1.5", d.n === 7 && !d.out && "bg-(--color-accent-soft)")}>
                  <span
                    className={cx(
                      "inline-grid size-5 place-items-center rounded-[6px] text-[11px]",
                      d.n === 1 && !d.out ? "bg-(--color-heading) font-semibold text-(--color-canvas)" : d.out ? "text-faint" : "text-ink",
                    )}
                  >
                    {d.n}
                  </span>
                  <div className="mt-1 space-y-0.5">
                    {(d.pills ?? []).slice(0, 3).map((p) => (
                      <p key={p.text} className={cx("truncate rounded-[4px] bg-(--glass-hover) px-1 py-px text-[10.5px]", p.done ? "text-faint line-through" : "text-ink")}>
                        {p.time ? <span className="tabular-nums text-muted">{p.time} </span> : null}
                        {p.text}
                      </p>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="border-l border-(--color-line) p-4">
            <p className="font-semibold text-(--color-heading)">Wednesday, 7 October</p>
            <div className="mt-2 space-y-2">
              {[
                ["10:30", "Movers", "Studio move"],
                ["", "Label boxes", "Studio move"],
                ["", "Return keys", "Studio move"],
              ].map(([time, text, page]) => (
                <div key={text} className="flex items-start gap-2">
                  <span className="mt-0.5 size-[13px] flex-none rounded-[4px] shadow-[inset_0_0_0_1.5px_var(--color-line-strong)]" />
                  <div>
                    <p className="text-ink">{text}</p>
                    <p className="text-[11px] text-muted">
                      {time ? `${time} · ` : ""}
                      {page}
                    </p>
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-4 text-[11px] leading-snug text-faint">Drag tasks between days to reschedule, or use a task’s edit button to pick a date.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

/* Comments -------------------------------------------------------------------------------------------- */

function Face({ initial, tone }: { initial: string; tone: string }) {
  return <span className={cx("grid size-6 flex-none place-items-center rounded-[6px] text-[11px] font-semibold text-white", tone)}>{initial}</span>;
}

export function CommentsPicture() {
  return (
    <div
      role="img"
      aria-label="A note with a comment thread on one paragraph. Maya asks Ines to check the hall booking, Ines replies that it is booked for Saturday, and the reply box sits below. Under the paragraph: 2 comments."
      className="mx-auto max-w-[560px] text-[13.5px]"
    >
      <div aria-hidden="true">
        <div className="mk-app-pop rounded-[14px] px-6 pb-5 pt-5">
          <p className="mk-display text-[21px] text-(--color-heading)">Seed swap</p>
          <p className="mt-2 rounded-[4px] bg-[color-mix(in_oklab,#f5b43c_18%,transparent)] px-1 leading-relaxed text-ink">The library hall is free on the 5th, from 10 to 2.</p>
          <p className="mt-1.5 flex items-center gap-1.5 text-[11.5px] text-muted">
            <span className="flex -space-x-1.5">
              <Face initial="M" tone="bg-[#7c6cf0]" />
              <Face initial="I" tone="bg-[#2f9e78]" />
            </span>
            2 comments · 8:18 AM
          </p>
          <p className="mt-3 leading-relaxed text-ink">Bring seeds in paper envelopes, and label every packet.</p>
        </div>
        <div className="mk-app-pop relative z-10 -mt-12 ml-8 max-w-[360px] overflow-hidden rounded-[14px] sm:ml-16">
          <div className="flex items-center gap-1 border-b border-(--color-line) px-3.5 py-2.5">
            <p className="flex-1 text-[13px] font-semibold text-(--color-heading)">Comments</p>
            <MoreHorizontal size={15} className="text-muted" />
            <span className="grid size-7 place-items-center rounded-[6px] text-muted">
              <Check size={15} />
            </span>
            <X size={15} className="text-muted" />
          </div>
          <div className="space-y-3 px-3.5 py-3">
            {[
              { face: <Face initial="M" tone="bg-[#7c6cf0]" />, name: "Maya", time: "8:12 AM", body: <><span className="rounded-[4px] bg-(--color-accent-soft) px-1 font-medium text-(--color-heading)">@Ines</span> can you check the booking?</> },
              { face: <Face initial="I" tone="bg-[#2f9e78]" />, name: "Ines", time: "8:18 AM", body: <>Booked for Saturday. I’ll bring the key.</> },
            ].map((c) => (
              <div key={c.name} className="flex gap-2.5">
                {c.face}
                <div className="min-w-0">
                  <p className="text-[12px]">
                    <span className="font-semibold text-(--color-heading)">{c.name}</span>
                    <span className="text-muted"> · {c.time}</span>
                  </p>
                  <p className="mt-0.5 text-ink">{c.body}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2 border-t border-(--color-line) px-3 py-2.5">
            <span className="flex-1 text-faint">Reply</span>
            <span className="grid size-7 place-items-center rounded-[6px] bg-(--color-heading) text-(--color-canvas) opacity-40">
              <ArrowUp size={14} />
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* Version history ------------------------------------------------------------------------------------- */

export function VersionsPicture() {
  return (
    <div
      role="img"
      aria-label="The version history dialog. On the left, the versions: today at 09:41, autosaved; today at 08:05, saved when closed; yesterday, saved manually. The selected one is previewed on the right, with Restore below it."
      className="mk-app-pop mx-auto max-w-[760px] overflow-hidden rounded-[14px] text-[12.5px]"
    >
      <div aria-hidden="true">
        <div className="flex items-start gap-3 border-b border-(--color-line) px-5 py-4">
          <div className="flex-1">
            <p className="mk-display text-[19px] text-(--color-heading)">Version history</p>
            <p className="mt-0.5 text-muted">Versions are saved after a pause in editing and when you close a page, not on every keystroke.</p>
          </div>
          <X size={16} className="text-muted" />
        </div>
        <div className="grid grid-cols-[220px_minmax(0,1fr)]">
          <div className="space-y-0.5 border-r border-(--color-line) p-2">
            {[
              ["Today, 09:41", "Autosaved version · Maya", true],
              ["Today, 08:05", "Saved when closed · Ines", false],
              ["Yesterday, 18:20", "Saved manually · Maya", false],
              ["Yesterday, 11:02", "Autosaved version · Maya", false],
              ["Sep 28, 16:47", "Imported · Maya", false],
            ].map(([when, why, on]) => (
              <div key={String(when)} className={cx("rounded-[10px] px-2.5 py-2", on && "bg-(--color-accent-soft) shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--color-accent)_14%,transparent)]")}>
                <p className="font-medium text-(--color-heading)">{when}</p>
                <p className="text-[11.5px] text-muted">{why}</p>
              </div>
            ))}
            <p className="px-2.5 pt-2">
              <span className="inline-flex rounded-[6px] px-2 py-1 text-ink shadow-(--shadow-control)">Save a version now</span>
            </p>
          </div>
          <div className="flex flex-col">
            <div className="flex-1 px-6 py-5" style={{ fontFamily: "var(--font-serif)" }}>
              <p className="text-[18px] font-semibold text-(--color-heading)">Seed swap</p>
              <p className="mt-2 leading-relaxed text-ink">The library hall is free on the 5th, from 10 to 2.</p>
              <p className="mt-2 leading-relaxed text-ink">Bring seeds in paper envelopes, and label every packet.</p>
              <ul className="mt-2 space-y-1 text-ink">
                {["Book the hall", "Print seed labels"].map((t) => (
                  <li key={t} className="flex items-center gap-2">
                    <span className="size-[13px] rounded-[4px] shadow-[inset_0_0_0_1.5px_var(--color-line-strong)]" />
                    {t}
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex justify-end border-t border-(--color-line) px-4 py-3">
              <span className="mk-btn mk-btn-primary h-8 px-3 text-[12.5px]">Restore…</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
