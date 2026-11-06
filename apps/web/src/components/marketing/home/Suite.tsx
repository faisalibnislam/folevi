import Link from "next/link";
import { ArrowRight, ArrowUpRight, Check, FileText, MessageSquare } from "lucide-react";
import type { ReactNode } from "react";
import { Avatar, type PersonId } from "../people";
import { SectionHeading, box, container, cx } from "../ui";
import { Mark } from "../fun";

/*
 * The workspace in four parts (the owner's pillars, 2026-11-06): docs and wikis, tasks and a calendar,
 * databases and their views, and teams. Each picture is drawn from the app's pieces and is one image to
 * assistive tech, described by its label. Every claim is in the editor today (features.tsx "blocks").
 */

const card = "mk-mini-card px-3 py-2.5";
const label = "block text-[11px] font-semibold text-(--color-heading)";

function DocsPicture() {
  const pages = ["Onboarding", "How we write", "Release checklist"];
  return (
    <div className={cx(card, "w-[240px]")}>
      <span className="flex items-center gap-1.5 text-[13px] font-semibold text-(--color-heading)">
        <FileText size={13} className="text-(--mk-violet-ink)" /> Team wiki
      </span>
      <span className="mt-1.5 block text-[11px] leading-snug text-muted">Everything new people need, in one place.</span>
      {pages.map((p) => (
        <span key={p} className="mt-1.5 flex items-center gap-1.5 text-[11px] text-(--mk-violet-ink)">
          <ArrowUpRight size={11} /> <span className="underline underline-offset-2">{p}</span>
        </span>
      ))}
    </div>
  );
}

function TasksPicture() {
  const tasks = [
    { t: "Draft the brief", d: "Today", done: true },
    { t: "Review with Sam", d: "Thu" },
    { t: "Ship the update", d: "Mon" },
  ];
  return (
    <div className="flex items-center gap-2.5">
      <div className={cx(card, "w-[170px]")}>
        <span className={label}>This week</span>
        {tasks.map((x) => (
          <span key={x.t} className="mt-1.5 flex items-center gap-1.5 text-[11px]">
            <span className={cx("grid size-3 flex-none place-items-center rounded-tiny", x.done ? "bg-(--mk-violet-strong) text-white" : "shadow-[inset_0_0_0_1.2px_var(--color-line-strong)]")}>
              {x.done ? <Check size={8} strokeWidth={3} /> : null}
            </span>
            <span className={cx("min-w-0 flex-1 truncate", x.done ? "text-muted line-through" : "text-ink")}>{x.t}</span>
            <span className="flex-none rounded-chip bg-(--color-surface-sunken) px-1.5 text-[11px] text-muted">{x.d}</span>
          </span>
        ))}
      </div>
      <div className="mk-mini-card grid w-[112px] grid-cols-7 gap-0.5 px-2 py-2 text-center text-[11px] text-muted max-sm:hidden">
        {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
          <span key={i} className="font-semibold">
            {d}
          </span>
        ))}
        {Array.from({ length: 14 }, (_, i) => (
          <span key={i} className={cx("rounded-tiny", i === 3 ? "bg-(--color-heading) text-(--color-canvas)" : i === 7 ? "bg-(--mk-violet-soft) text-(--mk-violet-ink)" : "")}>
            {i + 9}
          </span>
        ))}
      </div>
    </div>
  );
}

function BoardPicture() {
  const cols: Array<{ name: string; cards: string[] }> = [
    { name: "Ideas", cards: ["Spring sale", "New logo"] },
    { name: "Doing", cards: ["Pricing page"] },
    { name: "Done", cards: ["Onboarding", "Docs"] },
  ];
  return (
    <div className={cx(card, "w-[260px]")}>
      <span className="flex gap-1 text-[11px]">
        {["Table", "Gallery", "Board"].map((v) => (
          <span key={v} className={cx("rounded-chip px-1.5 py-0.5", v === "Board" ? "bg-(--color-heading) text-(--color-canvas)" : "text-muted")}>
            {v}
          </span>
        ))}
      </span>
      <span className="mt-2 grid grid-cols-3 gap-1.5">
        {cols.map((c) => (
          <span key={c.name} className="block rounded-tiny bg-(--color-surface-sunken) p-1.5">
            <span className="block text-[11px] font-semibold text-muted">{c.name}</span>
            {c.cards.map((x) => (
              <span key={x} className="mt-1 block truncate rounded-tiny bg-(--color-surface) px-1.5 py-1 text-[11px] text-ink shadow-[0_1px_2px_rgb(0_0_0/0.06)]">
                {x}
              </span>
            ))}
          </span>
        ))}
      </span>
    </div>
  );
}

function TeamPicture() {
  const people: PersonId[] = ["maya", "sam", "ines"];
  return (
    <div className={cx(card, "w-[240px]")}>
      <span className="flex items-center justify-between">
        <span className={label}>Launch plan</span>
        <span className="flex -space-x-1.5">
          {people.map((p) => (
            <Avatar key={p} who={p} size={18} className="ring-2 ring-(--color-surface)" />
          ))}
        </span>
      </span>
      <span className="mt-2 block text-[11px] leading-snug text-ink">
        Let’s keep the launch <span className="rounded-tiny bg-(--mk-violet-soft) px-0.5">small and calm</span>.
      </span>
      <span className="mt-2 flex items-start gap-1.5 rounded-tiny bg-(--color-surface-sunken) p-1.5 text-[11px] leading-snug text-muted">
        <MessageSquare size={11} className="mt-px flex-none" />
        <span>
          <span className="font-semibold text-ink">Sam</span> Agreed. I’ll share the page with the guests.
        </span>
      </span>
    </div>
  );
}

const PILLARS: Array<{ title: string; body: string; href: string; label: string; picture: ReactNode }> = [
  {
    title: "Docs and wikis",
    body: "Pages inside pages, linked with [[, for notes, docs and a team wiki. Publish any page to the web.",
    href: "/features/blocks",
    label: "A team wiki page that links to Onboarding, How we write and Release checklist.",
    picture: <DocsPicture />,
  },
  {
    title: "Tasks and a calendar",
    body: "Write a to-do on any page, give it a date, and plan your week from one list and a calendar.",
    href: "/features/tasks",
    label: "This week's tasks with dates, beside a small two-week calendar.",
    picture: <TasksPicture />,
  },
  {
    title: "Databases and views",
    body: "Collections you can see as a table, a gallery or a kanban board, with formulas.",
    href: "/features/blocks",
    label: "A collection shown as a board, with Ideas, Doing and Done columns.",
    picture: <BoardPicture />,
  },
  {
    title: "Teams and sharing",
    body: "Workspaces for your team, editing together in real time, comments and free guests.",
    href: "/features/team-workspaces",
    label: "A shared page with three people in it and a comment from Sam.",
    picture: <TeamPicture />,
  },
];

export function Suite() {
  return (
    <section id="workspace" aria-labelledby="workspace-title" className={cx(container, "scroll-mt-20")}>
      <div className={box}>
        <SectionHeading
          id="workspace-title"
          eyebrow="One workspace"
          wide
          title={
            <>
              Docs, tasks, databases
              <br />
              and your <Mark>team</Mark>, in one place.
            </>
          }
          lede="Everything you would use a few apps for, in one calm workspace that works offline and syncs."
        />
        <ul className="mt-10 grid gap-x-5 gap-y-8 sm:grid-cols-2">
          {PILLARS.map((p) => (
            <li key={p.title} className="min-w-0">
              <div role="img" aria-label={p.label} className="mk-mini-stage" style={{ height: 236 }}>
                <div aria-hidden="true" className="sm:[zoom:1.25] lg:[zoom:1.4]">
                  {p.picture}
                </div>
              </div>
              <h3 className="mk-h3 mt-3 text-[18px]">
                <Link href={p.href} className="group inline-flex min-h-11 items-center gap-1.5 hover:underline">
                  {p.title} <ArrowRight size={15} aria-hidden="true" className="text-muted transition-transform group-hover:translate-x-0.5" />
                </Link>
              </h3>
              <p className="text-[15px] leading-relaxed text-muted">{p.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
