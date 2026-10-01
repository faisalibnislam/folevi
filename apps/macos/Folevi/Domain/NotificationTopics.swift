import Foundation

/// What a person can be notified about (Settings → Notifications on the web), in the app (the bell) and
/// by email. Replies and access changes follow comments and shares until they're set on their own.
public enum NotificationTopic: String, CaseIterable, Identifiable, Sendable {
    case comments, replies, mentions, shares, access

    public var id: String { rawValue }

    public var label: String {
        switch self {
        case .comments: return String(localized: "Comments")
        case .replies: return String(localized: "Replies")
        case .mentions: return String(localized: "Mentions")
        case .shares: return String(localized: "Shares and invitations")
        case .access: return String(localized: "Access changes")
        }
    }

    public var hint: String {
        switch self {
        case .comments: return String(localized: "On notes you created or follow")
        case .replies: return String(localized: "In comment threads you took part in")
        case .mentions: return String(localized: "When someone @mentions you in a note or a comment")
        case .shares: return String(localized: "Pages shared with you and workspace invitations")
        case .access: return String(localized: "When your access to a page or workspace changes")
        }
    }
}

extension NotificationPrefs {
    /// Whether the email switch for a topic is on.
    func email(_ topic: NotificationTopic) -> Bool {
        switch topic {
        case .comments: return comments
        case .replies: return replies ?? comments
        case .mentions: return mentions
        case .shares: return shares && invites
        case .access: return access ?? shares
        }
    }

    /// The prefs with a topic's email switched (shares and invitations go together).
    func settingEmail(_ topic: NotificationTopic, _ on: Bool) -> NotificationPrefs {
        var p = self
        switch topic {
        case .comments: p.comments = on
        case .replies: p.replies = on
        case .mentions: p.mentions = on
        case .shares:
            p.shares = on
            p.invites = on
        case .access: p.access = on
        }
        return p
    }

    /// Whether the in-app (bell) switch for a topic is on (unset = on).
    func inAppOn(_ topic: NotificationTopic) -> Bool {
        guard let inApp else { return true }
        switch topic {
        case .comments: return inApp.comments ?? true
        case .replies: return inApp.replies ?? true
        case .mentions: return inApp.mentions ?? true
        case .shares: return inApp.shares ?? true
        case .access: return inApp.access ?? true
        }
    }

    /// The prefs with a topic's in-app switch set; every other kind is written out as it shows (as the web does).
    func settingInApp(_ topic: NotificationTopic, _ on: Bool) -> NotificationPrefs {
        var p = self
        var all = InApp(comments: inAppOn(.comments), replies: inAppOn(.replies), mentions: inAppOn(.mentions),
                        shares: inAppOn(.shares), access: inAppOn(.access))
        switch topic {
        case .comments: all.comments = on
        case .replies: all.replies = on
        case .mentions: all.mentions = on
        case .shares: all.shares = on
        case .access: all.access = on
        }
        p.inApp = all
        return p
    }

    /// "off" = as they happen, "daily" = in a daily digest.
    var dailyDigest: Bool { digest == "daily" }
}
