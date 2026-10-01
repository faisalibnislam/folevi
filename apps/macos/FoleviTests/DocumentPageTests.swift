import XCTest

/// The page around the editor (doc/DocumentView.tsx, FindBar.tsx, DocumentSidebar.tsx, export.ts,
/// MovePageDialog.tsx and FormatPanel.tsx on the web).
final class DocumentPageTests: XCTestCase {
    // MARK: The page menu

    private func context(inTrash: Bool = false, starred: Bool = false, archived: Bool = false, isTemplate: Bool = false,
                         canManage: Bool = true, readOnly: Bool = false, canMoveToFolder: Bool = true) -> PageMenu.Context {
        PageMenu.Context(inTrash: inTrash, starred: starred, archived: archived, isTemplate: isTemplate, canManage: canManage,
                            readOnly: readOnly, canMoveToFolder: canMoveToFolder)
    }

    func testPageMenuOrderMatchesTheWeb() {
        XCTAssertEqual(PageMenu.labels(context()), [
            "Star", "Share…", "Version history…", "Find and replace…", "Move to folder…", "Move to page…", "-",
            "Export as Markdown", "Export as HTML", "Export as PDF (print)", "-",
            "Duplicate", "Save as template", "Archive", "Move to Trash",
        ])
    }

    func testPageMenuForViewersTemplatesAndArchivedPages() {
        let labels = PageMenu.labels(context(starred: true, archived: true, isTemplate: true, canManage: false, readOnly: true, canMoveToFolder: false))
        XCTAssertEqual(labels.first, "Unstar")
        XCTAssertTrue(labels.contains("Find in note…"))
        XCTAssertFalse(labels.contains("Move to folder…"))
        XCTAssertFalse(labels.contains("Save as template"))
        XCTAssertTrue(labels.contains("Unarchive"))
    }

    func testPageMenuInTrash() {
        XCTAssertEqual(PageMenu.labels(context(inTrash: true)), ["Restore from Trash", "Delete permanently…"])
    }

    // MARK: Find

    private func para(_ text: [InlineNode]) -> Block {
        Block(id: "b1", parentId: nil, rank: "V", text: text, content: .paragraph(ParagraphProps()))
    }

    func testHitsAreInDisplayedTextAndSkipAtoms() {
        let block = para([.text(text: "say ", marks: nil), .mention(userId: "u", label: "hi"), .text(text: " hi", marks: nil)])
        // "say @hi hi": the mention's label is shown but never matched.
        XCTAssertEqual(FindReplace.hits(of: "hi", in: block), [NSRange(location: 8, length: 2)])
    }

    func testMatchCase() {
        let block = para([.text(text: "Cat cat CAT", marks: nil)])
        XCTAssertEqual(FindReplace.hits(of: "cat", in: block).count, 3)
        XCTAssertEqual(FindReplace.hits(of: "cat", in: block, caseSensitive: true), [NSRange(location: 4, length: 3)])
        // Accents count, as on the web.
        XCTAssertEqual(FindReplace.hits(of: "cafe", in: para([.text(text: "café", marks: nil)])).count, 0)
    }

    func testReplaceTheCurrentOccurrenceOnly() throws {
        let block = para([.text(text: "one two one two one", marks: nil)])
        let r = try XCTUnwrap(FindReplace.replace(in: block, query: "one", with: "1", limit: 1, skip: 1))
        XCTAssertEqual(RichText.plainText(r.block.text), "one two 1 two one")
        XCTAssertEqual(r.count, 1)
    }

    func testFindSnippetsStartAndEndOnWords() {
        let text = "The quick brown fox jumps over the lazy dog and keeps running far away into the distant hills"
        let at = (text as NSString).range(of: "lazy").location
        let s = FindSnippet.around(text, at: at, length: 4)
        XCTAssertEqual(s.hit, "lazy")
        XCTAssertTrue(s.before.hasPrefix("…"))
        XCTAssertTrue(s.before.hasSuffix("the "))
        XCTAssertTrue(s.after.hasSuffix("…"))
        XCTAssertFalse(s.after.dropLast().hasSuffix(" "))
        XCTAssertEqual(FindSnippet.around("short hit", at: 6, length: 3).before, "short ")
    }

    // MARK: Export

    func testExportFileNames() {
        XCTAssertEqual(PageExportText.fileName("Plans: Q3/Q4?"), "Plans- Q3-Q4-")
        XCTAssertEqual(PageExportText.fileName("   "), "Untitled")
        XCTAssertEqual(PageExportText.fileName(String(repeating: "a", count: 200)).count, 120)
    }

    func testExportMessages() {
        XCTAssertEqual(PageExportText.message("Markdown", missing: []), "Markdown export ready")
        XCTAssertEqual(PageExportText.message("HTML", missing: ["photo.png"]),
                       "HTML export ready, but “photo.png” couldn’t be included (not available or not uploaded yet).")
        XCTAssertEqual(PageExportText.message("PDF", missing: ["a", "b"]),
                       "PDF export ready, but 2 attachments couldn’t be included (not available or not uploaded yet).")
    }

    func testZipArchiveLayout() {
        XCTAssertEqual(ZipWriter.crc32(Data("123456789".utf8)), 0xCBF4_3926)
        let zip = ZipWriter.archive([("Note.md", Data("# Hi".utf8)), ("assets/a.png", Data([1, 2, 3]))])
        // Local header, then the end-of-central-directory record with two entries.
        XCTAssertEqual(Array(zip.prefix(4)), [0x50, 0x4B, 0x03, 0x04])
        let end = zip.suffix(22)
        XCTAssertEqual(Array(end.prefix(4)), [0x50, 0x4B, 0x05, 0x06])
        XCTAssertEqual(end[end.startIndex + 10], 2)
        XCTAssertNotNil(zip.range(of: Data("assets/a.png".utf8)))
    }

    // MARK: Move page

    func testPageCardsGoAtTheEndOnce() throws {
        let blocks = [WireBlock(id: "x", type: "paragraph", parentId: nil, rank: "M"), WireBlock(id: "y", type: "paragraph", parentId: nil, rank: "T")]
        let card = try XCTUnwrap(PageCards.card(for: "doc1", title: "", in: blocks))
        XCTAssertEqual(card.type, "page")
        XCTAssertGreaterThan(card.rank, "T")
        XCTAssertEqual(card.props["titleCache"]?.stringValue, "Untitled")
        XCTAssertEqual(card.props["display"]?.stringValue, "card")
        XCTAssertNil(PageCards.card(for: "doc1", title: "x", in: blocks + [card]))
    }

    // MARK: Format

    func testBlockLookIsKeptWhenWritten() {
        let look = BlockLook(textStyle: .caption, decoration: .focus, color: .navy, align: .center, font: .serif, group: .card)
        guard case .paragraph(let p) = look.applied(to: .paragraph(ParagraphProps())) else { return XCTFail() }
        XCTAssertEqual(BlockLook(.paragraph(p)), look)
        // Headings carry everything but the text style.
        guard case .heading(let h) = look.applied(to: .heading(HeadingProps(level: .level2))) else { return XCTFail() }
        XCTAssertEqual(h.level, .level2)
        XCTAssertEqual(BlockLook(.heading(h)), BlockLook(decoration: .focus, color: .navy, align: .center, font: .serif, group: .card))
        // Other blocks have no look.
        XCTAssertEqual(look.applied(to: .divider(DividerProps())), .divider(DividerProps()))
    }

    // MARK: Dates

    func testRelativeDates() {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let ms = { (seconds: Double) in (now.timeIntervalSince1970 + seconds) * 1000 }
        XCTAssertEqual(PageFormat.relative(ms(-10), now: now), "now")
        XCTAssertTrue(PageFormat.relative(ms(-5 * 60), now: now).contains("5"))
        XCTAssertTrue(PageFormat.relative(ms(-3 * 3600), now: now).contains("3"))
        XCTAssertFalse(PageFormat.relative(ms(-30 * 86400), now: now).contains("ago"))
    }
}
