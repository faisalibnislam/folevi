// Settings' search in the Mac's Settings window (docs/MAC_NATIVE_LOOK.md, the owner's guide "Required Macloving
// Settings window style"): what it can find. Every category by its name, and each section's cards and switches by
// their words and a few words people look for them by ("dark mode" finds Theme). A result names the category it
// opens and the card or row it scrolls to (SettingsAnchor), which shows a highlight for a moment.
//
// Kept beside the sections it describes: a card renamed there is renamed here (SettingsSearchTests checks that every
// category the window lists has entries, and that the matching is right).
#if os(macOS) || os(iOS)
import Foundation

/// One thing Settings' search can find.
public struct SettingsSearchEntry: Hashable, Sendable {
    /// The category it's in (a MacSettingsSection raw value: "appearance", "members").
    public var section: String
    /// What the result says: the card's title or the setting's label.
    public var label: String
    /// Other words that find it (lowercase).
    public var keywords: [String]
    /// The card or row to scroll to (SettingsAnchor), nil for the category itself.
    public var anchor: String?
    /// Only in a library (local) or only with an account; nil for both.
    public var local: Bool?

    public init(section: String, label: String, keywords: [String] = [], anchor: String? = nil, local: Bool? = nil) {
        self.section = section
        self.label = label
        self.keywords = keywords
        self.anchor = anchor
        self.local = local
    }
}

/// A search result: the entry and the category's name as the list shows it.
public struct SettingsSearchResult: Hashable, Sendable, Identifiable {
    public var entry: SettingsSearchEntry
    public var category: String
    public var id: String { "\(entry.section)|\(entry.anchor ?? "")|\(entry.label)" }
}

public enum SettingsSearch {
    private static func card(_ section: String, _ title: String, _ keywords: [String] = [], anchor: String? = nil, local: Bool? = nil) -> SettingsSearchEntry {
        SettingsSearchEntry(section: section, label: title, keywords: keywords, anchor: SettingsAnchor.card(anchor ?? title), local: local)
    }

    private static func row(_ section: String, _ label: String, _ keywords: [String] = [], local: Bool? = nil) -> SettingsSearchEntry {
        SettingsSearchEntry(section: section, label: label, keywords: keywords, anchor: SettingsAnchor.row(label), local: local)
    }

    /// Everything the sections hold, in the order the pages show it.
    public static let entries: [SettingsSearchEntry] = [
        // General (the Mac app's own settings, DesktopSettingsView)
        card("desktop", "Quick Add", ["shortcut", "keyboard", "hotkey", "global", "task", "inbox"]),
        row("desktop", "Open at login", ["startup", "launch", "login items", "start"]),
        row("desktop", "Menu bar icon", ["status", "menu bar", "tray"]),
        row("desktop", "Mac notifications", ["alerts", "dock", "badge", "unread"]),
        row("desktop", "Show notes in Spotlight", ["spotlight", "search", "index"]),
        // Account
        card("account", "Profile", ["name", "email", "picture", "avatar", "photo", "time zone", "timezone"]),
        card("account", "Foli AI", ["ai", "assistant", "google", "on", "off"], anchor: "Foli AI"),
        // Foli AI (an account's)
        card("ai", "Foli AI", ["ai", "assistant", "turn on", "turn off"], local: false),
        row("ai", "Keep conversations", ["conversations", "history", "chats"], local: false),
        row("ai", "Memory", ["remember", "tone"], local: false),
        row("ai", "Suggestions", ["hints", "related notes", "duplicates", "action items"], local: false),
        row("ai", "Read attachments", ["files", "pdf", "images", "transcribe", "recordings"], local: false),
        row("ai", "Web research", ["web", "search", "research", "links"], local: false),
        row("ai", "Digests", ["summary", "daily", "weekly"], local: false),
        row("ai", "Read text on your devices", ["ocr", "handwriting", "images", "search in images"], local: false),
        row("ai", "Read images with Foli AI", ["ocr", "images", "search in images"], local: false),
        // Foli AI (a library's)
        card("ai", "Foli AI", ["ai", "assistant", "turn on", "turn off"], local: true),
        card("ai", "Your own keys", ["api key", "openai", "anthropic", "claude", "gemini", "google", "key"], local: true),
        card("ai", "Model", ["provider", "model", "apple intelligence"], local: true),
        card("ai", "Conversations", ["history", "keep conversations", "chats"], local: true),
        card("ai", "Memory", ["remember", "tone", "language", "instruction", "term"]),
        // Plan & billing
        card("billing", "Your plan", ["plan", "subscription", "pro", "core", "storage", "upgrade", "billing", "payment"]),
        card("billing", "Billing history", ["invoices", "payments", "receipts"]),
        // Security
        card("security", "Sign-in methods", ["password", "google", "apple", "login"]),
        card("security", "Two-step verification", ["2fa", "two-factor", "mfa", "authenticator", "code"]),
        card("security", "Passkeys", ["touch id", "passkey", "face id"]),
        card("security", "Delete account", ["remove account", "close account", "delete"]),
        // Privacy
        card("privacy", "End-to-end encryption", ["e2ee", "encrypt", "lock", "private"]),
        // Devices
        card("devices", "Connected devices", ["devices", "limit"]),
        card("devices", "Signed in", ["sessions", "sign out", "browsers", "log out"]),
        // Connected apps
        card("connected-apps", "Connected apps", ["mcp", "integrations", "disconnect", "claude", "chatgpt"]),
        card("connected-apps", "API tokens", ["api", "token", "scripts", "developer"]),
        card("connected-apps", "Webhooks", ["webhook", "post", "events", "developer"]),
        // Appearance
        card("appearance", "Theme", ["dark mode", "light mode", "dark", "light", "system", "colors"]),
        card("appearance", "Editor text size", ["font size", "zoom", "text size", "bigger", "smaller", "larger"]),
        // Writing
        card("writing", "Spelling and prediction", ["spell check", "spelling", "spellcheck", "autocorrect", "typos", "prediction", "autocomplete", "next word", "tab", "language", "english", "british", "american"]),
        card("writing", "Your dictionary", ["dictionary", "add to dictionary", "learn word", "words"]),
        card("writing", "Ignored words", ["ignore", "ignored", "words"]),
        // Notifications
        card("notifications", "Notifications", ["bell", "email", "mentions", "comments", "replies", "reminders", "in app"]),
        card("notifications", "Notifications on this Mac", ["mac notifications", "desktop"], anchor: "notifications-device"),
        card("notifications", "Email delivery", ["digest", "daily", "comment emails"]),
        // Offline & sync
        card("sync", "This \(ThisDevice.noun)", ["offline", "storage", "download", "keep all notes", "cache", "space used", "remove copy"]),
        row("sync", "Keep all notes on this Mac", ["offline", "download"]),
        // Library (a library's)
        card("library", "Where your library is", ["location", "folder", "sync now", "move library", "icloud", "dropbox", "google drive", "onedrive"]),
        card("library", "Devices", ["synced", "devices"], anchor: "Devices"),
        card("library", "Library health", ["problems", "conflicts", "fix"]),
        card("library", "Passphrase", ["encrypt", "encryption", "password"]),
        card("library", "App lock", ["lock", "touch id", "password", "ask again"]),
        card("library", "Folevi account", ["sign in", "account", "share"]),
        card("library", "Remove library", ["forget", "remove", "delete"], anchor: "forget"),
        // Import & export
        card("data", "Import", ["import", "markdown", "notion", "evernote", "obsidian", "word", "docx", "html", "csv", "zip", "folder"], anchor: "import"),
        card("data", "Takeout", ["takeout", "backup", "everything", "move account"]),
        card("data", "Export", ["export", "zip", "download", "backup", "markdown"], anchor: "export"),
        // About
        card("about", "Version", ["version", "what's new", "changelog", "privacy policy", "terms", "status", "security"], anchor: "about"),
        // The workspace's
        card("workspace", "Workspace", ["name", "rename", "workspace"]),
        card("workspace", "Leave workspace", ["leave", "quit"]),
        card("workspace", "Delete workspace", ["delete", "remove"]),
        card("members", "Invite people", ["invite", "email", "add member", "team"]),
        card("members", "Members", ["people", "roles", "admin", "owner", "team"]),
        card("members", "Invitations", ["pending", "invites", "revoke"]),
        card("workspace-privacy", "End-to-end encryption", ["e2ee", "encrypt", "lock", "private"]),
        card("workspace-guests", "Guests", ["guests", "outside", "share", "make member"]),
        card("workspace-billing", "Workspace plan", ["plan", "billing", "seats", "subscription"]),
        card("workspace-data", "Import", ["import", "markdown", "notion", "evernote", "obsidian"], anchor: "import"),
        card("workspace-data", "Export", ["export", "zip", "download", "backup"], anchor: "export"),
    ]

    /// The results for `query` among the categories listed (in their order), each entry once. A category whose name
    /// matches comes first among its own. Every word typed must match the label, a keyword or the category's name.
    public static func results(_ query: String, categories: [(id: String, title: String)], local: Bool, entries: [SettingsSearchEntry] = entries) -> [SettingsSearchResult] {
        let words = query.lowercased().split(whereSeparator: { $0.isWhitespace }).map(String.init)
        guard !words.isEmpty else { return [] }
        var out: [SettingsSearchResult] = []
        for c in categories {
            let name = c.title.lowercased()
            if words.allSatisfy({ name.contains($0) }) {
                out.append(SettingsSearchResult(entry: SettingsSearchEntry(section: c.id, label: c.title), category: c.title))
            }
            var seen: Set<String> = []
            for e in entries where e.section == c.id && (e.local == nil || e.local == local) {
                let hay = ([e.label.lowercased(), name] + e.keywords).joined(separator: " ")
                guard words.allSatisfy({ hay.contains($0) }), seen.insert(e.label).inserted else { continue }
                // (A word that only names the category lists the category, not each card in it.)
                if words.allSatisfy({ name.contains($0) }) { continue }
                out.append(SettingsSearchResult(entry: e, category: c.title))
            }
        }
        return out
    }
}
#endif
