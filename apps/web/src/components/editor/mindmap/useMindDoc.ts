"use client";

import { LIMITS, parseMindmap, serializeMindmap, type MindmapData } from "@folevi/editor-schema";
import { MindHistory } from "./ops";
import { useCanvasDoc } from "../canvas/useCanvasDoc";
import type { CanvasWrite } from "../canvas/leaveFlush";

const newHistory = () => new MindHistory();

/**
 * The map being edited: local state first (typing and dragging stay smooth), written to the block's `data`
 * shortly after, with its own undo history (⌘Z inside the block). How it is saved, and what happens when
 * `data` changes from outside, is the same for every canvas block: canvas/useCanvasDoc.ts.
 */
export function useMindDoc(data: string, write: (data: string, how?: CanvasWrite) => void) {
  return useCanvasDoc<MindmapData>({ data, write, parse: parseMindmap, serialize: serializeMindmap, maxLength: LIMITS.maxMindmapDataLength, newHistory });
}
