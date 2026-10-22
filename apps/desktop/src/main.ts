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
} from "electron";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  if (!win.isDestroyed()) win.webContents.setBackgroundThrottling(!(bundled && settings.mode === "local"));
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
      mode: () => settings.mode,
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

let guarded = false;
/**
 * Local mode never contacts Folevi: besides the page's policy, the session cancels every request to Folevi's
 * and Convex's hosts (and the website the app points at), from any window.
 */
function applyNetworkGuard() {
  const ses = folevi;
  // (With no network at all, the session already cancels everything.)
  if (!ses || !bundled || noNetwork) return;
  const host = SERVICE_URL.hostname;
  if (settings.mode === "local") {
    ses.webRequest.onBeforeRequest({ urls: localModeBlockPatterns(host) }, (details, callback) => callback({ cancel: isBlockedInLocalMode(details.url, host) }));
    guarded = true;
  } else if (guarded) {
    ses.webRequest.onBeforeRequest(null);
    guarded = false;
  }
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
  quickAdd.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  applyThrottling(quickAdd);
  guardNavigation(quickAdd.webContents);
  lockCover?.attach(quickAdd);
  // Clicking elsewhere puts it away, like Spotlight.
  quickAdd.on("blur", () => quickAdd?.hide());
  quickAdd.on("closed", () => (quickAdd = null));
  load(quickAdd, appUrl("/quick-add"));
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
  if (!win.webContents.getURL().startsWith(appUrl("/quick-add"))) load(win, appUrl("/quick-add"));
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
  const note = new Notification({ title: r.title, body: r.body });
  showing.add(note);
  note.on("click", () => {
    showing.delete(note);
    showMain(r.path);
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
    app.dock?.setBadge(n === 0 ? "" : n > 99 ? "99+" : String(n));
  });
  ipcMain.on("desktop:notify", (e, input: unknown) => {
    if (!fromFolevi(e) || !settings.notifications || !Notification.isSupported()) return;
    const n = (input ?? {}) as Record<string, unknown>;
    const title = text(n.title, 200);
    if (!title) return;
    const path = text(n.path, 500);
    const note = new Notification({ title, body: text(n.body, 400) });
    note.on("click", () => showMain(path || undefined));
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
    e.returnValue = bundled && isAppUrl(url) ? { shell: true, mode: settings.mode, version: app.getVersion(), deviceName: computerName() } : { shell: false };
  });
  // foleviShell.auth: signing in, the page's /api/auth requests and Convex tokens (authBridge.ts).
  registerAuthIpc(
    (channel, listener) => ipcMain.handle(channel, listener),
    () => authBridge,
    (e) => bundled && fromFolevi(e as IpcMainInvokeEvent),
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
    e2eeKeys,
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
    if (!bundled || !fromFolevi(e) || (mode !== "local" && mode !== "account")) return false;
    if (settings.mode === mode) return true;
    applySettings({ ...settings, mode });
    for (const win of BrowserWindow.getAllWindows()) applyThrottling(win);
    // Reminders are this Mac's only in local mode; in account mode the server sends them.
    if (mode === "local") reminders?.load();
    else reminders?.clear();
    applyNetworkGuard();
    // The page's policy and the network rules follow the mode: every window opens again in it, once the page
    // has its answer.
    setTimeout(() => {
      for (const win of BrowserWindow.getAllWindows()) if (isAppUrl(win.webContents.getURL())) win.webContents.reload();
    }, 50);
    return true;
  });
  // Local mode's reminders and subscribed calendars (WP14, reminders.ts and calendarFetch.ts): only for the
  // bundled interface in local mode (in account mode the server sends reminders and reads calendars).
  const localShell = (e: IpcMainInvokeEvent) => bundled && settings.mode === "local" && fromFolevi(e);
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
    applyNetworkGuard();
  }
  listen();
  reminders = new Reminders(join(app.getPath("userData"), "reminders.json"), { show: showReminder });
  if (bundled && settings.mode === "local") reminders.load();
  buildMenu();
  shortcutError = registerShortcut();
  updateTray();
  // Opened by a link: quietly, the link decides what shows. Otherwise the main window. (A launch at login
  // opens it too: macOS can only say it was one through the login item service, which can hang the app on
  // recent macOS.)
  if (!pendingLink) createMainWindow();
  createQuickAdd();
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
