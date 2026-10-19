"use client";

// The chart in the editor: its scene (draw.ts) drawn at the room's exact size (ChartSvg.tsx), with its tooltip
// layer. Hovering, tapping or moving the keyboard through the marks (arrow keys while the plot has focus)
// shows a tooltip with every series at that point; the other marks step back, line charts get a crosshair.
// Tooltips only add to what's there: every value is also in the chart's data table.
import { forwardRef, useImperativeHandle, useState } from "react";
import { ChartSvg } from "./ChartSvg";
import { paintCss } from "./palette";
import type { Hit, Scene } from "./scene";

export interface ChartCanvasHandle {
  /** Moves the tooltip to the next or previous mark (keyboard); false when there are none. */
  step: (dir: 1 | -1) => boolean;
  /** Hides the tooltip; false when none was showing. */
  clear: () => boolean;
}

function HitShape({ hit, onEnter, onLeave }: { hit: Hit; onEnter: () => void; onLeave: () => void }) {
  const common = {
    fill: "transparent",
    onPointerEnter: (e: React.PointerEvent) => e.pointerType === "mouse" && onEnter(),
    onPointerDown: onEnter,
    onPointerLeave: (e: React.PointerEvent) => e.pointerType === "mouse" && onLeave(),
  };
  if (hit.shape === "rect") return <rect x={hit.x} y={hit.y} width={hit.w} height={hit.h} {...common} />;
  if (hit.shape === "circle") return <circle cx={hit.cx} cy={hit.cy} r={hit.r} {...common} />;
  return <path d={hit.d} {...common} />;
}

/** The tooltip for a hit, placed above its point and kept inside the drawing. */
function Tooltip({ hit, scene }: { hit: Hit; scene: Scene }) {
  const w = 220;
  const left = Math.max(4, Math.min(scene.width - w - 4, hit.at.x - w / 2));
  const below = hit.at.y < 90;
  return (
    <div className="fb-chart-tip ui-pop" role="status" aria-live="polite" style={{ left, top: below ? hit.at.y + 14 : undefined, bottom: below ? undefined : scene.height - hit.at.y + 10, width: w }}>
      <p className="fb-chart-tip-title">{hit.tip.title}</p>
      {hit.tip.rows.map((r, i) => (
        <p key={i} className="fb-chart-tip-row">
          <span className="fb-chart-tip-key" data-key={r.key} style={{ background: r.paint === "none" ? "transparent" : paintCss(r.paint) }} aria-hidden />
          <span className="fb-chart-tip-value">{r.value}</span>
          <span className="fb-chart-tip-label">{r.label}</span>
        </p>
      ))}
    </div>
  );
}

export const ChartCanvas = forwardRef<ChartCanvasHandle, { scene: Scene; tableId?: string }>(function ChartCanvas({ scene, tableId }, ref) {
  const [at, setAt] = useState<number | null>(null);
  const hit = at !== null ? (scene.hits[at] ?? null) : null;

  useImperativeHandle(
    ref,
    () => ({
      step: (dir) => {
        if (!scene.hits.length) return false;
        setAt((i) => (i === null ? (dir > 0 ? 0 : scene.hits.length - 1) : (i + dir + scene.hits.length) % scene.hits.length));
        return true;
      },
      clear: () => {
        if (at === null) return false;
        setAt(null);
        return true;
      },
    }),
    [scene.hits.length, at],
  );

  if (scene.empty) return null;
  return (
    <div className="fb-chart-canvas" style={{ width: scene.width, height: scene.height }} onPointerLeave={(e) => e.pointerType === "mouse" && setAt(null)}>
      <ChartSvg scene={scene} active={hit ? hit.g : null} describedBy={tableId}>
        {hit?.crosshair ? (
          <g aria-hidden>
            <line x1={hit.crosshair.x} y1={hit.crosshair.y1} x2={hit.crosshair.x} y2={hit.crosshair.y2} stroke="var(--chart-axis)" strokeWidth={1} shapeRendering="crispEdges" />
            {hit.crosshair.dots.map((d, i) => (
              <circle key={i} cx={hit.crosshair!.x} cy={d.y} r={5} fill={paintCss(d.paint)} stroke="var(--chart-surface)" strokeWidth={2} />
            ))}
          </g>
        ) : null}
        <g className="fb-chart-hits" aria-hidden>
          {scene.hits.map((h, i) => (
            <HitShape key={i} hit={h} onEnter={() => setAt(i)} onLeave={() => setAt((cur) => (cur === i ? null : cur))} />
          ))}
        </g>
      </ChartSvg>
      {hit ? <Tooltip hit={hit} scene={scene} /> : null}
    </div>
  );
});
