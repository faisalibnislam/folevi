// The keyboard's moves, for the page's writing bar (docs/IOS_POLISH_PLAN.md §4.6; the page listens with
// lib/native/ui.ts onKeyboardFrame()): before the keyboard moves, its height when it lands, the move's duration
// and that it's iOS's keyboard curve, so a bar animated with the same numbers lands in the same frame instead of
// a frame behind (the visual viewport only changes after the keyboard has moved).
//
// With interactive dismissal on (`foleviNative.keyboard({ interactiveDismiss: true })`, the note editor), a drag
// down in a view that scrolls takes the keyboard with the finger, as in Notes and Craft, and the page gets the
// keyboard's height every frame while it follows the finger (duration 0, "linear").
//
// WKWebView's own bar above the keyboard ("‹ › Done") is already hidden by Capacitor's Keyboard plugin (its
// hideFormAccessoryBar is on from launch).
import UIKit
import WebKit

@MainActor
final class KeyboardBridge {
    static let shared = KeyboardBridge()

    private weak var plugin: FoleviNativePlugin?
    private var observers: [NSObjectProtocol] = []
    private let tracker = UIView()
    private var link: CADisplayLink?
    private var lastHeight: CGFloat = -1
    private(set) var interactiveDismiss = false
    private var visible = false

    /// UIKit's keyboard curve (UIView.AnimationCurve's raw 7, a spring that isn't in the enum).
    nonisolated static let keyboardCurve = 7

    /// What the page gets for a keyboard notification: the height it lands at over `bounds` (the screen, in the
    /// window's coordinates), its duration in ms, the curve's name and whether it's showing.
    nonisolated static func frame(userInfo: [AnyHashable: Any], bounds: CGRect, hiding: Bool) -> [String: Any] {
        let end = (userInfo[UIResponder.keyboardFrameEndUserInfoKey] as? NSValue)?.cgRectValue ?? .zero
        let duration = (userInfo[UIResponder.keyboardAnimationDurationUserInfoKey] as? NSNumber)?.doubleValue ?? 0.25
        let curve = (userInfo[UIResponder.keyboardAnimationCurveUserInfoKey] as? NSNumber)?.intValue ?? keyboardCurve
        let height = hiding ? 0 : coveredHeight(keyboard: end, bounds: bounds)
        return ["height": Double(height), "duration": (duration * 1000).rounded(), "curve": curve == keyboardCurve ? "keyboard" : "linear", "visible": height > 0]
    }

    /// How much of the bottom of `bounds` the keyboard covers: 0 when it's away, undocked or floating (iPad).
    nonisolated static func coveredHeight(keyboard: CGRect, bounds: CGRect) -> CGFloat {
        guard !keyboard.isEmpty, keyboard.maxY >= bounds.maxY - 1 else { return 0 }
        return max(0, (bounds.maxY - keyboard.minY).rounded())
    }

    func attach(_ plugin: FoleviNativePlugin) {
        self.plugin = plugin
        guard observers.isEmpty else { return }
        let center = NotificationCenter.default
        observers = [
            center.addObserver(forName: UIResponder.keyboardWillChangeFrameNotification, object: nil, queue: .main) { note in
                let info = note.userInfo ?? [:]
                MainActor.assumeIsolated { KeyboardBridge.shared.willChange(info, hiding: false) }
            },
            center.addObserver(forName: UIResponder.keyboardWillHideNotification, object: nil, queue: .main) { note in
                let info = note.userInfo ?? [:]
                MainActor.assumeIsolated { KeyboardBridge.shared.willChange(info, hiding: true) }
            },
            center.addObserver(forName: UIResponder.keyboardDidShowNotification, object: nil, queue: .main) { _ in
                MainActor.assumeIsolated { KeyboardBridge.shared.applyDismissMode() }
            },
        ]
    }

    private var screenBounds: CGRect {
        plugin?.bridge?.viewController?.view.window?.bounds ?? UIScreen.main.bounds
    }

    private func willChange(_ info: [AnyHashable: Any], hiding: Bool) {
        let frame = Self.frame(userInfo: info, bounds: screenBounds, hiding: hiding)
        let height = CGFloat((frame["height"] as? Double) ?? 0)
        visible = height > 0
        send(frame, height: height)
        if visible && interactiveDismiss { startTracking() } else { stopTracking() }
    }

    private func send(_ frame: [String: Any], height: CGFloat) {
        lastHeight = height
        // When it was sent (the keyboard sets off now): the page starts its bar as far along as the news took to
        // arrive, instead of a few frames behind the keyboard.
        var data = frame
        data["sentAt"] = (Date().timeIntervalSince1970 * 1000).rounded()
        plugin?.notifyListeners("keyboard", data: data)
    }

    // MARK: Interactive dismissal

    func setInteractiveDismiss(_ on: Bool) {
        interactiveDismiss = on
        applyDismissMode()
        if on && visible { startTracking() } else if !on { stopTracking() }
    }

    /// Every view that scrolls in the page (WebKit gives each `overflow: auto` view its own UIScrollView).
    private func applyDismissMode() {
        guard let webView = plugin?.bridge?.webView else { return }
        let mode: UIScrollView.KeyboardDismissMode = interactiveDismiss ? .interactive : .none
        func walk(_ view: UIView) {
            if let scroll = view as? UIScrollView { scroll.keyboardDismissMode = mode }
            view.subviews.forEach(walk)
        }
        walk(webView.scrollView)
        if interactiveDismiss && visible { startTracking() }
    }

    /// A view pinned to the keyboard's top (the keyboard layout guide follows a finger dragging it), read each frame.
    private func startTracking() {
        guard link == nil, let host = plugin?.bridge?.viewController?.view else { return }
        if tracker.superview !== host {
            tracker.removeFromSuperview()
            tracker.isUserInteractionEnabled = false
            tracker.isHidden = true
            tracker.translatesAutoresizingMaskIntoConstraints = false
            host.addSubview(tracker)
            NSLayoutConstraint.activate([
                tracker.leadingAnchor.constraint(equalTo: host.leadingAnchor),
                tracker.widthAnchor.constraint(equalToConstant: 1),
                tracker.heightAnchor.constraint(equalToConstant: 1),
                tracker.bottomAnchor.constraint(equalTo: host.keyboardLayoutGuide.topAnchor),
            ])
        }
        let link = CADisplayLink(target: DisplayTarget { KeyboardBridge.shared.tick() }, selector: #selector(DisplayTarget.fire))
        link.add(to: .main, forMode: .common)
        self.link = link
    }

    private func stopTracking() {
        link?.invalidate()
        link = nil
    }

    private func tick() {
        guard let host = tracker.superview, interactiveDismiss else { return stopTracking() }
        // Only while a finger drags the keyboard: its animated moves were sent before they started.
        guard Self.dragging(in: plugin?.bridge?.webView) else { return }
        host.layoutIfNeeded()
        let top = tracker.frame.maxY
        let height = max(0, (host.bounds.maxY - top).rounded())
        guard abs(height - lastHeight) >= 1 else { return }
        send(["height": Double(height), "duration": 0, "curve": "linear", "visible": height > 0], height: height)
    }

    /// Whether a finger is dragging one of the page's scrolling views.
    private static func dragging(in webView: WKWebView?) -> Bool {
        guard let webView else { return false }
        func walk(_ view: UIView) -> Bool {
            if let scroll = view as? UIScrollView, scroll.isTracking || scroll.isDragging { return true }
            return view.subviews.contains(where: walk)
        }
        return walk(webView.scrollView)
    }
}

/// CADisplayLink holds its target strongly: a small one that calls back.
private final class DisplayTarget: NSObject {
    let action: () -> Void
    init(_ action: @escaping () -> Void) { self.action = action }
    @objc func fire() { MainActor.assumeIsolated { action() } }
}

extension FoleviNativePlugin {
    /// { interactiveDismiss }: whether a drag down in a scrolling view takes the keyboard with the finger.
    @objc func keyboard(_ call: BridgeCall) {
        let on = call.getBool("interactiveDismiss") ?? false
        Task { @MainActor in
            guard self.fromFolevi else { return call.reject("Not allowed here") }
            KeyboardBridge.shared.setInteractiveDismiss(on)
            call.resolve()
        }
    }
}
