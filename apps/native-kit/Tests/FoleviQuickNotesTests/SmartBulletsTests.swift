import Testing
@testable import FoleviQuickNotes

struct SmartBulletsTests {
    @Test(arguments: [
        ("- ", ListMarker.bullet("•")), ("* ", .bullet("•")), ("• ", .bullet("•")), ("+ ", .bullet("•")),
        ("1. ", .number(1, delimiter: ".")), ("7) ", .number(7, delimiter: ")")),
        ("[ ] ", .checkbox(checked: false)), ("[x] ", .checkbox(checked: true)), ("- [ ] ", .checkbox(checked: false)),
    ])
    func triggers(_ typed: String, _ expected: ListMarker) {
        #expect(SmartBullets.trigger(typedPrefix: typed) == expected)
    }

    @Test(arguments: ["-", "a ", "1.", "12a. ", "- x", "[y] ", " - "])
    func nonTriggers(_ typed: String) {
        #expect(SmartBullets.trigger(typedPrefix: typed) == nil)
    }

    @Test func detectsMarkers() {
        #expect(SmartBullets.detect(paragraph: "• item", checkbox: nil) == ListPrefix(marker: .bullet("•"), length: 2))
        #expect(SmartBullets.detect(paragraph: "12. item", checkbox: nil) == ListPrefix(marker: .number(12, delimiter: "."), length: 4))
        #expect(SmartBullets.detect(paragraph: "\u{FFFC} item", checkbox: true) == ListPrefix(marker: .checkbox(checked: true), length: 2))
        #expect(SmartBullets.detect(paragraph: "plain", checkbox: nil) == nil)
        #expect(SmartBullets.detect(paragraph: "•no space", checkbox: nil) == nil)
    }

    @Test func returnContinuesAndEnds() {
        let bullet = ListPrefix(marker: .bullet("•"), length: 2)
        #expect(SmartBullets.returnAction(prefix: bullet, paragraph: "• milk", level: 0) == .continueList(.bullet("•")))
        #expect(SmartBullets.returnAction(prefix: bullet, paragraph: "• ", level: 0) == .endList)
        #expect(SmartBullets.returnAction(prefix: bullet, paragraph: "• ", level: 2) == .outdent)
        let number = ListPrefix(marker: .number(4, delimiter: "."), length: 3)
        #expect(SmartBullets.returnAction(prefix: number, paragraph: "4. four", level: 0) == .continueList(.number(5, delimiter: ".")))
        let task = ListPrefix(marker: .checkbox(checked: true), length: 2)
        #expect(SmartBullets.returnAction(prefix: task, paragraph: "\u{FFFC} done", level: 0) == .continueList(.checkbox(checked: false)))
        #expect(SmartBullets.returnAction(prefix: nil, paragraph: "text", level: 0) == .plainNewline)
    }

    @Test func plainModeContinuation() {
        let p = SmartBullets.plainPrefix(line: "    - [x] task")
        #expect(p?.indent == "    ")
        #expect(p.map(SmartBullets.plainContinuation) == "    - [ ] ")
        let n = SmartBullets.plainPrefix(line: "9. nine")
        #expect(n.map(SmartBullets.plainContinuation) == "10. ")
        #expect(SmartBullets.plainPrefix(line: "no list") == nil)
        #expect(SmartBullets.plainIsEmptyItem(line: "- ", prefix: SmartBullets.plainPrefix(line: "- ")!))
    }
}

struct TextCounterTests {
    @Test func countsWordsAndCharacters() {
        let c = TextCounter.count("Hello, world!  Two spaces.")
        #expect(c.words == 4)
        #expect(c.characters == 26)
        #expect(c.charactersExcludingSpaces == 22)
    }

    @Test func countsCJKWords() {
        #expect(TextCounter.count("日本語のテキスト").words >= 2)
        #expect(TextCounter.count("").words == 0)
    }

    @Test func ignoresAttachments() {
        #expect(TextCounter.count("\u{FFFC} a").characters == 2)
    }

    @Test func selectionCounts() {
        let counts = TextCounter.counts(for: "one two three", selection: "two three")
        #expect(counts.selectionWords == 2)
        #expect(counts.selectionCharacters == 9)
    }
}
