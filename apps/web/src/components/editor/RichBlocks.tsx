"use client";

// Rendered (read-only) forms of the formula, Mermaid and whiteboard blocks. Used by the editor's node
// views and by public share pages.
import { useEffect, useRef, useState } from "react";
import { WHITEBOARD_WIDTH, LIMITS, parseWhiteboard, strokeD, type WhiteboardStroke } from "@folevi/editor-schema";
import { onThemeChange, renderLatex, renderMermaid, svgDataUrl, type MermaidResult } from "./richRender";
import "katex/dist/katex.min.css";

/** KaTeX rendering of a LaTeX formula (display style). */
export function FormulaRender({ latex, className = "" }: { latex: string; className?: string }) {
  const [html, setHtml] = useState<{ latex: string; html: string } | null>(null);
  useEffect(() => {
    if (!latex.trim()) return;
    let live = true;
    void renderLatex(latex).then((h) => live && setHtml({ latex, html: h }));
    return () => {
      live = false;
    };
  }, [latex]);
  if (!latex.trim()) return <span className={`fb-formula-empty ${className}`}>Empty formula</span>;
  if (!html || html.latex !== latex) {
    return (
      <code className={`fb-formula-source ${className}`} aria-busy="true">
        {latex}
      </code>
    );
  }
  // KaTeX's own output (escaped, `trust: false`), never raw user HTML.
  return <div className={`fb-formula-render ${className}`} dangerouslySetInnerHTML={{ __html: html.html }} />;
}

/**
 * A Mermaid diagram rendered to an SVG image (styled after the note around it), or a friendly error that
 * keeps the last good drawing.
 */
export function MermaidDiagram({ code, label = "Diagram" }: { code: string; label?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<{ code: string; result: MermaidResult; last: { svg: string; width: number; height: number } | null } | null>(null);
  const [theme, setTheme] = useState(0);
  useEffect(() => onThemeChange(() => setTheme((t) => t + 1), ref.current), []);
  useEffect(() => {
    if (!code.trim()) return;
    let live = true;
    const t = window.setTimeout(() => {
      void renderMermaid(code, ref.current).then(
        (result) => live && setState((prev) => ({ code, result, last: "error" in result ? (prev?.last ?? null) : result })),
      );
    }, 250);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [code, theme]);
  if (!code.trim()) return null;
  const result = state?.result;
  const last = state?.last;
  return (
    <div ref={ref} className="fb-mermaid-view" data-stale={result && "error" in result && last ? "true" : undefined}>
      {!result ? (
        <p className="fb-mermaid-status" role="status">
          Rendering diagram…
        </p>
      ) : null}
      {last ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="fb-mermaid-svg" src={svgDataUrl(last.svg)} width={last.width} height={last.height} alt={label} draggable={false} />
      ) : null}
      {result && "error" in result ? (
        <p className="fb-mermaid-error" role="status">
          Couldn’t draw this diagram. {result.error}
        </p>
      ) : null}
    </div>
  );
}

export const WB_COLOR_NAMES: Record<string, string> = {
  ink: "Black",
  blue: "Blue",
  red: "Red",
  green: "Green",
  orange: "Orange",
  purple: "Purple",
  yellow: "Yellow",
};

/** Theme-aware stroke colour for a named or hex colour. */
export function strokeColor(color: string): string {
  return color.startsWith("#") ? color : `var(--wb-${color}, var(--wb-ink))`;
}

export function StrokePaths({ strokes }: { strokes: readonly WhiteboardStroke[] }) {
  return (
    <>
      {strokes.map((s, i) => (
        <path
          key={i}
          d={strokeD(s)}
          fill="none"
          stroke={strokeColor(s.color)}
          strokeWidth={s.width}
          strokeOpacity={s.opacity ?? 1}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </>
  );
}

export function clampHeight(h: unknown): number {
  const n = Number(h);
  return Math.max(LIMITS.minWhiteboardHeight, Math.min(LIMITS.maxWhiteboardHeight, Number.isFinite(n) && n > 0 ? n : 420));
}

/** Read-only whiteboard drawing. */
export function WhiteboardStatic({ data, height }: { data: string; height: number }) {
  const wb = parseWhiteboard(data);
  const h = clampHeight(height);
  return (
    <svg
      className="fb-whiteboard-canvas"
      viewBox={`0 0 ${WHITEBOARD_WIDTH} ${h}`}
      style={{ aspectRatio: `${WHITEBOARD_WIDTH} / ${h}` }}
      role="img"
      aria-label={wb.strokes.length ? `Whiteboard drawing with ${wb.strokes.length} stroke${wb.strokes.length === 1 ? "" : "s"}` : "Empty whiteboard"}
    >
      <StrokePaths strokes={wb.strokes} />
    </svg>
  );
}
