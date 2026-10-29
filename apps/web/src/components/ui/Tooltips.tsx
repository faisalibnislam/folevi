"use client";
// Folevi's own tooltip on every page (lib/desktop/tooltip.ts): a control's `title` is shown in Folevi's look, never
// the browser's. Mounted once at the root, for the website and the app alike.
import { useEffect } from "react";
import { installMacTooltips } from "@/lib/desktop/tooltip";

export function Tooltips() {
  useEffect(() => installMacTooltips(), []);
  return null;
}
