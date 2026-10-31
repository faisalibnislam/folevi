// Settings on the iPhone, the way the web builds them there (apps/web/src/components/iphone/SettingsKit.tsx, which
// models iOS Settings): inset grouped sections with a heading above and an explanation under them; rows with a
// label at the start and a value, a switch or a chevron at the end; every choice a screen of its own with a check by
// the one chosen; destructive actions as red rows confirmed by an action sheet. A section's deeper screens are
// pushed on the frame's stack as `/settings/<section>?screen=<id>`, as the web pushes them.
//
// PhoneSettingsModel is Settings' data: the engine's settings views, `settings.query` and `settings.run` (the web's
// own words, viewsSettings.ts), as the Mac's Settings reads them.
#if os(iOS)
import SwiftUI
import FoleviDesign
import FoleviEngine
import FoleviScreens

private func C(_ pair: ColorPair, _ scheme: ColorScheme) -> Color { pair.resolve(scheme).color }

// MARK: The model

@MainActor
@Observable
public final class PhoneSettingsModel {
    public let client: EngineClient
    let toast: @MainActor (String, Bool) -> Void
    /// Opens a route of the app (`/settings/ai`, `/help`, a pushed screen).
    public var open: @MainActor (String) -> Void = { _ in }
    @ObservationIgnored private var queries: [String: ValueStore<SettingsQueryValue>] = [:]
    @ObservationIgnored public private(set) lazy var session: ValueStore<SessionValue> = client.watch(.session, snapshotKey: "session.\(client.place)")
    @ObservationIgnored public private(set) lazy var appearance: ValueStore<AppearanceSettings> = client.watch(.settingsAppearance)
    @ObservationIgnored public private(set) lazy var account: ValueStore<AccountSettings> = client.watch(.settingsAccount)
    @ObservationIgnored public private(set) lazy var details: ValueStore<AccountDetails> = client.watch(.accountDetails)
    @ObservationIgnored public private(set) lazy var notifications: ValueStore<NotificationSettings> = client.watch(.settingsNotifications)
    @ObservationIgnored public private(set) lazy var ai: ValueStore<AiSettings> = client.watch(.settingsAi)
    @ObservationIgnored public private(set) lazy var security: ValueStore<SecuritySettings> = client.watch(.settingsSecurity)
    @ObservationIgnored public private(set) lazy var general: ValueStore<GeneralSettings> = client.watch(.settingsGeneral)
    @ObservationIgnored public private(set) lazy var storage: ValueStore<DeviceStorageValue> = client.watch(.deviceStorage)
    /// Keys of commands running now ("library.syncNow").
    public var busy: Set<String> = []
    /// This app's version ("1.2.07").
    public var version: String

    public init(client: EngineClient, version: String, toast: @escaping @MainActor (String, Bool) -> Void) {
        self.client = client
        self.version = version
        self.toast = toast
    }

    public var isLocal: Bool { session.value?.mode == .local }

    /// The open space when it's a team workspace.
    public var workspace: SpaceInfo? {
        guard let s = session.value, let space = s.spaces.first(where: { $0.id == s.space }), space.kind == .workspace else { return nil }
        return space
    }

    /// A `settings.query` store, kept while the model lives.
    public func query(_ key: SettingsQueryKey, _ args: [String: JSONValue]? = nil) -> ValueStore<SettingsQueryValue> {
        let id = "\(key.rawValue)|\(args.map { String(describing: $0) } ?? "")"
        if let s = queries[id] { return s }
        let s = client.watch(.settingsQuery(key: key, args: args))
        queries[id] = s
        return s
    }

    /// One Convex query the account's sections read (viewsSettings.ts QUERIES).
    public func convex(_ fn: String, _ args: [String: JSONValue] = [:]) -> ValueStore<SettingsQueryValue> {
        query(.convex, ["fn": .string(fn), "args": .object(args)])
    }

    /// Runs a `settings.run` key; its `message` becomes a toast, a failure an error toast. Nil when it failed.
    @discardableResult
    public func run(_ key: SettingsRunKey, _ args: [String: JSONValue] = [:], quiet: Bool = false) async -> JSONValue? {
        busy.insert(key.rawValue)
        defer { busy.remove(key.rawValue) }
        do {
            let r = try await client.command(.settingsRun(key: key, args: args))
            if !quiet, case .object(let o) = r.data, case .string(let m)? = o["message"] { toast(m, false) }
            return r.data
        } catch EngineFailure.engine(let e) where e.code == "cancelled" {
            return nil
        } catch {
            if !quiet { toast(Self.message(error), true) }
            return nil
        }
    }

    /// A Convex mutation or action by name, with an optional toast when done.
    @discardableResult
    public func mutate(_ fn: String, _ args: [String: JSONValue] = [:], done: String? = nil, action: Bool = false) async -> JSONValue? {
        guard let r = await run(action ? .convexAction : .convexMutation, ["fn": .string(fn), "args": .object(args)]) else { return nil }
        if let done { toast(done, false) }
        return r
    }

    /// An engine command with the same toasts.
    @discardableResult
    public func perform<Cmd: EngineCommandSpec>(_ command: Cmd, done: String? = nil) async -> Cmd.Result? {
        do {
            let r = try await client.command(command)
            if let done { toast(done, false) }
            return r
        } catch {
            toast(Self.message(error), true)
            return nil
        }
    }

    static func message(_ error: any Error) -> String {
        if case EngineFailure.engine(let e) = error { return e.message }
        return "Something went wrong. Try again."
    }
}

extension JSONValue {
    /// The value as a Codable type (the shapes `settings.query` sends, viewsSettings.ts).
    func decoded<T: Decodable>(_ type: T.Type) -> T? {
        guard let data = try? JSONEncoder().encode(self) else { return nil }
        return try? JSONDecoder().decode(T.self, from: data)
    }

    subscript(_ key: String) -> JSONValue? {
        if case .object(let o) = self { return o[key] }
        return nil
    }

    var string: String? {
        if case .string(let s) = self { return s }
        return nil
    }
}

extension ValueStore where Value == SettingsQueryValue {
    func data<T: Decodable>(_ t: T.Type) -> T? { value?.data.decoded(T.self) }
}

// MARK: The page

/// A Settings screen's content: `space-y-7 pb-4 pt-3`.
public struct PhoneSettingsPage<Content: View>: View {
    let content: Content

    public init(@ViewBuilder content: () -> Content) { self.content = content() }

    public var body: some View {
        VStack(alignment: .leading, spacing: 28) { content }
            .padding(.top, 12)
            .padding(.bottom, 16)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// IosSection: PhoneGroupedSection (Grouped.tsx's heading, rows and footer are the same).
typealias PhoneSettingsGroup = PhoneGroupedSection

/// VersionFooter: "Folevi 1.2.07", centred, Footnote, muted.
struct PhoneSettingsVersion: View {
    let version: String
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        Text("Folevi \(version)")
            .webText(WebTextStyle(size: WebTypeRole.footnote.metrics.size, leading: 18))
            .lineLimit(1)
            .foregroundStyle(C(FoleviTokens.Chrome.inkMuted, scheme))
            .frame(maxWidth: .infinity)
            .padding(.horizontal, 32)
            .padding(.top, 4)
            .padding(.bottom, 8)
    }
}

// MARK: Rows

/// IosRow: an icon, a label (with a quieter line under it), a value, something at the end (a switch), then a check
/// or a chevron; at least 52 tall, 16 in, 12 between. A row with only an action reads in the heading's ink, medium.
struct PhoneSettingsRow<Icon: View, Trailing: View>: View {
    let label: String
    var description: String?
    var value: String?
    var checked: Bool?
    var chevron = false
    var danger = false
    var disabled = false
    var action: (() -> Void)?
    let icon: Icon
    let trailing: Trailing
    @State private var rowWidth: CGFloat = 370
    @Environment(\.colorScheme) private var scheme

    init(_ label: String, description: String? = nil, value: String? = nil, checked: Bool? = nil, chevron: Bool = false, danger: Bool = false, disabled: Bool = false, action: (() -> Void)? = nil, @ViewBuilder icon: () -> Icon, @ViewBuilder trailing: () -> Trailing) {
        self.label = label
        self.description = description
        self.value = value
        self.checked = checked
        self.chevron = chevron
        self.danger = danger
        self.disabled = disabled
        self.action = action
        self.icon = icon()
        self.trailing = trailing()
    }

    /// Only an action (no value, check, chevron or switch): `font-medium text-heading`.
    private var actionOnly: Bool { action != nil && !chevron && checked == nil && Trailing.self == EmptyView.self && value == nil }

    var body: some View {
        let row = HStack(spacing: 12) {
            icon
            VStack(alignment: .leading, spacing: 2) {
                Text(label)
                    .webText(PhoneType.body(weight: actionOnly && !danger ? FoleviTokens.FontWeight.medium : nil))
                    .lineLimit(1)
                    .foregroundStyle(C(danger ? FoleviTokens.Chrome.destructive : actionOnly ? FoleviTokens.Chrome.heading : FoleviTokens.Chrome.ink, scheme))
                if let description {
                    WebFittedLines(description, style: PhoneType.subheadline(leading: 20), maxLines: 6)
                        .foregroundStyle(C(FoleviTokens.Chrome.inkMuted, scheme))
                }
            }
            .padding(.vertical, description == nil ? 15 : 11)
            .frame(maxWidth: .infinity, alignment: .leading)
            if let value {
                // `max-w-[55%] flex-none truncate`: as wide as it needs, up to 55% of the row's content.
                Text(value)
                    .webText(PhoneType.body())
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .foregroundStyle(C(FoleviTokens.Chrome.inkMuted, scheme))
                    .frame(maxWidth: max(0, (rowWidth - 32) * 0.55), alignment: .trailing)
                    .fixedSize(horizontal: PhoneTaskChips.textWidth(value, PhoneType.body()) <= (rowWidth - 32) * 0.55, vertical: false)
                    .layoutPriority(1)
            }
            trailing
            if checked == true {
                WebIconView(.check, size: 20, strokeWidth: 2.4).foregroundStyle(C(FoleviTokens.Chrome.heading, scheme))
            } else if checked == false {
                Color.clear.frame(width: 20, height: 1)
            }
            if chevron {
                WebIconView(.chevronRight, size: 18, strokeWidth: 2.2)
                    .foregroundStyle(C(FoleviTokens.Chrome.inkFaint, scheme))
                    .padding(.trailing, -4)
            }
        }
        .padding(.horizontal, 16)
        .frame(minHeight: 52)
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { rowWidth = $0 }
        Group {
            if let action {
                Button(action: action) { row.contentShape(Rectangle()) }
                    .buttonStyle(PhoneRowPressStyle())
                    .disabled(disabled)
                    .accessibilityAddTraits(checked == true ? .isSelected : [])
            } else {
                row
            }
        }
        .opacity(disabled ? 0.4 : 1)
        .phoneSeparatorInset(Icon.self == EmptyView.self ? 16 : 58)
    }
}

extension PhoneSettingsRow where Trailing == EmptyView {
    init(_ label: String, description: String? = nil, value: String? = nil, checked: Bool? = nil, chevron: Bool = false, danger: Bool = false, disabled: Bool = false, action: (() -> Void)? = nil, @ViewBuilder icon: () -> Icon) {
        self.init(label, description: description, value: value, checked: checked, chevron: chevron, danger: danger, disabled: disabled, action: action, icon: icon, trailing: { EmptyView() })
    }
}

extension PhoneSettingsRow where Icon == EmptyView, Trailing == EmptyView {
    init(_ label: String, description: String? = nil, value: String? = nil, checked: Bool? = nil, chevron: Bool = false, danger: Bool = false, disabled: Bool = false, action: (() -> Void)? = nil) {
        self.init(label, description: description, value: value, checked: checked, chevron: chevron, danger: danger, disabled: disabled, action: action, icon: { EmptyView() }, trailing: { EmptyView() })
    }
}

/// IosSwitch: iOS's switch in the app's neutral colours (dark when on, light in dark mode), 51 by 31.
struct PhoneSettingsSwitch: View {
    let label: String
    let on: Bool
    var disabled = false
    let change: (Bool) -> Void
    @Environment(\.colorScheme) private var scheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Button {
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
            change(!on)
        } label: {
            ZStack(alignment: .leading) {
                Capsule().fill(on ? C(FoleviTokens.Chrome.heading, scheme) : inkMix(0.16, scheme))
                Circle()
                    .fill(on ? C(FoleviTokens.Chrome.canvas, scheme) : .white)
                    .shadow(color: .black.opacity(0.15), radius: 4, y: 3)
                    .shadow(color: .black.opacity(0.16), radius: 0.5, y: 1)
                    .frame(width: 27, height: 27)
                    .offset(x: on ? 22 : 2)
            }
            .frame(width: 51, height: 31)
            .animation(reduceMotion ? nil : .timingCurve(0.32, 0.72, 0, 1, duration: 0.2), value: on)
        }
        .buttonStyle(.plain)
        .disabled(disabled)
        .opacity(disabled ? 0.4 : 1)
        .accessibilityLabel(label)
        .accessibilityValue(on ? "On" : "Off")
        .accessibilityAddTraits(.isToggle)
    }
}

/// SwitchRow: a row with a switch at its end.
struct PhoneSettingsSwitchRow<Icon: View>: View {
    let label: String
    var description: String?
    let on: Bool
    var disabled = false
    let change: (Bool) -> Void
    let icon: Icon

    init(_ label: String, description: String? = nil, on: Bool, disabled: Bool = false, change: @escaping (Bool) -> Void, @ViewBuilder icon: () -> Icon) {
        self.label = label
        self.description = description
        self.on = on
        self.disabled = disabled
        self.change = change
        self.icon = icon()
    }

    var body: some View {
        PhoneSettingsRow(label, description: description, icon: { icon }) {
            PhoneSettingsSwitch(label: label, on: on, disabled: disabled, change: change)
        }
    }
}

/// IosText: a paragraph inside a section, `px-4 py-3`, Subheadline, snug.
struct PhoneSettingsText: View {
    let text: String
    var muted = false
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        WebFittedLines(text, style: PhoneType.subheadline(leading: WebTypeRole.subheadline.metrics.size * 1.375), maxLines: 20)
            .foregroundStyle(C(muted ? FoleviTokens.Chrome.inkMuted : FoleviTokens.Chrome.ink, scheme))
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .phoneSeparatorInset(16)
    }
}

/// A choice of a ChoiceRow: its words, a quieter line, an icon.
struct PhoneSettingsChoice: Identifiable {
    var value: String
    var label: String
    var description: String?
    var icon: WebIcon?
    var id: String { value }
}

/// ChoiceList: a pushed screen's choices with a check by the chosen one (a light tap when another is picked).
struct PhoneSettingsChoiceList: View {
    let label: String
    let value: String
    let choices: [PhoneSettingsChoice]
    var header: String?
    var footer: String?
    let change: (String) -> Void

    var body: some View {
        PhoneSettingsGroup(header, footer: footer) {
            ForEach(choices) { c in
                let on = c.value == value
                let pick = {
                    if !on { UIImpactFeedbackGenerator(style: .light).impactOccurred() }
                    change(c.value)
                }
                if let icon = c.icon {
                    PhoneSettingsRow(c.label, description: c.description, checked: on ? true : nil, action: pick) { PhoneRowIcon(icon) }
                } else {
                    PhoneSettingsRow(c.label, description: c.description, checked: on ? true : nil, action: pick)
                }
            }
        }
        .accessibilityLabel(label)
    }
}

/// A destructive row confirmed by iOS's action sheet.
struct PhoneSettingsDestructiveRow: View {
    let label: String
    var confirm: String?
    var message: String?
    var disabled = false
    let action: () -> Void
    @State private var asking = false

    var body: some View {
        PhoneSettingsRow(label, danger: true, disabled: disabled) { asking = true }
            .confirmationDialog(message ?? label, isPresented: $asking, titleVisibility: message == nil ? .hidden : .visible) {
                Button(confirm ?? label, role: .destructive, action: action)
                Button("Cancel", role: .cancel) {}
            }
    }
}
#endif
