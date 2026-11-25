// "FoleviNative" in the Capacitor app: the few things `window.foleviNative` needs that Capacitor's own plugins don't
// do (bridge/mobile-bridge.js sends haptics, the status bar, the keyboard, sharing and the clipboard to those). Here:
// the Face ID lock's settings, where links go, and, through the extensions in apps/ios (Native/NativeServices.swift,
// PushBridge.swift, AppleSignIn.swift, SystemSettings.swift, TextRecognition.swift), the device's token for the share
// extension, kept shares, the document scanner, notifications, Sign in with Apple and the system's text settings;
// and, in local mode, the widgets' copy, Spotlight's notes and what a widget, Siri or Shortcuts did meanwhile
// (LocalExtensions.swift).
//
// Links: the app's own pages stay in the web view; a link to another site opens in an in-app Safari view (never
// Folevi's pricing page, App Store rule 3.1.1); mail, phone and folevi:// links go to the system.
import SafariServices
import UIKit
import WebKit

final class FoleviNativePlugin: BridgePlugin {
    override var jsName: String { "FoleviNative" }
    override var methods: Set<String> { Self.names }
    static let names: Set<String> = [
        "getSettings", "setSettings", "openExternal",
        "device", "setCredential", "clearCredential", "takeShares", "finishShare", "scanDocument",
        "pushStatus", "enablePush", "disablePush", "setBadge", "openNotificationSettings",
        "accessibility", "setBackdrop", "authenticate", "recognizeText", "signInWithApple",
        // Local mode's widgets, Shortcuts and Spotlight (apps/ios Native/LocalExtensions.swift).
        "setWidgetSnapshot", "takeLocalActions", "finishLocalAction", "indexSpotlight",
        // The keyboard's moves for the page (apps/ios Native/UI/KeyboardBridge.swift).
        "keyboard",
    ]

    /// A widget or an intent queuing something while the app runs tells this page ("folevi:local-actions").
    override func load() {
        MainActor.assumeIsolated {
            LocalExtensions.attach(bridge)
            KeyboardBridge.shared.attach(self)
        }
    }

    var appOrigin: String { AppOrigin.of(bridge?.serverURL) }

    /// Whether the page asking is the app's own.
    @MainActor var fromFolevi: Bool {
        guard let page = bridge?.webView?.url else { return false }
        return !appOrigin.isEmpty && AppOrigin.of(page) == appOrigin
    }

    // MARK: Face ID lock

    @objc func getSettings(_ call: BridgeCall) {
        Task { @MainActor in
            guard self.fromFolevi else { return call.reject("Not allowed here") }
            call.resolve(Self.settings())
        }
    }

    /// { lock?: boolean, lockAfter?: 0 | 60 | 300 | 900 }. Turning the lock on asks to unlock once first.
    @objc func setSettings(_ call: BridgeCall) {
        Task { @MainActor in
            guard self.fromFolevi else { return call.reject("Not allowed here") }
            if let after = call.getInt("lockAfter") {
                guard LockSettings.choices.contains(after) else { return call.reject("Unknown lock time") }
                LockSettings.after = after
            }
            if let lock = call.getBool("lock"), lock != LockSettings.enabled {
                if lock {
                    guard LockSettings.method() != "none" else { return call.reject("Set a passcode for this device in the Settings app first.") }
                    guard await AppLock.confirm(reason: "Turn on the lock for Folevi") else { return call.resolve(Self.settings()) }
                }
                LockSettings.enabled = lock
            }
            call.resolve(Self.settings())
        }
    }

    private static func settings() -> [String: Any] {
        ["lock": LockSettings.enabled, "lockAfter": LockSettings.after, "method": LockSettings.method()]
    }

    // MARK: Links

    @objc func openExternal(_ call: BridgeCall) {
        Task { @MainActor in
            guard self.fromFolevi else { return call.reject("Not allowed here") }
            guard let raw = call.getString("url"), let url = URL(string: raw), self.openOutside(url) else { return call.reject("Can't open this link") }
            call.resolve()
        }
    }

    override func shouldOverrideLoad(_ navigationAction: WKNavigationAction) -> NSNumber? {
        guard let url = navigationAction.request.url, let scheme = url.scheme?.lowercased() else { return nil }
        let newWindow = navigationAction.targetFrame == nil
        let topLevel = newWindow || navigationAction.targetFrame?.isMainFrame == true
        switch scheme {
        case "http", "https":
            if AppOrigin.of(url) == appOrigin {
                guard newWindow else { return false }
                DispatchQueue.main.async { self.bridge?.webView?.load(URLRequest(url: url)) }
                return true
            }
            // Embeds (a video in a note) load in their frame; leaving Folevi opens Safari over the app.
            guard topLevel else { return nil }
            if Self.isPricing(url) { return true }
            DispatchQueue.main.async { _ = self.openOutside(url) }
            return true
        case "mailto", "tel", "sms", "folevi":
            DispatchQueue.main.async { _ = self.openOutside(url) }
            return true
        case "about", "blob", "data", "capacitor", LibraryFileHandler.scheme:
            return nil
        default:
            return true
        }
    }

    /// folevi.com/pricing (and the local dev server's): where plans are sold.
    private static func isPricing(_ url: URL) -> Bool {
        let host = url.host?.lowercased() ?? ""
        let folevi = host == "folevi.com" || host.hasSuffix(".folevi.com") || host == "localhost"
        return folevi && (url.path == "/pricing" || url.path.hasPrefix("/pricing/"))
    }

    @MainActor private func openOutside(_ url: URL) -> Bool {
        switch url.scheme?.lowercased() {
        case "http", "https":
            if Self.isPricing(url) { return false }
            guard let presenter = topController() else { return false }
            let safari = SFSafariViewController(url: url)
            safari.dismissButtonStyle = .close
            presenter.present(safari, animated: true)
            return true
        case "mailto", "tel", "sms", "folevi":
            UIApplication.shared.open(url)
            return true
        default:
            return false
        }
    }

    @MainActor func topController() -> UIViewController? {
        var top = bridge?.viewController
        while let presented = top?.presentedViewController { top = presented }
        return top
    }
}
