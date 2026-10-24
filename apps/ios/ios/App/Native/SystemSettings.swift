// What iOS knows about the person's settings that a web view can't read, handed to the page (bridge.js):
// Reduce Transparency, Increase Contrast, Bold Text, Reduce Motion, the text size (Dynamic Type) and whether a
// hardware keyboard is attached, and
// taps on the status bar, which scroll the current screen back to its top as in every iOS app.
//
// The page scrolls inside its own views, not as a page, so the web view's scroll view has nothing to scroll
// when the status bar is tapped. A scroll view of the app's own (StatusBarTapProxy, behind the web view) is
// the one iOS asks instead, and the page is told (the "folevi:status-bar-tap" window event).
import GameController
import UIKit

enum SystemAccessibility {
    /// iOS's body text size at the person's setting over its default (17 pt), as a percentage: 100 by
    /// default, 135 at the largest standard size, up to about 310 at the largest accessibility size.
    @MainActor static var textScale: Int {
        let body = UIFont.preferredFont(forTextStyle: .body, compatibleWith: UITraitCollection(preferredContentSizeCategory: UIApplication.shared.preferredContentSizeCategory)).pointSize
        return Int((body / 17 * 100).rounded())
    }

    @MainActor static func current() -> [String: Any] {
        [
            "reduceTransparency": UIAccessibility.isReduceTransparencyEnabled,
            "increaseContrast": UIAccessibility.isDarkerSystemColorsEnabled,
            "boldText": UIAccessibility.isBoldTextEnabled,
            "reduceMotion": UIAccessibility.isReduceMotionEnabled,
            "textScale": textScale,
            // A hardware keyboard (the Magic Keyboard, a Bluetooth one): the iPad layout shows keyboard hints
            // such as ⌘K only while one is attached.
            "hardwareKeyboard": GCKeyboard.coalesced != nil,
        ]
    }

    /// The notifications that change any of them.
    static let changes: [Notification.Name] = [
        UIAccessibility.reduceTransparencyStatusDidChangeNotification,
        UIAccessibility.darkerSystemColorsStatusDidChangeNotification,
        UIAccessibility.boldTextStatusDidChangeNotification,
        UIAccessibility.reduceMotionStatusDidChangeNotification,
        UIContentSizeCategory.didChangeNotification,
        .GCKeyboardDidConnect,
        .GCKeyboardDidDisconnect,
    ]
}

/// A scroll view that never shows or scrolls: it's there so a tap on the status bar has somewhere to go.
/// It sits behind the web view (which no longer answers status bar taps itself) and says when one came.
final class StatusBarTapProxy: UIScrollView, UIScrollViewDelegate {
    var onTap: (() -> Void)?

    override init(frame: CGRect) {
        super.init(frame: frame)
        delegate = self
        scrollsToTop = true
        showsVerticalScrollIndicator = false
        showsHorizontalScrollIndicator = false
        backgroundColor = .clear
        isAccessibilityElement = false
        accessibilityElementsHidden = true
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    /// Fills `bounds`, a point taller, scrolled down by that point: iOS only asks a scroll view that isn't
    /// already at its top.
    func fit(_ bounds: CGRect) {
        guard frame != bounds || contentOffset.y < 1 else { return }
        frame = bounds
        contentSize = CGSize(width: bounds.width, height: bounds.height + 2)
        contentOffset = CGPoint(x: 0, y: 1)
    }

    func scrollViewShouldScrollToTop(_ scrollView: UIScrollView) -> Bool {
        onTap?()
        return false
    }
}

extension FoleviNativePlugin {
    /// { r, g, b }: the colour behind the web view. While the keyboard is up the web view ends at its top, and
    /// the keyboard's rounded corners show what's behind (black by default); the page sets this to what's on
    /// screen just above the keyboard (the note, an open sheet), so it reads as carrying on behind it.
    @objc func setBackdrop(_ call: BridgeCall) {
        let channel = { (key: String) in CGFloat(min(max(call.getDouble(key) ?? 255, 0), 255) / 255) }
        let color = UIColor(red: channel("r"), green: channel("g"), blue: channel("b"), alpha: 1)
        Task { @MainActor in
            guard self.fromFolevi else { return call.reject("Not allowed here") }
            self.bridge?.viewController?.view.backgroundColor = color
            self.bridge?.viewController?.view.window?.backgroundColor = color
            call.resolve()
        }
    }

    /// { reduceTransparency, increaseContrast, boldText, reduceMotion, textScale, hardwareKeyboard } (SystemAccessibility).
    @objc func accessibility(_ call: BridgeCall) {
        Task { @MainActor in
            guard self.fromFolevi else { return call.reject("Not allowed here") }
            call.resolve(SystemAccessibility.current())
        }
    }
}
