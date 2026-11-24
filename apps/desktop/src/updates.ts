// Updates for Folevi for Windows: electron-updater reads latest.yml from Folevi's download site, one feed per
// architecture (https://folevi.com/download/windows/x64/ and .../arm64/, the same R2 bucket as the Mac's,
// folevi-updates), so a Windows on ARM PC only ever downloads the arm64 build and an Intel or AMD PC the x64 one.
// The feed's address is written into the app at build time (electron-builder's publish setting, app-update.yml);
// FOLEVI_UPDATE_URL points a test run elsewhere. Checked a minute after launch and every six hours; a downloaded
// update installs when Folevi quits, or now from "Restart to update".
import { app } from "electron";
import { canUpdate, feedUrl } from "./updateFeed";

export { canUpdate, feedUrl, UPDATE_BASE_URL } from "./updateFeed";

export type UpdateState =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "downloading"; percent?: number }
  | { state: "ready"; version: string }
  | { state: "none" }
  | { state: "error" };

const SIX_HOURS = 6 * 60 * 60 * 1000;

type Updater = typeof import("electron-updater").autoUpdater;
let updater: Updater | null = null;

/**
 * Starts looking for updates; `onChange` hears every change (the tray menu and Settings show it). Returns "check
 * now", or null when this copy doesn't update itself.
 */
export function startUpdates(onChange: (s: UpdateState) => void, o: { portable: boolean }): (() => void) | null {
  if (!canUpdate({ platform: process.platform, packaged: app.isPackaged, env: process.env, portable: o.portable })) return null;
  // Loaded only here: development runs and tests never need it.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { autoUpdater } = require("electron-updater") as typeof import("electron-updater");
  updater = autoUpdater;
  const feed = feedUrl(process.arch);
  if (!feed) return null;
  if (process.env.FOLEVI_UPDATE_URL) autoUpdater.setFeedURL({ provider: "generic", url: feed });
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowDowngrade = false;
  autoUpdater.logger = null;
  let state: UpdateState = { state: "idle" };
  const set = (next: UpdateState) => {
    state = next;
    onChange(next);
  };
  // (Its typed events come from a package pnpm keeps out of reach of this one's types: a plain EventEmitter here.)
  const events = autoUpdater as unknown as NodeJS.EventEmitter;
  events.on("checking-for-update", () => set({ state: "checking" }));
  events.on("update-available", () => set({ state: "downloading" }));
  events.on("download-progress", (p: { percent?: number }) => set({ state: "downloading", percent: typeof p?.percent === "number" ? Math.round(p.percent) : undefined }));
  events.on("update-not-available", () => set({ state: "none" }));
  events.on("update-downloaded", (info: { version?: string }) => set({ state: "ready", version: String(info?.version ?? "") }));
  // Offline, or no feed there yet: quietly try again later.
  events.on("error", () => set({ state: "error" }));
  const check = () => {
    if (state.state === "ready" || state.state === "downloading") return;
    autoUpdater.checkForUpdates().catch(() => set({ state: "error" }));
  };
  setTimeout(check, 60_000);
  setInterval(check, SIX_HOURS);
  return check;
}

/** Quits and installs the downloaded update (silently, then Folevi opens again). */
export function installUpdate() {
  updater?.quitAndInstall(true, true);
}
