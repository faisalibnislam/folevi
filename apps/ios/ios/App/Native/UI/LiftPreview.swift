// The lifted preview of a long press (docs/IOS_POLISH_PLAN.md §4.1; the page's side is apps/web
// src/lib/native/lift.ts). The menu stays the page's own, in Folevi's fonts (the owner's decision D1); what
// the app adds is what a web page can't do: the thing held floats above the page, crisp over the page's frosted
// backdrop, on a spring, with a real shadow.
//
// 1. arm: a finger has rested on something for a moment. Its picture is taken now, while it's drawn at rest
//    (WKWebView.takeSnapshot of that rectangle).
// 2. lift: its menu opened. The picture goes over the web view at the same place, from the scale the page had
//    pressed it in to, and springs to 1.04 with an 18 pt shadow. It never takes touches: a tap on it reaches the
//    page (which closes the menu, as a tap outside it does).
// 2b. move: the page's menu needed the room (it fits whole under the thing only higher up): the picture moves up
//    on the settle spring, as iOS moves its preview, and comes back down when it drops.
// 3. drop: the menu closed. The picture settles back into place and goes, or fades where it is (the thing is
//    gone, or was dragged away).
//
// Reduce Motion: no spring, the picture fades in and out (150 ms).
import UIKit
import WebKit

@MainActor
final class LiftPreview {
    static let shared = LiftPreview()

    /// The lift's spring (§2.4: response 0.25 s, damping 0.7) and the scale it lifts to.
    static let liftSpring = (response: 0.25, damping: 0.7)
    static let settleSpring = (response: 0.3, damping: 1.0)
    static let liftedScale: CGFloat = 1.04
    /// A picture not lifted within this long is let go (the finger moved on, or the page never asked).
    static let armLifetime: TimeInterval = 2
    /// How long a lift waits for a picture still being taken.
    static let pictureWait: TimeInterval = 0.35

    private struct Armed {
        let rect: CGRect
        let radius: CGFloat
        let at: Date
        var image: UIImage?
        var taken = false
    }

    private var armed: [String: Armed] = [:]
    private var waiting: [String: [(UIImage?) -> Void]] = [:]
    private var shown: [String: PreviewView] = [:]
    private var resign: NSObjectProtocol?

    private init() {
        // Leaving the app takes any picture away (it would be stale when the app comes back).
        resign = NotificationCenter.default.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: .main) { _ in
            MainActor.assumeIsolated { LiftPreview.shared.dropAll() }
        }
    }

    /// UIKit's spring (mass 1) for a response and a damping ratio, as SwiftUI and the page describe springs.
    nonisolated static func springParameters(response: Double, damping: Double) -> (mass: CGFloat, stiffness: CGFloat, damping: CGFloat) {
        let w = 2 * Double.pi / response
        return (1, CGFloat(w * w), CGFloat(4 * Double.pi * damping / response))
    }

    nonisolated static func spring(response: Double, damping: Double) -> UISpringTimingParameters {
        let p = springParameters(response: response, damping: damping)
        return UISpringTimingParameters(mass: p.mass, stiffness: p.stiffness, damping: p.damping, initialVelocity: .zero)
    }

    /// A rectangle the page sent ({ x, y, width, height }, CSS pixels of what's visible: the web view's points), or nil.
    nonisolated static func rect(_ raw: [String: Any]?) -> CGRect? {
        guard let raw else { return nil }
        let n = { (k: String) -> CGFloat? in (raw[k] as? NSNumber).map { CGFloat(truncating: $0) } }
        guard let x = n("x"), let y = n("y"), let w = n("width"), let h = n("height"), w.isFinite, h.isFinite, x.isFinite, y.isFinite, w >= 4, h >= 4, w <= 4000, h <= 4000 else { return nil }
        return CGRect(x: x, y: y, width: w, height: h)
    }

    /// Whether `id` has a picture waiting to lift (or being taken).
    func isArmed(_ id: String) -> Bool { armed[id] != nil }

    // MARK: 1. arm

    func arm(id: String, rect: CGRect, radius: CGFloat, in webView: WKWebView) {
        prune()
        // One press at a time: an older picture not lifted goes.
        for (other, _) in armed where shown[other] == nil { forget(other) }
        let visible = rect.intersection(webView.bounds)
        guard !visible.isNull, visible.width >= 4, visible.height >= 4 else { return }
        armed[id] = Armed(rect: visible, radius: max(0, min(radius, 40)), at: Date())
        let config = WKSnapshotConfiguration()
        config.rect = visible
        // What's on screen now (the thing at rest), without waiting for the page to draw again.
        config.afterScreenUpdates = false
        webView.takeSnapshot(with: config) { [weak self] image, _ in
            MainActor.assumeIsolated {
                guard let self, self.armed[id] != nil else { return }
                self.armed[id]?.image = image
                self.armed[id]?.taken = true
                self.waiting.removeValue(forKey: id)?.forEach { $0(image) }
            }
        }
    }

    // MARK: 2. lift

    /// Lifts `id`'s picture from `from` (the page's pressed-in scale). False when there's no picture for it.
    func lift(id: String, from: CGFloat, in webView: WKWebView) async -> Bool {
        guard let entry = armed[id], shown[id] == nil else { return shown[id] != nil }
        let image: UIImage? = entry.taken ? entry.image : await picture(id)
        guard let image, armed[id] != nil, let host = webView.superview else { return false }
        let preview = PreviewView(image: image, radius: entry.radius)
        preview.frame = webView.convert(entry.rect, to: host)
        preview.home = preview.center
        host.insertSubview(preview, aboveSubview: webView)
        shown[id] = preview
        let start = min(max(from, 0.8), 1.1)
        if UIAccessibility.isReduceMotionEnabled {
            preview.alpha = 0
            preview.transform = CGAffineTransform(scaleX: Self.liftedScale, y: Self.liftedScale)
            preview.setShadow(lifted: true, duration: 0.15)
            UIView.animate(withDuration: 0.15) { preview.alpha = 1 }
        } else {
            preview.transform = CGAffineTransform(scaleX: start, y: start)
            preview.setShadow(lifted: true, duration: 0.25)
            let animator = UIViewPropertyAnimator(duration: 0.5, timingParameters: Self.spring(response: Self.liftSpring.response, damping: Self.liftSpring.damping))
            animator.addAnimations { preview.transform = CGAffineTransform(scaleX: Self.liftedScale, y: Self.liftedScale) }
            animator.startAnimation()
        }
        return true
    }

    /// The picture for `id` once it's taken, or nil if it doesn't come in time.
    private func picture(_ id: String) async -> UIImage? {
        await withCheckedContinuation { (cont: CheckedContinuation<UIImage?, Never>) in
            var done = false
            let finish = { (image: UIImage?) in
                guard !done else { return }
                done = true
                cont.resume(returning: image)
            }
            waiting[id, default: []].append(finish)
            DispatchQueue.main.asyncAfter(deadline: .now() + Self.pictureWait) { finish(nil) }
        }
    }

    // MARK: 2b. move

    /// Moves `id`'s picture `dy` points up from where it lifted (0: back to it).
    func move(id: String, dy: CGFloat) {
        guard let preview = shown[id] else { return }
        let to = CGPoint(x: preview.home.x, y: preview.home.y - max(0, min(dy, 2000)))
        if UIAccessibility.isReduceMotionEnabled {
            UIView.animate(withDuration: 0.15) { preview.center = to }
            return
        }
        let animator = UIViewPropertyAnimator(duration: 0.5, timingParameters: Self.spring(response: Self.settleSpring.response, damping: Self.settleSpring.damping))
        animator.addAnimations { preview.center = to }
        animator.startAnimation()
    }

    // MARK: 3. drop

    /// Settles the picture back ("back") or fades it ("fade"); returns once it's back in place (or gone).
    func drop(id: String, to: String) async {
        guard let preview = shown.removeValue(forKey: id) else { return forget(id) }
        forget(id)
        let reduce = UIAccessibility.isReduceMotionEnabled
        if to == "back" && !reduce {
            preview.setShadow(lifted: false, duration: 0.25)
            let animator = UIViewPropertyAnimator(duration: 0.5, timingParameters: Self.spring(response: Self.settleSpring.response, damping: Self.settleSpring.damping))
            animator.addAnimations {
                preview.transform = .identity
                preview.center = preview.home
            }
            await withCheckedContinuation { (cont: CheckedContinuation<Void, Never>) in
                animator.addCompletion { _ in cont.resume() }
                animator.startAnimation()
            }
            // Back in place: the page shows the thing again under it, then the picture goes.
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.08) {
                UIView.animate(withDuration: 0.1, animations: { preview.alpha = 0 }, completion: { _ in preview.removeFromSuperview() })
            }
        } else {
            await withCheckedContinuation { (cont: CheckedContinuation<Void, Never>) in
                UIView.animate(withDuration: reduce ? 0.15 : 0.2, animations: { preview.alpha = 0 }, completion: { _ in
                    preview.removeFromSuperview()
                    cont.resume()
                })
            }
        }
    }

    func dropAll() {
        for (_, preview) in shown { preview.removeFromSuperview() }
        shown.removeAll()
        for id in armed.keys { forget(id) }
    }

    private func forget(_ id: String) {
        armed.removeValue(forKey: id)
        waiting.removeValue(forKey: id)?.forEach { $0(nil) }
    }

    private func prune() {
        let now = Date()
        for (id, a) in armed where shown[id] == nil && now.timeIntervalSince(a.at) > Self.armLifetime { forget(id) }
    }
}

/// The picture with its rounded corners (continuous, as iOS draws them) and its shadow.
final class PreviewView: UIView {
    private let picture = UIImageView()

    init(image: UIImage, radius: CGFloat) {
        super.init(frame: .zero)
        isUserInteractionEnabled = false
        accessibilityElementsHidden = true
        picture.image = image
        picture.contentMode = .scaleToFill
        picture.layer.cornerRadius = radius
        picture.layer.cornerCurve = .continuous
        picture.layer.masksToBounds = true
        picture.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        addSubview(picture)
        layer.shadowColor = UIColor.black.cgColor
        layer.shadowOpacity = 0
        layer.shadowRadius = 18
        layer.shadowOffset = CGSize(width: 0, height: 8)
        self.radius = radius
    }

    private var radius: CGFloat = 0
    /// Where it lifted (its centre in the host), which a move goes up from and a drop comes back to.
    var home: CGPoint = .zero

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override func layoutSubviews() {
        super.layoutSubviews()
        picture.frame = bounds
        layer.shadowPath = UIBezierPath(roundedRect: bounds, cornerRadius: radius).cgPath
    }

    /// Fades the shadow in (lifted) or out.
    func setShadow(lifted: Bool, duration: TimeInterval) {
        let dark = traitCollection.userInterfaceStyle == .dark
        let to: Float = lifted ? (dark ? 0.5 : 0.2) : 0
        let fade = CABasicAnimation(keyPath: "shadowOpacity")
        fade.fromValue = layer.presentation()?.shadowOpacity ?? layer.shadowOpacity
        fade.toValue = to
        fade.duration = duration
        fade.timingFunction = CAMediaTimingFunction(name: .easeOut)
        layer.shadowOpacity = to
        layer.add(fade, forKey: "shadowOpacity")
    }
}

extension FoleviNativePlugin {
    /// { id, rect: { x, y, width, height }, radius }: takes the picture of what a finger is resting on.
    @objc func liftArm(_ call: BridgeCall) {
        guard let id = call.getString("id"), !id.isEmpty, id.count <= 64, let rect = LiftPreview.rect(call.getObject("rect")) else { return call.reject("A lift needs an id and a rectangle") }
        let radius = CGFloat(call.getDouble("radius") ?? 12)
        Task { @MainActor in
            guard self.fromFolevi, let webView = self.bridge?.webView else { return call.reject("Not allowed here") }
            LiftPreview.shared.arm(id: id, rect: rect, radius: radius, in: webView)
            call.resolve()
        }
    }

    /// { id, from }: lifts the picture; { value: false } when there's none.
    @objc func lift(_ call: BridgeCall) {
        guard let id = call.getString("id") else { return call.reject("A lift needs an id") }
        let from = CGFloat(call.getDouble("from") ?? 1)
        Task { @MainActor in
            guard self.fromFolevi, let webView = self.bridge?.webView else { return call.reject("Not allowed here") }
            let ok = await LiftPreview.shared.lift(id: id, from: from, in: webView)
            call.resolve(["value": ok])
        }
    }

    /// { id, dy }: moves the lifted picture `dy` points up (0: back), so the page's menu fits under it.
    @objc func liftMove(_ call: BridgeCall) {
        guard let id = call.getString("id") else { return call.reject("A lift needs an id") }
        let dy = CGFloat(call.getDouble("dy") ?? 0)
        guard dy.isFinite else { return call.reject("Not a distance") }
        Task { @MainActor in
            guard self.fromFolevi else { return call.reject("Not allowed here") }
            LiftPreview.shared.move(id: id, dy: dy)
            call.resolve()
        }
    }

    /// { id, to: "back" | "fade" }: lets the picture go; resolves once it's back in place.
    @objc func liftDrop(_ call: BridgeCall) {
        guard let id = call.getString("id") else { return call.reject("A lift needs an id") }
        let to = call.getString("to") == "fade" ? "fade" : "back"
        Task { @MainActor in
            guard self.fromFolevi else { return call.reject("Not allowed here") }
            await LiftPreview.shared.drop(id: id, to: to)
            call.resolve()
        }
    }
}
