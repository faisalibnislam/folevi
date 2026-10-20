"use client";

// Frames and swimlanes on the editable canvas, drawn under the connectors and shapes: pools first (their title
// band, then each lane with its header), then frames from the outside in. Presentational only; the
// interaction (interactions/containers.tsx) finds them by their data-fc-* attributes:
//
//   data-fc-box="id"    a frame, pool or lane (right-click menu, focus)
//   data-fc-grab="id"   a title band, lane header or frame border: press to select and drag
//
// Each one is focusable (Tab reaches the pools, their lanes, then the frames, before the shapes) and named for
// screen readers. Colours come from flowchart.css (neutral chrome; a frame's or lane's colour tints it).
import { memo } from "react";
import { FLOWCHART_FRAME_TITLE, FLOWCHART_POOL_TITLE, boxContents, flowContainers, laneBoxes, measureFlowText, poolRect, type FlowchartData, type FlowFrame, type FlowPool } from "../schema";

const TITLE_SIZE = 13;
const LANE_TITLE_SIZE = 12.5;

/** The title cut to fit `width` (with an ellipsis). */
function fit(title: string, width: number, size: number): string {
  if (measureFlowText(title, size) <= width) return title;
  let t = title;
  while (t.length > 1 && measureFlowText(`${t}…`, size) > width) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

function contentsLabel(fc: FlowchartData, id: string): string {
  const c = boxContents(fc, id);
  return c.nodes.size ? plural(c.nodes.size, "shape") : "empty";
}

interface ItemProps {
  selected: boolean;
  hideTitle: boolean;
  onFocusBox: (id: string) => void;
  label: string;
}

const PoolItem = memo(function PoolItem({ pool, selected, hideTitle, onFocusBox, label }: ItemProps & { pool: FlowPool }) {
  const r = poolRect(pool);
  const band = `M${r.x + 10} ${r.y}H${r.x + r.w - 10}Q${r.x + r.w} ${r.y} ${r.x + r.w} ${r.y + 10}V${r.y + FLOWCHART_POOL_TITLE}H${r.x}V${r.y + 10}Q${r.x} ${r.y} ${r.x + 10} ${r.y}Z`;
  return (
    <g className="fc-pool" data-fc-box={pool.id} data-kind="pool" data-selected={selected || undefined} tabIndex={0} role="button" aria-pressed={selected} aria-label={label} onFocus={() => onFocusBox(pool.id)}>
      <rect className="fc-pool-body" x={r.x} y={r.y} width={r.w} height={r.h} rx={10} />
      <path className="fc-pool-band" data-fc-grab={pool.id} d={band} />
      {pool.title && !hideTitle ? (
        <text className="fc-box-title" x={r.x + 14} y={r.y + FLOWCHART_POOL_TITLE / 2 + 4.5} fontSize={TITLE_SIZE}>
          {fit(pool.title, r.w - 28, TITLE_SIZE)}
        </text>
      ) : null}
      <rect className="fc-focus" x={r.x - 4} y={r.y - 4} width={r.w + 8} height={r.h + 8} rx={12} />
    </g>
  );
});

const LanesOf = memo(function LanesOf({ pool, selected, renaming, onFocusBox, counts }: { pool: FlowPool; selected: readonly string[]; renaming: string | null; onFocusBox: (id: string) => void; counts: Map<string, string> }) {
  const rows = pool.orient === "rows";
  const boxes = laneBoxes(pool);
  return boxes.map((lb) => {
    const { lane, rect, header, content } = lb;
    const sel = selected.includes(lane.id);
    const title = lane.title && renaming !== lane.id ? fit(lane.title, header.w - 22, LANE_TITLE_SIZE) : "";
    return (
      <g
        key={lane.id}
        className="fc-lane"
        data-fc-box={lane.id}
        data-kind="lane"
        data-color={lane.color}
        data-selected={sel || undefined}
        tabIndex={0}
        role="button"
        aria-pressed={sel}
        aria-label={`Lane: ${lane.title || "untitled"}, ${counts.get(lane.id) ?? "empty"}, lane ${lb.index + 1} of ${pool.lanes.length}${pool.title ? ` in ${pool.title}` : ""}`}
        onFocus={() => onFocusBox(lane.id)}
      >
        <rect className="fc-lane-body" x={content.x} y={content.y} width={content.w} height={content.h} />
        <rect className="fc-lane-header" data-fc-grab={lane.id} x={header.x} y={header.y} width={header.w} height={header.h} />
        {lb.index > 0 ? <path className="fc-lane-line" d={rows ? `M${rect.x} ${rect.y}H${rect.x + rect.w}` : `M${rect.x} ${rect.y}V${rect.y + rect.h}`} /> : null}
        <path className="fc-lane-line" d={rows ? `M${header.x + header.w} ${rect.y}V${rect.y + rect.h}` : `M${rect.x} ${header.y + header.h}H${rect.x + rect.w}`} />
        {title ? (
          <text className="fc-lane-title" x={header.x + 12} y={rows ? header.y + 22 : header.y + header.h / 2 + 4.5} fontSize={LANE_TITLE_SIZE}>
            {title}
          </text>
        ) : null}
        <rect className="fc-focus" x={rect.x + 2} y={rect.y + 2} width={Math.max(0, rect.w - 4)} height={Math.max(0, rect.h - 4)} rx={6} />
      </g>
    );
  });
});

const FrameItem = memo(function FrameItem({ frame: f, selected, hideTitle, onFocusBox, label }: ItemProps & { frame: FlowFrame }) {
  const band = f.title ? FLOWCHART_FRAME_TITLE : 12;
  return (
    <g className="fc-frame" data-fc-box={f.id} data-kind="frame" data-color={f.color} data-selected={selected || undefined} tabIndex={0} role="button" aria-pressed={selected} aria-label={label} onFocus={() => onFocusBox(f.id)}>
      <rect className="fc-frame-body" x={f.x} y={f.y} width={f.w} height={f.h} rx={12} />
      <rect className="fc-frame-band" data-fc-grab={f.id} x={f.x} y={f.y} width={f.w} height={band} rx={12} />
      <rect className="fc-frame-edge" data-fc-grab={f.id} x={f.x} y={f.y} width={f.w} height={f.h} rx={12} />
      {f.title && !hideTitle ? (
        <text className="fc-box-title" x={f.x + 14} y={f.y + FLOWCHART_FRAME_TITLE / 2 + 5} fontSize={TITLE_SIZE}>
          {fit(f.title, f.w - 28, TITLE_SIZE)}
        </text>
      ) : null}
      <rect className="fc-focus" x={f.x - 4} y={f.y - 4} width={f.w + 8} height={f.h + 8} rx={14} />
    </g>
  );
});

/** Every pool, lane and frame of the chart, bottom to top. */
export function ContainerLayer({ fc, selected, renaming, onFocusBox }: { fc: FlowchartData; selected: readonly string[]; renaming: string | null; onFocusBox: (id: string) => void }) {
  const pools = fc.pools ?? [];
  const frames = fc.frames ?? [];
  if (!pools.length && !frames.length) return null;
  const depth = flowContainers(fc);
  const ordered = [...frames].sort((a, b) => (depth.get(a.id)?.depth ?? 0) - (depth.get(b.id)?.depth ?? 0));
  const counts = new Map<string, string>();
  for (const p of pools) for (const l of p.lanes) counts.set(l.id, contentsLabel(fc, l.id));
  return (
    <g className="fc-containers">
      {pools.map((p) => (
        <g key={p.id}>
          <PoolItem
            pool={p}
            selected={selected.includes(p.id)}
            hideTitle={renaming === p.id}
            onFocusBox={onFocusBox}
            label={`Swimlanes: ${p.title || "untitled"}, ${plural(p.lanes.length, p.orient === "rows" ? "row" : "column")}, ${contentsLabel(fc, p.id)}`}
          />
          <LanesOf pool={p} selected={selected} renaming={renaming} onFocusBox={onFocusBox} counts={counts} />
        </g>
      ))}
      {ordered.map((f) => (
        <FrameItem key={f.id} frame={f} selected={selected.includes(f.id)} hideTitle={renaming === f.id} onFocusBox={onFocusBox} label={`Frame: ${f.title || "untitled"}, ${contentsLabel(fc, f.id)}`} />
      ))}
    </g>
  );
}
