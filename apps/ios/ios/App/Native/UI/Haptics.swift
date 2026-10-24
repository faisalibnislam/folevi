// The page's haptics (docs/IOS_POLISH_PLAN.md §2.5, lib/native/ui.ts feel()): iOS's own feedback generators,
// kept warm. `foleviNative.hapticPrepare(kind)` readies one when a finger lands on a control that will fire it
// (a generator that isn't prepared can play a few milliseconds late), `haptic(kind)` plays it.
import UIKit

enum NativeHaptics {
    /// What the page can ask for.
    enum Kind: String, CaseIterable {
        case light, medium, heavy, rigid, soft, selection, success, warning, error
    }

    @MainActor private static var impacts: [UIImpactFeedbackGenerator.FeedbackStyle: UIImpactFeedbackGenerator] = [:]
    @MainActor private static let selection = UISelectionFeedbackGenerator()
    @MainActor private static let notice = UINotificationFeedbackGenerator()

    /// A kind the page named, or nil for one it made up.
    static func kind(_ raw: String?) -> Kind? { raw.flatMap(Kind.init(rawValue:)) }

    /// The impact style for an impact kind (nil for selection and the notices).
    static func impactStyle(_ kind: Kind) -> UIImpactFeedbackGenerator.FeedbackStyle? {
        switch kind {
        case .light: .light
        case .medium: .medium
        case .heavy: .heavy
        case .rigid: .rigid
        case .soft: .soft
        case .selection, .success, .warning, .error: nil
        }
    }

    /// The notice type for a notice kind.
    static func noticeType(_ kind: Kind) -> UINotificationFeedbackGenerator.FeedbackType? {
        switch kind {
        case .success: .success
        case .warning: .warning
        case .error: .error
        default: nil
        }
    }

    @MainActor private static func impact(_ style: UIImpactFeedbackGenerator.FeedbackStyle) -> UIImpactFeedbackGenerator {
        if let g = impacts[style] { return g }
        let g = UIImpactFeedbackGenerator(style: style)
        impacts[style] = g
        return g
    }

    @MainActor static func prepare(_ kind: Kind) {
        if let style = impactStyle(kind) { impact(style).prepare() } else if kind == .selection { selection.prepare() } else { notice.prepare() }
    }

    @MainActor static func play(_ kind: Kind) {
        if let style = impactStyle(kind) {
            let g = impact(style)
            g.impactOccurred()
            // Ready for the next one (a swipe can cross its threshold twice).
            g.prepare()
        } else if kind == .selection {
            selection.selectionChanged()
            selection.prepare()
        } else if let type = noticeType(kind) {
            notice.notificationOccurred(type)
        }
    }
}

extension FoleviNativePlugin {
    /// { kind }: plays it.
    @objc func haptic(_ call: BridgeCall) {
        guard let kind = NativeHaptics.kind(call.getString("kind")) else { return call.reject("Unknown haptic") }
        Task { @MainActor in
            guard self.fromFolevi else { return call.reject("Not allowed here") }
            NativeHaptics.play(kind)
            call.resolve()
        }
    }

    /// { kind }: readies its generator.
    @objc func hapticPrepare(_ call: BridgeCall) {
        guard let kind = NativeHaptics.kind(call.getString("kind")) else { return call.reject("Unknown haptic") }
        Task { @MainActor in
            guard self.fromFolevi else { return call.reject("Not allowed here") }
            NativeHaptics.prepare(kind)
            call.resolve()
        }
    }
}
