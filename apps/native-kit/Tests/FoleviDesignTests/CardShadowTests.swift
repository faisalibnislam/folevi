// A note card's shadow while its hover changes (DocumentCard.tsx's NOTE_CARD_LINK: the lift and the shadow move
// together over 200 ms). Each outer shadow is drawn in a frame grown by its reach, with the card cut out of it; the
// frame animates from one reach to the other, so the cut-out has to as well, or for a few frames it's bigger than the
// card and a pale band shows between the card and its shadow (the owner's recording of 1.1.03, the ClimbOS card).
import CoreGraphics
import SwiftUI
import Testing
@testable import FoleviDesign

@Suite("Card shadow")
struct CardShadowTests {
    static let card = CGSize(width: 290, height: 313)

    /// The reach WebShapeBox gives a shadow layer.
    static func reach(_ l: ShadowLayer) -> CGFloat { abs(l.x) + abs(l.y) + abs(l.spread) + l.blur * 1.5 + 4 }

    /// Whether the shadow shows just inside and just outside the card's bottom edge, the frame grown by `reach` and
    /// the shape animated to the same reach (as SwiftUI drives both).
    static func bottomEdge(reach r: CGFloat) -> (inside: Bool, outside: Bool) {
        let frame = CGRect(x: 0, y: 0, width: card.width + r * 2, height: card.height + r * 2)
        var cut = WebShapeBox.OutsideOf(shape: .noteCard, reach: 0)
        cut.animatableData = r
        let path = cut.path(in: frame)
        let x = r + card.width / 2, bottom = r + card.height
        return (path.contains(CGPoint(x: x, y: bottom - 0.5), eoFill: true), path.contains(CGPoint(x: x, y: bottom + 0.5), eoFill: true))
    }

    @Test func theShadowMeetsTheCardThroughTheHover() {
        let rest = Self.reach(ShadowLayer(x: -4, y: 18, blur: 30, spread: -18, color: RGBA(20, 20, 30, 0.14)))
        let hover = Self.reach(WebNoteCard.hoverShadows[1])
        #expect(rest != hover)
        // Every step of the animation, out of the hover and into it: never on the card, never a gap under it.
        for t in stride(from: 0.0, through: 1.0, by: 0.1) {
            for (from, to) in [(hover, rest), (rest, hover)] {
                let edge = Self.bottomEdge(reach: from + (to - from) * t)
                #expect(!edge.inside && edge.outside, "t \(t)")
            }
        }
    }

    @Test func theReachAnimates() {
        // The shape takes its reach from the animation (it was a constant, so it jumped to the end at once).
        var cut = WebShapeBox.OutsideOf(shape: .noteCard, reach: 100)
        cut.animatableData = 92.5
        #expect(cut.reach == 92.5)
    }
}
