import SwiftUI

/// The bottom of the sidebar, as on the web (WorkspaceMenu.tsx): where you are (Personal or a team
/// workspace) and you. One menu holds Personal first, then your workspaces with your role and plan in
/// each, the current workspace's people and settings, your account, help, appearance and sign out.
struct ScopeMenuButton: View {
    @Environment(AppModel.self) private var app
    @Environment(\.openSettings) private var openSettings
    @State private var open = false

    var body: some View {
        Button { open.toggle() } label: {
            HStack(spacing: 9) {
                if let w = app.workspace { WorkspaceMark(workspace: w, size: 28) } else { PersonalMark(name: app.profile?.displayName ?? "", size: 28) }
                VStack(alignment: .leading, spacing: 1) {
                    Text(app.workspace?.name ?? app.profile?.displayName ?? "")
                        .font(.ui(13, .semibold)).foregroundStyle(FoleviColor.heading).lineLimit(1)
                    Text(app.workspace == nil ? String(localized: "Personal") : app.profile?.displayName ?? "")
                        .font(.ui(11.5)).foregroundStyle(FoleviColor.inkMuted).lineLimit(1)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.up.chevron.down").font(.system(size: 10, weight: .semibold)).foregroundStyle(FoleviColor.inkFaint)
            }
            .padding(.horizontal, 6)
            .frame(height: 44)
            .background(open ? FoleviGlass.hover : .clear, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text("\(app.scopeName): Personal, workspaces and account"))
        .accessibilityIdentifier("sidebar.scope")
        .popover(isPresented: $open, arrowEdge: .top) {
            ScopeMenu(close: { open = false }, openSettings: { openSettings() })
                .environment(app)
        }
    }
}

private struct ScopeMenu: View {
    @Environment(AppModel.self) private var app
    var close: () -> Void
    var openSettings: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            item(String(localized: "Personal"), detail: personalDetail, checked: app.scope.isPersonal,
                 icon: { PersonalMark(name: app.profile?.displayName ?? "", size: 18) }) { switchTo(.personal) }
                .accessibilityIdentifier("scope.personal")
            heading(String(localized: "Workspaces"))
            ForEach(app.workspaces) { w in
                item(w.name, detail: w.roleAndPlan, checked: app.scope == .workspace(w.id), icon: { WorkspaceMark(workspace: w, size: 18) }) {
                    switchTo(.workspace(w.id))
                }
            }
            plain(String(localized: "New workspace…"), systemImage: "plus") { close(); app.showNewWorkspace = true }
            separator
            if let w = app.workspace {
                if w.canManage { plain(String(localized: "Invite people…"), systemImage: "person.badge.plus") { web("settings/members") } }
                plain(String(localized: "Members"), systemImage: "person.2") { web("settings/members") }
                plain(String(localized: "Workspace settings"), systemImage: "gearshape") { web("settings/workspace") }
                separator
            }
            plain(String(localized: "Account settings"), systemImage: "gearshape") { close(); openSettings() }
            plain(String(localized: "Plan & billing"), systemImage: "creditcard") { web("settings/billing") }
            plain(String(localized: "Help"), systemImage: "questionmark.circle") { close(); app.showHelp = true }
            plain(String(localized: "Contact support…"), systemImage: "lifepreserver") { web("help") }
            separator
            ForEach(AppearancePreference.allCases) { a in
                item(appearanceName(a), detail: nil, checked: app.appearance == a, icon: {
                    Image(systemName: a == .light ? "sun.max" : a == .dark ? "moon" : "desktopcomputer").font(.system(size: 12))
                }) { app.appearance = a }
            }
            separator
            plain(String(localized: "Sign out"), systemImage: "rectangle.portrait.and.arrow.right") {
                close()
                Task { await app.signOut() }
            }
        }
        .padding(6)
        .frame(width: 270)
        .task { await app.refreshWorkspaces() }
    }

    private var personalDetail: String {
        let name = app.profile?.displayName ?? ""
        guard let e = app.profile?.entitlements else { return name }
        let plan = e.trialing ? String(localized: "Pro AI trial · \(e.trialDaysLeft) days") : e.planName
        return "\(name) · \(plan)"
    }

    private func appearanceName(_ a: AppearancePreference) -> String {
        switch a {
        case .light: return String(localized: "Light")
        case .dark: return String(localized: "Dark")
        case .system: return String(localized: "Match system")
        }
    }

    private func switchTo(_ scope: Scope) {
        close()
        Task { await app.switchScope(scope) }
    }

    private func web(_ path: String) {
        close()
        openWebApp(path, config: app.config)
    }

    private var separator: some View {
        Rectangle().fill(FoleviColor.line).frame(height: 1).padding(.vertical, 4).padding(.horizontal, 4)
    }

    private func heading(_ text: String) -> some View {
        Text(text).font(.ui(11, .semibold)).foregroundStyle(FoleviColor.inkFaint)
            .padding(.horizontal, 8).padding(.top, 8).padding(.bottom, 2)
    }

    private func plain(_ title: String, systemImage: String, action: @escaping () -> Void) -> some View {
        item(title, detail: nil, checked: false, icon: { Image(systemName: systemImage).font(.system(size: 12)) }, action: action)
    }

    private func item<Icon: View>(_ title: String, detail: String?, checked: Bool, @ViewBuilder icon: () -> Icon, action: @escaping () -> Void) -> some View {
        MenuRow(title: title, detail: detail, checked: checked, icon: icon(), action: action)
    }
}

private struct MenuRow<Icon: View>: View {
    var title: String
    var detail: String?
    var checked: Bool
    var icon: Icon
    var action: () -> Void
    @State private var hover = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 9) {
                icon.foregroundStyle(FoleviColor.inkMuted).frame(width: 18, height: 18)
                VStack(alignment: .leading, spacing: 1) {
                    Text(title).font(.ui(13)).foregroundStyle(FoleviColor.ink).lineLimit(1)
                    if let detail { Text(detail).font(.ui(11.5)).foregroundStyle(FoleviColor.inkMuted).lineLimit(1) }
                }
                Spacer(minLength: 4)
                if checked { Image(systemName: "checkmark").font(.system(size: 11, weight: .semibold)).foregroundStyle(FoleviColor.heading) }
            }
            .padding(.horizontal, 8)
            .padding(.vertical, detail == nil ? 6 : 5)
            .background(hover ? FoleviGlass.hover : .clear, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
        .accessibilityAddTraits(checked ? .isSelected : [])
    }
}

/// Personal's mark: your initial, drawn round. Personal is you, not a workspace.
struct PersonalMark: View {
    var name: String
    var size: CGFloat
    var body: some View {
        Text(String(name.trimmingCharacters(in: .whitespaces).prefix(1)).uppercased())
            .font(.ui(size * 0.46, .semibold))
            .foregroundStyle(FoleviColor.canvas)
            .frame(width: size, height: size)
            .background(Circle().fill(FoleviColor.heading))
            .accessibilityHidden(true)
    }
}

/// A team workspace's mark: its square logo, or its initial on a tile.
struct WorkspaceMark: View {
    var workspace: WorkspaceInfo
    var size: CGFloat
    var body: some View {
        Group {
            if let url = workspace.logoUrl.flatMap(URL.init(string:)) {
                AsyncImage(url: url) { image in image.resizable().scaledToFill() } placeholder: { initial }
            } else {
                initial
            }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: size * 0.22, style: .continuous))
        .accessibilityHidden(true)
    }

    private var initial: some View {
        Text(String(workspace.name.trimmingCharacters(in: .whitespaces).prefix(1)).uppercased())
            .font(.ui(size * 0.46, .semibold))
            .foregroundStyle(FoleviColor.canvas)
            .frame(width: size, height: size)
            .background(FoleviColor.heading)
    }
}

/// "New workspace…": a name, then the new workspace opens (the web's NewWorkspaceDialog).
struct NewWorkspaceSheet: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var working = false
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("New workspace").font(FoleviType.display(20)).foregroundStyle(FoleviColor.heading).accessibilityAddTraits(.isHeader)
            Text("A shared space for a team. You'll be its owner, and you can invite people from Members.")
                .font(.ui(12.5)).foregroundStyle(FoleviColor.inkMuted).fixedSize(horizontal: false, vertical: true)
            TextField("Workspace name", text: $name).textFieldStyle(.folevi).onSubmit { create() }
                .accessibilityIdentifier("newWorkspace.name")
            if let error { Text(error).font(.ui(11.5)).foregroundStyle(FoleviColor.destructive) }
            HStack {
                Spacer()
                Button("Cancel") { dismiss() }.buttonStyle(.folevi(.quiet, .medium)).keyboardShortcut(.cancelAction)
                Button("Create workspace") { create() }.buttonStyle(.folevi(.primary, .medium)).keyboardShortcut(.defaultAction)
                    .disabled(working || name.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
        .padding(24)
        .frame(width: 380)
    }

    private func create() {
        let trimmed = name.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty, !working else { return }
        working = true
        error = nil
        Task {
            defer { working = false }
            do {
                try await app.createWorkspace(name: trimmed)
                dismiss()
            } catch {
                self.error = ConvexService.mapError(error).localizedDescription
            }
        }
    }
}
