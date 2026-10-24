// Pictures of the gates, sign-in, Settings, sharing and Quick Add (N13, N14) at iPhone and iPad sizes (iOS
// Simulator) or the Mac size, light and dark, from the contract's fixtures. A core set compares to references in
// __Snapshots__; every screen writes a 2x picture to FOLEVI_SCREENS_OUT when it's set.
import Foundation
import SwiftUI
import Testing
@testable import FoleviDesign
@testable import FoleviEngine
@testable import FoleviScreens

extension Rendering {
@Suite("Account screen snapshots", .serialized) @MainActor
struct AccountScreenSnapshotTests {
    init() { ScreenClock.fixed = fixedNow }

    func run<V: View>(_ name: String, reference: Bool, sizes: [DeviceSize] = hostSizes, ready: @escaping () -> Bool = { true }, _ make: () -> V) async {
        for size in sizes {
            for scheme in [ColorScheme.light, .dark] {
                let host = ScreenHost(make(), size: size, scheme: scheme)
                await eventually(name, timeout: .seconds(8), ready)
                await host.settle(0.5)
                checkScreen(host, named: "\(name)-\(size.rawValue)-\(scheme == .dark ? "dark" : "light")-\(hostPlatform)", reference: reference)
                host.close()
            }
        }
    }

    // MARK: Gates

    @Test(arguments: [
        ("mode-choice", "event.gate.changed.mode-choice.json", true),
        ("locked", "event.gate.changed.locked.json", true),
        ("wrong-passphrase", "event.gate.changed.wrong-passphrase.json", false),
        ("approval", "event.gate.changed.approval.json", false),
        ("e2ee-setup", "event.gate.changed.e2ee-setup.json", false),
        ("device-limit", "event.gate.changed.device-limit.json", false),
        ("migration", "event.gate.changed.migration.json", true),
        ("migration-moving", "event.gate.changed.migration-moving.json", false),
        ("onboarding", "event.gate.changed.onboarding.json", false),
    ])
    func gate(_ name: String, _ file: String, _ reference: Bool) async {
        let engine = AccountEngine()
        await run("gate-\(name)", reference: reference) {
            GateScreen(model: GateModel(client: engine.client(), device: hostPlatform == "ios" ? .iPhone : .mac, gate: AccountEngine.gate(file)), signIn: nil)
        }
    }

    @Test func gateFallbacks() async {
        let engine = AccountEngine()
        for kind in ["updateRequired", "offline", "suspended", "libraryLocked"] {
            var e = AccountEngine.gate("event.gate.changed.signed-out.json")
            e.gate = kind
            if kind == "libraryLocked" {
                e.title = "Unlock your library"
                e.fields = [GateField(id: "passphrase", kind: .secret, label: "Passphrase", placeholder: "")]
                e.actions = [GateAction(id: "unlock", label: "Unlock", style: .primary, enabled: true)]
            }
            await run("gate-\(kind)", reference: false, sizes: [hostSizes[0]]) {
                GateScreen(model: GateModel(client: engine.client(), device: hostPlatform == "ios" ? .iPhone : .mac, gate: e), signIn: nil)
            }
        }
    }

    // MARK: Sign-in

    @Test(arguments: [("choose", true), ("email", false), ("two-factor", false), ("sign-up", false), ("check-inbox", false), ("waiting", false)])
    func signIn(_ step: String, _ reference: Bool) async {
        let start: SignInModel.Step = switch step {
        case "email": .email
        case "two-factor": .twoFactor
        case "sign-up": .signUp
        case "check-inbox": .checkInbox("sam@example.com")
        case "waiting": .waiting(.google)
        default: .choose
        }
        await run("sign-in-\(step)", reference: reference) {
            let m = SignInModel(auth: ScriptedAuthService(), device: hostPlatform == "ios" ? .iPhone : .mac, start: start)
            m.keepLocally = {}
            if step == "email" { m.email = "sam@example.com" }
            return GateScreen(model: GateModel(client: AccountEngine().client(), gate: AccountEngine.gate("event.gate.changed.signed-out.json")), signIn: m)
        }
    }

    // MARK: Settings

    func settings(_ engine: AccountEngine) -> SettingsModel {
        SettingsModel(client: engine.client(), host: SettingsHost(version: "1.0.03", signOut: {}, appLock: ScriptedAppLock(method: hostPlatform == "ios" ? "faceID" : "touchID", enabled: true), pickAvatar: { nil }))
    }

    @Test func settingsList() async {
        let engine = AccountEngine()
        let model = settings(engine)
        await run("settings-list", reference: true, ready: { model.details.value != nil && model.session.value != nil }) {
            SettingsScreen(model: model)
        }
    }

    @Test(arguments: [("account", true), ("general", false), ("appearance", false), ("notifications", true), ("ai", false), ("security", false), ("privacy", false), ("help", false), ("about", false)])
    func settingsSection(_ id: String, _ reference: Bool) async {
        let engine = AccountEngine()
        let model = settings(engine)
        let section = SettingsSection(rawValue: id)!
        model.open(section)
        await run("settings-\(id)", reference: reference, ready: {
            switch section {
            case .account: model.account?.value != nil && model.details.value != nil
            case .notifications: model.notifications?.value != nil
            case .ai: model.ai?.value != nil
            case .security: model.security?.value != nil
            case .appearance: model.appearance?.value != nil
            case .general: model.general?.value != nil
            default: model.session.value != nil
            }
        }) {
            NavigationStack { SettingsSectionScreen(model: model, section: section) }
        }
    }

    // MARK: Sharing

    @Test func share() async {
        let engine = AccountEngine()
        let model = SharingModel(client: engine.client(), noteId: "doc_00002", title: "Q4 planning")
        await run("share", reference: true, ready: { model.value != nil }) {
            ShareScreen(model: model, done: {})
        }
    }

    // MARK: Quick Add

    @Test func quickAdd() async {
        let engine = AccountEngine()
        let model = QuickAddModel(client: engine.client(), queue: QuickAddQueue(url: nil))
        model.parseDelay = .milliseconds(1)
        model.text = "water the plants tomorrow 9am every monday"
        await run("quick-add", reference: true, ready: { model.parsed != nil && model.session.value != nil }) {
            VStack(spacing: 0) {
                QuickAddView(model: model, style: hostPlatform == "ios" ? .sheet : .panel)
                    .frame(maxWidth: hostPlatform == "ios" ? .infinity : 640)
                    .background(RoundedRectangle(cornerRadius: 18).fill(Folevi.color.surface))
                Spacer()
            }
            .padding(.top, 40)
        }
    }
}
}
