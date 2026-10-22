// WM5's Mac capabilities (docs/MAC_WEBKIT_PLAN.md §10 WM5): the call recorder's mixing and file, Vision on an
// image, a dragged note's file promise written on drop, file names and paths, Spotlight's identifiers, the
// clipboard for the app's menus and the System Settings panes a page may open.
import AppKit
import AudioToolbox
import AVFoundation
import CoreText
import XCTest
@testable import Folevi

@MainActor
final class CapabilitiesTests: XCTestCase {
    // MARK: call recording

    func testMixAddsBothSourcesAsTheyLineUp() {
        let mix = AudioMix(maxLag: 100)
        XCTAssertEqual(mix.push([0.1, 0.2, 0.3], from: .microphone), [])
        let out = mix.push([0.5, 0.5], from: .system)
        XCTAssertEqual(out.count, 2)
        XCTAssertEqual(out[0], 0.6, accuracy: 1e-6)
        XCTAssertEqual(out[1], 0.7, accuracy: 1e-6)
        XCTAssertEqual(mix.waiting.microphone, 1)
        XCTAssertEqual(mix.waiting.system, 0)
    }

    func testMixKeepsSumsWithinRange() {
        let mix = AudioMix(maxLag: 10)
        _ = mix.push([0.9, -0.9], from: .microphone)
        XCTAssertEqual(mix.push([0.9, -0.9], from: .system), [1, -1])
    }

    func testAQuietSourceHoldsTheOtherBackOnlyUpToTheLag() {
        let mix = AudioMix(maxLag: 4)
        // Nothing playing on the Mac: the microphone goes out on its own once it's 4 samples ahead.
        XCTAssertEqual(mix.push([0.1, 0.1, 0.1], from: .microphone), [])
        XCTAssertEqual(mix.push([0.2, 0.2, 0.2], from: .microphone), [0.1, 0.1])
        XCTAssertEqual(mix.waiting.microphone, 4)
        // The end of a recording flushes everything.
        XCTAssertEqual(mix.drain(flush: true).count, 4)
        XCTAssertEqual(mix.waiting.microphone, 0)
    }

    func testPauseDropsWhatWaited() {
        let mix = AudioMix(maxLag: 100)
        _ = mix.push([0.3, 0.3], from: .system)
        mix.reset()
        XCTAssertEqual(mix.drain(flush: true), [])
    }

    func testConverterMakesMonoAtTheRecordingRate() throws {
        let stereo = try XCTUnwrap(AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 44_100, channels: 2, interleaved: false))
        let buffer = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: stereo, frameCapacity: 4410))
        buffer.frameLength = 4410
        for c in 0..<2 { for i in 0..<4410 { buffer.floatChannelData![c][i] = 0.25 } }
        let samples = MonoConverter(rate: 48_000).samples(buffer)
        // 0.1 s at 48 kHz, give or take the converter's priming.
        XCTAssertGreaterThan(samples.count, 4000)
        XCTAssertLessThanOrEqual(samples.count, 4800 + 64)
    }

    func testRecordingFileIsAnM4aOfTheRightLength() throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("folevi-test-\(UUID().uuidString).m4a")
        defer { try? FileManager.default.removeItem(at: url) }
        let file = try RecordingFile(url: url, rate: 48_000)
        let mix = AudioMix(maxLag: 4800)
        // One second of a 440 Hz tone from "this Mac" and a quieter 220 Hz one from the microphone, in 100 ms pieces.
        for piece in 0..<10 {
            let tone = (0..<4800).map { i -> Float in 0.4 * sin(Float(piece * 4800 + i) * 2 * .pi * 440 / 48_000) }
            let voice = (0..<4800).map { i -> Float in 0.2 * sin(Float(piece * 4800 + i) * 2 * .pi * 220 / 48_000) }
            try file.write(mix.push(tone, from: .system))
            try file.write(mix.push(voice, from: .microphone))
        }
        try file.write(mix.drain(flush: true))
        XCTAssertEqual(file.seconds, 1, accuracy: 0.01)
        XCTAssertGreaterThan(file.takePeak(), 0.3)
        file.close()
        let read = try AVAudioFile(forReading: url)
        XCTAssertEqual(read.fileFormat.channelCount, 1)
        XCTAssertEqual(read.fileFormat.sampleRate, 48_000)
        XCTAssertEqual(Double(read.length) / read.fileFormat.sampleRate, 1, accuracy: 0.1)
        // AAC at 64 kbit/s: about 8 KB of audio a second (the file adds a fixed header of its own).
        var audioFile: AudioFileID?
        XCTAssertEqual(AudioFileOpenURL(url as CFURL, .readPermission, 0, &audioFile), noErr)
        var bytes: UInt64 = 0
        var size = UInt32(MemoryLayout<UInt64>.size)
        XCTAssertEqual(AudioFileGetProperty(try XCTUnwrap(audioFile), kAudioFilePropertyAudioDataByteCount, &size, &bytes), noErr)
        AudioFileClose(audioFile!)
        XCTAssertGreaterThan(bytes, 6_000)
        XCTAssertLessThan(bytes, 10_000)
    }

    // MARK: text recognition

    func testVisionReadsTheTextInAnImage() async throws {
        let png = try Self.textImage("FOLEVI NOTES 2026")
        let text = await TextRecognition.shared.recognize(png, handwriting: false)
        XCTAssertNotNil(text)
        XCTAssertTrue(text?.uppercased().contains("FOLEVI") == true, "read \(text ?? "nil")")
    }

    func testNotAnImageReadsAsNil() async {
        let text = await TextRecognition.shared.recognize(Data("not an image".utf8), handwriting: false)
        XCTAssertNil(text)
    }

    func testTimeoutGivesUp() async {
        let start = Date()
        let text = await TextRecognition.withTimeout(.milliseconds(100)) { _ in
            Thread.sleep(forTimeInterval: 1)
            return "late"
        }
        XCTAssertNil(text)
        XCTAssertLessThan(Date().timeIntervalSince(start), 0.9)
    }

    /// Black text on white, as a PNG.
    static func textImage(_ text: String) throws -> Data {
        let width = 900, height = 200
        let space = CGColorSpaceCreateDeviceRGB()
        let ctx = try XCTUnwrap(CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0, space: space, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
        ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
        ctx.fill(CGRect(x: 0, y: 0, width: width, height: height))
        let font = CTFontCreateWithName("Helvetica-Bold" as CFString, 64, nil)
        let attributed = NSAttributedString(string: text, attributes: [.font: font, .foregroundColor: CGColor(red: 0, green: 0, blue: 0, alpha: 1)])
        let line = CTLineCreateWithAttributedString(attributed)
        ctx.textPosition = CGPoint(x: 30, y: 70)
        CTLineDraw(line, ctx)
        let image = try XCTUnwrap(ctx.makeImage())
        return try XCTUnwrap(NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]))
    }

    // MARK: drag out

    func testFileNamesFinderTakes() {
        XCTAssertEqual(DragOut.fileName("Groceries"), "Groceries.md")
        XCTAssertEqual(DragOut.fileName("a/b: c?"), "a-b- c-.md")
        XCTAssertEqual(DragOut.fileName("..hidden"), "hidden.md")
        XCTAssertEqual(DragOut.fileName("   "), "Untitled.md")
        XCTAssertEqual(DragOut.fileName(String(repeating: "x", count: 300)).count, 123)
        XCTAssertEqual(DragOut.fileName("Notes", ext: ""), "Notes")
    }

    func testAttachmentsStayInTheFolderBesideTheNote() {
        let base = URL(fileURLWithPath: "/tmp/drop", isDirectory: true)
        XCTAssertEqual(DragOut.safeTarget("Trip files/01-photo.jpg", under: base)?.path, "/tmp/drop/Trip files/01-photo.jpg")
        XCTAssertNil(DragOut.safeTarget("../escape.txt", under: base))
        XCTAssertNil(DragOut.safeTarget("/etc/passwd", under: base))
        XCTAssertNil(DragOut.safeTarget("a//b", under: base))
        XCTAssertNil(DragOut.safeTarget("a/./b", under: base))
        XCTAssertNil(DragOut.safeTarget("a\\b", under: base))
    }

    @MainActor
    func testADroppedNoteIsWrittenWhenTheDropAsksForIt() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("folevi-drop-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        let provider = NSFilePromiseProvider(fileType: DragOut.markdownType.identifier, delegate: DragOut.shared)
        provider.userInfo = DragOut.Payload.text(name: DragOut.fileName("Groceries"), text: "# Groceries\n\n- Milk\n")
        XCTAssertEqual(DragOut.shared.filePromiseProvider(provider, fileNameForType: DragOut.markdownType.identifier), "Groceries.md")
        let target = dir.appendingPathComponent("Groceries.md")
        let done = expectation(description: "written")
        DragOut.shared.filePromiseProvider(provider, writePromiseTo: target) { error in
            XCTAssertNil(error)
            done.fulfill()
        }
        wait(for: [done], timeout: 5)
        XCTAssertEqual(try String(contentsOf: target, encoding: .utf8), "# Groceries\n\n- Milk\n")
    }

    func testANoteWithAttachmentsWritesThemBesideIt() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("folevi-drop-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        let note = dir.appendingPathComponent("Trip.md")
        XCTAssertNil(DragOut.write(text: "![](Trip%20files/a.png)", files: [("Trip files/a.png", Data([1, 2, 3])), ("../no.png", Data([9]))], to: note))
        XCTAssertEqual(try Data(contentsOf: dir.appendingPathComponent("Trip files/a.png")), Data([1, 2, 3]))
        XCTAssertFalse(FileManager.default.fileExists(atPath: dir.deletingLastPathComponent().appendingPathComponent("no.png").path))
    }

    func testAPromiseCarriesThePageDragsData() {
        let promise = DragOut.Promise(fileType: DragOut.markdownType.identifier, delegate: DragOutTestDelegate.shared)
        let custom = NSPasteboard.PasteboardType("com.apple.WebKit.custom-pasteboard-data")
        promise.extra = [(custom, Data("ids".utf8))]
        let board = NSPasteboard(name: NSPasteboard.Name("com.folevi.mac.tests.\(UUID().uuidString)"))
        XCTAssertTrue(promise.writableTypes(for: board).contains(custom))
        XCTAssertEqual(promise.pasteboardPropertyList(forType: custom) as? Data, Data("ids".utf8))
        board.releaseGlobally()
    }

    // MARK: Spotlight, the clipboard, settings

    func testSpotlightIdentifiersNameThePlaceAndTheNote() {
        let id = Spotlight.identifier(place: "acct:u1", id: "01ABC")
        XCTAssertEqual(Spotlight.parse(id)?.place, "acct:u1")
        XCTAssertEqual(Spotlight.parse(id)?.id, "01ABC")
        XCTAssertNil(Spotlight.parse("no-separator"))
        XCTAssertTrue(Spotlight.domain("library").hasPrefix("com.folevi.notes."))
    }

    func testSpotlightNotesFromThePageAreChecked() {
        XCTAssertNotNil(Spotlight.Note(["id": "01ABC", "title": "Hi", "excerpt": "x", "location": "Notes", "starred": true, "updatedAt": 1700000000000]))
        XCTAssertNil(Spotlight.Note(["id": "../x", "title": "Hi"]))
        XCTAssertNil(Spotlight.Note(["title": "no id"]))
        let long = Spotlight.Note(["id": "a", "title": String(repeating: "t", count: 1000)])
        XCTAssertEqual(long?.title.count, 300)
    }

    @MainActor
    func testClipboardRoundTrip() throws {
        let board = NSPasteboard(name: NSPasteboard.Name("com.folevi.mac.tests.\(UUID().uuidString)"))
        defer { board.releaseGlobally() }
        try Clipboard.write(["text": "plain", "html": "<b>bold</b>"], to: board)
        let read = Clipboard.read(board)
        XCTAssertEqual(read["text"] as? String, "plain")
        XCTAssertEqual(read["html"] as? String, "<b>bold</b>")
        XCTAssertThrowsError(try Clipboard.write([:], to: board))
    }

    @MainActor
    func testOnlyTheScreenRecordingPaneOpens() {
        XCTAssertEqual(Capabilities.settingsURL("screen-recording")?.absoluteString, "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")
        XCTAssertNil(Capabilities.settingsURL("general"))
    }

    func testServicesTakePlainTextThenRTF() {
        let board = NSPasteboard(name: NSPasteboard.Name("com.folevi.mac.tests.\(UUID().uuidString)"))
        defer { board.releaseGlobally() }
        board.clearContents()
        let rtf = try? NSAttributedString(string: "From RTF").data(from: NSRange(location: 0, length: 8), documentAttributes: [.documentType: NSAttributedString.DocumentType.rtf])
        board.setData(rtf, forType: .rtf)
        XCTAssertEqual(ServicesProvider.text(from: board), "From RTF")
        board.clearContents()
        board.setString("Plain", forType: .string)
        XCTAssertEqual(ServicesProvider.text(from: board), "Plain")
    }
}

final class DragOutTestDelegate: NSObject, NSFilePromiseProviderDelegate {
    static let shared = DragOutTestDelegate()
    func filePromiseProvider(_ provider: NSFilePromiseProvider, fileNameForType fileType: String) -> String { "x.md" }
    func filePromiseProvider(_ provider: NSFilePromiseProvider, writePromiseTo url: URL, completionHandler: @escaping (Error?) -> Void) { completionHandler(nil) }
}
