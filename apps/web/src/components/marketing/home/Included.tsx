import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, Check, CloudOff, History, Play as PlayIcon } from "lucide-react";
import { Avatar, PEOPLE, type PersonId } from "../people";
import { artById, artVars } from "../product/Replica";
import { Eyebrow, container, cx } from "../ui";
import { Hand, Mark } from "../fun";

/*
 * What every plan includes, each with a small picture drawn from the app's own pieces. One design for all of
 * them: a stage of the same height, and inside it one card (or a pair) of the same width, padding and type,
 * centred, never past the stage's edges. They hold still (only the offline pill and the typed line move, by
 * CSS), so a tile never shows half a picture. Each is one image to assistive tech, described by its label.
 */

type Tile = { title: string; href?: string; label: string; picture: ReactNode; wide?: boolean };

const TILES: Tile[] = [
  {
    title: "Works offline",
    href: "/features/offline-notes",
    label: "A note with the sync status reading Offline, 3 changes waiting, then Saved once the connection is back.",
    picture: <OfflinePicture />,
  },
  {
    title: "Real-time sync",
    href: "/docs/sync-and-offline",
    label: "The same note open on a laptop and a phone. A line typed on the laptop appears on the phone.",
    picture: <SyncPicture />,
  },
  {
    title: "Note themes",
    href: "/features/note-themes",
    label: "Five note theme artworks fanned out, and a note in the Summer sky theme.",
    picture: <StylesPicture />,
  },
  {
    title: "Audio recordings",
    href: "/features/audio-recordings",
    label: "A voice note in a page: a play button, its waveform and its length, 0:42.",
    picture: <AudioPicture />,
  },
  {
    title: "Flowcharts",
    href: "/features/flowcharts",
    label: "A small flowchart in a note: Idea, then Draft, then two arrows to Share and Keep.",
    picture: <FlowPicture />,
  },
  {
    title: "Version history",
    href: "/features/version-history",
    label: "A page's versions: Now, an hour ago by Maya, yesterday by you, with a Restore button.",
    picture: <HistoryPicture />,
  },
  {
    title: "Edit together",
    href: "/features/sharing",
    label: "A shared note with three people in it, a line Maya is typing, and a comment mentioning Sam.",
    picture: <TogetherPicture />,
    wide: true,
  },
  {
    title: "Tasks and a calendar",
    href: "/features/tasks",
    label: "Today's tasks from your notes, with dates, beside a small week calendar.",
    picture: <TasksPicture />,
    wide: true,
  },
];

export function Included() {
  return (
    <section aria-labelledby="included-title" className={container}>
      <div className="mk-box relative px-5 py-9 sm:px-10 sm:py-12 lg:px-14 lg:py-14">
        <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-4">
          <div>
            <Eyebrow>Included in every plan</Eyebrow>
            <h2 id="included-title" className="mk-h2 mt-5 max-w-[16ch]">
              The good stuff is on <Mark kind="circle">Free</Mark> too.
            </h2>
          </div>
          <div className="relative pb-2 max-sm:hidden">
            <Hand rotate={4} arrow="down-right">
              no card, no time limit
            </Hand>
          </div>
        </div>
        <ul className="mt-10 grid gap-x-4 gap-y-5 sm:grid-cols-2 xl:grid-cols-6 xl:gap-x-5">
          {TILES.map((tile) => (
            <li key={tile.title} className={cx("relative", tile.wide ? "xl:col-span-3" : "xl:col-span-2")}>
              <div role="img" aria-label={tile.label} className="mk-mini-stage">
                <div aria-hidden="true" className="contents">
                  {tile.picture}
                </div>
              </div>
              <h3 className="mk-h3 mt-2 text-[16px]">
                {tile.href ? (
                  <Link href={tile.href} className="group inline-flex min-h-11 items-center gap-1.5 hover:underline">
                    {tile.title} <ArrowRight size={14} aria-hidden="true" className="text-muted transition-transform group-hover:translate-x-0.5" />
                  </Link>
                ) : (
                  <span className="inline-flex min-h-11 items-center">{tile.title}</span>
                )}
              </h3>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* Pictures ---------------------------------------------------------------------------------------- */

/** The card every picture is built on: one width, padding and type. */
const cardBase = "mk-mini-card px-3.5 py-3";
const card = cx(cardBase, "w-full max-w-[248px]");
const title = "block truncate text-[12px] font-semibold text-(--color-heading)";

function MiniLines({ widths }: { widths: string[] }) {
  return (
    <span className="mt-2 block space-y-1.5">
      {widths.map((w, i) => (
        <span key={i} className="mk-mini-line block" style={{ width: w }} />
      ))}
    </span>
  );
}

/** The sync status pill (components/app/SyncStatus.tsx): Offline with changes waiting, then Saved. */
function OfflinePicture() {
  return (
    <div className={card}>
      <div className="flex items-center justify-between gap-2">
        <span className={title}>Train notes</span>
        <span className="mk-mini-pills">
          <span className="mk-mini-pill mk-mini-pill-offline" data-step="1">
            <CloudOff size={12} />
            Offline <span className="tabular-nums">· 3</span>
          </span>
          <span className="mk-mini-pill" data-step="2">
            <Check size={12} className="text-moss-ink" />
            Saved
          </span>
        </span>
      </div>
      <MiniLines widths={["92%", "78%", "86%", "44%"]} />
    </div>
  );
}

/** One note open on a laptop and on a phone; the line typed on one appears on the other. */
function SyncPicture() {
  return (
    <div className="flex w-full max-w-[248px] items-end gap-2.5">
      <div className="mk-mini-card min-w-0 flex-1 overflow-hidden">
        <div className="flex items-center gap-1 border-b border-(--color-line) px-2.5 py-1.5">
          {[0, 1, 2].map((i) => (
            <span key={i} className="size-1.5 rounded-tiny bg-(--color-line-strong)" />
          ))}
        </div>
        <div className="px-3 pb-3 pt-2">
          <span className={title}>Seed library</span>
          <MiniLines widths={["90%", "70%"]} />
          <span className="mk-mini-typed mt-2 block text-[11px] text-ink">
            Print seed labels<span className="mk-mini-caret" />
          </span>
        </div>
      </div>
      <div className="mk-mini-card w-[66px] flex-none overflow-hidden rounded-panel px-2 pb-2.5 pt-2.5">
        <span className="mx-auto mb-2 block h-1 w-5 rounded-tiny bg-(--color-line-strong)" />
        <span className="block truncate text-[9px] font-semibold text-(--color-heading)">Seed library</span>
        <MiniLines widths={["92%", "68%"]} />
        <span className="mk-mini-arrive mt-1.5 block truncate rounded-tiny text-[8px] text-ink">Print seed labels</span>
      </div>
    </div>
  );
}

const FAN = ["art-03", "art-01", "art-30", "art-49", "art-39"].map(artById);

/** A fan of note theme artworks, and a note wearing one of them. */
function StylesPicture() {
  const note = artById("art-30");
  return (
    <div className="relative h-[118px] w-[210px]">
      {FAN.map((art, i) => (
        <span
          key={art.id}
          className="mk-mini-art absolute top-1"
          style={{ left: `${6 + i * 24}px`, zIndex: i, backgroundImage: `url("/marketing/mini/${art.id}.webp")`, transform: `rotate(${(i - 2) * 5}deg)` }}
        />
      ))}
      <span className="mk-note absolute bottom-2 right-0 z-10 w-[104px] overflow-hidden rounded-control shadow-(--shadow-card)" style={artVars(note)}>
        <span className="block h-7 bg-cover bg-center" style={{ backgroundImage: `url("/marketing/mini/${note.id}.webp")` }} />
        <span className="block px-2.5 pb-2.5 pt-1.5">
          <span className="mk-note-h block text-[11px]">Trip sketch</span>
          <span className="mt-1 block h-[3px] w-[85%] rounded-tiny bg-[color-mix(in_oklab,var(--n-ink)_22%,transparent)]" />
          <span className="mt-1 block h-[3px] w-[60%] rounded-tiny bg-[color-mix(in_oklab,var(--n-ink)_22%,transparent)]" />
        </span>
      </span>
    </div>
  );
}

/** A voice note in a page (the /record block): play, waveform, length. */
function AudioPicture() {
  const bars = [6, 12, 18, 10, 20, 15, 8, 19, 13, 22, 11, 17, 9, 14, 19, 10, 7, 13];
  return (
    <div className={card}>
      <span className={title}>Standup, Tuesday</span>
      <span className="mt-3 flex items-center gap-2.5">
        <span className="grid size-7 flex-none place-items-center rounded-chip bg-(--color-heading) text-(--color-canvas)">
          <PlayIcon size={11} fill="currentColor" />
        </span>
        <span className="flex h-6 min-w-0 flex-1 items-center justify-between">
          {bars.map((h, i) => (
            <span key={i} className="w-[3px] flex-none rounded-tiny" style={{ height: h, background: i < 7 ? "var(--mk-violet)" : "color-mix(in oklab, var(--color-ink) 22%, transparent)" }} />
          ))}
        </span>
        <span className="flex-none text-[11px] tabular-nums text-muted">0:42</span>
      </span>
    </div>
  );
}

/** A flowchart block in a note: nodes on one row, square connectors, a decision with Yes and No. */
function FlowPicture() {
  const line = "color-mix(in oklab, var(--color-ink) 40%, transparent)";
  const node = { fill: "var(--color-surface)", stroke: "color-mix(in oklab, var(--color-ink) 24%, transparent)", strokeWidth: 1 };
  const text = { fontFamily: "var(--font-sans)", fontSize: 9.5, fontWeight: 600, fill: "var(--color-heading)", textAnchor: "middle" as const, dominantBaseline: "central" as const };
  const small = { fontFamily: "var(--font-sans)", fontSize: 8.5, fill: "var(--color-ink-muted)" };
  return (
    <div className={card}>
      <span className={title}>Launch plan</span>
      <svg aria-hidden="true" viewBox="0 0 220 78" className="mt-2 block w-full" fill="none">
        <defs>
          <marker id="mk-flow-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0 0.8 7 4 0 7.2z" fill={line} />
          </marker>
        </defs>
        <g stroke={line} strokeWidth="1.1" markerEnd="url(#mk-flow-arrow)">
          <path d="M56 24h20" />
          <path d="M138 24h22" />
          <path d="M107 42v20H30V37" />
        </g>
        <rect x="4" y="12" width="52" height="24" rx="6" {...node} />
        <text x="30" y="24" {...text}>Draft</text>
        <path d="M107 6 138 24 107 42 76 24z" fill="var(--mk-violet-soft)" stroke="var(--mk-violet)" strokeWidth="1.1" />
        <text x="107" y="24" {...text} fill="var(--mk-violet-ink)">Ready?</text>
        <rect x="162" y="12" width="54" height="24" rx="6" {...node} />
        <text x="189" y="24" {...text}>Publish</text>
        <text x="149" y="16" textAnchor="middle" {...small}>Yes</text>
        <text x="113" y="56" {...small}>No</text>
      </svg>
    </div>
  );
}

/** The version history panel: when, who, and Restore. */
function HistoryPicture() {
  const rows = [
    { when: "Now", who: "Current", on: true },
    { when: "1 hour ago", who: "Maya", restore: true },
    { when: "Yesterday", who: "You" },
  ];
  return (
    <div className={cx(card, "px-1.5 py-1.5")}>
      {rows.map((r) => (
        <span key={r.when} className={cx("flex items-center gap-2 whitespace-nowrap rounded-small px-2 py-1.5 text-[11px]", r.on && "bg-(--glass-hover)")}>
          <History size={11} className="flex-none text-muted" />
          <span className="font-semibold text-(--color-heading)">{r.when}</span>
          <span className="min-w-0 flex-1 truncate text-muted">{r.who}</span>
          {r.restore ? <span className="flex-none rounded-chip bg-(--color-heading) px-1.5 py-0.5 text-[10px] font-semibold text-(--color-canvas)">Restore</span> : null}
        </span>
      ))}
    </div>
  );
}

/** A shared note: who's here, a line someone is typing, and a comment with a mention. */
function TogetherPicture() {
  const people: PersonId[] = ["maya", "sam", "alex"];
  return (
    <div className="flex w-full max-w-[440px] items-center justify-center gap-3">
      <div className={cx(cardBase, "w-[212px] flex-none")}>
        <span className="flex items-center justify-between gap-2">
          <span className={title}>Trip plan</span>
          <span className="flex flex-none -space-x-1.5">
            {people.map((p) => (
              <Avatar key={p} who={p} size={20} className="ring-2 ring-(--color-surface)" />
            ))}
          </span>
        </span>
        <MiniLines widths={["92%", "70%"]} />
        <span className="mt-2 flex items-center gap-1 whitespace-nowrap text-[11px] text-ink">
          Book the ferry
          <span className="h-3 w-[2px] rounded-tiny" style={{ background: PEOPLE.maya.color }} />
          <span className="inline-flex items-center gap-1 rounded-chip py-px pl-px pr-1.5 text-[9px] font-semibold text-white" style={{ background: PEOPLE.maya.color }}>
            <Avatar who="maya" size={12} />
            Maya
          </span>
        </span>
      </div>
      <div className={cx(cardBase, "w-[172px] flex-none max-xl:hidden")}>
        <span className="flex items-center gap-1.5 text-[11px] font-semibold text-(--color-heading)">
          <Avatar who="sam" size={18} /> Sam
        </span>
        <span className="mt-1.5 block text-[11px] leading-snug text-ink">
          <span className="rounded-tiny bg-(--mk-violet-soft) px-0.5 font-semibold text-(--mk-violet-ink)">@Maya</span> can you check the ferry times?
        </span>
      </div>
    </div>
  );
}

/** Today's tasks from your notes, and the week they fall in. */
function TasksPicture() {
  const tasks = [
    { t: "Print seed labels", d: "Today", done: true },
    { t: "Book the ferry", d: "Fri" },
    { t: "Send the deck", d: "Mon" },
  ];
  return (
    <div className="flex w-full max-w-[440px] items-center justify-center gap-3">
      <div className={cx(cardBase, "w-[212px] flex-none")}>
        <span className={title}>Today</span>
        {tasks.map((x) => (
          <span key={x.t} className="mt-2 flex items-center gap-1.5 text-[11px]">
            <span className={cx("grid size-3 flex-none place-items-center rounded-tiny", x.done ? "bg-(--mk-violet-strong) text-white" : "shadow-[inset_0_0_0_1.2px_var(--color-line-strong)]")}>
              {x.done ? <Check size={8} strokeWidth={3} /> : null}
            </span>
            <span className={cx("min-w-0 flex-1 truncate", x.done ? "text-muted line-through" : "text-ink")}>{x.t}</span>
            <span className="flex-none rounded-chip bg-(--color-surface-sunken) px-1.5 text-[10px] text-muted">{x.d}</span>
          </span>
        ))}
      </div>
      <div className="mk-mini-card grid w-[148px] flex-none grid-cols-7 gap-0.5 px-2.5 py-2.5 text-center text-[9px] text-muted max-xl:hidden">
        {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
          <span key={i} className="font-semibold">
            {d}
          </span>
        ))}
        {Array.from({ length: 14 }, (_, i) => (
          <span key={i} className={cx("rounded-tiny py-0.5", i === 2 ? "bg-(--color-heading) text-(--color-canvas)" : i === 4 || i === 7 ? "bg-(--mk-violet-soft) text-(--mk-violet-ink)" : "")}>
            {i + 8}
          </span>
        ))}
      </div>
    </div>
  );
}
