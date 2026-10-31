#if os(iOS)
import Testing
import CoreGraphics
@testable import FoleviDesign

/// The iPhone WebKit's `text-wrap: pretty` on the gates' paragraphs, as measured in the Simulator.
@Suite("Pretty wrap on the iPhone")
struct PrettyWrapTests {
    let cases: [(String, String, CGFloat, [String])] = [
        ("gates.footnote", "Notes on your devices stay in a folder you pick, such as iCloud Drive or Dropbox. Folevi's servers never see them.", 32, ["Notes on your devices stay in a folder you", "pick, such as iCloud Drive or Dropbox.", "Folevi's servers never see them."]),
        ("gates.lib.message.short", "Folevi keeps your notes as files in On My iPhone \u{203A} Folevi \u{203A} Folevi Library.", 0, ["Folevi keeps your notes as files in On My iPhone", "\u{203A} Folevi \u{203A} Folevi Library."]),
        ("gates.lib.message", "Folevi keeps your notes as files in one folder. Pick where that folder goes. If the place already holds your Folevi library, Folevi opens it.", 0, ["Folevi keeps your notes as files in one folder.", "Pick where that folder goes. If the place already", "holds your Folevi library, Folevi opens it."]),
    ]

    /// The weight the iPhone's paragraphs use (`WebTextWrap.iPhonePretty`): 0.5 to 0.75 all match these.
    @Test func theIPhonesWeightBreaksAsTheWebDoes() {
        FoleviFonts.register()
        for (id, text, pad, want) in cases {
            let s = WebStyles.named(id.replacingOccurrences(of: ".short", with: "")).light
            // (The ready screen's path is in medium weight, as the web sets it.)
            let runs = id.hasSuffix(".short") ? [WebRun("Folevi keeps your notes as files in "), WebRun("On My iPhone \u{203A} Folevi \u{203A} Folevi Library", weight: 500), WebRun(".")] : [WebRun(text)]
            let lines = WebLineBreaker.lines(runs, style: s.text, width: s.width - pad, wrap: .iPhonePretty).map { $0.map(\.text).joined() }
            #expect(lines == want, "\(id): \(lines)")
        }
    }
}
#endif
