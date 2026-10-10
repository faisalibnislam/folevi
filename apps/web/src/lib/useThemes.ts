"use client";

import { useSyncExternalStore } from "react";
import { subscribeThemes, themesVersion } from "./themes";

/** Re-renders when the note theme list (lib/themes.ts) changes; returns its version. */
export function useThemesVersion(): number {
  return useSyncExternalStore(subscribeThemes, themesVersion, () => 0);
}
