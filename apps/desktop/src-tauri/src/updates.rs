//! Automatic updates for Folevi for Windows and the Linux AppImage (docs/DESKTOP_APP.md, "Updates"), the way
//! Sparkle updates the Mac app: a check soon after launch and twice a day, and Check for Updates in the tray menu.
//!
//! The feed is `folevi.com/download/desktop/<target>-<arch>/latest.json` (tauri.conf.json), written by
//! packaging/desktop/publish-update-feed.sh. Every update is signed with Folevi's update key (kept outside the
//! repository, ~/.folevi-desktop-signing); the app refuses one whose signature doesn't match the public key in
//! tauri.conf.json.
//!
//! A .deb, .rpm, Snap or Flatpak is updated by the system's software updater, so only the AppImage updates itself.

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use parking_lot::Mutex;
use tauri::AppHandle;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_updater::{Update, UpdaterExt};

/// First automatic check after launch, then every 12 hours while Folevi runs.
const FIRST_CHECK: Duration = Duration::from_secs(60);
const EVERY: Duration = Duration::from_secs(12 * 60 * 60);

static CHECKING: AtomicBool = AtomicBool::new(false);
/// A version the person chose Later for: automatic checks don't ask about it again until Folevi restarts.
static LATER: Mutex<Option<String>> = Mutex::new(None);

/// Whether this copy of Folevi updates itself: every Windows install, and on Linux only the AppImage.
pub fn supported() -> bool {
    #[cfg(target_os = "linux")]
    return crate::linux::self_update_allowed();
    #[cfg(not(target_os = "linux"))]
    cfg!(windows)
}

/// Starts the automatic checks. Not in test runs or debug builds, which have no feed of their own.
pub fn start(app: &AppHandle, test_run: bool) {
    if !supported() || test_run || cfg!(debug_assertions) {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(FIRST_CHECK).await;
        loop {
            check(&app, false).await;
            tokio::time::sleep(EVERY).await;
        }
    });
}

/// Check for Updates in the tray menu: says so when Folevi is up to date or the check fails.
pub fn check_by_hand(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move { check(&app, true).await });
}

async fn check(app: &AppHandle, by_hand: bool) {
    if CHECKING.swap(true, Ordering::SeqCst) {
        return;
    }
    let found = match app.updater() {
        Ok(u) => u.check().await,
        Err(e) => Err(e),
    };
    CHECKING.store(false, Ordering::SeqCst);
    match found {
        Ok(Some(update)) => {
            if !by_hand && LATER.lock().as_deref() == Some(update.version.as_str()) {
                return;
            }
            offer(app, update);
        }
        Ok(None) => {
            if by_hand {
                tell(app, "Folevi is up to date", &format!("Folevi {} is the newest version.", crate::FOLEVI_VERSION));
            }
        }
        Err(e) => {
            log::warn!("Folevi: update check failed: {e}");
            if by_hand {
                tell(app, "Folevi couldn't check for updates", "Check your internet connection, then try again.");
            }
        }
    }
}

fn offer(app: &AppHandle, update: Update) {
    let notes = update.body.as_deref().map(str::trim).filter(|b| !b.is_empty()).map(|b| format!("\n\n{b}")).unwrap_or_default();
    let body = format!("Folevi {} is available. You have {}.{notes}", update.version, crate::FOLEVI_VERSION);
    let app2 = app.clone();
    app.dialog()
        .message(body)
        .title("A new version of Folevi is available")
        .kind(MessageDialogKind::Info)
        .buttons(MessageDialogButtons::OkCancelCustom("Install and Restart".into(), "Later".into()))
        .show(move |install| {
            if !install {
                *LATER.lock() = Some(update.version.clone());
                return;
            }
            tauri::async_runtime::spawn(async move { install_update(&app2, update).await });
        });
}

async fn install_update(app: &AppHandle, update: Update) {
    let bytes = match update.download(|_, _| {}, || {}).await {
        Ok(b) => b,
        Err(e) => {
            log::warn!("Folevi: update download failed: {e}");
            tell(app, "Folevi couldn't download the update", "Check your internet connection, then choose Check for Updates again.");
            return;
        }
    };
    // Notes and reminders are saved before the installer takes over (on Windows it closes Folevi itself).
    crate::prepare_to_quit(app);
    if let Err(e) = update.install(bytes) {
        log::warn!("Folevi: update install failed: {e}");
        // The library is closed by now, so Folevi starts again after the message, as it was.
        let app = app.clone();
        let _ = tauri::async_runtime::spawn_blocking(move || {
            app.dialog()
                .message("Download the newest Folevi from folevi.com/download and install it. Folevi will now open again.")
                .title("Folevi couldn't install the update")
                .kind(MessageDialogKind::Warning)
                .buttons(MessageDialogButtons::Ok)
                .blocking_show();
            app.restart();
        })
        .await;
        return;
    }
    // The AppImage was replaced in place; Windows's installer starts Folevi again when it's done.
    app.restart();
}

fn tell(app: &AppHandle, title: &str, body: &str) {
    app.dialog().message(body).title(title).kind(MessageDialogKind::Info).buttons(MessageDialogButtons::Ok).show(|_| {});
}
