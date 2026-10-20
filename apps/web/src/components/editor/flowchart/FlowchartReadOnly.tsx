"use client";

// The flowchart in a note open read-only in the app: the shared read-only picture (FlowchartStatic.tsx)
// with its shapes' images resolved (useImageUrls.ts).
import { useMemo } from "react";
import { parseFlowchart } from "./schema";
import { FlowchartStatic } from "./FlowchartStatic";
import { useFlowImageUrls } from "./useImageUrls";

export function FlowchartReadOnly({ data, height }: { data: string; height: number }) {
  const fc = useMemo(() => parseFlowchart(data), [data]);
  const fileUrls = useFlowImageUrls(fc);
  return <FlowchartStatic data={data} height={height} fileUrls={fileUrls} />;
}
