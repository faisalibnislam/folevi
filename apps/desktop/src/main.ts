// Folevi for Mac: app.folevi.com in a window of its own, plus what a browser tab can't do: Quick Add from any
// app (⌥Space), a menu bar icon, opening at login, Mac notifications and the Dock badge. The same shell is
// Folevi for Windows (Ctrl+Alt+Space, a system tray icon, Windows notifications, an unread dot on the
// taskbar button); src/platform.ts says what differs.
import {
  app,
  BrowserWindow,
  desktopCapturer,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  Notification,
  screen,
  session,
  shell,
  systemPreferences,
  Tray,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type MenuItemConstructorOptions,
  type NativeImage,
  type Session,
  type WebContents,
} from "electron";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { appUrl, APP_URL, dragFileName, isAppUrl, isExternalSafe, parseDeepLink, SCHEME, systemSettingsUrl } from "./urls";
import { installUpdate, startUpdates, type UpdateState } from "./updates";
import { badgeDescription, badgeDot, linkFromArgv, LOGIN_ARG, menuAccelerator, platformOf, titleBarOverlay, WINDOWS_APP_ID } from "./platform";
import { cleanSettings, loadSettings, saveSettings, type DesktopSettings } from "./settings";
import { restoreWindow, saveWindow } from "./windowState";

const PARTITION = "persist:folevi";
const settingsFile = () => join(app.getPath("userData"), "settings.json");
const windowFile = () => join(app.getPath("userData"), "window.json");
const asset = (name: string) => join(__dirname, "..", "assets", name);
const platform = platformOf();
const windows = platform === "windows";

let settings: DesktopSettings;
let mainWindow: BrowserWindow | null = null;
let quickAdd: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let shortcutError: string | null = null;
let recent: { id: string; title: string }[] = [];
let status = "";
let update: UpdateState = { state: "idle" };
let checkForUpdates: (() => void) | null = null;
/** A folevi:// link that arrived before the app was ready (on Windows, the link that started it). */
let pendingLink: string | null = linkFromArgv(process.argv);
/** The unread count, kept for main windows opened later (Windows shows it on each one's taskbar button). */
let unread = 0;

// Test runs keep their own sign-in and settings, apart from the installed app's.
if (process.env.FOLEVI_USER_DATA) app.setPath("userData", process.env.FOLEVI_USER_DATA);
// Windows matches toasts and the taskbar button to the Start menu shortcut the installer made by this id.
if (windows) app.setAppUserModelId(WINDOWS_APP_ID);

// ---------------------------------------------------------------- one Folevi at a time

if (!app.requestSingleInstanceLock()) app.quit();
app.on("second-instance", (_e, argv) => {
  const link = linkFromArgv(argv);
  if (link) openLink(link);
  else showMain();
});

// ---------------------------------------------------------------- folevi:// links

// macOS hands links over with open-url, which can come before the app is ready (a link opened Folevi).
// Windows passes them as arguments instead: to a running Folevi through second-instance, above, and to
// one starting up in process.argv (pendingLink).
app.on("will-finish-launching", () => {
  app.on("open-url", (event, url) => {
    event.preventDefault();
    if (app.isReady()) openLink(url);
    else pendingLink = url;
  });
});

function openLink(url: string) {
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

/** Links to anywhere but Folevi open in the browser; Folevi's own "open in a new tab" opens a new window. */
function guardNavigation(contents: WebContents) {
  contents.on("will-navigate", (event, url) => {
    if (isAppUrl(url) || url.startsWith("file:")) return;
    event.preventDefault();
    if (isExternalSafe(url)) void shell.openExternal(url);
  });
  contents.setWindowOpenHandler(({ url }) => {
    if (isAppUrl(url)) createMainWindow(new URL(url).pathname + new URL(url).search);
    else if (isExternalSafe(url)) void shell.openExternal(url);
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
    // On Windows, minimize, maximize and close are drawn over the page's top right corner (the page keeps it
    // clear); on a Mac the traffic lights go where the page keeps room for them (desktop:window-buttons).
    ...(windows ? { titleBarOverlay: titleBarOverlay(nativeTheme.shouldUseDarkColors) } : { trafficLightPosition: { x: 20, y: 22 } }),
    backgroundColor: background(),
    webPreferences: webPreferences(),
  });
  if (first) {
    mainWindow = win;
    if (saved.maximized) win.maximize();
  }
  if (windows) {
    // No menu bar on Windows (its shortcuts still work: buildMenu), and the unread dot on this window too
    // (once it has a taskbar button).
    win.setMenuBarVisibility(false);
    win.once("show", () => setTaskbarBadge(win));
  }
  guardNavigation(win.webContents);
  win.once("ready-to-show", () => win.show());
  const remember = () => {
    if (win !== mainWindow || win.isDestroyed()) return;
    saveWindow(windowFile(), { bounds: win.isMaximized() ? saved.bounds : win.getNormalBounds(), maximized: win.isMaximized() });
  };
  win.on("resize", remember);
  win.on("move", remember);
  // Closing the first window hides it (Quick Add and the menu bar keep working); ⌘Q quits. On Windows
  // without the tray icon nothing would show Folevi is still running, so there closing it quits.
  win.on("close", (event) => {
    if (win === mainWindow && !quitting) {
      event.preventDefault();
      remember();
      if (windows && !tray) app.quit();
      else win.hide();
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
  // (Spaces are a Mac thing; on Windows it shows on the current virtual desktop.)
  if (!windows) quickAdd.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
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
    // Mac: the F alone, tinted by the system. Windows: the round mark in colour (16 to 48 px in one .ico).
    const icon = nativeImage.createFromPath(asset(windows ? "tray.ico" : "trayTemplate.png"));
    if (!windows) icon.setTemplateImage(true);
    tray = new Tray(icon);
    tray.setToolTip("Folevi");
    // Windows: a click on the tray icon opens Folevi, a right click shows the menu (the system does that).
    if (windows) tray.on("click", () => showMain());
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
  if (windows) {
    Menu.setApplicationMenu(Menu.buildFromTemplate(windowsMenu()));
    return;
  }
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

/**
 * Windows: the same commands with Windows' keys. The menu bar stays hidden (Windows apps like this one have
 * none), but its shortcuts work: Ctrl+N, Ctrl+Shift+N, Ctrl+, and the View menu's.
 */
function windowsMenu(): MenuItemConstructorOptions[] {
  const key = (accelerator: string) => menuAccelerator(accelerator, platform);
  return [
    {
      label: "File",
      submenu: [
        { label: "New Note", accelerator: key("Command+N"), click: () => commandMain({ type: "new-note" }) },
        { label: "Quick Add Task…", accelerator: settings.quickAddShortcut || undefined, registerAccelerator: false, click: toggleQuickAdd },
        { label: "New Window", accelerator: key("Command+Shift+N"), click: () => createMainWindow() },
        { type: "separator" },
        { label: "Settings…", accelerator: key("Command+,"), click: () => showMain("/settings/desktop") },
        { type: "separator" },
        { role: "close", label: "Close Window" },
        { role: "quit", label: "Quit Folevi" },
      ],
    },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools", accelerator: key("Command+Shift+I") },
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
        { label: "Back", accelerator: "Alt+Left", click: (_i, win) => (win as BrowserWindow | undefined)?.webContents.navigationHistory.goBack() },
        { label: "Forward", accelerator: "Alt+Right", click: (_i, win) => (win as BrowserWindow | undefined)?.webContents.navigationHistory.goForward() },
        { type: "separator" },
        { label: "Notes", click: () => showMain("/documents") },
        { label: "Tasks", click: () => showMain("/tasks/today") },
        { label: "Calendar", click: () => showMain("/calendar") },
      ],
    },
    {
      label: "Help",
      submenu: [{ label: "Folevi Help", click: () => showMain("/help") }, { type: "separator" }, { role: "about", label: "About Folevi" }],
    },
  ];
}

function updateMenuItems(): MenuItemConstructorOptions[] {
  if (!checkForUpdates) return [];
  if (update.state === "ready") return [{ label: `Restart to Update${update.version ? ` to ${update.version}` : ""}`, click: installUpdate }];
  const busy = update.state === "checking" || update.state === "downloading";
  return [{ label: update.state === "downloading" ? "Downloading Update…" : "Check for Updates…", enabled: !busy, click: () => checkForUpdates?.() }];
}

// ---------------------------------------------------------------- settings

function applyLoginItem() {
  // Only the installed app registers itself (a development run would register the Electron binary). Windows
  // can't tell a launch at sign-in from any other, so its entry passes LOGIN_ARG.
  if (!app.isPackaged) return;
  if (windows) app.setLoginItemSettings({ openAtLogin: settings.openAtLogin, args: [LOGIN_ARG] });
  else app.setLoginItemSettings({ openAtLogin: settings.openAtLogin });
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

/**
 * Windows has no badge with a number: a red dot over the taskbar button while anything is unread (the count
 * is in its description, for screen readers). Every main window gets it, or just `only`.
 */
function setTaskbarBadge(only?: BrowserWindow) {
  let dot: NativeImage | null = null;
  if (unread > 0) {
    dot = nativeImage.createFromBitmap(badgeDot(16), { width: 16, height: 16 });
    dot.addRepresentation({ scaleFactor: 2, width: 32, height: 32, buffer: badgeDot(32) });
  }
  for (const win of only ? [only] : BrowserWindow.getAllWindows()) {
    if (win !== quickAdd && !win.isDestroyed()) win.setOverlayIcon(dot, dot ? badgeDescription(unread) : "");
  }
}
const text = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

function listen() {
  ipcMain.on("desktop:badge", (e, count: unknown) => {
    if (!fromFolevi(e)) return;
    const n = typeof count === "number" && Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
    if (windows) {
      if (n === unread) return;
      unread = n;
      setTaskbarBadge();
      return;
    }
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
  ipcMain.handle("desktop:get-settings", (e) => (fromFolevi(e) ? { settings, error: shortcutError } : null));
  ipcMain.handle("desktop:set-settings", (e, patch: unknown) => {
    if (!fromFolevi(e)) return null;
    applySettings(cleanSettings(patch, settings));
    return { settings, error: shortcutError };
  });
  ipcMain.on("desktop:window-buttons", (e, spot: unknown) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    // (Windows draws its buttons at the top right itself: the page keeps that corner clear instead.)
    if (windows || !fromFolevi(e) || !win || win === quickAdd || !spot || typeof spot !== "object") return;
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
  // to Finder (File Explorer) or another app.
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
        .catch(() => nativeImage.createFromPath(asset(windows ? "icon-48.png" : "trayTemplate@2x.png")))
        .then((icon) => e.sender.startDrag({ file, icon }))
        .catch(() => undefined);
    } catch {
      /* The drag simply carries nothing. */
    }
  });
  // Whether this Mac lets Folevi record the screen and its sound (granted only once macOS has been told so
  // and Folevi has restarted): a call recording checks it before it starts.
  ipcMain.handle("desktop:screen-access", (e) => (fromFolevi(e) ? systemPreferences.getMediaAccessStatus("screen") : null));
  // Recording a call without the permission: the page offers to open the right System Settings pane.
  ipcMain.on("desktop:system-settings", (e, pane: unknown) => {
    const url = systemSettingsUrl(pane);
    if (!windows && fromFolevi(e) && url) void shell.openExternal(url);
  });
  ipcMain.on("desktop:open", (e, path: unknown) => {
    if (!fromFolevi(e)) return;
    quickAdd?.hide();
    showMain(text(path, 500) || undefined);
  });
}

// ---------------------------------------------------------------- start

app.setAboutPanelOptions({
  applicationName: "Folevi",
  applicationVersion: app.getVersion(),
  copyright: "© 2026 Folevi",
  website: "https://folevi.com",
  // Windows' About box shows this (48 px reads best there); macOS uses the app's own icon.
  ...(windows ? { iconPath: asset("icon-48.png") } : {}),
});

app.whenReady().then(() => {
  // Earlier drags' files: nothing needs them once the app has restarted.
  rmSync(join(app.getPath("temp"), "Folevi drag"), { recursive: true, force: true });
  // The installed app answers folevi:// links (a development run would register the Electron binary).
  if (app.isPackaged) app.setAsDefaultProtocolClient(SCHEME);
  // Windows: New Note and Quick Add in the taskbar button's jump list (they arrive as folevi:// links).
  if (windows && app.isPackaged) {
    app.setUserTasks([
      { program: process.execPath, arguments: `${SCHEME}://new`, iconPath: process.execPath, iconIndex: 0, title: "New Note", description: "Start a new note" },
      { program: process.execPath, arguments: `${SCHEME}://quick-add`, iconPath: process.execPath, iconIndex: 0, title: "Quick Add Task", description: "Add a task from anywhere" },
    ]);
  }
  settings = loadSettings(settingsFile());
  setUpSession();
  listen();
  buildMenu();
  shortcutError = registerShortcut();
  applyLoginItem();
  updateTray();
  // Opened at login (or by a link): quietly, ready for Quick Add. Otherwise the main window.
  const atLogin = app.getLoginItemSettings().wasOpenedAtLogin || process.argv.includes(LOGIN_ARG);
  if (!atLogin && !pendingLink) createMainWindow();
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
    for (const win of BrowserWindow.getAllWindows()) {
      win.setBackgroundColor(background());
      if (windows && win !== quickAdd) win.setTitleBarOverlay(titleBarOverlay(nativeTheme.shouldUseDarkColors));
    }
  });
  console.log(`Folevi is showing ${APP_URL.origin}`);
});

// The Dock icon reopens the main window.
app.on("activate", () => showMain());
app.on("before-quit", () => {
  quitting = true;
});
app.on("will-quit", () => globalShortcut.unregisterAll());
// Every window closed (the main one hides instead): stay running for Quick Add and the menu bar.
app.on("window-all-closed", () => undefined);
