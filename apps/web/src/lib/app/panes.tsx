"use client";

import { createContext, useContext } from "react";

/**
 * Notes joined side by side: whether this note is the pane with focus. Only that one owns the page's sidebar,
 * the tools panel and the keyboard shortcuts; the others are just their pages. A note on its own is primary.
 */
export const PaneContext = createContext<{ primary: boolean }>({ primary: true });

export function usePrimaryPane(): boolean {
  return useContext(PaneContext).primary;
}
