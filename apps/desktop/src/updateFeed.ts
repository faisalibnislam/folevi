// Where Folevi for Windows looks for updates, and whether a copy updates itself at all (updates.ts), kept apart
// from Electron so the tests can read them.

/** Where the feeds are: one folder per architecture beneath it. */
export const UPDATE_BASE_URL = "https://folevi.com/download/windows";

/** The feed for an architecture ("x64" or "arm64"; anything else has none). */
export function feedUrl(arch: string, base = process.env.FOLEVI_UPDATE_URL ?? UPDATE_BASE_URL): string | null {
  if (arch !== "x64" && arch !== "arm64") return null;
  return `${base.replace(/\/+$/, "")}/${arch}`;
}

/** Whether this copy can update itself: an installed (NSIS) Windows build. The portable ZIP and development runs can't. */
export function canUpdate(o: { platform: string; packaged: boolean; env: NodeJS.ProcessEnv; portable: boolean }): boolean {
  return o.platform === "win32" && o.packaged && !o.portable && o.env.FOLEVI_UPDATES !== "off";
}
