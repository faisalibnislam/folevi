import AppKit
import SwiftUI

/// "Share" for the open note: a button that opens the Share dialog (the web's ShareDialog).
struct ShareNoteButton: View {
    var editor: EditorModel
    /// The dock's quiet icon, or the toolbar's pill.
    var style: Style = .pill
    @Environment(AppModel.self) private var app
    @State private var open = false
    @State private var hover = false

    enum Style { case pill, dock }

    var body: some View {
        Group {
            switch style {
            case .pill:
                Button { open = true } label: { Label("Share", systemImage: "square.and.arrow.up") }
                    .buttonStyle(.folevi(.secondary, .medium))
            case .dock:
                Button { open = true } label: {
                    Image(systemName: "square.and.arrow.up").font(.system(size: 13.5, weight: .medium))
                        .foregroundStyle(FoleviColor.heading)
                        .padding(.horizontal, 9)
                        .frame(height: 34)
                        .background(open ? FoleviGlass.active : hover ? FoleviGlass.hover : .clear, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                        .contentShape(Rectangle())
                }
                .buttonStyle(.chrome)
                .onHover { hover = $0 }
            }
        }
        .help(Text("Share"))
        .accessibilityLabel(Text("Share"))
        .foleviDialog(isPresented: $open) {
            SharePanel(documentId: editor.documentId, title: editor.document?.displayTitle ?? "",
                       personal: (editor.document?.workspaceId ?? "").isEmpty) { open = false }
                .environment(app)
        }
    }
}

/// The Share dialog: who can open the note and how (access mode, people and email invitations, public
/// links). What you can change follows the server: managers (access mode, links, anyone's grants), members
/// who can edit (add people, change what they added), guests (nothing). Laid out as the web's Dialog: a
/// serif title with a close button over the scrolling sections.
struct SharePanel: View {
    var documentId: String
    var title: String
    /// The page is in someone's Personal, which has no members.
    var personal: Bool
    var close: () -> Void
    @Environment(AppModel.self) private var app
    @State private var data: ShareInfo?
    @State private var failed: String?
    @State private var email = ""
    @State private var role: ShareRole = .viewer
    @State private var sending = false
    @State private var freshLink: String?
    @State private var expires: Date?
    @State private var password = ""
    @State private var contentHeight: CGFloat = 200
    /// The title row above the scrolling body.
    private let headerHeight: CGFloat = 72

    private var repo: CollaborationRepository? { app.session.map { CollaborationRepository(convex: $0.convex) } }

    /// 85% of the window's height, as the web's dialog.
    private var maxHeight: CGFloat { max(360, (NSApp.keyWindow?.frame.height ?? 800) * 0.85) }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: 12) {
                Text("Share \u{201C}\(title.isEmpty ? String(localized: "Untitled") : title)\u{201D}")
                    .font(FoleviType.display(21))
                    .tracking(FoleviType.displayTracking(21))
                    .foregroundStyle(FoleviColor.heading)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityAddTraits(.isHeader)
                IconButton(systemImage: "xmark", label: "Close", size: 32, action: dismiss)
                    .keyboardShortcut(.cancelAction)
            }
            .padding(.horizontal, 24)
            .padding(.top, 20)
            .padding(.bottom, 8)
            ScrollView {
                Group {
                    if let data {
                        content(data)
                    } else if let failed {
                        Text(failed).font(.ui(13)).foregroundStyle(FoleviColor.inkMuted)
                    } else {
                        Text("Loading…").font(.ui(13)).foregroundStyle(FoleviColor.inkMuted)
                    }
                }
                .padding(.horizontal, 24)
                .padding(.vertical, 16)
                .frame(maxWidth: .infinity, alignment: .leading)
                .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { contentHeight = $0 }
            }
            .frame(height: min(contentHeight, maxHeight - headerHeight))
        }
        .frame(width: 512)
        .frame(maxHeight: maxHeight)
        .background(FoleviColor.surfaceRaised)
        .presentationBackground(FoleviColor.surfaceRaised)
        // The sheet grows with its content once sharing has loaded (a sheet keeps its first size, so it kept
        // the "Loading…" height and cut off Public link).
        .background(SheetHeight(height: headerHeight + min(contentHeight, maxHeight - headerHeight)))
        .onExitCommand(perform: dismiss)
        .task { await watch() }
    }

    private func dismiss() {
        freshLink = nil
        close()
    }

    private func watch() async {
        guard app.sync.isOnline else {
            failed = String(localized: "Sharing is available when you're online.")
            return
        }
        while !Task.isCancelled {
            if let repo {
                do {
                    for try await value in repo.shareUpdates(documentId) { data = value }
                } catch {
                    if data == nil { failed = ConvexService.mapError(error).localizedDescription }
                }
            }
            try? await Task.sleep(for: .seconds(5))
        }
    }

    private func run(_ ok: String? = nil, _ call: @escaping @Sendable (CollaborationRepository) async throws -> Void) {
        guard let repo else { return }
        Task {
            do {
                try await call(repo)
                if let ok { app.showToast(ok) }
            } catch {
                app.showToast(ConvexService.mapError(error).localizedDescription)
            }
        }
    }

    @ViewBuilder private func content(_ d: ShareInfo) -> some View {
        VStack(alignment: .leading, spacing: 24) {
            access(d)
            people(d)
            if d.canManage { publicLinks(d) }
        }
        .font(.ui(13))
    }

    // MARK: Who has access

    private func access(_ d: ShareInfo) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            heading("Who has access")
            if personal {
                HStack(alignment: .top, spacing: 8) {
                    Image(systemName: "lock").font(.system(size: 14)).foregroundStyle(FoleviColor.inkMuted).padding(.top, 2)
                        .accessibilityHidden(true)
                    Text("This page is in a Personal space: only its owner and the people added below can open it.")
                        .font(.ui(13)).foregroundStyle(FoleviColor.inkMuted).fixedSize(horizontal: false, vertical: true)
                }
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(FoleviColor.line))
            } else {
                HStack(spacing: 8) {
                    modeCard(d, mode: "workspace", title: String(localized: "Workspace"),
                             detail: String(localized: "Everyone in this workspace, by their role"), icon: "person.2")
                    modeCard(d, mode: "restricted", title: String(localized: "Only invited people"),
                             detail: String(localized: "Owners, admins, the creator and people added below"), icon: "lock")
                }
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityElement(children: .contain)
                .accessibilityLabel(Text("Access"))
            }
        }
    }

    private func modeCard(_ d: ShareInfo, mode: String, title: String, detail: String, icon: String) -> some View {
        let on = d.accessMode == mode
        return Button {
            let documentId = self.documentId
            run { try await $0.setAccessMode(documentId, mode: mode) }
        } label: {
            HStack(alignment: .top, spacing: 8) {
                Image(systemName: icon).font(.system(size: 14)).foregroundStyle(FoleviColor.inkMuted).padding(.top, 2)
                    .frame(width: 16)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.ui(13, .medium)).foregroundStyle(FoleviColor.ink)
                    Text(detail).font(.ui(12)).foregroundStyle(FoleviColor.inkMuted).fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
            }
            .padding(12)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .background(on ? FoleviColor.accentSoft : .clear, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(on ? FoleviColor.accent : FoleviColor.line))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!d.canManage)
        .opacity(d.canManage ? 1 : 0.6)
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    // MARK: People

    private func people(_ d: ShareInfo) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            heading("People").padding(.bottom, 8)
            if d.youAreGuest {
                Text(guestNote(d)).font(.ui(12)).foregroundStyle(FoleviColor.inkMuted).fixedSize(horizontal: false, vertical: true)
                    .padding(.bottom, 12)
            }
            if d.canShare { inviteForm }
            VStack(spacing: 0) {
                if d.people.isEmpty {
                    Text(d.youAreGuest ? "It was shared with you through a page above it." : "No one has been added directly.")
                        .font(.ui(13)).foregroundStyle(FoleviColor.inkMuted)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 12).padding(.vertical, 10)
                }
                ForEach(Array(d.people.enumerated()), id: \.element.id) { i, p in
                    if i > 0 { FoleviColor.line.frame(height: 1) }
                    personRow(p)
                }
            }
            .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(FoleviColor.line))
            .padding(.top, 12)
            if !d.pendingInvites.isEmpty {
                Text("Invited by email").foleviCapsLabel().padding(.top, 16).padding(.bottom, 6)
                VStack(spacing: 0) {
                    ForEach(Array(d.pendingInvites.enumerated()), id: \.element.id) { i, invite in
                        if i > 0 { FoleviColor.line.frame(height: 1) }
                        HStack(spacing: 12) {
                            Text(invite.email).font(.ui(13)).foregroundStyle(FoleviColor.ink).lineLimit(1).truncationMode(.tail)
                                .frame(maxWidth: .infinity, alignment: .leading)
                            Text("\(ShareRole.label(invite.role)) · \(invite.expired ? String(localized: "expired") : String(localized: "waiting to accept"))")
                                .font(.ui(12)).foregroundStyle(FoleviColor.inkMuted).lineLimit(1)
                            Button("Revoke") {
                                let id = invite.id
                                run(String(localized: "Invitation revoked")) { try await $0.revokePageInvite(id) }
                            }
                            .buttonStyle(.folevi(.quiet, .small))
                        }
                        .padding(.horizontal, 12).padding(.vertical, 8)
                    }
                }
                .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(FoleviColor.line))
            }
        }
    }

    private func guestNote(_ d: ShareInfo) -> String {
        var s = String(localized: "You’re a guest on this page")
        if let by = d.sharedBy { s += ", " + String(localized: "shared with you by \(by)") }
        s += ". "
        if let owner = d.ownerName { s += String(localized: "It belongs to \(owner).") + " " }
        s += String(localized: "Only its owner and the workspace’s members can share it.")
        return s
    }

    private var inviteForm: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                TextField("name@example.com", text: $email)
                    .textFieldStyle(FoleviFieldStyle(height: 36))
                    .onSubmit(share)
                    .accessibilityLabel(Text("Email address"))
                CollabChoiceButton(options: ShareRole.allCases.map { ($0, $0.label) }, selection: $role, accessibilityLabel: "Role", height: 36)
                Button("Share", action: share)
                    .buttonStyle(.folevi(.primary, .medium))
                    .disabled(sending)
            }
            Text(personal
                 ? "Anyone with an email address: people without a Folevi account get an invitation by email."
                 : "People outside the workspace join as guests on this page only and aren’t billed. People without a Folevi account get an invitation by email.")
                .font(.ui(12)).foregroundStyle(FoleviColor.inkMuted).fixedSize(horizontal: false, vertical: true)
        }
    }

    private func share() {
        let to = email.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !to.isEmpty, !sending, let repo else { return }
        sending = true
        let documentId = self.documentId, role = self.role
        Task {
            defer { sending = false }
            do {
                let r = try await repo.grant(documentId, email: to, role: role)
                app.showToast(r.status == "invited"
                              ? String(localized: "Invitation sent to \(to). They get access once they sign up and accept.")
                              : String(localized: "Shared"))
                email = ""
            } catch {
                app.showToast(ConvexService.mapError(error).localizedDescription)
            }
        }
    }

    private func personRow(_ p: ShareInfo.Person) -> some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 6) {
                    Text(p.displayName).font(.ui(13, .medium)).foregroundStyle(FoleviColor.ink).lineLimit(1)
                    if p.isYou { Text("(you)").font(.ui(12)).foregroundStyle(FoleviColor.inkMuted) }
                    if p.guest {
                        Text("Guest").font(.ui(11, .medium)).foregroundStyle(FoleviColor.inkMuted)
                            .padding(.horizontal, 6).padding(.vertical, 1)
                            .overlay(Capsule().strokeBorder(FoleviColor.line))
                    }
                }
                if let email = p.email { Text(email).font(.ui(12)).foregroundStyle(FoleviColor.inkMuted).lineLimit(1) }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Text(ShareRole.label(p.role)).font(.ui(12)).foregroundStyle(FoleviColor.inkMuted)
            if p.canChange {
                RemovePersonButton(name: p.displayName) {
                    let documentId = self.documentId, profileId = p.profileId
                    run { try await $0.revoke(documentId, profileId: profileId) }
                }
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
    }

    // MARK: Public link

    private func publicLinks(_ d: ShareInfo) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                Image(systemName: "globe").font(.system(size: 14, weight: .medium)).foregroundStyle(FoleviColor.heading).accessibilityHidden(true)
                heading("Public link")
            }
            .padding(.bottom, 4)
            Text("Off by default. Anyone with the link can read this page (not its comments or nested pages). Links aren’t indexed by search engines and can be revoked instantly.")
                .font(.ui(12)).foregroundStyle(FoleviColor.inkMuted).fixedSize(horizontal: false, vertical: true)
            if !d.publicLinksAvailable {
                Text("Public links are temporarily turned off for Folevi.").font(.ui(12)).foregroundStyle(FoleviColor.warning).padding(.top, 8)
            }
            if let freshLink {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Copy this link now. For your security, it isn’t shown again.").font(.ui(12, .medium)).foregroundStyle(FoleviColor.ink)
                    HStack(spacing: 8) {
                        Text(freshLink).font(.mono(12)).foregroundStyle(FoleviColor.ink).lineLimit(1).truncationMode(.middle)
                            .textSelection(.enabled)
                            .padding(.horizontal, 8).frame(maxWidth: .infinity, minHeight: 36, alignment: .leading)
                            .background(FoleviGlass.hover, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(FoleviGlass.border))
                            .accessibilityLabel(Text("Public link"))
                        Button {
                            NSPasteboard.general.clearContents()
                            NSPasteboard.general.setString(freshLink, forType: .string)
                            app.showToast(String(localized: "Link copied"))
                        } label: { Label("Copy", systemImage: "doc.on.doc") }
                        .buttonStyle(.folevi(.secondary, .small))
                    }
                }
                .padding(12)
                .background(FoleviColor.successSoft, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(FoleviColor.success.opacity(0.4)))
                .padding(.top, 12)
            }
            if !d.links.isEmpty {
                VStack(spacing: 8) {
                    ForEach(d.links) { l in
                        HStack(spacing: 12) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text("…/s/\(l.tokenHint)••••••••").font(.mono(12)).foregroundStyle(FoleviColor.ink)
                                Text(linkDetail(l)).font(.ui(12)).foregroundStyle(FoleviColor.inkMuted)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            Button("Revoke") {
                                let id = l.id
                                run(String(localized: "Link revoked")) { try await $0.revokePublicLink(id) }
                            }
                            .buttonStyle(.folevi(.quiet, .small))
                            .foregroundStyle(FoleviColor.destructive)
                        }
                        .padding(.horizontal, 12).padding(.vertical, 8)
                        .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(FoleviColor.line))
                    }
                }
                .padding(.top, 12)
            }
            if d.publicLinksAvailable { linkForm.padding(.top, 12) }
        }
    }

    private func linkDetail(_ l: ShareInfo.Link) -> String {
        var s = l.expired ? String(localized: "Expired")
            : l.expiresAt.map { String(localized: "Expires \(WebFormat.dateTime($0))") }
            ?? String(localized: "No expiry")
        if l.hasPassword { s += " · " + String(localized: "Password protected") }
        s += " · " + (l.viewCount == 1 ? String(localized: "1 view") : String(localized: "\(l.viewCount) views"))
        return s
    }

    private var linkForm: some View {
        HStack(alignment: .bottom, spacing: 8) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Expires (optional)").font(.ui(12)).foregroundStyle(FoleviColor.ink)
                HStack(spacing: 2) {
                    if let expires {
                        DatePicker("Expires (optional)", selection: Binding(get: { expires }, set: { self.expires = $0 }), in: Date()...,
                                   displayedComponents: [.date, .hourAndMinute])
                            .labelsHidden()
                            .datePickerStyle(.field)
                            .font(.ui(12))
                        Spacer(minLength: 0)
                        IconButton(systemImage: "xmark", label: "No expiry", size: 22) { self.expires = nil }
                    } else {
                        Button { expires = Date().addingTimeInterval(7 * 86_400) } label: {
                            // The web's empty date-and-time input: its format hint and a calendar icon.
                            HStack(spacing: 6) {
                                Text("mm/dd/yyyy, --:-- --").font(.ui(12)).foregroundStyle(FoleviColor.inkFaint).lineLimit(1)
                                Spacer(minLength: 0)
                                Image(systemName: "calendar").font(.system(size: 12)).foregroundStyle(FoleviColor.ink)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(Text("Expires (optional)"))
                        .accessibilityHint(Text("Sets an expiry date"))
                    }
                }
                .padding(.horizontal, 8)
                .frame(height: 36)
                .foleviSurface(.color(FoleviColor.surface), shape: .rounded(6),
                               shadow: [FoleviShadowLayer(x: 0, y: 0, blur: 0, spread: 1, color: FoleviColor.line, inset: false)])
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            VStack(alignment: .leading, spacing: 4) {
                Text("Password (optional, 8+ characters)").font(.ui(12)).foregroundStyle(FoleviColor.ink)
                    .fixedSize(horizontal: false, vertical: true) // wraps like the web's label
                SecureField("", text: $password)
                    .textFieldStyle(FoleviFieldStyle(height: 36))
                    .textContentType(.newPassword)
                    .accessibilityLabel(Text("Password (optional, 8+ characters)"))
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Button("Create link", action: createLink).buttonStyle(.folevi(.secondary, .medium))
        }
    }

    private func createLink() {
        guard let repo else { return }
        if !password.isEmpty && password.count < 8 {
            app.showToast(String(localized: "Use a password of at least 8 characters."))
            return
        }
        let documentId = self.documentId, expires = self.expires, password = self.password
        Task {
            do {
                let r = try await repo.createPublicLink(documentId, expiresAt: expires, password: password.isEmpty ? nil : password)
                if let origin = app.config.appOrigin { freshLink = origin.appending(path: "s/\(r.token)").absoluteString }
                self.expires = nil
                self.password = ""
            } catch {
                app.showToast(ConvexService.mapError(error).localizedDescription)
            }
        }
    }

    private func heading(_ text: LocalizedStringKey) -> some View {
        Text(text).font(.ui(13, .semibold)).foregroundStyle(FoleviColor.heading).accessibilityAddTraits(.isHeader)
    }
}

/// The bin beside someone added to the page: faint, red on hover.
private struct RemovePersonButton: View {
    var name: String
    var action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            Image(systemName: "trash").font(.system(size: 13))
                .foregroundStyle(hovering ? FoleviColor.destructive : FoleviColor.inkFaint)
                .frame(width: 22, height: 22)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .help(Text("Remove \(name)"))
        .accessibilityLabel(Text("Remove \(name)"))
    }
}

/// Sets the sheet window's content height (sheets don't follow their content's size after they open).
struct SheetHeight: NSViewRepresentable {
    var height: CGFloat

    func makeNSView(context: Context) -> NSView { PassThroughView() }

    func updateNSView(_ view: NSView, context: Context) {
        let height = height
        DispatchQueue.main.async {
            guard let window = view.window, window.sheetParent != nil, abs(window.contentLayoutRect.height - height) > 0.5 else { return }
            let size = NSSize(width: window.contentLayoutRect.width, height: height)
            // SwiftUI pins a sheet's min and max to the size it opened at; move both with it.
            window.contentMinSize = NSSize(width: size.width, height: min(window.contentMinSize.height, height))
            window.contentMaxSize = NSSize(width: size.width, height: max(window.contentMaxSize.height, height))
            window.setContentSize(size)
        }
    }

    private final class PassThroughView: NSView {
        override func hitTest(_ point: NSPoint) -> NSView? { nil }
    }
}
