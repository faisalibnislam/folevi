// An invitation link opened in the app (plan 5.1; web parity: components/views/InviteView.tsx and
// ShareInviteView.tsx): who invited you to which workspace or page, and Accept (`invite.preview`,
// `invite.acceptLink`). Accepting opens the page or shows the workspace (the host does it with the result).
import SwiftUI
import Observation
import FoleviDesign
import FoleviEngine

@MainActor
@Observable
public final class InviteModel {
    public let client: EngineClient
    public let kind: InviteTokenArgs.Kind
    let token: String
    let feedback: ScreenFeedback
    public private(set) var preview: InvitePreview?
    public private(set) var loadError: String?
    public private(set) var accepting = false
    public private(set) var error: String?
    /// Called with what to open after accepting.
    @ObservationIgnored public var onAccepted: (@MainActor (InviteTokenAcceptResult) -> Void)?

    public init(client: EngineClient, kind: InviteTokenArgs.Kind, token: String, feedback: ScreenFeedback = ScreenFeedback()) {
        self.client = client
        self.kind = kind
        self.token = token
        self.feedback = feedback
    }

    public func load() async {
        do {
            preview = try await client.query(.invitePreview(kind: kind, token: token))
        } catch let f as EngineFailure {
            loadError = f.message
        } catch {
            loadError = "Folevi couldn't check this invitation. Try again."
        }
    }

    public var title: String {
        guard let p = preview else { return loadError == nil ? "Checking your invitation…" : "Invitation" }
        if !p.valid { return "This invitation is no longer valid" }
        if p.kind == .workspace { return "Join \(p.name ?? "the workspace")" }
        return p.name ?? "A page was shared with you"
    }

    public var message: String {
        guard let p = preview else { return loadError ?? "" }
        if !p.valid {
            return p.kind == .page ? "It may have expired, been revoked or already been used. Ask for a new one." : "It may have expired or been revoked. Ask for a new one."
        }
        if !p.emailMatches {
            return "This invitation was sent to a different address than the one you're signed in with. Sign in with the invited address to accept it."
        }
        let who = p.inviterName ?? "Someone"
        let role = p.roleLabel.map { r in " as \("aeiou".contains(r.lowercased().first ?? "x") ? "an" : "a") \(r.lowercased())" } ?? ""
        return p.kind == .workspace ? "\(who) invited you to join\(role)." : "\(who) shared this page with you\(role)."
    }

    public var canAccept: Bool { preview?.valid == true && preview?.emailMatches == true && !accepting }

    public func accept() async {
        guard canAccept else { return }
        accepting = true
        error = nil
        defer { accepting = false }
        do {
            let r = try await client.command(.inviteAcceptLink(kind: kind, token: token))
            feedback.haptic(.success)
            onAccepted?(r)
        } catch let f as EngineFailure {
            error = f.message
            feedback.haptic(.error)
        } catch {
            self.error = "That didn't work. Try again."
        }
    }
}

public struct InviteScreen: View {
    let model: InviteModel
    let dismiss: () -> Void

    public init(model: InviteModel, dismiss: @escaping () -> Void = {}) {
        self.model = model
        self.dismiss = dismiss
    }

    public var body: some View {
        PreAppPage(title: model.title, lede: model.message, identifier: "invite") {
            if model.preview == nil && model.loadError == nil {
                ProgressView()
            }
            if let e = model.error { InlineAlert(text: e, tone: .danger) }
            if model.canAccept || model.accepting {
                PreAppButton(model.kind == .workspace ? "Accept invitation" : "Open the page", busy: model.accepting) { Task { await model.accept() } }
                    .keyboardShortcut(.defaultAction)
                    .accessibilityIdentifier("invite-accept")
            }
            PreAppButton("Not now", kind: .ghost, action: dismiss)
                .keyboardShortcut(.cancelAction)
                .accessibilityIdentifier("invite-dismiss")
        }
        .task { if model.preview == nil { await model.load() } }
    }
}
