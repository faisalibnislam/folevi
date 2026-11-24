// Folevi for Windows (Windows 11 and Windows 10 22H2, on ARM and on Intel/AMD, each a native build): Folevi's own
// interface, built into the app and served from app://folevi (the same export the Mac, iPhone and Android apps
// carry, apps/web/scripts/build-shell.mjs --platform windows), in a window of its own, plus what a browser tab
// can't do: Quick Add from any app (Ctrl+Alt+Space), an icon in the notification area, opening at sign-in,
// Windows notifications, the unread count on the taskbar button, folevi:// links and one copy at a time.
// Folevi Cloud accounts and the library "on this PC" both work, and several of them at once (places.ts).
// Revived on 2026-11-24 from the Electron Mac app (apps/desktop, last version 1.21.0, removed in 7cb6ddda); the
// Mac-only parts (the move to the native Mac app, the Swift helpers, Touch ID) stayed behind. docs/WINDOWS.md.
import {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  Notification,
  powerMonitor,
  protocol,
  safeStorage,
  screen,
  session,
  shell,
  systemPreferences,
  Tray,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type MenuItemConstructorOptions,
  type Session,
  type WebContents,
  webContents as allContents,
} from "electron";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import { appUrl, APP_URL, dragFileName, isAppUrl, isSignInReturn, isSignInStart, linkTarget, originOf, parseDeepLink, SCHEME, SERVICE_URL, useBundledApp } from "./urls";
import { installUpdate, startUpdates, type UpdateState } from "./updates";
import { cleanSettings, loadSettings, pageSettings, saveSettings, type DesktopSettings } from "./settings";
import { APP_SCHEME, APP_SCHEME_PRIVILEGES, createAppHandler, isBlockedInLocalMode, localModeBlockPatterns, NO_LIBRARY_FILES, shellRoot } from "./protocol";
import { readShellBuild, shellBuildProblems } from "./shellBuild";
import { restoreWindow, saveWindow } from "./windowState";
import { Reminders, type Reminder } from "./reminders";
import { downloadCalendar } from "./calendarFetch";
import { saveFromPage } from "./saveFile";
import { startCloud } from "./library/cloud/electron";
import { createAuthBridge, isAuthCallback, registerAuthIpc, type AuthBridge, type SessionUser } from "./authBridge";
import { registerLibraryIpc, type IpcMainLike } from "./library/ipc";
import { LibraryService, type CloudSource } from "./library/service";
import { createSecretStore } from "./secrets";
import { AiService, allowedAiUrl, registerAiIpc } from "./ai";
import { DeviceKeys, registerE2eeIpc } from "./e2ee";
import { LIBRARY, PlacesStore, userIdOf } from "./places";
import { keyAction, type KeyAction } from "./keys";
import { HIDDEN_ARG, linkFromArgs, startedHidden } from "./launch";
import { accentColor, captionColors, cleanTheme, windowBackground } from "./chrome";
import { badgeDescription, badgePng } from "./badge";

const PARTITION = "persist:folevi";
/** Windows ties notifications, the taskbar button and the Start menu shortcut to this (electron-builder's appId). */
export const APP_USER_MODEL_ID = "com.folevi.windows";
const WINDOWS = process.platform === "win32";
const MAC = process.platform === "darwin";
/** The look the page gets: Windows', or the Mac's for a development run there (FOLEVI_LOOK=windows to see Windows'). */
const LOOK: "windows" | "mac" = WINDOWS || process.env.FOLEVI_LOOK === "windows" ? "windows" : "mac";

/** Folevi's version as Folevi writes it ("1.5.68"; package.json's "version" is its semver form). */
const FOLEVI_VERSION = (() => {
  try {
    const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf8")) as { foleviVersion?: unknown };
    return typeof pkg.foleviVersion === "string" ? pkg.foleviVersion : app.getVersion();
  } catch {
    return app.getVersion();
  }
})();

/**
 * The portable ZIP (no installer): it never registers itself, opens at sign-in or updates. An installed copy has the
 * installer's uninstaller beside it (electron-builder's NSIS names it "Uninstall Folevi.exe").
 */
const PORTABLE = WINDOWS && app.isPackaged && !existsSync(join(dirname(app.getPath("exe")), "Uninstall Folevi.exe"));

// Test runs keep their own sign-in, library and settings, apart from an installed app's (never the person's data).
if (process.env.FOLEVI_USER_DATA) app.setPath("userData", process.env.FOLEVI_USER_DATA);
if (WINDOWS) app.setAppUserModelId(APP_USER_MODEL_ID);

const settingsFile = () => join(app.getPath("userData"), "settings.json");
const windowFile = () => join(app.getPath("userData"), "window.json");
const asset = (name: string) => join(__dirname, "..", "assets", name);
/** The device's name for the library's device list and Settings > Devices: the PC's name. */
const deviceName = () => (process.env.COMPUTERNAME || hostname()).replace(/\.local$/i, "").slice(0, 80) || "PC";

let settings: DesktopSettings = loadSettings(settingsFile());
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
let pendingLink: string | null = linkFromArgs(process.argv);
/** A Google or Apple sign-in on the website in the browser (desktop:sign-in): answered by its folevi://auth/google link. */
let pendingSignIn: ((url: string | null) => void) | null = null;
let authBridge: AuthBridge | null = null;
let ai: AiService | null = null;
/** The page's own look (light or dark), as it last said (desktop:theme); Windows' until then. */
let pageDark = nativeTheme.shouldUseDarkColors;

// ---------------------------------------------------------------- the bundled interface (always, in the installed app)

/**
 * Whether the windows show the interface built into the app (app://folevi) rather than the website: always in the
 * packaged app, which carries it; a development run with FOLEVI_SHELL=1. FOLEVI_SHELL=0 shows the website.
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

// ---------------------------------------------------------------- one Folevi at a time, and folevi:// links

// Opening Folevi again (the Start menu, a folevi:// link) brings the running one forward; Windows passes the link
// as an argument.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    const link = linkFromArgs(argv);
    if (link) openLink(link);
    else showMain();
  });
}

// A Mac (development runs there) hands links over with open-url.
app.on("open-url", (event, url) => {
  event.preventDefault();
  if (app.isReady()) openLink(url);
  else pendingLink = url;
});

function openLink(url: string) {
  // The end of signing in to Folevi in the browser (authBridge.ts): the app trades the code.
  if (isAuthCallback(url)) {
    authBridge?.handleCallback(url);
    showMain();
    return;
  }
  // The end of a Google or Apple sign-in on the website in the browser: back to the page that started it.
  if (isSignInReturn(url)) {
    pendingSignIn?.(url);
    pendingSignIn = null;
    showMain();
    return;
  }
  const link = parseDeepLink(url);
  if (!link) {
    showMain();
    return;
  }
  if (link.type === "new-note") commandMain({ type: "new-note" });
  else if (link.type === "quick-add") toggleQuickAdd();
  else showMain(link.path);
}

/** Registers folevi:// for this copy (the installer does too; the portable ZIP and test runs never take it). */
function registerScheme() {
  if (!app.isPackaged || PORTABLE || process.env.FOLEVI_USER_DATA) return;
  if (!app.isDefaultProtocolClient(SCHEME)) app.setAsDefaultProtocolClient(SCHEME);
}

// ---------------------------------------------------------------- the session every window shares

function setUpSession(): Session {
  const ses = session.fromPartition(PARTITION);
  // The site can tell it's in the desktop app (e.g. to say "Open Folevi" rather than "Open in browser").
  ses.setUserAgent(`${ses.getUserAgent()} FoleviDesktop/${FOLEVI_VERSION} FoleviWindows/${FOLEVI_VERSION}`);
  // Only Folevi's own pages get anything, and only what the web app uses: the microphone (audio notes), the
  // clipboard (paste), full screen (presenting) and notifications.
  const allowed = new Set(["media", "clipboard-read", "clipboard-sanitized-write", "fullscreen", "notifications"]);
  ses.setPermissionRequestHandler((_wc, permission, callback, details) => {
    const audioOnly = permission !== "media" || ("mediaTypes" in details && (details.mediaTypes ?? []).every((t) => t === "audio"));
    callback(isAppUrl(details.requestingUrl) && allowed.has(permission) && audioOnly);
  });
  ses.setPermissionCheckHandler((_wc, permission, origin) => isAppUrl(origin) && allowed.has(permission));
  // No screen recording on Windows (the Mac's call recording): every getDisplayMedia is refused.
  ses.setDisplayMediaRequestHandler((_request, callback) => callback({}));
  // Spelling: the page underlines and corrects with Folevi's own checker (as on the website); Chromium's is off so
  // words aren't marked twice. (apps/web lib/spelling/web.ts ownSpelling.)
  ses.setSpellCheckerEnabled(false);
  return ses;
}

/**
 * Links to anywhere but Folevi open in the browser; Folevi's own "open in a new window" opens a new window. A link
 * to one of the app's pages on the website opens in the app too; the website's other pages (sign-in, share links)
 * open in the browser (urls.ts linkTarget).
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
  spellcheck: false,
});

/**
 * In local mode one window hosts the library for all of them (apps/web/src/lib/local/host.ts), and it may be a
 * hidden one. Chromium slows a hidden page's timers, which would hold back the library's writes, so in local mode
 * hidden windows keep full speed.
 */
function applyThrottling(win: BrowserWindow) {
  if (!win.isDestroyed()) win.webContents.setBackgroundThrottling(!(bundled && modeOf(placeOfContents(win.webContents)) === "local"));
}

/** Loads a page, or the offline page (with a way back) when neither the network nor the site's cache has it. */
function load(win: BrowserWindow, url: string) {
  win.webContents.once("did-fail-load", (_e, code, _desc, failedUrl, isMainFrame) => {
    // -3: a navigation replaced this one (not a failure).
    if (!isMainFrame || code === -3 || win.isDestroyed()) return;
    void win.loadFile(asset("offline.html"), { query: { url: failedUrl || url } });
  });
  void win.loadURL(url).catch(() => undefined);
}

// ---------------------------------------------------------------- several places (docs/MULTI_ACCOUNT_PLAN.md §2.2)

/**
 * The library on this PC and any number of accounts (places.ts). Each page is bound to one place (`bound`, by
 * webContents id): its session, keys and reminders are that place's, never one the page names. Main windows show
 * the open place; every other place has a hidden runner window (/place-sync) that keeps it in sync.
 */
let places: PlacesStore | null = null;
const bound = new Map<number, string | null>();
const runners = new Map<string, BrowserWindow>();
let currentBadge = 0;
let lastAdded: string | null = null;
let libraryConfigured = false;

function placeOfContents(wc: WebContents | null | undefined): string | null {
  if (wc && bound.has(wc.id)) return bound.get(wc.id) ?? null;
  return places?.state.current ?? null;
}
const placeOfEvent = (e: unknown) => placeOfContents((e as IpcMainInvokeEvent | null)?.sender ?? null);

function modeOf(place: string | null): DesktopSettings["mode"] {
  if (!places) return settings.mode;
  return places.modeOf(place);
}

function bindOnLoad(win: BrowserWindow, place: () => string | null) {
  const id = win.webContents.id;
  bound.set(id, place());
  win.webContents.on("did-start-navigation", (details) => {
    if (details.isMainFrame && !details.isSameDocument) bound.set(id, place());
  });
  win.on("closed", () => bound.delete(id));
}

/** Each account's own encryption keys (userData/e2ee/accounts/<user id>); the library uses the PC's first pair. */
let deviceKeys: DeviceKeys | null = null;
const accountKeys = new Map<string, DeviceKeys>();
const newKeys = (dir: string) => new DeviceKeys({ dir, cipher: safeStorage });
function keysFor(event?: unknown): DeviceKeys {
  const user = bundled && event ? userIdOf(placeOfEvent(event)) : null;
  if (!user) return (deviceKeys ??= newKeys(join(app.getPath("userData"), "e2ee")));
  let k = accountKeys.get(user);
  if (!k) {
    k = newKeys(join(app.getPath("userData"), "e2ee", "accounts", user));
    accountKeys.set(user, k);
  }
  return k;
}

/** The PC's first pair of keys becomes the first account's (as on the Mac). */
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

// ---------------------------------------------------------------- the built-in interface's services

let library: LibraryService | null = null;

/** Serves app://folevi on the session: the export built into the app, by mode (protocol.ts). */
function installBundledInterface(ses: Session) {
  const root = shellRoot({ packaged: app.isPackaged, resourcesPath: process.resourcesPath, appDir: join(__dirname, ".."), env: process.env });
  if (!existsSync(join(root, "index.html"))) console.error(`Folevi: no bundled interface at ${root} (run \`pnpm shell\`).`);
  const build = readShellBuild(root);
  for (const problem of shellBuildProblems(build, { version: FOLEVI_VERSION, packaged: app.isPackaged, serviceUrl: SERVICE_URL.href })) console.error(`Folevi: ${problem}.`);
  const extraConnect = (process.env.FOLEVI_SHELL_CONNECT ?? "").split(/[\s,]+/).filter((o) => /^(https?|wss?):\/\/[^\s;']+$/.test(o));
  ses.protocol.handle(
    APP_SCHEME,
    createAppHandler({
      root,
      mode: (url) => {
        const named = url && (url.pathname === "/place-sync" || url.pathname === "/quick-add") ? url.searchParams.get("place") : null;
        return modeOf(named && places?.has(named) ? named : (places?.state.current ?? null));
      },
      csp: { serviceOrigin: SERVICE_URL.origin, extraConnect },
      files: library?.files ?? NO_LIBRARY_FILES,
    }),
  );
}

/**
 * shell.library (docs/LOCAL_MODE_PLAN.md §4.2): the local library's files, journal, passphrase and moves, in this
 * process (src/library/). Plain folders only on Windows (no coordinated-I/O helper): "On this PC" in Documents,
 * any folder (OneDrive's included), or Dropbox and Google Drive through their own connection. The key never reaches
 * the page; safeStorage (Windows DPAPI) keeps it on this PC.
 */
function createLibrary(cloud: CloudSource | null): LibraryService {
  const service = new LibraryService({
    cloud,
    userData: app.getPath("userData"),
    // A test run (FOLEVI_USER_DATA) keeps "On this PC" inside its own folder, never the person's Documents.
    home: process.env.FOLEVI_USER_DATA ? join(process.env.FOLEVI_USER_DATA, "home") : app.getPath("home"),
    helperPath: null,
    sealer: safeStorage,
    chooseFolder: async ({ title, defaultPath }) => {
      const parent = BrowserWindow.getFocusedWindow() ?? mainWindow;
      const o = { title, defaultPath, buttonLabel: "Select Folder", properties: ["openDirectory", "createDirectory"] as ("openDirectory" | "createDirectory")[] };
      const r = parent ? await dialog.showOpenDialog(parent, o) : await dialog.showOpenDialog(o);
      return r.canceled ? null : (r.filePaths[0] ?? null);
    },
  });
  void service.open().catch((e) => console.error("Folevi library:", e));
  return service;
}

/**
 * foleviShell.auth (authBridge.ts): Folevi Cloud sign-in in the browser (PKCE, ending on a folevi://auth link), the
 * session kept with safeStorage and never given to the page. Its requests go through a session of their own that
 * keeps no cookies and adds `Origin: SERVICE_URL`.
 */
function createShellAuth(): AuthBridge {
  const ses = session.fromPartition("folevi-auth");
  ses.webRequest.onBeforeSendHeaders({ urls: [`${SERVICE_URL.origin}/api/auth/*`] }, (details, callback) => {
    callback({ requestHeaders: { ...details.requestHeaders, Origin: SERVICE_URL.origin } });
  });
  return createAuthBridge({
    serviceUrl: SERVICE_URL,
    fetch: (url, init) => {
      const headers = { ...((init.headers ?? {}) as Record<string, string>) };
      delete headers.origin;
      return ses.fetch(url, { ...init, headers, credentials: "omit", bypassCustomProtocolHandlers: true });
    },
    openExternal: (url) => shell.openExternal(url),
    store: createSecretStore(join(app.getPath("userData"), "secrets"), safeStorage),
    deviceName,
  });
}

/** foleviShell.ai (ai.ts): the person's own OpenAI, Anthropic or Google keys (Windows has no on-device model here). */
function createAi(): AiService {
  const ses = session.fromPartition("folevi-ai");
  ses.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !allowedAiUrl(details.url) }));
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  return new AiService({
    fetch: (url, init) => ses.fetch(url, { ...init, credentials: "omit", bypassCustomProtocolHandlers: true }),
    secrets: createSecretStore(join(app.getPath("userData"), "secrets"), safeStorage),
    helper: () => null,
  });
}

/** FOLEVI_OFFLINE=1: no network at all (testing a cold offline start). */
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
      callback({ cancel: !!url && ["http:", "https:", "ws:", "wss:"].includes(url.protocol) });
    });
  });
}

/** Local mode never contacts Folevi: requests to Folevi's and Convex's hosts from a page bound to the library are cancelled. */
function applyNetworkGuard() {
  const ses = folevi;
  if (!ses || !bundled || noNetwork) return;
  const host = SERVICE_URL.hostname;
  ses.webRequest.onBeforeRequest({ urls: localModeBlockPatterns(host) }, (details, callback) => {
    const wc = details.webContents ?? (details.webContentsId ? allContents.fromId(details.webContentsId) : undefined);
    callback({ cancel: modeOf(placeOfContents(wc)) === "local" && isBlockedInLocalMode(details.url, host) });
  });
}

// ---------------------------------------------------------------- main windows

function createMainWindow(path = "/documents", o: { show?: boolean } = {}): BrowserWindow {
  const saved = restoreWindow(windowFile(), screen.getAllDisplays().map((d) => d.workArea));
  const first = !mainWindow;
  const win = new BrowserWindow({
    ...(first ? saved.bounds : { width: saved.bounds.width, height: saved.bounds.height }),
    // Wider than the web's phone layout (under 768 px), whose top bar the caption buttons would cover.
    minWidth: 800,
    minHeight: 480,
    show: false,
    title: "Folevi",
    icon: WINDOWS ? asset("icon.ico") : undefined,
    // Folevi's own top bar fills the top; Windows draws its caption buttons over the top right (chrome.ts).
    titleBarStyle: "hidden",
    ...(WINDOWS ? { titleBarOverlay: captionColors(pageDark) } : { trafficLightPosition: { x: 20, y: 22 } }),
    backgroundColor: windowBackground(pageDark),
    webPreferences: webPreferences(),
  });
  if (first) {
    mainWindow = win;
    if (saved.maximized) win.maximize();
  }
  if (bundled) bindOnLoad(win, () => places?.state.current ?? null);
  applyThrottling(win);
  guardNavigation(win.webContents);
  watchKeys(win);
  // The mouse's Back and Forward buttons, as in every Windows app with history.
  win.on("app-command", (_e, cmd) => {
    if (cmd === "browser-backward") win.webContents.send("desktop:command", { type: "menu", id: "go.back" });
    if (cmd === "browser-forward") win.webContents.send("desktop:command", { type: "menu", id: "go.forward" });
  });
  if (o.show !== false) win.once("ready-to-show", () => win.show());
  const remember = () => {
    if (win !== mainWindow || win.isDestroyed()) return;
    saveWindow(windowFile(), { bounds: win.isMaximized() ? saved.bounds : win.getNormalBounds(), maximized: win.isMaximized() });
  };
  win.on("resize", remember);
  win.on("move", remember);
  win.on("maximize", remember);
  win.on("unmaximize", remember);
  // Closing the first window hides it while the notification area icon is on (Quick Add keeps working); without
  // the icon there'd be no way back to it, so closing it quits.
  win.on("close", (event) => {
    if (win === mainWindow && !quitting && settings.menuBarIcon) {
      event.preventDefault();
      remember();
      win.hide();
    }
  });
  win.on("closed", () => {
    if (win === mainWindow) {
      mainWindow = null;
      if (!quitting && !settings.menuBarIcon) app.quit();
    }
  });
  load(win, appUrl(path));
  if (process.env.FOLEVI_SNAPSHOT && first) snapshotWhenLoaded(win, process.env.FOLEVI_SNAPSHOT);
  return win;
}

/**
 * FOLEVI_SNAPSHOT=<file.png> (with FOLEVI_USER_DATA, never the person's data): a picture of the first window a few
 * seconds after it loads, then the app quits. For checking the look from scripts, on any computer.
 */
function snapshotWhenLoaded(win: BrowserWindow, file: string) {
  win.webContents.once("did-finish-load", () => {
    setTimeout(() => {
      if (win.isDestroyed()) return;
      void win.webContents
        .capturePage()
        .then((image) => writeFileSync(file, image.toPNG()))
        .catch((e) => console.error("Folevi snapshot:", e))
        .finally(() => quit());
    }, Number(process.env.FOLEVI_SNAPSHOT_DELAY ?? 5000));
  });
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
}

function commandMain(command: { type: "new-note" } | { type: "navigate"; path: string }) {
  showMain();
  mainWindow?.webContents.send("desktop:command", command);
}

/** The keys Folevi adds to the page's own (keys.ts). */
function watchKeys(win: BrowserWindow) {
  win.webContents.on("before-input-event", (event, input) => {
    const action = keyAction(input, { mac: MAC });
    if (!action) return;
    event.preventDefault();
    runKey(win, action);
  });
}

function runKey(win: BrowserWindow, action: KeyAction) {
  const wc = win.webContents;
  switch (action.kind) {
    case "menu":
      wc.send("desktop:command", { type: "menu", id: action.id });
      return;
    case "new-window":
      createMainWindow();
      return;
    case "close-window":
      win.close();
      return;
    case "print":
      void printPage(wc);
      return;
    case "settings":
      showMain("/settings/desktop");
      return;
    case "fullscreen":
      win.setFullScreen(!win.isFullScreen());
      return;
    case "devtools":
      if (!app.isPackaged || process.env.FOLEVI_DEVTOOLS === "1") wc.toggleDevTools();
      return;
    case "zoom": {
      const level = action.by === 0 ? 0 : Math.max(-3, Math.min(4, wc.getZoomLevel() + action.by * 0.5));
      wc.setZoomLevel(level);
      return;
    }
  }
}

// ---------------------------------------------------------------- printing

let commandSerial = 0;
const commandAnswers = new Map<string, (value: Record<string, unknown>) => void>();

/** Sends the page a command that carries an id (lib/desktop/capabilities.ts) and waits for its answer. */
function askPage(wc: WebContents, command: Record<string, unknown>, ms = 60_000): Promise<Record<string, unknown> | null> {
  const id = `w${++commandSerial}`;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      commandAnswers.delete(id);
      resolve(null);
    }, ms);
    commandAnswers.set(id, (value) => {
      clearTimeout(timer);
      commandAnswers.delete(id);
      resolve(value);
    });
    wc.send("desktop:command", { ...command, id });
  });
}

/**
 * Ctrl+P: the open note's print layout (the page prints it, the same clean page as its PDF export), or with no
 * note open, the page as it is, in Windows' print dialog.
 */
async function printPage(wc: WebContents) {
  const answer = await askPage(wc, { type: "print" });
  if (answer?.handled === true || wc.isDestroyed()) return;
  wc.print({ silent: false, printBackground: true });
}

// ---------------------------------------------------------------- the hidden runners and switching places

function ensureRunners() {
  if (!places || !bundled) return;
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
  const win = new BrowserWindow({ show: false, width: 480, height: 320, paintWhenInitiallyHidden: false, skipTaskbar: true, webPreferences: webPreferences() });
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

function switchTo(place: string | null, path = "/documents", o: { pending?: boolean } = {}) {
  if (!places) return;
  places.setCurrent(place);
  if (place === null && o.pending) places.pendingAccount = true;
  settings = { ...settings, mode: modeOf(place) };
  saveSettings(settingsFile(), settings);
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
  if (quickAdd && !quickAdd.isDestroyed() && !places.state.quickAdd) load(quickAdd, quickAddUrl());
  ensureRunners();
  updateBadge();
}

function quickAddPlace(): string | null {
  const q = places?.state.quickAdd ?? null;
  return q && places?.has(q) ? q : (places?.state.current ?? null);
}

function quickAddUrl(): string {
  const p = bundled ? quickAddPlace() : null;
  return appUrl(p ? `/quick-add?place=${encodeURIComponent(p)}` : "/quick-add");
}

/** The unread count (the open place's and every other account's): the taskbar button's overlay and the tray's tooltip. */
function updateBadge() {
  const others = places ? places.state.accounts.filter((a) => a.id !== places!.state.current).reduce((n, a) => n + a.unread, 0) : 0;
  const n = currentBadge + others;
  tray?.setToolTip(n > 0 ? `Folevi (${badgeDescription(n)})` : "Folevi");
  if (MAC) {
    app.dock?.setBadge(n === 0 ? "" : n > 99 ? "99+" : String(n));
    return;
  }
  const png = badgePng(n);
  for (const win of [mainWindow]) {
    if (!win || win.isDestroyed()) continue;
    win.setOverlayIcon(png ? nativeImage.createFromBuffer(png) : null, badgeDescription(n));
  }
}

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
  if (nextPlace === LIBRARY && !places.state.library) {
    places.setLibrary(true);
    libraryConfigured = true;
  }
  if (wasOpen) switchTo(nextPlace && places.has(nextPlace) ? nextPlace : next);
  else ensureRunners();
  updateBadge();
}

// ---------------------------------------------------------------- Quick Add (Ctrl+Alt+Space from any app)

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
    backgroundColor: windowBackground(pageDark),
    webPreferences: webPreferences(),
  });
  if (MAC) quickAdd.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  if (bundled) bindOnLoad(quickAdd, quickAddPlace);
  applyThrottling(quickAdd);
  guardNavigation(quickAdd.webContents);
  // Clicking elsewhere puts it away, like the Start menu's search.
  quickAdd.on("blur", () => quickAdd?.hide());
  quickAdd.on("closed", () => (quickAdd = null));
  quickAdd.webContents.on("before-input-event", (event, input) => {
    if (input.type === "keyDown" && input.key === "Escape") {
      event.preventDefault();
      quickAdd?.hide();
    }
  });
  load(quickAdd, quickAddUrl());
}

function toggleQuickAdd() {
  if (!quickAdd || quickAdd.isDestroyed()) createQuickAdd();
  const win = quickAdd!;
  if (win.isVisible() && win.isFocused()) {
    win.hide();
    return;
  }
  if (!win.webContents.getURL().startsWith(appUrl("/quick-add"))) load(win, quickAddUrl());
  // On the screen the pointer is on, a little above the middle.
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const [w] = win.getSize() as [number, number];
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

// ---------------------------------------------------------------- the notification area icon

function updateTray() {
  if (!settings.menuBarIcon) {
    tray?.destroy();
    tray = null;
    return;
  }
  if (!tray) {
    tray = new Tray(nativeImage.createFromPath(asset(WINDOWS ? "tray.ico" : "tray.png")));
    tray.setToolTip("Folevi");
    // A click opens Folevi (Windows' convention); the menu is on right-click.
    tray.on("click", () => showMain());
  }
  const items: MenuItemConstructorOptions[] = [
    { label: "Quick Add Task", accelerator: settings.quickAddShortcut || undefined, registerAccelerator: false, click: toggleQuickAdd },
    { label: "New Note", click: () => commandMain({ type: "new-note" }) },
    { type: "separator" },
  ];
  if (recent.length) {
    items.push({ label: "Recent notes", enabled: false });
    for (const note of recent.slice(0, 8)) items.push({ label: (note.title || "Untitled").replace(/&/g, "&&"), click: () => showMain(`/d/${note.id}`) });
    items.push({ type: "separator" });
  }
  if (status) items.push({ label: status, enabled: false }, { type: "separator" });
  items.push({ label: "Open Folevi", click: () => showMain() }, { label: "Settings", click: () => showMain("/settings/desktop") }, ...updateMenuItems(), { type: "separator" }, { label: "Quit Folevi", click: () => quit() });
  tray.setContextMenu(Menu.buildFromTemplate(items));
}

function updateMenuItems(): MenuItemConstructorOptions[] {
  if (!checkForUpdates) return [];
  if (update.state === "ready") return [{ label: `Restart to update${update.version ? ` to ${update.version}` : ""}`, click: () => installUpdate() }];
  const busy = update.state === "checking" || update.state === "downloading";
  return [{ label: update.state === "downloading" ? "Downloading update..." : "Check for updates", enabled: !busy, click: () => checkForUpdates?.() }];
}

function quit() {
  quitting = true;
  app.quit();
}

// ---------------------------------------------------------------- settings

function applyLoginItem() {
  // Only the installed app registers itself (a development run would register electron.exe, the ZIP its own folder).
  if (!app.isPackaged || PORTABLE || process.env.FOLEVI_USER_DATA) return;
  app.setLoginItemSettings({ openAtLogin: settings.openAtLogin, args: [HIDDEN_ARG] });
}

function applySettings(next: DesktopSettings) {
  const previous = settings;
  settings = next;
  if (next.quickAddShortcut !== previous.quickAddShortcut) {
    shortcutError = registerShortcut();
    if (shortcutError) {
      settings = { ...next, quickAddShortcut: previous.quickAddShortcut };
      registerShortcut();
    }
  }
  if (next.openAtLogin !== previous.openAtLogin) applyLoginItem();
  saveSettings(settingsFile(), settings);
  updateTray();
}

// ---------------------------------------------------------------- the page's look (caption buttons, accent)

/** The page's look changed (or Windows'): the caption buttons, the window backgrounds. */
function applyLook() {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    win.setBackgroundColor(windowBackground(pageDark));
    if (WINDOWS && win !== quickAdd && !isRunner(win.webContents)) {
      try {
        win.setTitleBarOverlay(captionColors(pageDark));
      } catch {
        /* a window without the overlay */
      }
    }
  }
}

/** Windows' accent color to every page (focus rings, selected text). */
function sendAccent() {
  const accent = WINDOWS ? accentColor(systemPreferences.getAccentColor()) : null;
  for (const wc of allContents.getAllWebContents()) if (!wc.isDestroyed() && isAppUrl(wc.getURL())) wc.send("desktop:accent", accent);
}

// ---------------------------------------------------------------- the page's calls

const fromFolevi = (e: IpcMainEvent | IpcMainInvokeEvent) => isAppUrl(e.senderFrame?.url ?? "");
let reminders: Reminders | null = null;
/** Shown notifications, held until they're clicked or closed (a collected one forgets its click). */
const showing = new Set<Notification>();

function toast(o: { title: string; body: string; onClick: () => void }) {
  if (!settings.notifications || !Notification.isSupported()) return;
  const note = new Notification({ title: o.title, body: o.body, icon: WINDOWS ? asset("icon.ico") : undefined });
  showing.add(note);
  note.on("click", () => {
    showing.delete(note);
    o.onClick();
  });
  note.on("close", () => showing.delete(note));
  note.show();
}

/** A reminder going off (local mode, reminders.ts): a Windows notification that opens its to-do when clicked. */
function showReminder(r: Reminder) {
  const labelled = !!places && places.state.accounts.length > 0;
  toast({
    title: labelled ? `On this PC · ${r.title}` : r.title,
    body: r.body,
    onClick: () => {
      if (places && places.state.current !== LIBRARY && places.state.library) {
        switchTo(LIBRARY, r.path.startsWith("/") ? r.path : "/documents");
        showMain();
      } else showMain(r.path);
    },
  });
}

const text = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

function listen() {
  ipcMain.on("desktop:badge", (e, count: unknown) => {
    if (!fromFolevi(e) || isRunner(e.sender)) return;
    currentBadge = typeof count === "number" && Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
    updateBadge();
  });
  ipcMain.on("desktop:notify", (e, input: unknown) => {
    if (!fromFolevi(e)) return;
    const n = (input ?? {}) as Record<string, unknown>;
    const title = text(n.title, 200);
    if (!title) return;
    const path = text(n.path, 500);
    const place = bundled ? placeOfContents(e.sender) : null;
    toast({
      title,
      body: text(n.body, 400),
      onClick: () => {
        if (place && places && place !== places.state.current && places.has(place)) {
          switchTo(place, path.startsWith("/") ? path : "/documents");
          showMain();
        } else showMain(path || undefined);
      },
    });
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
  ipcMain.on("desktop:theme", (e, input: unknown) => {
    const look = cleanTheme(input);
    if (!fromFolevi(e) || !look || isRunner(e.sender) || look.dark === pageDark) return;
    pageDark = look.dark;
    applyLook();
  });
  ipcMain.on("desktop:command-done", (e, id: unknown, value: unknown) => {
    if (!fromFolevi(e) || typeof id !== "string") return;
    commandAnswers.get(id)?.(value && typeof value === "object" ? (value as Record<string, unknown>) : {});
  });
  ipcMain.on("desktop:print", (e) => {
    if (fromFolevi(e)) e.sender.print({ silent: false, printBackground: true });
  });
  ipcMain.on("desktop:close-window", (e) => {
    if (fromFolevi(e)) BrowserWindow.fromWebContents(e.sender)?.close();
  });
  ipcMain.handle("desktop:get-settings", (e) => (fromFolevi(e) ? { settings: pageSettings(settings), error: shortcutError } : null));
  ipcMain.handle("desktop:set-settings", (e, patch: unknown) => {
    if (!fromFolevi(e)) return null;
    applySettings(cleanSettings(patch, settings));
    return { settings: pageSettings(settings), error: shortcutError };
  });
  // foleviShell (preload.ts): read synchronously before the page's scripts, for the bundled interface's own pages.
  ipcMain.on("shell:bootstrap", (e, href: unknown) => {
    const url = e.senderFrame?.url || (typeof href === "string" ? href : "");
    const place = placeOfContents(e.sender);
    e.returnValue =
      bundled && isAppUrl(url)
        ? {
            shell: true,
            mode: modeOf(place),
            version: FOLEVI_VERSION,
            deviceName: deviceName(),
            places: places ? { current: place, background: isRunner(e.sender) } : null,
            platform: LOOK,
            accent: WINDOWS ? accentColor(systemPreferences.getAccentColor()) : null,
          }
        : { shell: false, platform: LOOK, accent: WINDOWS && isAppUrl(url) ? accentColor(systemPreferences.getAccentColor()) : null };
  });
  registerAuthIpc(
    (channel, listener) => ipcMain.handle(channel, listener),
    () => authBridge,
    (e) => bundled && fromFolevi(e as IpcMainInvokeEvent),
    {
      slot: (e) => userIdOf(placeOfEvent(e)) ?? undefined,
      signIn: async (e, b, o) => {
        if (!places) return b.signIn(o);
        const place = placeOfEvent(e);
        const u = await b.signInAccount(o);
        if (!u) return false;
        const a = addAccount(u);
        if (!a) return false;
        if (place === LIBRARY) return true;
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
  registerAiIpc((channel, listener) => ipcMain.handle(channel, listener), {
    service: () => ai,
    secrets: () => (bundled ? createSecretStore(join(app.getPath("userData"), "secrets"), safeStorage) : null),
    allowed: (e) => bundled && fromFolevi(e as IpcMainInvokeEvent),
    sender: (e) => {
      const contents = (e as IpcMainInvokeEvent).sender;
      return { key: String(contents.id), send: (channel, ...args) => !contents.isDestroyed() && contents.send(channel, ...args), onGone: (cb) => contents.once("destroyed", cb) };
    },
  });
  registerE2eeIpc(
    (channel, listener) => ipcMain.handle(channel, listener),
    (e) => keysFor(e),
    (e) => fromFolevi(e as IpcMainInvokeEvent),
  );
  // No app lock on Windows yet (the Mac's was Touch ID): the page hides the setting when it gets null.
  ipcMain.handle("shell:lock-get", () => null);
  ipcMain.handle("shell:lock-set", () => ({ ok: false, error: { code: "unavailable", message: "Folevi for Windows has no app lock yet." } }));
  ipcMain.handle("shell:set-mode", (e, mode: unknown) => {
    if (!bundled || !fromFolevi(e) || (mode !== "local" && mode !== "account") || !places) return false;
    const place = placeOfEvent(e);
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
  const placesCall = (e: IpcMainInvokeEvent) => bundled && fromFolevi(e) && places !== null;
  ipcMain.handle("shell:places-list", async (e) => (placesCall(e) ? await placesList() : []));
  ipcMain.handle("shell:places-switch", (e, id: unknown, o: unknown) => {
    if (!placesCall(e) || typeof id !== "string" || !places!.has(id)) return false;
    const raw = o && typeof o === "object" ? (o as Record<string, unknown>).path : undefined;
    const path = typeof raw === "string" && raw.startsWith("/") && !raw.startsWith("//") && raw.length <= 500 ? raw : "/documents";
    setTimeout(() => switchTo(id, path), 50);
    return true;
  });
  ipcMain.handle("shell:places-sign-in", async (e, o: unknown) => {
    if (!placesCall(e) || !authBridge) return null;
    const provider = o && typeof o === "object" ? (o as Record<string, unknown>).provider : undefined;
    const u = await authBridge.signInAccount({ provider: provider === "google" || provider === "apple" ? provider : undefined });
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
    if (!placesCall(e) || !authBridge || typeof id !== "string" || !places!.has(id) || !userIdOf(placeOfEvent(e))) return null;
    return await authBridge.convexToken(userIdOf(id)!).catch(() => null);
  });
  ipcMain.handle("shell:places-quick-add", (e) => (placesCall(e) ? quickAddPlace() : null));
  ipcMain.handle("shell:places-set-quick-add", (e, id: unknown) => {
    if (!placesCall(e) || typeof id !== "string" || !places!.has(id)) return false;
    places!.setQuickAdd(id);
    if (quickAdd && !quickAdd.isDestroyed()) setTimeout(() => quickAdd && !quickAdd.isDestroyed() && load(quickAdd, quickAddUrl()), 50);
    return true;
  });
  // Local mode's reminders and subscribed calendars (only for the bundled interface in local mode).
  const localShell = (e: IpcMainInvokeEvent) => bundled && modeOf(placeOfEvent(e)) === "local" && fromFolevi(e);
  ipcMain.handle("shell:notify-schedule", (e, n: unknown) => (localShell(e) ? (reminders?.schedule(n) ?? false) : false));
  ipcMain.handle("shell:notify-cancel", (e, id: unknown) => {
    if (localShell(e)) reminders?.cancel(id);
    return null;
  });
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
  // Where the page keeps room for the Mac's window buttons: nothing to place on Windows (the caption buttons are fixed).
  ipcMain.on("desktop:window-buttons", (e, spot: unknown) => {
    if (!MAC) return;
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!fromFolevi(e) || !win || win === quickAdd || !spot || typeof spot !== "object") return;
    const { x, y, height } = spot as Record<string, unknown>;
    if (![x, y, height].every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n < 400)) return;
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
    const h = Math.round(Math.min(640, Math.max(56, height)));
    const [w] = quickAdd.getContentSize() as [number, number];
    quickAdd.setContentSize(w, h);
  });
  // A note dragged out of the app: a temporary Markdown file the drag carries to File Explorer or another app.
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
        .catch(() => nativeImage.createFromPath(asset("tray.png")))
        .then((icon) => e.sender.startDrag({ file, icon }))
        .catch(() => undefined);
    } catch {
      /* The drag simply carries nothing. */
    }
  });
  // Signing in with Google or Apple on the website the windows show (FOLEVI_SHELL=0): the browser, then back.
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
  ipcMain.on("desktop:open", (e, path: unknown) => {
    if (!fromFolevi(e)) return;
    quickAdd?.hide();
    showMain(text(path, 500) || undefined);
  });
}

// ---------------------------------------------------------------- places at launch

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
  if (settings.mode === "account" && !places.state.current) {
    if (places.state.accounts[0]) places.setCurrent(places.state.accounts[0].id);
    else places.pendingAccount = true;
  }
  if (settings.mode === "local" && !places.state.current && places.state.library) places.setCurrent(LIBRARY);
  places.subscribe(() => {
    void placesList().then((list) => {
      for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed() && isAppUrl(win.webContents.getURL())) win.webContents.send("places:changed", list);
    });
    updateBadge();
  });
}

async function placesList() {
  if (!places) return [];
  const info = await library?.info().catch(() => null);
  return places.list({ libraryKind: info?.configured ? info.kind : null, displayPath: info?.displayPath ?? "", configured: info?.configured === true });
}

// ---------------------------------------------------------------- start

app.whenReady().then(async () => {
  // Earlier drags' files: nothing needs them once the app has restarted.
  rmSync(join(app.getPath("temp"), "Folevi drag"), { recursive: true, force: true });
  registerScheme();
  // No menu bar (Folevi's own top bar has its menus); the keys it held are in keys.ts.
  if (!MAC) Menu.setApplicationMenu(null);
  folevi = setUpSession();
  if (bundled) {
    // Sync with Dropbox / Google Drive (library/cloud/): the provider tokens stay in this process.
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
    await startPlaces();
    applyNetworkGuard();
  }
  listen();
  reminders = new Reminders(join(app.getPath("userData"), "reminders.json"), { show: showReminder });
  if (bundled && (settings.mode === "local" || places?.state.library)) reminders.load();
  shortcutError = registerShortcut();
  updateTray();
  // A start at sign-in stays in the notification area (with the icon off there'd be no way to it, so it shows).
  const hidden = startedHidden(process.argv) && settings.menuBarIcon;
  if (!pendingLink) createMainWindow("/documents", { show: !hidden });
  createQuickAdd();
  ensureRunners();
  if (pendingLink) {
    openLink(pendingLink);
    pendingLink = null;
  }
  checkForUpdates = startUpdates(
    (next) => {
      update = next;
      updateTray();
    },
    { portable: PORTABLE },
  );
  updateTray();
  nativeTheme.on("updated", () => {
    // Until the page says otherwise, the windows follow Windows' light or dark mode.
    pageDark = nativeTheme.shouldUseDarkColors;
    applyLook();
  });
  if (WINDOWS) systemPreferences.on("accent-color-changed", sendAccent);
  console.log(`Folevi ${FOLEVI_VERSION} (${process.arch}) is showing ${originOf(APP_URL) ?? APP_URL.href}${bundled ? ` (bundled interface, ${settings.mode})` : ""}`);
});

app.on("activate", () => showMain());
app.on("before-quit", () => {
  quitting = true;
});
app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  library?.dispose();
});
// Every window closed (the main one hides instead): stay running for Quick Add and the notification area icon.
app.on("window-all-closed", () => {
  if (!settings.menuBarIcon) app.quit();
});
