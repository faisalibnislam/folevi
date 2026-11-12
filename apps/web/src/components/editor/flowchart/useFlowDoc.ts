"use client";

import { LIMITS, parseFlowchart, serializeFlowchart, type FlowchartData } from "./schema";
import { FlowHistory } from "./ops";
import { useCanvasDoc } from "../canvas/useCanvasDoc";
import type { CanvasWrite } from "../canvas/leaveFlush";

const newHistory = () => new FlowHistory();

/**
 * The chart being edited: local state first (so dragging is smooth), written to the block's `data`
 * shortly after, with its own undo history. How it is saved, and what happens when `data` changes from
 * outside, is the same for every canvas block: canvas/useCanvasDoc.ts.
 */
export function useFlowDoc(data: string, write: (data: string, how?: CanvasWrite) => void) {
  return useCanvasDoc<FlowchartData>({ data, write, parse: parseFlowchart, serialize: serializeFlowchart, maxLength: LIMITS.maxFlowchartDataLength, newHistory });
}
