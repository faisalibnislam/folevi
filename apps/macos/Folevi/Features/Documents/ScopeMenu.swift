import SwiftUI

/// The bottom of the sidebar, as on the web (WorkspaceMenu.tsx): the plan pill (trial days left, or an
/// upgrade nudge on Free, in Personal only) and the workspace menu.
struct WorkspaceFooter: View {
    @Environment(AppModel.self) private var app
    @Environment(\.openSettings) private var openSettings

    var body: some View {
        VStack(spacing: 6) {
            if let pill = planPill {
                PlanPill(text: pill.text, trailing: pill.trailing) {
                    SettingsRouter.shared.section = .billing
                    openSettings()
                }
            }
            ScopeMenuButton()
        }
    }

    /// Personal plan: trial days left, or "Upgrade to Pro" on Free; nothing once they're paying. Only in
    /// Personal, since a Personal plan doesn't change what a team workspace includes.
    private var planPill: (text: String, trailing: String)? {
        guard app.scope.isPersonal, let e = app.profile?.entitlements else { return nil }
        if e.trialing {
            let days = e.trialDaysLeft
            let text = days == 1 ? String(localized: "Pro AI trial · 1 day left") : String(localized: "Pro AI trial · \(days) days left")
            return (text, String(localized: "Choose plan"))
        }
        if e.paid == false || (e.paid == nil && e.paidPlan == "free") {
            return (String(localized: "Upgrade to Pro"), String(localized: "See plans"))
        }
        return nil
    }
}

/// The plan pill: a soft violet-to-pink wash with the AI mark.
private struct PlanPill: View {
    var text: String
    var trailing: String
    var action: () -> Void
    @State private var hover = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                AiIcon(size: 13)
                Text(text).font(.ui(12.5, .medium)).foregroundStyle(FoleviColor.heading).lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Text(trailing).font(.ui(11.5)).foregroundStyle(FoleviColor.inkMuted)
            }
            .padding(.horizontal, 10)
            .frame(height: 32)
            .background {
                let shape = RoundedRectangle(cornerRadius: 8, style: .continuous)
                shape.fill(LinearGradient(colors: [Color(red: 0.545, green: 0.486, blue: 0.965).opacity(0.14),
                                                   Color(red: 0.961, green: 0.541, blue: 0.722).opacity(0.12)],
                                          startPoint: .leading, endPoint: .trailing))
                    .overlay(shape.strokeBorder(FoleviGlass.border, lineWidth: 1))
            }
            .brightness(hover ? 0.015 : 0)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
    }
}

/// Where you are (Personal or a team workspace) and you. One menu holds Personal first, then your workspaces
/// with your role and plan in each, "New workspace…", the current workspace's people and settings, your
/// account, help, appearance and sign out.
struct ScopeMenuButton: View {
    @Environment(AppModel.self) private var app
    @Environment(\.openSettings) private var openSettings
    @State private var open = false
    @State private var hover = false
    @State private var creating = false
    @State private var inviting = false

    var body: some View {
        Button { open.toggle() } label: {
            HStack(spacing: 10) {
                if let w = app.workspace { WorkspaceMark(workspace: w, size: 28) } else { PersonalMark(name: app.profile?.displayName ?? "", url: app.profile?.avatarUrl, size: 28) }
                VStack(alignment: .leading, spacing: 1) {
                    Text(app.workspace?.name ?? app.profile?.displayName ?? "")
                        .font(.ui(13.5, .semibold)).foregroundStyle(FoleviColor.heading).lineLimit(1)
                    Text(app.workspace == nil ? String(localized: "Personal") : app.profile?.displayName ?? "")
                        .font(.ui(11.5)).foregroundStyle(FoleviColor.inkMuted).lineLimit(1)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                Image(systemName: "chevron.up.chevron.down").font(.system(size: 10.5, weight: .semibold)).foregroundStyle(FoleviColor.inkFaint)
            }
            .padding(.horizontal, 8)
            .frame(height: 48)
            .background(open || hover ? FoleviColor.accentSoft.opacity(0.75) : .clear, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
        .accessibilityLabel(Text("\(app.workspace?.name ?? String(localized: "Personal")): Personal, workspaces and account"))
        .accessibilityIdentifier("sidebar.scope")
        .foleviPopover(isPresented: $open, arrowEdge: .top) {
            FoleviMenuList(entries: entries(), width: 256) { open = false }
                .task { await app.refreshWorkspaces() }
        }
        .sheet(isPresented: $creating) { NewWorkspaceDialog().environment(app) }
        .sheet(isPresented: $inviting) {
            if let w = app.workspace { InviteDialog(workspace: w).environment(app) }
        }
    }

    private func entries() -> [FoleviMenuEntry] {
        var out: [FoleviMenuEntry] = [
            .item(FoleviMenuItem(String(localized: "Personal"), icon: PersonalMark(name: app.profile?.displayName ?? "", url: app.profile?.avatarUrl, size: 18),
                                 description: personalDetail, checked: app.scope.isPersonal) { switchTo(.personal) }),
            .heading(String(localized: "Workspaces")),
        ]
        for w in app.workspaces {
            out.append(.item(FoleviMenuItem(w.name, icon: WorkspaceMark(workspace: w, size: 18), description: w.roleAndPlan,
                                            checked: app.scope == .workspace(w.id)) { switchTo(.workspace(w.id)) }))
        }
        out.append(.item(FoleviMenuItem(String(localized: "New workspace…"), systemImage: "plus") { creating = true }))
        out.append(.separator)
        // People and settings of the current workspace. Personal has no members: pages are shared one by one.
        if let w = app.workspace {
            if w.canManage { out.append(.item(FoleviMenuItem(String(localized: "Invite people…"), systemImage: "person.badge.plus") { inviting = true })) }
            out.append(.item(FoleviMenuItem(String(localized: "Members"), systemImage: "person.2") { settings(.members) }))
            out.append(.item(FoleviMenuItem(String(localized: "Workspace settings"), systemImage: "gearshape") { settings(.workspace) }))
            out.append(.separator)
        }
        out += [
            .item(FoleviMenuItem(String(localized: "Account settings"), systemImage: "gearshape") { settings(.account) }),
            .item(FoleviMenuItem(String(localized: "Plan & billing"), systemImage: "creditcard") { settings(.billing) }),
            .item(FoleviMenuItem(String(localized: "Security"), systemImage: "checkmark.shield") { settings(.security) }),
            .item(FoleviMenuItem(String(localized: "Devices"), systemImage: "laptopcomputer.and.iphone") { settings(.devices) }),
            .item(FoleviMenuItem(String(localized: "Help"), systemImage: "questionmark.circle") { app.showHelp = true }),
            .item(FoleviMenuItem(String(localized: "Contact support…"), systemImage: "lifepreserver") { openWebApp("help", config: app.config) }),
        ]
        if app.profile?.platformRole != nil {
            out.append(.item(FoleviMenuItem(String(localized: "Admin console"), systemImage: "shield") { openWebApp("admin", config: app.config) }))
        }
        out.append(.separator)
        for a in [AppearancePreference.light, .dark, .system] {
            out.append(.item(FoleviMenuItem(appearanceName(a), systemImage: a == .light ? "sun.max" : a == .dark ? "moon" : "desktopcomputer",
                                            checked: app.appearance == a) { app.appearance = a }))
        }
        out.append(.separator)
        out.append(.item(FoleviMenuItem(String(localized: "Sign out"), systemImage: "rectangle.portrait.and.arrow.right") {
            Task { await app.signOut() }
        }))
        return out
    }

    private var personalDetail: String {
        let name = app.profile?.displayName ?? ""
        guard let e = app.profile?.entitlements else { return name }
        let plan: String
        if e.trialing {
            let days = e.trialDaysLeft
            plan = days == 0 ? String(localized: "Pro AI trial") : days == 1 ? String(localized: "Pro AI trial · 1 day") : String(localized: "Pro AI trial · \(days) days")
        } else {
            plan = e.planName
        }
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
        Task { await app.switchScope(scope) }
    }

    /// Opens Settings on one of its pages.
    private func settings(_ section: SettingsSection) {
        SettingsRouter.shared.section = section
        openSettings()
    }
}

/// Personal's mark: your profile picture (or your initial), drawn round. Personal is you, not a workspace.
struct PersonalMark: View {
    var name: String
    var url: String? = nil
    var size: CGFloat

    var body: some View {
        Group {
            if let url = url.flatMap(URL.init(string:)) {
                AsyncImage(url: url) { image in image.resizable().scaledToFill() } placeholder: { initial }
            } else {
                initial
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .accessibilityHidden(true)
    }

    private var initial: some View {
        Text(String(name.trimmingCharacters(in: .whitespaces).prefix(1)).uppercased())
            .font(.ui(size * 0.46, .semibold))
            .foregroundStyle(FoleviColor.canvas)
            .frame(width: size, height: size)
            .background(Circle().fill(FoleviColor.heading))
    }
}

/// A team workspace's mark: its square logo, or its initial on a tile (radius 6).
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
        .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
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

/// "New workspace…" (the web's NewWorkspaceDialog): a name, then the new workspace opens.
struct NewWorkspaceDialog: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        FoleviPromptDialog(title: String(localized: "New workspace"), label: String(localized: "Workspace name"),
                           confirmTitle: String(localized: "Create workspace")) { name in
            Task {
                do {
                    try await app.createWorkspace(name: name)
                    app.showToast(String(localized: "Created \(name)"), tone: .success)
                } catch {
                    app.showToast(ConvexService.mapError(error).localizedDescription, tone: .error)
                }
            }
        }
    }
}

/// Kept for callers that still present the old sheet.
typealias NewWorkspaceSheet = NewWorkspaceDialog
