// The keyboard around the web view, as Capacitor's Keyboard plugin handled it with the app's settings
// (resize "native", resizeOnFullScreen, the form accessory bar hidden), so the page sees the same thing it did:
//
// - window events "keyboardWillShow" and "keyboardDidShow" ({ keyboardHeight }), "keyboardWillHide" and
//   "keyboardDidHide" (components/iphone/chrome.tsx and lib/native/ui.ts listen for them);
// - the web view's frame ends at the keyboard's top once it has landed (and goes back as it leaves), and the web
//   view's own keyboard handling (which would scroll the page under it) is switched off;
// - on an iPad, the part of the web view the keyboard covers (Stage Manager windows), and the QuickType bar alone
//   (under a fifth of the screen) counts as no keyboard;
// - WKWebView's bar above the keyboard ("‹ › Done") never shows, the keyboard keeps the system's appearance, and
//   a focus() from the page raises the keyboard without a tap (the note editor focuses itself).
//
// KeyboardBridge (Native/UI) sends the page the finer-grained frames (`foleviNative.onKeyboard`) on top of this.
import ObjectiveC
import UIKit
import WebKit

final class KeyboardHost {
    static let shared = KeyboardHost()

    private weak var host: WebHost?
    private var observers: [NSObjectProtocol] = []
    private var paddingBottom: CGFloat = 0
    private var stageManagerOffset: CGFloat = 0
    private var hideWork: DispatchWorkItem?
    private var frameWork: DispatchWorkItem?

    /// Follows the page on show (each new web view takes over).
    func attach(_ host: WebHost) {
        self.host = host
        Self.hideAccessoryBar()
        Self.keepSystemKeyboardAppearance()
        // The web view's own keyboard handling would scroll and inset the page as well as our resize.
        let center = NotificationCenter.default
        for name in [UIResponder.keyboardWillHideNotification, UIResponder.keyboardWillShowNotification, UIResponder.keyboardWillChangeFrameNotification, UIResponder.keyboardDidChangeFrameNotification] {
            center.removeObserver(host.pageView, name: name, object: nil)
        }
        guard observers.isEmpty else { return }
        observers = [
            center.addObserver(forName: UIResponder.keyboardWillShowNotification, object: nil, queue: .main) { note in
                let info = note.userInfo ?? [:]
                MainActor.assumeIsolated { KeyboardHost.shared.willShow(info) }
            },
            center.addObserver(forName: UIResponder.keyboardDidShowNotification, object: nil, queue: .main) { note in
                let info = note.userInfo ?? [:]
                MainActor.assumeIsolated { KeyboardHost.shared.didShow(info) }
            },
            center.addObserver(forName: UIResponder.keyboardWillHideNotification, object: nil, queue: .main) { _ in
                MainActor.assumeIsolated { KeyboardHost.shared.willHide() }
            },
            center.addObserver(forName: UIResponder.keyboardDidHideNotification, object: nil, queue: .main) { _ in
                MainActor.assumeIsolated { KeyboardHost.shared.didHide() }
            },
        ]
    }

    private var webView: WKWebView? { host?.pageView }

    private var isPad: Bool { UIDevice.current.userInterfaceIdiom == .pad }

    /// The QuickType bar alone on an iPad (a hardware keyboard attached): not a keyboard.
    static func ignoredOnPad(_ height: CGFloat, screenHeight: CGFloat) -> Bool {
        height > 0 && height / screenHeight < 0.20
    }

    /// How tall the keyboard is over the web view, the way the Keyboard plugin measured it.
    private func height(_ info: [AnyHashable: Any], remember: Bool) -> CGFloat {
        let rect = (info[UIResponder.keyboardFrameEndUserInfoKey] as? NSValue)?.cgRectValue ?? .zero
        var height = rect.height
        if isPad, let webView {
            if stageManagerOffset > 0 {
                height = stageManagerOffset
            } else if let screen = webView.window?.screen {
                let absolute = webView.convert(webView.frame, to: screen.coordinateSpace)
                height = max(0, (absolute.height + absolute.origin.y) - (UIScreen.main.bounds.height - rect.height))
                if remember { stageManagerOffset = height }
            }
            if Self.ignoredOnPad(height, screenHeight: UIScreen.main.bounds.height) { height = 0 }
        }
        return height
    }

    private func willShow(_ info: [AnyHashable: Any]) {
        hideWork?.cancel()
        hideWork = nil
        let h = height(info, remember: true)
        let duration = ((info[UIResponder.keyboardAnimationDurationUserInfoKey] as? NSNumber)?.doubleValue ?? 0.25) + 0.2
        setKeyboardHeight(h, delay: duration)
        resetScrollView()
        host?.triggerWindowJSEvent(eventName: "keyboardWillShow", data: ["keyboardHeight": Int(h)])
    }

    private func didShow(_ info: [AnyHashable: Any]) {
        let h = height(info, remember: false)
        resetScrollView()
        host?.triggerWindowJSEvent(eventName: "keyboardDidShow", data: ["keyboardHeight": Int(h)])
    }

    private func willHide() {
        setKeyboardHeight(0, delay: 0.01)
        resetScrollView()
        // On the next turn of the run loop, as the plugin did (a hide followed at once by a show sends neither).
        let work = DispatchWorkItem { [weak self] in self?.host?.triggerWindowJSEvent(eventName: "keyboardWillHide") }
        hideWork = work
        DispatchQueue.main.async(execute: work)
    }

    private func didHide() {
        host?.triggerWindowJSEvent(eventName: "keyboardDidHide")
        resetScrollView()
        stageManagerOffset = 0
    }

    private func resetScrollView() {
        webView?.scrollView.contentInset = .zero
    }

    private func setKeyboardHeight(_ height: CGFloat, delay: TimeInterval) {
        guard paddingBottom != height else { return }
        paddingBottom = height
        frameWork?.cancel()
        let work = DispatchWorkItem { [weak self] in self?.updateFrame() }
        frameWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: work)
    }

    /// The web view ends where the keyboard starts (resize "native"). Not with the native frame: the page view
    /// stays full height and the note screen gives the page the keyboard's room as an inset (Native/Phone).
    private func updateFrame() {
        guard let webView, !PhoneFrame.enabled else { return }
        let window = webView.window ?? UIApplication.shared.connectedScenes.compactMap { ($0 as? UIWindowScene)?.keyWindow }.first
        let bounds = window?.bounds ?? UIScreen.main.bounds
        let f = webView.frame
        webView.frame = CGRect(x: f.origin.x, y: f.origin.y, width: bounds.width - f.origin.x, height: bounds.height - f.origin.y - paddingBottom)
        resetScrollView()
    }

    // MARK: WebKit's private views (what the Keyboard plugin and Capacitor changed the same way)

    private static var accessoryBarHidden = false

    /// No "‹ › Done" bar over the keyboard: the page has its own writing bar.
    private static func hideAccessoryBar() {
        guard !accessoryBarHidden else { return }
        accessoryBarHidden = true
        let none: @convention(block) (AnyObject) -> UIView? = { _ in nil }
        let imp = imp_implementationWithBlock(none)
        for name in [["WK", "Content", "View"], ["UI", "Web", "Browser", "View"]] {
            guard let cls = NSClassFromString(name.joined()), let method = class_getInstanceMethod(cls, #selector(getter: UIResponder.inputAccessoryView)) else { continue }
            method_setImplementation(method, imp)
        }
    }

    private static var appearanceSet = false

    /// The keyboard's appearance follows the system (the plugin set it to Default for the web view's text input).
    private static func keepSystemKeyboardAppearance() {
        guard !appearanceSet else { return }
        appearanceSet = true
        let appearance: @convention(block) (AnyObject) -> Int = { _ in UIKeyboardAppearance.default.rawValue }
        let imp = imp_implementationWithBlock(appearance)
        let selector = NSSelectorFromString("keyboardAppearance")
        for name in [["WK", "Content", "View"], ["UI", "Text", "Input", "Traits"]] {
            guard let cls = NSClassFromString(name.joined()) else { continue }
            if let method = class_getInstanceMethod(cls, selector) {
                method_setImplementation(method, imp)
            } else {
                class_addMethod(cls, selector, imp, "q@:")
            }
        }
    }

    private static var focusAllowed = false

    /// A focus() from the page raises the keyboard as a tap would (Capacitor's
    /// setKeyboardShouldRequireUserInteraction(false)): WebKit's element-focus call is told the user is interacting.
    static func allowProgrammaticFocus() {
        guard !focusAllowed else { return }
        focusAllowed = true
        guard let cls = NSClassFromString(["WK", "Content", "View"].joined()) else { return }
        let selector = sel_getUid("_elementDidFocus:userIsInteracting:blurPreviousNode:activityStateChanges:userObject:")
        guard let method = class_getInstanceMethod(cls, selector) else { return }
        typealias Original = @convention(c) (AnyObject, Selector, UnsafeRawPointer, Bool, Bool, Bool, AnyObject?) -> Void
        let original = unsafeBitCast(method_getImplementation(method), to: Original.self)
        let block: @convention(block) (AnyObject, UnsafeRawPointer, Bool, Bool, Bool, AnyObject?) -> Void = { me, node, _, blur, changes, object in
            original(me, selector, node, true, blur, changes, object)
        }
        method_setImplementation(method, imp_implementationWithBlock(block))
    }
}

/// `StatusBar.setStyle` from the page (bridge.js setStatusBar): the status bar's text for the page's theme, as
/// Capacitor's StatusBar plugin set it ("DARK": a dark page, light text).
final class StatusBarPlugin: BridgePlugin {
    override var jsName: String { "StatusBar" }
    override var methods: Set<String> { ["setStyle"] }

    @objc func setStyle(_ call: BridgeCall) {
        let style: UIStatusBarStyle
        switch call.getString("style") {
        case "DARK": style = .lightContent
        case "LIGHT": style = .darkContent
        default: style = .default
        }
        Task { @MainActor in
            guard let controller = self.bridge?.viewController as? FoleviViewController else { return call.resolve() }
            controller.setStatusBarStyle(style)
            call.resolve()
        }
    }
}
