"use client";

import { useState } from "react";
import { ArrowUp, CalendarDays, Clock, FileText, Flag, Inbox, X } from "lucide-react";
import { describeRepeat } from "@folevi/editor-schema";
import { naturalDateLabel } from "@/lib/nlDate";
import { dueLabel } from "@/lib/format";
import { pickDate } from "@/lib/native/ui";
import { MenuButton } from "@/components/ui/Menu";
import { DocumentPicker, useQuickAdd, type Priority } from "@/components/app/QuickAddTask";
import { Sheet } from "./Sheet";

const PRIORITIES: { id: Priority; label: string; tone?: string }[] = [
  { id: "none", label: "None" },
  { id: "low", label: "Low", tone: "#5b6ad0" },
  { id: "medium", label: "Medium", tone: "#c58a12" },
  { id: "high", label: "High", tone: "#d6453d" },
];

/** "15:00" as this device writes a time ("3:00 PM"). */
const clockTime = (hhmm: string) => new Date(`2000-01-01T${hhmm}:00`).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/** A glass chip under the phone's task field: 36 tall (in a 44 pt row), its words 15 pt. */
const CHIP =
  "ui-liquid inline-flex h-9 max-w-[14rem] flex-none items-center gap-1.5 rounded-capsule px-3.5 text-subheadline leading-5 text-ink outline-none transition-transform active:scale-[0.97] [&>svg]:h-[17px] [&>svg]:w-[17px] [&>svg]:flex-none";

/**
 * Quick add on the phone: the task's words in a 17 pt field with a round add button, and under it a row of
 * glass chips (Date, Time, Priority, and where it goes) that open the system's date and time pickers, a menu,
 * and a page search. Return on the keyboard adds it too.
 */
export function PhoneQuickAdd({ onClose, currentDoc, initialDue }: { onClose: () => void; currentDoc?: string; initialDue?: string }) {
  const q = useQuickAdd({ onClose, currentDoc, initialDue });
  const [choosingPage, setChoosingPage] = useState(false);
  const ready = q.title.trim().length > 0 && !q.busy;
  const chooseDay = async () => {
    const r = await pickDate({ mode: "date", value: q.due || q.parsed?.date || q.today, title: "Due date", clearable: Boolean(q.due) });
    if (!r) return;
    q.setDue(r.value ?? "");
    if (!r.value) q.setTime("");
  };
  const chooseTime = async () => {
    const r = await pickDate({ mode: "time", value: q.time || "09:00", title: "Time", clearable: true });
    if (r) q.setTime(r.value ?? "");
  };
  const priority = PRIORITIES.find((p) => p.id === q.priority)!;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void q.submit();
      }}
      className="px-4 pb-3 pt-1"
    >
      <div className="flex items-start gap-2">
        <label htmlFor="qa-title" className="sr-only">
          Task
        </label>
        <input
          id="qa-title"
          autoFocus
          value={q.title}
          onChange={(e) => {
            q.setTitle(e.target.value);
            q.setError(null);
          }}
          placeholder="What needs doing?"
          maxLength={500}
          enterKeyHint="done"
          autoComplete="off"
          aria-invalid={q.error ? true : undefined}
          aria-describedby={q.parsed ? "qa-when" : undefined}
          className="min-h-11 min-w-0 flex-1 bg-transparent px-1 text-body leading-[22px] text-ink outline-none placeholder:text-faint"
        />
        {/* The round add button: 34 pt in the heading colour, in a 44 pt target; faint until there's a task. */}
        <button
          type="submit"
          aria-label="Add task"
          aria-disabled={!ready || undefined}
          aria-busy={q.busy || undefined}
          className={`-mr-1.5 grid h-11 w-11 flex-none place-items-center rounded-capsule outline-none ${ready ? "" : "pointer-events-none"}`}
        >
          <span className={`grid h-[34px] w-[34px] place-items-center rounded-capsule bg-heading text-canvas transition-[opacity,transform] active:scale-90 ${ready ? "" : "opacity-30"}`}>
            <ArrowUp size={19} strokeWidth={2.6} aria-hidden />
          </span>
        </button>
      </div>
      {q.repeat || q.parsed ? (
        <div className="flex flex-wrap gap-2 px-1 pb-1 pt-0.5 text-footnote leading-[18px] text-muted">
          {q.repeat ? (
            <span className="inline-flex items-center gap-1">
              Repeats {describeRepeat(q.repeat.rule).toLowerCase()}
              <button type="button" aria-label={`Keep “${q.repeat.text.trim()}” as text`} onClick={() => q.setRepeatKept(q.repeat!.text)} className="-my-3 grid h-11 w-8 place-items-center text-faint">
                <X size={14} aria-hidden />
              </button>
            </span>
          ) : null}
          {q.parsed ? (
            <span id="qa-when" className="inline-flex items-center gap-1">
              Due {naturalDateLabel(q.parsed, q.today)}, from “{q.parsed.text.trim()}”
              <button type="button" aria-label={`Keep “${q.parsed.text.trim()}” as text`} onClick={() => q.setKeptAsText(q.parsed!.text)} className="-my-3 grid h-11 w-8 place-items-center text-faint">
                <X size={14} aria-hidden />
              </button>
            </span>
          ) : null}
        </div>
      ) : null}
      {q.error ? (
        <p role="alert" className="px-1 pb-1 text-subheadline leading-5 text-danger">
          {q.error}
        </p>
      ) : null}
      {/* The chips scroll sideways when they don't fit; each is a 44 pt target. */}
      <div role="group" aria-label="Task details" className="-mx-4 flex gap-2 overflow-x-auto px-4 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <button type="button" onClick={() => void chooseDay()} className={`${CHIP} ${q.due ? "" : "text-muted"}`} aria-label={q.due ? `Due ${dueLabel(q.due, q.today)}, change` : "Due date"}>
          <CalendarDays aria-hidden />
          <span className="truncate">{q.due ? dueLabel(q.due, q.today) : "Date"}</span>
        </button>
        {q.due ? (
          <button type="button" onClick={() => void chooseTime()} className={`${CHIP} ${q.time ? "" : "text-muted"}`} aria-label={q.time ? `At ${clockTime(q.time)}, change` : "Time"}>
            <Clock aria-hidden />
            <span className="truncate">{q.time ? clockTime(q.time) : "Time"}</span>
          </button>
        ) : null}
        <MenuButton
          label={`Priority: ${priority.label}`}
          side="top"
          align="start"
          className="flex-none"
          triggerClassName={`${CHIP} ${q.priority === "none" ? "text-muted" : ""}`}
          trigger={
            <>
              <Flag aria-hidden style={priority.tone ? { color: priority.tone } : undefined} />
              <span>{q.priority === "none" ? "Priority" : priority.label}</span>
            </>
          }
          items={PRIORITIES.map((p) => ({ label: p.label, checked: q.priority === p.id, icon: <Flag size={14} style={p.tone ? { color: p.tone } : undefined} />, onSelect: () => q.setPriority(p.id) }))}
        />
        <button type="button" onClick={() => setChoosingPage(true)} className={CHIP} aria-label={`Adds to ${q.effective ? q.effective.title || "Untitled" : "Inbox"}, change`}>
          {q.effective ? <FileText aria-hidden /> : <Inbox aria-hidden />}
          <span className="truncate">{q.effective ? q.effective.title || "Untitled" : "Inbox"}</span>
        </button>
      </div>
      <Sheet open={choosingPage} onClose={() => setChoosingPage(false)} title="Add to" size="medium" bodyClassName="px-4 pb-4">
        <DocumentPicker
          scope={q.scope}
          value={q.effective}
          label="Page"
          onChange={(t) => {
            q.setTarget(t);
            setChoosingPage(false);
          }}
        />
      </Sheet>
    </form>
  );
}

