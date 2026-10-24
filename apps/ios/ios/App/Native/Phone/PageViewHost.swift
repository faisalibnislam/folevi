// Where the Page View is (plan 2.1 and 4.2). One WKWebView per window does two jobs: the engine native screens
// query, and the note page while a note is open. Behind the native root it stays attached to the window (so
// WebKit keeps its timers running), covered by the opaque screens and taking no touches; a note screen adopts it
// as its content, and gives it back when no note is on screen any more. A note screen that loses it to another
// (a link from one note to the next) keeps a still of the page in its place until it gets it back.
import ObjectiveC
import UIKit
import WebKit

@MainActor
protocol PageViewOwner: AnyObject {
    /// The page view is leaving for another owner: leave a still of it where it was.
    func pageViewWillLeave(_ pageView: WKWebView)
    /// The view the page view goes into (at the back, under the bars).
    var pageViewContainer: UIView { get }
}

@MainActor
final class PageViewHost {
    let pageView: WKWebView
    /// Where it waits when no note is on screen (the frame's root view, at the back).
    weak var parking: UIView?
    private(set) weak var owner: PageViewOwner?

    init(pageView: WKWebView) {
        self.pageView = pageView
        Self.withoutSafeArea(pageView)
    }

    /// The page's env(safe-area-inset-*) reads 0: native sends the bars' room with `insets` instead, so the two
    /// never add up (WebKit's `_setUnobscuredSafeAreaInsets:`, the call Safari makes for its own bars; skipped when
    /// a WebKit build doesn't have it).
    static func withoutSafeArea(_ v: WKWebView) {
        let sel = NSSelectorFromString("_setUnobscuredSafeAreaInsets:")
        guard v.responds(to: sel), let m = class_getInstanceMethod(WKWebView.self, sel) else { return }
        typealias Setter = @convention(c) (AnyObject, Selector, UIEdgeInsets) -> Void
        unsafeBitCast(method_getImplementation(m), to: Setter.self)(v, sel, .zero)
    }

    /// Back behind the native root (no note on screen).
    func park() {
        owner = nil
        guard let parking else { return }
        pageView.isUserInteractionEnabled = false
        pageView.accessibilityElementsHidden = true
        if pageView.superview !== parking {
            pageView.removeFromSuperview()
            pageView.translatesAutoresizingMaskIntoConstraints = true
            pageView.frame = parking.bounds
            pageView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            parking.insertSubview(pageView, at: 0)
        }
    }

    /// A note screen takes it.
    func adopt(by next: PageViewOwner) {
        if owner === next, pageView.superview === next.pageViewContainer { return }
        owner?.pageViewWillLeave(pageView)
        owner = next
        let container = next.pageViewContainer
        pageView.removeFromSuperview()
        pageView.translatesAutoresizingMaskIntoConstraints = true
        pageView.frame = container.bounds
        pageView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        pageView.isUserInteractionEnabled = true
        pageView.accessibilityElementsHidden = false
        container.insertSubview(pageView, at: 0)
    }

    func isOwned(by o: PageViewOwner) -> Bool { owner === o }

    /// A still of what the page shows now (cheap: a snapshot view, no render pass).
    func still() -> UIView? {
        pageView.snapshotView(afterScreenUpdates: false)
    }
}

/// Holds the page view for a screen with no safe area of its own: the page's env(safe-area-inset-*) reads 0 and
/// the native bars' room comes only from the `insets` editor command (--native-inset-top/bottom), so the two never
/// add up. Its parent calls `match(_:)` whenever its own safe area changes.
@MainActor
final class PageViewHolder: UIViewController {
    override func loadView() {
        view = UIView()
        view.backgroundColor = .clear
    }

    /// Cancels the parent's safe area (the status bar, the navigation bar, the home indicator) for the page.
    func match(_ parentInsets: UIEdgeInsets) {
        let next = UIEdgeInsets(top: -parentInsets.top, left: -parentInsets.left, bottom: -parentInsets.bottom, right: -parentInsets.right)
        if additionalSafeAreaInsets != next { additionalSafeAreaInsets = next }
    }

    /// Adds it to `parent`, filling its view, at the back.
    static func install(in parent: UIViewController) -> PageViewHolder {
        let h = PageViewHolder()
        parent.addChild(h)
        h.view.frame = parent.view.bounds
        h.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        parent.view.insertSubview(h.view, at: 0)
        h.didMove(toParent: parent)
        return h
    }
}
