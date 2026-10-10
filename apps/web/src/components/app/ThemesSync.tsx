"use client";

import { useEffect } from "react";
import { useQuery } from "convex/react";
import { api } from "@/lib/convex/api";
import { setThemeRows, type ThemeRow } from "@/lib/themes";

/** Keeps the app's note themes (lib/themes.ts) in step with the server: admins' changes show up live. */
export function ThemesSync() {
  const rows = useQuery(api.themes.list, {});
  useEffect(() => {
    if (rows) setThemeRows(rows as ThemeRow[]);
  }, [rows]);
  return null;
}
