import AppKit
import SwiftUI

/// The bell at the top of the sidebar (the web's NotificationsButton): an unread badge, and a panel with
/// All / Unread, "Mark all read", and each notification (opens the note, at the thread or block).
struct NotificationsBell: View {
    @Bindable var nav: NavigationModel
    /// The note open in this window, when there is one (a link to it opens the thread right away).
    var editor: EditorModel?
    @Environment(AppModel.self) private var app
    @State private var open = false
    @State private var unread = 0

    var body: some View {
        Button { open.toggle() } label: {
            // The web's 32pt square (radius 6), Bell 16; the unread badge sits on its corner.
            Image(systemName: "bell")
                .font(.system(size: 14, weight: .regular))
                .frame(width: 32, height: 32)
                .overlay(alignment: .topTrailing) {
                    if unread > 0 {
                        Text(unread > 9 ? "9+" : "\(unread)")
                            .font(.ui(10, .semibold))
                            .monospacedDigit()
                            .foregroundStyle(.white)
                            .padding(.horizontal, 4)
                            .frame(minWidth: 16, minHeight: 16)
                            .background(Capsule().fill(FoleviColor.coral))
                            .background(Capsule().stroke(FoleviColor.sidebar, lineWidth: 4))
                            .offset(x: 2, y: -2)
                            .accessibilityHidden(true)
                    }
                }
        }
        .buttonStyle(IconButtonStyle(isActive: open))
        .help(Text("Notifications"))
        .accessibilityLabel(Text(unread == 0 ? String(localized: "Notifications") : String(localized: "Notifications, \(unread) unread")))
        .accessibilityIdentifier("sidebar.notifications")
        .foleviPopover(isPresented: $open, arrowEdge: .bottom) {
            NotificationsPanel(unread: unread, openNote: openNote, close: { open = false })
                .environment(app)
        }
        .task(id: app.session?.profileId) { await watchUnread() }
    }

    private func watchUnread() async {
        while !Task.isCancelled {
            if let session = app.session {
                let repo = CollaborationRepository(convex: session.convex)
                do {
                    for try await n in repo.unreadCountUpdates() { unread = Int(n) }
                } catch {}
            }
            try? await Task.sleep(for: .seconds(5))
        }
    }

    /// Opens the note a notification is about, at its thread or block.
    private func openNote(_ n: AppNotification) {
        guard let documentId = n.documentId else { return }
        open = false
        let target = CommentTarget(threadId: n.threadId, blockId: n.blockId)
        let wantsTarget = n.threadId != nil || n.blockId != nil
        if let editor, editor.documentId == documentId, nav.openDocumentId == documentId {
            if wantsTarget { editor.comments.open(target) }
        } else {
            if wantsTarget { NoteComments.pendingTargets[documentId] = target }
            nav.open(documentId)
        }
    }
}

private struct NotificationsPanel: View {
    var unread: Int
    var openNote: (AppNotification) -> Void
    var close: () -> Void
    @Environment(AppModel.self) private var app
    @Environment(\.openFoleviSettings) private var openSettings
    @State private var items: [AppNotification]?
    @State private var filter = "all"

    private var repo: CollaborationRepository? { app.session.map { CollaborationRepository(convex: $0.convex) } }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 4) {
                Text("Notifications").font(.ui(14, .semibold)).foregroundStyle(FoleviColor.heading).accessibilityAddTraits(.isHeader)
                Spacer()
                Button {
                    run { try await $0.markNotificationsRead(nil) }
                } label: {
                    Label("Mark all read", systemImage: "checkmark").font(.ui(12, .medium))
                }
                .buttonStyle(.folevi(.quiet, .small))
                .disabled(unread == 0)
                IconButton(systemImage: "gearshape", label: "Notification settings", size: 28) {
                    close()
                    SettingsRouter.shared.open(.notifications)
                }
            }
            .padding(.leading, 16)
            .padding(.trailing, 10)
            .padding(.top, 12)
            .padding(.bottom, 8)
            FoleviSegmented(selection: $filter, items: [
                .init(value: "all", title: "All"),
                .init(value: "unread", title: LocalizedStringKey(unread == 0 ? String(localized: "Unread") : String(localized: "Unread · \(unread > 99 ? "99+" : "\(unread)")"))),
            ], accessibilityLabel: "Show")
            .frame(width: 180)
            .padding(.horizontal, 16)
            .padding(.bottom, 8)
            FoleviColor.line.opacity(0.7).frame(height: 1)
            list
        }
        .frame(width: 380)
        .frame(maxHeight: 560)
        .task { await watch() }
    }

    @ViewBuilder private var list: some View {
        if let items {
            let shown = items.filter { filter == "all" || !$0.read }
            let groups = NotificationGroups.group(shown)
            if groups.isEmpty {
                empty(unreadOnly: filter == "unread" && !items.isEmpty)
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        ForEach(groups, id: \.label) { g in
                            Text(g.label).foleviCapsLabel().padding(.horizontal, 16).padding(.top, 12).padding(.bottom, 4)
                                .accessibilityAddTraits(.isHeader)
                            ForEach(g.rows) { n in
                                NotificationRow(n: n, onOpen: { open(n) }, run: run)
                            }
                        }
                    }
                    .padding(.horizontal, 6)
                    .padding(.bottom, 8)
                }
                .fixedSize(horizontal: false, vertical: true)
            }
        } else {
            VStack(alignment: .leading, spacing: 12) {
                ForEach([0.7, 0.9, 0.6], id: \.self) { w in
                    HStack(spacing: 12) {
                        Circle().fill(FoleviColor.surfaceSunken).frame(width: 28, height: 28)
                        RoundedRectangle(cornerRadius: 4).fill(FoleviColor.surfaceSunken).frame(width: 280 * w, height: 12)
                    }
                }
            }
            .padding(16)
            .accessibilityLabel(Text("Loading notifications"))
        }
    }

    private func empty(unreadOnly: Bool) -> some View {
        VStack(spacing: 0) {
            Image(systemName: "bell.slash").font(.system(size: 15)).foregroundStyle(FoleviColor.inkMuted)
                .frame(width: 40, height: 40).background(Circle().fill(FoleviColor.surfaceSunken))
                .padding(.bottom, 12)
                .accessibilityHidden(true)
            Text(unreadOnly ? "No unread notifications" : "You're all caught up.").font(.ui(13.5, .medium)).foregroundStyle(FoleviColor.heading)
            Text("Comments, replies, @mentions and pages shared with you show up here.")
                .font(.ui(12.5)).foregroundStyle(FoleviColor.inkMuted).multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 4)
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 32)
        .padding(.vertical, 40)
    }

    private func watch() async {
        while !Task.isCancelled {
            if let repo {
                do {
                    for try await list in repo.notificationUpdates(limit: 50) { items = list }
                } catch {
                    if items == nil { items = [] }
                }
            } else if items == nil {
                items = []
            }
            try? await Task.sleep(for: .seconds(5))
        }
    }

    private func open(_ n: AppNotification) {
        if !n.read { run { try await $0.markNotificationsRead([n.id]) } }
        openNote(n)
    }

    private func run(_ call: @escaping @Sendable (CollaborationRepository) async throws -> Void) {
        guard let repo else { return }
        Task {
            do { try await call(repo) } catch { app.showToast(ConvexService.mapError(error).localizedDescription) }
        }
    }
}

private struct NotificationRow: View {
    var n: AppNotification
    var onOpen: () -> Void
    var run: (@escaping @Sendable (CollaborationRepository) async throws -> Void) -> Void
    @Environment(AppModel.self) private var app
    @State private var hover = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                if n.documentId != nil {
                    onOpen()
                } else if !n.read {
                    let id = n.id
                    run { try await $0.markNotificationsRead([id]) }
                }
            } label: {
                HStack(alignment: .top, spacing: 12) {
                    face.padding(.top, 2)
                    VStack(alignment: .leading, spacing: 4) {
                        sentence
                            .font(.ui(13))
                            .foregroundStyle(n.read ? FoleviColor.inkMuted : FoleviColor.ink)
                            .fixedSize(horizontal: false, vertical: true)
                        if let body = n.body, !body.isEmpty {
                            Text(body).font(.ui(12.5)).foregroundStyle(FoleviColor.inkMuted).lineLimit(2)
                                .padding(.leading, 8)
                                .overlay(alignment: .leading) { FoleviColor.lineStrong.frame(width: 2) }
                        }
                        Text(CollabTime.relative(n.createdAt)).font(.ui(11.5)).foregroundStyle(FoleviColor.inkFaint)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .padding(.vertical, 10)
                .padding(.leading, 10)
                .padding(.trailing, 36)
                .background(hover ? FoleviGlass.hover : .clear, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(n.plainSentence + (n.read ? "" : String(localized: ", unread"))))
            if n.fileId != nil || (n.kind == "invite" && n.inviteId != nil) || n.pageInviteId != nil {
                HStack(spacing: 6) {
                    if let fileId = n.fileId {
                        Button("Download") { download(fileId) }.buttonStyle(.folevi(.secondary, .small))
                    }
                    if let inviteId = n.pageInviteId {
                        Button("Accept and open") { acceptPage(inviteId) }.buttonStyle(.folevi(.primary, .small))
                    }
                    if n.kind == "invite", let inviteId = n.inviteId {
                        Button("Accept invitation") { acceptWorkspace(inviteId) }.buttonStyle(.folevi(.primary, .small))
                    }
                }
                .padding(.leading, 50)
                .padding(.bottom, 10)
            }
        }
        .overlay(alignment: .topTrailing) {
            ZStack(alignment: .topTrailing) {
                if !n.read && !hover {
                    Circle().fill(FoleviColor.coral).frame(width: 8, height: 8).padding(.top, 8).padding(.trailing, 8).accessibilityHidden(true)
                }
                CollabMenuButton(label: "Options for this notification", size: 26) { menu }
                    .opacity(hover ? 1 : 0)
            }
            .padding(.top, 6)
            .padding(.trailing, 4)
        }
        .onHover { hover = $0 }
    }

    private var menu: [CollabMenuItem] {
        let id = n.id
        return [
            n.read
                ? CollabMenuItem(title: String(localized: "Mark as unread")) { run { try await $0.markNotificationsUnread([id]) } }
                : CollabMenuItem(title: String(localized: "Mark as read")) { run { try await $0.markNotificationsRead([id]) } },
            CollabMenuItem(title: String(localized: "Remove"), destructive: true) { run { try await $0.removeNotifications([id]) } },
        ]
    }

    @ViewBuilder private var face: some View {
        if let actor = n.actorName {
            CollabAvatar(name: actor, url: n.actorAvatarUrl, size: 28)
                .overlay(alignment: .bottomTrailing) {
                    Image(systemName: kindIcon).font(.system(size: 7.5, weight: .bold)).foregroundStyle(FoleviColor.inkMuted)
                        .frame(width: 16, height: 16)
                        .background(Circle().fill(FoleviColor.surfaceRaised))
                        .overlay(Circle().strokeBorder(FoleviColor.surfaceRaised, lineWidth: 1.5))
                        .offset(x: 4, y: 2)
                        .accessibilityHidden(true)
                }
        } else {
            Image(systemName: "bell").font(.system(size: 12)).foregroundStyle(FoleviColor.inkMuted)
                .frame(width: 28, height: 28).background(Circle().fill(FoleviColor.surfaceSunken))
                .accessibilityHidden(true)
        }
    }

    private var kindIcon: String {
        switch n.kind {
        case "comment", "reply": return "bubble.left"
        case "mention": return "at"
        case "share": return "square.and.arrow.up"
        case "invite": return "person.badge.plus"
        case "share_change": return "key"
        default: return "doc.text"
        }
    }

    /// Who (bold), what, and the note's name (emphasised), as on the web.
    private var sentence: Text {
        guard let s = n.sentence else { return Text(n.title) }
        var t = Text(s.actor).fontWeight(.semibold).foregroundStyle(FoleviColor.heading)
            + Text(" \(s.verb) ")
            + Text(s.documentTitle).fontWeight(.medium).foregroundStyle(FoleviColor.heading)
        if !s.trail.isEmpty { t = t + Text(" \(s.trail)") }
        return t
    }

    private func acceptPage(_ inviteId: String) {
        guard let session = app.session else { return }
        let repo = CollaborationRepository(convex: session.convex)
        Task {
            do {
                let r = try await repo.acceptPageInvite(inviteId)
                app.showToast(String(localized: "The page was added to Shared with Me."))
                app.pendingOpenDocumentId = r.documentId
            } catch {
                app.showToast(ConvexService.mapError(error).localizedDescription)
            }
        }
    }

    private func acceptWorkspace(_ inviteId: String) {
        guard let session = app.session else { return }
        let repo = CollaborationRepository(convex: session.convex)
        Task {
            do {
                try await repo.acceptWorkspaceInvite(inviteId)
                app.showToast(String(localized: "You joined the workspace."))
                await app.refreshWorkspaces()
            } catch {
                app.showToast(ConvexService.mapError(error).localizedDescription)
            }
        }
    }

    /// A file delivered to you (an export prepared at your request): signed link fetched on click.
    private func download(_ fileId: String) {
        guard let session = app.session else { return }
        Task {
            do {
                let urls = try await session.files.urls([fileId])
                guard let url = urls[fileId].flatMap({ URL(string: $0.url) }) else {
                    app.showToast(String(localized: "That download has expired."))
                    return
                }
                NSWorkspace.shared.open(url)
            } catch {
                app.showToast(ConvexService.mapError(error).localizedDescription)
            }
        }
    }
}
