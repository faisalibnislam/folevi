//! The desktop app's own settings (the web app's live in the account), in settings.json in the app's data folder.
//! Port of Electron's settings.ts. The page reads and changes four of them (Settings > Desktop app).
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::Path;

use crate::shell::write_atomic;

/// Quick Add's shortcut until changed: Ctrl+Alt+Space (Alt+Space opens every window's system menu on Windows, and
/// several Linux desktops use it too). apps/web lib/desktop.ts says the same.
pub const DEFAULT_QUICK_ADD_SHORTCUT: &str = "Control+Alt+Space";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DesktopSettings {
    /// An accelerator ("Control+Alt+Space"); empty for none.
    pub quick_add_shortcut: String,
    pub open_at_login: bool,
    /// The notification area (tray) icon. The page's name for it is the Mac's.
    pub menu_bar_icon: bool,
    pub notifications: bool,
    /// Where the notes live, chosen at first launch: "unset", "local" or "account". Never set by the page.
    pub mode: String,
}

impl Default for DesktopSettings {
    fn default() -> Self {
        Self { quick_add_shortcut: DEFAULT_QUICK_ADD_SHORTCUT.into(), open_at_login: true, menu_bar_icon: true, notifications: true, mode: "unset".into() }
    }
}

const MODIFIERS: &[&str] = &["Command", "Cmd", "Control", "Ctrl", "CommandOrControl", "CmdOrCtrl", "Alt", "Option", "Shift", "Super", "Meta"];

fn is_key(k: &str) -> bool {
    let single = k.len() == 1 && (k.chars().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit()) || r"`-=[]\;',./".contains(k));
    let f = k.strip_prefix('F').and_then(|n| n.parse::<u8>().ok()).is_some_and(|n| (1..=24).contains(&n));
    single || f || matches!(k, "Space" | "Tab" | "Enter" | "Return" | "Backspace" | "Delete" | "Up" | "Down" | "Left" | "Right" | "Home" | "End" | "PageUp" | "PageDown" | "Escape" | "Plus")
}

/// A shortcut Folevi accepts for Quick Add: one or more modifiers (not Shift alone), then a single key. Empty is "off".
pub fn is_valid_shortcut(accelerator: &str) -> bool {
    if accelerator.is_empty() {
        return true;
    }
    let mut parts: Vec<&str> = accelerator.split('+').collect();
    let key = parts.pop().unwrap_or("");
    if !is_key(key) || parts.is_empty() || !parts.iter().all(|m| MODIFIERS.contains(m)) {
        return false;
    }
    let mut seen = parts.clone();
    seen.sort();
    seen.dedup();
    seen.len() == parts.len() && parts.iter().any(|m| *m != "Shift")
}

impl DesktopSettings {
    pub fn load(file: &Path) -> Self {
        std::fs::read(file).ok().and_then(|b| serde_json::from_slice::<Value>(&b).ok()).map(|v| Self::default().merged(&v, true)).unwrap_or_default()
    }

    pub fn save(&self, file: &Path) {
        if let Ok(bytes) = serde_json::to_vec_pretty(self) {
            let _ = write_atomic(file, &bytes);
        }
    }

    /// Known settings of the right type from `input` laid over these; a page's change (`from_file` false) never
    /// touches the mode.
    pub fn merged(&self, input: &Value, from_file: bool) -> Self {
        let b = |k: &str, d: bool| input.get(k).and_then(Value::as_bool).unwrap_or(d);
        let shortcut = input.get("quickAddShortcut").and_then(Value::as_str).filter(|s| is_valid_shortcut(s)).map(str::to_string).unwrap_or_else(|| self.quick_add_shortcut.clone());
        let mode = if from_file { input.get("mode").and_then(Value::as_str).filter(|m| matches!(*m, "unset" | "local" | "account")).map(str::to_string).unwrap_or_else(|| self.mode.clone()) } else { self.mode.clone() };
        Self { quick_add_shortcut: shortcut, open_at_login: b("openAtLogin", self.open_at_login), menu_bar_icon: b("menuBarIcon", self.menu_bar_icon), notifications: b("notifications", self.notifications), mode }
    }

    /// What the page sees (Settings > Desktop app).
    pub fn page(&self) -> Value {
        serde_json::json!({ "quickAddShortcut": self.quick_add_shortcut, "openAtLogin": self.open_at_login, "menuBarIcon": self.menu_bar_icon, "notifications": self.notifications })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn shortcuts() {
        assert!(is_valid_shortcut("Control+Alt+Space"));
        assert!(is_valid_shortcut("Super+Shift+K"));
        assert!(is_valid_shortcut(""));
        assert!(!is_valid_shortcut("K"));
        assert!(!is_valid_shortcut("Shift+K"));
        assert!(!is_valid_shortcut("Control+Control+K"));
        assert!(!is_valid_shortcut("Hyper+K"));
    }

    #[test]
    fn page_changes_never_touch_the_mode() {
        let s = DesktopSettings::default();
        let next = s.merged(&json!({ "mode": "local", "notifications": false, "quickAddShortcut": "Shift+K" }), false);
        assert_eq!(next.mode, "unset");
        assert!(!next.notifications);
        assert_eq!(next.quick_add_shortcut, DEFAULT_QUICK_ADD_SHORTCUT);
        assert_eq!(s.merged(&json!({ "mode": "local" }), true).mode, "local");
    }

    #[test]
    fn saves_and_loads() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("settings.json");
        assert_eq!(DesktopSettings::load(&file), DesktopSettings::default());
        let s = DesktopSettings { open_at_login: false, ..Default::default() };
        s.save(&file);
        assert_eq!(DesktopSettings::load(&file), s);
        std::fs::write(&file, b"not json").unwrap();
        assert_eq!(DesktopSettings::load(&file), DesktopSettings::default());
    }
}
