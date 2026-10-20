"use client";

// The bar for the selected connectors (one or many, changed together): route style, the head at each end,
// line style and thickness, colour, a label, delete. Menus are the app's own (components/ui/Menu.tsx);
// where the selected connectors differ, the trigger shows the first one's and no choice is checked.
// Every choice is one undo step for all of them.
import { Tag, Trash2 } from "lucide-react";
import { MenuButton, type MenuEntry } from "@/components/ui/Menu";
import { FLOWCHART_COLORS, FLOWCHART_COLOR_LABEL, FLOWCHART_HEADS, FLOWCHART_HEAD_LABEL, FLOWCHART_LINE_STYLES, headShape, pointAlong, type FlowHead, type FlowLineStyle, type FlowRoute } from "../schema";
import { EDGE_WIDTHS, edgeDash, shared, styleEdges, type EdgeStylePatch } from "../connectors";
import { ROUTE_LABEL } from "../interactions/connectorMenu";
import { startNewLabel } from "../interactions/edgeLabels";
import type { FlowController } from "../controller/types";
import type { FlowActions } from "../controller/useFlowActions";

const LINE_LABEL: Record<FlowLineStyle, string> = { solid: "Solid", dashed: "Dashed", dotted: "Dotted" };
const ROUTE_D: Record<FlowRoute, string> = { elbow: "M3 15h7V5h7", curved: "M3 15C11 15 9 5 17 5", straight: "M3 15 17 5" };

const svgProps = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

export function RouteIcon({ route }: { route: FlowRoute }) {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden {...svgProps}>
      <path d={ROUTE_D[route]} />
    </svg>
  );
}

/** A short line with `kind` at its start or end, drawn with the canvas's own head shapes. */
export function HeadIcon({ kind, at }: { kind: FlowHead; at: "start" | "end" }) {
  const tip = at === "end" ? { x: 25, y: 10 } : { x: 3, y: 10 };
  const head = headShape(kind, tip, { x: at === "end" ? 1 : -1, y: 0 }, 1.5);
  const inset = head?.inset ?? 0;
  const line = at === "end" ? `M3 10H${25 - inset}` : `M${3 + inset} 10H25`;
  return (
    <svg width="26" height="18" viewBox="0 0 28 20" aria-hidden {...svgProps}>
      <path d={line} />
      {head ? <path d={head.d} fill={head.filled ? "currentColor" : "none"} strokeWidth={head.filled ? 1 : 1.6} /> : null}
    </svg>
  );
}

export function LineIcon({ style, width = 1.6 }: { style: FlowLineStyle; width?: number }) {
  return (
    <svg width="22" height="18" viewBox="0 0 24 20" aria-hidden {...svgProps} strokeWidth={Math.min(5, Math.max(1.2, width))}>
      <path d="M3 10h18" strokeDasharray={edgeDash(style, Math.min(2.5, width))} />
    </svg>
  );
}

/**
 * Where the bar goes for the selected connectors: above them, below them, or beside or above the first
 * one's middle, whichever covers no shape and none of the selected lines (the default spot when every one
 * does). Screen coordinates in the canvas.
 */
export function connectorBarSpot(ctrl: FlowController, box: { x: number; y: number; w: number; h: number }, fallback: React.CSSProperties): React.CSSProperties {
  const { view, width, height, selEdges, routed, doc } = ctrl;
  const k = view.k;
  const W = 300;
  const H = 40;
  const sx = (x: number) => x * k + view.x;
  const sy = (y: number) => y * k + view.y;
  const cx = (box.x + box.w / 2) * k + view.x;
  const ids = new Set(selEdges.map((e) => e.id));
  const lines = routed.filter((r) => ids.has(r.edge.id)).flatMap((r) => [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9].map((t) => pointAlong(r.points, t)));
  const first = routed.find((x) => x.edge.id === selEdges[0]?.id);
  const mid = first ? pointAlong(first.points, 0.5) : null;
  const spots: { left: number; top: number }[] = [
    { left: cx, top: sy(box.y) - 52 },
    { left: cx, top: sy(box.y + box.h) + 12 },
    ...(mid
      ? [
          { left: sx(mid.x) + W / 2 + 16, top: sy(mid.y) - H / 2 },
          { left: sx(mid.x) - W / 2 - 16, top: sy(mid.y) - H / 2 },
          { left: sx(mid.x), top: sy(mid.y) - 56 },
        ]
      : []),
  ];
  for (const spot of spots) {
    const left = Math.max(W / 2 + 8, Math.min(width - W / 2 - 8, spot.left));
    const top = spot.top;
    if (top < 56 || top + H > height - 8) continue;
    const bar = { x0: (left - W / 2 - view.x) / k, x1: (left + W / 2 - view.x) / k, y0: (top - view.y) / k, y1: (top + H - view.y) / k };
    if (doc.nodes.some((n) => n.x < bar.x1 && n.x + n.w > bar.x0 && n.y < bar.y1 && n.y + n.h > bar.y0)) continue;
    if (lines.some((p) => p.x > bar.x0 && p.x < bar.x1 && p.y > bar.y0 && p.y < bar.y1)) continue;
    return { left, top };
  }
  return fallback;
}

const ColorDot = ({ color }: { color: string }) => <span aria-hidden className="fc-color-dot" data-color={color} />;

export function ConnectorBar({ ctrl, actions, style }: { ctrl: FlowController; actions: FlowActions; style: React.CSSProperties }) {
  const { selEdges, docRef, commit, sel } = ctrl;
  const apply = (patch: EdgeStylePatch) => commit(styleEdges(docRef.current, sel.edges, patch));
  const route = shared(selEdges, (e) => e.route);
  const start = shared(selEdges, (e) => e.start);
  const end = shared(selEdges, (e) => e.end);
  const line = shared(selEdges, (e) => e.style);
  const width = shared(selEdges, (e) => e.width);
  const color = shared(selEdges, (e) => e.color ?? "neutral");
  const first = selEdges[0];
  if (!first) return null;
  const many = selEdges.length > 1;
  const heads = (which: "start" | "end", current: FlowHead | null): MenuEntry[] =>
    FLOWCHART_HEADS.map((h) => ({ label: FLOWCHART_HEAD_LABEL[h], icon: <HeadIcon kind={h} at={which} />, checked: current === h, onSelect: () => apply(which === "start" ? { start: h } : { end: h }) }));

  return (
    <div className="fc-bar fc-bar-float fc-bar-edge" role="toolbar" aria-label={many ? `${selEdges.length} selected connectors` : "Selected connectors"} style={style} onPointerDown={(e) => e.stopPropagation()}>
      <MenuButton
        label={`Route: ${ROUTE_LABEL[route ?? first.route]}`}
        align="start"
        triggerClassName="fc-btn fc-btn-menu"
        trigger={<RouteIcon route={route ?? first.route} />}
        items={(["elbow", "curved", "straight"] as const).map((r) => ({ label: ROUTE_LABEL[r], icon: <RouteIcon route={r} />, checked: route === r, onSelect: () => apply({ route: r }) }))}
      />
      <span className="fc-sep" aria-hidden />
      <MenuButton label={`Start: ${FLOWCHART_HEAD_LABEL[start ?? first.start]}`} align="start" triggerClassName="fc-btn fc-btn-menu" trigger={<HeadIcon kind={start ?? first.start} at="start" />} items={[{ heading: "Start of the line" }, ...heads("start", start)]} />
      <MenuButton label={`End: ${FLOWCHART_HEAD_LABEL[end ?? first.end]}`} align="start" triggerClassName="fc-btn fc-btn-menu" trigger={<HeadIcon kind={end ?? first.end} at="end" />} items={[{ heading: "End of the line" }, ...heads("end", end)]} />
      <span className="fc-sep" aria-hidden />
      <MenuButton
        label={`Line: ${LINE_LABEL[line ?? first.style]}, ${(EDGE_WIDTHS.find((w) => w.value === (width ?? first.width))?.label ?? `${width ?? first.width} pt`).toLowerCase()}`}
        align="start"
        triggerClassName="fc-btn fc-btn-menu"
        trigger={<LineIcon style={line ?? first.style} width={width ?? first.width} />}
        items={[
          { heading: "Line" },
          ...FLOWCHART_LINE_STYLES.map((s) => ({ label: LINE_LABEL[s], icon: <LineIcon style={s} />, checked: line === s, onSelect: () => apply({ style: s }) })),
          "separator",
          { heading: "Thickness" },
          ...EDGE_WIDTHS.map((w) => ({ label: w.label, icon: <LineIcon style="solid" width={w.value} />, checked: width === w.value, onSelect: () => apply({ width: w.value }) })),
        ]}
      />
      <MenuButton
        label={`Colour: ${FLOWCHART_COLOR_LABEL[(color ?? first.color ?? "neutral") as keyof typeof FLOWCHART_COLOR_LABEL] ?? "Custom"}`}
        align="start"
        triggerClassName="fc-btn fc-btn-menu"
        trigger={<ColorDot color={color ?? first.color ?? "neutral"} />}
        items={[{ heading: "Colour" }, ...FLOWCHART_COLORS.map((c) => ({ label: c === "neutral" ? "Grey" : FLOWCHART_COLOR_LABEL[c], icon: <ColorDot color={c} />, checked: color === c, onSelect: () => apply({ color: c }) }))]}
      />
      {!many ? (
        <>
          <span className="fc-sep" aria-hidden />
          <button type="button" className="fc-btn" aria-label={first.labels.length ? "Add another label" : "Add label"} title="Add a label (double-click the line)" disabled={first.labels.length >= 8} onClick={() => startNewLabel(ctrl, first.id)}>
            <Tag size={14} aria-hidden />
          </button>
        </>
      ) : null}
      <span className="fc-sep" aria-hidden />
      <button type="button" className="fc-btn" aria-label={many ? "Delete connectors" : "Delete connector"} title="Delete (⌫)" onClick={actions.removeSelection}>
        <Trash2 size={14} aria-hidden />
      </button>
    </div>
  );
}
