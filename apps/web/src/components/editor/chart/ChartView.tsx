"use client";

// Chart block: bar, line, area, pie, scatter, org and Venn charts from a small table of values. The content
// lives in the block's `data` (packages/editor-schema/src/chart.ts).
//
// The card, its toolbar, Full canvas (⇧⌘F, Esc back), Export (PNG, SVG, PDF, Copy as image; ./svg.ts) and
// the height handle come from canvas/CanvasCard.tsx. The editor goes in the card's children, its tools in
// `tools`; until then the card shows what's in the block (./render.tsx) or how to start.
import type { ReactNodeViewProps } from "@tiptap/react";
import { useMemo } from "react";
import { ChartColumn } from "lucide-react";
import { LIMITS, CHART_DEFAULT_HEIGHT, parseChart, serializeChart } from "@folevi/editor-schema";
import { CanvasCard } from "../canvas/CanvasCard";
import { ChartStatic } from "./render";

export function ChartView(props: ReactNodeViewProps) {
  const data = String(props.node.attrs.data ?? "");
  const empty = useMemo(() => !serializeChart(parseChart(data)), [data]);
  return (
    <CanvasCard
      view={props}
      type="chart"
      name="Chart"
      icon={<ChartColumn size={14} />}
      minHeight={LIMITS.minChartHeight}
      maxHeight={LIMITS.maxChartHeight}
      defaultHeight={CHART_DEFAULT_HEIGHT}
      empty={empty}
      hint="Add your numbers, or turn a table in this note into a chart."
    >
      {empty ? null : (
        <div className="fb-vc-content">
          <ChartStatic data={data} />
        </div>
      )}
    </CanvasCard>
  );
}
