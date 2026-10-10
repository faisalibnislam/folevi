"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { useQuery } from "convex/react";
import { FileText, Maximize, Search, X, ZoomIn, ZoomOut } from "lucide-react";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { AppLink, useAppRouter } from "@/lib/app/router";
import { useLocalStorage } from "@/lib/hooks/useEngine";
import { ViewChrome } from "@/components/app/Shell";
import { IconButton } from "@/components/ui/Button";
import {
  boundsOf,
  degrees,
  drawnRadius,
  fitTransform,
  graphList,
  hitRadius,
  matchNodes,
  neighbours,
  nextInDirection,
  radiusFor,
  shapePath,
  Simulation,
  toScreen,
  topConnected,
  zoomAround,
  type Direction,
  type GraphEdgeData,
  type GraphNodeData,
  type Point,
  type ViewTransform,
} from "@/lib/graph/layout";

const ENTITY_KINDS = ["person", "project", "organization", "topic", "decision"] as const;
type EntityKind = (typeof ENTITY_KINDS)[number];

/** Notes stay neutral; each kind of entity takes one of the app's accent colours (and its own shape). */
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
 * SVG with pan, zoom, labels and keyboard moves between nodes; a note opens on click or Enter, an entity
 * shows its notes. The List view shows the same graph as text, for screen readers and small screens.
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
          <label className="ui-input flex h-8 min-w-[10rem] flex-1 items-center gap-1.5 rounded-chip px-2.5 sm:max-w-xs">
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
                    <KindGlyph kind={k} muted={!on} />
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
                  <KindGlyph kind={e.kind} />
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

/** Labels always shown for the best-connected nodes (the rest on hover, focus, search, or when zoomed in). */
export const ALWAYS_LABELLED = 12;
/** Layout work per frame: the rest waits for the next one, so the page never stalls while it settles. */
const FRAME_BUDGET_MS = 8;

/** A small shape of a kind (the filters, the list, the legend): circle, diamond, square… */
export function KindGlyph({ kind, size = 10, muted = false }: { kind: string; size?: number; muted?: boolean }) {
  const r = size / 2 - 1;
  const d = shapePath(kind, r * 0.85);
  const fill = muted ? "var(--color-line-strong)" : KIND_COLOR[kind];
  return (
    <svg width={size} height={size} viewBox={`${-size / 2} ${-size / 2} ${size} ${size}`} aria-hidden className="flex-none">
      {d ? <path d={d} fill={fill} /> : <circle r={r} fill={fill} />}
    </svg>
  );
}

/** What a node is called for screen readers: its name, kind and connections. */
export function nodeLabel(n: GraphNodeData, degree: number): string {
  const what = n.kind === "note" ? "note" : (KIND_LABEL[n.kind] ?? "Topic").toLowerCase();
  return `${n.label || "Untitled"}, ${what}, ${degree} ${degree === 1 ? "connection" : "connections"}`;
}

const ARROWS: Record<string, Direction> = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" };

/**
 * The graph itself: nodes sized by their connections (with a minimum that's easy to hit), the
 * best-connected ones labelled, entities shaped by kind, quiet edges. The layout settles out of sight in
 * small slices of each frame (bounded, LAYOUT_MAX_TICKS), then shows once, fitted. Keyboard: Tab reaches
 * the graph's one stop, arrow keys move between nodes, Enter opens a note or shows an entity's notes,
 * Shift with the arrows pans, plus and minus zoom, 0 fits.
 */
export function GraphCanvas({ nodes, edges, matches, searching, onOpen }: { nodes: GraphNodeData[]; edges: GraphEdgeData[]; matches: Set<string>; searching: boolean; onOpen: (id: string) => void }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [t, setT] = useState<ViewTransform>({ x: 0, y: 0, k: 1 });
  const [positions, setPositions] = useState<ReadonlyMap<string, Point>>(() => new Map());
  const [hover, setHover] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const [ring, setRing] = useState(false);
  const [stop, setStop] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const placed = useRef<ReadonlyMap<string, Point>>(new Map());
  const nodeEls = useRef(new Map<string, SVGGElement>());
  const moved = useRef(false);
  const sizeRef = useRef(size);
  sizeRef.current = size;

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
  const labelled = useMemo(() => topConnected(deg, ALWAYS_LABELLED), [deg]);
  const shape = useMemo(() => `${nodes.map((n) => n.id).join(",")}|${edges.map((e) => `${e.source}>${e.target}`).join(",")}`, [nodes, edges]);

  /** Shows all of the graph (with room for the biggest nodes). */
  const fitTo = useCallback((points: ReadonlyMap<string, Point>) => {
    const { w, h } = sizeRef.current;
    if (!w || !h) return;
    const b = boundsOf(points.values());
    setT(fitTransform(b && { minX: b.minX - 20, minY: b.minY - 20, maxX: b.maxX + 20, maxY: b.maxY + 20 }, w, h, 36));
  }, []);

  // Lay out (again) when the graph changes: a few milliseconds of steps per frame until it settles (or
  // reaches its step limit), then the result shows at once. Nodes seen before keep their place.
  useEffect(() => {
    const sim = new Simulation(
      nodes.map((n) => n.id),
      edges,
      { previous: placed.current },
    );
    let raf = 0;
    const step = () => {
      const start = performance.now();
      while (!sim.settled && performance.now() - start < FRAME_BUDGET_MS) sim.tick();
      if (!sim.settled) {
        raf = requestAnimationFrame(step);
        return;
      }
      const next = sim.positions();
      placed.current = next;
      setPositions(next);
      if (!moved.current) fitTo(next);
    };
    step();
    return () => cancelAnimationFrame(raf);
    // `shape` stands for nodes and edges.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shape, fitTo]);

  // Size known or changed: fit, unless the person has moved the view.
  useEffect(() => {
    if (!moved.current) fitTo(placed.current);
  }, [size.w, size.h, fitTo]);

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
  /** A note opens; an entity shows (or hides) the notes that mention it. */
  const activate = (id: string) => {
    const n = byId.get(id);
    if (n?.kind === "note") onOpen(n.id);
    else if (n) setSelected((cur) => (cur === n.id ? null : n.id));
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    const p = press.current;
    press.current = null;
    if (!p || p.far) return;
    if (!p.node) return setSelected(null);
    activate(p.node);
  };

  const zoomBy = (factor: number) => {
    moved.current = true;
    setT((cur) => zoomAround(cur, factor, size.w / 2, size.h / 2));
  };
  const refit = () => {
    moved.current = false;
    fitTo(placed.current);
  };
  /** Moves keyboard focus to a node, panning just enough to bring it into view. */
  const focusNode = (id: string) => {
    const p = placed.current.get(id);
    if (p && size.w && size.h) {
      const s = toScreen(t, p);
      const margin = 48;
      if (s.x < margin || s.x > size.w - margin || s.y < margin || s.y > size.h - margin) {
        moved.current = true;
        setT((cur) => ({ ...cur, x: size.w / 2 - p.x * cur.k, y: size.h / 2 - p.y * cur.k }));
      }
    }
    nodeEls.current.get(id)?.focus();
  };
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const on = (e.target as Element).closest?.("[data-node]")?.getAttribute("data-node") ?? null;
    const dir = ARROWS[e.key];
    if (dir && on && !e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      const next = nextInDirection(placed.current, on, dir);
      if (next) focusNode(next);
      return;
    }
    if (dir) {
      // Shift and an arrow (or an arrow anywhere else in the graph): pan.
      e.preventDefault();
      moved.current = true;
      const step = 40;
      const [dx, dy] = dir === "left" ? [step, 0] : dir === "right" ? [-step, 0] : dir === "up" ? [0, step] : [0, -step];
      setT((cur) => ({ ...cur, x: cur.x + dx, y: cur.y + dy }));
    } else if ((e.key === "Enter" || e.key === " ") && on) {
      e.preventDefault();
      activate(on);
    } else if (e.key === "+" || e.key === "=") zoomBy(1.25);
    else if (e.key === "-") zoomBy(0.8);
    else if (e.key === "0") refit();
    else if (e.key === "Escape" && selected) {
      e.stopPropagation();
      setSelected(null);
    }
  };

  // What's highlighted: the hovered, focused or selected node and its neighbours, or the search's matches.
  const focus = hover ?? focused ?? selected;
  const near = useMemo(() => (focus ? new Set([focus, ...neighbours(edges, focus)]) : null), [focus, edges]);
  // The graph's one Tab stop: the last node focused, else the best-connected one.
  const tabStop = stop && byId.has(stop) ? stop : ([...labelled][0] ?? nodes[0]?.id ?? null);
  const k = t.k;

  // Edges don't depend on pan or zoom (their stroke doesn't scale), so moving the view doesn't redraw them.
  const edgeLayer = useMemo(
    () =>
      edges.map((e, i) => {
        const a = positions.get(e.source);
        const b = positions.get(e.target);
        if (!a || !b) return null;
        const on = near ? near.has(e.source) && near.has(e.target) : !searching || (matches.has(e.source) && matches.has(e.target));
        const stroke = e.kind === "contradicts" ? "var(--color-coral)" : e.kind === "supersedes" ? "var(--color-plum)" : "var(--color-line-strong)";
        return (
          <line
            key={i}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke={stroke}
            strokeWidth={e.kind === "link" ? 1.2 : 1}
            strokeDasharray={e.inferred && e.kind !== "mention" ? "4 3" : undefined}
            vectorEffect="non-scaling-stroke"
            opacity={on ? (near ? 0.9 : 0.45) : 0.07}
          />
        );
      }),
    [edges, positions, near, searching, matches],
  );

  // Nodes depend on the zoom (their minimum size and label size), not on panning.
  const nodeLayer = useMemo(
    () =>
      nodes.map((n) => {
        const p = positions.get(n.id);
        if (!p) return null;
        const entity = n.kind !== "note";
        const d = deg.get(n.id) ?? 0;
        const r = drawnRadius(radiusFor(d, entity), k);
        const on = near ? near.has(n.id) : searching ? matches.has(n.id) : true;
        const showLabel = on && (k >= 1.3 || labelled.has(n.id) || (near?.has(n.id) ?? false) || (searching && matches.has(n.id)));
        const path = shapePath(n.kind, r);
        const outline = n.id === selected ? "var(--color-heading)" : "var(--color-canvas)";
        return (
          <g
            key={n.id}
            ref={(el) => {
              if (el) nodeEls.current.set(n.id, el);
              else nodeEls.current.delete(n.id);
            }}
            data-node={n.id}
            role="button"
            tabIndex={n.id === tabStop ? 0 : -1}
            aria-label={nodeLabel(n, d)}
            aria-expanded={entity ? n.id === selected : undefined}
            transform={`translate(${p.x} ${p.y})`}
            opacity={on ? 1 : 0.25}
            onPointerEnter={() => setHover(n.id)}
            onPointerLeave={() => setHover((h) => (h === n.id ? null : h))}
            onFocus={(e) => {
              setFocused(n.id);
              setStop(n.id);
              let visible = true;
              try {
                visible = e.currentTarget.matches(":focus-visible");
              } catch {
                /* older engines: always show it */
              }
              setRing(visible);
            }}
            onBlur={() => setFocused((f) => (f === n.id ? null : f))}
            className="cursor-pointer outline-none"
          >
            {/* A target that's easy to hit, whatever the zoom. */}
            <circle r={hitRadius(r, k)} fill="transparent" />
            {n.id === focused && ring ? <circle r={r + 4 / k} fill="none" stroke="var(--color-focus)" strokeWidth={2.5} vectorEffect="non-scaling-stroke" /> : null}
            {path ? (
              <path d={path} fill={KIND_COLOR[n.kind]} stroke={outline} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
            ) : (
              <circle r={r} fill={KIND_COLOR.note} stroke={outline} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
            )}
            {showLabel && n.id !== hover && n.id !== focused ? (
              <text y={r + 12 / k} textAnchor="middle" fontSize={11.5 / k} fill="var(--color-ink)" style={{ paintOrder: "stroke", stroke: "var(--color-canvas)", strokeWidth: 3 / k }}>
                {(n.label || "Untitled").slice(0, 40)}
              </text>
            ) : null}
          </g>
        );
      }),
    [nodes, positions, deg, k, near, searching, matches, labelled, selected, tabStop, hover, focused, ring],
  );

  // The hovered or focused node's name and what it does, next to it.
  const tipId = hover ?? focused;
  const tip = tipId ? byId.get(tipId) : null;
  const tipAt = tipId && positions.get(tipId) ? toScreen(t, positions.get(tipId)!) : null;
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
  const laidOut = positions.size > 0;
  // A graph with hardly anything in it: say how it fills up.
  const sparse = noteCount < 3 ? "Your graph grows as you write. Notes show up here, and lines join the ones that link to each other." : !edges.length ? "None of these notes link to each other yet. Type [[ in a note to link another one, and a line joins them here." : null;
  const closePicked = () => {
    const id = selected;
    setSelected(null);
    if (id) nodeEls.current.get(id)?.focus();
  };

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={wrap}
        role="application"
        aria-roledescription="graph"
        aria-label={`Graph of ${noteCount} notes and ${nodes.length - noteCount} people, projects and topics. Arrow keys move between them, Enter opens a note or shows an entity's notes, Shift and the arrow keys pan, plus and minus zoom, 0 fits. The List view shows the same graph as text.`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
        className="absolute inset-0 cursor-grab touch-none select-none overflow-hidden outline-none active:cursor-grabbing"
      >
        <svg width="100%" height="100%" className="block">
          <g transform={`translate(${t.x} ${t.y}) scale(${k})`}>
            <g aria-hidden>{edgeLayer}</g>
            {nodeLayer}
          </g>
        </svg>
      </div>
      {!laidOut ? (
        <p role="status" className="pointer-events-none absolute inset-0 m-auto h-fit text-center text-sm text-muted">
          Laying out the graph…
        </p>
      ) : null}
      {laidOut && sparse ? <p className="pointer-events-none absolute left-3 top-3 z-10 max-w-[min(340px,calc(100%-80px))] rounded-control bg-[var(--glass-hover)] px-3 py-2 text-[12.5px] leading-snug text-muted">{sparse}</p> : null}
      {tip && tipAt ? (
        <div role="tooltip" className="ui-pop pointer-events-none absolute z-10 max-w-[240px] -translate-x-1/2 rounded-control px-2.5 py-1.5 text-[12.5px]" style={{ left: tipAt.x, top: tipAt.y + 16 }}>
          <span className="font-medium text-heading">{tip.label || "Untitled"}</span>
          <span className="block text-[11.5px] text-muted">{tip.kind === "note" ? (tipId === focused && !hover ? "Enter opens it" : "Click to open") : `${KIND_LABEL[tip.kind]} · ${tipId === focused && !hover ? "Enter shows its notes" : "Click for its notes"}`}</span>
        </div>
      ) : null}
      {picked ? (
        <section aria-label={picked.label} className="ui-pop absolute bottom-3 left-3 z-10 w-[min(300px,calc(100%-24px))] rounded-panel p-3">
          <div className="flex items-start gap-2">
            <span className="mt-1">
              <KindGlyph kind={picked.kind} />
            </span>
            <h2 className="min-w-0 flex-1 text-[14px] font-semibold text-heading">
              {picked.label} <span className="text-[12px] font-normal text-faint">{KIND_LABEL[picked.kind]}</span>
            </h2>
            <IconButton label="Close" onClick={closePicked} className="!h-7 !w-7 -mr-1 -mt-1">
              <X size={14} aria-hidden />
            </IconButton>
          </div>
          <ul className="mt-2 max-h-48 space-y-0.5 overflow-y-auto">
            {pickedNotes.map((n) => (
              <li key={n.id}>
                <AppLink href={`/d/${n.id}`} className="flex items-center gap-1.5 rounded-chip px-1.5 py-1 text-[13px] hover:bg-accent-soft">
                  <FileText size={13} aria-hidden className="flex-none text-muted" />
                  <span className="truncate">{n.label || "Untitled"}</span>
                </AppLink>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <div role="group" aria-label="Zoom" className="ui-pop absolute right-3 top-3 z-10 flex flex-col gap-0.5 rounded-panel p-1">
        <IconButton label="Zoom in" onClick={() => zoomBy(1.25)}>
          <ZoomIn size={15} aria-hidden />
        </IconButton>
        <IconButton label="Zoom out" onClick={() => zoomBy(0.8)}>
          <ZoomOut size={15} aria-hidden />
        </IconButton>
        <IconButton label="Fit to screen" onClick={refit}>
          <Maximize size={15} aria-hidden />
        </IconButton>
      </div>
    </div>
  );
}
