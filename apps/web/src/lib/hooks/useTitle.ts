"use client";

import { useEffect } from "react";

/** Keeps the browser tab title in step with the current view (the app shell renders one route). */
export function useDocumentTitle(title: string | null | undefined) {
  useEffect(() => {
    if (title === undefined) return;
    document.title = title ? `${title} · Folevi` : "Folevi";
  }, [title]);
}
