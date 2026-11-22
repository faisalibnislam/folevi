// The Mac's own capabilities on foleviDesktop, for the editor pages: text recognition (Vision), call recording
// (ScreenCaptureKit and the microphone), dragging a note or its text out to Finder and other apps, printing, the
// Share picker, the clipboard for the page's own menus, Quick Look of attachments, and keeping Spotlight current.
// The page side is capabilities.js (shared); the services behind them are the shared TextRecognition,
// CallRecorder, Printing and Clipboard, plus Core's own drag-out, Quick Look and share picker below.
// Every argument is checked here; only the app's own page reaches the router (MessageRouter).
import AppKit
import CoreSpotlight
import QuickLookUI
import UniformTypeIdentifiers
import WebKit

@MainActor
enum Capabilities {
    private static var installed = false
    private static var waiting: [String: CheckedContinuation<[String: Any], Never>] = [:]

    static func install() {
        guard !installed else { return }
        installed = true
        DesktopRouter.features.formUnion([
            "recognizeText", "callCapture", "screenAccess", "openSystemSettings", "recordCall", "dragFile", "dragNotes",
            "print", "share", "setShareTarget", "indexSpotlight", "clipboard", "quickLook", "commandDone",
        ])
        let handlers: [String: @MainActor (DesktopRouter, [String: Any]) async throws -> [String: Any]] = [
            "recognizeText": recognizeText,
            "screenAccess": { _, _ in ["value": CallRecorder.screenAccess()] },
            "openSystemSettings": { _, o in
                guard o["pane"] as? String == "screen-recording", let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture") else { throw BridgeError.invalid("Folevi Core can't open that.") }
                NSWorkspace.shared.open(url)
                return [:]
            },
            "callStart": { router, _ in try await CallRecorder.shared.start(for: try view(router)); return [:] },
            "callPause": { router, _ in CallRecorder.shared.pause(for: try view(router)); return [:] },
            "callResume": { router, _ in CallRecorder.shared.resume(for: try view(router)); return [:] },
            "callStop": { router, _ in try await CallRecorder.shared.stop(for: try view(router)) },
            "callCancel": { router, _ in await CallRecorder.shared.cancel(for: try view(router)); return [:] },
            "dragFile": { router, o in
                guard let text = o["text"] as? String, text.utf8.count <= 5_000_000 else { throw BridgeError.invalid("That note is too big to drag.") }
                CoreDragOut.dragText(name: o["name"] as? String ?? "", text: text, from: try view(router))
                return [:]
            },
            "dragNotes": { router, o in
                let notes = (o["notes"] as? [[String: Any]] ?? []).prefix(50).compactMap { n -> (String, String)? in
                    guard let id = n["id"] as? String, id.range(of: "^[A-Za-z0-9_-]{1,64}$", options: .regularExpression) != nil else { return nil }
                    return (id, String((n["title"] as? String ?? "").prefix(200)))
                }
                CoreDragOut.dragLinks(Array(notes), from: try view(router))
                return [:]
            },
            "dragNoteReply": { _, o in NoteFiles.shared.reply(o); return [:] },
            "print": { router, _ in Printing.printPage(try view(router)); return [:] },
            "share": share,
            "setShareTarget": { _, _ in [:] },
            "indexSpotlight": indexSpotlight,
            "spotlightState": { router, _ in ["enabled": Spotlight.shared.enabled, "place": router.context.place() ?? ""] },
            "clipboardRead": { _, _ in Clipboard.read() },
            "clipboardWrite": { _, o in try Clipboard.write(o); return [:] },
            "clipboardPaste": { router, _ in ["value": Clipboard.paste(into: try view(router))] },
            "quickLook": quickLook,
            "commandDone": { _, o in
                if let id = o["id"] as? String, let c = waiting.removeValue(forKey: id) { c.resume(returning: (o["value"] as? [String: Any]) ?? ["ok": o["ok"] as? Bool ?? true]) }
                return [:]
            },
        ]
        DesktopRouter.extraHandlers.merge(handlers) { _, new in new }
        Printing.install()
    }

    static func view(_ router: DesktopRouter) throws -> FoleviWebView {
        guard let view = (router.context.events as? ViewEvents)?.view as? FoleviWebView else { throw BridgeError(code: "unavailable", message: "That page is gone.") }
        return view
    }

    static func number(_ v: Any?) -> Double? {
        guard let n = v as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID(), n.doubleValue.isFinite else { return nil }
        return n.doubleValue
    }

    private static func recognizeText(_ router: DesktopRouter, _ o: [String: Any]) async throws -> [String: Any] {
        guard let b64 = o["data"] as? String, let data = Data(base64Encoded: b64), !data.isEmpty, data.count <= TextRecognition.maxBytes else {
            throw BridgeError.invalid("That image couldn't be read.")
        }
        guard let text = await TextRecognition.shared.recognize(data, handwriting: o["handwriting"] as? Bool == true) else {
            throw BridgeError(code: "io", message: "Folevi Core couldn't read the text in that image.")
        }
        return ["text": text]
    }

    private static func share(_ router: DesktopRouter, _ o: [String: Any]) async throws -> [String: Any] {
        var items: [Any] = []
        if let t = o["text"] as? String, !t.isEmpty { items.append(String(t.prefix(1_000_000))) }
        if let u = (o["url"] as? String).flatMap(URL.init(string:)), ["http", "https"].contains(u.scheme ?? "") { items.append(u) }
        guard !items.isEmpty else { throw BridgeError.invalid("There's nothing to share.") }
        let view = try view(router)
        let num = Self.number
        let rect = (o["rect"] as? [String: Any]).flatMap { r -> NSRect? in
            guard let x = num(r["x"]), let y = num(r["y"]), let w = num(r["width"]), let h = num(r["height"]) else { return nil }
            return NSRect(x: x, y: y, width: max(1, w), height: max(1, h))
        } ?? num(o["x"]).flatMap { x in num(o["y"]).map { NSRect(x: x, y: $0, width: 1, height: 1) } }
            ?? NSRect(x: view.bounds.midX, y: 40, width: 1, height: 1)
        let picker = NSSharingServicePicker(items: items)
        picker.show(relativeTo: rect, of: view, preferredEdge: .minY)
        return ["shared": true]
    }

    /// The page keeps Spotlight current with its notes (never encrypted ones: the page leaves those out).
    private static func indexSpotlight(_ router: DesktopRouter, _ o: [String: Any]) async throws -> [String: Any] {
        let place = router.context.place() ?? "default"
        let items = (o["items"] as? [[String: Any]] ?? []).prefix(50).compactMap { d -> Spotlight.Item? in
            guard let id = d["id"] as? String, id.range(of: "^[A-Za-z0-9_-]{1,64}$", options: .regularExpression) != nil else { return nil }
            let text = (d["text"] as? String ?? d["excerpt"] as? String ?? "")
            return Spotlight.Item(id: id, title: String((d["title"] as? String ?? "").prefix(300)), text: String(text.prefix(4000)), edited: number(d["updatedAt"]).map { Date(timeIntervalSince1970: $0 / 1000) })
        }
        await Spotlight.shared.index(Array(items), place: place)
        let remove = (o["remove"] as? [Any] ?? []).prefix(50_000).compactMap { $0 as? String }
        if !remove.isEmpty { await Spotlight.shared.remove(remove, place: place) }
        return [:]
    }

    private static func quickLook(_ router: DesktopRouter, _ o: [String: Any]) async throws -> [String: Any] {
        let files = (o["files"] as? [[String: Any]] ?? []).prefix(20).compactMap { f -> (String, Data)? in
            guard let name = f["name"] as? String, let b64 = f["data"] as? String, let data = Data(base64Encoded: b64), data.count <= 200 * 1024 * 1024 else { return nil }
            return (name, data)
        }
        guard !files.isEmpty else { throw BridgeError.invalid("There's nothing to show.") }
        try CoreQuickLook.shared.show(Array(files))
        return [:]
    }
}

/// Dragging out of a note: its text as a Markdown file (a file promise Finder and other apps take), or notes as
/// links.
@MainActor
enum CoreDragOut {
    static func dragText(name: String, text: String, from view: NSView) {
        let clean = name.replacingOccurrences(of: "/", with: "-").replacingOccurrences(of: ":", with: "-").trimmingCharacters(in: .whitespacesAndNewlines)
        let file = (clean.isEmpty ? "Note" : String(clean.prefix(120))) + (clean.lowercased().hasSuffix(".md") ? "" : ".md")
        let provider = NSFilePromiseProvider(fileType: UTType.plainText.identifier, delegate: PromiseDelegate.shared)
        provider.userInfo = [file, text]
        begin([provider], from: view)
    }

    static func dragLinks(_ notes: [(String, String)], from view: NSView) {
        let items = notes.map { id, title -> NSPasteboardItem in
            let item = NSPasteboardItem()
            let url = NoteActions.webURL(id)
            item.setString(url.absoluteString, forType: .URL)
            item.setString(title.isEmpty ? url.absoluteString : "[\(title)](\(url.absoluteString))", forType: .string)
            return item
        }
        begin(items, from: view)
    }

    private static func begin(_ writers: [any NSPasteboardWriting], from view: NSView) {
        guard let event = NSApp.currentEvent, let window = view.window else { return }
        let at = view.convert(window.mouseLocationOutsideOfEventStream, from: nil)
        let image = NSImage(systemSymbolName: "doc.text", accessibilityDescription: nil) ?? NSImage()
        let items = writers.map { w -> NSDraggingItem in
            let item = NSDraggingItem(pasteboardWriter: w)
            item.setDraggingFrame(NSRect(x: at.x - 16, y: at.y - 16, width: 32, height: 32), contents: image)
            return item
        }
        view.beginDraggingSession(with: items, event: event, source: DragSource.shared)
    }

    final class DragSource: NSObject, NSDraggingSource {
        static let shared = DragSource()
        func draggingSession(_ session: NSDraggingSession, sourceOperationMaskFor context: NSDraggingContext) -> NSDragOperation { .copy }
    }

    final class PromiseDelegate: NSObject, NSFilePromiseProviderDelegate {
        static let shared = PromiseDelegate()

        func filePromiseProvider(_ provider: NSFilePromiseProvider, fileNameForType fileType: String) -> String {
            (provider.userInfo as? [String])?.first ?? "Note.md"
        }

        func filePromiseProvider(_ provider: NSFilePromiseProvider, writePromiseTo url: URL, completionHandler: @escaping ((any Error)?) -> Void) {
            let text = (provider.userInfo as? [String])?.last ?? ""
            do {
                try Data(text.utf8).write(to: url, options: .atomic)
                completionHandler(nil)
            } catch {
                completionHandler(error)
            }
        }
    }
}

/// Quick Look of attachments the page hands over (copies in a temporary folder, removed when the panel closes).
@MainActor
final class CoreQuickLook: NSObject, QLPreviewPanelDataSource, QLPreviewPanelDelegate {
    static let shared = CoreQuickLook()
    private var urls: [URL] = []
    private var folder: URL?

    func show(_ files: [(String, Data)]) throws {
        cleanUp()
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("FoleviCoreQuickLook-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        folder = dir
        urls = try files.map { name, data in
            let safe = name.replacingOccurrences(of: "/", with: "-").replacingOccurrences(of: ":", with: "-")
            let url = dir.appendingPathComponent(safe.isEmpty ? "File" : String(safe.prefix(200)))
            try data.write(to: url, options: .atomic)
            return url
        }
        guard let panel = QLPreviewPanel.shared() else { return }
        panel.dataSource = self
        panel.delegate = self
        panel.reloadData()
        panel.makeKeyAndOrderFront(nil)
    }

    nonisolated func numberOfPreviewItems(in panel: QLPreviewPanel!) -> Int {
        MainActor.assumeIsolated { urls.count }
    }

    nonisolated func previewPanel(_ panel: QLPreviewPanel!, previewItemAt index: Int) -> (any QLPreviewItem)! {
        MainActor.assumeIsolated { urls[index] as NSURL }
    }

    private func cleanUp() {
        if let folder { try? FileManager.default.removeItem(at: folder) }
        folder = nil
        urls = []
    }
}
