// "Use this template" on folevi.com links to sign-up with ?template=<key>. The key is kept in this browser
// through sign-up, email confirmation and onboarding, and the app then opens that template as a new page.
// Only built-in template keys are kept; the server still checks the template exists and is switched on.
import { BUILT_IN_TEMPLATES } from "./templates";

const STORAGE_KEY = "folevi:pending-template";
/** A template picked more than a week ago is forgotten. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface PendingTemplate {
  key: string;
  name: string;
}

function builtIn(key: string | null | undefined): PendingTemplate | null {
  if (!key) return null;
  const t = BUILT_IN_TEMPLATES.find((x) => x.key === key);
  return t ? { key: t.key, name: t.name } : null;
}

/** Remembers a template picked on the site (ignored unless it's a built-in template key). */
export function rememberTemplate(key: string | null | undefined): void {
  if (!builtIn(key)) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ key, at: Date.now() }));
  } catch {
    // Storage blocked (private window): the person picks it from Templates instead.
  }
}

/** The template waiting to be opened in this browser, if any. */
export function pendingTemplate(): PendingTemplate | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as { key?: unknown; at?: unknown };
    if (typeof saved.key !== "string" || typeof saved.at !== "number" || Date.now() - saved.at > MAX_AGE_MS) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return builtIn(saved.key);
  } catch {
    return null;
  }
}

export function clearPendingTemplate(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clear.
  }
}
