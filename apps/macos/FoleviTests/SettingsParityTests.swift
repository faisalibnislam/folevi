import Compression
import XCTest
@testable import Folevi

/// Settings, Help and account pieces that must behave like the web's (importBundle.ts, format.ts,
/// authErrorMessage, the invitation routes).
final class SettingsParityTests: XCTestCase {
    // MARK: Import bundles

    func testNormalizePathCollapsesDotsAndRefusesEscapes() {
        XCTAssertEqual(ImportBundle.normalizePath("notes/./a/../b.md"), "notes/b.md")
        XCTAssertEqual(ImportBundle.normalizePath("a\\b\\c.png"), "a/b/c.png")
        XCTAssertEqual(ImportBundle.normalizePath("//x//y"), "x/y")
        XCTAssertNil(ImportBundle.normalizePath("../outside.md"))
    }

    func testFileKinds() {
        XCTAssertTrue(ImportBundle.isText("a/Note.MD"))
        XCTAssertTrue(ImportBundle.isText("x.markdown"))
        XCTAssertTrue(ImportBundle.isText("x.text"))
        XCTAssertFalse(ImportBundle.isText("x.png"))
        XCTAssertTrue(ImportBundle.isPlainText("x.TXT"))
        XCTAssertFalse(ImportBundle.isPlainText("x.md"))
        XCTAssertEqual(ImportBundle.imageMime("a/b.JPG"), "image/jpeg")
        XCTAssertEqual(ImportBundle.imageMime("b.webp"), "image/webp")
        XCTAssertNil(ImportBundle.imageMime("b.svg"))
    }

    func testImageSourcesAreReadAsWrittenOnce() {
        let md = """
        ![one](assets/a.png) text ![](<assets/b c.jpg>) and ![t](assets/a.png "title")
        ![remote](https://example.com/x.png)
        """
        // The web's regex: a path with a space inside <…> doesn't match; duplicates are listed once.
        XCTAssertEqual(ImportBundle.imageSources(md), ["assets/a.png", "https://example.com/x.png"])
    }

    func testResolveImageRelativeThenRootThenByName() {
        let entries = [
            ImportBundle.Entry(path: "Trip/notes/day.md", data: Data()),
            ImportBundle.Entry(path: "Trip/notes/img/photo.png", data: Data([1])),
            ImportBundle.Entry(path: "Trip/cover.jpg", data: Data([2])),
            ImportBundle.Entry(path: "Other/unique.gif", data: Data([3])),
        ]
        let map = ImportBundle.entryMap(entries)
        XCTAssertEqual(ImportBundle.resolveImage(map, all: entries, from: "Trip/notes/day.md", src: "img/photo.png")?.path, "Trip/notes/img/photo.png")
        XCTAssertEqual(ImportBundle.resolveImage(map, all: entries, from: "Trip/notes/day.md", src: "../cover.jpg")?.path, "Trip/cover.jpg")
        XCTAssertEqual(ImportBundle.resolveImage(map, all: entries, from: "Trip/notes/day.md", src: "IMG/PHOTO.PNG")?.path, "Trip/notes/img/photo.png")
        XCTAssertEqual(ImportBundle.resolveImage(map, all: entries, from: "Trip/notes/day.md", src: "somewhere/unique.gif")?.path, "Other/unique.gif")
        XCTAssertNil(ImportBundle.resolveImage(map, all: entries, from: "Trip/notes/day.md", src: "https://x.test/photo.png"))
        XCTAssertNil(ImportBundle.resolveImage(map, all: entries, from: "Trip/notes/day.md", src: "#anchor"))
    }

    func testZipReaderReadsStoredAndDeflatedEntriesAndSkipsMetadata() throws {
        let text = String(repeating: "Folevi imports Markdown. ", count: 40)
        let zip = Self.makeZip([
            ("Notes/", Data(), false),
            ("Notes/a.md", Data("# A".utf8), false),
            ("Notes/b.md", Data(text.utf8), true),
            ("__MACOSX/Notes/._a.md", Data([0]), false),
            ("Notes/.DS_Store", Data([0]), false),
        ])
        let files = try ZipReader.extract(zip)
        XCTAssertEqual(files.map(\.path), ["Notes/a.md", "Notes/b.md"])
        XCTAssertEqual(String(decoding: files[0].data, as: UTF8.self), "# A")
        XCTAssertEqual(String(decoding: files[1].data, as: UTF8.self), text)
        XCTAssertThrowsError(try ZipReader.extract(Data("not a zip at all, sorry".utf8)))
    }

    func testEntriesFromAFolderKeepTheFolderName() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("folevi-import-\(UUID().uuidString)/Trip")
        try FileManager.default.createDirectory(at: root.appendingPathComponent("img"), withIntermediateDirectories: true)
        let md = root.appendingPathComponent("day.md")
        let png = root.appendingPathComponent("img/p.png")
        try Data("![](img/p.png)".utf8).write(to: md)
        try Data([1, 2]).write(to: png)
        let result = ImportBundle.entries(files: [md, png], folder: root)
        XCTAssertEqual(Set(result.entries.map(\.path)), ["Trip/day.md", "Trip/img/p.png"])
        XCTAssertTrue(result.errors.isEmpty)
    }

    // MARK: Formatting

    func testBytesLikeTheWeb() {
        XCTAssertEqual(WebFormat.bytes(512), "512 B")
        XCTAssertEqual(WebFormat.bytes(12 * 1024), "12 KB")
        XCTAssertEqual(WebFormat.bytes(1.5 * 1024 * 1024), "1.5 MB")
        XCTAssertEqual(WebFormat.bytes(2 * 1024 * 1024 * 1024), "2.00 GB")
    }

    func testRelativeTimes() {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let ms = now.timeIntervalSince1970 * 1000
        XCTAssertEqual(WebFormat.relative(ms - 10_000, now: now), RelativeDateTimeFormatter.named.localizedString(from: DateComponents(second: 0)))
        XCTAssertEqual(WebFormat.relative(ms - 5 * 60_000, now: now), RelativeDateTimeFormatter.named.localizedString(from: DateComponents(minute: -5)))
        XCTAssertEqual(WebFormat.relative(ms + 3 * 3_600_000, now: now), RelativeDateTimeFormatter.named.localizedString(from: DateComponents(hour: 3)))
        XCTAssertEqual(WebFormat.relative(ms - 86_400_000, now: now), RelativeDateTimeFormatter.named.localizedString(from: DateComponents(day: -1)))
        XCTAssertFalse(WebFormat.relative(ms - 30 * 86_400_000, now: now).isEmpty)
    }

    // MARK: Auth errors

    func testAuthErrorMessagesMatchTheWeb() {
        XCTAssertEqual(AuthCallError(status: 400, code: "INVALID_PASSWORD").userMessage(), "The email or password is incorrect.")
        XCTAssertEqual(AuthCallError(status: 400, code: "INVALID_CODE").userMessage(), "That code didn't work. Check your authenticator app and try again.")
        XCTAssertEqual(AuthCallError(status: 429, code: "").userMessage(wait: "up to an hour"), "Too many attempts. Wait up to an hour, then try again.")
        XCTAssertEqual(AuthCallError(status: 400, code: "SOMETHING", message: "Password is too weak").userMessage(), "Password is too weak")
        XCTAssertEqual(AuthCallError(status: 500, code: "X", message: "Internal server error").userMessage(), "Something went wrong. Please try again.")
    }

    // MARK: Invitation links

    func testInvitationLinks() {
        XCTAssertEqual(InviteLinkKind.parse(URL(string: "https://app.folevi.com/invite/abc123")!), .workspace("abc123"))
        XCTAssertEqual(InviteLinkKind.parse(URL(string: "https://app.folevi.com/share-invite/xyz")!), .page("xyz"))
        XCTAssertEqual(InviteLinkKind.parse(URL(string: "com.folevi.mac://invite/tok")!), .workspace("tok"))
        XCTAssertNil(InviteLinkKind.parse(URL(string: "https://app.folevi.com/d/doc1")!))
        XCTAssertNil(InviteLinkKind.parse(URL(string: "https://app.folevi.com/invite")!))
    }

    // MARK: Helpers

    /// A ZIP with each entry stored or deflated (raw DEFLATE via Compression).
    static func makeZip(_ items: [(String, Data, Bool)]) -> Data {
        var out = Data()
        var central = Data()
        func le16(_ v: Int) -> Data { Data([UInt8(v & 0xFF), UInt8((v >> 8) & 0xFF)]) }
        func le32(_ v: Int) -> Data { Data([UInt8(v & 0xFF), UInt8((v >> 8) & 0xFF), UInt8((v >> 16) & 0xFF), UInt8((v >> 24) & 0xFF)]) }
        for (name, data, deflate) in items {
            let body = deflate ? Self.deflate(data) : data
            let method = deflate ? 8 : 0
            let offset = out.count
            let nameData = Data(name.utf8)
            out += le32(0x0403_4B50) + le16(20) + le16(0) + le16(method) + le16(0) + le16(0) + le32(0)
            out += le32(body.count) + le32(data.count) + le16(nameData.count) + le16(0) + nameData + body
            central += le32(0x0201_4B50) + le16(20) + le16(20) + le16(0) + le16(method) + le16(0) + le16(0) + le32(0)
            central += le32(body.count) + le32(data.count) + le16(nameData.count) + le16(0) + le16(0) + le16(0) + le16(0) + le32(0) + le32(offset) + nameData
        }
        let start = out.count
        out += central
        out += le32(0x0605_4B50) + le16(0) + le16(0) + le16(items.count) + le16(items.count) + le32(central.count) + le32(start) + le16(0)
        return out
    }

    static func deflate(_ data: Data) -> Data {
        var buffer = [UInt8](repeating: 0, count: data.count + 1024)
        let n = data.withUnsafeBytes { src in
            compression_encode_buffer(&buffer, buffer.count, src.bindMemory(to: UInt8.self).baseAddress!, data.count, nil, COMPRESSION_ZLIB)
        }
        return Data(buffer.prefix(n))
    }
}

private extension RelativeDateTimeFormatter {
    static var named: RelativeDateTimeFormatter {
        let f = RelativeDateTimeFormatter()
        f.dateTimeStyle = .named
        f.unitsStyle = .full
        return f
    }
}
