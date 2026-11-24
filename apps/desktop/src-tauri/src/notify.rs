//! Windows and Linux notifications that bring Folevi forward at the page they're about when clicked (Electron's
//! Notification click). Windows: WinRT toasts tied to Folevi's AppUserModelID (the installer's Start menu
//! shortcut carries it); Linux: the desktop's notification server through D-Bus, waiting for the "default" action.
use std::sync::Arc;

/// Runs when the person clicks the notification.
pub type OnClick = Arc<dyn Fn() + Send + Sync>;

/// Shows a notification. `app_id`: Windows' AppUserModelID for Folevi.
pub fn show(app_id: &str, title: &str, body: &str, on_click: OnClick) {
    let (title, body) = (truncate(title, 200), truncate(body, 400));
    #[cfg(windows)]
    {
        use tauri_winrt_notification::Toast;
        // An installed Folevi has its own id (the Start menu shortcut); a development run borrows PowerShell's,
        // which Windows always knows, so the toast still shows.
        let id = if std::env::var_os("FOLEVI_DEV_TOASTS").is_some() { Toast::POWERSHELL_APP_ID.to_string() } else { app_id.to_string() };
        let click = on_click.clone();
        let result = Toast::new(&id)
            .title(&title)
            .text1(&body)
            .on_activated(move |_| {
                click();
                Ok(())
            })
            .show();
        if let Err(e) = result {
            log::warn!("Folevi: the notification didn't show: {e}");
        }
    }
    #[cfg(not(windows))]
    {
        let _ = app_id;
        std::thread::spawn(move || {
            let mut n = notify_rust::Notification::new();
            n.summary(&title).body(&body).appname("Folevi");
            #[cfg(all(unix, not(target_os = "macos")))]
            {
                n.action("default", "Open");
                n.icon("com.folevi.desktop");
                if let Ok(handle) = n.show() {
                    handle.wait_for_action(|action| {
                        if action == "default" {
                            on_click();
                        }
                    });
                }
            }
            #[cfg(target_os = "macos")]
            {
                let _ = n.show();
                let _ = on_click;
            }
        });
    }
}

fn truncate(s: &str, max: usize) -> String {
    s.chars().take(max).collect()
}
