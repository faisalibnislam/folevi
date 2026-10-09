// Folevi for Mac: app.folevi.com in a window of its own, plus what a browser tab can't do: Quick Add from any
// app (⌥Space), a menu bar icon, opening at login, Mac notifications and the Dock badge.
import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  Notification,
  screen,
  session,
  shell,
  Tray,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type MenuItemConstructorOptions,
  type Session,
  type WebContents,
} from "electron";
import { join } from "node:path";
import { appUrl, APP_URL, isAppUrl, isExternalSafe } from "./urls";
import { cleanSettings, loadSettings, saveSettings, type DesktopSettings } from "./settings";
import { restoreWindow, saveWindow } from "./windowState";

const PARTITION = "persist:folevi";
const settingsFile = () => join(app.getPath("userData"), "settings.json");
const windowFile = () => join(app.getPath("userData"), "window.json");
const asset = (name: string) => join(__dirname, "..", "assets", name);

let settings: DesktopSettings;
let mainWindow: BrowserWindow | null = null;
let quickAdd: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let shortcutError: string | null = null;
let recent: { id: string; title: string }[] = [];
let status = "";

// Test runs keep their own sign-in and settings, apart from the installed app's.
if (process.env.FOLEVI_USER_DATA) app.setPath("userData", process.env.FOLEVI_USER_DATA);

// ---------------------------------------------------------------- one Folevi at a time

if (!app.requestSingleInstanceLock()) app.quit();
app.on("second-instance", () => showMain());

// ---------------------------------------------------------------- the session every window shares

function setUpSession(): Session {
  const ses = session.fromPartition(PARTITION);
  // The site can tell it's in the Mac app (e.g. to say "Open Folevi" rather than "Open in browser").
  ses.setUserAgent(`${ses.getUserAgent()} FoleviDesktop/${app.getVersion()}`);
  // Only Folevi's own pages get anything, and only what the web app uses: the microphone (audio notes),
  // the clipboard (paste) and full screen (presenting).
  const allowed = new Set(["media", "clipboard-read", "clipboard-sanitized-write", "fullscreen", "notifications"]);
  ses.setPermissionRequestHandler((_wc, permission, callback, details) => {
    const audioOnly = permission !== "media" || ("mediaTypes" in details && (details.mediaTypes ?? []).every((t) => t === "audio"));
    callback(isAppUrl(details.requestingUrl) && allowed.has(permission) && audioOnly);
  });
  ses.setPermissionCheckHandler((_wc, permission, origin) => isAppUrl(origin) && allowed.has(permission));
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

// ---------------------------------------------------------------- settings

function applyLoginItem() {
  // Only the installed app registers itself (a development run would register the Electron binary).
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: settings.openAtLogin });
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
  ipcMain.handle("desktop:get-settings", (e) => (fromFolevi(e) ? { settings, error: shortcutError } : null));
  ipcMain.handle("desktop:set-settings", (e, patch: unknown) => {
    if (!fromFolevi(e)) return null;
    applySettings(cleanSettings(patch, settings));
    return { settings, error: shortcutError };
  });
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
  ipcMain.on("desktop:open", (e, path: unknown) => {
    if (!fromFolevi(e)) return;
    quickAdd?.hide();
    showMain(text(path, 500) || undefined);
  });
}

// ---------------------------------------------------------------- start

app.setAboutPanelOptions({ applicationName: "Folevi", applicationVersion: app.getVersion(), copyright: "© 2026 Folevi", website: "https://folevi.com" });

app.whenReady().then(() => {
  settings = loadSettings(settingsFile());
  setUpSession();
  listen();
  buildMenu();
  shortcutError = registerShortcut();
  applyLoginItem();
  updateTray();
  // Opened at login: quietly, ready for Quick Add. Otherwise the main window.
  const atLogin = app.getLoginItemSettings().wasOpenedAtLogin;
  if (!atLogin) createMainWindow();
  createQuickAdd();
  nativeTheme.on("updated", () => {
    for (const win of BrowserWindow.getAllWindows()) win.setBackgroundColor(background());
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
