// Settings on the Mac, native and drawn as the web's (apps/web/src/components/views/SettingsView.tsx, as the Mac's
// web frame shows /settings/<section>): the sections on the left in groups (You, the open workspace's, Support),
// the open section's large title, its cards, and the version at the end. The Settings window (⌘,) shows one
// section alone under its own toolbar (`windowed`), as the web does at /settings/<section>?window=1.
//
// The sections read the engine: the views Settings already had (settings.appearance, .account, .notifications,
// .ai, .security, account.details) and `settings.query` / `settings.run` (viewsSettings.ts) for the rest.
#if os(macOS) || os(iOS)
#if os(macOS)
import AppKit
#else
import UIKit
#endif
import SwiftUI
import FoleviDesign
import FoleviEngine

/// The web's Settings sections (SettingsView.tsx `Section`).
public enum MacSettingsSection: String, CaseIterable, Sendable {
    case account, ai, billing, security, privacy, devices, connectedApps = "connected-apps", appearance, notifications, sync, library, data, desktop
    case workspace, members, workspacePrivacy = "workspace-privacy", workspaceGuests = "workspace-guests", workspaceBilling = "workspace-billing", workspaceData = "workspace-data"

    var label: String {
        switch self {
        case .account: "Account"
        case .ai: "AI"
        case .billing: "Plan & billing"
        case .security: "Security"
        case .privacy: "Privacy"
        case .devices: "Devices"
        case .connectedApps: "Connected apps"
        case .appearance: "Appearance"
        case .notifications: "Notifications"
        case .sync: "Offline & sync"
        case .library: "Library"
        case .data: "Import & export"
        case .desktop: "Desktop app"
        case .workspace: "General"
        case .members: "Members"
        case .workspacePrivacy: "Privacy"
        case .workspaceGuests: "Guests"
        case .workspaceBilling: "Plan & billing"
        case .workspaceData: "Import & export"
        }
    }

    /// The large title (the workspace's General and Privacy say so).
    var heading: String {
        switch self {
        case .workspace: "Workspace"
        case .workspacePrivacy: "Workspace privacy"
        default: label
        }
    }

    var icon: WebIcon {
        switch self {
        case .account: .userRound
        case .ai: .sparkles
        case .billing, .workspaceBilling: .creditCard
        case .security: .shieldCheck
        case .privacy, .workspacePrivacy: .lockKeyhole
        case .devices: .monitorSmartphone
        case .connectedApps: .plug
        case .appearance: .palette
        case .notifications: .bell
        case .sync: .refreshCw
        case .library: .libraryBig
        case .data, .workspaceData: .arrowDownUp
        case .desktop: .appWindowMac
        case .workspace: .buildingComplex
        case .members: .users
        case .workspaceGuests: .userRoundPlus
        }
    }

    var isWorkspace: Bool { [.workspace, .members, .workspacePrivacy, .workspaceGuests, .workspaceBilling, .workspaceData].contains(self) }

    /// Sections only an account has (local mode doesn't list them).
    var needsAccount: Bool { [.account, .billing, .security, .privacy, .devices, .connectedApps, .notifications, .sync].contains(self) || isWorkspace }

    /// A section from a web path (/settings/<section>), nil for plain /settings.
    public init?(path: String) {
        let parts = path.split(separator: "?").first.map { $0.split(separator: "/") } ?? []
        guard parts.first == "settings", parts.count >= 2, let s = MacSettingsSection(rawValue: String(parts[1])) else { return nil }
        self = s
    }
}

/// Settings' data for one window: the engine stores each section reads (started when it's first shown), and the
/// commands, with a toast for what they say and for what fails.
@MainActor
@Observable
public final class MacSettingsModel {
    public let frame: FrameModel
    var client: EngineClient { frame.client }
    @ObservationIgnored private var queries: [String: ValueStore<SettingsQueryValue>] = [:]
    @ObservationIgnored private(set) lazy var appearance: ValueStore<AppearanceSettings> = client.watch(.settingsAppearance)
    @ObservationIgnored private(set) lazy var account: ValueStore<AccountSettings> = client.watch(.settingsAccount)
    @ObservationIgnored private(set) lazy var details: ValueStore<AccountDetails> = client.watch(.accountDetails)
    @ObservationIgnored private(set) lazy var notifications: ValueStore<NotificationSettings> = client.watch(.settingsNotifications)
    @ObservationIgnored private(set) lazy var ai: ValueStore<AiSettings> = client.watch(.settingsAi)
    @ObservationIgnored private(set) lazy var security: ValueStore<SecuritySettings> = client.watch(.settingsSecurity)
    @ObservationIgnored private(set) lazy var general: ValueStore<GeneralSettings> = client.watch(.settingsGeneral)
    @ObservationIgnored private(set) lazy var storage: ValueStore<DeviceStorageValue> = client.watch(.deviceStorage)
    /// Keys of commands running now ("library.syncNow").
    var busy: Set<String> = []
    @ObservationIgnored private(set) lazy var lineBreaks = SettingsLineBreaks(client: client)

    public init(frame: FrameModel) { self.frame = frame }

    var session: SessionValue? { frame.session.value }
    var isLocal: Bool { session?.mode == .local }
    /// The open space when it's a team workspace.
    var workspace: SpaceInfo? {
        guard let s = session, let space = s.spaces.first(where: { $0.id == s.space }), space.kind == .workspace else { return nil }
        return space
    }

    /// A `settings.query` store, kept while the model lives.
    func query(_ key: SettingsQueryKey, _ args: [String: JSONValue]? = nil) -> ValueStore<SettingsQueryValue> {
        let id = "\(key.rawValue)|\(args.map { String(describing: $0) } ?? "")"
        if let s = queries[id] { return s }
        let s = client.watch(.settingsQuery(key: key, args: args))
        queries[id] = s
        return s
    }

    /// One Convex query the account's sections read (viewsSettings.ts QUERIES).
    func convex(_ fn: String, _ args: [String: JSONValue] = [:]) -> ValueStore<SettingsQueryValue> {
        query(.convex, ["fn": .string(fn), "args": .object(args)])
    }

    /// Runs a `settings.run` key; its `message` becomes a toast, a failure an error toast. Nil when it failed.
    @discardableResult
    func run(_ key: SettingsRunKey, _ args: [String: JSONValue] = [:], tone: FrameToast.Tone = .success, quiet: Bool = false) async -> JSONValue? {
        busy.insert(key.rawValue)
        defer { busy.remove(key.rawValue) }
        do {
            let r = try await client.command(.settingsRun(key: key, args: args))
            if !quiet, case .object(let o)? = Optional(r.data), case .string(let m)? = o["message"] { frame.toast(m, tone: tone) }
            return r.data
        } catch EngineFailure.engine(let e) where e.code == "cancelled" {
            return nil
        } catch {
            if !quiet { frame.toast(Self.message(error), tone: .error) }
            return nil
        }
    }

    /// A Convex mutation or action by name (users.updateProfile, aiMemory.add…), with an optional toast when done.
    @discardableResult
    func mutate(_ fn: String, _ args: [String: JSONValue] = [:], done: String? = nil, action: Bool = false) async -> JSONValue? {
        guard let r = await run(action ? .convexAction : .convexMutation, ["fn": .string(fn), "args": .object(args)]) else { return nil }
        if let done { frame.toast(done) }
        return r
    }

    /// An engine command with the same toasts.
    @discardableResult
    func perform<C: EngineCommandSpec>(_ command: C, done: String? = nil) async -> C.Result? {
        do {
            let r = try await client.command(command)
            if let done { frame.toast(done) }
            return r
        } catch {
            frame.toast(Self.message(error), tone: .error)
            return nil
        }
    }

    static func message(_ error: any Error) -> String {
        if case EngineFailure.engine(let e) = error { return e.message }
        return "Something went wrong. Try again."
    }

    /// The sections in their groups, as SettingsView.tsx lists them for this mode and role.
    var groups: [(label: String, items: [MacSettingsSection])] {
        let you: [MacSettingsSection] = isLocal
            ? [.library, .ai, .appearance, .data, .desktop]
            : [.account, .ai, .billing, .security, .privacy, .devices, .connectedApps, .appearance, .notifications, .sync, .data, .desktop]
        var out: [(String, [MacSettingsSection])] = [("You", you)]
        if let w = workspace, !isLocal {
            var items: [MacSettingsSection] = [.workspace, .members, .workspacePrivacy]
            if w.canManage { items.append(contentsOf: [.workspaceGuests]) }
            if canManageBilling { items.append(.workspaceBilling) }
            if w.canManage { items.append(.workspaceData) }
            // The web's order: General, Members, Privacy, Guests, Plan & billing, Import & export.
            out.append((w.name, items))
        }
        return out
    }

    var canManageBilling: Bool { workspace?.role == "owner" }

    /// The section to show for an asked one (a section this mode lacks shows the first it has: the library).
    func shown(_ asked: MacSettingsSection?) -> MacSettingsSection {
        let all = groups.flatMap(\.items)
        if let asked, all.contains(asked) || (asked.isWorkspace && !isLocal) { return asked }
        return isLocal ? .library : (asked == nil ? .account : (all.first ?? .account))
    }

    /// "Folevi 1.0.05", the app's own version.
    var version: String { "Folevi \(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "")" }
}

/// The Settings page in a window's content (the web's main column at /settings/<section>).
public struct SettingsScreen: View {
    let model: MacSettingsModel
    let section: MacSettingsSection?
    /// The Settings window: no list of sections, no large title (its toolbar has them).
    var windowed = false
    /// The page's height as laid out (the Settings window fits itself to it).
    var onHeight: ((CGFloat) -> Void)?

    public init(model: MacSettingsModel, section: MacSettingsSection?, windowed: Bool = false, onHeight: ((CGFloat) -> Void)? = nil) {
        self.model = model
        self.section = section
        self.windowed = windowed
        self.onHeight = onHeight
    }
    @Environment(\.colorScheme) private var scheme

    public var body: some View {
        let shown = model.shown(section)
        let grid = SettingsStyle.pair("grid").light
        let navWidth = SettingsStyle.pair("nav").light.width
        GeometryReader { geo in
            let column = min(geo.size.width, 1024)
            let left = (geo.size.width - column) / 2
            ZStack(alignment: .topLeading) {
                ScrollView(.vertical) {
                    HStack(alignment: .top, spacing: windowed ? 0 : grid.gap) {
                        if !windowed { Color.clear.frame(width: navWidth, height: 1) }
                        SettingsContent(model: model, section: shown, windowed: windowed)
                            .frame(maxWidth: .infinity, alignment: .topLeading)
                    }
                    // The window ends as it starts, with no room left for a page that scrolls under a bar.
                    .padding(EdgeInsets(top: grid.padding.top, leading: left + grid.padding.left, bottom: windowed ? grid.padding.top + 8 : grid.padding.bottom, trailing: left + grid.padding.right))
                    .frame(width: geo.size.width, alignment: .topLeading)
                    .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { onHeight?($0) }
                }
                .scrollIndicators(.automatic)
                if !windowed {
                    SettingsNav(model: model, current: shown)
                        .frame(width: navWidth, alignment: .topLeading)
                        .padding(.leading, left + grid.padding.left)
                        .padding(.top, grid.padding.top)
                }
            }
        }
        // The Settings window's page is the surface colour (Shell.tsx .ui-settings-window).
        .background(windowed ? SettingsColor.v("color-surface", scheme) : Color.clear)
        .environment(\.settingsLineBreaks, model.lineBreaks)
        .environment(\.settingsWindowed, windowed)
        .accessibilityIdentifier("screen.settings")
    }
}

/// The list of sections (the web's `nav[aria-label="Settings sections"]`): You, the workspace's, Support.
struct SettingsNav: View {
    let model: MacSettingsModel
    let current: MacSettingsSection
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let groups = SettingsStyle.pair("nav.groups").light
        VStack(alignment: .leading, spacing: groups.gap) {
            ForEach(model.groups, id: \.label) { g in
                group(g.label) {
                    ForEach(g.items, id: \.self) { s in
                        item(s.label, icon: s.icon, active: s == current) { model.frame.open(.web("/settings/\(s.rawValue)")) }
                    }
                }
            }
            group("Support") {
                item("Help", icon: .circleQuestionMark, active: false) { model.frame.host?.frameOpenHelp() }
                item("Contact support…", icon: .lifeBuoy, active: false) { contact() }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Settings sections")
    }

    private func group<C: View>(_ label: String, @ViewBuilder _ items: () -> C) -> some View {
        let l = SettingsStyle.pair("nav.label").resolve(scheme)
        let list = SettingsStyle.pair("nav.list").light
        return VStack(alignment: .leading, spacing: 0) {
            Text(label.uppercased()).webText(l.text).lineLimit(1).truncationMode(.tail)
                .foregroundStyle(l.color.color)
                .padding(l.padding.edgeInsets)
                .padding(.bottom, l.margin.bottom)
            VStack(alignment: .leading, spacing: list.gap) { items() }
        }
    }

    private func item(_ title: String, icon: WebIcon, active: Bool, action: @escaping () -> Void) -> some View {
        let pair = SettingsStyle.pair(active ? "nav.item.active" : "nav.item")
        let s = pair.resolve(scheme)
        let iconColor = SettingsStyle.pair(active ? "nav.item.active.icon" : "nav.item.icon").resolve(scheme).color.color
        return Button(action: action) {
            NavRowLabel(title: title, icon: icon, style: s, iconColor: iconColor, active: active)
                .webBox(pair)
                .contentShape(Rectangle())
        }
        .buttonStyle(WebHoverRowStyle(radius: s.radius, hover: active ? nil : WebStyles.vars["glass-hover"], press: nil, selected: active))
        .accessibilityAddTraits(active ? .isSelected : [])
    }

    private func contact() {
        // Without an account there's no support form: an email, as the web opens.
        if model.isLocal { NSWorkspace.shared.open(URL(string: "mailto:support@folevi.com")!) } else { model.frame.host?.frameOpenHelp() }
    }
}

private struct WindowedKey: EnvironmentKey {
    static let defaultValue = false
}

extension EnvironmentValues {
    /// In the Settings window (⌘,): its panes use the window's whole width.
    var settingsWindowed: Bool {
        get { self[WindowedKey.self] }
        set { self[WindowedKey.self] = newValue }
    }
}

private struct NavRowLabel: View {
    let title: String
    let icon: WebIcon
    let style: WebComputedStyle
    let iconColor: Color
    let active: Bool
    @State private var over = false
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let heading = SettingsColor.v("color-heading", scheme)
        HStack(spacing: style.gap) {
            WebIconView(icon, size: 16).foregroundStyle(over && !active ? heading : iconColor)
            Text(title).webText(style.text).lineLimit(1)
                .foregroundStyle(over && !active ? heading : style.color.color)
            Spacer(minLength: 0)
        }
        .padding(style.padding.edgeInsets)
        .frame(height: style.height)
        .onHover { over = $0 }
    }
}

/// The open section: its large title, its cards, the version.
struct SettingsContent: View {
    let model: MacSettingsModel
    let section: MacSettingsSection
    let windowed: Bool
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let gap = SettingsStyle.pair("heading").light.margin.bottom
        VStack(alignment: .leading, spacing: gap) {
            if !windowed {
                SText(section.heading, "heading", lines: 1)
                    .accessibilityAddTraits(.isHeader)
            }
            sectionBody
            // The window shows the version once, at the end of General (the Mac's own settings), not under every pane.
            if !windowed || section == .desktop {
                SText(model.version, "footer").padding(.top, SettingsStyle.pair("footer").light.padding.top)
            }
        }
    }

    @ViewBuilder private var sectionBody: some View {
        switch section {
        case .library: LibrarySettings(model: model)
        case .ai: if model.isLocal { LocalAiSettings(model: model) } else { AccountAiSettings(model: model) }
        case .appearance: AppearanceSettingsView(model: model)
        case .data: DataSettings(model: model, workspace: nil)
        case .desktop: DesktopSettingsView(model: model)
        case .account: AccountSettingsView(model: model)
        case .notifications: NotificationSettingsView(model: model)
        case .security: SecuritySettingsView(model: model)
        case .devices: DevicesSettingsView(model: model)
        case .sync: SyncSettingsView(model: model)
        case .privacy, .billing, .connectedApps, .workspace, .members, .workspacePrivacy, .workspaceGuests, .workspaceBilling:
            AccountOnlySettings(model: model, section: section)
        case .workspaceData: DataSettings(model: model, workspace: model.workspace)
        }
    }
}
#endif
