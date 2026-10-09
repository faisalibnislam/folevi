// Which addresses are Folevi's own (they open in the app's windows and may use the bridge) and which open in
// the browser instead.

/** The web app the windows show: production, unless FOLEVI_URL points somewhere else (the local dev server). */
export const APP_URL = new URL(process.env.FOLEVI_URL ?? "https://app.folevi.com");

/** Whether a URL belongs to the app the windows show (same origin as APP_URL). */
export function isAppUrl(raw: string): boolean {
  try {
    return new URL(raw).origin === APP_URL.origin;
  } catch {
    return false;
  }
}

/** A path inside the app ("/d/01…") as a full URL; anything that isn't a plain path falls back to the start page. */
export function appUrl(path = "/"): string {
  const safe = typeof path === "string" && path.startsWith("/") && !path.startsWith("//") ? path : "/";
  return new URL(safe, APP_URL).toString();
}

/** Links that are fine to hand to the browser or mail app (never file:, javascript: or custom schemes). */
export function isExternalSafe(raw: string): boolean {
  try {
    return ["http:", "https:", "mailto:"].includes(new URL(raw).protocol);
  } catch {
    return false;
  }
}
