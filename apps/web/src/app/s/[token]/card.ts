import { cache } from "react";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/lib/convex/api";
import { setThemeRows, type ThemeRow } from "@/lib/themes";

const TOKEN_RE = /^[A-Za-z0-9_-]{20,100}$/;

/**
 * What a link anyone can open shows in link previews (convex/sharing.ts publicLinkCard): the note's title, first
 * lines, theme and look; null for a password-protected, expired or encrypted link. Reading it counts no view.
 */
export const loadCard = cache(async (token: string) => {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  const secret = process.env.FOLEVI_SERVER_SECRET;
  if (!url || !secret || !TOKEN_RE.test(token)) return null;
  try {
    return await new ConvexHttpClient(url).query(api.sharing.publicLinkCard, { token, serverSecret: secret });
  } catch {
    return null;
  }
});

/** The note themes with the admins' changes and added ones, so a card shows its theme as the app does. */
export async function loadCardThemes(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) return;
  try {
    setThemeRows((await new ConvexHttpClient(url).query(api.themes.list, {})) as ThemeRow[]);
  } catch {
    // The shipped themes still draw it.
  }
}
