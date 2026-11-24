// Updates (docs/MAC_WEBKIT_PLAN.md §9): Sparkle 2 reads https://folevi.com/download/mac/appcast.xml (SUFeedURL), checks
// every six hours (Electron's interval), downloads in the background and installs when Folevi quits, or now from
// "Restart to Update" in the Folevi menu. Every update is checked against the EdDSA public key in Info.plist
// (SUPublicEDKey; the private key is in the owner's login Keychain, account "folevi", and signs each release in
// scripts/publish.mjs) and must carry the same Developer ID signature.
//
// Only the release app looks for updates: a Debug build or a FOLEVI_USER_DATA run never does (FOLEVI_UPDATES=on
// lets one try a test feed, FOLEVI_UPDATE_URL), and FOLEVI_UPDATES=off turns them off anywhere.
//
// The menu (WM2's MainMenu) shows `menuTitle` and calls `checkForUpdates()` or `restartToUpdate()`; `changed` is
// posted whenever the title changes.
import AppKit
import Sparkle

@MainActor
final class Updater: NSObject, SPUUpdaterDelegate {
    static let shared = Updater()
    static let changed = Notification.Name("folevi.updates.changed")

    private var controller: SPUStandardUpdaterController?
    private var installNow: (() -> Void)?
    /// The version that installs on quit, once it's downloaded.
    private(set) var readyVersion: String?

    static var enabled: Bool {
        let env = ProcessInfo.processInfo.environment["FOLEVI_UPDATES"]
        if env == "off" || Paths.testing { return false }
        if env == "on" { return true }
        return !Paths.isDebug && Paths.userDataOverride == nil
    }

    /// The feed: SUFeedURL, or FOLEVI_UPDATE_URL's (a test bucket).
    static var feedURL: String? {
        guard let raw = ProcessInfo.processInfo.environment["FOLEVI_UPDATE_URL"], let base = URL(string: raw), base.scheme == "https" || base.host == "localhost" else { return nil }
        return base.absoluteString.replacingOccurrences(of: #"/+$"#, with: "", options: .regularExpression) + "/mac/appcast.xml"
    }

    /// Starts Sparkle (after the first window is up).
    func start() {
        guard Self.enabled, controller == nil else { return }
        controller = SPUStandardUpdaterController(startingUpdater: true, updaterDelegate: self, userDriverDelegate: nil)
        post()
    }

    var canCheck: Bool { controller?.updater.canCheckForUpdates ?? false }

    /// "Restart to Update to 2.1.0" once one is ready; "Check for Updates…" otherwise; nil when updates are off.
    var menuTitle: String? {
        guard controller != nil else { return nil }
        if let readyVersion { return "Restart to Update to \(readyVersion)" }
        return "Check for Updates…"
    }

    /// The menu item's action: installs a ready update now, or checks (with Sparkle's window).
    func menuAction() {
        if installNow != nil { restartToUpdate() } else { checkForUpdates() }
    }

    func checkForUpdates() {
        if controller == nil, Self.enabled { start() }
        controller?.checkForUpdates(nil)
    }

    func restartToUpdate() {
        installNow?()
    }

    private func post() { NotificationCenter.default.post(name: Self.changed, object: self) }

    // MARK: SPUUpdaterDelegate

    nonisolated func feedURLString(for updater: SPUUpdater) -> String? {
        MainActor.assumeIsolated { Self.feedURL }
    }

    nonisolated func updater(_ updater: SPUUpdater, willInstallUpdateOnQuit item: SUAppcastItem, immediateInstallationBlock immediateInstallHandler: @escaping () -> Void) -> Bool {
        let version = item.displayVersionString
        MainActor.assumeIsolated {
            self.readyVersion = version
            self.installNow = immediateInstallHandler
            self.post()
        }
        // Sparkle installs it when Folevi quits; the menu offers it now.
        return true
    }

    nonisolated func updater(_ updater: SPUUpdater, didAbortWithError error: Error) {
        MainActor.assumeIsolated { self.post() }
    }
}
