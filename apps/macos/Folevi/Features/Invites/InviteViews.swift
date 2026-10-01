import SwiftUI

// The web's /invite/<token> (join a workspace) and /share-invite/<token> (a page shared with this address
// before it had an account), as pages of the main window. They open when such a link is opened with
// Folevi (for example dropped on its Dock icon).

/// Routes an invitation link to its page in the main window.
@MainActor
enum InviteLink {
    static func open(_ url: URL) {
        guard let kind = InviteLinkKind.parse(url) else { return }
        let router = SettingsRouter.shared
        switch kind {
        case .workspace(let token): router.pending = .invite(token)
        case .page(let token): router.pending = .shareInvite(token)
        }
        SettingsRouter.showMainWindow()
    }
}

/// workspaces:previewInvite.
struct WorkspaceInvitePreview: Decodable, Sendable {
    var valid: Bool
    var workspaceName: String?
    var inviterName: String?
    var role: String?
    var memberAccess: String?
    var emailMatches: Bool?
}

/// sharing:previewPageInvite.
struct PageInvitePreview: Decodable, Sendable {
    var valid: Bool
    var emailMatches: Bool?
    var inviterName: String?
    var title: String?
    var roleLabel: String?
}

private struct AcceptedWorkspaceInvite: Decodable, Sendable { var workspaceId: String }
private struct AcceptedPageInviteResult: Decodable, Sendable { var documentId: String }

/// The column the web's invitation pages use: 448 pt, centred, 80 pt from the top.
private struct InviteColumn<Content: View>: View {
    @ViewBuilder var content: Content
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) { content }
                .frame(maxWidth: 448, alignment: .leading)
                .padding(.horizontal, 24)
                .padding(.vertical, 80)
                .frame(maxWidth: .infinity)
        }
        .scrollContentBackground(.hidden)
    }
}

private struct InviteHeading: View {
    var text: String
    var body: some View {
        Text(text)
            .font(FoleviType.display(30))
            .tracking(FoleviType.displayTracking(30))
            .foregroundStyle(FoleviColor.heading)
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityAddTraits(.isHeader)
    }
}

/// The warning box (`border-warning/30 bg-warning-soft rounded-[6px] p-3 text-sm`).
private struct WarningBox: View {
    var text: String
    var body: some View {
        Text(text)
            .font(.ui(14))
            .foregroundStyle(FoleviColor.ink)
            .fixedSize(horizontal: false, vertical: true)
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background {
                let shape = RoundedRectangle(cornerRadius: 6, style: .continuous)
                shape.fill(FoleviColor.warningSoft).overlay(shape.strokeBorder(FoleviColor.warning.opacity(0.3)))
            }
    }
}

/// Join a workspace from an invitation.
struct InviteView: View {
    let token: String
    var nav: NavigationModel
    @Environment(AppModel.self) private var app
    @State private var preview: WorkspaceInvitePreview?
    @State private var error: String?
    @State private var busy = false

    var body: some View {
        InviteColumn {
            if let preview {
                if !preview.valid {
                    InviteHeading(text: String(localized: "This invitation is no longer valid"))
                    Text("It may have expired or been revoked. Ask for a new one.").font(.ui(16)).foregroundStyle(FoleviColor.inkMuted).padding(.top, 8)
                } else {
                    InviteHeading(text: String(localized: "Join \(preview.workspaceName ?? "")"))
                    Text("\(preview.inviterName ?? String(localized: "Someone")) invited you to join as \(roleWords(preview)).")
                        .font(.ui(16)).foregroundStyle(FoleviColor.inkMuted).padding(.top, 8)
                        .fixedSize(horizontal: false, vertical: true)
                    if preview.emailMatches == false {
                        WarningBox(text: String(localized: "This invitation was sent to a different address than the one you’re signed in with (\(app.profile?.email ?? "")). Sign in with the invited address to accept it."))
                            .padding(.top, 16)
                    } else {
                        Button("Accept invitation") { accept() }
                            .buttonStyle(.folevi(.primary, .medium))
                            .disabled(busy)
                            .padding(.top, 24)
                    }
                    if let error {
                        Text(error).font(.ui(14)).foregroundStyle(FoleviColor.destructive).padding(.top, 12)
                    }
                }
            } else {
                Text(app.sync.isOnline ? String(localized: "Checking your invitation…") : String(localized: "Invitations are shown when you're online."))
                    .font(.ui(16)).foregroundStyle(FoleviColor.inkMuted)
            }
        }
        .task(id: token) { await load() }
    }

    private func roleWords(_ p: WorkspaceInvitePreview) -> String {
        if p.role == "admin" { return String(localized: "an admin") }
        switch p.memberAccess {
        case "comment": return String(localized: "a member who can comment only")
        case "view": return String(localized: "a member who can view only")
        default: return String(localized: "a member")
        }
    }

    private func load() async {
        guard let session = app.session, app.sync.isOnline else { return }
        let stream: AsyncThrowingStream<WorkspaceInvitePreview, Error> = session.convex.subscribe("workspaces:previewInvite", ["token": .string(token)])
        do {
            for try await value in stream { preview = value }
        } catch {
            if preview == nil { preview = WorkspaceInvitePreview(valid: false) }
        }
    }

    private func accept() {
        guard let session = app.session else { return }
        busy = true
        error = nil
        Task {
            defer { busy = false }
            do {
                let r: AcceptedWorkspaceInvite = try await session.convex.mutation("workspaces:acceptInvite", ["token": .string(token)])
                await app.refreshWorkspaces()
                await app.switchScope(.workspace(r.workspaceId))
                nav.selection = .all
            } catch {
                self.error = ConvexService.mapError(error).localizedDescription
            }
        }
    }
}

/// A page someone shared with this address before it had a Folevi account. Accepting (signed in with that
/// verified address) gives access to that page only, as a guest.
struct ShareInviteView: View {
    let token: String
    var nav: NavigationModel
    var openDocument: (String) -> Void
    @Environment(AppModel.self) private var app
    @State private var preview: PageInvitePreview?
    @State private var error: String?
    @State private var busy = false

    var body: some View {
        InviteColumn {
            if let preview {
                if !preview.valid {
                    InviteHeading(text: String(localized: "This invitation is no longer valid"))
                    Text("It may have expired, been revoked or already been used. Ask for a new one.").font(.ui(16)).foregroundStyle(FoleviColor.inkMuted).padding(.top, 8)
                } else if preview.emailMatches == false {
                    InviteHeading(text: String(localized: "A page was shared with you"))
                    WarningBox(text: String(localized: "\(preview.inviterName ?? String(localized: "Someone")) shared a page with a different address than the one you’re signed in with (\(app.profile?.email ?? "")). Sign in with the invited address to open it."))
                        .padding(.top, 16)
                } else {
                    InviteHeading(text: preview.title ?? String(localized: "Untitled"))
                    Text("\(preview.inviterName ?? String(localized: "Someone")) shared this page with you (\((preview.roleLabel ?? "").lowercased())). You’ll see this page and the pages inside it, and nothing else of theirs.")
                        .font(.ui(16)).foregroundStyle(FoleviColor.inkMuted).padding(.top, 8)
                        .fixedSize(horizontal: false, vertical: true)
                    Button("Open the page") { accept() }
                        .buttonStyle(.folevi(.primary, .medium))
                        .disabled(busy)
                        .padding(.top, 24)
                    if let error {
                        Text(error).font(.ui(14)).foregroundStyle(FoleviColor.destructive).padding(.top, 12)
                    }
                }
            } else {
                Text(app.sync.isOnline ? String(localized: "Checking your invitation…") : String(localized: "Invitations are shown when you're online."))
                    .font(.ui(16)).foregroundStyle(FoleviColor.inkMuted)
            }
        }
        .task(id: token) { await load() }
    }

    private func load() async {
        guard let session = app.session, app.sync.isOnline else { return }
        let stream: AsyncThrowingStream<PageInvitePreview, Error> = session.convex.subscribe("sharing:previewPageInvite", ["token": .string(token)])
        do {
            for try await value in stream { preview = value }
        } catch {
            if preview == nil { preview = PageInvitePreview(valid: false) }
        }
    }

    private func accept() {
        guard let session = app.session else { return }
        busy = true
        error = nil
        Task {
            defer { busy = false }
            do {
                let r: AcceptedPageInviteResult = try await session.convex.mutation("sharing:acceptPageInvite", ["token": .string(token)])
                openDocument(r.documentId)
            } catch {
                self.error = ConvexService.mapError(error).localizedDescription
            }
        }
    }
}
