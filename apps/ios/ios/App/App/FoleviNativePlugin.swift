// The app's own Capacitor plugin ("FoleviNative"), called through `window.foleviNative` (bridge.js): the
// Face ID lock's settings, and where links go (and, in Native/NativeServices.swift, the device's token for
// the widgets and extensions, kept shares and the scanner). Every call checks the web view is showing Folevi's own site
// (capacitor.config.ts server.url): App-Bound Domains already keep other sites out of the web view, this
// makes sure of it.
//
// Links: Folevi's own pages stay in the web view (one opened as a new window loads there too); a link to
// another site opens in an in-app Safari view (never Folevi's pricing page); mail, phone and folevi:// links
// go to the system.
import Capacitor
import SafariServices
import UIKit
import WebKit

@objc(FoleviNativePlugin)
final class FoleviNativePlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "FoleviNativePlugin"
    let jsName = "FoleviNative"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getSettings", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setSettings", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openExternal", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "retry", returnType: CAPPluginReturnPromise),
        // Native/NativeServices.swift: the device's token, kept shares, the scanner.
        CAPPluginMethod(name: "device", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setCredential", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearCredential", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "takeShares", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "finishShare", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "scanDocument", returnType: CAPPluginReturnPromise),
        // Native/PushBridge.swift: notifications on this device, and the app icon's badge.
        CAPPluginMethod(name: "pushStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "enablePush", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "disablePush", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setBadge", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openNotificationSettings", returnType: CAPPluginReturnPromise),
        // Native/SystemSettings.swift: Reduce Transparency, Increase Contrast, the text size.
        CAPPluginMethod(name: "accessibility", returnType: CAPPluginReturnPromise),
        // Native/SystemSettings.swift: the colour behind the web view, which the keyboard's corners show.
        CAPPluginMethod(name: "setBackdrop", returnType: CAPPluginReturnPromise),
        // Native/NativeServices.swift: signing in with Google in iOS's sign-in sheet.
        CAPPluginMethod(name: "authenticate", returnType: CAPPluginReturnPromise),
        // Native/TextRecognition.swift: the words in an image, read on the device (search in files).
        CAPPluginMethod(name: "recognizeText", returnType: CAPPluginReturnPromise),
        // Native/AppleSignIn.swift: Sign in with Apple in Apple's own sheet.
        CAPPluginMethod(name: "signInWithApple", returnType: CAPPluginReturnPromise),
        // Native/LocalExtensions.swift: the widgets, Shortcuts and Spotlight in local mode.
        CAPPluginMethod(name: "setWidgetSnapshot", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "takeLocalActions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "finishLocalAction", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "indexSpotlight", returnType: CAPPluginReturnPromise),
        // Native/UI: the native UI layer (docs/IOS_POLISH_PLAN.md §4): haptics, the long press's lifted
        // preview, action sheets and alerts, the pickers and share sheet, the keyboard's moves.
        CAPPluginMethod(name: "haptic", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "hapticPrepare", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "liftArm", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "lift", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "liftDrop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "actionSheet", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "alert", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pickDate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pickColor", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "share", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "keyboard", returnType: CAPPluginReturnPromise),
    ]

    override func load() {
        // The keyboard's moves go to the page from the start (Native/UI/KeyboardBridge.swift).
        Task { @MainActor in KeyboardBridge.shared.attach(self) }
    }

    var appOrigin: String { AppOrigin.of(bridge?.config.serverURL) }

    /// Whether the page asking is Folevi's own (not the offline page, never another site).
    @MainActor var fromFolevi: Bool {
        guard let page = bridge?.webView?.url else { return false }
        return !appOrigin.isEmpty && AppOrigin.of(page) == appOrigin
    }

    // MARK: Face ID lock

    @objc func getSettings(_ call: CAPPluginCall) {
        Task { @MainActor in
            guard self.fromFolevi else { return call.reject("Not allowed here") }
            call.resolve(Self.settings())
        }
    }

    /// { lock?: boolean, lockAfter?: 0 | 60 | 300 | 900 }. Turning the lock on asks to unlock once first,
    /// so it's never on for someone who can't get back in.
    @objc func setSettings(_ call: CAPPluginCall) {
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

    @objc func openExternal(_ call: CAPPluginCall) {
        Task { @MainActor in
            guard self.fromFolevi else { return call.reject("Not allowed here") }
            guard let raw = call.getString("url"), let url = URL(string: raw), self.openOutside(url) else { return call.reject("Can't open this link") }
            call.resolve()
        }
    }

    /// The offline page's "Try again": Folevi again, from the network or the site's cache.
    @objc func retry(_ call: CAPPluginCall) {
        Task { @MainActor in
            guard let bridge = self.bridge, let webView = bridge.webView else { return call.resolve() }
            webView.load(URLRequest(url: bridge.config.serverURL))
            call.resolve()
        }
    }

    /// Capacitor asks every plugin before the web view goes somewhere: true cancels (handled here), false
    /// allows it, nil leaves it to Capacitor's usual rules.
    override func shouldOverrideLoad(_ navigationAction: WKNavigationAction) -> NSNumber? {
        guard let url = navigationAction.request.url, let scheme = url.scheme?.lowercased() else { return nil }
        let newWindow = navigationAction.targetFrame == nil
        let topLevel = newWindow || navigationAction.targetFrame?.isMainFrame == true
        switch scheme {
        case "http", "https":
            if AppOrigin.of(url) == appOrigin {
                // Any of Folevi's pages stays in the web view (Capacitor would only keep those under the start
                // page, /documents). window.open or target=_blank: there's one window, so it opens here.
                guard newWindow else { return false }
                DispatchQueue.main.async { self.bridge?.webView?.load(URLRequest(url: url)) }
                return true
            }
            // Embeds (a video in a note) load in their frame; leaving Folevi opens Safari over the app.
            guard topLevel else { return nil }
            // The built-in interface: a link to one of the app's own pages on the website opens here.
            if FoleviViewController.bundled(bridge), AppOrigin.of(url) == AppOrigin.of(ShellAuth.shared.service), let link = DeepLink.fromWeb(url) ?? DeepLink.fromPath(url.path) {
                DispatchQueue.main.async { DeepLinkRouter.open(link) }
                return true
            }
            // Folevi's plans page is never opened from the app (App Store rule 3.1.1: no way to buying).
            if Self.isPricing(url) { return true }
            DispatchQueue.main.async { _ = self.openOutside(url) }
            return true
        case "mailto", "tel", "sms", "folevi":
            DispatchQueue.main.async { _ = self.openOutside(url) }
            return true
        case "about", "blob", "data", "capacitor", LibraryFileHandler.scheme:
            return nil
        default:
            // javascript:, file: and other apps' schemes never load from a page.
            return true
        }
    }

    /// folevi.com/pricing (and the local dev server's): where plans are sold.
    private static func isPricing(_ url: URL) -> Bool {
        let host = url.host?.lowercased() ?? ""
        let folevi = host == "folevi.com" || host.hasSuffix(".folevi.com") || host == "localhost"
        return folevi && (url.path == "/pricing" || url.path.hasPrefix("/pricing/"))
    }

    /// Opens a link outside the web view: web pages in an in-app Safari view, the rest with the system.
    @MainActor private func openOutside(_ url: URL) -> Bool {
        switch url.scheme?.lowercased() {
        case "http", "https":
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
