import Link from "next/link";
import { Avatar, PEOPLE, type PersonId } from "../people";
import type { ReactNode } from "react";
import { ArrowRight, Check, CloudOff, History, Play as PlayIcon } from "lucide-react";
import { artById, artVars } from "../product/Replica";
import { Play } from "../Play";
import { Eyebrow, container, cx } from "../ui";
import { Hand, Mark } from "../fun";

/*
 * What every plan includes, each with a small picture of it drawn from the app's own pieces (the sync status
 * pill, a note, the page menu's export items, the note themes, and light and dark mode). Pictures are decorative:
 * each is one image to assistive tech, described by its label. The labels are the app's own strings. The
 * offline and sync pictures animate by themselves (CSS); the others play when they scroll into view (Play).
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
    picture: (
      <Play>
        <StylesPicture />
      </Play>
    ),
  },
  {
    title: "Audio recordings",
    href: "/features/audio-recordings",
    label: "A voice note in a page: a play button, its waveform and its length, 0:42.",
    picture: (
      <Play>
        <AudioPicture />
      </Play>
    ),
  },
  {
    title: "Flowcharts",
    href: "/features/flowcharts",
    label: "A small flowchart in a note: Idea, then Draft, then two arrows to Share and Keep.",
    picture: (
      <Play>
        <FlowPicture />
      </Play>
    ),
  },
  {
    title: "Version history",
    href: "/features/version-history",
    label: "A page's versions: Now, an hour ago by Maya, yesterday by you, with a Restore button.",
    picture: (
      <Play>
        <HistoryPicture />
      </Play>
    ),
  },
  {
    title: "Edit together",
    href: "/features/sharing",
    label: "A shared note with three people in it, a line Maya is typing, and a comment mentioning Sam.",
    picture: (
      <Play>
        <TogetherPicture />
      </Play>
    ),
    wide: true,
  },
  {
    title: "Tasks and a calendar",
    href: "/features/tasks",
    label: "Today's tasks from your notes, with dates, beside a small week calendar.",
    picture: (
      <Play>
        <TasksPicture />
      </Play>
    ),
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
        <ul className="mt-10 grid gap-x-4 gap-y-7 sm:grid-cols-2 lg:grid-cols-6 lg:gap-x-5">
          {TILES.map((tile) => (
            <li key={tile.title} className={cx("relative", tile.wide ? "lg:col-span-3" : "lg:col-span-2")}>
              <div role="img" aria-label={tile.label} className="mk-mini-stage" data-tilt="5">
                <div aria-hidden="true" className="contents">
                  {tile.picture}
                </div>
              </div>
              <h3 className="mk-h3 mt-3 text-[15.5px]">
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
    <div className="mk-mini-card w-[78%] max-w-[260px] px-4 pb-4 pt-3">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[12.5px] font-semibold text-(--color-heading)">Train notes</span>
        <span className="mk-mini-pills">
          <span className="mk-mini-pill mk-mini-pill-offline" data-step="1">
            <span className="size-1.5 flex-none rounded-tiny bg-(--color-ink-faint)" />
            <CloudOff size={12} />
            Offline <span className="tabular-nums">· 3</span>
          </span>
          <span className="mk-mini-pill" data-step="2">
            <span className="size-1.5 flex-none rounded-tiny bg-moss" />
            <Check size={12} className="text-moss-ink" />
            Saved
          </span>
        </span>
      </div>
      <MiniLines widths={["92%", "78%", "86%", "40%"]} />
    </div>
  );
}

/** One note open on a laptop and on a phone; the line typed on one appears on the other. */
function SyncPicture() {
  return (
    <div className="flex items-end gap-3">
      <div className="mk-mini-card w-[170px] overflow-hidden sm:w-[190px]">
        <div className="flex items-center gap-1 border-b border-(--color-line) px-2.5 py-1.5">
          <span className="size-1.5 rounded-tiny bg-(--color-line-strong)" />
          <span className="size-1.5 rounded-tiny bg-(--color-line-strong)" />
          <span className="size-1.5 rounded-tiny bg-(--color-line-strong)" />
        </div>
        <div className="px-3 pb-3 pt-2">
          <span className="block text-[11.5px] font-semibold text-(--color-heading)">Seed library</span>
          <MiniLines widths={["90%", "70%"]} />
          <span className="mk-mini-typed mt-1.5 block text-[10.5px] text-ink">
            Print seed labels<span className="mk-mini-caret" />
          </span>
        </div>
      </div>
      <div className="mk-mini-card w-[74px] overflow-hidden rounded-panel px-2 pb-3 pt-3">
        <span className="mx-auto mb-2 block h-1 w-5 rounded-tiny bg-(--color-line-strong)" />
        <span className="block truncate text-[9.5px] font-semibold text-(--color-heading)">Seed library</span>
        <MiniLines widths={["92%", "68%"]} />
        <span className="mk-mini-arrive mt-1.5 block truncate rounded-chip text-[8.5px] text-ink">Print seed labels</span>
      </div>
    </div>
  );
}

const FAN = ["art-03", "art-01", "art-30", "art-49", "art-39"].map(artById);

/** A fan of note theme artworks, and a note wearing one of them. */
function StylesPicture() {
  const note = artById("art-30");
  return (
    <div className="relative h-[124px] w-[240px]">
      {FAN.map((art, i) => (
        // The step is the wrapper, so playing it never replaces the card's own rotation.
        <span key={art.id} data-step className="absolute top-2" style={{ left: `${i * 30}px`, zIndex: i }}>
          <span
            className="mk-mini-art block"
            style={{ backgroundImage: `url("/marketing/mini/${art.id}.webp")`, transform: `rotate(${(i - 2) * 5}deg)` }}
          />
        </span>
      ))}
      <span data-step className="mk-note absolute bottom-0 right-0 z-10 w-[112px] overflow-hidden shadow-(--shadow-pop)" style={artVars(note)}>
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
  const bars = [6, 12, 18, 10, 22, 16, 8, 20, 14, 24, 12, 18, 9, 15, 21, 11, 7, 16, 13, 6];
  return (
    <div className="mk-mini-card w-[82%] max-w-[270px] px-3.5 py-3">
      <span className="block text-[11.5px] font-semibold text-(--color-heading)">Standup, Tuesday</span>
      <span className="mt-2.5 flex items-center gap-2.5">
        <span data-step className="grid size-7 flex-none place-items-center rounded-chip bg-(--color-heading) text-(--color-canvas)">
          <PlayIcon size={11} fill="currentColor" />
        </span>
        <span data-step className="flex h-6 flex-1 items-center gap-[2px]">
          {bars.map((h, i) => (
            <span key={i} className="w-[3px] rounded-tiny" style={{ height: h, background: i < 8 ? "var(--mk-violet)" : "color-mix(in oklab, var(--color-ink) 22%, transparent)" }} />
          ))}
        </span>
        <span className="text-[10.5px] tabular-nums text-muted">0:42</span>
      </span>
    </div>
  );
}

/** A flowchart block in a note: nodes on a grid, square connectors, a decision with Yes and No. */
function FlowPicture() {
  const line = "color-mix(in oklab, var(--color-ink) 38%, transparent)";
  const node = { fill: "var(--color-surface)", stroke: "color-mix(in oklab, var(--color-ink) 22%, transparent)" };
  const text = { fontFamily: "var(--font-sans)", fontSize: 9.5, fontWeight: 600, fill: "var(--color-heading)", textAnchor: "middle" as const, dominantBaseline: "central" as const };
  return (
    <div className="mk-mini-card w-[88%] max-w-[280px] px-3 pb-3 pt-2.5">
      <span className="block text-[11.5px] font-semibold text-(--color-heading)">Launch plan</span>
      <svg aria-hidden="true" viewBox="0 0 240 104" className="mt-2 block w-full" fill="none">
        <defs>
          <marker id="mk-flow-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0.8 7 4 0 7.2z" fill={line} />
          </marker>
        </defs>
        <g data-step stroke={line} strokeWidth="1.2" markerEnd="url(#mk-flow-arrow)">
          <path d="M62 30h22" />
          <path d="M146 30h24" />
          <path d="M115 48v26H41V49" />
        </g>
        <g data-step>
          <rect x="6" y="18" width="56" height="24" rx="6" {...node} />
          <text x="34" y="30" {...text}>Draft</text>
        </g>
        <g data-step>
          <path d="M115 10 146 30 115 50 84 30z" fill="var(--mk-violet-soft)" stroke="var(--mk-violet)" strokeWidth="1.2" />
          <text x="115" y="30" {...text} fill="var(--mk-violet-ink)">Ready?</text>
        </g>
        <g data-step>
          <rect x="172" y="18" width="62" height="24" rx="6" {...node} />
          <text x="203" y="30" {...text}>Publish</text>
        </g>
        <g data-step fontFamily="var(--font-sans)" fontSize="8.5" fill="var(--color-ink-muted)">
          <text x="158" y="22" textAnchor="middle">Yes</text>
          <text x="124" y="66">No</text>
        </g>
      </svg>
    </div>
  );
}

/** The version history panel: when, who, and Restore. */
function HistoryPicture() {
  const rows = [
    { when: "Now", who: "Current", on: true },
    { when: "1 hour ago", who: "Maya" },
    { when: "Yesterday", who: "You" },
  ];
  return (
    <div className="mk-mini-card w-[82%] max-w-[260px] p-1.5">
      {rows.map((r) => (
        <span key={r.when} data-step className={`flex items-center gap-1.5 whitespace-nowrap rounded-small px-2 py-1.5 text-[10.5px] ${r.on ? "bg-(--glass-hover)" : ""}`}>
          <History size={11} className="flex-none text-muted" />
          <span className="font-semibold text-(--color-heading)">{r.when}</span>
          <span className="min-w-0 flex-1 truncate text-muted">{r.who}</span>
          {r.when === "1 hour ago" ? <span className="flex-none rounded-chip bg-(--color-heading) px-1.5 py-0.5 text-[9.5px] font-semibold text-(--color-canvas)">Restore</span> : null}
        </span>
      ))}
    </div>
  );
}

/** A shared note: who's here, a line someone is typing, and a comment with a mention. */
function TogetherPicture() {
  const people: PersonId[] = ["maya", "sam", "alex"];
  return (
    <div className="flex items-start gap-3">
      <div className="mk-mini-card w-[200px] px-3 pb-3 pt-2.5">
        <span className="flex items-center justify-between">
          <span className="text-[11.5px] font-semibold text-(--color-heading)">Trip plan</span>
          <span className="flex -space-x-1.5">
            {people.map((p) => (
              <span key={p} data-step>
                <Avatar who={p} size={20} className="ring-2 ring-(--color-surface)" />
              </span>
            ))}
          </span>
        </span>
        <MiniLines widths={["92%", "70%"]} />
        <span data-step className="mt-1.5 flex items-center gap-1 text-[10.5px] text-ink">
          Book the ferry
          <span className="h-3 w-[2px] rounded-tiny" style={{ background: PEOPLE.maya.color }} />
          <span className="inline-flex items-center gap-1 rounded-chip py-px pl-px pr-1.5 text-[9px] font-semibold text-white" style={{ background: PEOPLE.maya.color }}>
            <Avatar who="maya" size={12} />
            Maya
          </span>
        </span>
      </div>
      <div data-step className="mk-app-pop mt-6 w-[150px] rounded-control p-2.5 text-[10.5px] text-ink max-sm:hidden">
        <span className="flex items-center gap-1.5 font-semibold text-(--color-heading)">
          <Avatar who="sam" size={16} /> Sam
        </span>
        <span className="mt-0.5 block">
          <span className="rounded-tiny bg-(--mk-violet-soft) px-0.5 font-semibold text-(--mk-violet-ink)">@Maya</span> can you check the times?
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
    <div className="flex items-start gap-3">
      <div className="mk-mini-card w-[200px] p-2.5">
        <span className="block text-[11.5px] font-semibold text-(--color-heading)">Today</span>
        {tasks.map((x) => (
          <span key={x.t} data-step className="mt-1.5 flex items-center gap-1.5 text-[10.5px]">
            <span className={`grid size-3 flex-none place-items-center rounded-tiny ${x.done ? "bg-(--mk-violet-strong) text-white" : "shadow-[inset_0_0_0_1.2px_var(--color-line-strong)]"}`}>
              {x.done ? <Check size={8} strokeWidth={3} /> : null}
            </span>
            <span className={`flex-1 ${x.done ? "text-muted line-through" : "text-ink"}`}>{x.t}</span>
            <span className="rounded-chip bg-(--color-surface-sunken) px-1.5 text-[9.5px] text-muted">{x.d}</span>
          </span>
        ))}
      </div>
      <div data-step className="mk-mini-card grid w-[120px] grid-cols-7 gap-0.5 p-2 text-center text-[8.5px] text-muted max-sm:hidden">
        {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
          <span key={i} className="font-semibold">{d}</span>
        ))}
        {Array.from({ length: 14 }, (_, i) => (
          <span key={i} className={`rounded-tiny py-0.5 ${i === 2 ? "bg-(--color-heading) text-(--color-canvas)" : i === 4 || i === 7 ? "bg-(--mk-violet-soft) text-(--mk-violet-ink)" : ""}`}>
            {i + 8}
          </span>
        ))}
      </div>
    </div>
  );
}
