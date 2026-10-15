"use client";

import { useLayoutEffect } from "react";

/**
 * Next serves a 404 from its error shell, and the browser then builds the whole page itself: the <html> it
 * makes has lost the theme the boot script set, and the tab takes the route's title. This puts both back
 * (the product host follows the app's appearance; the marketing site is always light).
 */
export function NotFoundHead({ site }: { site: "app" | "marketing" }) {
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (site === "marketing") root.dataset.theme = "light";
    else if (!root.dataset.theme) {
      let saved: string | null = null;
      try {
        saved = localStorage.getItem("folevi:appearance");
      } catch {
        // Storage blocked: follow the system.
      }
      root.dataset.theme = saved === "light" || saved === "dark" ? saved : matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    document.title = "Page not found · Folevi";
  }, [site]);
  return null;
}
