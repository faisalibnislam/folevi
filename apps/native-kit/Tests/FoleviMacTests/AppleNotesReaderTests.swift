// Import from Apple Notes (Model/AppleNotesReader.swift): what runs without Notes. The permission answers, how
// Apple Event errors read to the person, images Notes keeps as HEIC or TIFF made JPEG, and the note the Settings
// section hands the engine. Nothing here talks to Notes or reads anyone's notes.
#if os(macOS)
import AppKit
import Foundation
import Testing
import FoleviEngine
@testable import FoleviMac

@Suite struct AppleNotesReaderTests {
    @Test func permissionAnswers() {
        #expect(AppleNotesReader.access(for: 0) == .granted)
        #expect(AppleNotesReader.access(for: -1743) == .denied)
        #expect(AppleNotesReader.access(for: -1744) == .notDetermined)
        #expect(AppleNotesReader.access(for: -600) == .unavailable)
        #expect(AppleNotesReader.Access.notDetermined.rawValue == "not-determined")
    }

    @Test func appleEventErrors() {
        #expect(AppleNotesReader.failure(NSError(domain: NSOSStatusErrorDomain, code: -1743)).code == "denied")
        #expect(AppleNotesReader.failure(NSError(domain: NSOSStatusErrorDomain, code: -609)).code == "unavailable")
        #expect(AppleNotesReader.failure(NSError(domain: NSOSStatusErrorDomain, code: -1728)).code == "failed")
    }

    /// A 2×2 TIFF, as Notes may keep a scanned or pasted image.
    private func tiff() -> Data {
        let image = NSImage(size: NSSize(width: 2, height: 2))
        image.lockFocus()
        NSColor.red.setFill()
        NSRect(x: 0, y: 0, width: 2, height: 2).fill()
        image.unlockFocus()
        return image.tiffRepresentation!
    }

    @Test func imagesTheWebCantShowBecomeJPEG() throws {
        let png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
        let html = #"<div>a</div><div><img src="data:image/tiff;base64,\#(tiff().base64EncodedString())"></div><div><img src="data:image/png;base64,\#(png)"></div>"#
        let out = AppleNotesReader.webImages(html)
        #expect(!out.contains("image/tiff"))
        #expect(out.contains("data:image/jpeg;base64,"))
        #expect(out.contains("data:image/png;base64,\(png)"))
        #expect(out.hasPrefix("<div>a</div>"))
        let range = try #require(out.range(of: #"(?<=data:image/jpeg;base64,)[A-Za-z0-9+/=]+"#, options: .regularExpression))
        let b64 = String(out[range])
        #expect(NSImage(data: try #require(Data(base64Encoded: b64))) != nil)
    }

    @Test func unreadableImagesStayAsTheyAre() {
        let html = #"<img src="data:image/heic;base64,AAAA">"#
        #expect(AppleNotesReader.webImages(html) == html)
        #expect(AppleNotesReader.webImages("<div>no images</div>") == "<div>no images</div>")
    }

    @Test func theNoteTheEngineGets() {
        let ref = AppleNotesReader.NoteRef(id: "x-coredata://A/ICNote/p1", title: "Plan", folder: ["iCloud", "Work"], created: 1_700_000_000_000, modified: nil)
        let body = AppleNotesReader.Body(id: ref.id, html: "<div>Plan</div>", attachments: [
            .init(name: "a.pdf", cid: "cid:1", mime: "application/pdf", data: "AAAA"),
            .init(name: "Site", url: "https://example.com"),
            .init(name: "big.mov", error: "it’s over 512 MB"),
        ])
        #expect(DataSettings.json(ref, body) == .object([
            "id": .string(ref.id), "title": .string("Plan"), "html": .string("<div>Plan</div>"),
            "folder": .array([.string("iCloud"), .string("Work")]),
            "attachments": .array([
                .object(["name": .string("a.pdf"), "cid": .string("cid:1"), "mime": .string("application/pdf"), "data": .string("AAAA")]),
                .object(["name": .string("Site"), "url": .string("https://example.com")]),
                .object(["name": .string("big.mov"), "error": .string("it’s over 512 MB")]),
            ]),
            "created": .number(1_700_000_000_000),
        ]))
    }

    @Test func attachmentFileNames() {
        #expect(AppleNotesReader.safeFileName("Report: Q1/Q2.pdf") == "Report- Q1-Q2.pdf")
        #expect(AppleNotesReader.safeFileName("  ") == "Attachment")
        #expect(AppleNotesReader.safeFileName(".hidden") == "Attachment.hidden")
    }

    @Test func aPackageComesAsAZip() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("folevi-test-\(UUID().uuidString).pages", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        try Data("hello".utf8).write(to: dir.appendingPathComponent("index.xml"))
        let zip = try AppleNotesReader.zip(dir)
        #expect(zip.prefix(2) == Data("PK".utf8))
    }
}
#endif
