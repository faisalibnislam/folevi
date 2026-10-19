// A chart scene (scene.ts) as SVG elements in the page. No hooks and no browser APIs, so share pages
// render it on the server; colours are CSS variables (chart.css), so it follows the app's theme. The
// editor's canvas (ChartCanvas.tsx) adds hover and focus on top.
import { memo, type ReactNode } from "react";
import { paintCss } from "./palette";
import type { Mark, Scene } from "./scene";

function MarkEl({ m, dim }: { m: Mark; dim: boolean }) {
  const opacity = (m.t !== "line" && m.t !== "text" ? m.opacity : undefined) ?? undefined;
  const dimmed = dim ? 0.35 : undefined;
  switch (m.t) {
    case "rect":
      return (
        <rect
          x={m.x}
          y={m.y}
          width={Math.max(0, m.w)}
          height={Math.max(0, m.h)}
          rx={m.r ? m.r[0] : undefined}
          fill={paintCss(m.fill)}
          stroke={m.stroke ? paintCss(m.stroke) : undefined}
          strokeWidth={m.sw}
          opacity={dimmed !== undefined ? dimmed * (opacity ?? 1) : opacity}
        />
      );
    case "path":
      return (
        <path
          d={m.d}
          fill={m.fill ? paintCss(m.fill) : "none"}
          stroke={m.stroke ? paintCss(m.stroke) : undefined}
          strokeWidth={m.sw}
          strokeLinejoin="round"
          strokeLinecap="round"
          opacity={dimmed !== undefined ? dimmed * (opacity ?? 1) : opacity}
        />
      );
    case "circle":
      return <circle cx={m.cx} cy={m.cy} r={m.r} fill={paintCss(m.fill)} stroke={m.stroke ? paintCss(m.stroke) : undefined} strokeWidth={m.sw} opacity={dimmed !== undefined ? dimmed * (opacity ?? 1) : opacity} />;
    case "line":
      return <line x1={m.x1} y1={m.y1} x2={m.x2} y2={m.y2} stroke={paintCss(m.stroke)} strokeWidth={m.sw ?? 1} shapeRendering="crispEdges" />;
    case "text":
      return (
        <text
          x={m.x}
          y={m.y}
          fontSize={m.size}
          fontWeight={m.weight}
          fill={paintCss(m.fill)}
          textAnchor={m.anchor}
          transform={m.rotate ? `rotate(${m.rotate} ${m.x} ${m.y})` : undefined}
          className={m.tabular ? "fb-chart-num" : undefined}
          opacity={dimmed}
        >
          {m.text}
        </text>
      );
  }
}

/**
 * The scene's marks. While a group is hovered (`active`), the marks of the other groups step back.
 * `children` draws on top (the canvas's crosshair and hit regions).
 */
export const ChartSvg = memo(function ChartSvg({ scene, active = null, label, describedBy, children, fit = false }: { scene: Scene; active?: number | null; label?: string; describedBy?: string; children?: ReactNode; fit?: boolean }) {
  const [x, y, w, h] = scene.viewBox;
  return (
    <svg
      className="fb-chart-svg"
      viewBox={`${x} ${y} ${w} ${h}`}
      width={fit ? "100%" : scene.width}
      height={fit ? undefined : scene.height}
      style={fit ? { maxWidth: scene.width, height: "auto" } : undefined}
      role="img"
      aria-label={label ?? scene.summary}
      aria-describedby={describedBy}
    >
      {scene.marks.map((m, i) => (
        <MarkEl key={i} m={m} dim={active !== null && "g" in m && m.g !== undefined && m.g !== active} />
      ))}
      {children}
    </svg>
  );
});
