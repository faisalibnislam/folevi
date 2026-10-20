"use client";

// Frames and swimlanes on the canvas (the edits themselves are pure, in packages/editor-schema's
// flowchartContainers.ts; membership is kept up to date on every commit by the controller):
//
//   Pointer   press a frame's title or border, a pool's title band or a lane's header to select it; drag to
//             move it with everything inside (a frame dropped over another frame or a lane goes into it);
//             drag a selected frame's handles to resize it, a lane's edge to resize the lane (its shapes
//             reflow to stay inside), the pool's far end to make it longer or shorter; double-click a title
//             to rename; right-click for the menu. While shapes are dragged, the frame or lane they'd land in
//             is highlighted.
//   Keyboard  Tab reaches pools, their lanes and frames · Enter (or typing) renames · ⌫ deletes (asking
//             whether to keep what's inside) · arrows move it (⇧ more) · ⌥ arrows across a lane reorder it
//             · Esc deselects · ⌥⌘G frames the selected shapes (or adds a frame)
//
// Everything is one undo step: a drag commits once, from where it started.
import { useCallback, useRef, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, BoxSelect, Frame, Pencil, Plus, Trash2 } from "lucide-react";
import { ContextMenu, type MenuItem } from "@/components/ui/Menu";
import { useMediaQuery } from "@/lib/hooks/useMediaQuery";
import { haptic } from "@/lib/nativeApp";
import {
  FLOWCHART_FRAME_TITLE,
  FLOWCHART_GRID,
  FLOWCHART_MIN_FRAME,
  FLOWCHART_POOL_TITLE,
  addFrame,
  addLane,
  addPool,
  boxAt,
  boxContents,
  boxKind,
  boxRect,
  findLane,
  frameSelection,
  laneBoxes,
  moveBoxes,
  moveLane,
  poolRect,
  removeBoxes,
  renameBox,
  resizeFrame,
  resizeLane,
  resizePool,
  setBoxColor,
  type FlowchartData,
  type FlowColor,
  type FlowPoolOrient,
  type Pt,
  type Rect,
} from "../schema";
import { NO_SELECTION, snap, type ResizeHandle } from "../ops";
import { clamp } from "../controller/useViewport";
import { ContainerBar, ContainerTools } from "../chrome/ContainerBar";
import type { FlowController, Gesture, Interaction } from "../controller/types";

const HANDLES: ResizeHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
const NOUN = { frame: "frame", pool: "swimlanes", lane: "lane" } as const;

export type Containers = ReturnType<typeof useContainers>;

function titleOf(fc: FlowchartData, id: string): string | null {
  const f = (fc.frames ?? []).find((x) => x.id === id);
  if (f) return f.title;
  const p = (fc.pools ?? []).find((x) => x.id === id);
  if (p) return p.title;
  return findLane(fc, id)?.lane.title ?? null;
}

/** Where a container's title is written (world coordinates), for the rename box. */
function titleBox(fc: FlowchartData, id: string): Rect | null {
  const f = (fc.frames ?? []).find((x) => x.id === id);
  if (f) return { x: f.x + 8, y: f.y + 4, w: Math.max(96, Math.min(f.w - 16, 360)), h: FLOWCHART_FRAME_TITLE - 8 };
  const p = (fc.pools ?? []).find((x) => x.id === id);
  if (p) {
    const r = poolRect(p);
    return { x: r.x + 8, y: r.y + 5, w: Math.max(96, Math.min(r.w - 16, 360)), h: FLOWCHART_POOL_TITLE - 10 };
  }
  const found = findLane(fc, id);
  if (!found) return null;
  const h = laneBoxes(found.pool)[found.index]!.header;
  return found.pool.orient === "rows" ? { x: h.x + 6, y: h.y + 8, w: Math.max(72, h.w - 12), h: 24 } : { x: h.x + 6, y: h.y + (h.h - 24) / 2, w: Math.max(72, h.w - 12), h: 24 };
}

export function useContainers(ctrl: FlowController) {
  const { doc, docRef, setLive, commit, selRef, setSel, toWorld, view, viewRef, svgRef, wrapRef, full, cardRef } = ctrl;
  const coarse = useMediaQuery("(pointer: coarse)");
  const [renaming, setRenaming] = useState<{ id: string; value: string; before: FlowchartData; typed: boolean } | null>(null);
  const renamingRef = useRef(renaming);
  renamingRef.current = renaming;
  /** The right-click menu, or (`ask`) the question of whether to keep what's inside. */
  const [menu, setMenu] = useState<{ at: Pt; id: string; ask?: boolean } | null>(null);
  /** The frame or lane a dragged frame would go into. */
  const [dropTargetState, setDropTargetState] = useState<string | null>(null);
  const dropTarget = useRef<string | null>(null);
  const setDropTarget = (id: string | null) => {
    dropTarget.current = id;
    setDropTargetState(id);
  };
  /** The chart when a shape was pressed, so the frame or lane it would land in shows once it moves. */
  const nodePress = useRef<FlowchartData | null>(null);

  const selected = ctrl.sel.boxes ?? [];
  const selectBox = useCallback((id: string) => setSel({ nodes: [], edges: [], boxes: [id] }), [setSel]);

  /** Focusing a frame, pool or lane (Tab) selects it. Stable, for the memoised layer. */
  const onFocusBox = useCallback(
    (id: string) => {
      if (ctrl.dragRef.current) return;
      const s = selRef.current;
      if (!(s.boxes ?? []).includes(id) || s.nodes.length || s.edges.length) setSel({ nodes: [], edges: [], boxes: [id] });
    },
    [ctrl.dragRef, selRef, setSel],
  );

  const toClient = (p: Pt): Pt => {
    const r = svgRef.current!.getBoundingClientRect();
    const v = viewRef.current;
    return { x: r.left + v.x + p.x * v.k, y: r.top + v.y + p.y * v.k };
  };

  /** Brings a container into view (zooming out if it doesn't fit), unless it is already in view. */
  const reveal = (id: string) => {
    const r = boxRect(docRef.current, id);
    if (!r) return;
    const v = viewRef.current;
    const { width: w, height: h } = ctrl;
    const top = 52;
    const sx = r.x * v.k + v.x;
    const sy = r.y * v.k + v.y;
    if (sx >= 0 && sy >= top && sx + r.w * v.k <= w && sy + r.h * v.k <= h) return;
    const k = clamp(Math.min(v.k, (w - 80) / r.w, (h - top - 80) / r.h), 0.2, 2.5);
    ctrl.setView({ k, x: w / 2 - (r.x + r.w / 2) * k, y: top + (h - top) / 2 - (r.y + r.h / 2) * k });
  };

  // ---------------------------------------------------------------------------------------- renaming

  const startRename = (id: string, typed?: string) => {
    const fc = docRef.current;
    const title = titleOf(fc, id);
    if (title === null) return;
    setMenu(null);
    selectBox(id);
    const value = typed ?? title;
    if (typed !== undefined) setLive(renameBox(fc, id, value));
    setRenaming({ id, value, before: fc, typed: typed !== undefined });
  };

  const finishRename = (keep = true, refocus = true) => {
    const r = renamingRef.current;
    if (!r) return;
    renamingRef.current = null;
    setRenaming(null);
    const next = renameBox(r.before, r.id, r.value);
    if (keep && titleOf(next, r.id) !== titleOf(r.before, r.id)) commit(next, { before: r.before });
    else setLive(r.before);
    if (refocus) wrapRef.current?.focus({ preventScroll: true });
  };

  const onRenameChange = (value: string) => {
    const r = renamingRef.current;
    if (!r) return;
    const next = { ...r, value };
    renamingRef.current = next;
    setRenaming(next);
    setLive(renameBox(r.before, r.id, value));
  };

  // ---------------------------------------------------------------------------------------- edits

  const done = (next: FlowchartData, selectId?: string) => {
    if (next !== docRef.current) commit(next);
    setMenu(null);
    if (selectId) selectBox(selectId);
    else setSel(NO_SELECTION);
    ctrl.focusCanvas();
  };

  const remove = (id: string, keep: boolean) => done(removeBoxes(docRef.current, [id], keep));

  /** Deletes a container; when something is inside, asks first whether to keep it. */
  const askRemove = (id: string, at?: Pt) => {
    const fc = docRef.current;
    const c = boxContents(fc, id);
    if (!c.nodes.size && !c.frames.size) return remove(id, true);
    const r = boxRect(fc, id);
    if (!r) return;
    setMenu({ at: at ?? toClient({ x: r.x + 16, y: r.y + 16 }), id, ask: true });
  };

  /** Frames the selected shapes (and frames), or adds an empty frame in the middle of the view; then names it. */
  const frameOrAdd = () => {
    const fc = docRef.current;
    const s = selRef.current;
    const ids = [...s.nodes, ...(s.boxes ?? []).filter((id) => boxKind(fc, id) === "frame")];
    const res = ids.length ? frameSelection(fc, ids) : addFrame(fc, ctrl.viewCenter());
    if (!res) return;
    commit(res.doc);
    reveal(res.id);
    startRename(res.id);
  };

  const addSwimlanes = (orient: FlowPoolOrient) => {
    const res = addPool(docRef.current, ctrl.viewCenter(), orient, 3);
    if (!res) return;
    commit(res.doc);
    reveal(res.id);
    startRename(res.id);
    ctrl.focusCanvas();
  };

  const addLaneAt = (poolId: string, index?: number) => {
    const res = addLane(docRef.current, poolId, index);
    if (!res) return;
    commit(res.doc);
    startRename(res.id);
  };

  const shiftLane = (laneId: string, dir: -1 | 1) => {
    const fc = docRef.current;
    const next = moveLane(fc, laneId, dir);
    if (next !== fc) {
      commit(next);
      haptic("light");
    }
    selectBox(laneId);
  };

  const recolor = (id: string, c: FlowColor) => commit(setBoxColor(docRef.current, id, c));

  // ---------------------------------------------------------------------------------------- gestures

  /** Dragging a frame, or a pool (by its title band or a lane's header), with everything inside. */
  const moveGesture = (id: string, e: React.PointerEvent, at: Pt): Gesture => {
    const before = docRef.current;
    const s = selRef.current;
    if (!(s.boxes ?? []).includes(id) || s.nodes.length || s.edges.length) selectBox(id);
    const kind = boxKind(before, id);
    const anchor = boxRect(before, kind === "lane" ? findLane(before, id)!.pool.id : id)!;
    const sx = e.clientX;
    const sy = e.clientY;
    let moved = false;
    return {
      move: (m) => {
        if (!moved && Math.hypot(m.clientX - sx, m.clientY - sy) < 3) return;
        moved = true;
        const p = toWorld(m.clientX, m.clientY);
        const dx = m.altKey ? p.x - at.x : snap(anchor.x + p.x - at.x) - anchor.x;
        const dy = m.altKey ? p.y - at.y : snap(anchor.y + p.y - at.y) - anchor.y;
        const live = moveBoxes(before, [id], dx, dy);
        setLive(live);
        if (kind === "frame") {
          const f = live.frames.find((x) => x.id === id);
          setDropTarget(f ? boxAt(live, f, id) : null);
        }
      },
      end: () => {
        const into = dropTarget.current;
        setDropTarget(null);
        if (!moved) return;
        commit(docRef.current, { before });
        // On iPhone and iPad, a tap when a frame lands in another frame or a lane.
        if (into) haptic("light");
      },
      cancel: () => {
        setDropTarget(null);
        setLive(before);
      },
    };
  };

  const frameResizeGesture = (id: string, handle: ResizeHandle, at: Pt): Gesture | "handled" => {
    const before = docRef.current;
    const f = before.frames.find((x) => x.id === id);
    if (!f) return "handled";
    return {
      move: (m) => {
        const p = toWorld(m.clientX, m.clientY);
        const dx = p.x - at.x;
        const dy = p.y - at.y;
        let x0 = f.x;
        let y0 = f.y;
        let x1 = f.x + f.w;
        let y1 = f.y + f.h;
        if (handle.includes("w")) x0 = Math.min(snap(x0 + dx), x1 - FLOWCHART_MIN_FRAME.w);
        if (handle.includes("e")) x1 = Math.max(snap(x1 + dx), x0 + FLOWCHART_MIN_FRAME.w);
        if (handle.includes("n")) y0 = Math.min(snap(y0 + dy), y1 - FLOWCHART_MIN_FRAME.h);
        if (handle.includes("s")) y1 = Math.max(snap(y1 + dy), y0 + FLOWCHART_MIN_FRAME.h);
        setLive(resizeFrame(before, id, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }));
      },
      end: () => {
        if (docRef.current !== before) commit(docRef.current, { before });
      },
      cancel: () => setLive(before),
    };
  };

  /** Dragging a lane's far edge (its shapes reflow to stay inside) or a pool's far end. */
  const sizeGesture = (resize: (fc: FlowchartData, d: number) => FlowchartData, rows: boolean, at: Pt): Gesture => {
    const before = docRef.current;
    return {
      move: (m) => {
        const p = toWorld(m.clientX, m.clientY);
        setLive(resize(before, rows ? p.y - at.y : p.x - at.x));
      },
      end: () => {
        if (docRef.current !== before) commit(docRef.current, { before });
      },
      cancel: () => setLive(before),
    };
  };

  // ---------------------------------------------------------------------------------------- the interaction

  const interaction: Interaction = {
    handles: "[data-fc-grab],[data-fc-box-resize],[data-fc-lane-resize],[data-fc-pool-resize]",
    beforePress: () => {
      if (renamingRef.current) finishRename(true, false);
    },
    press: ({ e, target, at }) => {
      // A shape: interactions/move.tsx moves it; remember the chart to show where it would land.
      nodePress.current = target.closest("[data-fc-node]") ? docRef.current : null;
      if (nodePress.current) return null;
      const fc = docRef.current;
      const rz = target.closest("[data-fc-box-resize]");
      if (rz) return frameResizeGesture(rz.getAttribute("data-box")!, rz.getAttribute("data-fc-box-resize") as ResizeHandle, at);
      const lr = target.closest("[data-fc-lane-resize]");
      if (lr) {
        const found = findLane(fc, lr.getAttribute("data-fc-lane-resize")!);
        if (!found) return "handled";
        const size = found.lane.size;
        return sizeGesture((b, d) => resizeLane(b, found.lane.id, size + d), found.pool.orient === "rows", at);
      }
      const pr = target.closest("[data-fc-pool-resize]");
      if (pr) {
        const pool = fc.pools.find((p) => p.id === pr.getAttribute("data-fc-pool-resize"));
        if (!pool) return "handled";
        return sizeGesture((b, d) => resizePool(b, pool.id, pool.length + d), pool.orient !== "rows", at);
      }
      const grab = target.closest("[data-fc-grab]");
      if (!grab) return null;
      setMenu(null);
      return moveGesture(grab.getAttribute("data-fc-grab")!, e, at);
    },
    doubleClick: ({ target }) => {
      const grab = target.closest("[data-fc-grab]");
      if (!grab) return false;
      startRename(grab.getAttribute("data-fc-grab")!);
      return true;
    },
    contextMenu: ({ e, target }) => {
      if (target.closest("[data-fc-node],[data-fc-edge]")) return false;
      const el = target.closest("[data-fc-box]");
      const id = el?.getAttribute("data-fc-box");
      if (!id) return false;
      selectBox(id);
      setMenu({ at: { x: e.clientX, y: e.clientY }, id });
      return true;
    },
    keyDown: (e) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.altKey && e.code === "KeyG") {
        frameOrAdd();
        return true;
      }
      const s = selRef.current;
      const id = s.boxes?.length === 1 && !s.nodes.length && !s.edges.length ? s.boxes[0]! : null;
      const fc = docRef.current;
      const kind = id ? boxKind(fc, id) : null;
      if (!id || !kind || mod) return false;
      if (e.key === "Enter" || e.key === "F2") {
        startRename(id);
        return true;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        askRemove(id);
        return true;
      }
      if (e.key === "Escape") {
        setSel(NO_SELECTION);
        return true;
      }
      const dir = ARROWS[e.key];
      if (dir) {
        if (kind === "lane" && e.altKey) {
          const rows = findLane(fc, id)!.pool.orient === "rows";
          const d = rows ? dir[1] : dir[0];
          if (d) {
            shiftLane(id, d as -1 | 1);
            return true;
          }
        }
        const step = e.shiftKey ? 32 : FLOWCHART_GRID;
        commit(moveBoxes(fc, [id], dir[0] * step, dir[1] * step), { key: `nudge-${id}` });
        return true;
      }
      // Typing on a selected frame or lane renames it.
      if (e.key.length === 1 && e.key !== " " && !e.altKey) {
        startRename(id, e.key);
        return true;
      }
      return false;
    },
    blur: () => setDropTarget(null),
  };

  // ---------------------------------------------------------------------------------------- drawing

  const k = view.k;
  const dragging = ctrl.isDragging();
  const one = selected.length === 1 && !ctrl.sel.nodes.length && !ctrl.sel.edges.length ? selected[0]! : null;
  const oneKind = one ? boxKind(doc, one) : null;
  const hit = (coarse ? 22 : 7) / k;

  // Where dragged shapes would land.
  const targets = new Set<string>();
  if (dropTargetState) targets.add(dropTargetState);
  if (nodePress.current && dragging && doc !== nodePress.current) {
    for (const n of ctrl.selNodes) {
      const t = boxAt(doc, n);
      if (t) targets.add(t);
    }
  }

  const outline = (r: Rect, key: string, cls = "fc-box-sel") => <rect key={key} className={cls} x={r.x - 2 / k} y={r.y - 2 / k} width={r.w + 4 / k} height={r.h + 4 / k} rx={10} />;

  const overlay: React.ReactNode[] = [];
  for (const t of targets) {
    const r = boxRect(doc, t);
    if (r) overlay.push(outline(r, `drop-${t}`, "fc-box-drop"));
  }
  if (one && oneKind && !renaming) {
    const r = boxRect(doc, one);
    if (r) overlay.push(outline(r, "sel"));
    if (oneKind === "frame" && r && !dragging) {
      for (const h of HANDLES) {
        const x = h.includes("w") ? r.x : h.includes("e") ? r.x + r.w : r.x + r.w / 2;
        const y = h.includes("n") ? r.y : h.includes("s") ? r.y + r.h : r.y + r.h / 2;
        const s = 8 / k;
        overlay.push(
          <g key={`rz-${h}`} data-fc-box-resize={h} data-box={one} className="fc-box-handle" data-dir={h}>
            <circle cx={x} cy={y} r={hit} className="fc-hit" />
            <rect className="fc-resize" data-dir={h} x={x - s / 2} y={y - s / 2} width={s} height={s} rx={2 / k} />
          </g>,
        );
      }
    }
    if ((oneKind === "pool" || oneKind === "lane") && !dragging) {
      const pool = oneKind === "pool" ? doc.pools.find((p) => p.id === one)! : findLane(doc, one)!.pool;
      const rows = pool.orient === "rows";
      for (const lb of laneBoxes(pool)) {
        const rr = lb.rect;
        const [x1, y1, x2, y2] = rows ? [rr.x, rr.y + rr.h, rr.x + rr.w, rr.y + rr.h] : [rr.x + rr.w, rr.y, rr.x + rr.w, rr.y + rr.h];
        const mx = (x1 + x2) / 2;
        const my = (y1 + y2) / 2;
        overlay.push(
          <g key={`lr-${lb.lane.id}`} data-fc-lane-resize={lb.lane.id} className="fc-lane-handle" data-dir={rows ? "s" : "e"}>
            <line className="fc-edge-grip" x1={x1} y1={y1} x2={x2} y2={y2} />
            <rect className="fc-grip" x={rows ? mx - 14 / k : mx - 3 / k} y={rows ? my - 3 / k : my - 14 / k} width={(rows ? 28 : 6) / k} height={(rows ? 6 : 28) / k} rx={3 / k} />
          </g>,
        );
      }
      const pr = poolRect(pool);
      const [x1, y1, x2, y2] = rows ? [pr.x + pr.w, pr.y + FLOWCHART_POOL_TITLE, pr.x + pr.w, pr.y + pr.h] : [pr.x, pr.y + pr.h, pr.x + pr.w, pr.y + pr.h];
      const mx = (x1 + x2) / 2;
      const my = (y1 + y2) / 2;
      overlay.push(
        <g key="pool-end" data-fc-pool-resize={pool.id} className="fc-lane-handle" data-dir={rows ? "e" : "s"}>
          <line className="fc-edge-grip" x1={x1} y1={y1} x2={x2} y2={y2} />
          <rect className="fc-grip" x={rows ? mx - 3 / k : mx - 14 / k} y={rows ? my - 14 / k : my - 3 / k} width={(rows ? 6 : 28) / k} height={(rows ? 28 : 6) / k} rx={3 / k} />
        </g>,
      );
    }
  }

  // The rename box over the title.
  let input: React.ReactNode = null;
  if (renaming) {
    const box = titleBox(doc, renaming.id);
    const kind = boxKind(doc, renaming.id);
    if (box && kind) {
      input = (
        <input
          className="fc-label-input fc-box-input"
          autoFocus
          value={renaming.value}
          maxLength={120}
          placeholder="Title"
          aria-label={kind === "frame" ? "Frame title" : kind === "lane" ? "Lane title" : "Swimlanes title"}
          style={{ left: box.x * k + view.x, top: box.y * k + view.y, width: box.w * k, height: box.h * k, fontSize: 13 * k }}
          onChange={(e) => onRenameChange(e.target.value)}
          onFocus={(e) => {
            const el = e.currentTarget;
            if (renaming.typed) el.setSelectionRange(el.value.length, el.value.length);
            else el.select();
          }}
          onBlur={() => finishRename(true, false)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter" || e.key === "Escape") {
              e.preventDefault();
              finishRename(e.key === "Enter");
            } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
              e.preventDefault();
              finishRename(true);
              if (e.shiftKey) ctrl.redo();
              else ctrl.undo();
            }
          }}
        />
      );
    }
  }

  // The floating bar for one selected container.
  let bar: React.ReactNode = null;
  const shown = one ? boxRect(doc, one) : null;
  // Not for a container scrolled out of view.
  const onScreen = shown && shown.x * k + view.x < ctrl.width && (shown.x + shown.w) * k + view.x > 0 && shown.y * k + view.y < ctrl.height && (shown.y + shown.h) * k + view.y > 0;
  if (one && oneKind && shown && onScreen && !renaming && !dragging && !ctrl.editing) {
    const r = shown;
    const top = r.y * k + view.y;
    const bottom = (r.y + r.h) * k + view.y;
    // On a narrow canvas (a phone) the bar wraps onto two rows and sits in the middle.
    const compact = ctrl.width < 460;
    const half = 200;
    const cx = compact ? ctrl.width / 2 : clamp((r.x + r.w / 2) * k + view.x, half, Math.max(half, ctrl.width - half));
    const tall = compact ? 92 : 52;
    const above = top - tall > 56;
    // A big pool fills the view: the bar then sits at the top of the canvas, under the toolbar.
    const style: React.CSSProperties = {
      left: cx,
      top: above ? top - tall : bottom + tall + 8 < ctrl.height ? Math.min(ctrl.height - tall + 4, bottom + 12) : 58,
      ...(compact ? { maxWidth: ctrl.width - 16 } : {}),
    };
    const lane = oneKind === "lane" ? findLane(doc, one) : null;
    const frame = oneKind === "frame" ? doc.frames.find((f) => f.id === one) : null;
    bar = (
      <ContainerBar
        kind={oneKind}
        rows={lane ? lane.pool.orient === "rows" : true}
        canBack={lane ? lane.index > 0 : false}
        canForward={lane ? lane.index < lane.pool.lanes.length - 1 : false}
        color={frame?.color ?? lane?.lane.color ?? null}
        onRename={() => startRename(one)}
        onColor={oneKind === "pool" ? null : (c) => recolor(one, c)}
        onAddLane={oneKind === "pool" ? () => addLaneAt(one) : lane ? () => addLaneAt(lane.pool.id, lane.index + 1) : null}
        onMove={lane ? (d) => shiftLane(one, d) : null}
        onDelete={() => {
          const rr = boxRect(docRef.current, one);
          askRemove(one, rr ? toClient({ x: rr.x + rr.w / 2, y: rr.y }) : undefined);
        }}
        style={style}
        compact={compact}
      />
    );
  }

  // The right-click menu, or the keep-or-delete question.
  let menuElement: React.ReactNode = null;
  if (menu) {
    const kind = boxKind(doc, menu.id);
    if (kind) {
      const noun = NOUN[kind];
      const c = boxContents(doc, menu.id);
      const has = c.nodes.size > 0 || c.frames.size > 0;
      const lane = kind === "lane" ? findLane(doc, menu.id) : null;
      const rows = lane ? lane.pool.orient === "rows" : true;
      const del: (MenuItem | "separator")[] = has
        ? [
            { label: kind === "lane" ? "Delete lane, move its shapes next door" : `Delete ${noun}, keep shapes`, icon: <Trash2 size={14} />, onSelect: () => remove(menu.id, true) },
            { label: `Delete ${noun} and its shapes`, icon: <Trash2 size={14} />, danger: true, onSelect: () => remove(menu.id, false) },
          ]
        : [{ label: `Delete ${noun}`, shortcut: "⌫", icon: <Trash2 size={14} />, danger: true, onSelect: () => remove(menu.id, true) }];
      const items: (MenuItem | "separator")[] = menu.ask
        ? del
        : [
            { label: "Rename", shortcut: "Enter", icon: <Pencil size={14} />, onSelect: () => startRename(menu.id) },
            ...(has ? [{ label: "Select shapes inside", icon: <BoxSelect size={14} />, onSelect: () => setSel({ nodes: [...c.nodes], edges: [] }) }] : []),
            ...(kind === "pool" ? [{ label: "Add lane", icon: <Plus size={14} />, onSelect: () => addLaneAt(menu.id) }] : []),
            ...(lane
              ? [
                  { label: rows ? "Add lane above" : "Add lane to the left", icon: <Plus size={14} />, onSelect: () => addLaneAt(lane.pool.id, lane.index) },
                  { label: rows ? "Add lane below" : "Add lane to the right", icon: <Plus size={14} />, onSelect: () => addLaneAt(lane.pool.id, lane.index + 1) },
                  { label: rows ? "Move up" : "Move left", shortcut: rows ? "⌥↑" : "⌥←", icon: rows ? <ArrowUp size={14} /> : <ArrowLeft size={14} />, disabled: lane.index === 0, onSelect: () => shiftLane(menu.id, -1) },
                  { label: rows ? "Move down" : "Move right", shortcut: rows ? "⌥↓" : "⌥→", icon: rows ? <ArrowDown size={14} /> : <ArrowRight size={14} />, disabled: lane.index === lane.pool.lanes.length - 1, onSelect: () => shiftLane(menu.id, 1) },
                ]
              : []),
            "separator",
            ...del,
          ];
      menuElement = (
        <ContextMenu
          at={menu.at}
          label={menu.ask ? `Delete ${noun}` : kind === "frame" ? "Frame" : kind === "lane" ? "Lane" : "Swimlanes"}
          host={full ? (cardRef.current ?? undefined) : undefined}
          onClose={() => setMenu(null)}
          items={items}
        />
      );
    }
  }

  /** Extra entries for a shape's right-click menu. */
  const nodeMenuItems = (): MenuItem[] => [{ label: ctrl.selRef.current.nodes.length > 1 ? "Frame selection" : "Put in a frame", shortcut: "⌥⌘G", icon: <Frame size={14} />, onSelect: frameOrAdd }];

  const tools = <ContainerTools framing={ctrl.sel.nodes.length > 0} onFrame={frameOrAdd} onSwimlanes={addSwimlanes} />;

  return {
    interaction,
    onFocusBox,
    /** The container being renamed (its title hides under the rename box). */
    renaming: renaming?.id ?? null,
    selected,
    /** Selection outlines, resize handles and drop targets (world coordinates, in the overlay layer). */
    overlay,
    /** HTML: the rename box, the floating bar and the menu. */
    element: (
      <>
        {input}
        {bar}
        {menuElement}
      </>
    ),
    tools,
    nodeMenuItems,
    frameOrAdd,
    addSwimlanes,
  };
}
