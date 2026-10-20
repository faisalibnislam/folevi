"use client";

// Smart guides while shapes are dragged (smartGuides in the model): a dashed line along an edge or centre a
// shape snapped to, and, for equal spacing, each matching gap drawn as a short measure with end ticks.
import type { SmartGuide } from "../schema";

export function GuideLines({ guides, k }: { guides: readonly SmartGuide[]; k: number }) {
  const tick = 4 / k;
  return (
    <>
      {guides.map((g, i) => {
        if (g.kind === "align") {
          return g.axis === "x" ? (
            <line key={i} className="fc-guide" x1={g.at} x2={g.at} y1={g.from - 16} y2={g.to + 16} />
          ) : (
            <line key={i} className="fc-guide" y1={g.at} y2={g.at} x1={g.from - 16} x2={g.to + 16} />
          );
        }
        return (
          <g key={i} className="fc-guide-gap">
            {g.gaps.map((s, j) =>
              g.axis === "x" ? (
                <path key={j} d={`M${s.from} ${s.at}H${s.to}M${s.from} ${s.at - tick}V${s.at + tick}M${s.to} ${s.at - tick}V${s.at + tick}`} />
              ) : (
                <path key={j} d={`M${s.at} ${s.from}V${s.to}M${s.at - tick} ${s.from}H${s.at + tick}M${s.at - tick} ${s.to}H${s.at + tick}`} />
              ),
            )}
          </g>
        );
      })}
    </>
  );
}
