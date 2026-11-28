import AppKit
import Testing
@testable import FoleviQuickNotes

@MainActor
struct MarkdownRoundTripTests {
    let style = TextStyle(fontSize: 14, lineHeightMultiple: 1.35, bulletGlyph: "•")

    /// Markdown → rich text → Markdown must be identical for canonical input.
    @Test(arguments: [
        "plain line",
        "**bold** and *italic* and ~~strike~~ and <u>under</u>",
        "***both*** words",
        "**bold *nested* bold**",
        "*italic **nested** italic*",
        "**bold *both***",
        "a `code span` here",
        "``with ` backtick``",
        "**`bold code`**",
        "see [the docs](https://example.com/a%20b) now",
        "[**bold link**](https://example.com)",
        "<https://example.com/path?q=1>",
        "# Heading one",
        "## Heading two",
        "### Heading three",
        "---",
        "- first\n- second\n    - nested\n        - deeper\n- back",
        "1. one\n2. two\n    1. inner",
        "- [ ] todo\n- [x] done\n    - [ ] nested todo",
        "Line one\n\nLine three after a blank\n",
        "escaped \\*stars\\* and \\_under\\_ and \\[brackets\\]",
        "snake_case_words stay",
        "\\# not a heading",
        "\\- not a list",
        "tabs\tand  double  spaces",
        "日本語のテキスト **太字** と *斜体*",
        "emoji 👍🏽 **bold 🎉**",
        "- **bold item** with *italic*",
        "mixed **~~strike bold~~** end",
        "**<u>bold under</u>**",
    ])
    func markdownRoundTrip(_ markdown: String) {
        let rich = AttributedMarkdown.attributedString(fromMarkdown: markdown, style: style)
        let back = AttributedMarkdown.markdown(from: rich)
        #expect(back == markdown, "got: \(back.debugDescription)")
    }

    @Test func blocksRoundTripThroughParser() {
        let blocks: [MDBlock] = [
            MDBlock(kind: .heading(1), spans: [.text("Title")]),
            MDBlock(kind: .paragraph, spans: [.text("a "), .text("b ", .bold), .text("c", [.bold, .italic]),
                                              .text(" "), .text("d", .italic), .text(" "), .text("e", .strike),
                                              .text(" "), .text("f", .underline)]),
            MDBlock(kind: .list(.bullet("•")), level: 0, spans: [.text("x")]),
            MDBlock(kind: .list(.checkbox(checked: true)), level: 1, spans: [.text("done")]),
            MDBlock(kind: .list(.number(3, delimiter: ".")), level: 0, spans: [.text("three")]),
            MDBlock(kind: .divider(.thin)),
            MDBlock(kind: .paragraph, spans: [.text("link", link: "https://apple.com"), .text(" and "), .text("x", .code)]),
        ]
        let md = MarkdownSerializer.serialize(blocks)
        let parsed = MarkdownParser.parse(md)
        #expect(parsed == blocks.map { var b = $0; b.spans = MDBlock.normalized(b.spans); return b }, "md: \(md.debugDescription) parsed: \(parsed)")
    }

    @Test func attributedRoundTripKeepsSemantics() {
        let md = "# Title\n**b** *i* ~~s~~ <u>u</u> `c` [l](https://a.b)\n- [ ] task\n    - nested\n---"
        let rich = AttributedMarkdown.attributedString(fromMarkdown: md, style: style)
        let blocks1 = AttributedMarkdown.blocks(from: rich, source: .live)
        let rich2 = AttributedMarkdown.attributedString(from: blocks1, style: style)
        let blocks2 = AttributedMarkdown.blocks(from: rich2, source: .live)
        #expect(blocks1 == blocks2)
        #expect(blocks1.count == 5)
    }

    @Test func punctuationBoundariesFallBackToTags() {
        let block = MDBlock(kind: .paragraph, spans: [.text("foo.", .bold), .text("bar")])
        let md = MarkdownSerializer.serialize([block])
        #expect(md == "<b>foo.</b>bar")
        #expect(MarkdownParser.parse(md) == [block])
        #expect(MarkdownParser.parse("**foo.**bar").first?.spans == [.text("**foo.**bar")])
    }

    @Test func pastedMarkdownRenders() {
        let rich = AttributedMarkdown.attributedString(fromMarkdown: "Hello **world**", style: style)
        #expect(rich.string == "Hello world")
        let font = rich.attribute(.font, at: 7, effectiveRange: nil) as? NSFont
        #expect(font.map { Typography.traits(of: $0).bold } == true)
    }

    @Test func bareURLsBecomeLinks() {
        let spans = MarkdownParser.parseInline("go to https://apple.com now")
        #expect(spans.count == 3)
        #expect(spans[1].link == "https://apple.com")
    }

    @Test func unmatchedDelimitersStayLiteral() {
        let spans = MarkdownParser.parseInline("2 * 3 = 6 and a_b and **open")
        #expect(spans == [.text("2 * 3 = 6 and a_b and **open")])
    }

    @Test func imagesUseAttachmentIDs() {
        let id = UUID()
        let md = "before ![](folevi-quicknote-image:\(id.uuidString)) after"
        let blocks = MarkdownParser.parse(md)
        #expect(blocks.first?.spans.contains(MDSpan(content: .image(id: id, alt: ""))) == true)
        let rich = AttributedMarkdown.attributedString(fromMarkdown: md, style: style)
        #expect(AttributedMarkdown.markdown(from: rich) == md)
    }

    @Test func twoSpaceIndentedListsAreUnderstood() {
        let blocks = MarkdownParser.parse("- a\n  - b\n    - c")
        #expect(blocks.map(\.level) == [0, 1, 2])
    }

    @Test func fencedCodeBecomesCode() {
        let blocks = MarkdownParser.parse("```\nlet x = 1\n```")
        #expect(blocks == [MDBlock(kind: .paragraph, spans: [.text("let x = 1", .code)])])
    }
}

@MainActor
struct RichTextCodecTests {
    let style = TextStyle(fontSize: 15, lineHeightMultiple: 1.3, bulletGlyph: "◦")

    @Test func canonicalRTFRoundTrip() {
        let id = UUID()
        let md = "## Plan\n**bold** *it* ~~x~~ <u>u</u> `code` [link](https://apple.com)\n- [x] done\n- [ ] open\n    1. nested number\n---\n![](folevi-quicknote-image:\(id.uuidString))"
        let rich = AttributedMarkdown.attributedString(fromMarkdown: md, style: style)
        let data = RichTextCodec.encode(rich)
        #expect(!data.isEmpty)
        let decoded = RichTextCodec.decode(data, style: TextStyle(fontChoice: .serif, fontSize: 20))
        #expect(AttributedMarkdown.markdown(from: decoded) == md, "got: \(AttributedMarkdown.markdown(from: decoded).debugDescription)")
    }

    @Test func rtfIsReadableByOtherApps() throws {
        let rich = AttributedMarkdown.attributedString(fromMarkdown: "- [ ] milk", style: style)
        let data = RichTextCodec.encode(rich)
        let plain = try NSAttributedString(data: data, options: [.documentType: NSAttributedString.DocumentType.rtf], documentAttributes: nil)
        #expect(plain.string == "☐ milk")
    }

    @Test func foreignRichTextIsSanitized() {
        let foreign = NSMutableAttributedString(string: "Big title\nsome red text")
        foreign.addAttributes([.font: NSFont.boldSystemFont(ofSize: 24)], range: NSRange(location: 0, length: 9))
        foreign.addAttributes([.font: NSFont.systemFont(ofSize: 13), .foregroundColor: NSColor.red], range: NSRange(location: 10, length: 13))
        let clean = RichTextCodec.sanitizeForeign(foreign, style: style)
        #expect((clean.attribute(.foregroundColor, at: 12, effectiveRange: nil) as? NSColor) != NSColor.red)
        #expect(AttributedMarkdown.markdown(from: clean) == "# Big title\nsome red text")
    }
}
