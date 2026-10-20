// What the bundled shell knows about admin-managed data without a server: the theme rows (with their uploaded
// images copied into the shell) and which built-in templates admins switched off. Written at build time by
// scripts/snapshot-themes.mjs into the export as /shell/snapshot.json.
//
// For the local backend (WP7b): themes.list answers `themes`, and settings.builtInTemplates answers
// BUILT_IN_TEMPLATES from @folevi/editor-schema minus `templates.disabled` (the same mapping as
// convex/settings.ts). Account mode keeps reading both from the server.
import type { ThemeRow } from "@/lib/themes";
import { isShell } from "./index";

export interface ShellSnapshot {
  version: 1;
  builtAt: number;
  /** The Convex deployment's host it was taken from, or null for an empty snapshot (an offline build). */
  source: string | null;
  themes: ThemeRow[];
  templates: { disabled: string[] };
}

export const EMPTY_SNAPSHOT: ShellSnapshot = { version: 1, builtAt: 0, source: null, themes: [], templates: { disabled: [] } };

let pending: Promise<ShellSnapshot> | null = null;

/** The build's snapshot (fetched once from the shell's own files); empty on the website or if it's missing. */
export function loadShellSnapshot(): Promise<ShellSnapshot> {
  if (!isShell() || typeof window === "undefined") return Promise.resolve(EMPTY_SNAPSHOT);
  pending ??= fetch("/shell/snapshot.json")
    .then((r) => (r.ok ? (r.json() as Promise<ShellSnapshot>) : EMPTY_SNAPSHOT))
    .then((s) => (s && s.version === 1 && Array.isArray(s.themes) ? s : EMPTY_SNAPSHOT))
    .catch(() => EMPTY_SNAPSHOT);
  return pending;
}
