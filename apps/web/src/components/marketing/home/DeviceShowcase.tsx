"use client";

import {
  ArrowLeft,
  ArrowUpDown,
  Bell,
  Bookmark,
  Calendar,
  ChevronsUpDown,
  FileDiff,
  Files,
  FolderPlus,
  Inbox,
  LayoutTemplate,
  MessagesSquare,
  PanelLeft,
  Plus,
  Share2,
  SquareCheck,
  Waypoints,
  Check,
  CheckSquare,
  ChevronRight,
  FileText,
  Heading2,
  House,
  KeyRound,
  LayoutGrid,
  LockKeyhole,
  ScanFace,
  Search,
  Table2,
  Wifi,
  Workflow,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AiIcon } from "@/components/ai/AiIcon";
import { Avatar } from "../people";
import { artById, artVars } from "../product/Replica";
import { cx } from "../ui";

/*
 * The apps at work, drawn by hand in HTML: a Mac window with Folevi open and an iPhone in front of it, playing
 * five short chapters (writing with /, tasks and a calendar, a database board, Foli AI and the Vault). It plays
 * on its own, pauses while the pointer or focus is on it, and the tabs underneath jump to a chapter. With
 * reduced motion each chapter shows its finished state and nothing moves by itself. The whole scene is one
 * picture to assistive tech; the tabs say what each chapter shows.
 */

type ChapterId = "write" | "together" | "tasks" | "board" | "ai" | "vault";
const CHAPTERS: Array<{ id: ChapterId; label: string; steps: number; says: string }> = [
  { id: "write", label: "Write with /", steps: 4, says: "A page called Spring launch being written: the / menu adds a table of tasks." },
  { id: "together", label: "Write together", steps: 4, says: "Maya and Sam edit the same page at once, with their cursors showing, and talk it through in a comment." },
  { id: "tasks", label: "Tasks and calendar", steps: 3, says: "This week's tasks get a date and appear on the calendar; the iPhone ticks one off." },
  { id: "board", label: "Databases", steps: 3, says: "A content plan collection switches from a table to a board, and a card moves to Done." },
  { id: "ai", label: "Foli AI", steps: 3, says: "Foli AI is asked what's left before the launch and answers with sources from the notes." },
  { id: "vault", label: "Vault", steps: 3, says: "The Vault unlocks with a passcode on the Mac and Face ID on the iPhone, showing passwords and a 2FA code." },
];
const STEP_MS = 1700;
/** The scene is drawn at this size and scaled to fit its column. */
const W = 980;
const H = 680;

export function DeviceShowcase() {
  const [chapter, setChapter] = useState(0);
  const [step, setStep] = useState(0);
  const [paused, setPaused] = useState(false);
  const [still, setStill] = useState(false);
  const [scale, setScale] = useState(1);
  const frame = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setStill(reduce.matches);
    apply();
    reduce.addEventListener("change", apply);
    return () => reduce.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setScale(Math.min(1, (e?.contentRect.width ?? W) / W)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Steps through the chapter, then on to the next one; reduced motion shows the finished state.
  useEffect(() => {
    if (still) {
      setStep(CHAPTERS[chapter]!.steps - 1);
      return;
    }
    if (paused) return;
    const last = CHAPTERS[chapter]!.steps - 1;
    const t = window.setTimeout(
      () => {
        if (step < last) setStep(step + 1);
        else {
          setChapter((chapter + 1) % CHAPTERS.length);
          setStep(0);
        }
      },
      step === last ? STEP_MS * 1.8 : STEP_MS,
    );
    return () => window.clearTimeout(t);
  }, [chapter, step, paused, still]);

  const go = (i: number) => {
    setChapter(i);
    setStep(still ? CHAPTERS[i]!.steps - 1 : 0);
  };
  const c = CHAPTERS[chapter]!;
  const total = c.steps;

  return (
    <div onPointerEnter={() => setPaused(true)} onPointerLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}>
      <div ref={frame} className="relative w-full" style={{ height: H * scale }}>
        <div role="img" aria-label={`Folevi on a Mac and an iPhone. ${c.says}`} className="absolute left-1/2 top-0 origin-top" style={{ width: W, height: H, transform: `translateX(-50%) scale(${scale})` }}>
          <div aria-hidden="true">
            <MacWindow chapter={c.id} step={step} />
            <Phone chapter={c.id} step={step} />
          </div>
        </div>
      </div>
      <div role="tablist" aria-label="What the apps can do" className="mx-auto mt-6 flex max-w-full flex-wrap justify-center gap-1.5">
        {CHAPTERS.map((ch, i) => (
          <button
            key={ch.id}
            type="button"
            role="tab"
            aria-selected={i === chapter}
            onClick={() => go(i)}
            className={cx(
              "relative overflow-hidden rounded-chip px-3.5 py-2 text-[13px] font-medium transition-colors",
              i === chapter ? "bg-(--color-heading) text-(--color-canvas)" : "bg-(--color-surface-sunken) text-muted hover:bg-(--glass-hover) hover:text-(--color-heading)",
            )}
          >
            {ch.label}
            {i === chapter && !still ? (
              <span
                aria-hidden="true"
                className="absolute bottom-0 left-0 h-0.5 bg-(--color-canvas) opacity-60 transition-[width] duration-500"
                style={{ width: `${((step + 1) / total) * 100}%` }}
              />
            ) : null}
          </button>
        ))}
      </div>
    </div>
  );
}

/* The Mac ------------------------------------------------------------------------------------------- */

/* The sidebar, rows and tabs as Folevi for Mac draws them (FoleviMac WebNoteSidebar and the tab strip). */
const SIDEBAR: Array<{ icon: ReactNode; label: string; for?: ChapterId[]; count?: number; more?: boolean }> = [
  { icon: <House size={15} />, label: "Home" },
  { icon: <AiIcon size={15} />, label: "Work with Foli AI", for: ["ai"] },
  { icon: <Waypoints size={15} />, label: "Foli DNA" },
  { icon: <Bookmark size={15} />, label: "Bookmarks", more: true },
  { icon: <Inbox size={15} />, label: "Drafts", count: 4 },
  { icon: <Files size={15} />, label: "All notes" },
  { icon: <SquareCheck size={15} />, label: "Tasks", for: ["tasks"] },
  { icon: <Calendar size={15} />, label: "Calendar" },
  { icon: <Share2 size={15} />, label: "Shared with Me" },
  { icon: <LockKeyhole size={15} />, label: "Vault", for: ["vault"] },
  { icon: <FileDiff size={15} />, label: "Changes" },
  { icon: <LayoutTemplate size={15} />, label: "Templates" },
];
const FOLDERS: Array<{ label: string; color: string; for?: ChapterId[]; depth?: number; open?: boolean }> = [
  { label: "Spring launch", color: "#e8775a", for: ["write", "together"] },
  { label: "Content plan", color: "#5b8fe0", for: ["board"] },
  { label: "Team wiki", color: "#4fae8c", open: true },
  { label: "Onboarding", color: "#9fd3bf", depth: 1 },
  { label: "Personal", color: "#e48aa8" },
];
const TABS: Array<{ icon: ReactNode; title: string; for: ChapterId[] }> = [
  { icon: <FileText size={13} />, title: "Spring launch", for: ["write", "together", "ai"] },
  { icon: <FileText size={13} />, title: "Content plan", for: ["board"] },
  { icon: <SquareCheck size={13} />, title: "Tasks", for: ["tasks"] },
  { icon: <LockKeyhole size={13} />, title: "Vault", for: ["vault"] },
];

function MacWindow({ chapter, step }: { chapter: ChapterId; step: number }) {
  const row = (on: boolean) => cx("flex h-[27px] items-center gap-2.5 rounded-small px-2.5 text-[13px]", on ? "bg-(--glass-hover) font-medium text-(--color-heading)" : "text-ink");
  return (
    <div className="absolute left-0 top-0 flex h-[640px] w-[860px] overflow-hidden rounded-container bg-(--color-surface-sunken) shadow-[0_30px_80px_-20px_rgb(0_0_0/0.35),0_0_0_1px_rgb(0_0_0/0.08)]">
      <aside className="flex w-[206px] flex-none flex-col px-2 pb-2">
        <div className="flex h-11 flex-none items-center gap-2 px-1.5">
          <span className="size-3 rounded-chip bg-[#ff5f57]" />
          <span className="size-3 rounded-chip bg-[#febc2e]" />
          <span className="size-3 rounded-chip bg-[#28c840]" />
          <span className="flex-1" />
          <MessagesSquare size={14} className="text-muted" />
          <Bell size={14} className="text-muted" />
          <PanelLeft size={14} className="text-muted" />
        </div>
        <div className="flex h-8 items-center gap-2 rounded-small bg-(--color-surface) px-2.5 text-[12px] text-muted shadow-[0_0_0_1px_var(--mk-hair)]">
          <Search size={13} />
          <span className="flex-1">Search or jump to…</span>
          <span className="rounded-tiny bg-(--color-surface-sunken) px-1 text-[11px] font-semibold">⌘K</span>
        </div>
        <ul className="mt-2.5 space-y-px">
          {SIDEBAR.map((r) => (
            <li key={r.label} className={row(Boolean(r.for?.includes(chapter)))}>
              <span className="flex-none text-muted">{r.icon}</span>
              <span className="min-w-0 flex-1 truncate">{r.label}</span>
              {r.count ? <span className="rounded-chip bg-(--glass-hover) px-1.5 text-[11px] font-semibold text-muted">{r.count}</span> : null}
              {r.more ? <ChevronRight size={12} className="text-muted" /> : null}
            </li>
          ))}
        </ul>
        <p className="mt-3 flex items-center gap-1.5 px-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">
          <ChevronRight size={11} className="rotate-90" />
          <span className="flex-1">Folders</span>
          <ArrowUpDown size={12} />
          <FolderPlus size={12} />
        </p>
        <ul className="mt-1 space-y-px">
          {FOLDERS.map((f) => (
            <li key={f.label} className={row(Boolean(f.for?.includes(chapter)))} style={{ paddingLeft: 10 + (f.depth ?? 0) * 16 }}>
              {f.open ? <ChevronRight size={11} className="-ml-3.5 rotate-90 text-muted" /> : null}
              <span className="size-3 flex-none rounded-tiny" style={{ background: f.color }} />
              <span className="min-w-0 flex-1 truncate">{f.label}</span>
            </li>
          ))}
        </ul>
        <div className="mt-auto flex items-center gap-2.5 px-1.5 pt-2">
          <span className="grid size-8 flex-none place-items-center rounded-small bg-[#2f6fe4] text-[14px] font-semibold text-white">S</span>
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block truncate text-[13px] font-semibold text-(--color-heading)">Studio</span>
            <span className="block truncate text-[11px] text-muted">Maya Patel</span>
          </span>
          <ChevronsUpDown size={13} className="text-muted" />
        </div>
      </aside>
      <div className="relative my-2 mr-2 flex min-w-0 flex-1 flex-col overflow-hidden rounded-panel bg-(--color-surface) shadow-[0_0_0_1px_rgb(0_0_0/0.06),0_1px_3px_rgb(0_0_0/0.05)]">
        <div className="flex h-11 flex-none items-center gap-1 border-b mk-hair px-2">
          <ArrowLeft size={14} className="mx-1 text-muted" />
          <ArrowLeft size={14} className="mx-1 rotate-180 text-faint" />
          <LayoutGrid size={14} className="mx-1 text-muted" />
          <span className="mx-1 h-4 w-px bg-(--color-line-strong) opacity-60" />
          <span className="grid size-7 flex-none place-items-center rounded-small text-muted shadow-[0_0_0_1px_var(--mk-hair)]">
            <House size={13} />
          </span>
          {TABS.map((t) => {
            const on = t.for.includes(chapter);
            return (
              <span
                key={t.title}
                className={cx(
                  "flex h-7 min-w-0 flex-[0_1_118px] items-center gap-1.5 rounded-small px-2 text-[12px]",
                  on ? "bg-(--color-surface) font-medium text-(--color-heading) shadow-[0_0_0_1px_var(--mk-hair),0_1px_2px_rgb(0_0_0/0.06)]" : "bg-(--color-surface-sunken) text-muted",
                )}
              >
                <span className="flex-none opacity-70">{t.icon}</span>
                <span className="truncate">{t.title}</span>
              </span>
            );
          })}
          <span className="flex-1" />
          <span className="flex h-7 flex-none items-center gap-1 rounded-small bg-(--color-heading) px-2.5 text-[12px] font-medium text-(--color-canvas)">
            <Plus size={12} /> New note
          </span>
        </div>
        <main className="relative min-h-0 flex-1 overflow-hidden">
          {chapter === "write" ? <MacWrite step={step} /> : null}
          {chapter === "together" ? <MacTogether step={step} /> : null}
          {chapter === "tasks" ? <MacTasks step={step} /> : null}
          {chapter === "board" ? <MacBoard step={step} /> : null}
          {chapter === "ai" ? <MacAi step={step} /> : null}
          {chapter === "vault" ? <MacVault step={step} /> : null}
        </main>
        {chapter !== "ai" ? (
          <span className="absolute bottom-3 right-[132px] flex h-9 items-center gap-1.5 rounded-control bg-(--color-heading) px-3.5 text-[12px] font-medium text-(--color-canvas) shadow-[0_8px_20px_-6px_rgb(0_0_0/0.4)]">
            <AiIcon size={14} /> Ask Foli AI
          </span>
        ) : null}
      </div>
    </div>
  );
}

const fade = (on: boolean) => cx("transition-all duration-500", on ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-1.5 opacity-0");

function Cover({ title, tall = true }: { title: string; tall?: boolean }) {
  const art = artById("art-03");
  return (
    <div className="mk-note" style={artVars(art, "large")}>
      <div className={cx("mk-note-cover flex items-end px-10", tall ? "h-[150px] pb-4" : "h-[110px] pb-3")} data-tone={art.tone}>
        <p className="mk-note-title text-[34px]">{title}</p>
      </div>
    </div>
  );
}

const WRITE_TEXT = "Launch day is Thursday the 12th. Here’s who does what.";

function MacWrite({ step }: { step: number }) {
  const typed = step === 0 ? WRITE_TEXT.slice(0, 26) : WRITE_TEXT;
  return (
    <div className="h-full" style={{ fontFamily: "var(--font-serif)" }}>
      <Cover title="Spring launch" />
      <div className="relative px-10 pt-5 text-[15px] leading-[1.6] text-ink">
        <p>
          {typed}
          {step === 0 ? <span className="ml-px inline-block h-4 w-0.5 translate-y-0.5 animate-pulse bg-(--mk-violet-strong)" /> : null}
        </p>
        <p className="mt-2 text-muted">{step >= 1 ? "/table" : ""}</p>
        <div className={cx("absolute left-10 top-20 z-10 w-[230px] rounded-panel bg-(--color-surface) p-1.5 font-sans shadow-[0_12px_32px_-8px_rgb(0_0_0/0.3),0_0_0_1px_rgb(0_0_0/0.06)]", fade(step === 1))}>
          {[
            { icon: <Heading2 size={14} />, t: "Heading" },
            { icon: <CheckSquare size={14} />, t: "To-do" },
            { icon: <Table2 size={14} />, t: "Table", on: true },
            { icon: <Workflow size={14} />, t: "Flowchart" },
          ].map((o) => (
            <p key={o.t} className={cx("flex items-center gap-2 rounded-small px-2 py-1.5 text-[12px]", o.on ? "bg-(--mk-violet-soft) text-(--mk-violet-ink)" : "text-ink")}>
              {o.icon} {o.t}
            </p>
          ))}
        </div>
        <table className={cx("mt-1 w-full border-collapse font-sans text-[12px]", fade(step >= 2))}>
          <thead>
            <tr className="text-left text-muted">
              {["Task", "Owner", "Status"].map((h) => (
                <th key={h} className="border-b mk-hair py-1.5 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[
              ["Press kit", "Maya", "Done"],
              ["Launch post", "Sam", "Doing"],
              ["Pricing page", "Ines", step >= 3 ? "Done" : "Doing"],
            ].map((r) => (
              <tr key={r[0]}>
                <td className="border-b mk-hair py-1.5 text-ink">{r[0]}</td>
                <td className="border-b mk-hair py-1.5 text-muted">{r[1]}</td>
                <td className="border-b mk-hair py-1.5">
                  <span className={cx("rounded-chip px-2 py-0.5 text-[11px] font-medium transition-colors duration-500", r[2] === "Done" ? "bg-[#dff3e8] text-[#1f7a4d]" : "bg-[#fdf0d8] text-[#9a6412]")}>{r[2]}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** A collaborator's caret with their name, as shared notes show it. */
function Caret({ who, name, color, on }: { who: "maya" | "sam"; name: string; color: string; on: boolean }) {
  return (
    <span className={cx("relative inline-block h-[18px] w-0.5 translate-y-[3px] align-baseline transition-opacity duration-300", on ? "opacity-100" : "opacity-0")} style={{ background: color }}>
      <span className="absolute -top-5 left-0 flex items-center gap-1 whitespace-nowrap rounded-tiny py-0.5 pl-0.5 pr-1.5 font-sans text-[11px] font-semibold text-white" style={{ background: color }}>
        <Avatar who={who} size={14} /> {name}
      </span>
    </span>
  );
}

const SAM_LINE = "Thursday works. I’ll share the page with the press list.";
const MAYA = "#c2577a";
const SAM = "#d9774b";

function MacTogether({ step }: { step: number }) {
  const typed = step === 0 ? "" : step === 1 ? SAM_LINE.slice(0, 24) : SAM_LINE;
  return (
    <div className="flex h-full">
      <div className="min-w-0 flex-1" style={{ fontFamily: "var(--font-serif)" }}>
        <Cover title="Spring launch" tall={false} />
        <div className="space-y-3 px-8 pt-7 text-[15px] leading-[2.1] text-ink">
          <p>
            Launch day is{" "}
            <span className={cx("rounded-tiny transition-colors duration-500", step >= 2 ? "bg-[#fde6b0]" : "")}>Thursday the 12th</span>
            . Here’s who does what.
            <Caret who="maya" name="Maya" color={MAYA} on={step >= 0} />
          </p>
          <p className="min-h-[24px]">
            {typed}
            <Caret who="sam" name="Sam" color={SAM} on={step >= 1 && step < 3} />
          </p>
          <p className="text-muted">Press kit, launch post, pricing page.</p>
        </div>
      </div>
      <div className="w-[250px] flex-none border-l mk-hair bg-(--color-surface-sunken) p-4">
        <p className="text-[12px] font-semibold text-muted">Comments</p>
        <div className={cx("mt-3 rounded-panel bg-(--color-surface) p-3 shadow-[0_1px_3px_rgb(0_0_0/0.08)]", fade(step >= 2))}>
          <p className="rounded-tiny bg-[#fde6b0] px-1.5 text-[11px] text-ink">Thursday the 12th</p>
          <p className="mt-2 flex items-center gap-1.5 text-[12px] font-semibold text-(--color-heading)">
            <Avatar who="maya" size={18} /> Maya
          </p>
          <p className="mt-1 text-[12px] leading-snug text-ink">
            Can we keep Thursday? <span className="font-medium text-(--mk-violet-ink)">@Sam</span> is the press list ready?
          </p>
          <div className={cx("mt-2.5 border-t mk-hair pt-2.5", fade(step >= 3))}>
            <p className="flex items-center gap-1.5 text-[12px] font-semibold text-(--color-heading)">
              <Avatar who="sam" size={18} /> Sam
            </p>
            <p className="mt-1 text-[12px] leading-snug text-ink">Yes, it’s ready. Sharing now.</p>
            <p className="mt-2 flex items-center gap-1 text-[11px] font-medium text-[#1f7a4d]">
              <Check size={12} /> Resolved
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

const WEEK = ["Mon 9", "Tue 10", "Wed 11", "Thu 12", "Fri 13"];

function MacTasks({ step }: { step: number }) {
  const tasks = [
    { t: "Send the press kit", d: "Mon", done: true },
    { t: "Review the launch post", d: "Wed" },
    { t: "Publish the pricing page", d: step >= 1 ? "Thu" : "" },
    { t: "Thank-you notes to beta testers", d: "Fri" },
  ];
  const onDay: Record<string, string[]> = { "Mon 9": ["Press kit"], "Wed 11": ["Launch post"], "Fri 13": ["Thank-yous"], "Thu 12": step >= 1 ? ["Pricing page"] : [] };
  return (
    <div className="flex h-full gap-5 p-6">
      <div className="w-[250px] flex-none">
        <p className="text-[20px] font-semibold text-(--color-heading)">This week</p>
        <p className="text-[12px] text-muted">From every page in Studio</p>
        <ul className="mt-4 space-y-1">
          {tasks.map((x) => (
            <li key={x.t} className="flex items-center gap-2 rounded-small px-1.5 py-1.5 text-[13px]">
              <span className={cx("grid size-4 flex-none place-items-center rounded-tiny", x.done ? "bg-(--mk-violet-strong) text-white" : "shadow-[inset_0_0_0_1.5px_var(--color-line-strong)]")}>
                {x.done ? <Check size={10} strokeWidth={3} /> : null}
              </span>
              <span className={cx("min-w-0 flex-1 truncate", x.done ? "text-muted line-through" : "text-ink")}>{x.t}</span>
              <span className={cx("rounded-chip px-1.5 text-[11px]", x.d ? "bg-(--color-surface-sunken) text-muted" : "", x.t.startsWith("Publish") && step >= 1 ? "bg-(--mk-violet-soft) text-(--mk-violet-ink)" : "")}>{x.d}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="grid min-w-0 flex-1 grid-cols-5 overflow-hidden rounded-panel shadow-[0_0_0_1px_var(--mk-hair)]">
        {WEEK.map((d) => (
          <div key={d} className={cx("border-r mk-hair p-2 last:border-r-0", d === "Thu 12" && "bg-(--mk-violet-soft)/40")}>
            <p className={cx("text-[11px] font-semibold", d === "Thu 12" ? "text-(--mk-violet-ink)" : "text-muted")}>{d}</p>
            {(onDay[d] ?? []).map((e) => (
              <p key={e} className={cx("mt-2 rounded-small bg-(--color-surface-sunken) px-1.5 py-1 text-[11px] text-ink", e === "Pricing page" && "bg-(--mk-violet-soft) text-(--mk-violet-ink)", e === "Pricing page" ? fade(step >= 1) : "")}>
                {e}
              </p>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

const ITEMS = [
  { t: "Launch post", who: "sam" as const, tag: "Blog" },
  { t: "Customer story", who: "ines" as const, tag: "Blog" },
  { t: "Spring newsletter", who: "maya" as const, tag: "Email" },
  { t: "Feature video", who: "sam" as const, tag: "Video" },
];

function MacBoard({ step }: { step: number }) {
  const board = step >= 1;
  const status = (t: string) => (t === "Spring newsletter" ? "Done" : t === "Launch post" ? (step >= 2 ? "Done" : "Doing") : t === "Customer story" ? "Doing" : "Ideas");
  return (
    <div className="h-full p-6">
      <p className="text-[20px] font-semibold text-(--color-heading)">Content plan</p>
      <div className="mt-3 flex gap-1 text-[12px]">
        {[
          { t: "Table", icon: <Table2 size={12} />, on: !board },
          { t: "Gallery", icon: <LayoutGrid size={12} />, on: false },
          { t: "Board", icon: <LayoutGrid size={12} />, on: board },
        ].map((v) => (
          <span key={v.t} className={cx("flex items-center gap-1 rounded-chip px-2.5 py-1 transition-colors duration-300", v.on ? "bg-(--color-heading) text-(--color-canvas)" : "text-muted")}>
            {v.icon} {v.t}
          </span>
        ))}
      </div>
      {board ? (
        <div className="mt-4 grid grid-cols-3 gap-3">
          {["Ideas", "Doing", "Done"].map((col) => (
            <div key={col} className="rounded-panel bg-(--color-surface-sunken) p-2.5">
              <p className="text-[12px] font-semibold text-muted">
                {col} <span className="font-normal">{ITEMS.filter((i) => status(i.t) === col).length}</span>
              </p>
              {ITEMS.filter((i) => status(i.t) === col).map((i) => (
                <div key={i.t} className="mk-showcase-pop mt-2 rounded-small bg-(--color-surface) p-2.5 shadow-[0_1px_3px_rgb(0_0_0/0.08)]">
                  <p className="text-[13px] font-medium text-ink">{i.t}</p>
                  <p className="mt-1.5 flex items-center justify-between">
                    <span className="rounded-chip bg-(--color-surface-sunken) px-1.5 text-[11px] text-muted">{i.tag}</span>
                    <Avatar who={i.who} size={18} />
                  </p>
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : (
        <table className="mt-4 w-full border-collapse text-[13px]">
          <thead>
            <tr className="text-left text-[12px] text-muted">
              {["Name", "Type", "Owner", "Status"].map((h) => (
                <th key={h} className="border-b mk-hair py-2 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ITEMS.map((i) => (
              <tr key={i.t}>
                <td className="border-b mk-hair py-2 text-ink">{i.t}</td>
                <td className="border-b mk-hair py-2 text-muted">{i.tag}</td>
                <td className="border-b mk-hair py-2">
                  <Avatar who={i.who} size={18} />
                </td>
                <td className="border-b mk-hair py-2 text-muted">{status(i.t)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

const QUESTION = "What’s left before the launch?";

function AiAnswer({ step, compact = false }: { step: number; compact?: boolean }) {
  return (
    <div className={fade(step >= 2)}>
      <p className={cx("leading-snug text-ink", compact ? "text-[11px]" : "text-[13px]")}>Two things, both due Thursday:</p>
      <ul className={cx("mt-1.5 space-y-1 text-ink", compact ? "text-[11px]" : "text-[13px]")}>
        <li>• Sam reviews the launch post</li>
        <li>• Ines publishes the pricing page</li>
      </ul>
      <p className="mt-2 flex flex-wrap gap-1">
        {["Spring launch", "Content plan"].map((s) => (
          <span key={s} className="flex items-center gap-1 rounded-chip bg-(--color-surface-sunken) px-2 py-0.5 text-[11px] text-muted">
            <FileText size={10} /> {s}
          </span>
        ))}
      </p>
    </div>
  );
}

function MacAi({ step }: { step: number }) {
  const q = step === 0 ? QUESTION.slice(0, 14) : QUESTION;
  return (
    <div className="flex h-full">
      <div className="min-w-0 flex-1 opacity-60" style={{ fontFamily: "var(--font-serif)" }}>
        <Cover title="Spring launch" tall={false} />
        <div className="space-y-2 px-8 pt-4 text-[14px] text-ink">
          <p>Launch day is Thursday the 12th.</p>
          <p className="text-muted">Press kit, launch post, pricing page.</p>
        </div>
      </div>
      <div className="flex w-[300px] flex-none flex-col border-l mk-hair bg-(--color-surface) p-4">
        <p className="flex items-center gap-1.5 text-[14px] font-semibold text-(--color-heading)">
          <AiIcon size={16} /> Foli AI
        </p>
        <div className="mt-4 flex-1 space-y-3">
          <p className="ml-auto w-fit max-w-[90%] rounded-panel bg-(--color-heading) px-3 py-2 text-[13px] text-(--color-canvas)">
            {q}
            {step === 0 ? <span className="ml-px inline-block h-3 w-0.5 animate-pulse bg-(--color-canvas)" /> : null}
          </p>
          <p className={cx("text-[12px] text-muted", fade(step === 1))}>Reading Spring launch and Content plan…</p>
          <AiAnswer step={step} />
        </div>
      </div>
    </div>
  );
}

function VaultList({ compact = false }: { compact?: boolean }) {
  const items = [
    { icon: <KeyRound size={compact ? 13 : 15} />, t: "Bank login", k: "Login" },
    { icon: <FileText size={compact ? 13 : 15} />, t: "Stripe API key", k: "API key" },
    { icon: <Wifi size={compact ? 13 : 15} />, t: "Studio Wi-Fi", k: "Wi-Fi" },
  ];
  return (
    <ul className="space-y-1">
      {items.map((i) => (
        <li key={i.t} className={cx("flex items-center gap-2.5 rounded-small", compact ? "py-1.5" : "px-2 py-2")}>
          <span className={cx("grid flex-none place-items-center rounded-small bg-(--mk-violet-soft) text-(--mk-violet-ink)", compact ? "size-6" : "size-8")}>{i.icon}</span>
          <span className="min-w-0 flex-1">
            <span className={cx("block truncate font-medium text-(--color-heading)", compact ? "text-[12px]" : "text-[13px]")}>{i.t}</span>
            <span className="block text-[11px] text-muted">{i.k}</span>
          </span>
          <span className="font-mono text-[12px] tracking-[0.2em] text-muted">••••••</span>
        </li>
      ))}
    </ul>
  );
}

function MacVault({ step }: { step: number }) {
  const open = step >= 2;
  return (
    <div className="h-full p-6">
      {open ? (
        <div className="mk-showcase-pop">
          <p className="flex items-center gap-2 text-[20px] font-semibold text-(--color-heading)">
            <LockKeyhole size={18} className="text-(--mk-violet-ink)" /> Vault
            <span className="ml-auto rounded-chip bg-(--mk-violet-soft) px-2 py-0.5 text-[11px] font-semibold text-(--mk-violet-ink)">End-to-end encrypted</span>
          </p>
          <div className="mt-4 max-w-[460px]">
            <VaultList />
            <div className="mt-3 flex items-center gap-3 rounded-panel bg-(--color-surface-sunken) px-4 py-3">
              <span className="text-[12px] text-muted">Bank login · 2FA code</span>
              <span className="font-mono text-[20px] font-semibold tracking-[0.15em] text-(--color-heading)">482 913</span>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid h-full place-items-center">
          <div className="text-center">
            <span className="mx-auto grid size-14 place-items-center rounded-panel bg-(--mk-violet-soft) text-(--mk-violet-ink)">
              <LockKeyhole size={26} />
            </span>
            <p className="mt-4 text-[18px] font-semibold text-(--color-heading)">The Vault is locked</p>
            <p className="mt-1 text-[13px] text-muted">Enter your passcode</p>
            <p className="mt-4 flex justify-center gap-2">
              {Array.from({ length: 6 }, (_, i) => (
                <span key={i} className={cx("size-3 rounded-chip transition-colors duration-200", step >= 1 || i < 2 ? "bg-(--color-heading)" : "shadow-[inset_0_0_0_1.5px_var(--color-line-strong)]")} />
              ))}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

/* The iPhone ----------------------------------------------------------------------------------------- */

function Phone({ chapter, step }: { chapter: ChapterId; step: number }) {
  return (
    <div className="absolute bottom-0 right-0 mk-phone h-[440px] w-[214px] bg-[#1d1d1f] p-2 shadow-[0_30px_60px_-15px_rgb(0_0_0/0.45)]">
      <div className="relative flex h-full flex-col mk-phone-screen overflow-hidden bg-(--color-surface)">
        <div className="flex h-9 flex-none items-center justify-between px-5 pt-1 text-[11px] font-semibold text-(--color-heading)">
          <span>9:41</span>
          <span className="absolute left-1/2 top-2 h-[22px] w-[74px] -translate-x-1/2 rounded-chip bg-[#1d1d1f]" />
          <span className="flex items-center gap-1">
            <Wifi size={11} />
            <span className="h-2.5 w-5 rounded-tiny shadow-[inset_0_0_0_1px_currentColor]" />
          </span>
        </div>
        <div className="min-h-0 flex-1 px-3.5 pb-4">
          {chapter === "write" ? <PhoneWrite step={step} /> : null}
          {chapter === "together" ? <PhoneTogether step={step} /> : null}
          {chapter === "tasks" ? <PhoneTasks step={step} /> : null}
          {chapter === "board" ? <PhoneBoard step={step} /> : null}
          {chapter === "ai" ? <PhoneAi step={step} /> : null}
          {chapter === "vault" ? <PhoneVault step={step} /> : null}
        </div>
        <span className="mx-auto mb-2 h-1 w-24 flex-none rounded-chip bg-(--color-heading) opacity-80" />
      </div>
    </div>
  );
}

function PhoneHeader({ title, back }: { title: string; back: string }) {
  return (
    <div className="pb-2 pt-1">
      <p className="flex items-center gap-0.5 text-[11px] text-(--mk-violet-ink)">
        <ChevronRight size={11} className="rotate-180" /> {back}
      </p>
      <p className="mt-1 text-[18px] font-semibold text-(--color-heading)">{title}</p>
    </div>
  );
}

function PhoneWrite({ step }: { step: number }) {
  const art = artById("art-03");
  return (
    <div className="pt-1" style={{ fontFamily: "var(--font-serif)" }}>
      <div className="mk-note -mx-3.5" style={artVars(art)}>
        <div className="mk-note-cover flex h-[96px] items-end px-4 pb-2" data-tone={art.tone}>
          <p className="mk-note-title text-[20px]">Spring launch</p>
        </div>
      </div>
      <p className="mt-3 text-[12px] leading-snug text-ink">{step >= 1 ? WRITE_TEXT : "Launch day is Thursday…"}</p>
      <div className={cx("mt-3 space-y-1.5 font-sans text-[11px]", fade(step >= 2))}>
        {[
          ["Press kit", "Done"],
          ["Launch post", "Doing"],
          ["Pricing page", step >= 3 ? "Done" : "Doing"],
        ].map(([t, s]) => (
          <p key={t} className="flex items-center justify-between rounded-small bg-(--color-surface-sunken) px-2 py-1.5 text-ink">
            {t} <span className={cx("rounded-chip px-1.5 font-medium", s === "Done" ? "bg-[#dff3e8] text-[#1f7a4d]" : "bg-[#fdf0d8] text-[#9a6412]")}>{s}</span>
          </p>
        ))}
      </div>
      <p className={cx("mt-3 flex items-center gap-1 font-sans text-[11px] text-muted", fade(step >= 2))}>
        <span className="size-1.5 rounded-chip bg-(--color-moss-ink)" /> Synced from your Mac
      </p>
    </div>
  );
}

function PhoneTogether({ step }: { step: number }) {
  return (
    <div>
      <PhoneHeader title="Spring launch" back="Folders" />
      <p className="text-[12px] leading-snug text-ink" style={{ fontFamily: "var(--font-serif)" }}>
        Launch day is <span className={cx("rounded-tiny", step >= 2 ? "bg-[#fde6b0]" : "")}>Thursday the 12th</span>.
      </p>
      <p className="mt-1.5 min-h-[32px] text-[12px] leading-snug text-ink" style={{ fontFamily: "var(--font-serif)" }}>
        {step === 0 ? "" : step === 1 ? SAM_LINE.slice(0, 24) : SAM_LINE}
      </p>
      <div className={cx("mt-3 rounded-panel bg-(--color-surface-sunken) p-2.5", fade(step >= 2))}>
        <p className="flex items-center gap-1.5 text-[11px] font-semibold text-(--color-heading)">
          <Avatar who="maya" size={16} /> Maya mentioned you
        </p>
        <p className="mt-1 text-[11px] leading-snug text-muted">Can we keep Thursday? @Sam is the press list ready?</p>
        <p className={cx("mt-2 text-[11px] font-medium text-[#1f7a4d]", fade(step >= 3))}>✓ Resolved by Sam</p>
      </div>
      <p className="mt-3 flex items-center gap-1.5 text-[11px] text-muted">
        <span className="flex -space-x-1">
          <Avatar who="maya" size={16} />
          <Avatar who="sam" size={16} />
        </span>
        2 people here now
      </p>
    </div>
  );
}

function PhoneTasks({ step }: { step: number }) {
  const tasks = [
    { t: "Send the press kit", done: true },
    { t: "Review the launch post", done: step >= 2 },
    { t: "Publish the pricing page", done: false, date: step >= 1 },
  ];
  return (
    <div>
      <PhoneHeader title="Today" back="Home" />
      <ul className="space-y-1">
        {tasks.map((x) => (
          <li key={x.t} className="flex items-center gap-2 border-b mk-hair py-2 text-[12px]">
            <span className={cx("grid size-4 flex-none place-items-center rounded-chip transition-colors duration-300", x.done ? "bg-(--mk-violet-strong) text-white" : "shadow-[inset_0_0_0_1.5px_var(--color-line-strong)]")}>
              {x.done ? <Check size={10} strokeWidth={3} /> : null}
            </span>
            <span className={cx("min-w-0 flex-1", x.done ? "text-muted line-through" : "text-ink")}>{x.t}</span>
            {x.date ? <span className="mk-showcase-pop rounded-chip bg-(--mk-violet-soft) px-1.5 text-[11px] text-(--mk-violet-ink)">Thu</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function PhoneBoard({ step }: { step: number }) {
  const done = step >= 2 ? ["Spring newsletter", "Launch post"] : ["Spring newsletter"];
  return (
    <div>
      <PhoneHeader title="Content plan" back="Folders" />
      <p className="text-[11px] font-semibold text-muted">Done {done.length}</p>
      {done.map((t) => (
        <div key={t} className="mk-showcase-pop mt-1.5 rounded-small bg-(--color-surface-sunken) p-2 text-[12px] font-medium text-ink">
          {t}
        </div>
      ))}
      <p className="mt-3 text-[11px] font-semibold text-muted">Doing {step >= 2 ? 1 : 2}</p>
      {(step >= 2 ? ["Customer story"] : ["Launch post", "Customer story"]).map((t) => (
        <div key={t} className="mt-1.5 rounded-small bg-(--color-surface-sunken) p-2 text-[12px] font-medium text-ink">
          {t}
        </div>
      ))}
    </div>
  );
}

function PhoneAi({ step }: { step: number }) {
  return (
    <div>
      <p className="flex items-center gap-1.5 pt-2 text-[15px] font-semibold text-(--color-heading)">
        <AiIcon size={15} /> Foli AI
      </p>
      <p className="ml-auto mt-3 w-fit max-w-[92%] rounded-panel bg-(--color-heading) px-2.5 py-1.5 text-[11px] text-(--color-canvas)">{step === 0 ? QUESTION.slice(0, 14) : QUESTION}</p>
      <div className="mt-3">
        <AiAnswer step={step} compact />
      </div>
    </div>
  );
}

function PhoneVault({ step }: { step: number }) {
  return step >= 2 ? (
    <div className="mk-showcase-pop">
      <PhoneHeader title="Vault" back="Home" />
      <VaultList compact />
      <div className="mt-2 rounded-small bg-(--color-surface-sunken) px-2.5 py-2">
        <p className="text-[11px] text-muted">2FA code</p>
        <p className="font-mono text-[16px] font-semibold tracking-[0.12em] text-(--color-heading)">482 913</p>
      </div>
    </div>
  ) : (
    <div className="grid h-full place-items-center">
      <div className="text-center">
        <ScanFace size={44} strokeWidth={1.4} className={cx("mx-auto transition-colors duration-500", step >= 1 ? "text-(--color-moss-ink)" : "text-(--mk-violet-ink)")} />
        <p className="mt-3 text-[12px] font-medium text-(--color-heading)">{step >= 1 ? "Unlocked" : "Face ID"}</p>
      </div>
    </div>
  );
}
