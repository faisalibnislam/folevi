// Opening a note (plan 4.2): the card grows into the note, and the note shrinks back into the card when it closes
// (the edge swipe, or a swipe down on iOS 18). iOS 18 and later use UIKit's own zoom transition
// (`preferredTransition = .zoom`, the UIKit form of SwiftUI's `.navigationTransition(.zoom(sourceID:in:))`), with
// the card's frame from FoleviScreens (CardSource on open, CardFrames when it closes, since the list may have
// scrolled). iOS 17 gets a custom scale-and-fade from the card's frame, with the system's edge swipe to go back.
// Reduce Motion replaces both with a cross-fade.
//
// The cards are SwiftUI views inside a hosting controller, so the zoom's source is a stand-in placed over the card:
// a still of the card (the zoom hides it while it runs) above a patch of the canvas colour (which hides the real
// card meanwhile, as Photos hides a thumbnail while it zooms). Both go once the transition ends.
import UIKit
import FoleviDesign
import FoleviScreens

@MainActor
enum ZoomSources {
    private static var views: [UIView] = []

    static func removeAll() {
        views.forEach { $0.removeFromSuperview() }
        views.removeAll()
    }

    /// A stand-in for the card at `windowFrame`, inside `host` (the screen's view); nil when it isn't on screen.
    static func make(in host: UIView, windowFrame: CGRect, cornerRadius: CGFloat) -> UIView? {
        guard host.window != nil, !windowFrame.isEmpty else { return nil }
        let rect = host.convert(windowFrame, from: nil)
        let visible = host.bounds.inset(by: host.safeAreaInsets)
        guard rect.intersects(visible), rect.width > 4, rect.height > 4 else { return nil }
        removeAll()
        let hole = UIView(frame: rect)
        hole.backgroundColor = Chrome.canvas
        hole.layer.cornerRadius = cornerRadius
        hole.layer.cornerCurve = .continuous
        hole.isUserInteractionEnabled = false
        let still = host.resizableSnapshotView(from: rect, afterScreenUpdates: false, withCapInsets: .zero) ?? UIView()
        still.frame = rect
        still.layer.cornerRadius = cornerRadius
        still.layer.cornerCurve = .continuous
        still.clipsToBounds = true
        still.isUserInteractionEnabled = false
        host.addSubview(hole)
        host.addSubview(still)
        views = [hole, still]
        return still
    }

    static func radius(for kind: CardSource.Kind) -> CGFloat {
        switch kind {
        case .noteCard, .folderCard: FoleviTokens.Radius.panel
        case .noteRow: FoleviTokens.Radius.control
        }
    }
}

@MainActor
enum NoteTransitions {
    static var reduceMotion: Bool { UIAccessibility.isReduceMotionEnabled }

    /// Sets the iOS 18 zoom on a note about to be pushed from `source` (nothing for iOS 17 or Reduce Motion: the
    /// navigation delegate's animator does those).
    static func configure(_ note: NoteViewController, source: CardSource?) {
        guard !reduceMotion, source != nil else { return }
        if #available(iOS 18.0, *) {
            let options = UIViewController.Transition.ZoomOptions()
            options.dimmingColor = UIColor.black.withAlphaComponent(0.12)
            note.preferredTransition = .zoom(options: options) { [weak note] context in
                guard let note else { return nil }
                let host = context.sourceViewController.view
                // Closing: where the card is now (the list may have scrolled since).
                let current = note.source.flatMap { CardFrames.shared.source(for: $0.id) } ?? note.source
                guard let host, let current else { return nil }
                return ZoomSources.make(in: host, windowFrame: current.frame, cornerRadius: ZoomSources.radius(for: current.kind))
            }
        }
    }

    /// The push animation for iOS 17 (the zoom) and for Reduce Motion (a fade); nil leaves it to UIKit.
    static func animator(for note: NoteViewController, from: UIViewController) -> UIViewControllerAnimatedTransitioning? {
        if reduceMotion { return FadeAnimator() }
        if #available(iOS 18.0, *) { return nil }
        guard let source = note.source else { return nil }
        return ScaleFromCardAnimator(source: source)
    }
}

/// Reduce Motion: the note fades in over the list.
final class FadeAnimator: NSObject, UIViewControllerAnimatedTransitioning {
    func transitionDuration(using ctx: UIViewControllerContextTransitioning?) -> TimeInterval { 0.22 }

    func animateTransition(using ctx: UIViewControllerContextTransitioning) {
        guard let to = ctx.view(forKey: .to), let toVC = ctx.viewController(forKey: .to) else { return ctx.completeTransition(false) }
        to.frame = ctx.finalFrame(for: toVC)
        to.alpha = 0
        ctx.containerView.addSubview(to)
        UIView.animate(withDuration: transitionDuration(using: ctx), delay: 0, options: [.curveEaseOut]) {
            to.alpha = 1
        } completion: { _ in
            ctx.completeTransition(!ctx.transitionWasCancelled)
        }
    }
}

/// iOS 17: the note grows from the card's frame, its corners easing from the card's radius to the screen's.
final class ScaleFromCardAnimator: NSObject, UIViewControllerAnimatedTransitioning {
    let source: CardSource
    init(source: CardSource) { self.source = source }

    func transitionDuration(using ctx: UIViewControllerContextTransitioning?) -> TimeInterval { 0.42 }

    func animateTransition(using ctx: UIViewControllerContextTransitioning) {
        guard let to = ctx.view(forKey: .to), let toVC = ctx.viewController(forKey: .to) else { return ctx.completeTransition(false) }
        let container = ctx.containerView
        let final = ctx.finalFrame(for: toVC)
        to.frame = final
        container.addSubview(to)
        let start = container.convert(source.frame, from: nil)
        let sx = max(start.width / max(final.width, 1), 0.05)
        let sy = max(start.height / max(final.height, 1), 0.05)
        let s = max(sx, sy)
        to.transform = CGAffineTransform(translationX: start.midX - final.midX, y: start.midY - final.midY).scaledBy(x: s, y: s)
        to.layer.cornerRadius = ZoomSources.radius(for: source.kind) / s
        to.layer.cornerCurve = .continuous
        to.clipsToBounds = true
        to.alpha = 0.4
        let animator = UIViewPropertyAnimator(duration: transitionDuration(using: ctx), dampingRatio: 0.88) {
            to.transform = .identity
            to.layer.cornerRadius = 0
            to.alpha = 1
        }
        animator.addCompletion { _ in
            to.clipsToBounds = false
            ctx.completeTransition(!ctx.transitionWasCancelled)
        }
        animator.startAnimation()
    }
}
