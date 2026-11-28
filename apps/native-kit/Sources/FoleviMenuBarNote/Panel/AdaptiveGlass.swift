import SwiftUI

/// Accessibility state, optionally overridden in DEBUG builds so verification can exercise the
/// fallbacks without changing the Mac's system settings.
enum A11yOverrides {
    static var reduceTransparency: Bool {
        #if DEBUG
        UserDefaults.standard.bool(forKey: "FoleviMenuBarNoteForceReduceTransparency")
        #else
        false
        #endif
    }
    static var increaseContrast: Bool {
        #if DEBUG
        UserDefaults.standard.bool(forKey: "FoleviMenuBarNoteForceIncreaseContrast")
        #else
        false
        #endif
    }
    static var reduceMotion: Bool {
        #if DEBUG
        UserDefaults.standard.bool(forKey: "FoleviMenuBarNoteForceReduceMotion")
        #else
        false
        #endif
    }
}

/// Liquid Glass that degrades properly: Reduce Transparency → a solid material with the same
/// shape and layout; Increase Contrast → a visible border.
struct AdaptiveGlass<S: InsettableShape>: ViewModifier {
    var glass: Glass
    var shape: S
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.colorSchemeContrast) private var contrast

    func body(content: Content) -> some View {
        let highContrast = contrast == .increased || A11yOverrides.increaseContrast
        if reduceTransparency || A11yOverrides.reduceTransparency {
            content
                .background(shape.fill(Color(nsColor: .windowBackgroundColor)))
                .overlay(shape.strokeBorder(Color.primary.opacity(highContrast ? 0.6 : 0.16), lineWidth: highContrast ? 1.5 : 1))
        } else {
            content
                .glassEffect(glass, in: shape)
                .overlay {
                    if highContrast { shape.strokeBorder(Color.primary.opacity(0.55), lineWidth: 1.2).allowsHitTesting(false) }
                }
        }
    }
}

extension View {
    func quickGlass<S: InsettableShape>(_ glass: Glass = .regular, in shape: S) -> some View {
        modifier(AdaptiveGlass(glass: glass, shape: shape))
    }
}
