"use client";

import { createContext, useContext, type PointerEvent } from "react";

/**
 * Notes joined side by side: whether this note is the pane with focus. Only that one owns the page's sidebar,
 * the tools panel and the keyboard shortcuts; the others are just their pages. A note on its own is primary.
 */
export interface PaneValue {
  primary: boolean;
  /** While notes are joined: this pane's place, and what its bar does (move it, drag it, take it out). */
  joined?: {
    index: number;
    count: number;
    move: (to: number) => void;
    remove: () => void;
    /** Starts dragging the pane by its bar, to drop it in another place. */
    dragStart: (e: PointerEvent<HTMLElement>) => void;
    dragging: boolean;
  };
}

export const PaneContext = createContext<PaneValue>({ primary: true });

export function usePrimaryPane(): boolean {
  return useContext(PaneContext).primary;
}

export function usePane(): PaneValue {
  return useContext(PaneContext);
}
