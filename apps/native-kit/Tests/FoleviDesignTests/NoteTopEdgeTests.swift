// A note's top bar follows its page (PhoneNoteBars.swift): which pages read dark (the status bar's text and the glass
// follow), and the frosted edge's fade, strong down the buttons and easing out with no step.
import CoreGraphics
import SwiftUI
import Testing
@testable import FoleviDesign

@Suite("Note top edge")
struct NoteTopEdgeTests {
    @Test func pagesThatReadDark() {
        // The page colours people pick (lib/themes.ts SHEETS): every light one keeps a dark clock and light glass.
        for hex in ["#ffffff", "#fbf8f2", "#f4ecdb", "#edf1f6", "#ecf2ea", "#f8ecec"] {
            #expect(PhoneNotePage(color: RGBA(hex: hex)!).dark == false, "\(hex)")
        }
        // Night, the app's dark canvas and a theme's deep page read dark.
        for hex in ["#161618", "#101011", "#25150e"] {
            #expect(PhoneNotePage(color: RGBA(hex: hex)!).dark, "\(hex)")
        }
        // Mid greys go by contrast: black text reads better on #808080, white on #6a6a6a.
        #expect(PhoneNotePage.readsDark(RGBA(128, 128, 128)) == false)
        #expect(PhoneNotePage.readsDark(RGBA(106, 106, 106)))
    }

    @Test func pageColourIsOpaque() {
        #expect(PhoneNotePage(color: RGBA(236, 242, 234, 0.4)).color == RGBA(236, 242, 234))
    }

    @Test func fadeEasesOutBelowTheButtons() {
        // An iPhone 18 Pro: the status bar 62 tall, the buttons end 48 under it.
        let (solid, fade) = PhoneNoteTopEdge.extent(top: 62, increaseContrast: false)
        #expect(solid <= 62 + 48 && solid + fade > 62 + 48 + 24)
        let stops = PhoneNoteTopEdge.fadeStops(solid: solid, fade: fade)
        let alphas = stops.map { $0.color.resolve(in: EnvironmentValues()).opacity }
        #expect(abs(alphas.first! - 1) < 0.001 && alphas.last! < 0.001)
        // Fully on down to `solid`, then falling, never rising, in steps of at most 0.11.
        #expect(stops.filter { $0.location <= solid / (solid + fade) + 0.0001 }.allSatisfy { $0.color.resolve(in: EnvironmentValues()).opacity > 0.999 })
        for (a, b) in zip(alphas, alphas.dropFirst()) {
            #expect(b <= a + 0.0001)
            #expect(a - b < 0.11)
        }
        #expect(zip(stops, stops.dropFirst()).allSatisfy { $0.location <= $1.location })
        // Increase Contrast: the colour reaches further down and the fade is shorter.
        let strong = PhoneNoteTopEdge.extent(top: 62, increaseContrast: true)
        #expect(strong.solid > solid && strong.fade < fade)
    }
}
