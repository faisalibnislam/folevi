//! Folevi for Windows (ARM64 and x64) and Linux (x86_64 and aarch64): Folevi's own interface, built into the app
//! and served at app://localhost (https://app.localhost on Windows), in the system's web view (WebView2, WebKitGTK),
//! plus what a browser tab can't do: Quick Add from any app (Ctrl+Alt+Space), an icon in the notification area,
//! opening at sign-in, notifications, the unread count on the taskbar, folevi:// links, one copy at a time and the
//! window remembered. The page talks to this side through the iPhone, iPad and Mac apps' shared bridge
//! (bridge/host.js around apps/ios/ios/App/Native/Shell/shell-bridge.js) with the same method names as the Mac's
//! ShellRouter.swift. Since 2026-11-24 (the owner's "one web app everywhere", small and light like the Mac app);
//! it replaces the Electron build of PR 58. docs/DESKTOP_APP.md.
mod ai;
mod applock;
mod hello;
mod auth;
mod backsync;
mod badge;
mod e2ee;
mod events;
mod http;
mod library;
#[cfg(target_os = "linux")]
pub mod linux;
mod notify;
mod places;
mod protocol;
mod reminders;
mod secrets;
mod settings;
mod server;
mod shell;
mod updates;

use parking_lot::Mutex;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tauri_plugin_opener::OpenerExt;

use crate::places::{user_id_of, PlacesStore, LIBRARY};
use crate::settings::DesktopSettings;
use crate::shell::{now_ms, opt_bool, opt_f64, opt_str, req_str, value, ShellError, ShellResult};

/// Windows ties notifications and the taskbar button to this (the installer's Start menu shortcut carries it).
pub const APP_ID: &str = "com.folevi.desktop";
const SCHEME: &str = "folevi";
const FOLEVI_VERSION: &str = env!("FOLEVI_VERSION");
const WINDOWS: bool = cfg!(windows);
const MAC: bool = cfg!(target_os = "macos");
/// How notes "on this device" are named in notifications: Windows says "this PC", Linux "this computer".
#[cfg(not(target_os = "linux"))]
const THIS_DEVICE: &str = "On this PC";
#[cfg(target_os = "linux")]
const THIS_DEVICE: &str = linux::THIS_DEVICE;
/// The caption buttons' height on Windows (the page's tab strip sits below and to their left).
const CAPTION_HEIGHT: u32 = 40;
const HOST_JS: &str = include_str!("../bridge/host.js");
const SHELL_BRIDGE_JS: &str = include_str!("../../../ios/ios/App/Native/Shell/shell-bridge.js");

/// The look the page gets: "windows", or "linux"; a development run on a Mac gets Windows' (FOLEVI_LOOK=linux for Linux's).
fn look() -> &'static str {
    match std::env::var("FOLEVI_LOOK").as_deref() {
        Ok("linux") => "linux",
        Ok("windows") => "windows",
        _ if cfg!(target_os = "linux") => "linux",
        _ => "windows",
    }
}

/// The interface's origin as the web view sees it.
fn app_origin() -> &'static str {
    if WINDOWS {
        "https://app.localhost"
    } else {
        "app://localhost"
    }
}

/// A path inside the app as the URL a window opens ("/documents" -> app://localhost/documents).
fn app_url(path: &str) -> tauri::Url {
    let safe = if path.starts_with('/') && !path.starts_with("//") && path.len() <= 600 { path } else { "/documents" };
    tauri::Url::parse(&format!("app://localhost{safe}")).unwrap_or_else(|_| tauri::Url::parse("app://localhost/documents").unwrap())
}

/// Whether a URL is one of the app's own pages.
fn is_app_url(url: &str) -> bool {
    url.starts_with("app://localhost/") || url.starts_with("https://app.localhost/") || url.starts_with("http://app.localhost/") || url == "app://localhost" || url == "https://app.localhost"
}

/// The app's pages a folevi:// link may open (urls.ts parseDeepLink in the Electron build).
fn deep_link_path(url: &tauri::Url) -> Option<String> {
    if url.scheme() != SCHEME {
        return None;
    }
    let host = url.host_str().unwrap_or("");
    let path = url.path();
    let note = |id: &str| id.len() == 26 && id.chars().all(|c| c.is_ascii_digit() || c.is_ascii_uppercase());
    match host {
        "new" => Some("new".into()),
        "quick-add" => Some("quick-add".into()),
        "d" => {
            let id = path.trim_start_matches('/');
            let ok = note(id) || (id.starts_with("inbox-") && id.len() <= 46 && id[6..].chars().all(|c| c.is_ascii_digit() || c.is_ascii_lowercase()));
            ok.then(|| format!("/d/{id}{}", url.fragment().filter(|f| f.len() <= 80 && f.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')).map(|f| format!("#{f}")).unwrap_or_default()))
        }
        "documents" | "tasks" | "calendar" | "inbox" | "settings" | "foli-ai" | "trash" | "templates" | "help" => {
            let rest = path.trim_end_matches('/');
            let ok = rest.is_empty() || rest.split('/').skip(1).all(|s| !s.is_empty() && s.len() <= 40 && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-'));
            ok.then(|| format!("/{host}{rest}"))
        }
        _ => None,
    }
}

// ---------------------------------------------------------------- the app's state

struct Paths {
    user_data: PathBuf,
    home: PathBuf,
    /// A run with its own data folder (FOLEVI_USER_DATA): never the person's data, keyring or login items.
    test_run: bool,
}

struct Services {
    paths: Paths,
    service_url: tauri::Url,
    extra_connect: Vec<String>,
    sealer: Arc<secrets::Sealer>,
    secrets: Arc<secrets::SecretStore>,
    library: Arc<library::LibraryService>,
    auth: Arc<auth::Auth>,
    ai: Arc<ai::Ai>,
    reminders: Arc<reminders::Reminders>,
    lock: Arc<applock::AppLock>,
    places: Mutex<PlacesStore>,
    /// Background sync's plan: which places sync in hidden runners, which are awake (backsync.rs).
    backsync: Mutex<backsync::BackSync>,
    /// Convex tokens for the native unread count, by place, with when each runs out (unix seconds).
    poll_tokens: Mutex<HashMap<String, (String, u64)>>,
    settings: Mutex<DesktopSettings>,
    /// Which place each window's page belongs to (by label).
    bound: Mutex<HashMap<String, Option<String>>>,
    /// Each account's encryption keys (user id), and the PC's first pair (the library's).
    keys: Mutex<HashMap<String, Arc<e2ee::DeviceKeys>>>,
    ui: Mutex<Ui>,
}

#[derive(Default)]
struct Ui {
    recent: Vec<(String, String)>,
    status: String,
    badge: u64,
    shortcut_error: Option<String>,
    quitting: bool,
    windows: u32,
    tray: Option<TrayIcon>,
    dark: Option<bool>,
    /// Background sync has begun (a few seconds after launch).
    runners_started: bool,
}

fn services(app: &AppHandle) -> tauri::State<'_, Arc<Services>> {
    app.state::<Arc<Services>>()
}

impl Services {
    /// The Folevi Server a place belongs to ("Your own server"; the sign-in screen's for no place). None: Folevi
    /// Cloud, or the library.
    fn server_of(&self, place: Option<&str>) -> Option<server::ShellServer> {
        self.places.lock().server_of(place)
    }

    /// The website a place's session lives on, when it's a Folevi Server's (None: Folevi Cloud's).
    fn site_of(&self, place: Option<&str>) -> Option<url::Url> {
        self.server_of(place).and_then(|sv| sv.app_url())
    }

    fn settings_file(&self) -> PathBuf {
        self.paths.user_data.join("settings.json")
    }
    fn place_of(&self, label: &str) -> Option<String> {
        self.bound.lock().get(label).cloned().unwrap_or_else(|| self.places.lock().current())
    }
    fn mode_of(&self, place: Option<&str>) -> &'static str {
        self.places.lock().mode_of(place)
    }
    fn keys_for(&self, place: Option<&str>) -> Arc<e2ee::DeviceKeys> {
        let user = user_id_of(place);
        let key = user.clone().unwrap_or_default();
        let mut keys = self.keys.lock();
        keys.entry(key)
            .or_insert_with(|| {
                let base = self.paths.user_data.join("e2ee");
                let dir = match &user {
                    Some(u) => base.join("accounts").join(u),
                    None => base,
                };
                Arc::new(e2ee::DeviceKeys::new(dir, self.sealer.clone()))
            })
            .clone()
    }
}

// ---------------------------------------------------------------- talking to the pages

/// Sends shell event `key` ("FoleviShell:libraryChanges", "desktop:command"...) to every Folevi page (by script, so the
/// pages need no event permissions).
fn emit_to_pages(app: &AppHandle, key: &str, payload: &Value, only: Option<&str>) {
    let script = format!("window.__foleviHost&&window.__foleviHost.emit({},{})", serde_json::to_string(key).unwrap_or_default(), payload);
    for (label, w) in app.webview_windows() {
        if only.is_some_and(|o| o != label) {
            continue;
        }
        let _ = w.eval(&script);
    }
}

fn emitter(app: &AppHandle) -> events::Emit {
    let app = app.clone();
    Arc::new(move |event: &str, payload: Value| {
        emit_to_pages(&app, &format!("FoleviShell:{event}"), &payload, None);
        if event == "libraryChanges" {
            library_changed(&app);
        }
    })
}

/// What every page of a window starts with (host.js's BOOT): the look and the app's facts. The page's own place
/// and mode come with each page (page_boot).
fn boot_script(_app: &AppHandle, label: &str) -> String {
    let accent = accent_color();
    let quick = label == "quickadd";
    let boot = json!({
        "shell": true,
        "platform": look(),
        "mac": MAC,
        "window": if quick { "quickadd" } else if is_runner(label) { "runner" } else { "main" },
        "version": FOLEVI_VERSION,
        "deviceName": device_name(),
        "accent": accent,
        "captionHeight": CAPTION_HEIGHT,
        // FOLEVI_PROBE=1 (development builds): the page reports its state to the terminal, for scripted checks.
        "probe": cfg!(debug_assertions) && std::env::var_os("FOLEVI_PROBE").is_some(),
        "origins": [app_origin()],
    });
    let script = HOST_JS.replace("/*BOOT*/ { shell: false, platform: \"windows\", window: \"main\" } /*BOOT_END*/", &boot.to_string()).replace("/*SHELL_BRIDGE*/", SHELL_BRIDGE_JS);
    if cfg!(debug_assertions) && std::env::var_os("FOLEVI_PROBE").is_some() {
        // Development: the script's own failures reach the terminal too.
        let report = "function(m){try{fetch(location.origin+'/_probe?'+encodeURIComponent(m))}catch(_){}}";
        // FOLEVI_PROBE_SCRIPT=<file.js>: a scripted walk in every main page (scripts/smoke-flow.js), its findings
        // reported the same way.
        let flow = if !quick { std::env::var("FOLEVI_PROBE_SCRIPT").ok().and_then(|f| std::fs::read_to_string(f).ok()).unwrap_or_default() } else { String::new() };
        let walk = if flow.is_empty() { String::new() } else { format!(";(function(report){{try{{{flow}\n}}catch(e){{report({{step:'error',error:String(e)}})}}}})(function(d){{try{{fetch(location.origin+'/_probe?'+encodeURIComponent(JSON.stringify(d)))}}catch(_){{}}}});") };
        let all = format!("({report})('boot '+location.href);try{{{script}}}catch(e){{({report})('ERROR '+e+' '+(e&&e.stack))}}{walk}");
        if let Ok(dump) = std::env::var("FOLEVI_DUMP_INIT") {
            let _ = std::fs::write(format!("{dump}-{label}.js"), &all);
        }
        return all;
    }
    script
}

/// The page's own start for the window `label` (shell-bridge.js's SHELL): its place and mode, the device's name and
/// where it opens. Put first in the page's <head> by serve().
fn page_boot(s: &Services, label: &str, path: &str) -> Value {
    let place = s.place_of(label);
    json!({
        "mode": s.mode_of(place.as_deref()),
        "deviceName": device_name(),
        "start": if path.starts_with('/') && !path.starts_with("//") && path != "/" && path != "/index.html" { path } else { "/documents" },
        // "Your own server": the server the page talks to (its website, Convex and Convex site), or null.
        "places": { "current": place, "background": is_runner(label), "server": s.server_of(place.as_deref()).map(|sv| sv.json()) },
        // The app lock's cover, from the page's first moment (no flash of notes while locked).
        "locked": is_main_label(label) && s.lock.covered(),
        "lockMethod": s.lock.method(),
    })
}

fn device_name() -> String {
    let name = std::env::var("COMPUTERNAME").ok().filter(|s| !s.is_empty()).or_else(|| hostname::get().ok().and_then(|h| h.into_string().ok())).unwrap_or_default();
    let name = name.trim_end_matches(".local").chars().take(80).collect::<String>();
    if name.is_empty() {
        "PC".into()
    } else {
        name
    }
}

/// Windows' accent color as "#RRGGBB" (the page's focus rings and selected text).
fn accent_color() -> Option<String> {
    #[cfg(windows)]
    {
        // HKCU\Software\Microsoft\Windows\DWM AccentColor is ABGR.
        let out = std::process::Command::new("reg").args(["query", r"HKCU\Software\Microsoft\Windows\DWM", "/v", "AccentColor"]).output().ok()?;
        let text = String::from_utf8_lossy(&out.stdout);
        let hex = text.split_whitespace().find(|w| w.starts_with("0x"))?;
        let v = u32::from_str_radix(hex.trim_start_matches("0x"), 16).ok()?;
        let (r, g, b) = (v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff);
        Some(format!("#{r:02X}{g:02X}{b:02X}"))
    }
    #[cfg(not(windows))]
    None
}

// ---------------------------------------------------------------- windows

fn background(dark: bool) -> tauri::window::Color {
    if dark {
        tauri::window::Color(0x0e, 0x0e, 0x0f, 255)
    } else {
        tauri::window::Color(255, 255, 255, 255)
    }
}

/// A main window showing the open place at `path`. The first is "main"; Ctrl+Shift+N makes "main-2"...
fn create_main(app: &AppHandle, path: &str, label: Option<String>, show: bool) -> tauri::Result<WebviewWindow> {
    let s = services(app);
    let label = label.unwrap_or_else(|| {
        let mut ui = s.ui.lock();
        if app.get_webview_window("main").is_none() {
            "main".into()
        } else {
            ui.windows += 1;
            format!("main-{}", ui.windows + 1)
        }
    });
    let place = s.places.lock().current();
    s.bound.lock().insert(label.clone(), place);
    let dark = s.ui.lock().dark.unwrap_or(false);
    let script = boot_script(app, &label);
    let mut b = WebviewWindowBuilder::new(app, &label, WebviewUrl::CustomProtocol(app_url(path)))
        .title("Folevi")
        .inner_size(1280.0, 820.0)
        .min_inner_size(800.0, 480.0)
        .visible(false)
        .background_color(background(dark))
        .initialization_script(&script)
        .disable_drag_drop_handler()
        .on_navigation(|url| {
            let u = url.as_str();
            if is_app_url(u) || u.starts_with("about:") || u.starts_with("data:") {
                return true;
            }
            false
        });
    #[cfg(windows)]
    {
        b = b.decorations(false).use_https_scheme(true);
    }
    #[cfg(target_os = "macos")]
    {
        b = b.title_bar_style(tauri::TitleBarStyle::Overlay).hidden_title(true);
    }
    let w = b.build()?;
    watch_window(app, &w);
    if show {
        let _ = w.show();
        let _ = w.set_focus();
    }
    Ok(w)
}

fn watch_window(app: &AppHandle, w: &WebviewWindow) {
    let app = app.clone();
    let label = w.label().to_string();
    let win = w.clone();
    w.on_window_event(move |event| match event {
        WindowEvent::CloseRequested { api, .. } => {
            let s = services(&app);
            // Kept running by the tray icon only when there is one (a Linux desktop may have no tray).
            let keep = label == "main" && !s.ui.lock().quitting && s.ui.lock().tray.is_some();
            if keep {
                api.prevent_close();
                let _ = win.hide();
            }
        }
        WindowEvent::Destroyed => {
            let s = services(&app);
            s.bound.lock().remove(&label);
            if label == "main" && !s.ui.lock().quitting && s.ui.lock().tray.is_none() {
                app.exit(0);
            }
        }
        WindowEvent::Resized(_) | WindowEvent::Focused(_) => {
            let state = json!({ "maximized": win.is_maximized().unwrap_or(false), "fullscreen": win.is_fullscreen().unwrap_or(false), "focused": win.is_focused().unwrap_or(true) });
            emit_to_pages(&app, "desktop:window", &state, Some(&label));
            if let WindowEvent::Focused(f) = event {
                note_focus(&app, *f);
            }
            if let WindowEvent::Focused(true) = event {
                let lib = services(&app).library.clone();
                tauri::async_runtime::spawn(async move { lib.rescan().await });
            }
        }
        _ => {}
    });
}

/// Brings the main window forward, at `path` when given (the page moves there without reloading).
fn show_main(app: &AppHandle, path: Option<&str>) {
    match app.get_webview_window("main") {
        Some(w) => {
            if let Some(p) = path {
                emit_to_pages(app, "desktop:command", &json!({ "type": "navigate", "path": p }), Some("main"));
            }
            if w.is_minimized().unwrap_or(false) {
                let _ = w.unminimize();
            }
            let _ = w.show();
            let _ = w.set_focus();
        }
        None => {
            let _ = create_main(app, path.unwrap_or("/documents"), Some("main".into()), true);
        }
    }
}

fn command_main(app: &AppHandle, command: Value) {
    show_main(app, None);
    emit_to_pages(app, "desktop:command", &command, Some("main"));
}

// ---------------------------------------------------------------- the app lock (applock.rs)

/// The passphrase prompts the page shows for the lock (Linux), by id: the page's answer, or None when cancelled.
static LOCK_PROMPTS: once_cell::sync::Lazy<Mutex<HashMap<String, tokio::sync::oneshot::Sender<Option<String>>>>> = once_cell::sync::Lazy::new(|| Mutex::new(HashMap::new()));

/// This PC's way to unlock: Windows Hello when it's set up, a passphrase on Linux.
fn lock_method() -> &'static str {
    if cfg!(windows) {
        if std::thread::spawn(hello::available).join().unwrap_or(false) {
            "windowsHello"
        } else {
            "none"
        }
    } else if cfg!(target_os = "linux") {
        "passphrase"
    } else {
        "none"
    }
}

fn is_main_label(label: &str) -> bool {
    label == "main" || label.starts_with("main-")
}

/// Covers every main window (Quick Add stays, as on the Mac) when the lock is on.
fn cover_windows(app: &AppHandle) {
    let s = services(app);
    if s.lock.cover() {
        let state = json!({ "covered": true, "method": s.lock.method() });
        for (label, w) in app.webview_windows() {
            if is_main_label(&label) {
                let _ = w.eval(&format!("window.__foleviHost&&window.__foleviHost.emit(\"desktop:lock\",{state})"));
            }
        }
    }
}

fn uncover_windows(app: &AppHandle) {
    services(app).lock.uncover();
    emit_to_pages(app, "desktop:lock", &json!({ "covered": false }), None);
}

/// Windows Hello for the encrypted notes (e2ee.rs), in front of the window that asked.
struct HelloAsk {
    hwnd: isize,
}

impl HelloAsk {
    fn for_window(app: &AppHandle, label: &str) -> Self {
        #[cfg(windows)]
        let hwnd = app.get_webview_window(label).and_then(|w| w.hwnd().ok()).map(|h| h.0 as isize).unwrap_or(0);
        #[cfg(not(windows))]
        let hwnd = {
            let _ = (app, label);
            0isize
        };
        Self { hwnd }
    }
}

impl e2ee::Ask for HelloAsk {
    fn available(&self) -> bool {
        hello::available()
    }
    fn confirm(&self, message: &str) -> bool {
        hello::verify(self.hwnd, message)
    }
}

/// Windows Hello in front of the window `label`, on a blocking thread: true when it said it's them.
async fn ask_hello(app: &AppHandle, label: &str, message: &'static str) -> bool {
    #[cfg(windows)]
    let hwnd = app.get_webview_window(label).and_then(|w| w.hwnd().ok()).map(|h| h.0 as isize).unwrap_or(0);
    #[cfg(not(windows))]
    let hwnd = {
        let _ = (app, label);
        0isize
    };
    tauri::async_runtime::spawn_blocking(move || hello::verify(hwnd, message)).await.unwrap_or(false)
}

/// The page's passphrase prompt in the window `label` ("set": choose one; "check": type it): the passphrase, or
/// None when cancelled (or after five minutes).
async fn ask_passphrase(app: &AppHandle, label: &str, mode: &str) -> Option<String> {
    let id = format!("p{}", now_ms());
    let (tx, rx) = tokio::sync::oneshot::channel();
    LOCK_PROMPTS.lock().insert(id.clone(), tx);
    emit_to_pages(app, "desktop:lockPrompt", &json!({ "id": id, "mode": mode, "min": applock::MIN_PASSPHRASE }), Some(label));
    let answer = tokio::time::timeout(std::time::Duration::from_secs(300), rx).await.ok().and_then(Result::ok).flatten();
    LOCK_PROMPTS.lock().remove(&id);
    answer
}

/// lockSet { lock?, lockAfter? } (MacAppLock.swift): turning the lock on or off needs the person to confirm it.
async fn lock_set(app: &AppHandle, s: &Arc<Services>, label: &str, o: &Value) -> ShellResult {
    let after = match o.get("lockAfter") {
        None | Some(Value::Null) => None,
        Some(v) => Some(applock::valid_after(v).ok_or_else(|| ShellError::invalid("lockAfter is a number of seconds."))?),
    };
    let lock = match o.get("lock") {
        None | Some(Value::Null) => None,
        Some(Value::Bool(b)) => Some(*b),
        Some(_) => return Err(ShellError::invalid("lock is true or false.")),
    };
    if cfg!(windows) {
        let method = lock_method();
        s.lock.set_method(method);
    }
    if let Some(on) = lock.filter(|on| *on != s.lock.on()) {
        match s.lock.method() {
            "windowsHello" => {
                let message = if on { "Turn on the Windows Hello lock for Folevi" } else { "Turn off the Windows Hello lock for Folevi" };
                if !ask_hello(app, label, message).await {
                    return Err(ShellError::new("cancelled", "Windows Hello didn't confirm it."));
                }
                s.lock.set_lock(on, None).map_err(|e| ShellError::io(e.to_string()))?;
            }
            "passphrase" if on => {
                let Some(p) = ask_passphrase(app, label, "set").await else { return Err(ShellError::new("cancelled", "The lock wasn't turned on.")) };
                if p.chars().count() < applock::MIN_PASSPHRASE {
                    return Err(ShellError::invalid(format!("Use at least {} characters.", applock::MIN_PASSPHRASE)));
                }
                s.lock.set_lock(true, Some(applock::hash_passphrase(&p))).map_err(|e| ShellError::io(e.to_string()))?;
            }
            "passphrase" => {
                let Some(p) = ask_passphrase(app, label, "check").await else { return Err(ShellError::new("cancelled", "The lock is still on.")) };
                let ok = s.lock.passphrase().is_some_and(|h| applock::passphrase_matches(&h, &p));
                if !ok {
                    return Err(ShellError::new("wrong_passphrase", "That passphrase isn't right."));
                }
                s.lock.set_lock(false, None).map_err(|e| ShellError::io(e.to_string()))?;
            }
            _ => return Err(ShellError::unavailable("Windows Hello isn't set up on this PC, so Folevi can't lock. Set it up in Settings > Accounts > Sign-in options.")),
        }
    }
    if let Some(a) = after {
        s.lock.set_after(a).map_err(|e| ShellError::io(e.to_string()))?;
    }
    Ok(s.lock.settings())
}

/// lockUnlock { passphrase? } from the cover: Windows Hello, or the passphrase; then every window is uncovered.
async fn lock_unlock(app: &AppHandle, s: &Arc<Services>, label: &str, passphrase: Option<&str>) -> ShellResult {
    if !s.lock.covered() {
        return Ok(value(true));
    }
    let ok = match s.lock.method() {
        "windowsHello" => ask_hello(app, label, "Unlock your Folevi notes").await,
        "passphrase" => {
            let ok = passphrase.zip(s.lock.passphrase()).is_some_and(|(p, h)| applock::passphrase_matches(&h, p));
            if !ok {
                return Err(ShellError::new("wrong_passphrase", "That passphrase isn't right."));
            }
            true
        }
        _ => true,
    };
    if ok {
        uncover_windows(app);
    }
    Ok(value(ok))
}

/// Whether any Folevi window is in front; when none is, the lock's away clock runs.
fn note_focus(app: &AppHandle, focused: bool) {
    let s = services(app);
    if focused {
        if s.lock.back(std::time::Instant::now()) {
            cover_windows(app);
        }
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        // Focus moving between Folevi's own windows isn't being away.
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        if !app.webview_windows().values().any(|w| w.is_focused().unwrap_or(false)) {
            services(&app).lock.away(std::time::Instant::now());
        }
    });
}

/// Covers after the computer slept (a tick that came far too late), whatever "Ask again" says, as on the Mac.
fn watch_sleep(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut last = std::time::SystemTime::now();
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(5)).await;
            let now = std::time::SystemTime::now();
            if now.duration_since(last).is_ok_and(|d| d > std::time::Duration::from_secs(40)) {
                let a = app.clone();
                let _ = app.run_on_main_thread(move || cover_windows(&a));
            }
            last = now;
        }
    });
}

/// Opens a place in every main window: each is made again with the new place's page (its policy and session are
/// the place's), keeping its size and position.
fn switch_to(app: &AppHandle, place: Option<String>, path: &str, pending: bool) {
    switch_with(app, place, path, pending, None)
}

/// "Your own server" (placesAddServer, the server checked already): every main window opens that server's sign-in
/// screen; signing in there makes the account a place on that server.
fn switch_to_server(app: &AppHandle, server: server::ShellServer) {
    switch_with(app, None, "/documents", true, Some(server))
}

fn switch_with(app: &AppHandle, place: Option<String>, path: &str, pending: bool, server: Option<server::ShellServer>) {
    let s = services(app);
    {
        let mut p = s.places.lock();
        if place.is_none() && pending {
            p.begin_sign_in(server);
        } else {
            p.set_current(place.clone());
        }
        let mode = p.mode_of(place.as_deref()).to_string();
        drop(p);
        let mut st = s.settings.lock();
        st.mode = mode;
        st.save(&s.settings_file());
    }
    {
        let mut ui = s.ui.lock();
        ui.recent.clear();
        ui.status.clear();
    }
    update_tray(app);
    // Each main window loads again in the new place (its page, policy and session are the place's).
    for (label, w) in app.webview_windows() {
        if label != "main" && !label.starts_with("main-") {
            continue;
        }
        s.bound.lock().insert(label.clone(), place.clone());
        let _ = w.navigate(app_url(path));
    }
    if app.get_webview_window("quickadd").is_some() && s.places.lock().quick_add().is_none() {
        recreate_quick_add(app);
    }
    update_badge(app);
    // The place now on screen stops syncing in the background; the one it replaced starts.
    ensure_runners(app);
}

// ---------------------------------------------------------------- background sync (backsync.rs)

fn is_runner(label: &str) -> bool {
    label.starts_with("runner-")
}

fn runner_label(place: &str) -> String {
    format!("runner-{place}")
}

/// Whether runners run: not in test runs (FOLEVI_RUNNERS=1 turns them on there, for checks).
fn runners_allowed(s: &Services) -> bool {
    !s.paths.test_run || std::env::var_os("FOLEVI_RUNNERS").is_some()
}

/// The places that sync in the background: every account not on screen, and the library when another place is.
fn wanted_places(s: &Services) -> Vec<String> {
    let p = s.places.lock();
    let current = p.current();
    let mut want: Vec<String> = p.account_ids().into_iter().filter(|id| Some(id) != current.as_ref()).collect();
    if p.has_library() && current.as_deref() != Some(LIBRARY) {
        want.push(LIBRARY.to_string());
    }
    want
}

/// Brings the runners in line with the places: newly wanted ones wake, ones now on screen (or gone) close.
fn ensure_runners(app: &AppHandle) {
    let s = services(app);
    if !runners_allowed(&s) || !s.ui.lock().runners_started {
        return;
    }
    let (added, gone) = s.backsync.lock().set_wanted(wanted_places(&s));
    for p in gone {
        close_runner(app, &p);
    }
    for p in added {
        wake_runner(app, &p, "background", None);
    }
}

/// Wakes a place's runner (makes its hidden page, or keeps the one that's up).
fn wake_runner(app: &AppHandle, place: &str, why: &str, hold: Option<std::time::Duration>) {
    let s = services(app);
    if !s.backsync.lock().wanted().iter().any(|p| p == place) {
        return;
    }
    s.backsync.lock().woke(place, std::time::Instant::now(), hold);
    let label = runner_label(place);
    if app.get_webview_window(&label).is_some() {
        return;
    }
    log::info!("Folevi: background sync wakes {place} ({why})");
    s.bound.lock().insert(label.clone(), Some(place.to_string()));
    let path = format!("/place-sync?place={}", percent_encoding::utf8_percent_encode(place, percent_encoding::NON_ALPHANUMERIC));
    let script = boot_script(app, &label);
    let app = app.clone();
    // Made off the event handler: WebView2 needs the message loop free while a webview starts.
    tauri::async_runtime::spawn(async move {
        #[allow(unused_mut)]
        let mut b = WebviewWindowBuilder::new(&app, &label, WebviewUrl::CustomProtocol(app_url(&path)))
            .title("Folevi")
            .inner_size(480.0, 320.0)
            .visible(false)
            .skip_taskbar(true)
            .focused(false)
            .initialization_script(&script)
            .disable_drag_drop_handler()
            .on_navigation(|url| is_app_url(url.as_str()) || url.as_str().starts_with("about:"));
        #[cfg(windows)]
        {
            b = b.use_https_scheme(true);
        }
        if let Err(e) = b.build() {
            log::warn!("Folevi: couldn't start background sync for a place ({e})");
            services(&app).bound.lock().remove(&label);
        }
    });
}

fn close_runner(app: &AppHandle, place: &str) {
    let label = runner_label(place);
    if let Some(w) = app.get_webview_window(&label) {
        let _ = w.destroy();
    }
    services(app).bound.lock().remove(&label);
}

/// The library's folder changed: its runner wakes (debounced, as the Mac's 3 seconds).
fn library_changed(app: &AppHandle) {
    static PENDING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
    if PENDING.swap(true, std::sync::atomic::Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(3)).await;
        PENDING.store(false, std::sync::atomic::Ordering::SeqCst);
        wake_runner(&app, LIBRARY, "folder", None);
    });
}

/// The scheduler: closes runners that are done, wakes the next place due a catch-up, and asks each background
/// account's unread count natively (waking its page when it went up).
fn start_background_sync(app: &AppHandle) {
    let s = services(app);
    if !runners_allowed(&s) {
        return;
    }
    let app2 = app.clone();
    tauri::async_runtime::spawn(async move {
        // After the first window has loaded its page (or five seconds).
        tokio::time::sleep(std::time::Duration::from_secs(5)).await;
        services(&app2).ui.lock().runners_started = true;
        let a = app2.clone();
        let _ = app2.run_on_main_thread(move || ensure_runners(&a));
        loop {
            let pace = services(&app2).backsync.lock().pace();
            tokio::time::sleep(pace).await;
            let now = std::time::Instant::now();
            let (done, due) = {
                let s = services(&app2);
                let mut b = s.backsync.lock();
                let done = b.to_release(now);
                let due = b.due(now);
                (done, due)
            };
            for p in done {
                close_runner(&app2, &p);
            }
            for p in due {
                wake_runner(&app2, &p, "catch up", None);
            }
        }
    });
    let app3 = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(10)).await;
        loop {
            poll_unread(&app3).await;
            let front = app3.webview_windows().values().any(|w| w.is_focused().unwrap_or(false));
            let every = backsync::poll_interval();
            tokio::time::sleep(if front { every } else { every * 3 }).await;
        }
    });
}

/// The Convex deployment a place's account syncs with: its Folevi Server's ("Your own server"), else the one this
/// interface was built for (shell/build.json).
fn convex_url_of(app: &AppHandle, place: &str) -> Option<String> {
    if let Some(sv) = services(app).server_of(Some(place)) {
        return Some(sv.active_urls().convex);
    }
    let (bytes, _) = asset(app, "shell/build.json")?;
    let v: Value = serde_json::from_slice(&bytes).ok()?;
    v.get("convexUrl").and_then(Value::as_str).filter(|u| u.starts_with("https://") || u.starts_with("http://")).map(|u| u.trim_end_matches('/').to_string())
}

async fn poll_unread(app: &AppHandle) {
    let s = services(app).inner().clone();
    let accounts: Vec<String> = s.backsync.lock().wanted().iter().filter(|p| user_id_of(Some(p)).is_some()).cloned().collect();
    let client = reqwest::Client::builder().timeout(std::time::Duration::from_secs(20)).build().unwrap_or_default();
    for place in accounts {
        let Some(convex) = convex_url_of(app, &place) else { continue };
        let now_s = now_ms() / 1000;
        let cached = s.poll_tokens.lock().get(&place).filter(|(_, until)| *until > now_s).map(|(t, _)| t.clone());
        let token = match cached {
            Some(t) => t,
            None => {
                let site = s.site_of(Some(&place));
                let Ok(Some(t)) = s.auth.convex_token(user_id_of(Some(&place)).as_deref(), site.as_ref()).await else { continue };
                s.poll_tokens.lock().insert(place.clone(), (t.clone(), backsync::token_good_until(&t, now_s)));
                t
            }
        };
        let body = json!({ "path": "notifications:unreadCount", "args": {}, "format": "json" });
        let Ok(res) = client.post(format!("{convex}/api/query")).bearer_auth(&token).json(&body).send().await else { continue };
        if matches!(res.status().as_u16(), 401 | 403) {
            s.poll_tokens.lock().remove(&place);
            continue;
        }
        let Ok(v) = res.json::<Value>().await else { continue };
        let Some(count) = v.get("value").and_then(Value::as_u64) else { continue };
        s.places.lock().describe(&place, &json!({ "unread": count }));
        let new = s.backsync.lock().unread_now(&place, count);
        signal_places_changed(app);
        if new {
            wake_runner(app, &place, "notification", None);
        }
    }
}

/// ServerReach (ShellServer.swift): each server account uses the first of its server's names that answers, home
/// names first, checked soon after launch and every two minutes (a laptop that left home moves to the public name).
/// The session belongs to the server, so a move never signs anyone out; the place's windows load again where they
/// were, with the new addresses and policy.
fn watch_server_names(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(5)).await;
        loop {
            let accounts = services(&app).places.lock().server_accounts();
            for (id, sv) in accounts.into_iter().filter(|(_, sv)| sv.candidates().len() > 1) {
                let Some(best) = server::best_origin(&sv).await else { continue };
                if best == sv.active_origin() {
                    continue;
                }
                let moved = services(&app).places.lock().set_active_origin(&id, (best != sv.origin).then_some(best));
                if moved {
                    later(&app, move |app| server_moved(app, &id));
                }
            }
            tokio::time::sleep(std::time::Duration::from_secs(120)).await;
        }
    });
}

/// A server place now uses another of its names: its windows load again where they were.
fn server_moved(app: &AppHandle, place: &str) {
    let s = services(app);
    for (label, w) in app.webview_windows() {
        if s.place_of(&label).as_deref() == Some(place) {
            if let Ok(url) = w.url() {
                let _ = w.navigate(url);
            }
        }
    }
    signal_places_changed(app);
}

fn signal_places_changed(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let list = places_list(&app).await;
        emit_to_pages(&app, "FoleviShell:placesChanged", &json!({ "places": list }), None);
        update_badge(&app);
        // A place added, signed out or opened: background sync follows.
        let a = app.clone();
        let _ = app.run_on_main_thread(move || ensure_runners(&a));
    });
}

async fn places_list(app: &AppHandle) -> Value {
    let s = services(app).inner().clone();
    let info = s.library.info().await;
    let list = s.places.lock().list(&info);
    list
}

// ---------------------------------------------------------------- Quick Add

fn quick_add_place(s: &Services) -> Option<String> {
    let p = s.places.lock();
    p.quick_add().filter(|q| p.has(q)).or_else(|| p.current())
}

fn create_quick_add(app: &AppHandle, show: bool) -> tauri::Result<WebviewWindow> {
    let s = services(app);
    let place = quick_add_place(&s);
    s.bound.lock().insert("quickadd".into(), place.clone());
    let path = match &place {
        Some(p) => format!("/quick-add?place={}", percent_encoding::utf8_percent_encode(p, percent_encoding::NON_ALPHANUMERIC)),
        None => "/quick-add".into(),
    };
    let dark = s.ui.lock().dark.unwrap_or(false);
    let script = boot_script(app, "quickadd");
    let mut b = WebviewWindowBuilder::new(app, "quickadd", WebviewUrl::CustomProtocol(app_url(&path)))
        .title("Quick Add")
        .inner_size(520.0, 320.0)
        .resizable(false)
        .minimizable(false)
        .maximizable(false)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .shadow(true)
        .visible(false)
        .background_color(background(dark))
        .initialization_script(&script);
    #[cfg(windows)]
    {
        b = b.use_https_scheme(true);
    }
    let w = b.build()?;
    let win = w.clone();
    w.on_window_event(move |e| {
        if let WindowEvent::Focused(false) = e {
            let _ = win.hide();
        }
    });
    if show {
        let _ = w.show();
    }
    Ok(w)
}

/// Quick Add loads again in its place (the one picked there, or the open place).
fn recreate_quick_add(app: &AppHandle) {
    let s = services(app);
    let place = quick_add_place(&s);
    s.bound.lock().insert("quickadd".into(), place.clone());
    let path = match &place {
        Some(p) => format!("/quick-add?place={}", percent_encoding::utf8_percent_encode(p, percent_encoding::NON_ALPHANUMERIC)),
        None => "/quick-add".into(),
    };
    match app.get_webview_window("quickadd") {
        Some(w) => {
            let _ = w.navigate(app_url(&path));
        }
        None => {
            let _ = create_quick_add(app, false);
        }
    }
}

fn toggle_quick_add(app: &AppHandle) {
    let w = match app.get_webview_window("quickadd") {
        Some(w) => w,
        None => match create_quick_add(app, false) {
            Ok(w) => w,
            Err(_) => return,
        },
    };
    if w.is_visible().unwrap_or(false) && w.is_focused().unwrap_or(false) {
        let _ = w.hide();
        return;
    }
    // On the screen the pointer is on, a little above the middle.
    if let Ok(Some(m)) = app.cursor_position().and_then(|p| app.monitor_from_point(p.x, p.y)).or_else(|_| w.current_monitor()) {
        let (pos, size) = (m.position(), m.size());
        let wsize = w.outer_size().unwrap_or(tauri::PhysicalSize::new(520, 320));
        let x = pos.x + (size.width as i32 - wsize.width as i32) / 2;
        let y = pos.y + (size.height as f64 * 0.28) as i32;
        let _ = w.set_position(tauri::PhysicalPosition::new(x, y));
    }
    let _ = w.show();
    let _ = w.set_focus();
    emit_to_pages(app, "desktop:command", &json!({ "type": "quick-add-shown" }), Some("quickadd"));
}

fn register_shortcut(app: &AppHandle) -> Option<String> {
    let s = services(app);
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    let accel = s.settings.lock().quick_add_shortcut.clone();
    // Wayland doesn't let apps grab keys (the plugin "registers" but never fires): ask the desktop's portal.
    #[cfg(target_os = "linux")]
    if linux::is_wayland() {
        let press_app = app.clone();
        let done_app = app.clone();
        linux::bind_quick_add(
            app,
            &accel,
            Arc::new(move || {
                let a = press_app.clone();
                let _ = press_app.run_on_main_thread(move || toggle_quick_add(&a));
            }),
            Arc::new(move |error| {
                services(&done_app).ui.lock().shortcut_error = error;
            }),
        );
        return None;
    }
    if accel.is_empty() {
        return None;
    }
    match gs.register(accel.as_str()) {
        Ok(()) => None,
        Err(_) => Some("Another app is already using this shortcut. Choose a different one.".into()),
    }
}

// ---------------------------------------------------------------- the notification area icon and the badge

fn update_tray(app: &AppHandle) {
    let s = services(app);
    let on = s.settings.lock().menu_bar_icon;
    let mut ui = s.ui.lock();
    if !on {
        if let Some(t) = ui.tray.take() {
            let _ = app.remove_tray_by_id(t.id());
        }
        return;
    }
    let recent = ui.recent.clone();
    let status = ui.status.clone();
    let shortcut = s.settings.lock().quick_add_shortcut.clone();
    let menu = (|| -> tauri::Result<Menu<tauri::Wry>> {
        let m = Menu::new(app)?;
        m.append(&MenuItem::with_id(app, "quick-add", "Quick Add Task", true, (!shortcut.is_empty()).then_some(shortcut.as_str()))?)?;
        m.append(&MenuItem::with_id(app, "new-note", "New Note", true, None::<&str>)?)?;
        m.append(&PredefinedMenuItem::separator(app)?)?;
        if !recent.is_empty() {
            m.append(&MenuItem::with_id(app, "recent-label", "Recent notes", false, None::<&str>)?)?;
            for (id, title) in recent.iter().take(8) {
                let t = if title.is_empty() { "Untitled".to_string() } else { title.replace('&', "&&") };
                m.append(&MenuItem::with_id(app, format!("note:{id}"), t, true, None::<&str>)?)?;
            }
            m.append(&PredefinedMenuItem::separator(app)?)?;
        }
        if !status.is_empty() {
            m.append(&MenuItem::with_id(app, "status", status.as_str(), false, None::<&str>)?)?;
            m.append(&PredefinedMenuItem::separator(app)?)?;
        }
        m.append(&MenuItem::with_id(app, "open", "Open Folevi", true, None::<&str>)?)?;
        m.append(&MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?)?;
        if updates::supported() {
            m.append(&MenuItem::with_id(app, "check-updates", "Check for Updates…", true, None::<&str>)?)?;
        }
        m.append(&PredefinedMenuItem::separator(app)?)?;
        m.append(&MenuItem::with_id(app, "quit", "Quit Folevi", true, None::<&str>)?)?;
        Ok(m)
    })();
    let Ok(menu) = menu else { return };
    if let Some(t) = &ui.tray {
        let _ = t.set_menu(Some(menu));
        return;
    }
    let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/tray.png")).ok();
    let mut b = TrayIconBuilder::with_id("folevi").tooltip("Folevi").menu(&menu).show_menu_on_left_click(false);
    if let Some(i) = icon {
        b = b.icon(i);
    }
    // On Linux the tray needs libayatana-appindicator, which some desktops (and the Flatpak runtime) lack; Tauri
    // panics when it can't load it, so a missing tray is caught here and Folevi goes on without one.
    let build = std::panic::AssertUnwindSafe(move || b
        .on_menu_event(|app, event| {
            let id = event.id().as_ref().to_string();
            match id.as_str() {
                "quick-add" => toggle_quick_add(app),
                "new-note" => command_main(app, json!({ "type": "new-note" })),
                "open" => show_main(app, None),
                "settings" => show_main(app, Some("/settings/desktop")),
                "check-updates" => updates::check_by_hand(app),
                "quit" => quit(app),
                _ => {
                    if let Some(note) = id.strip_prefix("note:") {
                        show_main(app, Some(&format!("/d/{note}")));
                    }
                }
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                show_main(tray.app_handle(), None);
            }
        })
        .build(app));
    match std::panic::catch_unwind(build) {
        Ok(Ok(t)) => ui.tray = Some(t),
        Ok(Err(e)) => log::warn!("Folevi: no tray icon: {e}"),
        Err(_) => log::warn!("Folevi: no tray icon on this desktop"),
    }
}

fn update_badge(app: &AppHandle) {
    let s = services(app);
    let others = {
        let p = s.places.lock();
        p.unread_except(p.current().as_deref())
    };
    let n = s.ui.lock().badge + others;
    if let Some(t) = &s.ui.lock().tray {
        let _ = t.set_tooltip(Some(if n > 0 { format!("Folevi ({})", badge::badge_description(n)) } else { "Folevi".into() }));
    }
    let Some(w) = app.get_webview_window("main") else { return };
    #[cfg(windows)]
    {
        let icon = badge::badge_rgba(n).map(|(wd, ht, px)| tauri::image::Image::new_owned(px, wd, ht));
        let _ = w.set_overlay_icon(icon);
    }
    #[cfg(not(windows))]
    {
        let _ = w.set_badge_count(if n == 0 { None } else { Some(n as i64) });
    }
}

fn quit(app: &AppHandle) {
    prepare_to_quit(app);
    app.exit(0);
}

/// Saves reminders and closes the library before Folevi quits or an update replaces it.
pub(crate) fn prepare_to_quit(app: &AppHandle) {
    services(app).ui.lock().quitting = true;
    services(app).reminders.save_now();
    services(app).library.dispose();
}

fn apply_login_item(app: &AppHandle) {
    let s = services(app);
    if s.paths.test_run || cfg!(debug_assertions) {
        return;
    }
    use tauri_plugin_autostart::ManagerExt;
    let on = s.settings.lock().open_at_login;
    let a = app.autolaunch();
    let _ = if on { a.enable() } else { a.disable() };
}

// ---------------------------------------------------------------- folevi:// links

fn open_link(app: &AppHandle, raw: &str) {
    let s = services(app);
    if auth::Auth::is_callback(raw) {
        s.auth.handle_callback(raw);
        show_main(app, None);
        return;
    }
    let Ok(url) = tauri::Url::parse(raw) else { return show_main(app, None) };
    match deep_link_path(&url).as_deref() {
        Some("new") => command_main(app, json!({ "type": "new-note" })),
        Some("quick-add") => toggle_quick_add(app),
        Some(path) => show_main(app, Some(path)),
        None => show_main(app, None),
    }
}

// ---------------------------------------------------------------- the page's calls

/// Every foleviShell call (shell-bridge.js's `call("FoleviShell", method, options)`), with the Mac's method names.
#[tauri::command]
async fn shell_call(app: AppHandle, webview: tauri::Webview, plugin: String, method: String, options: Value) -> Result<Value, ShellError> {
    if !is_app_url(webview.url().map(|u| u.to_string()).unwrap_or_default().as_str()) {
        return Err(ShellError::new("forbidden", "Only Folevi's own pages may call this."));
    }
    if plugin != "FoleviShell" {
        return Err(ShellError::unavailable(format!("{plugin} isn't in Folevi for this computer.")));
    }
    let s = services(&app).inner().clone();
    let label = webview.label().to_string();
    let place = s.place_of(&label);
    route_call(&app, &s, &label, place, &method, &options).await
}

async fn route_call(app: &AppHandle, s: &Arc<Services>, label: &str, place: Option<String>, method: &str, o: &Value) -> ShellResult {
    let slot = user_id_of(place.as_deref());
    let local = s.mode_of(place.as_deref()) == "local";
    match method {
        "setMode" => set_mode(app, s, place, req_str(o, "mode")?),
        m if m.starts_with("places") => places_call(app, s, label, place, m, o).await,
        m if m.starts_with("lib") || m.starts_with("journal") || m.starts_with("cloud") || m.starts_with("mirror") => s.library.call(m, o).await,
        "secretsHas" => Ok(value(secrets::is_page_secret(req_str(o, "name")?) && s.secrets.has(req_str(o, "name")?))),
        "secretsSet" => {
            let name = req_str(o, "name")?;
            if !secrets::is_page_secret(name) {
                return Err(ShellError::invalid("That isn't a key Folevi keeps for the page."));
            }
            s.secrets.set(name, opt_str(o, "value").unwrap_or(""))?;
            Ok(value(true))
        }
        "secretsDelete" => {
            let name = req_str(o, "name")?;
            if secrets::is_page_secret(name) {
                s.secrets.delete(name)?;
            }
            Ok(value(true))
        }
        "authSignIn" => {
            let provider = opt_str(o, "provider").filter(|p| *p == "google" || *p == "apple");
            let server = s.server_of(place.as_deref());
            let user = s.auth.sign_in_account(provider, server.as_ref().and_then(|sv| sv.app_url()).as_ref()).await?;
            let Some(u) = user else { return Ok(value(false)) };
            let id = add_account(app, s, &u, server.as_ref());
            if place.as_deref() != Some(LIBRARY) && id.as_deref() != place.as_deref() {
                let app2 = app.clone();
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
                    switch_to(&app2, id, "/documents", false);
                });
            }
            Ok(value(true))
        }
        "authSignOut" => {
            match place.as_deref() {
                Some(p) if user_id_of(Some(p)).is_some() => sign_out_place(app, s, p.to_string(), None).await,
                _ => s.auth.sign_out(None, None).await,
            }
            Ok(Value::Null)
        }
        "authFetch" => s.auth.fetch(o, slot.as_deref(), s.site_of(place.as_deref()).as_ref()).await,
        "authConvexToken" => Ok(value(s.auth.convex_token(slot.as_deref(), s.site_of(place.as_deref()).as_ref()).await?)),
        m if m.starts_with("ai") => s.ai.call(m, o, emitter(app)).await,
        "lockGet" => Ok(s.lock.settings()),
        "lockSet" => lock_set(app, s, label, o).await,
        "notifySchedule" => Ok(value(local && s.reminders.schedule(o))),
        "notifyCancel" => {
            if local {
                s.reminders.cancel(req_str(o, "id")?);
            }
            Ok(Value::Null)
        }
        "filesSave" => files_save(app, o).await,
        "httpCalendar" if local => http::calendar(o, s.service_url.host_str().unwrap_or("")).await,
        "httpCalendar" => Ok(json!({ "kind": "error", "message": "Couldn't load this calendar: the address couldn't be reached." })),
        "httpPreview" => http::preview(o, s.service_url.host_str().unwrap_or("")).await,
        m if m.starts_with("e2ee") => {
            let keys = s.keys_for(place.as_deref());
            let (m, o) = (m.to_string(), o.clone());
            let hello = HelloAsk::for_window(app, label);
            tauri::async_runtime::spawn_blocking(move || keys.call_asking(&m, &o, &hello)).await.map_err(|e| ShellError::io(e.to_string()))?
        }
        _ => Err(ShellError::unavailable(format!("{method} isn't in Folevi for this computer."))),
    }
}

fn set_mode(app: &AppHandle, s: &Arc<Services>, place: Option<String>, mode: &str) -> ShellResult {
    match mode {
        "local" => {
            if place.as_deref() == Some(LIBRARY) && s.settings.lock().mode == "local" {
                return Ok(Value::Null);
            }
            s.places.lock().set_library(true);
            later(app, move |app| switch_to(app, Some(LIBRARY.into()), "/documents", false));
            Ok(Value::Null)
        }
        "account" => {
            let target = {
                let p = s.places.lock();
                p.account_ids().last().cloned()
            };
            if target.is_some() && target == place {
                return Ok(Value::Null);
            }
            later(app, move |app| switch_to(app, target.clone(), "/documents", target.is_none()));
            Ok(Value::Null)
        }
        _ => Err(ShellError::invalid("The mode is \"local\" or \"account\".")),
    }
}

/// Runs `f` shortly after the page has its answer (a switch reloads the page that asked).
fn later(app: &AppHandle, f: impl FnOnce(&AppHandle) + Send + 'static) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        let app2 = app.clone();
        let _ = app.run_on_main_thread(move || f(&app2));
    });
}

fn add_account(app: &AppHandle, s: &Arc<Services>, u: &auth::SessionUser, server: Option<&server::ShellServer>) -> Option<String> {
    let id = {
        let mut p = s.places.lock();
        let first = p.account_ids().is_empty();
        let id = p.add_account(u, server);
        if first && id.is_some() {
            adopt_legacy_keys(s, &u.user_id);
        }
        id
    };
    signal_places_changed(app);
    id
}

/// The PC's first pair of encryption keys becomes the first account's (as on the Mac).
fn adopt_legacy_keys(s: &Services, user_id: &str) {
    let legacy = s.paths.user_data.join("e2ee");
    let target = legacy.join("accounts").join(user_id);
    if target.exists() || !legacy.join("device.bin").exists() {
        return;
    }
    if std::fs::create_dir_all(&target).is_ok() {
        for f in ["device.bin", "device.json", "prefs.json"] {
            let _ = std::fs::rename(legacy.join(f), target.join(f));
        }
    }
    s.keys.lock().remove("");
}

async fn sign_out_place(app: &AppHandle, s: &Arc<Services>, id: String, next: Option<String>) {
    let Some(user) = user_id_of(Some(&id)) else { return };
    s.auth.sign_out(Some(&user), s.site_of(Some(&id)).as_ref()).await;
    if let Some(k) = s.keys.lock().remove(&user) {
        k.reset();
    }
    let _ = std::fs::remove_dir_all(s.paths.user_data.join("e2ee").join("accounts").join(&user));
    let (was_open, fallback) = {
        let mut p = s.places.lock();
        let was_open = p.current().as_deref() == Some(id.as_str());
        let fallback = p.remove_account(&id);
        if next.as_deref() == Some(LIBRARY) && !p.has_library() {
            p.set_library(true);
        }
        (was_open, fallback)
    };
    signal_places_changed(app);
    if was_open {
        let target = next.filter(|n| s.places.lock().has(n)).or(fallback);
        later(app, move |app| switch_to(app, target, "/documents", false));
    }
}

async fn places_call(app: &AppHandle, s: &Arc<Services>, label: &str, place: Option<String>, method: &str, o: &Value) -> ShellResult {
    match method {
        "placesList" => Ok(json!({ "places": places_list(app).await })),
        "placesSwitch" => {
            let id = req_str(o, "id")?.to_string();
            if !s.places.lock().has(&id) {
                return Ok(value(false));
            }
            let path = opt_str(o, "path").filter(|p| p.starts_with('/') && !p.starts_with("//") && p.len() <= 500).unwrap_or("/documents").to_string();
            later(app, move |app| switch_to(app, Some(id), &path, false));
            Ok(value(true))
        }
        "placesSignIn" => {
            let provider = opt_str(o, "provider").filter(|p| *p == "google" || *p == "apple");
            // Another account on the same service as the page asking (a server's switcher signs in to that server).
            let server = s.server_of(place.as_deref());
            let user = s.auth.sign_in_account(provider, server.as_ref().and_then(|sv| sv.app_url()).as_ref()).await?;
            Ok(value(user.and_then(|u| add_account(app, s, &u, server.as_ref()))))
        }
        "placesDescribe" => {
            {
                let mut p = s.places.lock();
                match place.as_deref() {
                    Some(LIBRARY) => p.describe_library(o),
                    Some(pl) if user_id_of(Some(pl)).is_some() => p.describe(pl, o),
                    _ => {}
                }
            }
            if is_runner(label) {
                if let (Some(pl), Some(w)) = (place.as_deref(), o.get("waiting").and_then(Value::as_u64)) {
                    s.backsync.lock().reported(pl, w);
                }
            }
            if label == "main" || is_runner(label) {
                signal_places_changed(app);
                update_badge(app);
            }
            Ok(Value::Null)
        }
        "placesSignOut" => {
            let id = req_str(o, "id")?.to_string();
            if user_id_of(Some(&id)).is_none() {
                return Ok(value(false));
            }
            sign_out_place(app, s, id, opt_str(o, "next").map(str::to_string)).await;
            Ok(value(true))
        }
        "placesForgetLibrary" => {
            s.library.forget().await?;
            s.reminders.clear();
            let (was_open, next) = {
                let mut p = s.places.lock();
                let was_open = p.current().as_deref() == Some(LIBRARY);
                p.set_library(false);
                (was_open, p.account_ids().first().cloned())
            };
            signal_places_changed(app);
            if was_open {
                later(app, move |app| switch_to(app, next, "/documents", false));
            }
            Ok(value(true))
        }
        "placesAddServer" => {
            // "Your own server": the address and the server's folevi.json are checked here (never the page's copy),
            // then every window opens that server's sign-in screen.
            let found = server::look_up(opt_str(o, "origin").unwrap_or(""), FOLEVI_VERSION).await.map_err(|p| ShellError::new(p.code(), p.message()))?;
            let answer = found.json();
            later(app, move |app| switch_to_server(app, found));
            Ok(value(answer))
        }
        "placesLocalServers" => Ok(json!({ "servers": server::local_servers(std::time::Duration::from_secs(2)).await })),
        "placesConvexToken" => {
            let id = req_str(o, "id")?;
            if user_id_of(place.as_deref()).is_none() || !s.places.lock().has(id) {
                return Ok(value(Value::Null));
            }
            Ok(value(s.auth.convex_token(user_id_of(Some(id)).as_deref(), s.site_of(Some(id)).as_ref()).await.ok().flatten()))
        }
        "placesQuickAdd" => Ok(value(quick_add_place(s))),
        "placesSetQuickAdd" => {
            let id = req_str(o, "id")?.to_string();
            if !s.places.lock().has(&id) {
                return Ok(value(false));
            }
            s.places.lock().set_quick_add(Some(id));
            later(app, recreate_quick_add);
            Ok(value(true))
        }
        _ => Err(ShellError::unavailable(format!("{method} isn't in Folevi for this computer."))),
    }
}

async fn files_save(app: &AppHandle, o: &Value) -> ShellResult {
    let name: String = req_str(o, "name")?.chars().filter(|c| !"\\/:*?\"<>|".contains(*c) && !c.is_control()).take(150).collect();
    let bytes = shell::req_bytes(o, "bytes")?;
    if bytes.len() > 600 * 1024 * 1024 {
        return Err(ShellError::invalid("That file is too big to save."));
    }
    let app = app.clone();
    let downloads = app.path().download_dir().ok();
    let picked = tauri::async_runtime::spawn_blocking(move || {
        let mut d = app.dialog().file().set_file_name(if name.is_empty() { "Folevi export".into() } else { name });
        if let Some(dir) = downloads {
            d = d.set_directory(dir);
        }
        d.blocking_save_file()
    })
    .await
    .map_err(|e| ShellError::io(e.to_string()))?;
    let Some(path) = picked.and_then(|p| p.into_path().ok()) else { return Ok(value(false)) };
    shell::write_atomic(&path, &bytes)?;
    Ok(value(true))
}

/// What only the desktop app does (window.foleviDesktop, host.js): the badge, notifications, the tray's menu,
/// settings, Quick Add, printing and the window's commands.
#[tauri::command]
async fn desktop_call(app: AppHandle, webview: tauri::Webview, name: String, args: Value) -> Result<Value, ShellError> {
    if !is_app_url(webview.url().map(|u| u.to_string()).unwrap_or_default().as_str()) {
        return Err(ShellError::new("forbidden", "Only Folevi's own pages may call this."));
    }
    let s = services(&app).inner().clone();
    let label = webview.label().to_string();
    let window = app.get_webview_window(&label);
    let text = |k: &str, max: usize| opt_str(&args, k).unwrap_or("").chars().take(max).collect::<String>();
    match name.as_str() {
        "probe" => {
            if cfg!(debug_assertions) {
                println!("PROBE {label} {args}");
            }
            Ok(Value::Null)
        }
        "lockUnlock" => lock_unlock(&app, &s, &label, opt_str(&args, "passphrase")).await,
        "lockAnswer" => {
            let id = text("id", 40);
            if let Some(tx) = LOCK_PROMPTS.lock().remove(&id) {
                let _ = tx.send(opt_str(&args, "passphrase").map(|p| p.chars().take(1000).collect()));
            }
            Ok(Value::Null)
        }
        "ready" => {
            // FOLEVI_REPORT_READY (any build): the page and its bridge started, said on stdout, so a measurement
            // (scripts/measure.mjs) can tell a loaded page from a blank window.
            if std::env::var_os("FOLEVI_REPORT_READY").is_some() {
                println!("FOLEVI READY {label} {}", webview.url().map(|u| u.to_string()).unwrap_or_default());
            }
            update_badge(&app);
            Ok(Value::Null)
        }
        "badge" => {
            if label == "main" {
                s.ui.lock().badge = opt_f64(&args, "count").map(|n| n.max(0.0) as u64).unwrap_or(0);
                update_badge(&app);
            }
            Ok(Value::Null)
        }
        "notify" => {
            if !s.settings.lock().notifications {
                return Ok(Value::Null);
            }
            let title = text("title", 200);
            if title.is_empty() {
                return Ok(Value::Null);
            }
            let path = text("path", 500);
            let place = s.place_of(&label);
            let app2 = app.clone();
            notify::show(
                APP_ID,
                &title,
                &text("body", 400),
                Arc::new(move || {
                    let app3 = app2.clone();
                    let (path, place) = (path.clone(), place.clone());
                    let _ = app2.run_on_main_thread(move || {
                        let current = services(&app3).places.lock().current();
                        if place.is_some() && place != current && place.as_ref().is_some_and(|p| services(&app3).places.lock().has(p)) {
                            switch_to(&app3, place, if path.starts_with('/') { &path } else { "/documents" }, false);
                            show_main(&app3, None);
                        } else {
                            show_main(&app3, (!path.is_empty()).then_some(path.as_str()));
                        }
                    });
                }),
            );
            Ok(Value::Null)
        }
        "recent" => {
            let list: Vec<(String, String)> = args
                .get("notes")
                .and_then(Value::as_array)
                .map(|a| {
                    a.iter()
                        .take(8)
                        .filter_map(|n| {
                            let id = n.get("id")?.as_str()?;
                            (id.len() == 26 && id.chars().all(|c| c.is_ascii_digit() || c.is_ascii_uppercase())).then(|| (id.to_string(), n.get("title").and_then(Value::as_str).unwrap_or("").chars().take(80).collect()))
                        })
                        .collect()
                })
                .unwrap_or_default();
            if label == "main" {
                s.ui.lock().recent = list;
                update_tray(&app);
            }
            Ok(Value::Null)
        }
        "status" => {
            let next = text("text", 80);
            if label == "main" && s.ui.lock().status != next {
                s.ui.lock().status = next;
                update_tray(&app);
            }
            Ok(Value::Null)
        }
        "getSettings" => Ok(json!({ "settings": s.settings.lock().page(), "error": s.ui.lock().shortcut_error })),
        "setSettings" => {
            let patch = args.get("patch").cloned().unwrap_or(Value::Null);
            let previous = s.settings.lock().clone();
            let next = previous.merged(&patch, false);
            *s.settings.lock() = next.clone();
            if next.quick_add_shortcut != previous.quick_add_shortcut {
                let error = register_shortcut(&app);
                if error.is_some() {
                    s.settings.lock().quick_add_shortcut = previous.quick_add_shortcut.clone();
                    register_shortcut(&app);
                }
                s.ui.lock().shortcut_error = error;
            }
            if next.open_at_login != previous.open_at_login {
                apply_login_item(&app);
            }
            s.settings.lock().save(&s.settings_file());
            update_tray(&app);
            Ok(json!({ "settings": s.settings.lock().page(), "error": s.ui.lock().shortcut_error }))
        }
        "pauseShortcut" => {
            if opt_bool(&args, "paused") == Some(true) {
                let _ = app.global_shortcut().unregister_all();
            } else {
                let e = register_shortcut(&app);
                s.ui.lock().shortcut_error = e;
            }
            Ok(Value::Null)
        }
        "quickAddClose" => {
            if let Some(q) = app.get_webview_window("quickadd") {
                let _ = q.hide();
            }
            Ok(Value::Null)
        }
        "quickAddSize" => {
            if let (Some(q), Some(h)) = (app.get_webview_window("quickadd"), opt_f64(&args, "height")) {
                let _ = q.set_size(tauri::LogicalSize::new(520.0, h.clamp(56.0, 640.0).round()));
            }
            Ok(Value::Null)
        }
        "open" => {
            if let Some(q) = app.get_webview_window("quickadd") {
                let _ = q.hide();
            }
            let p = text("path", 500);
            show_main(&app, (p.starts_with('/') && !p.starts_with("//")).then_some(p.as_str()));
            Ok(Value::Null)
        }
        "print" => {
            let _ = webview.print();
            Ok(Value::Null)
        }
        "closeWindow" => {
            if let Some(w) = window {
                let _ = w.close();
            }
            Ok(Value::Null)
        }
        "minimize" => {
            if let Some(w) = window {
                let _ = w.minimize();
            }
            Ok(Value::Null)
        }
        "toggleMaximize" => {
            if let Some(w) = window {
                let _ = if w.is_maximized().unwrap_or(false) { w.unmaximize() } else { w.maximize() };
            }
            Ok(Value::Null)
        }
        "drag" => {
            if let Some(w) = window {
                let _ = w.start_dragging();
            }
            Ok(Value::Null)
        }
        "fullscreen" => {
            if let Some(w) = window {
                let _ = w.set_fullscreen(!w.is_fullscreen().unwrap_or(false));
            }
            Ok(Value::Null)
        }
        "zoom" => {
            let by = opt_f64(&args, "by").unwrap_or(0.0);
            let mut ui_zoom = ZOOM.lock();
            let z = ui_zoom.entry(label.clone()).or_insert(1.0);
            *z = if by == 0.0 { 1.0 } else { (*z + by * 0.1).clamp(0.5, 2.0) };
            let _ = webview.set_zoom(*z);
            Ok(Value::Null)
        }
        "devtools" => {
            #[cfg(debug_assertions)]
            webview.open_devtools();
            Ok(Value::Null)
        }
        "newWindow" => {
            let app2 = app.clone();
            let _ = app.run_on_main_thread(move || {
                let _ = create_main(&app2, "/documents", None, true);
            });
            Ok(Value::Null)
        }
        "settings" => {
            show_main(&app, Some("/settings/desktop"));
            Ok(Value::Null)
        }
        "theme" => {
            let dark = opt_bool(&args, "dark").unwrap_or(false);
            if label == "quickadd" {
                return Ok(Value::Null);
            }
            s.ui.lock().dark = Some(dark);
            for (_, w) in app.webview_windows() {
                let _ = w.set_background_color(Some(background(dark)));
            }
            Ok(Value::Null)
        }
        _ => Err(ShellError::unavailable(format!("{name} isn't in Folevi for this computer."))),
    }
}

static ZOOM: once_cell::sync::Lazy<Mutex<HashMap<String, f64>>> = once_cell::sync::Lazy::new(|| Mutex::new(HashMap::new()));

// ---------------------------------------------------------------- app:// (protocol.rs)

async fn serve(app: &AppHandle, label: &str, request: &tauri::http::Request<Vec<u8>>) -> tauri::http::Response<Vec<u8>> {
    use tauri::http::{header, Response, StatusCode};
    let text = |status: StatusCode, body: &str| Response::builder().status(status).header(header::CONTENT_TYPE, "text/plain; charset=utf-8").body(body.as_bytes().to_vec()).unwrap();
    if request.method() != "GET" && request.method() != "HEAD" {
        return text(StatusCode::METHOD_NOT_ALLOWED, "Method not allowed");
    }
    let s = services(app).inner().clone();
    let uri = request.uri();
    let range = request.headers().get(header::RANGE).and_then(|v| v.to_str().ok());
    if cfg!(debug_assertions) && std::env::var_os("FOLEVI_PROBE").is_some() {
        println!("SERVE {label} {} {}", request.method(), uri);
    }
    // FOLEVI_PROBE (development builds): the page's report, by plain fetch so it works even when IPC doesn't.
    if cfg!(debug_assertions) && uri.path() == "/_probe" {
        println!("PROBE-FETCH {label} {}", percent_encoding::percent_decode_str(uri.query().unwrap_or("")).decode_utf8_lossy());
        return text(StatusCode::NO_CONTENT, "");
    }
    match protocol::route(uri.path()) {
        protocol::Route::BadPath => text(StatusCode::BAD_REQUEST, "Bad path"),
        protocol::Route::NotFound => text(StatusCode::NOT_FOUND, "Not found"),
        protocol::Route::File(sha) => {
            let Ok(Some((bytes, mime))) = s.library.attachment(&sha).await else { return text(StatusCode::NOT_FOUND, "Not found") };
            let asked = uri.query().and_then(|q| url::form_urlencoded::parse(q.as_bytes()).find(|(k, _)| k == "type").map(|(_, v)| v.into_owned()));
            let ctype = protocol::safe_file_type(mime.as_deref(), asked.as_deref());
            let size = bytes.len() as u64;
            let base = |b: tauri::http::response::Builder| {
                b.header(header::CONTENT_TYPE, &ctype)
                    .header("content-security-policy", protocol::FILES_CSP)
                    .header("x-content-type-options", "nosniff")
                    .header("accept-ranges", "bytes")
                    .header("cache-control", "private, max-age=31536000, immutable")
            };
            match protocol::parse_range(range, size) {
                Some(Err(())) => base(Response::builder().status(StatusCode::RANGE_NOT_SATISFIABLE)).header("content-range", format!("bytes */{size}")).body(vec![]).unwrap(),
                Some(Ok((a, b))) => base(Response::builder().status(StatusCode::PARTIAL_CONTENT)).header("content-range", format!("bytes {a}-{b}/{size}")).body(bytes[a as usize..=b as usize].to_vec()).unwrap(),
                None => base(Response::builder()).body(bytes).unwrap(),
            }
        }
        protocol::Route::Asset(path) => {
            // File reads go to a blocking thread, so a slow disk never holds up the async runtime's workers.
            let (app2, path2) = (app.clone(), path.clone());
            let found = tauri::async_runtime::spawn_blocking(move || {
                asset(&app2, &path2).or_else(|| (protocol::spa_fallback(&path2)).then(|| asset(&app2, "index.html")).flatten())
            })
            .await
            .ok()
            .flatten();
            let Some((bytes, served)) = found else {
                return if protocol::spa_fallback(&path) { text(StatusCode::SERVICE_UNAVAILABLE, "The interface built into Folevi is missing. Reinstall Folevi.") } else { text(StatusCode::NOT_FOUND, "Not found") };
            };
            let ctype = protocol::content_type(&served);
            let mut b = Response::builder().header(header::CONTENT_TYPE, ctype.as_ref()).header("x-content-type-options", "nosniff");
            let body = if ctype.starts_with("text/html") {
                let place = s.place_of(label);
                let mode = s.mode_of(place.as_deref());
                let sources = s.server_of(place.as_deref()).map(|sv| server::connect_sources(&sv));
                let sign_in = place.is_none() && mode == "account";
                let csp = protocol::shell_csp(mode, &s.service_url.origin().ascii_serialization(), &s.extra_connect, sources.as_deref(), sign_in);
                b = b.header("content-security-policy", csp).header("cache-control", "no-store");
                let boot = page_boot(&s, label, uri.path());
                protocol::insert_boot(&protocol::allow_ipc_in_meta(&String::from_utf8_lossy(&bytes)), &boot.to_string()).into_bytes()
            } else {
                if served.starts_with("_next/static/") {
                    b = b.header("cache-control", "public, max-age=31536000, immutable");
                }
                bytes
            };
            b.body(body).unwrap()
        }
    }
}

/// A file of the export: compiled into the app (release builds), or from FOLEVI_SHELL_DIR / ../web (development).
fn asset(app: &AppHandle, path: &str) -> Option<(Vec<u8>, String)> {
    let candidates = [path.to_string(), format!("{path}.html"), format!("{path}/index.html")];
    // The folder's real path is looked up once; each request still checks its own file's real path against it.
    static SHELL_DIR: std::sync::OnceLock<Option<Option<PathBuf>>> = std::sync::OnceLock::new();
    if let Some(dir) = SHELL_DIR.get_or_init(|| std::env::var("FOLEVI_SHELL_DIR").ok().map(|d| PathBuf::from(d).canonicalize().ok())) {
        return dir.as_deref().and_then(|d| disk_asset(d, &candidates));
    }
    // The installed interface: files beside the app (bundle resources, web/), so the binary stays small and the pages
    // live in the system's file cache rather than being decompressed into Folevi's own memory on every request.
    if let Some(dir) = installed_web(app) {
        if let Some(found) = disk_asset(dir, &candidates) {
            return Some(found);
        }
    }
    let resolver = app.asset_resolver();
    // Only an exact name, as from disk: Tauri's resolver falls back by itself ("documents" gives documents.html,
    // anything else index.html), and the name asked for would then set the type ("documents" is
    // application/octet-stream), so the page went out undecorated and, with nosniff, blank in WebKitGTK.
    static NAMES: std::sync::OnceLock<std::collections::HashSet<String>> = std::sync::OnceLock::new();
    let names = NAMES.get_or_init(|| resolver.iter().map(|(k, _)| k.trim_start_matches('/').to_string()).collect());
    for c in &candidates {
        if !names.contains(c.as_str()) {
            continue;
        }
        if let Some(a) = resolver.get(c.clone()) {
            return Some((a.bytes().to_vec(), c.clone()));
        }
    }
    if cfg!(debug_assertions) {
        static DEV_WEB: std::sync::OnceLock<Option<PathBuf>> = std::sync::OnceLock::new();
        let dir = DEV_WEB.get_or_init(|| PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../web")).canonicalize().ok());
        return dir.as_deref().and_then(|d| disk_asset(d, &candidates));
    }
    None
}

/// The interface installed beside the app (<resources>/web), when it's there.
fn installed_web(app: &AppHandle) -> Option<&'static std::path::Path> {
    static DIR: std::sync::OnceLock<Option<PathBuf>> = std::sync::OnceLock::new();
    DIR.get_or_init(|| app.path().resource_dir().ok().map(|r| r.join("web")).filter(|d| d.join("index.html").is_file()).and_then(|d| d.canonicalize().ok()))
        .as_deref()
}

/// A file under `root`, which must already be canonical (each caller caches it), so a request costs one lookup
/// of its own real path. Anything that resolves outside `root` (`..`, a link pointing elsewhere) is refused.
fn disk_asset(root: &std::path::Path, candidates: &[String]) -> Option<(Vec<u8>, String)> {
    for c in candidates {
        let file = root.join(c);
        let Ok(real) = file.canonicalize() else { continue };
        if real.starts_with(root) && real.is_file() {
            return std::fs::read(&real).ok().map(|b| (b, c.clone()));
        }
    }
    None
}

// ---------------------------------------------------------------- start

pub fn run() {
    let test_data = std::env::var("FOLEVI_USER_DATA").ok().filter(|s| !s.is_empty());
    #[cfg(windows)]
    unsafe {
        let id: Vec<u16> = APP_ID.encode_utf16().chain(std::iter::once(0)).collect();
        windows_sys::Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID(id.as_ptr());
    }
    let mut builder = tauri::Builder::default();
    // A test run with its own data folder doesn't take the installed app's single-instance lock or links.
    if test_data.is_none() {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(link) = argv.iter().find(|a| a.to_ascii_lowercase().starts_with("folevi:")) {
                open_link(app, link);
            } else {
                show_main(app, None);
            }
        }));
    }
    builder = builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_window_state::Builder::default().with_denylist(&["quickadd"]).build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().with_handler(|app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                toggle_quick_add(app);
            }
        }).build())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, Some(vec!["--hidden"])))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .register_asynchronous_uri_scheme_protocol("app", |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            let label = ctx.webview_label().to_string();
            tauri::async_runtime::spawn(async move {
                responder.respond(serve(&app, &label, &request).await);
            });
        })
        .invoke_handler(tauri::generate_handler![shell_call, desktop_call])
        .setup(move |app| {
            let handle = app.handle().clone();
            let user_data = match &test_data {
                Some(d) => PathBuf::from(d),
                None => app.path().app_data_dir()?,
            };
            std::fs::create_dir_all(&user_data)?;
            let home = if test_data.is_some() { user_data.join("home") } else { app.path().home_dir()? };
            let paths = Paths { user_data: user_data.clone(), home, test_run: test_data.is_some() };
            let sealer = Arc::new(secrets::Sealer::load(&user_data, !paths.test_run && !MAC).map_err(|e| e.to_string())?);
            let secret_store = Arc::new(secrets::SecretStore::new(user_data.join("secrets"), sealer.clone()));
            let service_url = tauri::Url::parse(&std::env::var("FOLEVI_URL").unwrap_or_else(|_| "https://app.folevi.com".into()))?;
            let extra_connect = std::env::var("FOLEVI_SHELL_CONNECT").unwrap_or_default().split([' ', ',']).filter(|o| o.starts_with("http") || o.starts_with("ws")).map(str::to_string).collect();
            let chooser_app = handle.clone();
            let library = library::LibraryService::new(library::LibraryOptions {
                user_data: user_data.clone(),
                home: paths.home.clone(),
                sealer: sealer.clone(),
                choose_folder: Arc::new(move |title: &str, start: Option<PathBuf>| {
                    let mut d = chooser_app.dialog().file().set_title(title);
                    if let Some(s) = start {
                        d = d.set_directory(s);
                    }
                    d.blocking_pick_folder().and_then(|p| p.into_path().ok())
                }),
                emit: emitter(&handle),
            });
            let opener_app = handle.clone();
            let auth = auth::Auth::new(service_url.clone(), secret_store.clone(), Arc::new(move |url: &str| {
                let _ = opener_app.opener().open_url(url, None::<&str>);
            }), device_name());
            let reminder_app = handle.clone();
            let reminders = reminders::Reminders::new(user_data.join("reminders.json"), Arc::new(move |r: reminders::Reminder| {
                let app = reminder_app.clone();
                let s = services(&app);
                if !s.settings.lock().notifications {
                    return;
                }
                let labelled = !s.places.lock().account_ids().is_empty();
                let title = if labelled { format!("{} · {}", THIS_DEVICE, r.title) } else { r.title.clone() };
                let path = r.path.clone();
                let app2 = app.clone();
                notify::show(APP_ID, &title, &r.body, Arc::new(move || {
                    let app3 = app2.clone();
                    let path = path.clone();
                    let _ = app2.run_on_main_thread(move || {
                        let s = services(&app3);
                        let (current, lib) = { let p = s.places.lock(); (p.current(), p.has_library()) };
                        if current.as_deref() != Some(LIBRARY) && lib {
                            switch_to(&app3, Some(LIBRARY.into()), if path.starts_with('/') { &path } else { "/documents" }, false);
                            show_main(&app3, None);
                        } else {
                            show_main(&app3, Some(&path));
                        }
                    });
                }));
            }));
            let mut settings = DesktopSettings::load(&user_data.join("settings.json"));
            let places_file = user_data.join("places.json");
            let first = !PlacesStore::exists(&places_file);
            let mut places = PlacesStore::load(places_file);
            if first && settings.mode == "local" {
                places.set_library(true);
                places.set_current(Some(LIBRARY.into()));
            }
            if settings.mode == "account" && places.current().is_none() {
                match places.account_ids().first().cloned() {
                    Some(a) => places.set_current(Some(a)),
                    None => places.pending_account = true,
                }
            }
            if settings.mode == "local" && places.current().is_none() && places.has_library() {
                places.set_current(Some(LIBRARY.into()));
            }
            settings.mode = places.mode_of(places.current().as_deref()).to_string();
            let services = Arc::new(Services {
                paths,
                service_url,
                extra_connect,
                sealer,
                secrets: secret_store.clone(),
                library: library.clone(),
                auth,
                ai: ai::Ai::new(secret_store),
                reminders: reminders.clone(),
                lock: Arc::new(applock::AppLock::load(user_data.join("lock.json"), lock_method())),
                places: Mutex::new(places),
                backsync: Mutex::new(backsync::BackSync::new(backsync::Plan::default())),
                poll_tokens: Mutex::new(HashMap::new()),
                settings: Mutex::new(settings),
                bound: Mutex::new(HashMap::new()),
                keys: Mutex::new(HashMap::new()),
                ui: Mutex::new(Ui::default()),
            });
            app.manage(services.clone());
            // The library and reminders open in the background so the window doesn't wait on the disk. Library
            // calls (the page's, attachments, rescans) wait until it's open; a reminders call that comes first
            // loads them itself.
            {
                let library = library.clone();
                tauri::async_runtime::spawn(async move { library.open().await });
            }
            {
                let s = services.clone();
                let local = s.settings.lock().mode == "local" || s.places.lock().has_library();
                if local {
                    reminders.load_soon();
                }
            }
            let error = register_shortcut(&handle);
            services.ui.lock().shortcut_error = error;
            update_tray(&handle);
            watch_server_names(&handle);
            updates::start(&handle, services.paths.test_run);
            // The app lock: covered from the first page when it's on; again after time away or sleep.
            if services.lock.cover() {
                log::info!("Folevi: locked at launch");
            }
            watch_sleep(&handle);
            start_background_sync(&handle);

            // folevi:// links: the one that started the app, then each later one (the single-instance plugin
            // forwards a second start's). Registered at run time too, for the AppImage and test builds.
            // On Linux only the AppImage needs it: a .deb, .rpm or Flatpak registers through its .desktop file.
            let register_links = !services.paths.test_run && !cfg!(debug_assertions);
            #[cfg(target_os = "linux")]
            let register_links = register_links && linux::should_register_links();
            if register_links {
                let _ = handle.deep_link().register_all();
            }
            #[cfg(target_os = "linux")]
            linux::follow_color_scheme(&handle);
            let link_app = handle.clone();
            handle.deep_link().on_open_url(move |event| {
                for url in event.urls() {
                    open_link(&link_app, url.as_str());
                }
            });
            let start_link = std::env::args().find(|a| a.to_ascii_lowercase().starts_with("folevi:"));
            let hidden = std::env::args().any(|a| a == "--hidden") && services.ui.lock().tray.is_some();
            if start_link.is_none() {
                create_main(&handle, "/documents", Some("main".into()), !hidden)?;
            }
            // Quick Add's window is made on first use (toggle_quick_add): a second copy of the interface loaded at
            // launch would cost as much memory as the main window's.
            if let Some(link) = start_link {
                open_link(&handle, &link);
            }
            println!("Folevi {FOLEVI_VERSION} ({}) at {} ({})", std::env::consts::ARCH, app_origin(), services.settings.lock().mode);
            let _ = now_ms();
            Ok(())
        });
    builder.build(tauri::generate_context!()).expect("Folevi couldn't start").run(|app, event| {
        if let tauri::RunEvent::ExitRequested { api, code, .. } = event {
            // Every window closed (the main one hides instead): stay for Quick Add and the tray, unless quitting.
            if code.is_none() && !services(app).ui.lock().quitting && services(app).ui.lock().tray.is_some() {
                api.prevent_exit();
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn links() {
        let p = |s: &str| deep_link_path(&tauri::Url::parse(s).unwrap());
        assert_eq!(p("folevi://d/01J0000000000000000000000A").as_deref(), Some("/d/01J0000000000000000000000A"));
        assert_eq!(p("folevi://d/01J0000000000000000000000A#blk-1").as_deref(), Some("/d/01J0000000000000000000000A#blk-1"));
        assert_eq!(p("folevi://d/inbox-abc123").as_deref(), Some("/d/inbox-abc123"));
        assert_eq!(p("folevi://d/../../etc").as_deref(), None);
        assert_eq!(p("folevi://new").as_deref(), Some("new"));
        assert_eq!(p("folevi://quick-add").as_deref(), Some("quick-add"));
        assert_eq!(p("folevi://tasks/today").as_deref(), Some("/tasks/today"));
        assert_eq!(p("folevi://evil.com/x").as_deref(), None);
        assert_eq!(p("https://folevi.com/d/x").as_deref(), None);
    }

    #[test]
    fn urls() {
        assert_eq!(app_url("/documents").as_str(), "app://localhost/documents");
        assert_eq!(app_url("//evil.com").as_str(), "app://localhost/documents");
        assert!(is_app_url("https://app.localhost/d/x"));
        assert!(is_app_url("app://localhost/"));
        assert!(!is_app_url("https://app.localhost.evil.com/"));
        assert!(!is_app_url("https://folevi.com/"));
    }

    #[test]
    fn boot_script_fills_the_bridge() {
        assert!(HOST_JS.contains("/*BOOT*/ { shell: false, platform: \"windows\", window: \"main\" } /*BOOT_END*/"));
        assert!(HOST_JS.contains("/*SHELL_BRIDGE*/"));
        assert!(SHELL_BRIDGE_JS.contains("var foleviShellBridge = function (SHELL, host)"));
    }
}
