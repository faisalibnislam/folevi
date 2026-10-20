"use client";

// Present and Follow a path: walking through the chart without changing it.
//
//   Present           full canvas, one shape at a time from a start terminator (or the selected shape, or
//                     "Present from here"). → ↓ Space Enter go on along the one way out; at a decision 1, 2…
//                     (or a click on a numbered branch, its connector or its shape) choose; ← ↑ go back;
//                     Home starts again; Esc ends. The current shape and the connector that led to it are
//                     lit, the ways on half lit, the rest dimmed; the view glides to keep them in sight.
//   Follow a path     pick a start and an end (or "Highlight paths from here" on a shape): every route between
//                     them is found (flowchartPaths.ts) and shown one at a time, or all together; a bar lists
//                     the steps. "Present this path" walks it.
//
// Nothing here edits the chart: while a walk runs this interaction comes first and keeps every press, key,
// double-click and right-click from reaching the editing interactions (a drag still pans; pinch still zooms).
// Dimming is a scoped style rule on the data-fc-node / data-fc-edge attributes the layers already draw, so
// it works for every shape and connector whatever draws them.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Play, Route } from "lucide-react";
import type { MenuItem } from "@/components/ui/Menu";
import {
  flowGraph,
  flowStart,
  pathsBetween,
  pathsFrom,
  pathsUnion,
  type FlowGraph,
  type FlowNode,
  type FlowPath,
  type FlowStep,
  type Pt,
} from "../schema";
import { NO_SELECTION, boxOf } from "../ops";
import { MAX_K, MIN_K, clamp } from "../controller/useViewport";
import type { FlowController, Interaction, View } from "../controller/types";
import { PathBar, PickBar, PresentBar, type WalkStep } from "../chrome/WalkBar";
import "../walk.css";

type Trail = { node: string; via: string | null }[];

export type Walk =
  | { kind: "present"; trail: Trail; path: FlowPath | null; ownFull: boolean }
  | { kind: "pick"; from: string | null; ownFull: boolean }
  | {
      kind: "paths";
      from: string;
      to: string | null;
      paths: FlowPath[];
      index: number;
      all: boolean;
      ownFull: boolean;
    };

/** Shapes and connectors to light: fully (`on`) or half (`near`); everything else is dimmed. */
export interface WalkLight {
  on: { nodes: string[]; edges: string[] };
  near: { nodes: string[]; edges: string[] };
  /** Shapes with a ring (the current one, a path's two ends). */
  ring: string[];
}

/** Room the walk's bar takes at the bottom of the canvas (until it's drawn), and a margin around what's shown. */
const BAR = 104;
const MARGIN = 40;

/** The point a share `t` (0…1) of the way along a polyline. */
function along(pts: readonly Pt[], t: number): Pt | null {
  if (!pts.length) return null;
  const lens = pts.slice(1).map((p, i) => Math.hypot(p.x - pts[i]!.x, p.y - pts[i]!.y));
  let left = lens.reduce((a, b) => a + b, 0) * t;
  for (let i = 0; i < lens.length; i++) {
    if (left <= lens[i]! || i === lens.length - 1) {
      const f = lens[i]! ? Math.min(1, left / lens[i]!) : 0;
      return {
        x: pts[i]!.x + (pts[i + 1]!.x - pts[i]!.x) * f,
        y: pts[i]!.y + (pts[i + 1]!.y - pts[i]!.y) * f,
      };
    }
    left -= lens[i]!;
  }
  return pts[0]!;
}

const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** The ways on from the walk's current shape (only the path's next step when walking a path). */
export function waysOn(graph: FlowGraph, walk: Extract<Walk, { kind: "present" }>): FlowStep[] {
  const at = walk.trail[walk.trail.length - 1]!.node;
  const all = graph.out.get(at) ?? [];
  if (!walk.path) return all;
  const next = walk.path.edges[walk.trail.length - 1];
  return next ? all.filter((s) => s.edge.id === next) : [];
}

/** What a walk lights. */
export function walkLight(graph: FlowGraph, walk: Walk): WalkLight {
  if (walk.kind === "present") {
    const cur = walk.trail[walk.trail.length - 1]!;
    const ways = waysOn(graph, walk);
    return {
      on: { nodes: [cur.node], edges: cur.via ? [cur.via] : [] },
      near: {
        nodes: [...walk.trail.map((t) => t.node), ...ways.map((s) => s.to)],
        edges: [
          ...walk.trail.flatMap((t) => (t.via ? [t.via] : [])),
          ...ways.map((s) => s.edge.id),
        ],
      },
      ring: [cur.node],
    };
  }
  if (walk.kind === "paths") {
    const shown = walk.all ? walk.paths : walk.paths.slice(walk.index, walk.index + 1);
    const u = pathsUnion(shown);
    return {
      on: { nodes: [...new Set([walk.from, ...u.nodes])], edges: [...u.edges] },
      near: { nodes: [], edges: [] },
      ring: [walk.from, ...(walk.to ? [walk.to] : [])],
    };
  }
  return {
    on: { nodes: [], edges: [] },
    near: { nodes: [], edges: [] },
    ring: walk.from ? [walk.from] : [],
  };
}

/** The scoped style rules that dim everything but what the walk lights (ids are [A-Za-z0-9_-] only). */
export function walkCss(scope: string, light: WalkLight): string {
  const safe = (ids: readonly string[]) =>
    [...new Set(ids)].filter((id) => /^[A-Za-z0-9_-]{1,64}$/.test(id));
  // Doubled class: outranks the dimming rule in walk.css.
  const sel = (attr: string, ids: readonly string[]) =>
    safe(ids).map((id) => `.fc-canvas.fc-canvas[data-fc-walk="${scope}"] [${attr}="${id}"]`);
  const rules: string[] = [];
  const near = [...sel("data-fc-node", light.near.nodes), ...sel("data-fc-edge", light.near.edges)];
  if (near.length) rules.push(`${near.join(",")}{opacity:var(--fc-walk-near)}`);
  const on = [...sel("data-fc-node", light.on.nodes), ...sel("data-fc-edge", light.on.edges)];
  if (on.length) rules.push(`${on.join(",")}{opacity:1}`);
  const lines = sel("data-fc-edge", light.on.edges);
  if (lines.length)
    rules.push(
      `${lines.join(",")}{--fc-ec:var(--fc-select)!important}`,
      `${lines.map((s) => `${s} .fc-edge-line`).join(",")}{stroke-width:max(2.5px,var(--fc-ew,1.5px))}`,
    );
  return rules.join("\n");
}

export function useWalkthrough(ctrl: FlowController) {
  const { docRef, setSel, toggleFull, viewRef, setView, wrapRef, uid } = ctrl;
  const [walk, setWalkState] = useState<Walk | null>(null);
  const walkRef = useRef(walk);
  const setWalk = useCallback((w: Walk | null) => {
    walkRef.current = w;
    setWalkState(w);
  }, []);
  const on = walk !== null;
  const doc = ctrl.doc;
  const graph = useMemo(() => (on ? flowGraph(doc) : null), [on, doc]);

  // ------------------------------------------------------------------ the view glides along
  const anim = useRef<number | null>(null);
  const stopGlide = () => {
    if (anim.current !== null) cancelAnimationFrame(anim.current);
    anim.current = null;
  };
  const glide = (to: View) => {
    stopGlide();
    const from = viewRef.current;
    if (
      reducedMotion() ||
      (Math.abs(from.x - to.x) < 1 &&
        Math.abs(from.y - to.y) < 1 &&
        Math.abs(from.k - to.k) < 0.005)
    ) {
      setView(to);
      return;
    }
    const t0 = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / 420);
      const e = ease(t);
      setView({
        x: from.x + (to.x - from.x) * e,
        y: from.y + (to.y - from.y) * e,
        k: from.k + (to.k - from.k) * e,
      });
      anim.current = t < 1 ? requestAnimationFrame(step) : null;
    };
    anim.current = requestAnimationFrame(step);
  };
  useEffect(() => stopGlide, []);

  /** Brings the shapes into view (centred on them), unless they're comfortably in view already. */
  const follow = (ids: readonly string[], opts: { always?: boolean } = {}) => {
    const el = wrapRef.current;
    const byId = new Map(docRef.current.nodes.map((n) => [n.id, n]));
    const box = boxOf(ids.map((id) => byId.get(id)).filter((n): n is FlowNode => Boolean(n)));
    if (!el || !box) return;
    const w = el.clientWidth;
    const h = el.clientHeight;
    // Room above the walk's bar (its height as drawn: it wraps onto more rows on a phone).
    const bar = el.querySelector(".fc-walk-bar")?.getBoundingClientRect().height;
    const below = bar ? bar + 24 : BAR;
    // In the Mac app's full canvas the strip along the top drags the window (canvas/canvas.css): keep clear of it.
    const top = ctrl.full && document.documentElement.dataset.desktop === "mac" ? 64 : MARGIN;
    const room = {
      x: MARGIN,
      y: top,
      w: Math.max(80, w - MARGIN * 2),
      h: Math.max(80, h - below - top - MARGIN),
    };
    const v = viewRef.current;
    const sx = box.x * v.k + v.x;
    const sy = box.y * v.k + v.y;
    const inView =
      sx >= room.x &&
      sy >= room.y &&
      sx + box.w * v.k <= room.x + room.w &&
      sy + box.h * v.k <= room.y + room.h;
    if (inView && !opts.always && v.k >= 0.45) return;
    const fitK = Math.min(room.w / Math.max(1, box.w), room.h / Math.max(1, box.h));
    const k = clamp(
      opts.always || box.w * v.k > room.w || box.h * v.k > room.h || v.k < 0.45
        ? Math.min(fitK, 1.15)
        : v.k,
      MIN_K,
      MAX_K,
    );
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    glide({ k, x: room.x + room.w / 2 - cx * k, y: room.y + room.h / 2 - cy * k });
  };

  // Follow the current shape (and the ways on) a frame or two after it changes, once full canvas has its size.
  const current = walk?.kind === "present" ? walk.trail[walk.trail.length - 1]!.node : null;
  const ways = useMemo(
    () => (walk?.kind === "present" && graph ? waysOn(graph, walk) : []),
    [walk, graph],
  );
  const shownPath =
    walk?.kind === "paths"
      ? walk.all
        ? walk.paths
        : walk.paths.slice(walk.index, walk.index + 1)
      : null;
  const followKey =
    walk?.kind === "present"
      ? `p:${current}`
      : walk?.kind === "paths"
        ? `r:${walk.from}:${walk.to}:${walk.all ? "all" : walk.index}`
        : walk?.kind === "pick"
          ? "k"
          : "";
  const first = useRef(true);
  useEffect(() => {
    if (!followKey) {
      first.current = true;
      return;
    }
    const w = walkRef.current;
    const g = graph;
    if (!w || !g) return;
    // Picking a path's ends: the whole chart in sight, clear of the bar.
    const ids =
      w.kind === "present"
        ? [current!, ...waysOn(g, w).map((s) => s.to)]
        : w.kind === "paths"
          ? [...pathsUnion(w.all ? w.paths : w.paths.slice(w.index, w.index + 1)).nodes, w.from]
          : docRef.current.nodes.map((n) => n.id);
    const always = first.current && w.kind !== "pick";
    first.current = false;
    let raf = requestAnimationFrame(() => {
      raf = requestAnimationFrame(() => follow(ids, { always }));
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [followKey, ctrl.full]);

  // A shape the walk stands on was deleted (by someone else, or undo elsewhere): the walk ends.
  useEffect(() => {
    const w = walkRef.current;
    if (!w) return;
    const ids = new Set(doc.nodes.map((n) => n.id));
    const gone =
      w.kind === "present"
        ? w.trail.some((t) => !ids.has(t.node))
        : w.kind === "paths"
          ? !ids.has(w.from) || (w.to !== null && !ids.has(w.to))
          : w.from !== null && !ids.has(w.from);
    if (gone) end();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc]);

  // ------------------------------------------------------------------ starting and ending
  /** The keyboard back on the canvas (from the walk's bar too), so the arrow keys move the walk. */
  const refocus = () => wrapRef.current?.focus({ preventScroll: true });
  /** Opens full canvas for the walk; true when it did (the walk then closes it again). */
  const own = () => {
    if (ctrl.full) return false;
    toggleFull(true);
    return true;
  };

  /** Starts presenting at a shape (the selected one, or where the flow starts), optionally along a path. */
  const present = (from?: string | null, path: FlowPath | null = null) => {
    const fc = docRef.current;
    const prev = walkRef.current;
    const single = ctrl.selRef.current.nodes.length === 1 ? ctrl.selRef.current.nodes[0] : null;
    const start = path ? path.nodes[0]! : flowStart(fc, from ?? single);
    if (!start) return;
    ctrl.setEditing(null);
    setSel(NO_SELECTION);
    first.current = true;
    setWalk({
      kind: "present",
      trail: [{ node: start, via: null }],
      path,
      ownFull: prev ? prev.ownFull : own(),
    });
    refocus();
  };

  /** Follow a path: pick its start (and end) on the canvas; with `from`, starts from that shape. */
  const pick = (from: string | null = null) => {
    ctrl.setEditing(null);
    setSel(NO_SELECTION);
    first.current = true;
    const prev = walkRef.current;
    setWalk({ kind: "pick", from, ownFull: prev ? prev.ownFull : false });
    refocus();
  };

  /** Shows the paths from `from` to `to`, or to every end when `to` is null. */
  const showPaths = (from: string, to: string | null) => {
    const fc = docRef.current;
    const paths = to ? pathsBetween(fc, from, to) : pathsFrom(fc, from);
    ctrl.setEditing(null);
    setSel(NO_SELECTION);
    first.current = true;
    const prev = walkRef.current;
    setWalk({
      kind: "paths",
      from,
      to,
      paths,
      index: 0,
      all: !to && paths.length > 1,
      ownFull: prev ? prev.ownFull : false,
    });
    refocus();
  };

  const end = () => {
    const w = walkRef.current;
    stopGlide();
    setWalk(null);
    if (w?.ownFull) toggleFull(false);
    refocus();
  };

  // ------------------------------------------------------------------ moving
  const go = (step: FlowStep) => {
    const w = walkRef.current;
    if (w?.kind !== "present") return;
    setWalk({ ...w, trail: [...w.trail, { node: step.to, via: step.edge.id }] });
  };
  const forward = () => {
    const w = walkRef.current;
    if (w?.kind !== "present" || !graph) return;
    const list = waysOn(graph, w);
    if (list.length === 1) go(list[0]!);
  };
  const choose = (i: number) => {
    const w = walkRef.current;
    if (w?.kind !== "present" || !graph) return;
    const s = waysOn(graph, w)[i];
    if (s) go(s);
  };
  const back = (to?: number) => {
    const w = walkRef.current;
    if (w?.kind !== "present" || w.trail.length < 2) return;
    setWalk({ ...w, trail: w.trail.slice(0, to === undefined ? -1 : Math.max(1, to + 1)) });
  };
  const restart = () => {
    const w = walkRef.current;
    if (w?.kind === "present") setWalk({ ...w, trail: w.trail.slice(0, 1) });
  };
  const showPath = (index: number | "all") => {
    const w = walkRef.current;
    if (w?.kind !== "paths" || !w.paths.length) return;
    setWalk(
      index === "all"
        ? { ...w, all: true }
        : { ...w, all: false, index: (index + w.paths.length) % w.paths.length },
    );
  };

  // ------------------------------------------------------------------ pointer and keys
  const tap = (target: Element) => {
    const w = walkRef.current;
    if (!w || !graph) return;
    const nodeId = target.closest("[data-fc-node]")?.getAttribute("data-fc-node") ?? null;
    const edgeId =
      target.closest("[data-fc-walk-step]")?.getAttribute("data-fc-walk-step") ??
      target.closest("[data-fc-edge]")?.getAttribute("data-fc-edge") ??
      null;
    if (w.kind === "present") {
      const list = waysOn(graph, w);
      const step = list.find((s) => s.edge.id === edgeId) ?? list.find((s) => s.to === nodeId);
      if (step) return go(step);
      const cur = w.trail[w.trail.length - 1]!.node;
      if (nodeId === cur) return forward();
      const earlier = w.trail.findIndex((t) => t.node === nodeId);
      if (earlier >= 0) back(earlier);
      return;
    }
    if (w.kind === "pick" && nodeId) {
      if (!w.from) setWalk({ ...w, from: nodeId });
      else if (nodeId === w.from) setWalk({ ...w, from: null });
      else showPaths(w.from, nodeId);
    }
  };

  const menuNode = useRef<string | null>(null);
  const interaction: Interaction = {
    handles: "[data-fc-walk-step]",
    press: ({ e, target }) => {
      if (!walkRef.current) return null;
      e.preventDefault();
      stopGlide();
      const sx = e.clientX;
      const sy = e.clientY;
      const start = viewRef.current;
      let moved = false;
      return {
        move: (m) => {
          if (!moved && Math.hypot(m.clientX - sx, m.clientY - sy) < 5) return;
          moved = true;
          setView({ ...start, x: start.x + (m.clientX - sx), y: start.y + (m.clientY - sy) });
        },
        end: () => {
          if (!moved) tap(target);
        },
      };
    },
    doubleClick: () => Boolean(walkRef.current),
    contextMenu: ({ target }) => {
      if (walkRef.current) return true;
      // Not walking: remember the shape, for this module's entries in its menu (menuItems), and pass on.
      menuNode.current = target.closest("[data-fc-node]")?.getAttribute("data-fc-node") ?? null;
      return false;
    },
    keyDown: (e) => {
      const w = walkRef.current;
      if (!w) return false;
      const mod = e.metaKey || e.ctrlKey;
      if (e.key === "Tab") return false;
      if (mod && e.shiftKey && e.key.toLowerCase() === "f")
        return ctrl.fullKey(e, { escape: false });
      if (e.key === "Escape") {
        if (w.kind === "pick" && w.from) setWalk({ ...w, from: null });
        else end();
        return true;
      }
      if (!mod && (e.key === "+" || e.key === "=")) ctrl.zoomBy(1.2);
      else if (!mod && (e.key === "-" || e.key === "_")) ctrl.zoomBy(1 / 1.2);
      else if (w.kind === "present") {
        if (["ArrowRight", "ArrowDown", " ", "Enter", "PageDown"].includes(e.key)) forward();
        else if (["ArrowLeft", "ArrowUp", "Backspace", "PageUp"].includes(e.key)) back();
        else if (e.key === "Home") restart();
        else if (/^[1-9]$/.test(e.key)) choose(Number(e.key) - 1);
      } else if (w.kind === "paths") {
        if (e.key === "ArrowRight" || e.key === "ArrowDown") showPath(w.all ? 0 : w.index + 1);
        else if (e.key === "ArrowLeft" || e.key === "ArrowUp")
          showPath(w.all ? w.paths.length - 1 : w.index - 1);
        else if (e.key.toLowerCase() === "a" && !mod) showPath("all");
        else if (e.key === "Enter" && w.paths.length) present(null, w.paths[w.all ? 0 : w.index]!);
      }
      // Nothing edits the chart while walking through it.
      return true;
    },
  };

  // ------------------------------------------------------------------ drawing
  const byId = ctrl.byId;
  const k = ctrl.view.k;
  const light = walk && graph ? walkLight(graph, walk) : null;
  const css = light ? walkCss(uid, light) : "";
  const routedById = useMemo(() => new Map(ctrl.routed.map((r) => [r.edge.id, r])), [ctrl.routed]);

  /** Where a way on gets its number: on its label, or along its connector. */
  const chipAt = (s: FlowStep): Pt | null => {
    const r = routedById.get(s.edge.id);
    if (!r) return null;
    const l = r.labels?.[0];
    if (l) return { x: l.x + l.w + 4 / k, y: l.cy };
    return along(r.points, 0.55);
  };

  const layer = walk ? (
    <g className="fc-walk-layer" aria-hidden>
      {light?.ring.map((id, i) => {
        const n = byId.get(id);
        if (!n) return null;
        const pad = 6 / k;
        return (
          <rect
            key={`${id}-${i}`}
            className="fc-walk-ring"
            data-kind={walk.kind === "present" ? "current" : i === 0 ? "start" : "end"}
            x={n.x - pad}
            y={n.y - pad}
            width={n.w + pad * 2}
            height={n.h + pad * 2}
            rx={12 / Math.max(k, 0.5)}
          />
        );
      })}
      {walk.kind === "present" && ways.length > 1
        ? ways.map((s, i) => {
            const p = chipAt(s);
            if (!p) return null;
            const r = 11 / k;
            return (
              <g
                key={s.edge.id}
                className="fc-walk-chip"
                data-fc-walk-step={s.edge.id}
                transform={`translate(${p.x} ${p.y})`}
              >
                <circle className="fc-walk-chip-hit" r={22 / k} />
                <circle className="fc-walk-chip-dot" r={r} />
                <text
                  className="fc-walk-chip-num"
                  y={4.2 / k}
                  textAnchor="middle"
                  fontSize={12 / k}
                >
                  {i + 1}
                </text>
              </g>
            );
          })
        : null}
    </g>
  ) : null;

  const nodeName = (id: string) => {
    const n = byId.get(id);
    return n ? n.text.trim().replace(/\s+/g, " ") || "Untitled shape" : "";
  };
  const stepOf = (s: FlowStep): WalkStep => ({ id: s.edge.id, label: s.label, to: nodeName(s.to) });

  let element: React.ReactNode = null;
  if (walk?.kind === "present" && current) {
    element = (
      <PresentBar
        step={walk.trail.length}
        name={nodeName(current)}
        ways={ways.map(stepOf)}
        onPath={Boolean(walk.path)}
        canBack={walk.trail.length > 1}
        onBack={() => back()}
        onNext={forward}
        onChoose={choose}
        onRestart={restart}
        onEnd={end}
        refocus={refocus}
      />
    );
  } else if (walk?.kind === "pick") {
    element = (
      <PickBar
        from={walk.from ? nodeName(walk.from) : null}
        onEvery={walk.from ? () => showPaths(walk.from!, null) : null}
        onEnd={end}
        refocus={refocus}
      />
    );
  } else if (walk?.kind === "paths") {
    const path = shownPath && shownPath.length === 1 ? shownPath[0]! : null;
    element = (
      <PathBar
        from={nodeName(walk.from)}
        to={walk.to ? nodeName(walk.to) : null}
        count={walk.paths.length}
        index={walk.index}
        all={walk.all}
        steps={
          path
            ? path.nodes.map((id, i) => ({
                id,
                name: nodeName(id),
                label:
                  i > 0
                    ? (graph?.out
                        .get(path.nodes[i - 1]!)
                        ?.find((s) => s.edge.id === path.edges[i - 1])?.label ?? "")
                    : "",
              }))
            : []
        }
        onPath={showPath}
        onStep={(id) => follow([id], { always: false })}
        onPresent={path ? () => present(null, path) : null}
        onPick={() => pick(walk.from)}
        onEnd={end}
        refocus={refocus}
      />
    );
  }

  const html = walk ? (
    <>
      <style>{css}</style>
      {element}
    </>
  ) : null;

  /** Entries for the right-click menu of the shape just right-clicked. */
  const menuItems = (): MenuItem[] => {
    const id = menuNode.current;
    return id ? itemsFor(id) : [];
  };
  const itemsFor = (id: string): MenuItem[] => [
    { label: "Present from here", icon: <Play size={14} />, onSelect: () => present(id) },
    {
      label: "Highlight paths from here",
      icon: <Route size={14} />,
      onSelect: () => showPaths(id, null),
    },
    { label: "Highlight paths to…", icon: <Route size={14} />, onSelect: () => pick(id) },
  ];

  return {
    interaction,
    /** World-coordinate drawing (rings, numbered branches), above the scene. */
    layer,
    /** The walk's bar and its style rules (HTML, next to the other chrome). */
    element: html,
    /** Spread on the canvas: scopes the dimming and hides the editing chrome while a walk runs. */
    canvasProps: walk ? { "data-fc-walk": uid, "data-fc-walk-kind": walk.kind } : {},
    active: on,
    present,
    pick,
    showPaths,
    end,
    menuItems,
  };
}

export type Walkthrough = ReturnType<typeof useWalkthrough>;
