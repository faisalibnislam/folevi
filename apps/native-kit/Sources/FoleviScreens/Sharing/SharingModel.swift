// Sharing a note (plan 5.11; web parity: components/doc/ShareDialog.tsx): who has access and the access mode, invite
// by email with a role, people and invitations to remove, and public links (create with expiry, password, look and
// search engines; copy once; change the look; revoke). Encrypted notes (revision 8): the link carries its key after
// "#", made on this device, or a readable copy after the person confirms (`plainCopy`). The system share sheet
// sends a link on (ShareLink).
import Foundation
import Observation
import FoleviEngine

@MainActor
@Observable
public final class SharingModel {
    public let client: EngineClient
    public let noteId: String
    public let noteTitle: String
    /// The note is in a Personal space: no workspace to share with, so no access choice (the web's wording).
    public let personal: Bool
    let feedback: ScreenFeedback
    public let sharing: ValueStore<SharingValue>

    public var email = ""
    public var role: ShareInviteArgs.Role = .editor
    public private(set) var running: Set<String> = []
    /// A link made just now: shown (and copyable) once.
    public private(set) var freshLink: String?
    public private(set) var freshLinkEncrypted = false

    // The new link's options.
    public var linkExpiry: LinkExpiry = .never
    public var linkPassword = ""
    public var linkTheme: PublicLinkCreateArgs.Theme = .note
    public var linkIndexing = false
    /// The "Publish a readable copy?" question for an encrypted note.
    public var confirmingPlainCopy = false

    public init(client: EngineClient, noteId: String, title: String, personal: Bool = false, feedback: ScreenFeedback = ScreenFeedback()) {
        self.client = client
        self.noteId = noteId
        self.noteTitle = title
        self.personal = personal
        self.feedback = feedback
        self.sharing = client.watch(.sharingGet(id: noteId))
    }

    public func stop() { sharing.cancel() }

    public var value: SharingValue? { sharing.value }
    public var title: String { "Share \u{201C}\(noteTitle.isEmpty ? "Untitled" : noteTitle)\u{201D}" }
    public var encrypted: Bool { value?.encrypted ?? false }

    /// The roles this person may give (up to `maxRole`), most access first.
    public var roles: [ShareInviteArgs.Role] {
        let all: [ShareInviteArgs.Role] = [.editor, .commenter, .viewer]
        guard let max = value?.maxRole, let i = all.firstIndex(where: { $0.rawValue == max }) else { return value?.canShare == true ? all : [] }
        return Array(all[i...])
    }

    public static func roleLabel(_ role: String) -> String {
        switch role {
        case "editor": "Can edit"
        case "commenter": "Can comment"
        default: "Can view"
        }
    }

    public func isRunning(_ key: String) -> Bool { running.contains(key) }

    // MARK: People

    public var canInvite: Bool {
        value?.canShare == true && !roles.isEmpty && SignInModel.validEmail(email.trimmingCharacters(in: .whitespaces)) && !running.contains("invite")
    }

    public func invite() async {
        let to = email.trimmingCharacters(in: .whitespacesAndNewlines)
        guard SignInModel.validEmail(to) else { return failMessage("Enter a valid email address.") }
        if !roles.contains(role), let first = roles.first { role = first }
        await run("invite") {
            let r = try await self.client.command(.sharingInvite(noteId: self.noteId, email: to, role: self.role))
            self.email = ""
            self.feedback.haptic(.success)
            self.feedback.toast(ScreenToast(r.status == "invited" ? "Invitation sent to \(to). They get access once they sign up and accept." : "Shared", tone: .success))
        }
    }

    public func remove(_ person: ShareGrant) async {
        guard person.canChange else { return }
        await run("person.\(person.profileId)") {
            _ = try await self.client.command(.sharingRevoke(noteId: self.noteId, profileId: person.profileId))
        }
    }

    public func cancel(_ invite: ShareInvite) async {
        await run("invite.\(invite.id)") {
            _ = try await self.client.command(.sharingCancelInvite(inviteId: invite.id))
            self.feedback.toast(ScreenToast("Invitation revoked", tone: .success))
        }
    }

    public func setAccess(_ mode: AccessModeArgs.Mode) async {
        guard value?.accessMode != mode.rawValue else { return }
        feedback.haptic(.selection)
        await run("access") { _ = try await self.client.command(.sharingSetAccessMode(noteId: self.noteId, mode: mode)) }
    }

    // MARK: Public links

    public enum LinkExpiry: String, CaseIterable, Sendable {
        case never, day, week, month

        public var label: String {
            switch self {
            case .never: "No expiry"
            case .day: "In 1 day"
            case .week: "In 7 days"
            case .month: "In 30 days"
            }
        }

        func date(from now: Date) -> Double? {
            let days: Double
            switch self {
            case .never: return nil
            case .day: days = 1
            case .week: days = 7
            case .month: days = 30
            }
            return (now.timeIntervalSince1970 + days * 86_400) * 1000
        }
    }

    public static let themes: [(id: PublicLinkCreateArgs.Theme, name: String, hint: String)] = [
        (.note, "Note", "The note\u{2019}s own style"),
        (.article, "Article", "Serif and narrow, for reading"),
        (.docs, "Docs", "Wide, with contents beside it"),
        (.minimal, "Minimal", "Plain paper, no cover"),
    ]

    public static func themeName(_ id: String) -> String { themes.first { $0.id.rawValue == id }?.name ?? "Note" }

    public var activeLinks: [PublicLinkRow] { value?.links ?? [] }

    /// Makes the link. An encrypted note's is made on this device with its key in the fragment; `plainCopy` makes a
    /// readable copy instead (asked first).
    public func createLink(plainCopy: Bool = false) async {
        if !linkPassword.isEmpty && linkPassword.count < 5 { return failMessage("Use a password of at least 5 characters.") }
        let enc = encrypted
        await run("link") {
            let r = try await self.client.command(.publicLinkCreate(
                noteId: self.noteId,
                expiresAt: self.linkExpiry.date(from: ScreenClock.now()),
                password: self.linkPassword.isEmpty ? nil : self.linkPassword,
                allowIndexing: self.linkPassword.isEmpty && self.linkIndexing ? true : nil,
                theme: self.linkTheme,
                plainCopy: plainCopy ? true : nil
            ))
            self.freshLink = r.url
            self.freshLinkEncrypted = enc && !plainCopy
            self.linkPassword = ""
            self.confirmingPlainCopy = false
            self.feedback.haptic(.success)
        }
    }

    public func copyFreshLink() {
        guard let freshLink else { return }
        feedback.copy(freshLink)
        feedback.toast(ScreenToast("Link copied", tone: .success))
    }

    public func dismissFreshLink() { freshLink = nil }

    public func setTheme(_ link: PublicLinkRow, _ theme: PublicLinkThemeArgs.Theme) async {
        guard link.theme != theme.rawValue else { return }
        await run("theme.\(link.id)") {
            _ = try await self.client.command(.publicLinkSetTheme(linkId: link.id, theme: theme))
            self.feedback.toast(ScreenToast("Look changed", tone: .success))
        }
    }

    public func revoke(_ link: PublicLinkRow) async {
        await run("revoke.\(link.id)") {
            _ = try await self.client.command(.publicLinkRevoke(linkId: link.id))
            self.feedback.toast(ScreenToast("Link revoked", tone: .success))
        }
    }

    /// "Expires 3 Nov, 14:00", "No expiry", "Expired".
    public static func expiryText(_ link: PublicLinkRow) -> String {
        if link.expired { return "Expired" }
        guard let at = link.expiresAt else { return "No expiry" }
        return "Expires \(Date(timeIntervalSince1970: at / 1000).formatted(date: .abbreviated, time: .shortened))"
    }

    // MARK: Running

    private func run(_ key: String, _ body: @escaping @MainActor () async throws -> Void) async {
        guard !running.contains(key) else { return }
        running.insert(key)
        defer { running.remove(key) }
        do {
            try await body()
        } catch let f as EngineFailure {
            failMessage(f.message)
        } catch {
            failMessage("That didn't work. Try again.")
        }
    }

    private func failMessage(_ message: String) {
        feedback.toast(ScreenToast(message, tone: .error))
        feedback.haptic(.error)
    }
}
