"use client";

import { LIMITS, parseWireframe, serializeWireframe, type WireframeData } from "@folevi/editor-schema";
import { WireHistory } from "./ops";
import { useCanvasDoc } from "../canvas/useCanvasDoc";
import type { CanvasWrite } from "../canvas/leaveFlush";

const newHistory = () => new WireHistory<WireframeData>();

/**
 * The wireframe being edited: local state first (so dragging is smooth), written to the block's `data`
 * shortly after, with its own undo history. How it is saved, and what happens when `data` changes from
 * outside, is the same for every canvas block: canvas/useCanvasDoc.ts.
 */
export function useWireDoc(data: string, write: (data: string, how?: CanvasWrite) => void) {
  return useCanvasDoc<WireframeData>({ data, write, parse: parseWireframe, serialize: serializeWireframe, maxLength: LIMITS.maxWireframeDataLength, newHistory });
}
