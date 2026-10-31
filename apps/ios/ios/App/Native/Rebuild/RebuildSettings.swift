// Settings in the rebuild frame (docs/IOS_REBUILD_PLAN.md, I4): the web's iPhone Settings drawn natively
// (FoleviPhone's PhoneSettingsList and PhoneSettingsSectionView) on the grouped surface: `/settings` the list,
// `/settings/<section>` a section, `?screen=<id>` one of its pushed screens, each a screen of the frame's stack with
// Back and a large title. This device's lock is the app's own (LockSettings, AppLock), as the page's bridge has it.
import SwiftUI
import FoleviDesign
import FoleviEngine
import FoleviPhone
import FoleviScreens

/// Settings' model, one per frame (its engine stores stay while the app runs).
@MainActor
enum RebuildSettings {
    private static var shared: PhoneSettingsModel?

    static func model(_ phone: PhoneModel, frame: PhoneFrameModel) -> PhoneSettingsModel {
        if let m = shared, m.client === phone.client { return m }
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? ""
        let m = PhoneSettingsModel(client: phone.client, version: version) { [weak phone] message, error in
            phone?.toast(message, tone: error ? .error : .info)
        }
        m.open = { path in
            let route = FrameRoute(path: path)
            if case .note(let id) = route { phone.router?.openNote(id, source: nil, focus: false) } else { frame.open(route) }
        }
        shared = m
        return m
    }
}

struct RebuildSettingsScreen: View {
    let path: String
    let frame: PhoneFrameModel
    let phone: PhoneModel
    let signIn: () -> Void

    private var host: PhoneSettingsHost {
        PhoneSettingsHost(
            lock: { (LockSettings.enabled, LockSettings.after, LockSettings.method()) },
            setLock: { on in
                if on {
                    guard LockSettings.method() != "none" else { return }
                    guard await AppLock.confirm(reason: "Turn on the lock for Folevi") else { return }
                }
                LockSettings.enabled = on
            },
            setLockAfter: { after in if LockSettings.choices.contains(after) { LockSettings.after = after } },
            signIn: signIn,
            contactSupport: { if let url = URL(string: "mailto:support@folevi.com") { UIApplication.shared.open(url) } },
            openURL: { phone.router?.openExternal($0) }
        )
    }

    var body: some View {
        let model = RebuildSettings.model(phone, frame: frame)
        let (section, screen) = PhoneSettingsSection.parse(path)
        PhoneScreen(PhoneScreenOptions(title: section.map { PhoneSettingsSectionView.title($0, screen: screen) } ?? "Settings", grouped: true), scrollToTop: frame.scrollToTop, back: { frame.back() }) {
            EmptyView()
        } trailing: {
            EmptyView()
        } content: {
            if let section {
                PhoneSettingsSectionView(model: model, host: host, section: section, screen: screen)
            } else {
                PhoneSettingsList(model: model, host: host)
            }
        }
    }
}
