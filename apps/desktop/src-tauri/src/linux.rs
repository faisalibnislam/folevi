//! Folevi for Linux: what only Linux needs on top of the shared desktop shell (docs/LINUX.md). The `mod` line in
//! lib.rs is `#[cfg(target_os = "linux")]`, so Windows builds never see any of this.
//!
//! - [`pre_init`]: environment fixes that must be in place before GTK starts (WebKitGTK on NVIDIA, Flatpak).
//! - [`install_kind`], [`self_update_allowed`]: only the AppImage may update itself; .deb and .rpm update through
//!   the apt and dnf/zypper repositories, Flatpak through Flathub, Snap through the Snap Store.
//! - [`should_register_links`]: an AppImage isn't installed, so it registers folevi:// at run time; a .deb, .rpm,
//!   Flatpak or Snap already does through its .desktop file (a second, run-time entry would only duplicate it).
//! - [`follow_color_scheme`]: the desktop's light/dark setting (the portal's color-scheme), live. WebKitGTK 2.50
//!   follows it for the page already; GTK 3's own parts (title bar, menus, dialogs) don't, so we set the theme.
//! - [`bind_quick_add`]: Quick Add's shortcut on Wayland, where apps can't grab keys: through the desktop's
//!   GlobalShortcuts portal (KDE Plasma 5.27+, GNOME 48+, Hyprland). X11 keeps the global-shortcut plugin.
//! - [`icon_name`], [`THIS_DEVICE`]: names that differ from Windows'.
//!
//! Checked in an Ubuntu 22.04 VM (X11 under Xvfb): rendering, tray, notifications, the Secret Service,
//! single-instance links and the portal's color scheme. Not checked: a real Wayland desktop with the portal.

use std::path::Path;
use std::sync::Arc;

use parking_lot::Mutex;
use tauri::{AppHandle, Runtime, Theme};

/// How notes "on this device" are named on Linux (Windows says "this PC").
pub const THIS_DEVICE: &str = "On this computer";

/// The app's id on Linux (tauri.linux.conf.json, the Flatpak, AppStream).
pub const APP_ID: &str = "com.folevi.Folevi";

/// How this copy of Folevi was installed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InstallKind {
    AppImage,
    Flatpak,
    Snap,
    /// A .deb or .rpm (anything under /usr or /opt): the system's package manager owns it.
    Package,
    /// `cargo run`, `tauri dev`, an unpacked build.
    Other,
}

/// Call first thing in `main`, before GTK and WebKitGTK start.
pub fn pre_init() {
    // WebKitGTK's DMA-BUF renderer shows a blank or flickering window with NVIDIA's own driver (Tauri's "Linux
    // graphics issues"). Only there, and never over a value the person set.
    if Path::new("/proc/driver/nvidia/version").exists() && std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }
}

pub fn install_kind() -> InstallKind {
    install_kind_from(|k| std::env::var(k).ok(), std::env::current_exe().ok().as_deref())
}

fn install_kind_from(env: impl Fn(&str) -> Option<String>, exe: Option<&Path>) -> InstallKind {
    if env("FLATPAK_ID").is_some() {
        return InstallKind::Flatpak;
    }
    if env("SNAP").is_some() && env("SNAP_NAME").is_some() {
        return InstallKind::Snap;
    }
    // The AppImage runtime sets APPIMAGE to the file's own path.
    if env("APPIMAGE").is_some_and(|p| !p.is_empty()) {
        return InstallKind::AppImage;
    }
    match exe {
        Some(p) if p.starts_with("/usr/") || p.starts_with("/opt/") => InstallKind::Package,
        _ => InstallKind::Other,
    }
}

/// Whether an in-app update may run: the AppImage only. Everything else has a package manager that would
/// fight it, and a .deb or .rpm needs root to replace.
pub fn self_update_allowed() -> bool {
    install_kind() == InstallKind::AppImage
}

/// Whether to register folevi:// at run time (the deep-link plugin's register_all): the AppImage only.
pub fn should_register_links() -> bool {
    install_kind() == InstallKind::AppImage
}

/// The icon notifications show: the installed icon's name (the .deb and .rpm install `folevi`, the Flatpak and
/// Snap the app id).
pub fn icon_name() -> &'static str {
    match install_kind() {
        InstallKind::Flatpak | InstallKind::Snap => APP_ID,
        _ => "folevi",
    }
}

/// Follows the desktop's light or dark setting through the portal, now and on every change. Without a portal
/// (older desktops) GTK's own theme decides, as before.
pub fn follow_color_scheme<R: Runtime>(app: &AppHandle<R>) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        use ashpd::desktop::settings::{ColorScheme, Settings};
        use futures_util::StreamExt;
        let Ok(settings) = Settings::new().await else { return };
        let apply = |scheme: ColorScheme| {
            let theme = match scheme {
                ColorScheme::PreferDark => Some(Theme::Dark),
                ColorScheme::PreferLight => Some(Theme::Light),
                ColorScheme::NoPreference => None,
            };
            let app2 = app.clone();
            let _ = app.run_on_main_thread(move || app2.set_theme(theme));
        };
        if let Ok(scheme) = settings.color_scheme().await {
            apply(scheme);
        }
        let changes = settings.receive_color_scheme_changed().await;
        if let Ok(mut changes) = changes {
            while let Some(scheme) = changes.next().await {
                apply(scheme);
            }
        };
    });
}

/// Whether this is a Wayland session (where the global-shortcut plugin registers but never fires).
pub fn is_wayland() -> bool {
    std::env::var("XDG_SESSION_TYPE").map(|t| t.eq_ignore_ascii_case("wayland")).unwrap_or(false)
        || std::env::var_os("WAYLAND_DISPLAY").is_some()
}

/// What Settings > Desktop app shows when the desktop can't give Folevi a shortcut.
pub fn system_shortcut_hint() -> String {
    let command = if install_kind() == InstallKind::Flatpak {
        format!("flatpak run {APP_ID} folevi://quick-add")
    } else {
        "folevi folevi://quick-add".to_string()
    };
    format!(
        "This desktop doesn't let apps set their own shortcuts. Add one in your system's keyboard settings that runs: {command}"
    )
}

/// The running portal binding: dropped (and so released) when Quick Add's shortcut changes.
static BINDING: Mutex<Option<tauri::async_runtime::JoinHandle<()>>> = Mutex::new(None);

/// Binds Quick Add's shortcut through the GlobalShortcuts portal (Wayland). `accelerator` is the shared setting
/// ("Ctrl+Alt+Space"), empty to remove it. The desktop asks the person to confirm the first time. `done` gets
/// None once bound, or the message for Settings when the desktop has no portal or refused.
pub fn bind_quick_add<R: Runtime>(
    app: &AppHandle<R>,
    accelerator: &str,
    on_press: Arc<dyn Fn() + Send + Sync>,
    done: Arc<dyn Fn(Option<String>) + Send + Sync>,
) {
    if let Some(old) = BINDING.lock().take() {
        old.abort();
    }
    if accelerator.is_empty() {
        return;
    }
    let trigger = portal_trigger(accelerator);
    let _ = app;
    let task = tauri::async_runtime::spawn(async move {
        use ashpd::desktop::global_shortcuts::{GlobalShortcuts, NewShortcut};
        use futures_util::StreamExt;
        let bound = async {
            // A .deb or .rpm isn't sandboxed, so the portal can't tell which app asks: say so (newer portals).
            if install_kind() != InstallKind::Flatpak {
                if let Ok(id) = ashpd::AppID::try_from(APP_ID) {
                    let _ = ashpd::register_host_app(id).await;
                }
            }
            let portal = GlobalShortcuts::new().await?;
            let session = portal.create_session(Default::default()).await?;
            let shortcut = NewShortcut::new("quick-add", "Quick Add to Folevi").preferred_trigger(trigger.as_deref());
            portal.bind_shortcuts(&session, &[shortcut], None, Default::default()).await?.response()?;
            let activated = portal.receive_activated().await?;
            Ok::<_, ashpd::Error>((session, activated))
        }
        .await;
        match bound {
            Ok((session, mut activated)) => {
                done(None);
                let _session = session; // the binding lasts as long as the session
                while let Some(event) = activated.next().await {
                    if event.shortcut_id() == "quick-add" {
                        on_press();
                    }
                }
            }
            Err(e) => {
                log::info!("Folevi: no GlobalShortcuts portal for Quick Add ({e})");
                done(Some(system_shortcut_hint()));
            }
        }
    });
    *BINDING.lock() = Some(task);
}

/// "Ctrl+Alt+Space" as the portal's preferred trigger ("CTRL+ALT+space", the XDG shortcuts spec).
fn portal_trigger(accelerator: &str) -> Option<String> {
    let parts: Vec<&str> = accelerator.split('+').map(str::trim).filter(|p| !p.is_empty()).collect();
    let (key, mods) = parts.split_last()?;
    let mut out: Vec<String> = mods
        .iter()
        .map(|m| match m.to_ascii_lowercase().as_str() {
            "ctrl" | "control" | "commandorcontrol" | "cmdorctrl" => "CTRL".into(),
            "alt" | "option" => "ALT".into(),
            "shift" => "SHIFT".into(),
            "super" | "meta" | "cmd" | "command" | "logo" => "LOGO".into(),
            other => other.to_ascii_uppercase(),
        })
        .collect();
    out.push(key.to_ascii_lowercase());
    Some(out.join("+"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env_of(pairs: &'static [(&'static str, &'static str)]) -> impl Fn(&str) -> Option<String> {
        move |k| pairs.iter().find(|(n, _)| *n == k).map(|(_, v)| v.to_string())
    }

    #[test]
    fn install_kinds() {
        assert_eq!(install_kind_from(env_of(&[("FLATPAK_ID", "com.folevi.Folevi")]), None), InstallKind::Flatpak);
        assert_eq!(install_kind_from(env_of(&[("SNAP", "/snap/folevi/1"), ("SNAP_NAME", "folevi")]), None), InstallKind::Snap);
        assert_eq!(install_kind_from(env_of(&[("APPIMAGE", "/home/a/Folevi_1.5.68_amd64.AppImage")]), None), InstallKind::AppImage);
        assert_eq!(install_kind_from(env_of(&[]), Some(Path::new("/usr/bin/folevi"))), InstallKind::Package);
        assert_eq!(install_kind_from(env_of(&[]), Some(Path::new("/home/a/src/target/debug/folevi"))), InstallKind::Other);
    }

    #[test]
    fn triggers() {
        assert_eq!(portal_trigger("Ctrl+Alt+Space").as_deref(), Some("CTRL+ALT+space"));
        assert_eq!(portal_trigger("CommandOrControl+Shift+N").as_deref(), Some("CTRL+SHIFT+n"));
        assert_eq!(portal_trigger("Super+K").as_deref(), Some("LOGO+k"));
        assert_eq!(portal_trigger(""), None);
    }

    #[test]
    fn hint_names_the_command() {
        assert!(system_shortcut_hint().contains("folevi://quick-add"));
    }
}
