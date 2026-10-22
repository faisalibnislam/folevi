// Folevi for Mac: app.folevi.com in a window of its own, plus what a browser tab can't do: Quick Add from any
// app (⌥Space), a menu bar icon, opening at login, Mac notifications and the Dock badge.
// With the bundled interface switched on (FOLEVI_SHELL=1, or "bundledShell": true in settings.json), the
// windows show the interface built into the app from app://folevi instead (protocol.ts, docs/LOCAL_MODE_PLAN.md
// WP2). Off by default until the rest of local mode is ready.
import {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  net,
  Notification,
  powerMonitor,
  protocol,
  safeStorage,
  screen,
  session,
  shell,
  systemPreferences,
  Tray,
  WebContentsView,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type MenuItemConstructorOptions,
  type Session,
  type WebContents,
  webContents as allContents,
} from "electron";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import {
  appUrl,
  APP_URL,
  BUNDLED_URL,
  dragFileName,
  isAppUrl,
  isSignInReturn,
  isSignInStart,
  linkTarget,
  originOf,
  parseDeepLink,
  SCHEME,
  SERVICE_URL,
  systemSettingsUrl,
  useBundledApp,
} from "./urls";
import { installUpdate, startUpdates, type UpdateState } from "./updates";
import { cleanSettings, loadSettings, pageSettings, saveSettings, type DesktopSettings } from "./settings";
import { APP_SCHEME, APP_SCHEME_PRIVILEGES, createAppHandler, HANDOFF_CSP, HANDOFF_PAGE, HANDOFF_PATH, isBlockedInLocalMode, localModeBlockPatterns, NO_LIBRARY_FILES, shellRoot } from "./protocol";
import { handOver, handoffDue, indexedDbFolder, kitScript, parseHandoffState, type HandoffState, type KitCall } from "./handoff";
import { readShellBuild, shellBuildProblems, type ShellBuild } from "./shellBuild";
import { restoreWindow, saveWindow } from "./windowState";
import { Reminders, type Reminder } from "./reminders";
import { downloadCalendar } from "./calendarFetch";
import { saveFromPage } from "./saveFile";
import { imageBytes, oneAtATime, runHelper } from "./textRecognition";
import { startCloud } from "./library/cloud/electron";
import { createAuthBridge, isAuthCallback, registerAuthIpc, type AuthBridge } from "./authBridge";
import { registerLibraryIpc, type IpcMainLike } from "./library/ipc";
import { LibraryService, type CloudSource } from "./library/service";
import { createSecretStore } from "./secrets";
import { AppLock, electronCover } from "./lock";
import { AiService, allowedAiUrl, HelperClient, registerAiIpc } from "./ai";
import { DeviceKeys, registerE2eeIpc } from "./e2ee";
import { LIBRARY, PlacesStore, userIdOf } from "./places";
import type { SessionUser } from "./authBridge";

const PARTITION = "persist:folevi";

/** This Mac's name as the person set it in System Settings (for the library's device list), read once. */
let computerNameCache: string | null = null;
function computerName(): string {
  if (computerNameCache !== null) return computerNameCache;
  let name = "";
  try {
    name = execFileSync("/usr/sbin/scutil", ["--get", "ComputerName"], { encoding: "utf8", timeout: 2000 }).trim();
  } catch {
    /* fall back to the host name */
  }
  if (!name) name = hostname().replace(/\.local$/i, "");
  computerNameCache = name.slice(0, 80) || "Mac";
  return computerNameCache;
}
const settingsFile = () => join(app.getPath("userData"), "settings.json");
const windowFile = () => join(app.getPath("userData"), "window.json");
const asset = (name: string) => join(__dirname, "..", "assets", name);

let settings: DesktopSettings;
let folevi: Session | null = null;
let mainWindow: BrowserWindow | null = null;
let quickAdd: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let shortcutError: string | null = null;
let recent: { id: string; title: string }[] = [];
let status = "";
let update: UpdateState = { state: "idle" };
let checkForUpdates: (() => void) | null = null;
/** A folevi:// link that arrived before the app was ready. */
let pendingLink: string | null = null;
/** A Google or Apple sign-in in the browser on its way (desktop:sign-in): answered by the folevi://auth/google link it ends on. */
let pendingSignIn: ((url: string | null) => void) | null = null;
/** The built-in interface's account sign-in (authBridge.ts): only with the bundled interface. */
let authBridge: AuthBridge | null = null;
/** Foli AI in local mode (ai.ts): Apple's model through folevi-ai, or the person's own keys. Bundled interface only. */
let ai: AiService | null = null;
let aiHelper: HelperClient | null = null;
/** The Touch ID lock (lock.ts): only with the bundled interface. */
let appLock: AppLock | null = null;
let lockCover: ReturnType<typeof electronCover> | null = null;
/**
 * This Mac's end-to-end encryption device keys (e2ee.ts): made on the page's first ask, private halves sealed
 * with safeStorage in userData/e2ee. For the website the app shows and for the built-in interface alike.
 */
let deviceKeys: DeviceKeys | null = null;
const e2eeKeys = () =>
  (deviceKeys ??= new DeviceKeys({
    dir: join(app.getPath("userData"), "e2ee"),
    cipher: safeStorage,
    touchId: { canPrompt: () => systemPreferences.canPromptTouchID(), prompt: (reason) => systemPreferences.promptTouchID(reason) },
  }));

// ---------------------------------------------------------------- several places (docs/MULTI_ACCOUNT_PLAN.md §2.2)

/**
 * The library on this Mac and any number of accounts (places.ts): the bundled interface only. Each page is bound
 * to one place (`bound`, by webContents id, set as it starts loading): its session (`auth.session.<user id>`), its
 * encryption keys and its reminders are that place's, never one the page names. Main windows show the open place;
 * every other place has a hidden runner window (/place-sync) that keeps it in sync and its notifications coming.
 */
let places: PlacesStore | null = null;
const bound = new Map<number, string | null>();
const runners = new Map<string, BrowserWindow>();
/** The unread count the open place's window reports (desktop:badge); other places' come from places.json. */
let currentBadge = 0;
/** The account signed in last (a sign-in from the library opens it once the page has said what to do). */
let lastAdded: string | null = null;
/** Whether the library is set up (library.info().configured), for its runner. */
let libraryConfigured = false;

/** The place a page is bound to (main windows: the open place, until they load again). */
function placeOfContents(wc: WebContents | null | undefined): string | null {
  if (wc && bound.has(wc.id)) return bound.get(wc.id) ?? null;
  return places?.state.current ?? null;
}
const placeOfEvent = (e: unknown) => placeOfContents((e as IpcMainInvokeEvent | null)?.sender ?? null);

/** How a place's pages open: "local" (the library), "account", or "unset" (the first-launch choice). */
function modeOf(place: string | null): DesktopSettings["mode"] {
  if (!places) return settings.mode;
  return places.modeOf(place);
}

/** Keeps a window bound to the place it loads: `place` is asked each time its page starts loading. */
function bindOnLoad(win: BrowserWindow, place: () => string | null) {
  const id = win.webContents.id;
  bound.set(id, place());
  win.webContents.on("did-start-navigation", (details) => {
    if (details.isMainFrame && !details.isSameDocument) bound.set(id, place());
  });
  win.on("closed", () => bound.delete(id));
}

/** Each account's own encryption keys (userData/e2ee/accounts/<user id>); the library and older builds use the Mac's first pair. */
const accountKeys = new Map<string, DeviceKeys>();
function keysFor(event?: unknown): DeviceKeys {
  const user = bundled && event ? userIdOf(placeOfEvent(event)) : null;
  if (!user) return e2eeKeys();
  let k = accountKeys.get(user);
  if (!k) {
    k = new DeviceKeys({
      dir: join(app.getPath("userData"), "e2ee", "accounts", user),
      cipher: safeStorage,
      touchId: { canPrompt: () => systemPreferences.canPromptTouchID(), prompt: (reason) => systemPreferences.promptTouchID(reason) },
    });
    accountKeys.set(user, k);
  }
  return k;
}

/** The Mac's first pair of keys belonged to the one account older builds had: they become that account's. */
function adoptLegacyKeys(userId: string) {
  const legacy = join(app.getPath("userData"), "e2ee");
  const target = join(legacy, "accounts", userId);
  if (existsSync(target) || !existsSync(join(legacy, "device.bin"))) return;
  try {
    mkdirSync(target, { recursive: true, mode: 0o700 });
    for (const f of ["device.bin", "device.json", "prefs.json"]) if (existsSync(join(legacy, f))) renameSync(join(legacy, f), join(target, f));
  } catch {
    /* tried again with the next sign-in */
  }
}

// Folevi puts its window back itself (windowState.ts). macOS's own window restoration adds nothing but a
// "reopen its windows?" alert after a forced quit (an update replacing the app, a hang), and that alert
// blocks startup until it's answered, so the app looks frozen. It's switched off, and any saved state
// (with its crash history) is cleared, so the alert can't come back.
if (process.platform === "darwin") {
  systemPreferences.setUserDefault("ApplePersistenceIgnoreState", "boolean", true);
  systemPreferences.setUserDefault("NSQuitAlwaysKeepsWindows", "boolean", false);
  rmSync(join(app.getPath("home"), "Library", "Saved Application State", "com.folevi.mac.savedState"), { recursive: true, force: true });
}

// Test runs keep their own sign-in and settings, apart from the installed app's.
if (process.env.FOLEVI_USER_DATA) app.setPath("userData", process.env.FOLEVI_USER_DATA);

// ---------------------------------------------------------------- the bundled interface (on in packaged apps)

settings = loadSettings(settingsFile());
/**
 * Whether the windows show the interface built into the app (app://folevi) rather than the website: always
 * with FOLEVI_SHELL=1; otherwise in a packaged app that carries the built-in copy, unless the settings file
 * or FOLEVI_SHELL=0 turns it off. Development runs keep the website unless FOLEVI_SHELL=1.
 */
const bundled =
  process.env.FOLEVI_SHELL === "1" ||
  (process.env.FOLEVI_SHELL !== "0" && settings.bundledShell && app.isPackaged && existsSync(join(process.resourcesPath, "web", "index.html")));
if (bundled) {
  // Before `ready`: standard + secure give app://folevi a real origin (IndexedDB, Web Locks, crypto.subtle).
  protocol.registerSchemesAsPrivileged([{ scheme: APP_SCHEME, privileges: APP_SCHEME_PRIVILEGES }]);
  // FOLEVI_SHELL_DEV_URL: `next dev` with FOLEVI_BUILD=shell (development only).
  useBundledApp(app.isPackaged ? null : process.env.FOLEVI_SHELL_DEV_URL);
}

// ---------------------------------------------------------------- one Folevi at a time

// Opening Folevi again brings the running one forward.
if (!app.requestSingleInstanceLock()) app.quit();
app.on("second-instance", () => showMain());

// ---------------------------------------------------------------- folevi:// links

// macOS hands links over with open-url, which can come before the app is ready (a link opened Folevi).
app.on("will-finish-launching", () => {
  app.on("open-url", (event, url) => {
    event.preventDefault();
    if (app.isReady()) openLink(url);
    else pendingLink = url;
  });
});

function openLink(url: string) {
  // The end of signing in the built-in interface in the browser (authBridge.ts): the app trades the code.
  if (isAuthCallback(url)) {
    authBridge?.handleCallback(url);
    showMain();
    return;
  }
  // The end of a Google sign-in in the browser: back to the page that started it (it redeems the code).
  if (isSignInReturn(url)) {
    pendingSignIn?.(url);
    pendingSignIn = null;
    showMain();
    return;
  }
  const link = parseDeepLink(url);
  if (!link) return;
  if (link.type === "new-note") commandMain({ type: "new-note" });
  else if (link.type === "quick-add") toggleQuickAdd();
  else showMain(link.path);
}

// ---------------------------------------------------------------- the session every window shares

function setUpSession(): Session {
  const ses = session.fromPartition(PARTITION);
  // The site can tell it's in the Mac app (e.g. to say "Open Folevi" rather than "Open in browser").
  ses.setUserAgent(`${ses.getUserAgent()} FoleviDesktop/${app.getVersion()}`);
  // Only Folevi's own pages get anything, and only what the web app uses: the microphone (audio notes),
  // this Mac's sound (recording a call, below), the clipboard (paste) and full screen (presenting).
  const allowed = new Set(["media", "display-capture", "clipboard-read", "clipboard-sanitized-write", "fullscreen", "notifications"]);
  ses.setPermissionRequestHandler((_wc, permission, callback, details) => {
    const audioOnly = permission !== "media" || ("mediaTypes" in details && (details.mediaTypes ?? []).every((t) => t === "audio"));
    callback(isAppUrl(details.requestingUrl) && allowed.has(permission) && audioOnly);
  });
  ses.setPermissionCheckHandler((_wc, permission, origin) => isAppUrl(origin) && allowed.has(permission));
  // Recording a call (the web recorder's "Call" choice): getDisplayMedia from Folevi's own pages gets the
  // whole screen with this Mac's sound ("loopback", ScreenCaptureKit on macOS 13+). The page drops the
  // picture at once and records only the sound. Asking for the sources is what makes macOS ask for Screen &
  // System Audio Recording the first time, so a missing permission isn't refused here: the page checks it
  // afterwards (desktop:screen-access) and explains. Anyone else asking is refused (the page gets an
  // AbortError). getDisplayMedia also passes the "media" permission check above, with no media types.
  ses.setDisplayMediaRequestHandler(
    (request, callback) => {
      if (!isAppUrl(request.securityOrigin) || !request.audioRequested || systemPreferences.getMediaAccessStatus("screen") === "restricted") {
        callback({});
        return;
      }
      desktopCapturer
        .getSources({ types: ["screen"], thumbnailSize: { width: 0, height: 0 } })
        .then((sources) => callback(sources[0] ? { video: sources[0], audio: "loopback" } : {}))
        .catch(() => callback({}));
    },
    { useSystemPicker: false },
  );
  return ses;
}

/**
 * Links to anywhere but Folevi open in the browser; Folevi's own "open in a new tab" opens a new window. With
 * the bundled interface, a link to one of the app's pages on the website opens in the app too, and the
 * website's other pages (sign-in, share links) open in the browser (urls.ts linkTarget).
 */
function guardNavigation(contents: WebContents) {
  contents.on("will-navigate", (event, url) => {
    if (isAppUrl(url) || url.startsWith("file:")) return;
    event.preventDefault();
    const target = linkTarget(url);
    if (target.kind === "app") void contents.loadURL(appUrl(target.path)).catch(() => undefined);
    else if (target.kind === "browser") void shell.openExternal(url);
  });
  contents.setWindowOpenHandler(({ url }) => {
    const target = linkTarget(url);
    if (target.kind === "app") createMainWindow(target.path);
    else if (target.kind === "browser") void shell.openExternal(url);
    return { action: "deny" };
  });
}

const webPreferences = () => ({
  preload: join(__dirname, "preload.js"),
  partition: PARTITION,
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  webviewTag: false,
  spellcheck: true,
});

const background = () => (nativeTheme.shouldUseDarkColors ? "#0E0E0F" : "#FFFFFF");

/**
 * In local mode one window hosts the library for all of them (apps/web/src/lib/local/host.ts), and it may be a
 * hidden one: the main window put away, or the Quick Add window. Chromium slows a hidden page's timers to once a
 * minute after a while, which would hold back the library's writes to its folder, so those windows keep full
 * speed while the app is in local mode. (Elsewhere, and on the website, hidden windows stay slowed down.)
 */
function applyThrottling(win: BrowserWindow) {
  if (!win.isDestroyed()) win.webContents.setBackgroundThrottling(!(bundled && modeOf(placeOfContents(win.webContents)) === "local"));
}

/**
 * The website's database on this Mac is newer than the bundled interface can open (handoff.ts): the windows
 * show "Update Folevi" instead of the app, and nothing is copied or opened until an updated app runs.
 */
let needsUpdate = false;

/** Loads a page, or the offline page (with a way back) when neither the network nor the site's cache has it. */
function load(win: BrowserWindow, url: string) {
  if (needsUpdate && isAppUrl(url)) {
    void win.loadFile(asset("update.html"));
    return;
  }
  win.webContents.once("did-fail-load", (_e, code, _desc, failedUrl, isMainFrame) => {
    // -3: a navigation replaced this one (not a failure).
    if (!isMainFrame || code === -3 || win.isDestroyed()) return;
    void win.loadFile(asset("offline.html"), { query: { url: failedUrl || url } });
  });
  void win.loadURL(url).catch(() => undefined);
}

// ---------------------------------------------------------------- the bundled interface

/** What the bundled interface is (shell/build.json, shellBuild.ts): its deployment and IndexedDB version. */
let shellBuild: ShellBuild | null = null;

/** Serves app://folevi on the session: the export built into the app, by mode (protocol.ts). */
function installBundledInterface(ses: Session) {
  const root = shellRoot({ packaged: app.isPackaged, resourcesPath: process.resourcesPath, appDir: join(__dirname, ".."), env: process.env });
  if (!existsSync(join(root, "index.html"))) console.error(`Folevi: no bundled interface at ${root} (run \`pnpm shell\`).`);
  shellBuild = readShellBuild(root);
  for (const problem of shellBuildProblems(shellBuild, { version: app.getVersion(), packaged: app.isPackaged, serviceUrl: SERVICE_URL.href })) console.error(`Folevi: ${problem}.`);
  const extraConnect = (process.env.FOLEVI_SHELL_CONNECT ?? "").split(/[\s,]+/).filter((o) => /^(https?|wss?):\/\/[^\s;']+$/.test(o));
  ses.protocol.handle(
    APP_SCHEME,
    createAppHandler({
      root,
      // A runner's and Quick Add's page names its place (`?place=`); main windows show the open place.
      mode: (url) => {
        const named = url && (url.pathname === "/place-sync" || url.pathname === "/quick-add") ? url.searchParams.get("place") : null;
        return modeOf(named && places?.has(named) ? named : (places?.state.current ?? null));
      },
      csp: { serviceOrigin: SERVICE_URL.origin, extraConnect },
      // A local library's attachments (src/library/attachments.ts: STREAM chunks decrypted, by Range).
      files: library?.files ?? NO_LIBRARY_FILES,
    }),
  );
}

/**
 * folevi-files, the coordinated file helper (src/library/helper.ts): the signed helper app's (Contents/Helpers/
 * FoleviFiles.app, which may use Folevi's iCloud container), with the bare binary in Resources if that can't
 * run; from source, native-build/'s.
 */
const filesHelperApp = (base: string) => join(base, "FoleviFiles.app", "Contents", "MacOS", "folevi-files");
const filesHelperBare = () => (app.isPackaged ? join(process.resourcesPath, "folevi-files") : join(__dirname, "..", "native-build", "folevi-files"));
const filesHelper = () => {
  const bundled = filesHelperApp(app.isPackaged ? join(process.resourcesPath, "..", "Helpers") : join(__dirname, "..", "native-build"));
  return existsSync(bundled) ? bundled : filesHelperBare();
};

let library: LibraryService | null = null;
/**
 * shell.library (docs/LOCAL_MODE_PLAN.md §4.2): the local library's files, journal, passphrase and moves, in
 * this process (src/library/). The key never reaches the page; safeStorage keeps it on this Mac.
 */
function createLibrary(cloud: CloudSource | null): LibraryService {
  const service = new LibraryService({
    // "Sync with Dropbox" / "Sync with Google Drive" libraries go through the connection (library/cloud/).
    cloud,
    userData: app.getPath("userData"),
    home: app.getPath("home"),
    helperPath: filesHelper(),
    helperFallback: filesHelperBare(),
    sealer: safeStorage,
    chooseFolder: async ({ title, defaultPath }) => {
      const parent = BrowserWindow.getFocusedWindow() ?? mainWindow;
      const o = { title, defaultPath, buttonLabel: "Use This Folder", properties: ["openDirectory", "createDirectory"] as ("openDirectory" | "createDirectory")[] };
      const r = parent ? await dialog.showOpenDialog(parent, o) : await dialog.showOpenDialog(o);
      return r.canceled ? null : (r.filePaths[0] ?? null);
    },
  });
  void service.open().catch((e) => console.error("Folevi library:", e));
  return service;
}

/**
 * foleviShell.auth (authBridge.ts): the account session for the built-in interface, kept with safeStorage in
 * the app's support folder and never given to the page. Its requests go through a session of their own that
 * keeps no cookies, and that session adds `Origin: SERVICE_URL` (Chromium refuses an Origin set on the request
 * itself; Better Auth checks the origin of requests with cookies, and may grow stricter, docs/LOCAL_MODE.md S4).
 */
function createShellAuth(): AuthBridge {
  const ses = session.fromPartition("folevi-auth");
  ses.webRequest.onBeforeSendHeaders({ urls: [`${SERVICE_URL.origin}/api/auth/*`] }, (details, callback) => {
    callback({ requestHeaders: { ...details.requestHeaders, Origin: SERVICE_URL.origin } });
  });
  return createAuthBridge({
    serviceUrl: SERVICE_URL,
    fetch: (url, init) => {
      // The session's hook sets Origin (above); one on the request would make Chromium refuse it.
      const headers = { ...((init.headers ?? {}) as Record<string, string>) };
      delete headers.origin;
      return ses.fetch(url, { ...init, headers, credentials: "omit", bypassCustomProtocolHandlers: true });
    },
    openExternal: (url) => shell.openExternal(url),
    store: createSecretStore(join(app.getPath("userData"), "secrets"), safeStorage),
    deviceName: () => hostname().replace(/\.local$/, ""),
  });
}

/** folevi-ai, the on-device model helper (ai.ts): in Resources, or native-build/ from source. */
const aiHelperPath = () => (app.isPackaged ? join(process.resourcesPath, "folevi-ai") : join(__dirname, "..", "native-build", "folevi-ai"));

/**
 * foleviShell.ai (ai.ts): the person's own keys go over HTTPS from this process, through a session of its own
 * that keeps no cookies and refuses every address but the three providers' (ai.ts allowedAiUrl, checked again
 * before each request there); Apple's on-device model runs in folevi-ai, started when first needed.
 */
function createAi(): AiService {
  const ses = session.fromPartition("folevi-ai");
  ses.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !allowedAiUrl(details.url) }));
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  aiHelper = new HelperClient({ path: aiHelperPath() });
  return new AiService({
    fetch: (url, init) => ses.fetch(url, { ...init, credentials: "omit", bypassCustomProtocolHandlers: true }),
    secrets: createSecretStore(join(app.getPath("userData"), "secrets"), safeStorage),
    helper: () => aiHelper,
  });
}

/**
 * The Touch ID lock (lock.ts): covers the windows at launch, when the Mac locks or sleeps, and when Folevi
 * comes back after being away longer than its setting, until Touch ID unlocks it.
 */
function startLock() {
  lockCover = electronCover({
    windows: () => BrowserWindow.getAllWindows(),
    makeView: () => new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false, partition: "folevi-lock" } }),
    onUnlock: () => void appLock?.unlock(),
  });
  appLock = new AppLock({
    file: join(app.getPath("userData"), "lock.json"),
    canPrompt: () => systemPreferences.canPromptTouchID(),
    prompt: (reason) => systemPreferences.promptTouchID(reason),
    cover: lockCover,
  });
  app.on("browser-window-focus", () => appLock?.back());
  // Away once no Folevi window has the focus (focus moving between its own windows isn't leaving).
  app.on("browser-window-blur", () => setTimeout(() => !BrowserWindow.getFocusedWindow() && appLock?.away(), 0));
  powerMonitor.on("lock-screen", () => appLock?.lockNow());
  powerMonitor.on("suspend", () => appLock?.lockNow());
}

/**
 * FOLEVI_OFFLINE=1 starts the app with no network at all: every session cancels http, https, ws and wss from
 * its first request (only the handoff's blank page, which the app answers itself, goes through). For testing
 * a cold offline start of a packaged build, which, unlike a development run, can't load a fixture with
 * `electron -r` (e2e/desktop-windows.spec.ts).
 */
const noNetwork = process.env.FOLEVI_OFFLINE === "1";
if (noNetwork) {
  app.on("session-created", (ses) => {
    ses.webRequest.onBeforeRequest((details, callback) => {
      let url: URL | null = null;
      try {
        url = new URL(details.url);
      } catch {
        url = null;
      }
      callback({ cancel: !!url && ["http:", "https:", "ws:", "wss:"].includes(url.protocol) && url.pathname !== HANDOFF_PATH });
    });
  });
}

/**
 * Local mode never contacts Folevi: besides the page's policy, the session cancels every request to Folevi's and
 * Convex's hosts (and the website the app points at) from any page bound to the library, while an account's pages
 * (the open place's, or a runner's) in the same session go through.
 */
function applyNetworkGuard() {
  const ses = folevi;
  // (With no network at all, the session already cancels everything.)
  if (!ses || !bundled || noNetwork) return;
  const host = SERVICE_URL.hostname;
  ses.webRequest.onBeforeRequest({ urls: localModeBlockPatterns(host) }, (details, callback) => {
    const wc = details.webContents ?? (details.webContentsId ? allContents.fromId(details.webContentsId) : undefined);
    callback({ cancel: modeOf(placeOfContents(wc)) === "local" && isBlockedInLocalMode(details.url, host) });
  });
}

const handoffFile = () => join(app.getPath("userData"), "handoff.json");

/**
 * The one-time handoff (handoff.ts): edits that wait in the website origin's IndexedDB move to app://folevi.
 * The old origin is served locally for its one blank page while this runs (its other addresses go to the
 * network as usual), so nothing of the website runs and nothing is fetched from it.
 */
async function runHandoff(ses: Session) {
  if (APP_URL !== BUNDLED_URL) return; // the shell dev server: its origin isn't the app's
  let previous: HandoffState | null = null;
  try {
    previous = parseHandoffState(readFileSync(handoffFile(), "utf8"));
  } catch {
    previous = null;
  }
  if (!handoffDue(previous)) return;
  // Which app and interface ran it, for the record (and for an update that comes after).
  const record = (s: HandoffState) => {
    try {
      writeFileSync(handoffFile(), JSON.stringify({ ...s, appVersion: app.getVersion(), dbVersion: shellBuild?.dbVersion ?? null }, null, 2));
    } catch {
      /* Tried again next launch. */
    }
  };
  const old = new URL(SERVICE_URL.origin);
  const attempts = (previous?.attempts ?? 0) + 1;
  // The website never stored anything in this session: nothing to hand over.
  if (!existsSync(join(app.getPath("userData"), "Partitions", "folevi", "IndexedDB", indexedDbFolder(old)))) {
    record({ state: "done", attempts, at: Date.now(), from: old.origin, report: { copied: [], skipped: [], storage: 0, idle: [] } });
    return;
  }
  const scheme = old.protocol.replace(/:$/, "");
  ses.protocol.handle(scheme, (request) => {
    const url = new URL(request.url);
    if (originOf(url) === originOf(old) && url.pathname === HANDOFF_PATH) {
      return new Response(HANDOFF_PAGE, { headers: { "content-type": "text/html; charset=utf-8", "content-security-policy": HANDOFF_CSP, "cache-control": "no-store" } });
    }
    return net.fetch(request, { bypassCustomProtocolHandlers: true });
  });
  const windows: BrowserWindow[] = [];
  const page = async (url: string): Promise<KitCall> => {
    const win = new BrowserWindow({ show: false, width: 200, height: 200, webPreferences: { partition: PARTITION, contextIsolation: true, sandbox: true, nodeIntegration: false } });
    windows.push(win);
    await win.loadURL(url);
    return (fn, ...args) => win.webContents.executeJavaScript(kitScript(fn, args));
  };
  let timer: NodeJS.Timeout | undefined;
  try {
    const work = (async () => handOver(await page(`${old.origin}${HANDOFF_PATH}`), await page(appUrl(HANDOFF_PATH)), { dbVersion: shellBuild?.dbVersion }))();
    const report = await Promise.race([work, new Promise<never>((_r, reject) => (timer = setTimeout(() => reject(new Error("timed out")), 120_000)))]);
    // The website's database is newer than this interface opens: nothing was copied, and the app asks for an
    // update rather than opening without those edits (or failing to open the database at all).
    if (report.newer?.length) {
      record({ state: "update", attempts: previous?.attempts ?? 0, at: Date.now(), from: old.origin, report });
      needsUpdate = true;
      console.error(`Folevi handoff: ${report.newer.map((d) => `${d.name} is at version ${d.version}`).join(", ")}; this build opens version ${shellBuild?.dbVersion}. Update Folevi.`);
      return;
    }
    record({ state: "done", attempts, at: Date.now(), from: old.origin, report });
    if (report.copied.length) console.log(`Folevi handoff: ${report.copied.map((c) => `${c.name} (${c.records} records)`).join(", ")}`);
    // Someone who used Folevi for Mac with an account carries on in it: the first-launch choice ("Keep
    // notes on my devices" or "Sign in") is for new installs.
    if (settings.mode === "unset" && report.copied.length + report.skipped.length + report.idle.length > 0) {
      settings = { ...settings, mode: "account" };
      saveSettings(settingsFile(), settings);
    }
  } catch (e) {
    record({ state: "retry", attempts, at: Date.now(), from: old.origin, error: String(e instanceof Error ? e.message : e).slice(0, 500) });
    throw e;
  } finally {
    clearTimeout(timer);
    for (const w of windows) if (!w.isDestroyed()) w.destroy();
    ses.protocol.unhandle(scheme);
  }
}

// ---------------------------------------------------------------- main windows

function createMainWindow(path = "/documents"): BrowserWindow {
  const saved = restoreWindow(windowFile(), screen.getAllDisplays().map((d) => d.workArea));
  const first = !mainWindow;
  const win = new BrowserWindow({
    ...(first ? saved.bounds : { width: saved.bounds.width, height: saved.bounds.height }),
    // Wider than the web's phone layout (under 768 px), whose top bar would sit under the window buttons.
    minWidth: 800,
    minHeight: 480,
    show: false,
    title: "Folevi",
    // Seamless: no title bar; the window buttons sit in the app's own top bar, which the page makes draggable.
    titleBarStyle: "hidden",
    // The traffic lights go where the page keeps room for them (desktop:window-buttons).
    trafficLightPosition: { x: 20, y: 22 },
    backgroundColor: background(),
    webPreferences: webPreferences(),
  });
  if (first) {
    mainWindow = win;
    if (saved.maximized) win.maximize();
  }
  // Every main window shows the open place (it changes with a switch, which loads the windows again).
  if (bundled) bindOnLoad(win, () => places?.state.current ?? null);
  applyThrottling(win);
  guardNavigation(win.webContents);
  lockCover?.attach(win);
  win.once("ready-to-show", () => win.show());
  const remember = () => {
    if (win !== mainWindow || win.isDestroyed()) return;
    saveWindow(windowFile(), { bounds: win.isMaximized() ? saved.bounds : win.getNormalBounds(), maximized: win.isMaximized() });
  };
  win.on("resize", remember);
  win.on("move", remember);
  // Closing the first window hides it (Quick Add and the menu bar keep working); ⌘Q quits.
  win.on("close", (event) => {
    if (win === mainWindow && !quitting) {
      event.preventDefault();
      remember();
      win.hide();
    }
  });
  win.on("closed", () => {
    if (win === mainWindow) mainWindow = null;
  });
  load(win, appUrl(path));
  return win;
}

/** Brings the main window forward, at `path` when given (the page moves there without reloading). */
function showMain(path?: string) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createMainWindow(path);
    return;
  }
  if (path) {
    if (isAppUrl(mainWindow.webContents.getURL())) mainWindow.webContents.send("desktop:command", { type: "navigate", path });
    else load(mainWindow, appUrl(path));
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  app.focus({ steal: true });
}

/** The hidden runner windows: one per place no main window shows (docs/MULTI_ACCOUNT_PLAN.md §5.2). */
function ensureRunners() {
  if (!places || !bundled || needsUpdate) return;
  const want = new Set<string>();
  for (const a of places.state.accounts) if (a.id !== places.state.current) want.add(a.id);
  if (places.state.library && libraryConfigured && places.state.current !== LIBRARY) want.add(LIBRARY);
  for (const [id, win] of runners) {
    if (want.has(id) && !win.isDestroyed()) continue;
    runners.delete(id);
    if (!win.isDestroyed()) win.destroy();
  }
  for (const id of want) if (!runners.has(id)) runners.set(id, createRunner(id));
}

function createRunner(place: string): BrowserWindow {
  const win = new BrowserWindow({ show: false, width: 480, height: 320, paintWhenInitiallyHidden: false, webPreferences: webPreferences() });
  bindOnLoad(win, () => place);
  applyThrottling(win);
  guardNavigation(win.webContents);
  win.on("closed", () => {
    if (runners.get(place) === win) runners.delete(place);
  });
  load(win, appUrl(`/place-sync?place=${encodeURIComponent(place)}`));
  return win;
}

const isRunner = (wc: WebContents | null | undefined) => !!wc && [...runners.values()].some((w) => !w.isDestroyed() && w.webContents.id === wc.id);

/**
 * Opens a place in every main window (they load again, at `path`); the place that was open gets a runner. `null`
 * with `pending`: account mode with no account yet (the sign-in screen); without: the first-launch choice.
 */
function switchTo(place: string | null, path = "/documents", o: { pending?: boolean } = {}) {
  if (!places) return;
  places.setCurrent(place);
  if (place === null && o.pending) places.pendingAccount = true;
  settings = { ...settings, mode: modeOf(place) };
  saveSettings(settingsFile(), settings);
  // The menu bar's recent notes and save state were the other place's.
  recent = [];
  status = "";
  updateTray();
  for (const win of BrowserWindow.getAllWindows()) {
    if (win === quickAdd || isRunner(win.webContents) || win.isDestroyed()) continue;
    if (!isAppUrl(win.webContents.getURL()) && !win.webContents.getURL().startsWith("file:")) continue;
    bound.set(win.webContents.id, place);
    applyThrottling(win);
    load(win, appUrl(path));
  }
  // Quick Add follows the open place unless it was given one of its own.
  if (quickAdd && !quickAdd.isDestroyed() && !places.state.quickAdd) load(quickAdd, quickAddUrl());
  ensureRunners();
  updateDock();
}

/** Quick Add's place: the one picked there last, or the open place. */
function quickAddPlace(): string | null {
  const q = places?.state.quickAdd ?? null;
  return q && places?.has(q) ? q : (places?.state.current ?? null);
}

function quickAddUrl(): string {
  const p = bundled ? quickAddPlace() : null;
  return appUrl(p ? `/quick-add?place=${encodeURIComponent(p)}` : "/quick-add");
}

/** The Dock badge: the open place's unread count and every other account's. */
function updateDock() {
  const others = places ? places.state.accounts.filter((a) => a.id !== places!.state.current).reduce((n, a) => n + a.unread, 0) : 0;
  const n = currentBadge + others;
  app.dock?.setBadge(n === 0 ? "" : n > 99 ? "99+" : String(n));
}

/** An account the app has just signed in to: a place (and its runner); the Mac's first keys if it's the first. */
function addAccount(u: SessionUser) {
  if (!places) return null;
  const first = places.state.accounts.length === 0;
  const a = places.addAccount(u);
  if (!a) return null;
  if (first) adoptLegacyKeys(u.userId);
  lastAdded = a.id;
  ensureRunners();
  return a;
}

/**
 * Signs this Mac out of one account: its session ends, its token and keys go, its runner closes. The page has
 * already deleted that account's copy. When it was open, the windows go to the next place.
 */
async function signOutPlace(id: string, nextPlace: string | null = null) {
  const user = userIdOf(id);
  if (!places || !user || !places.has(id)) return;
  await authBridge?.signOut(user).catch(() => undefined);
  try {
    accountKeys.get(user)?.reset();
  } catch {
    /* no keys made for it */
  }
  accountKeys.delete(user);
  rmSync(join(app.getPath("userData"), "e2ee", "accounts", user), { recursive: true, force: true });
  const runner = runners.get(id);
  runners.delete(id);
  if (runner && !runner.isDestroyed()) runner.destroy();
  const wasOpen = places.state.current === id;
  const next = places.removeAccount(id);
  if (lastAdded === id) lastAdded = null;
  // (The page may name where to go: the library, after the account came down into it.)
  if (nextPlace === LIBRARY && !places.state.library) {
    places.setLibrary(true);
    libraryConfigured = true;
  }
  if (wasOpen) switchTo(nextPlace && places.has(nextPlace) ? nextPlace : next);
  else ensureRunners();
  updateDock();
}

function commandMain(command: { type: "new-note" } | { type: "navigate"; path: string }) {
  showMain();
  mainWindow?.webContents.send("desktop:command", command);
}

// ---------------------------------------------------------------- Quick Add (⌥Space from any app)

function createQuickAdd() {
  quickAdd = new BrowserWindow({
    width: 520,
    height: 320,
    show: false,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: true,
    roundedCorners: true,
    backgroundColor: background(),
    webPreferences: webPreferences(),
  });
  // Over full-screen apps too. Electron makes this by turning the whole app into a background (UIElement)
  // app and back; on recent macOS it stays one (no Dock icon, no menu bar), so make it a regular app again.
  quickAdd.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  if (process.platform === "darwin") {
    app.setActivationPolicy("regular");
    void app.dock?.show();
  }
  if (bundled) bindOnLoad(quickAdd, quickAddPlace);
  applyThrottling(quickAdd);
  guardNavigation(quickAdd.webContents);
  lockCover?.attach(quickAdd);
  // Clicking elsewhere puts it away, like Spotlight.
  quickAdd.on("blur", () => quickAdd?.hide());
  quickAdd.on("closed", () => (quickAdd = null));
  load(quickAdd, quickAddUrl());
}

function toggleQuickAdd() {
  // Waiting for an update (needsUpdate): the main window says so; Quick Add has nothing to add to.
  if (needsUpdate) {
    showMain();
    return;
  }
  if (!quickAdd || quickAdd.isDestroyed()) createQuickAdd();
  const win = quickAdd!;
  if (win.isVisible() && win.isFocused()) {
    win.hide();
    return;
  }
  // Loaded before signing in (it showed the sign-in page), or left elsewhere: back to the form.
  if (!win.webContents.getURL().startsWith(appUrl("/quick-add"))) load(win, quickAddUrl());
  // On the screen the pointer is on, a little above the middle.
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const [w, h] = win.getSize() as [number, number];
  win.setPosition(Math.round(area.x + (area.width - w) / 2), Math.round(area.y + area.height * 0.28));
  win.show();
  win.focus();
  win.webContents.send("desktop:command", { type: "quick-add-shown" });
}

function registerShortcut(): string | null {
  globalShortcut.unregisterAll();
  if (!settings.quickAddShortcut) return null;
  try {
    if (globalShortcut.register(settings.quickAddShortcut, toggleQuickAdd)) return null;
  } catch {
    /* An accelerator Electron doesn't know. */
  }
  return "Another app is already using this shortcut. Choose a different one.";
}

// ---------------------------------------------------------------- menu bar icon

function updateTray() {
  if (!settings.menuBarIcon) {
    tray?.destroy();
    tray = null;
    return;
  }
  if (!tray) {
    // The F alone, tinted by the system.
    const icon = nativeImage.createFromPath(asset("trayTemplate.png"));
    icon.setTemplateImage(true);
    tray = new Tray(icon);
    tray.setToolTip("Folevi");
  }
  const items: MenuItemConstructorOptions[] = [
    { label: "Quick Add Task…", accelerator: settings.quickAddShortcut || undefined, registerAccelerator: false, click: toggleQuickAdd },
    { label: "New Note", click: () => commandMain({ type: "new-note" }) },
    { type: "separator" },
  ];
  if (recent.length) {
    items.push({ label: "Recent notes", enabled: false });
    for (const note of recent.slice(0, 8)) items.push({ label: note.title || "Untitled", click: () => showMain(`/d/${note.id}`) });
    items.push({ type: "separator" });
  }
  if (status) items.push({ label: status, enabled: false }, { type: "separator" });
  items.push(
    { label: "Open Folevi", click: () => showMain() },
    { label: "Settings…", click: () => showMain("/settings/desktop") },
    { type: "separator" },
    { label: "Quit Folevi", click: () => app.quit() },
  );
  tray.setContextMenu(Menu.buildFromTemplate(items));
}

// ---------------------------------------------------------------- the app menu

function buildMenu() {
  const template: MenuItemConstructorOptions[] = [
    {
      label: "Folevi",
      submenu: [
        { role: "about", label: "About Folevi" },
        ...updateMenuItems(),
        { type: "separator" },
        { label: "Settings…", accelerator: "Command+,", click: () => showMain("/settings/desktop") },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide", label: "Hide Folevi" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit", label: "Quit Folevi" },
      ],
    },
    {
      label: "File",
      submenu: [
        { label: "New Note", accelerator: "Command+N", click: () => commandMain({ type: "new-note" }) },
        { label: "Quick Add Task…", accelerator: settings.quickAddShortcut || undefined, registerAccelerator: false, click: toggleQuickAdd },
        { type: "separator" },
        { label: "New Window", accelerator: "Command+Shift+N", click: () => createMainWindow() },
        { role: "close", label: "Close Window" },
      ],
    },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        // (Not ⌥⌘I, the default: that shows and hides the page's inspector.)
        { role: "toggleDevTools", accelerator: "Alt+Shift+Command+I" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Go",
      submenu: [
        { label: "Back", accelerator: "Command+[", click: (_i, win) => (win as BrowserWindow | undefined)?.webContents.navigationHistory.goBack() },
        { label: "Forward", accelerator: "Command+]", click: (_i, win) => (win as BrowserWindow | undefined)?.webContents.navigationHistory.goForward() },
        { type: "separator" },
        { label: "Notes", click: () => showMain("/documents") },
        { label: "Tasks", click: () => showMain("/tasks/today") },
        { label: "Calendar", click: () => showMain("/calendar") },
      ],
    },
    { role: "windowMenu" },
    { role: "help", submenu: [{ label: "Folevi Help", click: () => showMain("/help") }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function updateMenuItems(): MenuItemConstructorOptions[] {
  if (!checkForUpdates) return [];
  if (update.state === "ready") return [{ label: `Restart to Update${update.version ? ` to ${update.version}` : ""}`, click: installUpdate }];
  const busy = update.state === "checking" || update.state === "downloading";
  return [{ label: update.state === "downloading" ? "Downloading Update…" : "Check for Updates…", enabled: !busy, click: () => checkForUpdates?.() }];
}

// ---------------------------------------------------------------- settings

function applyLoginItem() {
  // Only the installed app registers itself (a development run would register the Electron binary). Only
  // called when the setting changes, and after the page has its answer: on recent macOS the login item
  // service can take its time (or never answer), and the call blocks the app while it waits, so it never
  // runs at startup.
  if (!app.isPackaged) return;
  setTimeout(() => app.setLoginItemSettings({ openAtLogin: settings.openAtLogin }), 0);
}

function applySettings(next: DesktopSettings) {
  const previous = settings;
  settings = next;
  if (next.quickAddShortcut !== previous.quickAddShortcut) {
    shortcutError = registerShortcut();
    if (shortcutError) {
      // Keep the one that worked.
      settings = { ...next, quickAddShortcut: previous.quickAddShortcut };
      registerShortcut();
    }
  }
  if (next.openAtLogin !== previous.openAtLogin) applyLoginItem();
  saveSettings(settingsFile(), settings);
  updateTray();
  buildMenu();
}

// ---------------------------------------------------------------- the page's calls

const fromFolevi = (e: IpcMainEvent | IpcMainInvokeEvent) => isAppUrl(e.senderFrame?.url ?? "");

/** Local mode's scheduled reminders (reminders.ts), kept across restarts. */
let reminders: Reminders | null = null;
/** Shown notifications, held until they're clicked or closed (a collected one forgets its click). */
const showing = new Set<Notification>();

/** A reminder going off: a Mac notification (if Settings allows them) that opens its to-do when clicked. */
function showReminder(r: Reminder) {
  if (!settings.notifications || !Notification.isSupported()) return;
  // Reminders are the library's: with accounts here too, they say so, and clicking one opens the library.
  const labelled = !!places && places.state.accounts.length > 0;
  const note = new Notification({ title: labelled ? `On this Mac · ${r.title}` : r.title, body: r.body });
  showing.add(note);
  note.on("click", () => {
    showing.delete(note);
    if (places && places.state.current !== LIBRARY && places.state.library) {
      switchTo(LIBRARY, r.path.startsWith("/") ? r.path : "/documents");
      showMain();
    } else showMain(r.path);
  });
  note.on("close", () => showing.delete(note));
  note.show();
}

/** folevi-text, the Vision helper (textRecognition.ts): in the app's Resources, or native-build/ when run from source. */
const textHelper = () => (app.isPackaged ? join(process.resourcesPath, "folevi-text") : join(__dirname, "..", "native-build", "folevi-text"));
const recognize = oneAtATime((bytes: Uint8Array, handwriting: boolean) => runHelper(textHelper(), bytes, { handwriting }));

const text = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

function listen() {
  ipcMain.on("desktop:badge", (e, count: unknown) => {
    if (!fromFolevi(e)) return;
    const n = typeof count === "number" && Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
    // A runner's count comes with its place (places-describe); the badge here is the open place's.
    if (isRunner(e.sender)) return;
    currentBadge = n;
    updateDock();
  });
  ipcMain.on("desktop:notify", (e, input: unknown) => {
    if (!fromFolevi(e) || !settings.notifications || !Notification.isSupported()) return;
    const n = (input ?? {}) as Record<string, unknown>;
    const title = text(n.title, 200);
    if (!title) return;
    const path = text(n.path, 500);
    const note = new Notification({ title, body: text(n.body, 400) });
    // From another place (its runner): clicking it opens that place, at the page it's about.
    const place = bundled ? placeOfContents(e.sender) : null;
    note.on("click", () => {
      if (place && places && place !== places.state.current && places.has(place)) {
        switchTo(place, path.startsWith("/") ? path : "/documents");
        showMain();
      } else showMain(path || undefined);
    });
    note.show();
  });
  ipcMain.on("desktop:recent", (e, list: unknown) => {
    if (!fromFolevi(e) || !Array.isArray(list)) return;
    recent = list
      .slice(0, 8)
      .map((x) => ({ id: text((x as Record<string, unknown>)?.id, 40), title: text((x as Record<string, unknown>)?.title, 80) }))
      .filter((x) => /^[0-9A-Z]{26}$/.test(x.id));
    updateTray();
  });
  ipcMain.on("desktop:status", (e, value: unknown) => {
    if (!fromFolevi(e)) return;
    const next = text(value, 80);
    if (next === status) return;
    status = next;
    updateTray();
  });
  ipcMain.handle("desktop:get-settings", (e) => (fromFolevi(e) ? { settings: pageSettings(settings), error: shortcutError } : null));
  ipcMain.handle("desktop:set-settings", (e, patch: unknown) => {
    if (!fromFolevi(e)) return null;
    applySettings(cleanSettings(patch, settings));
    return { settings: pageSettings(settings), error: shortcutError };
  });
  // foleviShell (preload.ts): read synchronously before the page's scripts, answered only for the bundled
  // interface's own pages.
  ipcMain.on("shell:bootstrap", (e, href: unknown) => {
    const url = e.senderFrame?.url || (typeof href === "string" ? href : "");
    const place = placeOfContents(e.sender);
    e.returnValue =
      bundled && isAppUrl(url)
        ? { shell: true, mode: modeOf(place), version: app.getVersion(), deviceName: computerName(), places: places ? { current: place, background: isRunner(e.sender) } : null }
        : { shell: false };
  });
  // foleviShell.auth: signing in, the page's /api/auth requests and Convex tokens (authBridge.ts).
  registerAuthIpc(
    (channel, listener) => ipcMain.handle(channel, listener),
    () => authBridge,
    (e) => bundled && fromFolevi(e as IpcMainInvokeEvent),
    {
      // The page's own account (its user id), never one it names; a page with no account yet uses the single
      // session older builds kept.
      slot: (e) => userIdOf(placeOfEvent(e)) ?? undefined,
      signIn: async (e, b) => {
        if (!places) return b.signIn();
        const place = placeOfEvent(e);
        const u = await b.signInAccount();
        if (!u) return false;
        const a = addAccount(u);
        if (!a) return false;
        // From the library the page goes on itself (move my notes, or keep them separate) and then opens it.
        if (place === LIBRARY) return true;
        // A first sign-in, or someone else on a "session ended" screen: the windows open that account.
        if (a.id !== place) switchTo(a.id);
        return true;
      },
      signOut: async (e, b) => {
        const place = placeOfEvent(e);
        if (places && userIdOf(place)) await signOutPlace(place!);
        else await b.signOut();
      },
    },
  );
  // foleviShell.secrets and foleviShell.ai (ai.ts): the page may store its three Foli AI keys but never read
  // them back ("auth.session" is refused), and its AI requests stream back on shell:ai-chunk.
  registerAiIpc((channel, listener) => ipcMain.handle(channel, listener), {
    service: () => ai,
    secrets: () => (bundled ? createSecretStore(join(app.getPath("userData"), "secrets"), safeStorage) : null),
    allowed: (e) => bundled && fromFolevi(e as IpcMainInvokeEvent),
    sender: (e) => {
      const contents = (e as IpcMainInvokeEvent).sender;
      return { key: String(contents.id), send: (channel, ...args) => !contents.isDestroyed() && contents.send(channel, ...args), onGone: (cb) => contents.once("destroyed", cb) };
    },
  });
  // foleviShell.e2ee / foleviDesktop.e2ee: this Mac's encryption device keys (e2ee.ts), for Folevi's own pages only.
  registerE2eeIpc(
    (channel, listener) => ipcMain.handle(channel, listener),
    // Each account's own keys (the page's account), the Mac's first pair for the website and the library.
    (e) => keysFor(e),
    (e) => fromFolevi(e as IpcMainInvokeEvent),
  );
  // foleviShell.lock: the Touch ID lock's settings (lock.ts); turning it on or off asks for Touch ID.
  ipcMain.handle("shell:lock-get", (e) => (bundled && fromFolevi(e) && appLock ? appLock.getSettings() : null));
  ipcMain.handle("shell:lock-set", async (e, patch: unknown) => {
    if (!bundled || !fromFolevi(e) || !appLock) return { ok: false, error: { code: "unavailable", message: "The lock isn't in this build of Folevi for Mac." } };
    try {
      return { ok: true, value: await appLock.setSettings(patch) };
    } catch (err) {
      const code = (err as { code?: unknown }).code;
      return { ok: false, error: { code: typeof code === "string" ? code : "io", message: err instanceof Error ? err.message : String(err) } };
    }
  });
  ipcMain.handle("shell:set-mode", (e, mode: unknown) => {
    if (!bundled || !fromFolevi(e) || (mode !== "local" && mode !== "account") || !places) return false;
    const place = placeOfEvent(e);
    // The page's policy and the network rules follow the place: every window opens again in it, once the page
    // has its answer. "local": the library (it's one of the places from now on); "account": the account signed in
    // last, else the first one, else the sign-in screen.
    if (mode === "local") {
      if (place === LIBRARY && settings.mode === "local") return true;
      places.setLibrary(true);
      libraryConfigured = true;
      setTimeout(() => switchTo(LIBRARY), 50);
      return true;
    }
    const target = (lastAdded && places.has(lastAdded) ? lastAdded : null) ?? places.state.accounts[0]?.id ?? null;
    if (target === place && userIdOf(place)) return true;
    setTimeout(() => switchTo(target, "/documents", { pending: target === null }), 50);
    return true;
  });
  // foleviShell.places (preload.ts, docs/MULTI_ACCOUNT_PLAN.md §2.2): the list, switching, signing in to one more
  // account, what a page says of its own place, signing out of one, forgetting the library, another account's
  // token for a move, and Quick Add's place. Only for the bundled interface's own pages.
  const placesCall = (e: IpcMainInvokeEvent) => bundled && fromFolevi(e) && places !== null;
  ipcMain.handle("shell:places-list", async (e) => (placesCall(e) ? await placesList() : []));
  ipcMain.handle("shell:places-switch", (e, id: unknown, o: unknown) => {
    if (!placesCall(e) || typeof id !== "string" || !places!.has(id)) return false;
    const raw = o && typeof o === "object" ? (o as Record<string, unknown>).path : undefined;
    const path = typeof raw === "string" && raw.startsWith("/") && !raw.startsWith("//") && raw.length <= 500 ? raw : "/documents";
    // Once the page has its answer.
    setTimeout(() => switchTo(id, path), 50);
    return true;
  });
  ipcMain.handle("shell:places-sign-in", async (e) => {
    if (!placesCall(e) || !authBridge) return null;
    const u = await authBridge.signInAccount();
    return u ? (addAccount(u)?.id ?? null) : null;
  });
  ipcMain.handle("shell:places-describe", (e, d: unknown) => {
    if (!placesCall(e)) return null;
    const place = placeOfEvent(e);
    if (place === LIBRARY) places!.describeLibrary(d);
    else if (place && userIdOf(place)) places!.describe(place, d);
    return null;
  });
  ipcMain.handle("shell:places-sign-out", async (e, id: unknown, next: unknown) => {
    if (!placesCall(e) || typeof id !== "string" || !userIdOf(id)) return false;
    await signOutPlace(id, typeof next === "string" ? next : null);
    return true;
  });
  ipcMain.handle("shell:places-forget-library", async (e) => {
    if (!placesCall(e) || !library) return false;
    await library.forget().catch(() => undefined);
    libraryConfigured = false;
    const wasOpen = places!.state.current === LIBRARY;
    places!.setLibrary(false);
    reminders?.clear();
    const runner = runners.get(LIBRARY);
    runners.delete(LIBRARY);
    if (runner && !runner.isDestroyed()) runner.destroy();
    if (wasOpen) setTimeout(() => switchTo(places!.state.accounts[0]?.id ?? null), 50);
    return true;
  });
  ipcMain.handle("shell:places-convex-token", async (e, id: unknown) => {
    // Only a page that is itself signed in moves notes between accounts.
    if (!placesCall(e) || !authBridge || typeof id !== "string" || !places!.has(id) || !userIdOf(placeOfEvent(e))) return null;
    return await authBridge.convexToken(userIdOf(id)!).catch(() => null);
  });
  ipcMain.handle("shell:places-quick-add", (e) => (placesCall(e) ? quickAddPlace() : null));
  ipcMain.handle("shell:places-set-quick-add", (e, id: unknown) => {
    if (!placesCall(e) || typeof id !== "string" || !places!.has(id)) return false;
    places!.setQuickAdd(id);
    // Quick Add opens again in that place (its policy and session are the place's).
    if (quickAdd && !quickAdd.isDestroyed()) setTimeout(() => quickAdd && !quickAdd.isDestroyed() && load(quickAdd, quickAddUrl()), 50);
    return true;
  });
  // Local mode's reminders and subscribed calendars (WP14, reminders.ts and calendarFetch.ts): only for the
  // bundled interface in local mode (in account mode the server sends reminders and reads calendars).
  const localShell = (e: IpcMainInvokeEvent) => bundled && modeOf(placeOfEvent(e)) === "local" && fromFolevi(e);
  ipcMain.handle("shell:notify-schedule", (e, n: unknown) => (localShell(e) ? (reminders?.schedule(n) ?? false) : false));
  ipcMain.handle("shell:notify-cancel", (e, id: unknown) => {
    if (localShell(e)) reminders?.cancel(id);
    return null;
  });
  // A file the page made (local mode's export ZIP), saved where the person picks (saveFile.ts).
  ipcMain.handle("shell:files-save", async (e, name: unknown, bytes: unknown) => {
    if (!bundled || !fromFolevi(e)) return false;
    const parent = BrowserWindow.fromWebContents(e.sender);
    return await saveFromPage(name, bytes, {
      folder: app.getPath("downloads"),
      choose: async (o) => {
        const r = parent ? await dialog.showSaveDialog(parent, o) : await dialog.showSaveDialog(o);
        return r.canceled || !r.filePath ? null : r.filePath;
      },
    });
  });
  ipcMain.handle("shell:http-calendar", async (e, url: unknown, previous: unknown) =>
    localShell(e) ? await downloadCalendar(url, previous, { serviceHost: SERVICE_URL.hostname }) : { kind: "error", message: "Couldn't load this calendar: the address couldn't be reached." },
  );
  ipcMain.on("desktop:window-buttons", (e, spot: unknown) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!fromFolevi(e) || !win || win === quickAdd || !spot || typeof spot !== "object") return;
    const { x, y, height } = spot as Record<string, unknown>;
    if (![x, y, height].every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n < 400)) return;
    // The buttons are 14 points tall: centred on the page's top bar.
    win.setWindowButtonPosition({ x: Math.round((x as number) + 2), y: Math.round((y as number) + (height as number) / 2 - 7) });
  });
  ipcMain.on("desktop:pause-shortcut", (e, paused: unknown) => {
    if (!fromFolevi(e)) return;
    if (paused === true) globalShortcut.unregisterAll();
    else shortcutError = registerShortcut();
  });
  ipcMain.on("desktop:quick-add-close", (e) => {
    if (fromFolevi(e)) quickAdd?.hide();
  });
  ipcMain.on("desktop:quick-add-size", (e, height: unknown) => {
    if (!fromFolevi(e) || !quickAdd || typeof height !== "number" || !Number.isFinite(height)) return;
    const h = Math.round(Math.min(640, Math.max(160, height)));
    const [w] = quickAdd.getContentSize() as [number, number];
    quickAdd.setContentSize(w, h);
  });
  // A note dragged out of the app (the Export dialog's file): written to a temporary file the drag carries
  // to Finder or another app.
  ipcMain.on("desktop:drag-file", (e, input: unknown) => {
    if (!fromFolevi(e) || !input || typeof input !== "object") return;
    const { name, text: body } = input as Record<string, unknown>;
    if (typeof body !== "string" || body.length > 5_000_000) return;
    const dir = join(app.getPath("temp"), "Folevi drag", String(Date.now()));
    try {
      mkdirSync(dir, { recursive: true });
      const file = join(dir, dragFileName(text(name, 200), "md"));
      writeFileSync(file, body, "utf8");
      void app
        .getFileIcon(file, { size: "normal" })
        .catch(() => nativeImage.createFromPath(asset("trayTemplate@2x.png")))
        .then((icon) => {
          dragStarted = true;
          e.sender.startDrag({ file, icon });
        })
        .catch(() => undefined);
    } catch {
      /* The drag simply carries nothing. */
    }
  });
  // Whether this Mac lets Folevi record the screen and its sound (granted only once macOS has been told so
  // and Folevi has restarted): a call recording checks it before it starts.
  // Search in files: the words in an image from a note, read on this Mac (nothing is sent anywhere).
  ipcMain.handle("desktop:recognize-text", async (e, input: unknown, handwriting: unknown) => {
    if (!fromFolevi(e)) return null;
    const bytes = imageBytes(input);
    return bytes ? await recognize(bytes, handwriting === true) : null;
  });
  ipcMain.handle("desktop:screen-access", (e) => (fromFolevi(e) ? systemPreferences.getMediaAccessStatus("screen") : null));
  // Signing in with Google or Apple, which the app's window doesn't do: Folevi's /app-google page opens in
  // the default browser, and the folevi://auth/google link it ends on (with a one-time code) goes back to the
  // page that asked. Ten minutes, then it gives up.
  ipcMain.handle("desktop:sign-in", async (e, url: unknown) => {
    if (!fromFolevi(e) || typeof url !== "string" || !isSignInStart(url)) return null;
    pendingSignIn?.(null);
    const answer = new Promise<string | null>((resolve) => {
      pendingSignIn = resolve;
      setTimeout(() => {
        if (pendingSignIn === resolve) {
          pendingSignIn = null;
          resolve(null);
        }
      }, 10 * 60_000);
    });
    await shell.openExternal(url);
    return answer;
  });
  // Recording a call without the permission: the page offers to open the right System Settings pane.
  ipcMain.on("desktop:system-settings", (e, pane: unknown) => {
    const url = systemSettingsUrl(pane);
    if (fromFolevi(e) && url) void shell.openExternal(url);
  });
  ipcMain.on("desktop:open", (e, path: unknown) => {
    if (!fromFolevi(e)) return;
    quickAdd?.hide();
    showMain(text(path, 500) || undefined);
  });
}

/**
 * A drag out of the app (desktop:drag-file) that macOS never saw end, because the mouse was already up when it
 * started (the icon is fetched first) or it was started from a script: its drag session then keeps the app from
 * finishing a quit (every window closes, and the process stays). Once a drag has started, quitting writes the
 * session's storage to disk and ends the process itself.
 */
let dragStarted = false;
let exiting = false;

// ---------------------------------------------------------------- places at launch

/**
 * The places (places.json). A Mac that ran an older Folevi has none: its mode says where it was (the library, or
 * the one account, whose session moves to its own slot once the server says whose it is).
 */
async function startPlaces() {
  const file = join(app.getPath("userData"), "places.json");
  const first = !PlacesStore.exists(file);
  places = new PlacesStore(file);
  const info = await library?.info().catch(() => null);
  libraryConfigured = info?.configured !== false && !!info;
  if (first) {
    if (libraryConfigured) places.setLibrary(true);
    if (settings.mode === "local") {
      places.setLibrary(true);
      places.setCurrent(LIBRARY);
    }
  } else if (libraryConfigured && settings.mode === "local") places.setLibrary(true);
  // The single session older builds kept: it becomes its account's (a few seconds at most; else next launch).
  if (authBridge?.signedIn()) {
    const adopted = await Promise.race([authBridge.adoptLegacy().catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), 4000))]);
    if (adopted) {
      const a = addAccount(adopted);
      if (a && settings.mode === "account" && !places.state.current) places.setCurrent(a.id);
    }
  }
  if (settings.mode === "account" && !places.state.current) {
    if (places.state.accounts[0]) places.setCurrent(places.state.accounts[0].id);
    // Account mode with no account yet (or a session not yet moved to its slot): the sign-in screen, or the
    // older build's session.
    else places.pendingAccount = true;
  }
  if (settings.mode === "local" && !places.state.current && places.state.library) places.setCurrent(LIBRARY);
  // Every window hears of a change to the list (a sign-in, a runner's counts).
  places.subscribe(() => {
    void placesList().then((list) => {
      for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed() && isAppUrl(win.webContents.getURL())) win.webContents.send("places:changed", list);
    });
    updateDock();
  });
}

/** The places as the page lists them. */
async function placesList() {
  if (!places) return [];
  const info = await library?.info().catch(() => null);
  return places.list({ libraryKind: info?.configured ? info.kind : null, displayPath: info?.displayPath ?? "", configured: info?.configured === true });
}

// ---------------------------------------------------------------- start

app.setAboutPanelOptions({ applicationName: "Folevi", applicationVersion: app.getVersion(), copyright: "© 2026 Folevi", website: "https://folevi.com" });

app.whenReady().then(async () => {
  // Earlier drags' files: nothing needs them once the app has restarted.
  rmSync(join(app.getPath("temp"), "Folevi drag"), { recursive: true, force: true });
  // The installed app answers folevi:// links (a development run would register the Electron binary, and a test
  // run of a packaged copy, with its own FOLEVI_USER_DATA, mustn't take them from the installed app).
  if (app.isPackaged && !process.env.FOLEVI_USER_DATA) app.setAsDefaultProtocolClient(SCHEME);
  folevi = setUpSession();
  if (bundled) startLock();
  if (bundled) {
    // Sync with Dropbox / Google Drive (library/cloud/): the connection restored from the last run, and the
    // page's cloud:* calls (status, sign-in, sign-out). The provider tokens stay in this process.
    const cloud = startCloud((e) => fromFolevi(e as unknown as IpcMainInvokeEvent));
    library = createLibrary(cloud.library);
    installBundledInterface(folevi);
    const libraryIpc: IpcMainLike = { handle: (c, l) => ipcMain.handle(c, l as never), removeHandler: (c) => ipcMain.removeHandler(c) };
    registerLibraryIpc(libraryIpc, library, (e) => fromFolevi(e as unknown as IpcMainInvokeEvent));
    // A full look at the library folder on waking and when Folevi comes to the front (watch.ts also scans every 30 s).
    powerMonitor.on("resume", () => void library?.rescan());
    app.on("browser-window-focus", () => void library?.rescan());
    authBridge = createShellAuth();
    ai = createAi();
    // Before any window shows the new origin: hand over edits waiting on the website's origin (once).
    await runHandoff(folevi).catch((e) => console.error("Folevi handoff:", e));
    await startPlaces();
    applyNetworkGuard();
  }
  listen();
  reminders = new Reminders(join(app.getPath("userData"), "reminders.json"), { show: showReminder });
  // The library's reminders go off whichever place is open (they were cleared when an account opened).
  if (bundled && (settings.mode === "local" || places?.state.library)) reminders.load();
  buildMenu();
  shortcutError = registerShortcut();
  updateTray();
  // Opened by a link: quietly, the link decides what shows. Otherwise the main window. (A launch at login
  // opens it too: macOS can only say it was one through the login item service, which can hang the app on
  // recent macOS.)
  if (!pendingLink) createMainWindow();
  createQuickAdd();
  // The other places keep syncing behind the open one.
  ensureRunners();
  if (pendingLink) {
    openLink(pendingLink);
    pendingLink = null;
  }
  checkForUpdates = startUpdates((next) => {
    update = next;
    buildMenu();
  });
  buildMenu();
  nativeTheme.on("updated", () => {
    for (const win of BrowserWindow.getAllWindows()) win.setBackgroundColor(background());
  });
  console.log(`Folevi is showing ${originOf(APP_URL) ?? APP_URL.href}${bundled ? ` (bundled interface, ${settings.mode})` : ""}`);
});

// The Dock icon reopens the main window.
app.on("activate", () => showMain());
app.on("before-quit", () => {
  quitting = true;
});
app.on("will-quit", (event) => {
  globalShortcut.unregisterAll();
  library?.dispose();
  aiHelper?.dispose();
  if (!dragStarted || exiting) return;
  // (See dragStarted.) Every window has closed by now; what the pages stored is written out first.
  event.preventDefault();
  exiting = true;
  const ses = folevi;
  const flush = ses ? Promise.all([Promise.resolve(ses.flushStorageData()), ses.cookies.flushStore()]) : Promise.resolve();
  // app.exit (which process.exit calls in Electron) hangs the same way while the drag session is open, so the
  // process ends directly; the storage is on disk by then.
  void Promise.race([flush, new Promise((r) => setTimeout(r, 3000))]).finally(() => (process as unknown as { reallyExit(code: number): never }).reallyExit(0));
});
// Every window closed (the main one hides instead): stay running for Quick Add and the menu bar.
app.on("window-all-closed", () => undefined);
