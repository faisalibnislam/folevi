"use client";

// Quick add arrows: a + on each side of the hovered shape (the selected one on touch). Clicking one adds the
// next shape of the same kind there, already connected and placed clear of everything (building.ts,
// quickAddPosition); dragging one out and letting go on empty canvas opens the shape picker at that point,
// and letting go on a shape connects to it. A new connector dropped on empty canvas (interactions/connect)
// opens the same picker, through the controller's dropInEmptyRef.
//
// A shape added here and the text then typed into it are one undo step: the chart is shown with the new
// shape (setLive) and the text edit starts from the chart before it, so finishing the edit records both.
import { useEffect, useState } from "react";
import { FLOWCHART_SHAPE_LABEL, autoSides, nearestSide, orthogonalRoute, portPoint, roundedPolyline, type FlowchartData, type FlowNode, type FlowShape, type FlowSide, type Pt, type Rect } from "../schema";
import { NO_SELECTION, connect, nodeAt, type Selection } from "../ops";
import { addConnectedAt, quickAdd, type Added } from "../building";
import { ShapePicker, rememberShape } from "../chrome/ShapePicker";
import type { FlowController, Interaction } from "../controller/types";

const SIDES: FlowSide[] = ["top", "right", "bottom", "left"];
const SIDE_WORD: Record<FlowSide, string> = { top: "above", right: "to the right of", bottom: "below", left: "to the left of" };
/** How far the arrows sit outside the shape (screen pixels), past the connection handles. */
const OUT = { mouse: 40, touch: 60 };
/** The pointer keeps a shape's arrows while this close to it (screen pixels). */
const KEEP = 64;

/** "process" or "start / end" from a shape, for announcements. */
export const shapeName = (n: Pick<FlowNode, "shape">) => FLOWCHART_SHAPE_LABEL[n.shape].toLowerCase();
const named = (n: FlowNode) => (n.text.trim() ? `${shapeName(n)} ${n.text.trim().split("\n")[0]}` : shapeName(n));

/** Pans the view, if needed, so `r` is in sight (below the toolbar, clear of the edges). */
export function reveal(ctrl: FlowController, r: Rect) {
  const v = ctrl.viewRef.current;
  const pad = 24;
  const top = 56;
  const x0 = r.x * v.k + v.x;
  const y0 = r.y * v.k + v.y;
  const x1 = (r.x + r.w) * v.k + v.x;
  const y1 = (r.y + r.h) * v.k + v.y;
  let dx = 0;
  let dy = 0;
  if (x1 > ctrl.width - pad) dx = ctrl.width - pad - x1;
  if (x0 + dx < pad) dx = pad - x0;
  if (y1 > ctrl.height - pad) dy = ctrl.height - pad - y1;
  if (y0 + dy < top) dy = top - y0;
  if (dx || dy) ctrl.setView({ ...v, x: v.x + dx, y: v.y + dy });
}

/** Shows a shape just added (one undo step with the text written next) and starts writing in it. */
export function placeAdded(ctrl: FlowController, res: Added, before: FlowchartData) {
  const n = res.doc.nodes.find((x) => x.id === res.id);
  if (n) reveal(ctrl, n);
  ctrl.setLive(res.doc, true);
  ctrl.setSel({ nodes: [res.id], edges: [] });
  ctrl.setEditing({ kind: "node", id: res.id, before });
}

/** "Added process below Start. 4 shapes." */
export function addedMessage(res: Added, from: FlowNode | undefined, where: string): string {
  const n = res.doc.nodes.find((x) => x.id === res.id);
  const count = res.doc.nodes.length;
  return `Added ${n ? shapeName(n) : "shape"}${from ? ` ${where} ${named(from)}` : ""}${res.edge ? ", connected" : ""}. ${count} shape${count === 1 ? "" : "s"}. Type its text.`;
}

export function useQuickAdd(ctrl: FlowController) {
  const { docRef, toWorld, byId, view, editing, single, isDragging, wrapRef, say } = ctrl;
  /** The shape whose arrows show under the mouse (kept while reaching for an arrow). */
  const [near, setNear] = useState<string | null>(null);
  const [touch, setTouch] = useState(false);
  /** An arrow being dragged out: where it points now and the shape it would connect to. */
  const [drag, setDrag] = useState<{ from: string; side: FlowSide; to: Pt; target: string | null } | null>(null);
  /** The shape picker, open where a connector was let go. */
  // The selection steps aside while it's open (its bar would sit under the picker) and comes back on cancel.
  const [picker, setPicker] = useState<{ from: string; side: FlowSide; at: Pt; client: Pt; sel: Selection } | null>(null);

  const addNext = (from: string, side: FlowSide) => {
    const before = docRef.current;
    const res = quickAdd(before, from, side);
    if (!res) return say("The flowchart is full.");
    placeAdded(ctrl, res, before);
    say(addedMessage(res, before.nodes.find((n) => n.id === from), SIDE_WORD[side]));
  };

  const openPicker = (d: { from: string; side: FlowSide; at: Pt; client: Pt }) => {
    setPicker({ ...d, sel: ctrl.selRef.current });
    ctrl.setSel(NO_SELECTION);
    return true;
  };
  // A new connector let go on empty canvas (interactions/connect.tsx) opens the picker too.
  useEffect(() => {
    ctrl.dropInEmptyRef.current = openPicker;
    return () => {
      ctrl.dropInEmptyRef.current = null;
    };
  });

  const closePicker = (refocus = true) => {
    if (picker) ctrl.setSel(picker.sel);
    setPicker(null);
    if (refocus) wrapRef.current?.focus({ preventScroll: true });
  };

  const pick = (shape: FlowShape) => {
    const p = picker;
    if (!p) return;
    setPicker(null);
    rememberShape(shape);
    const before = docRef.current;
    const res = addConnectedAt(before, p.from, p.side, shape, p.at);
    if (!res) {
      say("The flowchart is full.");
      wrapRef.current?.focus({ preventScroll: true });
      return;
    }
    placeAdded(ctrl, res, before);
    say(addedMessage(res, before.nodes.find((n) => n.id === p.from), "from"));
  };

  const interaction: Interaction = {
    handles: "[data-fc-quick]",
    beforePress: (e) => {
      setTouch(e.pointerType === "touch");
      if (picker) closePicker(false);
    },
    press: ({ e, target }) => {
      const el = target.closest("[data-fc-quick]");
      if (!el) return null;
      const from = el.getAttribute("data-node")!;
      const side = el.getAttribute("data-side") as FlowSide;
      const sx = e.clientX;
      const sy = e.clientY;
      let moved = false;
      return {
        move: (m) => {
          if (!moved && Math.hypot(m.clientX - sx, m.clientY - sy) < 6) return;
          moved = true;
          const p = toWorld(m.clientX, m.clientY);
          const t = nodeAt(docRef.current, p, 8);
          setDrag({ from, side, to: p, target: t && t.id !== from ? t.id : null });
        },
        end: (up) => {
          setDrag(null);
          if (!moved) return addNext(from, side);
          const fc = docRef.current;
          const p = toWorld(up.clientX, up.clientY);
          const t = nodeAt(fc, p, 8);
          if (t?.id === from) return;
          if (t) {
            const res = connect(fc, from, t.id, side, nearestSide(t, p));
            if (res && res.doc !== fc) {
              ctrl.commit(res.doc);
              ctrl.setSel({ nodes: [], edges: [res.id] });
              say(`Connected to ${named(t)}.`);
            }
            return;
          }
          openPicker({ from, side, at: p, client: { x: up.clientX, y: up.clientY } });
        },
        cancel: () => setDrag(null),
      };
    },
    hover: (e) => {
      if (e.pointerType === "touch") return;
      if (touch) setTouch(false);
      const k = ctrl.viewRef.current.k;
      const p = toWorld(e.clientX, e.clientY);
      const cur = near ? docRef.current.nodes.find((n) => n.id === near) : undefined;
      const m = KEEP / k;
      if (cur && p.x >= cur.x - m && p.x <= cur.x + cur.w + m && p.y >= cur.y - m && p.y <= cur.y + cur.h + m) {
        // Still reaching for one of this shape's arrows, unless the pointer is right over another shape.
        const over = nodeAt(docRef.current, p, 0);
        if (!over || over.id === cur.id) return;
      }
      const next = nodeAt(docRef.current, p, 26 / k)?.id ?? null;
      if (next !== near) setNear(next);
    },
    leave: () => setNear(null),
    blur: () => setNear(null),
  };

  const k = view.k;
  const dragging = isDragging();
  // On touch the arrows belong to the selected shape; with a mouse, to the one under the pointer.
  const owner: FlowNode | undefined = touch ? (single ?? undefined) : ((near ? byId.get(near) : undefined) ?? single ?? undefined);
  const show = owner && !editing && !dragging && !picker;
  // The selection bar floats above a selected shape (chrome/SelectionBar.tsx), over its top arrow, which
  // then stays hidden; when the bar sits below, it keeps clear of the bottom arrow (the flow's way on).
  // Neither depends on the pointer, so the bar never jumps while it's being reached for.
  const barAbove = single && single.y * k + view.y - 52 > 56;
  const clearance = single && !editing && !picker && !barAbove ? (touch ? OUT.touch : OUT.mouse) + 4 : 0;
  const out = (touch ? OUT.touch : OUT.mouse) / k;
  const hitR = (touch ? 24 : 14) / k;
  const r = 10 / k;
  const arm = 4 / k;

  const arrows =
    show && owner
      ? SIDES.map((side) => {
          const cx = owner.x + owner.w / 2;
          const cy = owner.y + owner.h / 2;
          const p = { top: { x: cx, y: owner.y - out }, right: { x: owner.x + owner.w + out, y: cy }, bottom: { x: cx, y: owner.y + owner.h + out }, left: { x: owner.x - out, y: cy } }[side];
          if (side === "top" && barAbove && single?.id === owner.id) return null;
          // An arrow that would sit on another shape stays hidden (it would cover that shape).
          const under = nodeAt(ctrl.doc, p, r);
          if (under && under.id !== owner.id) return null;
          return (
            <g key={side} className="fc-quick" data-fc-quick="" data-node={owner.id} data-side={side} data-touch={touch || undefined}>
              <circle cx={p.x} cy={p.y} r={hitR} className="fc-quick-hit" />
              <circle cx={p.x} cy={p.y} r={r} className="fc-quick-dot" />
              <path className="fc-quick-plus" d={`M${p.x - arm} ${p.y}H${p.x + arm}M${p.x} ${p.y - arm}V${p.y + arm}`} />
            </g>
          );
        })
      : null;

  // The connector being pulled out of an arrow, or waiting for the picker's choice.
  const pending = drag ?? (picker ? { from: picker.from, side: picker.side, to: picker.at, target: null } : null);
  let preview: React.ReactNode = null;
  if (pending) {
    const src = byId.get(pending.from);
    const tgt = pending.target ? byId.get(pending.target) : undefined;
    if (src) {
      const a = portPoint(src, pending.side);
      let pts: Pt[];
      if (tgt) {
        const side = nearestSide(tgt, pending.to);
        pts = orthogonalRoute(a, pending.side, portPoint(tgt, side), side, src, tgt);
      } else {
        const probe = { x: pending.to.x, y: pending.to.y, w: 0, h: 0 };
        pts = orthogonalRoute(a, pending.side, pending.to, autoSides(src, probe)[1], src, probe);
      }
      preview = (
        <>
          <path className="fc-link-preview" d={roundedPolyline(pts)} />
          {tgt ? <rect className="fc-drop-target" x={tgt.x - 4 / k} y={tgt.y - 4 / k} width={tgt.w + 8 / k} height={tgt.h + 8 / k} rx={10} /> : <circle className="fc-quick-end" cx={pending.to.x} cy={pending.to.y} r={4 / k} />}
        </>
      );
    }
  }

  /** The arrows and the connector being pulled (world coordinates, in the overlay layer). */
  const overlay = (
    <>
      {preview}
      {arrows}
    </>
  );

  let element: React.ReactNode = null;
  if (picker) {
    const rect = wrapRef.current?.getBoundingClientRect();
    const w = ctrl.width;
    const h = ctrl.height;
    const x = picker.client.x - (rect?.left ?? 0);
    const y = picker.client.y - (rect?.top ?? 0);
    const PW = 248;
    const maxHeight = Math.max(160, Math.min(320, h - 16));
    const left = Math.max(8, Math.min(x + 10, w - PW - 8));
    const top = Math.max(8, Math.min(y + 10, h - maxHeight - 8));
    element = <ShapePicker left={left} top={top} maxHeight={maxHeight} onPick={pick} onClose={closePicker} />;
  }

  return { interaction, overlay, /** The shape picker (HTML, next to the other chrome). */ element, addNext, clearance };
}
