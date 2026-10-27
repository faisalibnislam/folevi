// text-wrap: pretty: the breaks WebKit chose for two paragraphs the screenshot diffs compare (Help's intro at
// 704 pt, Reviews' empty-state hint at 400 pt).
import Testing
import CoreGraphics
@testable import FoleviDesign

@Suite struct WebPrettyWrapTests {
    let body = WebTextStyle(size: 16, leading: 24.8)
    let hint = WebTextStyle(size: 13, leading: 21.125)

    @Test func helpIntro() {
        let lines = WebPrettyWrap.lines("The full guide lives at folevi.com/docs. Questions or problems? Contact support below, or write to support@folevi.com. Security reports: security@folevi.com.", style: body, width: 704)
        #expect(lines == ["The full guide lives at folevi.com/docs. Questions or problems? Contact support below,", "or write to support@folevi.com. Security reports: security@folevi.com."])
    }

    @Test func reviewsHint() {
        let lines = WebPrettyWrap.lines("To make cards, ask Foli AI for flashcards on a note, or turn a toggle into a flashcard from its block menu.", style: hint, width: 400)
        #expect(lines == ["To make cards, ask Foli AI for flashcards on a note, or turn", "a toggle into a flashcard from its block menu."])
    }

    @Test func oneLineStaysOne() {
        #expect(WebPrettyWrap.lines("Cards from your notes come back here when they're due.", style: WebTextStyle(size: 14, leading: 22.75), width: 400).count == 1)
    }
}
