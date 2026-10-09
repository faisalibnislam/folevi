"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { useQuery } from "convex/react";
import { FileText, Maximize, Search, X, ZoomIn, ZoomOut } from "lucide-react";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { AppLink, useAppRouter } from "@/lib/app/router";
import { useLocalStorage } from "@/lib/hooks/useEngine";
import { useMediaQuery } from "@/lib/hooks/useMediaQuery";
import { ViewChrome } from "@/components/app/Shell";
import { IconButton } from "@/components/ui/Button";
import {
  boundsOf,
  degrees,
  fitTransform,
  graphList,
  matchNodes,
  neighbours,
  radiusFor,
  Simulation,
  toScreen,
  zoomAround,
  type GraphEdgeData,
  type GraphNodeData,
  type Point,
  type ViewTransform,
} from "@/lib/graph/layout";

const ENTITY_KINDS = ["person", "project", "organization", "topic", "decision"] as const;
type EntityKind = (typeof ENTITY_KINDS)[number];

/** Notes stay neutral; each kind of entity takes one of the app's accent colours. */
export const KIND_COLOR: Record<string, string> = {
  note: "var(--color-ink-muted)",
  person: "var(--color-coral)",
  project: "var(--color-accent)",
  organization: "var(--color-moss)",
  topic: "var(--color-marigold)",
  decision: "var(--color-plum)",
};
export const KIND_LABEL: Record<string, string> = { note: "Note", person: "Person", project: "Project", organization: "Organization", topic: "Topic", decision: "Decision" };
const KIND_FILTER_LABEL: Record<EntityKind, string> = { person: "People", project: "Projects", organization: "Organizations", topic: "Topics", decision: "Decisions" };
const EDGE_LABEL: Record<string, string> = { link: "Linked", mention: "Mentions", similar: "Similar", related: "Related", references: "Refers to", contradicts: "Contradicts", supersedes: "Replaces" };

/**
 * The graph page (/graph): the current context's notes and the links between them, and where the plan
 * includes it, the people, projects, organizations, topics and decisions they mention. A force layout on
 * SVG with pan, zoom and hover labels; a note opens on click, an entity shows its notes. The List view
 * shows the same graph as text, for keyboards, screen readers and small screens.
 */
export function GraphView() {
  const { scope } = useAppState();
  const { navigate } = useAppRouter();
  const [kinds, setKinds] = useState<EntityKind[]>([...ENTITY_KINDS]);
  const [view, setView] = useLocalStorage<"graph" | "list">("folevi:graph-view", "graph");
  const [query, setQuery] = useState("");
  const live = useQuery(api.aiGraph.graph, { scope, kinds: kinds.length === ENTITY_KINDS.length ? undefined : kinds });
  // Keep showing the last graph of this context while a filter change loads.
  const scopeKey = scope.kind === "personal" ? "personal" : scope.workspaceId;
  const last = useRef<{ key: string; data: NonNullable<typeof live> } | null>(null);
  if (live) last.current = { key: scopeKey, data: live };
  const data = live ?? (last.current?.key === scopeKey ? last.current.data : undefined);
  const open = useCallback((id: string) => navigate(`/d/${id}`), [navigate]);

  const nodes: GraphNodeData[] = useMemo(() => data?.nodes ?? [], [data]);
  const edges: GraphEdgeData[] = useMemo(() => data?.edges ?? [], [data]);
  const notes = nodes.filter((n) => n.kind === "note").length;
  const matches = useMemo(() => matchNodes(nodes, query), [nodes, query]);

  return (
    <ViewChrome title="Graph" tabTitle="Graph">
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex flex-none flex-wrap items-center gap-2 px-4 pb-2 pt-1 sm:px-6">
          <div role="group" aria-label="View" className="ui-seg ui-well">
            <button type="button" aria-pressed={view === "graph"} onClick={() => setView("graph")} className="!min-h-8 px-3 text-[13px]">
              Graph
            </button>
            <button type="button" aria-pressed={view === "list"} onClick={() => setView("list")} className="!min-h-8 px-3 text-[13px]">
              List
            </button>
          </div>
          <label className="ui-input flex h-8 min-w-[10rem] flex-1 items-center gap-1.5 rounded-[6px] px-2.5 sm:max-w-xs">
            <Search size={14} aria-hidden className="flex-none text-faint" />
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find in the graph" aria-label="Find in the graph" className="min-w-0 flex-1 bg-transparent text-[13px] outline-none" />
          </label>
          {data?.full ? (
            <div role="group" aria-label="Show" className="flex flex-wrap items-center gap-1">
              {ENTITY_KINDS.map((k) => {
                const on = kinds.includes(k);
                return (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setKinds((cur) => (on ? cur.filter((x) => x !== k) : ENTITY_KINDS.filter((x) => x === k || cur.includes(x))))}
                    className={`ui-chip transition-colors ${on ? "bg-sunken text-heading" : "text-faint hover:text-ink"}`}
                  >
                    <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: on ? KIND_COLOR[k] : "var(--color-line-strong)" }} />
                    {KIND_FILTER_LABEL[k]}
                  </button>
                );
              })}
            </div>
          ) : null}
          <p className="ml-auto text-[12px] tabular-nums text-faint" aria-live="polite">
            {data ? `${notes} ${notes === 1 ? "note" : "notes"}${nodes.length > notes ? `, ${nodes.length - notes} more` : ""}${query.trim() ? ` · ${matches.size} found` : ""}` : null}
          </p>
        </div>
        {data?.note || data?.truncated ? (
          <p className="flex-none px-4 pb-2 text-[12.5px] text-muted sm:px-6">
            {data.note}
            {data.upgrade ? (
              <>
                {" "}
                <AppLink href="/settings/billing" className="text-heading underline underline-offset-2">
                  See plans
                </AppLink>
              </>
            ) : null}
            {data.truncated ? <span className="block">Showing the most recently edited notes.</span> : null}
          </p>
        ) : null}
        {!data ? (
          <p className="m-auto text-sm text-muted">Loading the graph…</p>
        ) : !nodes.length ? (
          <p className="m-auto px-6 text-center text-sm text-muted">No notes here yet. Notes and the links between them show up here.</p>
        ) : view === "list" ? (
          <GraphList nodes={nodes} edges={edges} query={query} />
        ) : (
          <GraphCanvas nodes={nodes} edges={edges} matches={matches} searching={Boolean(query.trim())} onOpen={open} />
        )}
      </div>
    </ViewChrome>
  );
}

/** The graph as text: every note and entity with what it's connected to. */
export function GraphList({ nodes, edges, query }: { nodes: GraphNodeData[]; edges: GraphEdgeData[]; query: string }) {
  const entries = useMemo(() => graphList(nodes, edges, query), [nodes, edges, query]);
  const noteEntries = entries.filter((e) => e.kind === "note");
  const entityEntries = entries.filter((e) => e.kind !== "note");
  if (!entries.length) return <p className="m-auto text-sm text-muted">Nothing matches.</p>;
  const connections = (e: (typeof entries)[number]) =>
    e.connections.length ? (
      <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[12.5px] text-muted" aria-label={`Connected to ${e.label || "Untitled"}`}>
        {e.connections.slice(0, 24).map((c) => (
          <li key={c.id}>
            <span className="text-faint">{EDGE_LABEL[c.edge] ?? "Related"}: </span>
            {c.kind === "note" ? (
              <AppLink href={`/d/${c.id}`} className="text-ink underline-offset-2 hover:underline">
                {c.label || "Untitled"}
              </AppLink>
            ) : (
              <span>
                {c.label} <span className="text-faint">({KIND_LABEL[c.kind]?.toLowerCase()})</span>
              </span>
            )}
          </li>
        ))}
      </ul>
    ) : (
      <p className="mt-1 text-[12.5px] text-faint">Not connected yet</p>
    );
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-10 sm:px-6">
      <section aria-labelledby="graph-list-notes">
        <h2 id="graph-list-notes" className="ui-caps mb-2 mt-2">
          Notes
        </h2>
        <ul className="space-y-3">
          {noteEntries.map((e) => (
            <li key={e.id}>
              <AppLink href={`/d/${e.id}`} className="inline-flex items-center gap-1.5 text-[14px] font-medium text-heading underline-offset-2 hover:underline">
                <FileText size={14} aria-hidden className="text-muted" />
                {e.label || "Untitled"}
              </AppLink>
              {connections(e)}
            </li>
          ))}
        </ul>
      </section>
      {entityEntries.length ? (
        <section aria-labelledby="graph-list-entities" className="mt-6">
          <h2 id="graph-list-entities" className="ui-caps mb-2">
            People, projects and topics
          </h2>
          <ul className="space-y-3">
            {entityEntries.map((e) => (
              <li key={e.id}>
                <span className="inline-flex items-center gap-1.5 text-[14px] font-medium text-heading">
                  <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: KIND_COLOR[e.kind] }} />
                  {e.label}
                  <span className="text-[12px] font-normal text-faint">{KIND_LABEL[e.kind]}</span>
                </span>
                {connections(e)}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

/** Labels always shown for the best-connected nodes (the rest on hover, search, or when zoomed in). */
const ALWAYS_LABELLED = 12;

function GraphCanvas({ nodes, edges, matches, searching, onOpen }: { nodes: GraphNodeData[]; edges: GraphEdgeData[]; matches: Set<string>; searching: boolean; onOpen: (id: string) => void }) {
  const wrap = useRef<HTMLDivElement>(null);
  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [t, setT] = useState<ViewTransform>({ x: 0, y: 0, k: 1 });
  const [, setFrame] = useState(0);
  const [hover, setHover] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const positions = useRef(new Map<string, Point>());
  const moved = useRef(false);

  // The container's size (the view fills it).
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setSize({ w: entry!.contentRect.width, h: entry!.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const deg = useMemo(() => degrees(edges), [edges]);
  const labelled = useMemo(() => new Set([...deg.entries()].sort((a, b) => b[1] - a[1]).slice(0, ALWAYS_LABELLED).map(([id]) => id)), [deg]);
  const shape = useMemo(() => `${nodes.map((n) => n.id).join(",")}|${edges.map((e) => `${e.source}>${e.target}`).join(",")}`, [nodes, edges]);

  const fit = useCallback(() => {
    if (!size.w || !size.h) return;
    setT(fitTransform(boundsOf(positions.current.values()), size.w, size.h));
  }, [size.w, size.h]);
  const fitRef = useRef(fit);
  fitRef.current = fit;

  // Lay out (again) when the graph changes; nodes seen before keep their place.
  useEffect(() => {
    const sim = new Simulation(
      nodes.map((n) => n.id),
      edges,
      { previous: positions.current },
    );
    // A head start out of sight, so the first picture is already roughly in shape.
    for (let i = 0; i < (reduced ? 400 : 60) && sim.tick(); i++);
    positions.current = sim.positions();
    if (!moved.current) fitRef.current();
    setFrame((f) => f + 1);
    if (sim.settled) return;
    let raf = 0;
    const step = () => {
      for (let i = 0; i < 3; i++) sim.tick();
      positions.current = sim.positions();
      setFrame((f) => f + 1);
      if (sim.settled) {
        if (!moved.current) fitRef.current();
        return;
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // `shape` stands for nodes and edges.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shape, reduced]);

  // First size known: fit.
  useEffect(() => {
    if (!moved.current) fit();
  }, [fit]);

  // Wheel zoom around the pointer (a non-passive listener, so the page doesn't scroll too).
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      moved.current = true;
      const r = el.getBoundingClientRect();
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
      setT((cur) => zoomAround(cur, factor, e.clientX - r.left, e.clientY - r.top));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Pan with one pointer, pinch with two; a press that barely moves is a click.
  const pointers = useRef(new Map<number, Point>());
  const press = useRef<{ x: number; y: number; node: string | null; far: boolean } | null>(null);
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    (e.currentTarget as HTMLDivElement).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const node = (e.target as Element).closest?.("[data-node]")?.getAttribute("data-node") ?? null;
    press.current = pointers.current.size === 1 ? { x: e.clientX, y: e.clientY, node, far: false } : null;
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const now = { x: e.clientX, y: e.clientY };
    if (press.current && Math.hypot(now.x - press.current.x, now.y - press.current.y) > 5) press.current.far = true;
    if (pointers.current.size === 1) {
      if (press.current?.far) {
        moved.current = true;
        setT((cur) => ({ ...cur, x: cur.x + now.x - prev.x, y: cur.y + now.y - prev.y }));
      }
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.entries()].map(([id, p]) => (id === e.pointerId ? now : p));
      const [pa, pb] = [...pointers.current.values()];
      const before = Math.hypot(pa!.x - pb!.x, pa!.y - pb!.y) || 1;
      const after = Math.hypot(a!.x - b!.x, a!.y - b!.y) || 1;
      const r = wrap.current!.getBoundingClientRect();
      moved.current = true;
      setT((cur) => zoomAround(cur, after / before, (a!.x + b!.x) / 2 - r.left, (a!.y + b!.y) / 2 - r.top));
    }
    pointers.current.set(e.pointerId, now);
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    const p = press.current;
    press.current = null;
    if (!p || p.far) return;
    if (!p.node) return setSelected(null);
    const n = byId.get(p.node);
    if (n?.kind === "note") onOpen(n.id);
    else if (n) setSelected((cur) => (cur === n.id ? null : n.id));
  };

  const zoomBy = (factor: number) => {
    moved.current = true;
    setT((cur) => zoomAround(cur, factor, size.w / 2, size.h / 2));
  };
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const pan: Record<string, [number, number]> = { ArrowLeft: [40, 0], ArrowRight: [-40, 0], ArrowUp: [0, 40], ArrowDown: [0, -40] };
    if (pan[e.key]) {
      e.preventDefault();
      moved.current = true;
      const [dx, dy] = pan[e.key]!;
      setT((cur) => ({ ...cur, x: cur.x + dx, y: cur.y + dy }));
    } else if (e.key === "+" || e.key === "=") zoomBy(1.25);
    else if (e.key === "-") zoomBy(0.8);
    else if (e.key === "0") {
      moved.current = false;
      fit();
    } else if (e.key === "Escape" && selected) {
      e.stopPropagation();
      setSelected(null);
    }
  };

  // What's highlighted: the hovered or selected node and its neighbours, or the search's matches.
  const focus = hover ?? selected;
  const near = useMemo(() => (focus ? new Set([focus, ...neighbours(edges, focus)]) : null), [focus, edges]);
  const lit = (id: string) => (near ? near.has(id) : searching ? matches.has(id) : true);
  const pos = positions.current;
  const hovered = hover ? byId.get(hover) : null;
  const hoverAt = hover && pos.get(hover) ? toScreen(t, pos.get(hover)!) : null;
  const picked = selected ? byId.get(selected) : null;
  const pickedNotes = useMemo(
    () =>
      selected
        ? [...neighbours(edges, selected)]
            .map((id) => byId.get(id))
            .filter((n): n is GraphNodeData => n?.kind === "note")
            .sort((a, b) => a.label.localeCompare(b.label))
        : [],
    [selected, edges, byId],
  );
  const noteCount = nodes.filter((n) => n.kind === "note").length;

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={wrap}
        tabIndex={0}
        role="application"
        aria-roledescription="graph"
        aria-label={`Graph of ${noteCount} notes and ${nodes.length - noteCount} people, projects and topics. Arrow keys pan, plus and minus zoom, 0 fits. The List view shows the same graph as text.`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
        className="absolute inset-0 cursor-grab touch-none select-none overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus active:cursor-grabbing"
      >
        <svg width="100%" height="100%" aria-hidden className="block">
          <g transform={`translate(${t.x} ${t.y}) scale(${t.k})`}>
            {edges.map((e, i) => {
              const a = pos.get(e.source);
              const b = pos.get(e.target);
              if (!a || !b) return null;
              const on = near ? near.has(e.source) && near.has(e.target) : !searching || (matches.has(e.source) && matches.has(e.target));
              const stroke = e.kind === "contradicts" ? "var(--color-coral)" : e.kind === "supersedes" ? "var(--color-plum)" : e.kind === "mention" ? "var(--color-line)" : "var(--color-line-strong)";
              return (
                <line
                  key={i}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke={stroke}
                  strokeWidth={e.kind === "link" ? 1.4 : 1}
                  strokeDasharray={e.inferred && e.kind !== "mention" ? "4 3" : undefined}
                  vectorEffect="non-scaling-stroke"
                  opacity={on ? 0.9 : 0.12}
                />
              );
            })}
            {nodes.map((n) => {
              const p = pos.get(n.id);
              if (!p) return null;
              const entity = n.kind !== "note";
              const r = radiusFor(deg.get(n.id) ?? 0, entity);
              const on = lit(n.id);
              const showLabel = on && (t.k >= 1.3 || labelled.has(n.id) || (near?.has(n.id) ?? false) || (searching && matches.has(n.id)));
              return (
                <g key={n.id} data-node={n.id} transform={`translate(${p.x} ${p.y})`} opacity={on ? 1 : 0.25} onPointerEnter={() => setHover(n.id)} onPointerLeave={() => setHover((h) => (h === n.id ? null : h))} className="cursor-pointer">
                  {entity ? (
                    <rect x={-r} y={-r} width={r * 2} height={r * 2} rx={r * 0.45} fill={KIND_COLOR[n.kind]} stroke="var(--color-canvas)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
                  ) : (
                    <circle r={r} fill={KIND_COLOR.note} stroke={n.id === selected ? "var(--color-heading)" : "var(--color-canvas)"} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
                  )}
                  {showLabel && n.id !== hover ? (
                    <text y={r + 11 / t.k} textAnchor="middle" fontSize={11 / t.k} fill="var(--color-ink)" style={{ paintOrder: "stroke", stroke: "var(--color-canvas)", strokeWidth: 3 / t.k }}>
                      {(n.label || "Untitled").slice(0, 40)}
                    </text>
                  ) : null}
                </g>
              );
            })}
          </g>
        </svg>
      </div>
      {hovered && hoverAt ? (
        <div role="tooltip" className="ui-pop pointer-events-none absolute z-10 max-w-[240px] -translate-x-1/2 rounded-[8px] px-2.5 py-1.5 text-[12.5px]" style={{ left: hoverAt.x, top: hoverAt.y + 14 }}>
          <span className="font-medium text-heading">{hovered.label || "Untitled"}</span>
          <span className="block text-[11.5px] text-muted">{hovered.kind === "note" ? "Click to open" : KIND_LABEL[hovered.kind]}</span>
        </div>
      ) : null}
      {picked ? (
        <section aria-label={picked.label} className="ui-pop absolute bottom-3 left-3 z-10 w-[min(300px,calc(100%-24px))] rounded-[12px] p-3">
          <div className="flex items-start gap-2">
            <span aria-hidden className="mt-1.5 h-2 w-2 flex-none rounded-full" style={{ background: KIND_COLOR[picked.kind] }} />
            <h2 className="min-w-0 flex-1 text-[14px] font-semibold text-heading">
              {picked.label} <span className="text-[12px] font-normal text-faint">{KIND_LABEL[picked.kind]}</span>
            </h2>
            <IconButton label="Close" onClick={() => setSelected(null)} className="!h-7 !w-7 -mr-1 -mt-1">
              <X size={14} aria-hidden />
            </IconButton>
          </div>
          <ul className="mt-2 max-h-48 space-y-0.5 overflow-y-auto">
            {pickedNotes.map((n) => (
              <li key={n.id}>
                <AppLink href={`/d/${n.id}`} className="flex items-center gap-1.5 rounded-[6px] px-1.5 py-1 text-[13px] hover:bg-accent-soft">
                  <FileText size={13} aria-hidden className="flex-none text-muted" />
                  <span className="truncate">{n.label || "Untitled"}</span>
                </AppLink>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <div role="group" aria-label="Zoom" className="ui-pop absolute right-3 top-3 z-10 flex flex-col gap-0.5 rounded-[10px] p-1">
        <IconButton label="Zoom in" onClick={() => zoomBy(1.25)}>
          <ZoomIn size={15} aria-hidden />
        </IconButton>
        <IconButton label="Zoom out" onClick={() => zoomBy(0.8)}>
          <ZoomOut size={15} aria-hidden />
        </IconButton>
        <IconButton
          label="Fit to screen"
          onClick={() => {
            moved.current = false;
            fit();
          }}
        >
          <Maximize size={15} aria-hidden />
        </IconButton>
      </div>
    </div>
  );
}
