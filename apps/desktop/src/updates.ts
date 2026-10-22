// Updates for the distributed Mac app (a Developer ID build, notarized): Electron's own autoUpdater
// (Squirrel.Mac) reads a static RELEASES.json that scripts/publish.mjs puts in the update bucket beside
// each version's ZIP, so the shell needs no extra packages. Checked at launch and every six hours; a
// downloaded update installs when Folevi quits, or now from "Restart to Update". The personal build (Apple
// Development signature, `pnpm release`) can't install updates, so it doesn't look for them.
import { app, autoUpdater } from "electron";
import { spawnSync } from "node:child_process";

/** Where the update bucket is served from (Cloudflare R2's public address for it). */
export const UPDATE_BASE_URL = process.env.FOLEVI_UPDATE_URL ?? "https://updates.folevi.com";
/** The feed for this build: one file for both Apple silicon and Intel (a universal build). */
export const feedUrl = (base = UPDATE_BASE_URL) => `${base.replace(/\/+$/, "")}/mac/darwin-universal/RELEASES.json`;

const SIX_HOURS = 6 * 60 * 60 * 1000;

export type UpdateState =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "downloading" }
  // 1.22: downloaded, the normal sync sending what's waiting before it's offered (handover.ts).
  | { state: "finishing"; version: string }
  | { state: "ready"; version: string }
  | { state: "none" }
  | { state: "error" };

/** Whether this copy of the app can install updates: packaged, and signed with a Developer ID. */
function canUpdate(): boolean {
  if (!app.isPackaged || process.env.FOLEVI_UPDATES === "off") return false;
  const bundle = app.getPath("exe").replace(/\/Contents\/MacOS\/[^/]+$/, "");
  // codesign writes the signature's details to stderr.
  const { stderr } = spawnSync("codesign", ["-dv", "--verbose=2", bundle], { encoding: "utf8" });
  return /Authority=Developer ID Application:/.test(stderr ?? "");
}

/**
 * Starts looking for updates; `onChange` hears every change (the app menu shows it). Returns "check now".
 * `beforeReady` runs once an update is downloaded, before it's offered (1.22: the sync finishes first).
 */
export function startUpdates(onChange: (s: UpdateState) => void, o: { beforeReady?: () => Promise<void> } = {}): (() => void) | null {
  if (!canUpdate()) return null;
  let state: UpdateState = { state: "idle" };
  const set = (next: UpdateState) => {
    state = next;
    onChange(next);
  };
  autoUpdater.setFeedURL({ url: feedUrl(), serverType: "json" });
  autoUpdater.on("checking-for-update", () => set({ state: "checking" }));
  autoUpdater.on("update-available", () => set({ state: "downloading" }));
  autoUpdater.on("update-not-available", () => set({ state: "none" }));
  autoUpdater.on("update-downloaded", (_e, _notes, name) => {
    const version = String(name || "");
    if (!o.beforeReady) return set({ state: "ready", version });
    set({ state: "finishing", version });
    void o.beforeReady().finally(() => set({ state: "ready", version }));
  });
  // Offline, or the bucket isn't there yet: quietly try again later.
  autoUpdater.on("error", () => set({ state: "error" }));
  const check = () => {
    if (state.state === "ready" || state.state === "downloading" || state.state === "finishing") return;
    try {
      autoUpdater.checkForUpdates();
    } catch {
      set({ state: "error" });
    }
  };
  setTimeout(check, 30_000);
  setInterval(check, SIX_HOURS);
  return check;
}

/** Quits and installs the downloaded update. */
export function installUpdate() {
  autoUpdater.quitAndInstall();
}
