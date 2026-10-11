import { Check, Command, Search } from "lucide-react";
import { AiIcon } from "@/components/ai/AiIcon";
import { cx } from "./ui";

/*
 * Small pieces of the app, cut out to float beside sections (fun.tsx Float): a task, a Foli AI answer, a
 * collaborator's cursor, the save status, a shortcut, a row of note themes, a mention, a slash menu.
 * Decorative: Float hides them from assistive tech.
 */

const pop = "mk-app-pop rounded-panel text-[12.5px] text-ink";

export function TaskPiece({ text, due, done = false, className }: { text: string; due?: string; done?: boolean; className?: string }) {
  return (
    <div className={cx(pop, "flex w-max max-w-[260px] items-center gap-2.5 px-3 py-2.5", className)}>
      <span className={cx("grid size-[15px] flex-none place-items-center rounded-tiny", done ? "bg-(--mk-violet-strong) text-white" : "shadow-[inset_0_0_0_1.5px_var(--color-line-strong)]")}>
        {done ? <Check size={11} strokeWidth={3} /> : null}
      </span>
      <span className={cx("min-w-0 truncate font-medium text-(--color-heading)", done && "text-muted line-through")}>{text}</span>
      {due ? <span className="flex-none rounded-chip bg-(--mk-violet-soft) px-1.5 py-0.5 text-[11px] font-semibold text-(--mk-violet-ink)">{due}</span> : null}
    </div>
  );
}

export function AiPiece({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cx(pop, "w-[240px] p-3", className)}>
      <p className="flex items-center gap-1.5 text-[11.5px] font-semibold text-(--color-heading)">
        <AiIcon size={13} /> Foli AI
      </p>
      <p className="mt-1.5 leading-snug">{text}</p>
    </div>
  );
}

export function CursorPiece({ name, tone = "violet", className }: { name: string; tone?: "violet" | "ink" | "moss"; className?: string }) {
  const color = tone === "violet" ? "var(--mk-violet-strong)" : tone === "moss" ? "var(--color-moss-ink)" : "var(--color-heading)";
  return (
    <div className={cx("flex w-max flex-col items-start", className)}>
      <svg width="18" height="20" viewBox="0 0 18 20" aria-hidden="true">
        <path d="M2 2l13 7-6 1.6L6.4 17z" fill={color} stroke="white" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
      <span className="ml-3 -mt-1 rounded-chip px-2 py-0.5 text-[11.5px] font-semibold text-white shadow-(--shadow-control)" style={{ background: color }}>
        {name}
      </span>
    </div>
  );
}

export function SyncPiece({ label = "Saved", className }: { label?: string; className?: string }) {
  return (
    <div className={cx(pop, "flex w-max items-center gap-2 rounded-chip px-3 py-1.5 font-medium", className)}>
      <span className="size-2 rounded-chip bg-(--color-moss-ink)" />
      {label}
    </div>
  );
}

export function KeysPiece({ keys, label, className }: { keys: string[]; label?: string; className?: string }) {
  return (
    <div className={cx(pop, "flex w-max items-center gap-2 px-3 py-2", className)}>
      {keys.map((k) => (
        <kbd key={k} className="mk-kbd text-[13px]">
          {k === "⌘" ? <Command size={12} aria-hidden /> : k}
        </kbd>
      ))}
      {label ? <span className="text-muted">{label}</span> : null}
    </div>
  );
}

export function ThemesPiece({ arts, className }: { arts: string[]; className?: string }) {
  return (
    <div className={cx(pop, "flex w-max gap-1.5 p-2", className)}>
      {arts.map((id, i) => (
        <span
          key={id}
          className={cx("h-12 w-9 rounded-small bg-cover bg-center", i === 1 && "ring-2 ring-(--mk-violet-strong) ring-offset-2 ring-offset-(--color-surface)")}
          style={{ backgroundImage: `url("/covers/${id}-thumb.webp")` }}
        />
      ))}
    </div>
  );
}

export function MentionPiece({ name, className }: { name: string; className?: string }) {
  return (
    <div className={cx(pop, "w-max px-3 py-2", className)}>
      <span className="rounded-tiny bg-(--mk-violet-soft) px-1 font-semibold text-(--mk-violet-ink)">@{name}</span> can you check this?
    </div>
  );
}

export function SearchPiece({ query, className }: { query: string; className?: string }) {
  return (
    <div className={cx(pop, "flex w-[230px] items-center gap-2 px-3 py-2.5", className)}>
      <Search size={14} className="text-muted" aria-hidden />
      <span className="flex-1 text-(--color-heading)">{query}</span>
      <kbd className="mk-kbd text-[11px]">⌘K</kbd>
    </div>
  );
}

export function SlashPiece({ className }: { className?: string }) {
  return (
    <div className={cx(pop, "w-[180px] p-1.5", className)}>
      {["To-do list", "Heading", "Flowchart", "Callout"].map((x, i) => (
        <p key={x} className={cx("rounded-small px-2 py-1.5", i === 0 && "mk-app-row-on")}>
          {x}
        </p>
      ))}
    </div>
  );
}
