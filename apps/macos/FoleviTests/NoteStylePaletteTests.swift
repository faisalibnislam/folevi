import XCTest

/// The note style palette (packages/design-tokens/src/palette.ts, covers.json) and editor.css's
/// "Note style palette" rules. Expected colours were computed with the TS's own OKLab conversions and CSS
/// `color-mix(in oklab, …)` (premultiplied alpha) under `node --experimental-strip-types`.
final class NoteStylePaletteTests: XCTestCase {
    private struct Entry: Decodable {
        var id: String
        var paper: String?
        var paperDark: String?
        var accent: String?
        var accentDark: String?
        var text: [String]?
        var textDark: [String]?
        var names: [String]?
        var highlight: [String]?
        var highlightDark: [String]?

        var palette: NoteStylePalette? {
            NoteStylePalette(accent: accent, accentDark: accentDark, text: text, textDark: textDark,
                             highlight: highlight, highlightDark: highlightDark, names: names)
        }
    }

    private func covers() throws -> [Entry] {
        let data = try Data(contentsOf: Fixtures.repoRoot.appendingPathComponent("packages/design-tokens/covers/covers.json"))
        return try JSONDecoder().decode([Entry].self, from: data)
    }

    private func hex(_ h: String) -> PaletteColor { PaletteColor(hex: h)! }

    // MARK: OKLab mix

    func testOklabMixMatchesCssColorMix() {
        XCTAssertEqual(OKLab.mix(hex("#ff0000"), 0.5, hex("#0000ff")).hex, "#8c53a2")
        XCTAssertEqual(OKLab.mix(hex("#ffffff"), 0.25, hex("#000000")).hex, "#222222")
        XCTAssertEqual(OKLab.mix(hex("#a1410d"), 0.85, hex("#0d0d0f")).hex, "#883913")
        XCTAssertEqual(OKLab.mix(hex("#00ff00"), 0.3, hex("#ffff00")).hex, "#d2ff00")
    }

    func testOklabMixEndsAndRoundTrip() {
        for h in ["#a1410d", "#006590", "#fff3ee", "#25150e", "#000000", "#ffffff"] {
            XCTAssertEqual(OKLab.color(OKLab.lab(hex(h))).hex, h)
            XCTAssertEqual(OKLab.mix(hex(h), 1, hex("#123456")).hex, h)
            XCTAssertEqual(OKLab.mix(hex("#123456"), 0, hex(h)).hex, h)
        }
    }

    func testMixingWithTransparentKeepsTheColourAtThatOpacity() {
        let c = OKLab.mix(hex("#a1410d"), 0.7, .transparent)
        XCTAssertEqual(c.hex, "#a1410d")
        XCTAssertEqual(c.alpha, 0.7, accuracy: 1e-9)
        XCTAssertEqual(OKLab.mix(.transparent, 0.5, .transparent), .transparent)
    }

    func testHexParsing() {
        XCTAssertNil(PaletteColor(hex: "#12345"))
        XCTAssertNil(PaletteColor(hex: "#zzzzzz"))
        XCTAssertEqual(PaletteColor(hex: "a1410d")?.hex, "#a1410d")
    }

    // MARK: Palette data

    func testEveryStyleHasACompletePalette() throws {
        let all = try covers()
        XCTAssertEqual(all.count, 57)
        for e in all {
            let p = try XCTUnwrap(e.palette, e.id)
            XCTAssertEqual(p.names.count, 5, e.id)
            // palette.ts: the accent is the first text colour.
            XCTAssertEqual(p.light.accent.hex, e.accent, e.id)
            XCTAssertEqual(p.dark.accent.hex, e.accentDark, e.id)
        }
    }

    func testSlotsMapToTheWebsMarkIds() throws {
        let e = try XCTUnwrap(try covers().first { $0.id == "art-01" })
        let p = try XCTUnwrap(e.palette)
        XCTAssertEqual(NoteStylePalette.textSlots, [.accent, .moss, .marigold, .plum, .coral])
        XCTAssertEqual(NoteStylePalette.highlightSlots, [.yellow, .green, .blue, .pink])
        XCTAssertEqual(p.light.text(.accent)?.hex, "#a1410d")
        XCTAssertEqual(p.light.text(.moss)?.hex, "#6b5e00")
        XCTAssertEqual(p.light.text(.marigold)?.hex, "#1661ad")
        XCTAssertEqual(p.light.text(.plum)?.hex, "#006f4d")
        XCTAssertEqual(p.light.text(.coral)?.hex, "#9e427d")
        XCTAssertNil(p.light.text(.muted))
        XCTAssertEqual(p.dark.text(.coral)?.hex, "#e692c4")
        XCTAssertEqual(p.light.highlight(.yellow).hex, "#ffd8c7")
        XCTAssertEqual(p.light.highlight(.pink).hex, "#b4f2d4")
        XCTAssertEqual(p.dark.highlight(.blue).hex, "#234164")
        XCTAssertEqual(p.names, ["Coral", "Gold", "Blue", "Emerald", "Pink"])
    }

    func testAnIncompletePaletteKeepsTheFixedColours() {
        let five = ["#111111", "#222222", "#333333", "#444444", "#555555"], four = ["#111111", "#222222", "#333333", "#444444"]
        XCTAssertNotNil(NoteStylePalette(accent: "#111111", accentDark: "#111111", text: five, textDark: five, highlight: four, highlightDark: four))
        XCTAssertNil(NoteStylePalette(accent: nil, accentDark: "#111111", text: five, textDark: five, highlight: four, highlightDark: four))
        XCTAssertNil(NoteStylePalette(accent: "#111111", accentDark: "#111111", text: Array(five.prefix(4)), textDark: five, highlight: four, highlightDark: four))
        XCTAssertNil(NoteStylePalette(accent: "#111111", accentDark: "#111111", text: five, textDark: five, highlight: four, highlightDark: nil))
        XCTAssertNil(NoteStylePalette(accent: "#111111", accentDark: "#111111", text: five, textDark: five, highlight: ["#111111", "#222222", "#333333", "bad"], highlightDark: four))
    }

    func testThePaletteAppliesOnlyWhileThePageColourIsOnAuto() {
        XCTAssertTrue(NoteStylePalette.applies(sheet: nil))
        for sheet in DocumentSheet.allCases { XCTAssertFalse(NoteStylePalette.applies(sheet: sheet), sheet.rawValue) }
    }

    // MARK: editor.css rules

    private struct Expected {
        var accentSoft, codeBg, checkTop, checkShadow, underline, calloutNote, calloutInfo: String
    }

    func testLookMatchesTheWebsColorMixes() throws {
        let expected: [String: Expected] = [
            "art-01": Expected(accentSoft: "#f4dacf", codeBg: "#fae8e1", checkTop: "#b56442", checkShadow: "#a1410d", underline: "#a1410d", calloutNote: "#ffe3d7", calloutInfo: "#f3eac6"),
            "art-01-dark": Expected(accentSoft: "#3e251a", codeBg: "#2f1c13", checkTop: "#f8ad8e", checkShadow: "#f49a75", underline: "#f49a75", calloutNote: "#3b2015", calloutInfo: "#33260f"),
            "art-30": Expected(accentSoft: "#cee3ef", codeBg: "#dfeff8", checkTop: "#4280a4", checkShadow: "#006590", underline: "#006590", calloutNote: "#d3eeff", calloutInfo: "#f8e6d9"),
            "art-30-dark": Expected(accentSoft: "#152f3e", codeBg: "#0f242f", checkTop: "#7ec9f5", checkShadow: "#5dbcf2", underline: "#5dbcf2", calloutNote: "#0e2c3c", calloutInfo: "#2c2723"),
            "art-57": Expected(accentSoft: "#f1d7e6", codeBg: "#f9e6f1", checkTop: "#ab6091", checkShadow: "#963d7a", underline: "#963d7a", calloutNote: "#ffdef2", calloutInfo: "#eee4fd"),
            "art-57-dark": Expected(accentSoft: "#3b2432", codeBg: "#2d1b26", checkTop: "#eda8d4", checkShadow: "#e895ca", underline: "#e895ca", calloutNote: "#371f2e", calloutInfo: "#2f2237"),
        ]
        let all = try covers()
        for (key, want) in expected {
            let dark = key.hasSuffix("-dark")
            let id = dark ? String(key.dropLast(5)) : key
            let e = try XCTUnwrap(all.first { $0.id == id })
            let surface = hex(try XCTUnwrap(dark ? e.paperDark : e.paper))
            let look = try XCTUnwrap(e.palette).look(dark: dark, surface: surface)
            XCTAssertEqual(look.accent.hex, dark ? e.accentDark : e.accent, key)
            XCTAssertEqual(look.accentSoft.hex, want.accentSoft, key)
            XCTAssertEqual(look.codeBackground.hex, want.codeBg, key)
            XCTAssertEqual(look.checkTop.hex, want.checkTop, key)
            XCTAssertEqual(look.checkShadow.hex, want.checkShadow, key)
            XCTAssertEqual(look.checkShadow.alpha, 0.45, accuracy: 1e-9, key)
            XCTAssertEqual(look.underline.hex, want.underline, key)
            XCTAssertEqual(look.underline.alpha, 0.7, accuracy: 1e-9, key)
            XCTAssertEqual(look.linkUnderline.alpha, 0.35, accuracy: 1e-9, key)
            XCTAssertEqual(look.pageLinkUnderline.alpha, 0.55, accuracy: 1e-9, key)
            XCTAssertEqual(look.calloutMix, dark ? 0.4 : 0.6, key)
            let note = try XCTUnwrap(look.callout(.note))
            XCTAssertEqual(note.background.hex, want.calloutNote, key)
            XCTAssertEqual(note.icon, look.accent, key)
            let info = try XCTUnwrap(look.callout(.info))
            XCTAssertEqual(info.background.hex, want.calloutInfo, key)
            XCTAssertEqual(info.icon, look.text(.moss), key)
            // Success, warning and danger keep their meaning colours.
            XCTAssertNil(look.callout(.success))
            XCTAssertNil(look.callout(.warning))
            XCTAssertNil(look.callout(.danger))
        }
    }
}
