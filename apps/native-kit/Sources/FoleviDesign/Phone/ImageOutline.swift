// A picture's edge (globals.css `.ui-img-outline`): 1 point inside it, black at 10% in light and white at 10% in
// dark, never a tinted grey, so a photo with a light edge doesn't bleed into the surface under it and a dark
// sheet doesn't get a grimy ring.
import SwiftUI

public extension View {
    /// Draws a picture's 1 pt inner edge along `shape` (use the same shape the picture is clipped to).
    func imageOutline<S: InsettableShape>(_ shape: S) -> some View { modifier(ImageOutline(shape: shape)) }
}

struct ImageOutline<S: InsettableShape>: ViewModifier {
    let shape: S
    @Environment(\.colorScheme) private var scheme

    func body(content: Content) -> some View {
        content.overlay(
            shape.strokeBorder(scheme == .dark ? Color.white.opacity(0.1) : Color.black.opacity(0.1), lineWidth: 1)
                .allowsHitTesting(false)
        )
    }
}
