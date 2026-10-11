"use client";

import { api } from "@/lib/convex/api";
import { setThemeRows, type ThemeRow } from "@/lib/themes";

let loading: Promise<void> | null = null;

/**
 * The app's note themes as the server has them (admins' changes and added themes: public data, the same for
 * everyone), once per visit, so the website's gallery offers exactly what the app does. lib/themes.ts keeps
 * the last list on this device, so later visits draw it straight away. On failure, the shipped themes.
 */
export function loadLiveThemes(): Promise<void> {
  loading ??= (async () => {
    const url = process.env.NEXT_PUBLIC_CONVEX_URL;
    if (!url) return;
    try {
      const { ConvexHttpClient } = await import("convex/browser");
      setThemeRows((await new ConvexHttpClient(url).query(api.themes.list, {})) as ThemeRow[]);
    } catch {
      loading = null;
    }
  })();
  return loading;
}
