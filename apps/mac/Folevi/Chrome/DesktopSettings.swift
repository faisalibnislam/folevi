// The Mac app's own settings (Settings > General, today's "Desktop app" section): Quick Add's shortcut, opening at
// login, the menu bar icon and Mac notifications. Electron kept them in settings.json (the Electron Mac app's settings.ts);
// here they live in the build's defaults (Paths.defaults: a FOLEVI_USER_DATA run has its own). The page sees and
// changes the same four keys (`pageSettings`), never the mode.
import Foundation

struct DesktopSettings: Equatable {
    /// Opens Quick Add from any app ("Alt+Space", "Command+Shift+K"); empty for none.
    var quickAddShortcut = "Alt+Space"
    var openAtLogin = true
    var menuBarIcon = true
    /// Comments, mentions and reminders as Mac notifications.
    var notifications = true

    static let defaults = DesktopSettings()
    private static let key = "folevi.desktop.settings"

    /// The saved settings (or the defaults).
    static var current: DesktopSettings {
        get { clean(Paths.defaults.dictionary(forKey: key) ?? [:], base: defaults) }
        set { Paths.defaults.set(newValue.page, forKey: key) }
    }

    /// What the page reads (foleviDesktop.getSettings): the four keys.
    var page: [String: Any] {
        ["quickAddShortcut": quickAddShortcut, "openAtLogin": openAtLogin, "menuBarIcon": menuBarIcon, "notifications": notifications]
    }

    /// Known keys of the right type only; anything else keeps `base`'s value (Electron's cleanSettings).
    static func clean(_ raw: [String: Any], base: DesktopSettings) -> DesktopSettings {
        var out = base
        if let s = raw["quickAddShortcut"] as? String, isValidShortcut(s) { out.quickAddShortcut = s }
        if let b = raw["openAtLogin"] as? Bool { out.openAtLogin = b }
        if let b = raw["menuBarIcon"] as? Bool { out.menuBarIcon = b }
        if let b = raw["notifications"] as? Bool { out.notifications = b }
        return out
    }

    private static let modifiers: Set<String> = ["Command", "Cmd", "Control", "Ctrl", "CommandOrControl", "CmdOrCtrl", "Alt", "Option", "Shift", "Super", "Meta"]
    private static let keyPattern = #"^([A-Z0-9]|F([1-9]|1[0-9]|2[0-4])|Space|Tab|Enter|Return|Backspace|Delete|Up|Down|Left|Right|Home|End|PageUp|PageDown|Escape|Plus|[`\-=\[\]\\;',./])$"#

    /// A shortcut Folevi accepts: at least one modifier other than Shift, then one key (settings.ts's rule: a bare
    /// key, or Shift with a letter, would swallow typing everywhere). Empty means none.
    static func isValidShortcut(_ accelerator: String) -> Bool {
        if accelerator.isEmpty { return true }
        var parts = accelerator.components(separatedBy: "+")
        guard let key = parts.popLast(), key.range(of: keyPattern, options: .regularExpression) != nil, !parts.isEmpty else { return false }
        guard parts.allSatisfy(modifiers.contains), Set(parts).count == parts.count else { return false }
        return parts.contains { $0 != "Shift" }
    }
}
