// Folevi for Mac: app.folevi.com in a window of its own, plus what a browser tab can't do: Quick Add from any
// app (⌥Space), a menu bar icon, opening at login, Mac notifications and the Dock badge.
// With the bundled interface switched on (FOLEVI_SHELL=1, or "bundledShell": true in settings.json), the
// windows show the interface built into the app from app://folevi instead (protocol.ts, docs/LOCAL_MODE_PLAN.md
// WP2). Off by default until the rest of local mode is ready.
import {
  app,
  BrowserWindow,
  desktopCapturer,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  net,
  Notification,
  protocol,
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
} from "electron";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
import { restoreWindow, saveWindow } from "./windowState";
import { Reminders, type Reminder } from "./reminders";
import { downloadCalendar } from "./calendarFetch";
import { imageBytes, oneAtATime, runHelper } from "./textRecognition";

const PARTITION = "persist:folevi";
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
/** A Google sign-in in the browser on its way (desktop:sign-in): answered by the folevi://auth/google link it ends on. */
let pendingSignIn: ((url: string | null) => void) | null = null;

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

// ---------------------------------------------------------------- the bundled interface (off by default)

settings = loadSettings(settingsFile());
/** Whether the windows show the interface built into the app (app://folevi) rather than the website. */
const bundled = process.env.FOLEVI_SHELL === "1" || (process.env.FOLEVI_SHELL !== "0" && settings.bundledShell);
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

/** Loads a page, or the offline page (with a way back) when neither the network nor the site's cache has it. */
function load(win: BrowserWindow, url: string) {
  win.webContents.once("did-fail-load", (_e, code, _desc, failedUrl, isMainFrame) => {
    // -3: a navigation replaced this one (not a failure).
    if (!isMainFrame || code === -3 || win.isDestroyed()) return;
    void win.loadFile(asset("offline.html"), { query: { url: failedUrl || url } });
  });
  void win.loadURL(url).catch(() => undefined);
}

// ---------------------------------------------------------------- the bundled interface

/** Serves app://folevi on the session: the export built into the app, by mode (protocol.ts). */
function installBundledInterface(ses: Session) {
  const root = shellRoot({ packaged: app.isPackaged, resourcesPath: process.resourcesPath, appDir: join(__dirname, ".."), env: process.env });
  if (!existsSync(join(root, "index.html"))) console.error(`Folevi: no bundled interface at ${root} (run \`pnpm shell\`).`);
  const extraConnect = (process.env.FOLEVI_SHELL_CONNECT ?? "").split(/[\s,]+/).filter((o) => /^(https?|wss?):\/\/[^\s;']+$/.test(o));
  ses.protocol.handle(
    APP_SCHEME,
    createAppHandler({
      root,
      mode: () => settings.mode,
      csp: { serviceOrigin: SERVICE_URL.origin, extraConnect },
      // The library layer (WP9) plugs in here.
      files: NO_LIBRARY_FILES,
    }),
  );
}

let guarded = false;
/**
 * Local mode never contacts Folevi: besides the page's policy, the session cancels every request to Folevi's
 * and Convex's hosts (and the website the app points at), from any window.
 */
function applyNetworkGuard() {
  const ses = folevi;
  if (!ses || !bundled) return;
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
  const record = (s: HandoffState) => {
    try {
      writeFileSync(handoffFile(), JSON.stringify(s, null, 2));
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
    const work = (async () => handOver(await page(`${old.origin}${HANDOFF_PATH}`), await page(appUrl(HANDOFF_PATH))))();
    const report = await Promise.race([work, new Promise<never>((_r, reject) => (timer = setTimeout(() => reject(new Error("timed out")), 120_000)))]);
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
  guardNavigation(win.webContents);
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
  guardNavigation(quickAdd.webContents);
  // Clicking elsewhere puts it away, like Spotlight.
  quickAdd.on("blur", () => quickAdd?.hide());
  quickAdd.on("closed", () => (quickAdd = null));
  load(quickAdd, appUrl("/quick-add"));
}

function toggleQuickAdd() {
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
    e.returnValue = bundled && isAppUrl(url) ? { shell: true, mode: settings.mode, version: app.getVersion() } : { shell: false };
  });
  ipcMain.handle("shell:set-mode", (e, mode: unknown) => {
    if (!bundled || !fromFolevi(e) || (mode !== "local" && mode !== "account")) return false;
    if (settings.mode === mode) return true;
    applySettings({ ...settings, mode });
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
        .then((icon) => e.sender.startDrag({ file, icon }))
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
  // Signing in with Google, which doesn't sign in inside the app's window: Folevi's /app-google page opens in
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

// ---------------------------------------------------------------- start

app.setAboutPanelOptions({ applicationName: "Folevi", applicationVersion: app.getVersion(), copyright: "© 2026 Folevi", website: "https://folevi.com" });

app.whenReady().then(async () => {
  // Earlier drags' files: nothing needs them once the app has restarted.
  rmSync(join(app.getPath("temp"), "Folevi drag"), { recursive: true, force: true });
  // The installed app answers folevi:// links (a development run would register the Electron binary).
  if (app.isPackaged) app.setAsDefaultProtocolClient(SCHEME);
  folevi = setUpSession();
  if (bundled) {
    installBundledInterface(folevi);
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
app.on("will-quit", () => globalShortcut.unregisterAll());
// Every window closed (the main one hides instead): stay running for Quick Add and the menu bar.
app.on("window-all-closed", () => undefined);
