"use client";

// What makes Foli DNA easier to read (components/views/GraphView.tsx): the Key (what dot colours, sizes and line
// styles mean, only for what's on the map), the first-time tips, the panel that says in words why a note is
// connected, and the list of a note's connections on the map around it. The Mac, iPad and iPhone draw the same
// in GraphScreen.swift.
import { useEffect, useMemo, useRef } from "react";
import { ArrowUpRight, ChevronDown, ChevronUp, FileText, Plus, Minus, Waypoints, X } from "lucide-react";
import { AppLink } from "@/lib/app/router";
import { Button, IconButton } from "@/components/ui/Button";
import { shapePath } from "@/lib/graph/layout";
import { explain, groupConnections, lineLabel, type Connection, type DnaIndex, type Names } from "@/lib/graph/neighbourhood";

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
      <button type="button" aria-expanded={open} onClick={onToggle} className="flex w-full items-center gap-2 rounded-panel px-3 py-2 text-left font-semibold text-heading transition-colors duration-150 hover:bg-[var(--glass-hover)]">
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

// ---- the floating card over the map (the map around a note, a picked note's panel, Insights)

/**
 * The floating card's surface (the owner's design A, 6 November 2026): the popover glass, its radius and shadow,
 * as wide as its slot (about 300), as tall as its content up to the slot (which stops above Ask Foli AI).
 */
export const DNA_CARD = "ui-pop pointer-events-auto flex max-h-full min-h-0 w-full flex-col overflow-hidden rounded-panel animate-[folio-rise_180ms_var(--ease-folio)] motion-reduce:animate-none";
/** A tight row in the card (about 32 tall) with the glass hover over all of it. */
export const DNA_ROW = "flex h-8 min-w-0 items-center gap-2 rounded-chip px-1.5 text-subheadline text-ink transition-colors duration-150 hover:bg-[var(--glass-hover)] hover:text-heading";

const KIND_VAR: Record<string, string> = {
  note: "var(--color-ink-muted)",
  person: "var(--color-coral)",
  project: "var(--color-accent)",
  organization: "var(--color-moss)",
  topic: "var(--color-marigold)",
  decision: "var(--color-plum)",
};

/** A node's small glyph: a note's dot, an entity's shape in its colour. */
export function KindDot({ kind, size = 10 }: { kind: string; size?: number }) {
  const r = size / 2 - 1;
  const d = shapePath(kind, r * 0.85);
  const fill = KIND_VAR[kind] ?? KIND_VAR.note;
  return (
    <svg width={size} height={size} viewBox={`${-size / 2} ${-size / 2} ${size} ${size}`} aria-hidden className="flex-none">
      {d ? <path d={d} fill={fill} /> : <circle r={r} fill={fill} />}
    </svg>
  );
}

/**
 * The card's head: the centre note's glyph (its folder's colour, else its dot) and name, a muted line under it, and
 * an x (back to the whole map, or close Insights). Around a note, a small switch below: Connections or Insights.
 */
export function DnaCardHead({
  glyph,
  title,
  sub,
  closeLabel,
  onClose,
  tab,
  onTab,
}: {
  glyph?: React.ReactNode;
  title: string;
  sub?: string;
  closeLabel: string;
  onClose: () => void;
  tab?: "connections" | "insights";
  onTab?: (t: "connections" | "insights") => void;
}) {
  return (
    <div className="flex-none px-3 pb-2 pt-3">
      <div className="flex items-start gap-2">
        {glyph ? <span className="mt-0.5 flex h-4 w-4 flex-none items-center justify-center">{glyph}</span> : null}
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-body font-semibold leading-snug text-heading">{title}</h2>
          {sub ? <p className="truncate text-footnote tabular-nums text-muted">{sub}</p> : null}
        </div>
        <IconButton label={closeLabel} onClick={onClose} className="!h-7 !w-7 -mr-1 -mt-1 flex-none">
          <X size={14} aria-hidden />
        </IconButton>
      </div>
      {tab && onTab ? (
        <div role="group" aria-label="Show in the card" className="ui-seg ui-well mt-2 !p-0.5">
          {(["connections", "insights"] as const).map((t) => (
            <button key={t} type="button" aria-pressed={tab === t} onClick={() => onTab(t)} className="!min-h-7 text-subheadline hover:aria-[pressed=false]:bg-[var(--glass-hover)]">
              {t === "connections" ? "Connections" : "Insights"}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** A small caps section label with its count at the right. */
export function DnaSection({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <section className="mt-2 first:mt-0">
      <h3 className="ui-caps flex h-6 items-center justify-between gap-2 px-1.5">
        <span className="truncate">{title}</span>
        {count !== undefined ? <span className="tabular-nums text-faint">{count}</span> : null}
      </h3>
      {children}
    </section>
  );
}

/**
 * The centre note's connections, grouped by why (links, mentions, a shared tag or folder…). A click on a row picks
 * it on the map (its panel says why); the arrow at the end opens it; + (on hover) shows its own connections too.
 */
export function DnaConnections({
  connections,
  index,
  names,
  expanded,
  picked,
  onToggle,
  onPick,
  onOpen,
}: {
  connections: Connection[];
  index: DnaIndex;
  names: Names;
  expanded: ReadonlySet<string>;
  picked: string | null;
  onToggle: (id: string) => void;
  onPick: (id: string) => void;
  onOpen: (id: string, newTab?: boolean) => void;
}) {
  const groups = useMemo(() => groupConnections(connections, names), [connections, names]);
  const why = useMemo(() => new Map(connections.map((c) => [c.id, lineLabel(c.reasons, names)])), [connections, names]);
  if (!connections.length) return <p className="px-3 pb-3 text-subheadline text-muted">Nothing yet. Type [[ in the note to link another one.</p>;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1.5 pb-2">
      {groups.map((g) => (
        <DnaSection key={g.key} title={g.title} count={g.ids.length}>
          <ul>
            {g.ids.map((id) => {
              const o = index.byId.get(id);
              if (!o) return null;
              const label = o.label || "Untitled";
              const note = o.kind === "note";
              const on = expanded.has(id);
              return (
                <li key={id} className={`group flex items-center gap-0.5 rounded-chip pr-1 transition-colors duration-150 hover:bg-[var(--glass-hover)] ${picked === id ? "bg-accent-soft" : ""}`}>
                  <button
                    type="button"
                    aria-current={picked === id || undefined}
                    title={why.get(id)}
                    onClick={() => onPick(id)}
                    className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-chip pl-1.5 text-left text-subheadline text-ink outline-none hover:text-heading focus-visible:ring-2 focus-visible:ring-[var(--color-focus)]"
                  >
                    {note ? <FileText size={13} aria-hidden className="flex-none text-muted" /> : <KindDot kind={o.kind} />}
                    <span className="truncate">{label}</span>
                  </button>
                  {note ? (
                    <IconButton
                      label={on ? `Hide what ${label} connects to` : `Show what ${label} connects to`}
                      aria-pressed={on}
                      onClick={() => onToggle(id)}
                      className={`!h-6 !min-h-6 !w-6 !min-w-6 flex-none ${on ? "" : "opacity-0 focus-visible:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100"}`}
                    >
                      {on ? <Minus size={13} aria-hidden /> : <Plus size={13} aria-hidden />}
                    </IconButton>
                  ) : null}
                  {note ? (
                    <IconButton label="Open" onClick={(e) => onOpen(id, e.metaKey || e.ctrlKey)} className="!h-6 !min-h-6 !w-6 !min-w-6 flex-none">
                      <ArrowUpRight size={14} aria-hidden />
                    </IconButton>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </DnaSection>
      ))}
    </div>
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
    <section aria-label={`Why ${n.label || "Untitled"} is connected`} className={DNA_CARD}>
      <div className="flex items-start gap-2 px-3 pt-3">
        <span className="mt-1 flex-none">
          <KindDot kind={n.kind} />
        </span>
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
            <h3 className="ui-caps mb-0.5 flex items-center justify-between px-1.5">
              <span className="truncate">{g.title}</span> <span className="tabular-nums text-faint">{g.ids.length}</span>
            </h3>
            <ul className="space-y-0.5">
              {g.ids.slice(0, 8).map((x) => {
                const o = index.byId.get(x);
                if (!o) return null;
                return (
                  <li key={x}>
                    {o.kind === "note" ? (
                      <AppLink href={`/d/${x}`} className={DNA_ROW}>
                        <FileText size={13} aria-hidden className="flex-none text-muted" />
                        <span className="truncate">{o.label || "Untitled"}</span>
                      </AppLink>
                    ) : (
                      <button type="button" onClick={() => onPick(x)} className={`${DNA_ROW} w-full text-left`}>
                        <KindDot kind={o.kind} />
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

