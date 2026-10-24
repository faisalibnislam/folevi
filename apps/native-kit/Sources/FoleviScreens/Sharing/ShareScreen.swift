// The share sheet's content (SharingModel): iPhone and iPad present it as a sheet (medium and large detents), the
// Mac as a popover or sheet from the note's Share button. Sections follow the web's dialog: Who has access, Invite,
// People, Invited by email, Public link.
import SwiftUI
import FoleviDesign
import FoleviEngine

public struct ShareScreen: View {
    @Bindable var model: SharingModel
    let done: (() -> Void)?

    public init(model: SharingModel, done: (() -> Void)? = nil) {
        self.model = model
        self.done = done
    }

    public var body: some View {
        NavigationStack {
            Group {
                if let v = model.value {
                    form(v)
                } else if let e = model.sharing.error {
                    EmptyState(systemImage: "person.2.slash", title: "Sharing isn't available", message: e.message)
                } else {
                    ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            .navigationTitle(model.title)
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                if let done {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Done", action: done).accessibilityIdentifier("share-done")
                    }
                }
            }
        }
        .accessibilityIdentifier("share-sheet")
        .confirmationDialog("Publish a readable copy?", isPresented: $model.confirmingPlainCopy, titleVisibility: .visible) {
            Button("Publish readable copy") { Task { await model.createLink(plainCopy: true) } }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Anyone with the link can read the published copy, and Folevi stores it unencrypted. The note itself stays encrypted. The copy doesn't change when you edit the note.")
        }
    }

    @ViewBuilder private func form(_ v: SharingValue) -> some View {
        Form {
            access(v)
            if v.canShare { invite(v) }
            people(v)
            if !v.invites.isEmpty { invites(v) }
            if v.canManage { links(v) }
        }
        .formStyle(.grouped)
        .settingsBackground()
    }

    // MARK: Who has access

    @ViewBuilder private func access(_ v: SharingValue) -> some View {
        Section {
            if model.personal {
                Label { Text("This page is in a Personal space: only its owner and the people added below can open it.").foleviFont(.callout).foregroundStyle(Folevi.color.inkMuted) } icon: { Image(systemName: "lock") }
            } else {
                ForEach([("workspace", "Workspace", "Everyone in this workspace, by their role", "person.3"), ("restricted", "Only invited people", "Owners, admins, the creator and people added below", "lock")], id: \.0) { mode in
                    Button {
                        if let m = AccessModeArgs.Mode(rawValue: mode.0) { Task { await model.setAccess(m) } }
                    } label: {
                        HStack(spacing: 12) {
                            Image(systemName: mode.3).foregroundStyle(Folevi.color.heading).frame(width: 24)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(mode.1).foleviFont(.body).foregroundStyle(Folevi.color.ink)
                                Text(mode.2).foleviFont(.footnote).foregroundStyle(Folevi.color.inkMuted)
                            }
                            Spacer()
                            if v.accessMode == mode.0 { Image(systemName: "checkmark").font(.system(size: 14, weight: .semibold)).foregroundStyle(Folevi.color.accent) }
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .disabled(!v.canManage || model.isRunning("access"))
                    .accessibilityAddTraits(v.accessMode == mode.0 ? .isSelected : [])
                    .accessibilityIdentifier("share-access-\(mode.0)")
                }
            }
        } header: {
            Text("Who has access").foleviFont(.caps)
        }
    }

    // MARK: Invite

    @ViewBuilder private func invite(_ v: SharingValue) -> some View {
        Section {
            TextField("name@example.com", text: $model.email)
                .foleviFont(.body)
                .textContentType(.emailAddress)
                .autocorrectionDisabled()
                #if os(iOS)
                .keyboardType(.emailAddress)
                .textInputAutocapitalization(.never)
                #endif
                .onSubmit { Task { await model.invite() } }
                .accessibilityIdentifier("share-email")
            Picker(selection: $model.role) {
                ForEach(model.roles, id: \.self) { r in Text(SharingModel.roleLabel(r.rawValue)).tag(r) }
            } label: {
                Text("Role").foleviFont(.body)
            }
            .accessibilityIdentifier("share-role")
            Button { Task { await model.invite() } } label: {
                HStack {
                    if model.isRunning("invite") { ProgressView().controlSize(.small) }
                    Text("Invite").frame(maxWidth: .infinity)
                }
            }
            .buttonStyle(FoleviButtonStyle(.primary, size: .medium, fullWidth: true))
            .disabled(!model.canInvite)
            .accessibilityIdentifier("share-invite")
        } header: {
            Text("Invite").foleviFont(.caps)
        } footer: {
            Text(model.encrypted
                ? "They'll get the key on their devices. If they haven't set up encryption yet, they'll be asked to."
                : (model.personal ? "Anyone with an email address: people without a Folevi account get an invitation by email." : "People outside the workspace join as guests on this page only and aren't billed."))
                .foleviFont(.footnote)
        }
    }

    // MARK: People

    @ViewBuilder private func people(_ v: SharingValue) -> some View {
        Section {
            if v.people.isEmpty {
                Text(v.youAreGuest ? "It was shared with you through a page above it." : "No one has been added directly.").foleviFont(.callout).foregroundStyle(Folevi.color.inkMuted)
            }
            ForEach(v.people, id: \.profileId) { p in
                HStack(spacing: 12) {
                    Avatar(name: p.name, size: 30)
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 6) {
                            Text(p.isYou ? "\(p.name) (you)" : p.name).foleviFont(.body).foregroundStyle(Folevi.color.ink)
                            if p.guest { Text("Guest").foleviFont(.caption).foregroundStyle(Folevi.color.inkMuted).padding(.horizontal, 6).padding(.vertical, 1).background(Capsule().fill(Folevi.color.surfaceSunken)) }
                        }
                        Text([p.email, SharingModel.roleLabel(p.role)].compactMap { $0 }.joined(separator: " · ")).foleviFont(.footnote).foregroundStyle(Folevi.color.inkMuted)
                    }
                    Spacer()
                    if p.canChange {
                        Button { Task { await model.remove(p) } } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(Folevi.color.inkFaint) }
                            .buttonStyle(.plain)
                            .disabled(model.isRunning("person.\(p.profileId)"))
                            .accessibilityLabel("Remove \(p.name)")
                            .accessibilityIdentifier("share-remove-\(p.profileId)")
                    }
                }
                .accessibilityElement(children: .combine)
            }
        } header: {
            Text("People").foleviFont(.caps)
        }
    }

    @ViewBuilder private func invites(_ v: SharingValue) -> some View {
        Section {
            ForEach(v.invites, id: \.id) { i in
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(i.email).foleviFont(.body).foregroundStyle(Folevi.color.ink)
                        Text("\(SharingModel.roleLabel(i.role)) · \(i.expired ? "expired" : "waiting to accept")").foleviFont(.footnote).foregroundStyle(Folevi.color.inkMuted)
                    }
                    Spacer()
                    if v.canShare {
                        Button("Revoke") { Task { await model.cancel(i) } }
                            .buttonStyle(FoleviButtonStyle(.ghost, size: .small))
                            .disabled(model.isRunning("invite.\(i.id)"))
                            .accessibilityIdentifier("share-revoke-invite-\(i.id)")
                    }
                }
            }
        } header: {
            Text("Invited by email").foleviFont(.caps)
        }
    }

    // MARK: Public link

    @ViewBuilder private func links(_ v: SharingValue) -> some View {
        Section {
            if !v.publicLinksAvailable {
                Text("Public links are temporarily turned off for Folevi.").foleviFont(.callout).foregroundStyle(Folevi.color.warning)
            }
            if let fresh = model.freshLink {
                VStack(alignment: .leading, spacing: 8) {
                    Text(model.freshLinkEncrypted ? "Copy this whole link now, including the part after #. It isn't shown again, and Folevi can't make it again." : "Copy this link now. For your security, it isn't shown again.")
                        .foleviFont(.footnote).fontWeight(.medium).foregroundStyle(Folevi.color.ink)
                    Text(fresh).font(FoleviFonts.font(.mono, size: 13)).foregroundStyle(Folevi.color.ink).textSelection(.enabled)
                        .padding(8).frame(maxWidth: .infinity, alignment: .leading)
                        .background(RoundedRectangle(cornerRadius: Folevi.radius.chip, style: .continuous).fill(Folevi.color.surfaceSunken))
                        .accessibilityIdentifier("share-fresh-link")
                    HStack(spacing: 8) {
                        Button { model.copyFreshLink() } label: { Label("Copy link", systemImage: "doc.on.doc").frame(maxWidth: .infinity) }
                            .buttonStyle(FoleviButtonStyle(.primary, size: .medium, fullWidth: true))
                            .accessibilityIdentifier("share-copy-link")
                        if let url = URL(string: fresh) {
                            ShareLink(item: url) { Label("Share", systemImage: "square.and.arrow.up").frame(maxWidth: .infinity) }
                                .buttonStyle(FoleviButtonStyle(.secondary, size: .medium, fullWidth: true))
                                .accessibilityIdentifier("share-system-sheet")
                        }
                    }
                }
            }
            ForEach(model.activeLinks, id: \.id) { l in
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Image(systemName: l.encrypted ? "lock" : "globe").foregroundStyle(Folevi.color.inkMuted)
                        Text("…/s/\(l.tokenHint)").font(FoleviFonts.font(.mono, size: 14)).foregroundStyle(Folevi.color.ink)
                        if l.hasPassword { Image(systemName: "key").font(.system(size: 12)).foregroundStyle(Folevi.color.inkMuted).accessibilityLabel("Password") }
                        Spacer()
                        Text("\(l.viewCount) \(l.viewCount == 1 ? "view" : "views")").foleviFont(.footnote).foregroundStyle(Folevi.color.inkMuted)
                    }
                    Text(SharingModel.expiryText(l)).foleviFont(.footnote).foregroundStyle(l.expired ? Folevi.color.destructive : Folevi.color.inkMuted)
                    HStack {
                        Menu {
                            ForEach(SharingModel.themes, id: \.id) { t in
                                Button { if let th = PublicLinkThemeArgs.Theme(rawValue: t.id.rawValue) { Task { await model.setTheme(l, th) } } } label: {
                                    if l.theme == t.id.rawValue { Label(t.name, systemImage: "checkmark") } else { Text(t.name) }
                                }
                            }
                        } label: {
                            Label("Look: \(SharingModel.themeName(l.theme))", systemImage: "paintbrush").foleviFont(.callout)
                        }
                        .accessibilityIdentifier("share-link-theme-\(l.id)")
                        Spacer()
                        Button("Revoke", role: .destructive) { Task { await model.revoke(l) } }
                            .buttonStyle(FoleviButtonStyle(.ghost, size: .small))
                            .disabled(model.isRunning("revoke.\(l.id)"))
                            .accessibilityIdentifier("share-revoke-link-\(l.id)")
                    }
                }
                .padding(.vertical, 2)
            }
        } header: {
            Text("Public link").foleviFont(.caps)
        } footer: {
            Text(model.encrypted
                ? "Encrypted link: the key is in the link itself. Anyone with the whole link can read this note. Folevi can't."
                : "Off by default. Anyone with the link can read this page (not its comments or nested pages). Search engines skip it unless you let them find it, and you can revoke it instantly.")
                .foleviFont(.footnote)
        }
        if v.publicLinksAvailable { newLink(v) }
    }

    @ViewBuilder private func newLink(_ v: SharingValue) -> some View {
        Section {
            Picker(selection: $model.linkExpiry) {
                ForEach(SharingModel.LinkExpiry.allCases, id: \.self) { e in Text(e.label).tag(e) }
            } label: { Text("Expires").foleviFont(.body) }
                .accessibilityIdentifier("share-link-expiry")
            SecureField("Password (none)", text: $model.linkPassword)
                .foleviFont(.body)
                .textContentType(.newPassword)
                .accessibilityIdentifier("share-link-password")
            Picker(selection: $model.linkTheme) {
                ForEach(SharingModel.themes, id: \.id) { t in Text(t.name).tag(t.id) }
            } label: { Text("Look").foleviFont(.body) }
                .accessibilityIdentifier("share-link-look")
            if !model.encrypted {
                Toggle(isOn: $model.linkIndexing) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Let search engines find it").foleviFont(.body)
                        Text(model.linkPassword.isEmpty ? "Google and others may list the page and show its title." : "Not for a password-protected page.").foleviFont(.footnote).foregroundStyle(Folevi.color.inkMuted)
                    }
                }
                .disabled(!model.linkPassword.isEmpty)
                .accessibilityIdentifier("share-link-indexing")
            }
            Button { Task { await model.createLink() } } label: {
                HStack {
                    if model.isRunning("link") { ProgressView().controlSize(.small) }
                    Text(model.encrypted ? "Create encrypted link" : "Create public link").frame(maxWidth: .infinity)
                }
            }
            .buttonStyle(FoleviButtonStyle(.secondary, size: .medium, fullWidth: true))
            .disabled(model.isRunning("link"))
            .accessibilityIdentifier("share-create-link")
            if model.encrypted {
                Button("Publish a readable copy…") { model.confirmingPlainCopy = true }
                    .foleviFont(.callout)
                    .accessibilityIdentifier("share-plain-copy")
            }
        } header: {
            Text("New link").foleviFont(.caps)
        }
    }
}
