"use client";

// What makes Foli DNA easier to read (components/views/GraphView.tsx): the Key (what dot colours, sizes and line
// styles mean, only for what's on the map), the first-time tips, the panel that says in words why a note is
// connected, and the list of a note's connections on the map around it. The Mac, iPad and iPhone draw the same
// in GraphScreen.swift.
import { useEffect, useMemo, useRef } from "react";
import { ChevronDown, ChevronUp, FileText, Plus, Minus, Waypoints, X } from "lucide-react";
import { AppLink } from "@/lib/app/router";
import { Button, IconButton } from "@/components/ui/Button";
import { shapePath } from "@/lib/graph/layout";
import { explain, lineLabel, type Connection, type DnaIndex, type Names } from "@/lib/graph/neighbourhood";

// ---- the Key

/** A short line drawn the way the map draws it. */
function LineSample({ color = "var(--color-line-strong)", dash, arrow = false, width = 1.2 }: { color?: string; dash?: string; arrow?: boolean; width?: number }) {
  return (
    <svg width={28} height={10} viewBox="0 0 28 10" aria-hidden className="flex-none">
      <line x1={1} y1={5} x2={arrow ? 22 : 27} y2={5} stroke={color} strokeWidth={width} strokeDasharray={dash} />
      {arrow ? <path d="M21 1.5 L27 5 L21 8.5 z" fill={color} /> : null}
    </svg>
  );
}

function Dot({ color, r = 4, kind = "note", ring }: { color: string; r?: number; kind?: string; ring?: { color: string; dash?: string; glow?: boolean } }) {
  const d = shapePath(kind, r);
  return (
    <svg width={20} height={20} viewBox="-10 -10 20 20" aria-hidden className="flex-none">
      {ring?.glow ? <circle r={r + 4} fill={ring.color} opacity={0.35} /> : null}
      {ring && !ring.glow ? <circle r={r + 3} fill="none" stroke={ring.color} strokeWidth={1.3} strokeDasharray={ring.dash} /> : null}
      {d ? <path d={d} fill={color} /> : <circle r={r} fill={color} />}
    </svg>
  );
}

export interface LegendShows {
  /** Kinds on the map ("note", "person"…) with their colour and name, when colouring by kind. */
  kinds: { kind: string; label: string; color: string }[];
  /** Colour groups (folders or tags), when colouring by them. */
  groups: { id: string; name: string; color: string }[];
  colorBy: "kind" | "folder" | "tag";
  arrows: boolean;
  mentions: boolean;
  aiLines: boolean;
  contradicts: boolean;
  duplicates: boolean;
  suggested: boolean;
  shared: boolean;
  clusters: boolean;
  bridges: boolean;
  fresh: boolean;
  pins: boolean;
}

/** The Key: a small card in the map's corner, open until it's folded (remembered on this device). */
export function DnaLegend({ shows, open, onToggle }: { shows: LegendShows; open: boolean; onToggle: () => void }) {
  const row = (icon: React.ReactNode, text: string) => (
    <li key={text} className="flex items-center gap-2">
      <span className="flex w-7 flex-none justify-center">{icon}</span>
      <span>{text}</span>
    </li>
  );
  return (
    <section aria-label="Key" className="ui-pop pointer-events-auto w-[min(250px,calc(100vw-48px))] rounded-panel text-footnote text-muted">
      <button type="button" aria-expanded={open} onClick={onToggle} className="flex w-full items-center gap-2 rounded-panel px-3 py-2 text-left font-semibold text-heading">
        <span className="flex-1">Key</span>
        {open ? <ChevronDown size={14} aria-hidden className="text-faint" /> : <ChevronUp size={14} aria-hidden className="text-faint" />}
      </button>
      {open ? (
        <div className="max-h-[50vh] space-y-2 overflow-y-auto px-3 pb-3">
          <ul className="space-y-1">
            {shows.colorBy === "kind"
              ? shows.kinds.map((k) => row(<Dot color={k.color} kind={k.kind} />, k.kind === "note" ? "A note" : k.label))
              : shows.groups.slice(0, 12).map((g) => row(<Dot color={g.color} />, g.name))}
            {shows.colorBy !== "kind" ? row(<Dot color="var(--color-line-strong)" />, shows.colorBy === "folder" ? "In no folder" : "No tag") : null}
            {row(
              <span className="flex items-center gap-0.5">
                <Dot color="var(--color-ink-muted)" r={2.5} />
                <Dot color="var(--color-ink-muted)" r={5} />
              </span>,
              "Bigger dot: more connections",
            )}
          </ul>
          <ul className="space-y-1">
            {row(<LineSample arrow={shows.arrows} />, shows.arrows ? "A link you wrote, pointing at the note it links to" : "A link you wrote with [[")}
            {shows.mentions ? row(<LineSample width={1} />, "A note mentions this person, project or topic") : null}
            {shows.aiLines ? row(<LineSample dash="4 3" width={1} />, "Foli AI found them related") : null}
            {shows.contradicts ? row(<LineSample dash="4 3" color="var(--color-coral)" width={1} />, "They contradict each other") : null}
            {shows.duplicates ? row(<LineSample dash="1 3" color="var(--color-plum)" />, "Likely the same note twice, or one replaces the other") : null}
            {shows.suggested ? row(<LineSample dash="2 4" color="var(--color-accent)" />, "Could be linked: click the line to link them") : null}
            {shows.shared ? row(<LineSample dash="1 3" width={1} />, "Share a tag or a folder") : null}
          </ul>
          {shows.clusters || shows.bridges || shows.fresh || shows.pins ? (
            <ul className="space-y-1">
              {shows.clusters ? row(<span aria-hidden className="block h-4 w-6 rounded-chip bg-accent opacity-15" />, "A group of closely linked notes") : null}
              {shows.bridges ? row(<Dot color="var(--color-ink-muted)" ring={{ color: "var(--color-accent)", dash: "2 2" }} />, "Joins two groups") : null}
              {shows.fresh ? row(<Dot color="var(--color-ink-muted)" ring={{ color: "var(--color-marigold)", glow: true }} />, "New this week") : null}
              {shows.pins ? row(
                <svg width={20} height={20} viewBox="-10 -10 20 20" aria-hidden>
                  <circle r={4} cy={2} fill="var(--color-ink-muted)" />
                  <circle r={1.6} cy={-5} fill="var(--color-heading)" />
                </svg>,
                "Pinned where you dragged it",
              ) : null}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

// ---- the first-time tips

export const TOUR_STEPS: { title: string; body: string }[] = [
  {
    title: "This is Foli DNA",
    body: "A map of your notes. Each dot is a note, and a line joins two notes that link to each other. Bigger dots have more connections. The Key in the corner explains every colour and line.",
  },
  {
    title: "Move around and open notes",
    body: "Drag to move, scroll or pinch to zoom. Click a note to see, in words, why it’s connected. Double-click it to open it.",
  },
  {
    title: "Focus on one note",
    body: "To see only what one note is connected to, choose Foli DNA in a note’s ••• menu, or Map around this note in its panel here. Whole map brings everything back.",
  },
];

/** Three short tips, the first time Foli DNA opens. `onDone` remembers they were seen (or skipped). */
export function DnaTour({ step, onStep, onDone }: { step: number; onStep: (n: number) => void; onDone: () => void }) {
  const next = useRef<HTMLButtonElement>(null);
  useEffect(() => next.current?.focus({ preventScroll: true }), [step]);
  const s = TOUR_STEPS[Math.min(step, TOUR_STEPS.length - 1)]!;
  const last = step >= TOUR_STEPS.length - 1;
  return (
    <section
      role="dialog"
      aria-label="Foli DNA tips"
      aria-describedby="dna-tour-body"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onDone();
        }
      }}
      className="ui-pop pointer-events-auto w-[min(360px,calc(100vw-32px))] rounded-panel p-4"
    >
      <p className="text-footnote tabular-nums text-faint">
        {step + 1} of {TOUR_STEPS.length}
      </p>
      <h2 className="mt-0.5 text-body font-semibold text-heading">{s.title}</h2>
      <p id="dna-tour-body" className="mt-1 text-subheadline leading-snug text-muted">
        {s.body}
      </p>
      <div className="mt-3 flex items-center gap-2">
        <div aria-hidden className="flex flex-1 gap-1">
          {TOUR_STEPS.map((_, i) => (
            <span key={i} className={`h-1.5 w-1.5 rounded-chip ${i === step ? "bg-heading" : "bg-line-strong"}`} />
          ))}
        </div>
        {!last ? (
          <Button variant="quiet" size="sm" onClick={onDone}>
            Skip
          </Button>
        ) : null}
        <Button ref={next} variant="primary" size="sm" onClick={() => (last ? onDone() : onStep(step + 1))}>
          {last ? "Got it" : "Next"}
        </Button>
      </div>
    </section>
  );
}

// ---- why a note is connected, in words

/**
 * The panel for the note (or person, project, topic) clicked on the map: one sentence saying why it's connected,
 * then those connections listed by reason, each one click from opening. Open it, map around it, or (on the map
 * around a note) show its own connections too.
 */
export function DnaNodePanel({
  id,
  index,
  names,
  ai,
  isCenter,
  expand,
  onOpen,
  onCenter,
  onPick,
  onClose,
}: {
  id: string;
  index: DnaIndex;
  names: Names;
  ai: boolean;
  isCenter: boolean;
  /** On the map around a note: whether this one's own connections show, and how to switch them. */
  expand?: { on: boolean; toggle: () => void } | null;
  onOpen: (id: string, newTab?: boolean) => void;
  onCenter: (id: string) => void;
  /** Picks another node on the map (an entity in the lists). */
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const n = index.byId.get(id);
  const words = useMemo(() => explain(index, id, names, { ai }), [index, id, names, ai]);
  if (!n) return null;
  const note = n.kind === "note";
  return (
    <section aria-label={`Why ${n.label || "Untitled"} is connected`} className="ui-pop pointer-events-auto flex max-h-[min(70vh,520px)] w-[min(320px,calc(100vw-32px))] flex-col rounded-panel">
      <div className="flex items-start gap-2 px-3 pt-3">
        <h2 className="min-w-0 flex-1 text-body font-semibold leading-snug text-heading">{n.label || "Untitled"}</h2>
        <IconButton label="Close" onClick={onClose} className="!h-7 !w-7 -mr-1 -mt-1">
          <X size={14} aria-hidden />
        </IconButton>
      </div>
      <p className="px-3 pt-1 text-subheadline leading-snug text-ink">{words.summary}</p>
      <div className="flex flex-wrap gap-2 px-3 pt-2">
        {note ? (
          <Button size="sm" variant="primary" onClick={(e) => onOpen(id, e.metaKey || e.ctrlKey)}>
            Open note
          </Button>
        ) : null}
        {note && !isCenter ? (
          <Button size="sm" onClick={() => onCenter(id)}>
            <Waypoints size={14} aria-hidden className="-ml-0.5 mr-1" />
            Map around this note
          </Button>
        ) : null}
        {expand ? (
          <Button size="sm" variant="quiet" aria-pressed={expand.on} onClick={expand.toggle}>
            {expand.on ? "Hide its connections" : "Show its connections"}
          </Button>
        ) : null}
      </div>
      <div className="mt-2 min-h-0 flex-1 space-y-2 overflow-y-auto px-3 pb-3">
        {words.groups.map((g) => (
          <div key={g.title}>
            <h3 className="ui-caps mb-0.5">
              {g.title} <span className="tabular-nums text-faint">{g.ids.length}</span>
            </h3>
            <ul className="space-y-0.5">
              {g.ids.slice(0, 8).map((x) => {
                const o = index.byId.get(x);
                if (!o) return null;
                return (
                  <li key={x}>
                    {o.kind === "note" ? (
                      <AppLink href={`/d/${x}`} className="flex items-center gap-1.5 rounded-chip px-1.5 py-1 text-subheadline hover:bg-accent-soft">
                        <FileText size={13} aria-hidden className="flex-none text-muted" />
                        <span className="truncate">{o.label || "Untitled"}</span>
                      </AppLink>
                    ) : (
                      <button type="button" onClick={() => onPick(x)} className="flex w-full items-center gap-1.5 rounded-chip px-1.5 py-1 text-left text-subheadline hover:bg-accent-soft">
                        <span className="truncate">{o.label}</span>
                      </button>
                    )}
                  </li>
                );
              })}
              {g.ids.length > 8 ? <li className="px-1.5 text-footnote text-faint">and {g.ids.length - 8} more</li> : null}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

// ---- the map around a note: its connections as a list

/** Beside the map around a note: each connection with why, one click to open; + shows that note's own too. */
export function DnaConnections({
  center,
  connections,
  index,
  names,
  expanded,
  onToggle,
  onPick,
  onWhole,
}: {
  center: string;
  connections: Connection[];
  index: DnaIndex;
  names: Names;
  expanded: ReadonlySet<string>;
  onToggle: (id: string) => void;
  onPick: (id: string) => void;
  onWhole: () => void;
}) {
  const me = index.byId.get(center);
  return (
    <aside aria-label="Connections" className="hidden w-72 flex-none flex-col border-l border-line md:flex">
      <div className="px-4 pb-1 pt-3">
        <h2 className="text-body font-semibold text-heading">{connections.length === 1 ? "1 connection" : `${connections.length} connections`}</h2>
        <p className="text-footnote text-muted">What {me?.label || "this note"} is connected to, and why.</p>
      </div>
      <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
        {connections.map((c) => {
          const o = index.byId.get(c.id);
          if (!o) return null;
          const why = lineLabel(c.reasons, names);
          const on = expanded.has(c.id);
          return (
            <li key={c.id} className="group flex items-center gap-1 rounded-chip hover:bg-accent-soft">
              {o.kind === "note" ? (
                <AppLink href={`/d/${c.id}`} className="min-w-0 flex-1 px-2 py-1.5">
                  <span className="block truncate text-subheadline text-heading">{o.label || "Untitled"}</span>
                  <span className="block truncate text-footnote text-muted">{why}</span>
                </AppLink>
              ) : (
                <button type="button" onClick={() => onPick(c.id)} className="min-w-0 flex-1 px-2 py-1.5 text-left">
                  <span className="block truncate text-subheadline text-heading">{o.label}</span>
                  <span className="block truncate text-footnote text-muted">{why}</span>
                </button>
              )}
              {o.kind === "note" ? (
                <IconButton label={on ? `Hide what ${o.label || "Untitled"} connects to` : `Show what ${o.label || "Untitled"} connects to`} aria-pressed={on} onClick={() => onToggle(c.id)} className="!h-7 !w-7 flex-none">
                  {on ? <Minus size={14} aria-hidden /> : <Plus size={14} aria-hidden />}
                </IconButton>
              ) : null}
            </li>
          );
        })}
        {!connections.length ? <li className="px-2 py-1.5 text-subheadline text-muted">Nothing yet. Type [[ in the note to link another one.</li> : null}
      </ul>
      <div className="border-t border-line p-2">
        <Button variant="quiet" size="sm" onClick={onWhole} className="w-full">
          Back to the whole map
        </Button>
      </div>
    </aside>
  );
}
