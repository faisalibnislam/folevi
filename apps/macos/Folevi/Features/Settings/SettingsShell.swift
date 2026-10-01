import Observation
import SwiftUI

/// A page of Settings, as on the web: things about you, and the open team workspace's own settings.
enum SettingsSection: String, CaseIterable, Identifiable, Sendable {
    case account, billing, security, devices, appearance, notifications, sync, data
    case workspace, members, workspaceGuests, workspaceBilling, workspaceData

    var id: String { rawValue }

    /// Who in a workspace sees a workspace page (the server checks every action again).
    enum Audience { case you, everyone, managers, billing }

    var audience: Audience {
        switch self {
        case .workspace, .members: return .everyone
        case .workspaceGuests, .workspaceData: return .managers
        case .workspaceBilling: return .billing
        default: return .you
        }
    }

    var title: String {
        switch self {
        case .account: return String(localized: "Account")
        case .billing, .workspaceBilling: return String(localized: "Plan & billing")
        case .security: return String(localized: "Security")
        case .devices: return String(localized: "Devices")
        case .appearance: return String(localized: "Appearance")
        case .notifications: return String(localized: "Notifications")
        case .sync: return String(localized: "Offline & sync")
        case .data, .workspaceData: return String(localized: "Import & export")
        case .workspace: return String(localized: "General")
        case .members: return String(localized: "Members")
        case .workspaceGuests: return String(localized: "Guests")
        }
    }

    /// The page heading ("General" reads "Workspace" there, as on the web).
    var heading: String { self == .workspace ? String(localized: "Workspace") : title }

    var systemImage: String {
        switch self {
        case .account: return "person.crop.circle"
        case .billing, .workspaceBilling: return "creditcard"
        case .security: return "checkmark.shield"
        case .devices: return "laptopcomputer.and.iphone"
        case .appearance: return "paintpalette"
        case .notifications: return "bell"
        case .sync: return "arrow.triangle.2.circlepath"
        case .data, .workspaceData: return "arrow.up.arrow.down"
        case .workspace: return "building.2"
        case .members: return "person.2"
        case .workspaceGuests: return "person.badge.plus"
        }
    }

    static let you: [SettingsSection] = [.account, .billing, .security, .devices, .appearance, .notifications, .sync, .data]
    static let workspaceItems: [SettingsSection] = [.workspace, .members, .workspaceGuests, .workspaceBilling, .workspaceData]

    /// Whether this role may open the page in `workspace` (nil = Personal, which has no workspace pages).
    func isAllowed(in workspace: WorkspaceInfo?) -> Bool {
        switch audience {
        case .you: return true
        case .everyone: return workspace != nil
        case .managers: return workspace?.canManage == true
        case .billing: return workspace?.canManageBilling == true
        }
    }
}

/// Which Settings page is open; other windows (the sidebar's menu) can point Settings somewhere.
@MainActor
@Observable
final class SettingsRouter {
    static let shared = SettingsRouter()
    var section: SettingsSection = .account
}

/// Settings: a sidebar with "You" and, in a workspace, the workspace's own group (by role), and the page.
struct SettingsRoot: View {
    @Environment(AppModel.self) private var app
    @State private var router = SettingsRouter.shared
    @State private var newWorkspace = false

    private var section: SettingsSection {
        router.section.isAllowed(in: app.workspace) ? router.section : .account
    }

    var body: some View {
        HStack(spacing: 0) {
            sidebar
                .frame(width: 216)
                .background(FoleviGlass.sidebar)
                .overlay(alignment: .trailing) { FoleviGlass.border.frame(width: 1) }
            VStack(alignment: .leading, spacing: 0) {
                Text(section.heading)
                    .font(FoleviType.display(30))
                    .tracking(FoleviType.displayTracking(30))
                    .foregroundStyle(FoleviColor.heading)
                    .accessibilityAddTraits(.isHeader)
                    .padding(.horizontal, 28)
                    .padding(.top, 22)
                    .padding(.bottom, 6)
                page
                    .id(section.rawValue + (app.workspace?.id ?? ""))
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
        .frame(width: 880, height: 640)
        .background(CanvasBackground())
        .sheet(isPresented: $newWorkspace) { NewWorkspaceSheet().environment(app) }
    }

    private var sidebar: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                group(String(localized: "You"), SettingsSection.you)
                if let w = app.workspace {
                    group(w.name, SettingsSection.workspaceItems.filter { $0.isAllowed(in: w) })
                } else {
                    createWorkspaceNudge
                }
            }
            .padding(.horizontal, 10)
            .padding(.top, 20)
            .padding(.bottom, 16)
        }
        .scrollIndicators(.never)
    }

    private func group(_ label: String, _ items: [SettingsSection]) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label.uppercased())
                .font(.ui(11, .semibold))
                .tracking(0.77)
                .foregroundStyle(FoleviColor.inkFaint)
                .lineLimit(1)
                .padding(.horizontal, 10)
                .padding(.bottom, 4)
                .accessibilityAddTraits(.isHeader)
            ForEach(items) { item in
                SidebarRow(title: Text(item.title), isActive: section == item) {
                    Image(systemName: item.systemImage)
                } action: {
                    router.section = item
                }
                .accessibilityIdentifier("settings.section.\(item.rawValue)")
            }
        }
    }

    /// Where the workspace group would be, in Personal: a small way to start one.
    private var createWorkspaceNudge: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("WORKSPACE").font(.ui(11, .semibold)).tracking(0.77).foregroundStyle(FoleviColor.inkFaint)
            Text("Work with a team: shared notes, folders and tasks, with its own plan and members.")
                .font(.ui(12.5)).foregroundStyle(FoleviColor.inkMuted)
                .fixedSize(horizontal: false, vertical: true)
            Button { newWorkspace = true } label: { Label("Create a workspace", systemImage: "plus") }
                .buttonStyle(.folevi(.secondary, .small))
                .padding(.top, 2)
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(FoleviColor.line))
        .padding(.horizontal, 4)
    }

    @ViewBuilder private var page: some View {
        switch section {
        case .account: AccountSettings()
        case .billing: PlanSettings()
        case .security: SecuritySettings()
        case .devices: DevicesSection()
        case .appearance: AppearanceSettings()
        case .notifications: NotificationSettings()
        case .sync: SyncSettings()
        case .data: DataSettings(scope: .personal, name: String(localized: "Personal"))
        case .workspace: WorkspaceGeneralSettings()
        case .members: MembersSettings()
        case .workspaceGuests: GuestsSettings()
        case .workspaceBilling: WorkspaceBillingLink()
        case .workspaceData:
            if let w = app.workspace { DataSettings(scope: .workspace(w.id), name: w.name) }
        }
    }
}

// MARK: - Building blocks

/// A scrolling settings page of cards.
struct SettingsPage<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) { content }
                .frame(maxWidth: 640, alignment: .leading)
                .padding(.horizontal, 28)
                .padding(.top, 14)
                .padding(.bottom, 32)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .scrollContentBackground(.hidden)
    }
}

/// One card of a settings page (the web's Card): a serif title, an optional description, then content.
struct SettingsCard<Content: View>: View {
    var title: String
    var description: String? = nil
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(title)
                .font(FoleviType.display(17))
                .tracking(FoleviType.displayTracking(17))
                .foregroundStyle(FoleviColor.heading)
                .accessibilityAddTraits(.isHeader)
            if let description {
                Text(description)
                    .font(.ui(13))
                    .foregroundStyle(FoleviColor.inkMuted)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 4)
            }
            content.padding(.top, 14)
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .foleviCard(radius: 12)
    }
}

/// A list inside a card: rows separated by hairlines, in a bordered box.
struct SettingsList<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Group(subviews: content) { subviews in
                ForEach(Array(subviews.enumerated()), id: \.offset) { i, view in
                    if i > 0 { FoleviColor.line.frame(height: 1) }
                    view
                }
            }
        }
        .background(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(FoleviColor.line))
    }
}

/// A switch as on the web (a small toggle, no label of its own).
struct SettingsSwitch: View {
    var label: String
    @Binding var isOn: Bool

    var body: some View {
        Toggle(label, isOn: $isOn)
            .toggleStyle(.switch)
            .labelsHidden()
            .controlSize(.small)
            .tint(FoleviColor.heading)
            .accessibilityLabel(Text(label))
    }
}

/// A small pill (This device, Can comment…).
struct SettingsChip: View {
    var text: String
    var body: some View {
        Text(text)
            .font(.ui(11, .semibold))
            .foregroundStyle(FoleviColor.inkMuted)
            .padding(.horizontal, 7)
            .padding(.vertical, 2)
            .background(FoleviGlass.hover, in: Capsule())
    }
}

/// "Shown when you're online" for pages that read from the server.
struct OfflineNote: View {
    var text: String = String(localized: "This is shown when you're online.")
    var body: some View {
        Text(text).font(.ui(13)).foregroundStyle(FoleviColor.inkMuted)
    }
}

extension AppModel {
    /// Runs an online-only settings change; reports success with `done` and failures with their message.
    func settingsAction(_ done: String?, _ action: @escaping @Sendable (SessionContext) async throws -> Void) {
        guard let session else { return }
        guard sync.isOnline else {
            showToast(String(localized: "This needs a connection. Try again when you're back online."))
            return
        }
        Task {
            do {
                try await action(session)
                if let done { showToast(done) }
            } catch {
                showToast(ConvexService.mapError(error).localizedDescription)
            }
        }
    }
}
