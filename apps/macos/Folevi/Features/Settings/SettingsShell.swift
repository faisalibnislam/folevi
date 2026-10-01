import AppKit
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

    /// The web's lucide icons, as SF Symbols.
    var systemImage: String {
        switch self {
        case .account: return "person"
        case .billing, .workspaceBilling: return "creditcard"
        case .security: return "checkmark.shield"
        case .devices: return "laptopcomputer.and.iphone"
        case .appearance: return "paintpalette"
        case .notifications: return "bell"
        case .sync: return "arrow.clockwise"
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

/// Which Settings page is open, and requests to show Settings or Help in the main window (as on the web,
/// where they are pages of the app: /settings/<section> and /help). Any window or menu can ask.
@MainActor
@Observable
final class SettingsRouter {
    static let shared = SettingsRouter()
    var section: SettingsSection = .account

    enum Route: Equatable { case settings, help, invite(String), shareInvite(String) }
    /// A page the main window should show next (it clears this once shown).
    var pending: Route?
    /// Help → Contact support: opens the support dialog once Help is showing.
    var contactSupport = false

    /// Shows Settings (on `section`, when given) in the main window, bringing it forward.
    func open(_ section: SettingsSection? = nil) {
        if let section { self.section = section }
        pending = .settings
        Self.showMainWindow()
    }

    /// Shows Help in the main window; `contact` also opens Contact support.
    func openHelp(contact: Bool = false) {
        if contact { contactSupport = true }
        pending = .help
        Self.showMainWindow()
    }

    /// The main window, brought forward (opened if it was closed).
    static func showMainWindow() {
        let main = NSApp.windows.first { ($0.identifier?.rawValue ?? "").hasPrefix("main") && ($0.isVisible || $0.isMiniaturized) }
        if let main {
            if main.isMiniaturized { main.deminiaturize(nil) }
            main.makeKeyAndOrderFront(nil)
            NSApp.activate()
        } else {
            OpenWindowBridge.shared.open?("main")
        }
    }
}

/// `openSettings()` for views that show Settings: it opens in the main window, not a separate one.
struct OpenFoleviSettingsAction {
    @MainActor func callAsFunction() { SettingsRouter.shared.open() }
}

extension EnvironmentValues {
    @Entry var openFoleviSettings = OpenFoleviSettingsAction()
}

/// Settings, a page of the main window as on the web (`SettingsView`): a column of sections ("You" and,
/// in a workspace, the workspace's own group by role) beside the open page, centred in up to 1024 pt.
struct SettingsRoot: View {
    @Environment(AppModel.self) private var app
    @State private var router = SettingsRouter.shared
    @State private var newWorkspace = false
    @State private var scrollY: CGFloat = 0

    private var section: SettingsSection { router.section }
    /// A workspace page opened in Personal (a bookmark, or right after leaving a workspace).
    private var noWorkspace: Bool { section.audience != .you && app.workspace == nil }
    /// A workspace page this role can't use: the page doesn't exist for them.
    private var sectionHidden: Bool { app.workspace != nil && section.audience != .you && !section.isAllowed(in: app.workspace) }

    private var heading: String {
        noWorkspace ? String(localized: "Workspace") : sectionHidden ? String(localized: "Not found") : section.heading
    }

    var body: some View {
        ScrollView {
            HStack(alignment: .top, spacing: 40) {
                nav
                    .frame(width: 216, alignment: .topLeading)
                    // Sticky, as on the web (md:sticky top-[76px]): it stays in view while the page scrolls.
                    .offset(y: max(0, scrollY - 8))
                    .zIndex(1)
                VStack(alignment: .leading, spacing: 20) {
                    Text(heading)
                        .font(FoleviType.display(34))
                        .tracking(FoleviType.displayTracking(34))
                        .foregroundStyle(FoleviColor.heading)
                        .accessibilityAddTraits(.isHeader)
                        .accessibilityIdentifier("settings.heading")
                    page
                        .id(section.rawValue + (app.workspace?.id ?? ""))
                }
                .frame(maxWidth: .infinity, alignment: .topLeading)
            }
            .frame(maxWidth: 1024, alignment: .topLeading)
            .padding(.horizontal, 32)
            .padding(.top, 24)
            .padding(.bottom, 96)
            .frame(maxWidth: .infinity)
        }
        .scrollContentBackground(.hidden)
        .onScrollGeometryChange(for: CGFloat.self, of: { $0.contentOffset.y + $0.contentInsets.top }) { _, y in scrollY = y }
        .sheet(isPresented: $newWorkspace, onDismiss: {
            // Created: its settings open next, as on the web.
            if app.workspace != nil { router.section = .workspace }
        }) { NewWorkspaceSheet().environment(app) }
    }

    private var nav: some View {
        VStack(alignment: .leading, spacing: 20) {
            group(String(localized: "You"), SettingsSection.you)
            if let w = app.workspace {
                group(w.name, SettingsSection.workspaceItems.filter { $0.isAllowed(in: w) })
            } else {
                createWorkspaceNudge
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Settings sections"))
    }

    private func group(_ label: String, _ items: [SettingsSection]) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label.uppercased())
                .font(.ui(11, .semibold))
                .tracking(0.77)
                .foregroundStyle(FoleviColor.inkFaint)
                .lineLimit(1)
                .truncationMode(.tail)
                .padding(.horizontal, 10)
                .padding(.bottom, 4)
                .accessibilityAddTraits(.isHeader)
            ForEach(items) { item in
                SettingsNavRow(item: item, isActive: section == item) { router.section = item }
                    .accessibilityIdentifier("settings.section.\(item.rawValue)")
            }
        }
    }

    /// Where the Workspace group would be, in Personal: a small way to start one.
    private var createWorkspaceNudge: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("WORKSPACE").font(.ui(11, .semibold)).tracking(0.77).foregroundStyle(FoleviColor.inkFaint)
            Text("Work with a team: shared notes, folders and tasks, with its own plan and members.")
                .font(.ui(12.5)).foregroundStyle(FoleviColor.inkMuted)
                .frame(maxWidth: 208, alignment: .leading)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 4)
            Button { newWorkspace = true } label: { Label("Create a workspace", systemImage: "plus") }
                .buttonStyle(.folevi(.secondary, .small))
                .padding(.top, 8)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(FoleviColor.line))
        .padding(.top, 4)
    }

    @ViewBuilder private var page: some View {
        if noWorkspace {
            NoWorkspaceCard()
        } else if sectionHidden {
            SettingsCard(title: String(localized: "This page isn't available")) {
                Text(section == .workspaceBilling
                     ? String(localized: "There's nothing here for you. Switch to Personal to see your own plan and billing.")
                     : String(localized: "Only this workspace's owner and admins can open this page."))
                    .font(.ui(14)).foregroundStyle(FoleviColor.ink)
                    .fixedSize(horizontal: false, vertical: true)
            }
        } else {
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
}

/// A section in Settings' column (the web's AppLink row): 32 pt, a 16 pt icon, 13.5 pt label; the open one
/// sits on the active glass with its edge.
private struct SettingsNavRow: View {
    var item: SettingsSection
    var isActive: Bool
    var action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Image(systemName: item.systemImage)
                    .font(.system(size: 14, weight: .regular))
                    .foregroundStyle(isActive || hovering ? FoleviColor.heading : FoleviColor.inkMuted)
                    .frame(width: 16)
                    .accessibilityHidden(true)
                Text(item.title)
                    .font(.ui(13.5, isActive ? .semibold : .regular))
                    .foregroundStyle(isActive || hovering ? FoleviColor.heading : FoleviColor.ink.opacity(0.9))
                    .lineLimit(1)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 10)
            .frame(height: 32)
            .background {
                let shape = RoundedRectangle(cornerRadius: 6, style: .continuous)
                if isActive {
                    shape.fill(FoleviGlass.active)
                        .overlay(shape.strokeBorder(Color.black.opacity(0.06), lineWidth: 1))
                        .shadow(color: .black.opacity(0.06), radius: 1.5, y: 1)
                } else {
                    shape.fill(hovering ? FoleviGlass.hover : .clear)
                }
            }
            .contentShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .animation(.easeOut(duration: 0.15), value: hovering)
        .accessibilityAddTraits(isActive ? .isSelected : [])
    }
}

/// A workspace page opened in Personal: Personal has none, so say how to reach one.
private struct NoWorkspaceCard: View {
    @Environment(AppModel.self) private var app
    @State private var open = false

    var body: some View {
        SettingsCard(title: String(localized: "You're in Personal"),
                     description: String(localized: "Personal is just yours: it has no members or workspace settings. Switch to a workspace from the menu at the bottom of the sidebar, or create one for your team.")) {
            Button { open = true } label: { Label("Create a workspace", systemImage: "plus") }
                .buttonStyle(.folevi(.primary, .medium))
        }
        .sheet(isPresented: $open, onDismiss: {
            if app.workspace != nil { SettingsRouter.shared.section = .workspace }
        }) { NewWorkspaceSheet().environment(app) }
    }
}

// MARK: - Building blocks

/// A settings page's cards, 20 pt apart (the web's `space-y-5`). Settings scrolls as one page.
struct SettingsPage<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 20) { content }
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// One card of a settings page (the web's Card: `ui-card rounded-[8px] p-5`): a 17 pt serif title, an
/// optional 14 pt muted description, then the content 16 pt below.
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
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
            if let description {
                Text(description)
                    .font(.ui(14))
                    .foregroundStyle(FoleviColor.inkMuted)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 4)
            }
            content.padding(.top, 16)
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .foleviCard(radius: FoleviRadius.card)
        .accessibilityElement(children: .contain)
    }
}

/// A list inside a card: rows separated by hairlines, in a bordered box (`divide-y divide-line rounded-[8px]
/// border border-line`).
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

/// A switch as on the web (the web's Switch look, no visible label of its own).
struct SettingsSwitch: View {
    var label: String
    var hint: String? = nil
    @Binding var isOn: Bool

    var body: some View {
        FoleviToggleSwitch(isOn: $isOn, label: label, hint: hint)
    }
}

/// A small pill: "This device" (`ui-chip bg-moss-soft text-moss-ink`), or an outlined access chip on a
/// member ("Can comment", "View only": `rounded-full border border-line text-[11px]`).
struct SettingsChip: View {
    enum Tone { case moss, outline }
    var text: String
    var tone: Tone = .outline

    var body: some View {
        switch tone {
        case .moss:
            Text(text)
                .font(.ui(11.5, .medium))
                .foregroundStyle(FoleviColor.mossInk)
                .padding(.horizontal, 10)
                .frame(height: 24)
                .background(FoleviColor.mossSoft, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
        case .outline:
            Text(text)
                .font(.ui(11, .medium))
                .foregroundStyle(FoleviColor.inkMuted)
                .padding(.horizontal, 6)
                .padding(.vertical, 1)
                .overlay(Capsule().strokeBorder(FoleviColor.line))
        }
    }
}

/// "Shown when you're online" for pages that read from the server.
struct OfflineNote: View {
    var text: String = String(localized: "This is shown when you're online.")
    var body: some View {
        Text(text).font(.ui(14)).foregroundStyle(FoleviColor.inkMuted)
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
