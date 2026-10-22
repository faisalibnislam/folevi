// Dragging notes out of Folevi to Finder, Mail or another app (docs/MAC_POLISH_PLAN.md §3.13): each note goes as a
// Markdown file named after it, written only when it's dropped (a file promise), with its attachments in a
// folder beside it ("<title> files") when it has any.
//
// Two ways in:
// - foleviDesktop.dragFile({ name, text }): the Export dialog's file, whose text the page already has. The page
//   cancels its own drag; this starts the Mac's from the mouse event that began it (as Electron's startDrag did).
// - foleviDesktop.dragNotes(notes, fileOf): a note card, row or the like, dragged as the page drags it (into a
//   folder, onto the sidebar). The page says which notes its drag carries; when WebKit starts that drag, the
//   item it drags becomes a file promise that also carries everything WebKit put on the pasteboard, so drops
//   inside Folevi work as before and a drop in Finder makes the files. The Markdown is asked of the page when the
//   drop happens (fileOf), so nothing is prepared for a drag that stays inside the app.
import AppKit
import UniformTypeIdentifiers
import WebKit

@MainActor
final class DragOut: NSObject, NSFilePromiseProviderDelegate {
    static let shared = DragOut()

    struct NoteRef: Equatable {
        let id: String
        let title: String
    }

    /// What one promised file is.
    enum Payload {
        case text(name: String, text: String)
        case note(NoteRef, token: String, view: Weak)
    }

    final class Weak {
        weak var view: FoleviWebView?
        init(_ view: FoleviWebView) { self.view = view }
    }

    /// A file promise that also writes the pasteboard types of the drag it replaced (WebKit's own data).
    final class Promise: NSFilePromiseProvider {
        var extra: [(NSPasteboard.PasteboardType, Data)] = []

        override func writableTypes(for pasteboard: NSPasteboard) -> [NSPasteboard.PasteboardType] {
            super.writableTypes(for: pasteboard) + extra.map(\.0).filter { !super.writableTypes(for: pasteboard).contains($0) }
        }

        override func writingOptions(forType type: NSPasteboard.PasteboardType, pasteboard: NSPasteboard) -> NSPasteboard.WritingOptions {
            extra.contains { $0.0 == type } ? [] : super.writingOptions(forType: type, pasteboard: pasteboard)
        }

        override func pasteboardPropertyList(forType type: NSPasteboard.PasteboardType) -> Any? {
            if let data = extra.first(where: { $0.0 == type })?.1 { return data }
            return super.pasteboardPropertyList(forType: type)
        }
    }

    static let markdownType = UTType("net.daringfireball.markdown") ?? .plainText

    /// The last mouse down or drag in the app (a drag the page asks for starts from it).
    private(set) var lastMouse: NSEvent?
    private var monitor: Any?
    /// The notes the drag a page is starting carries.
    private var expected: (view: ObjectIdentifier, notes: [NoteRef], token: String, at: Date)?
    /// Answers the page owes for dropped notes, by request id.
    private var replies: [String: CheckedContinuation<[String: Any]?, Never>] = [:]
    /// Inside our own beginDraggingSession (the override must not take its own drag again).
    var starting = false
    /// The drag of notes under way, if any (it may also be copied out of the app).
    weak var notesSession: NSDraggingSession? {
        didSet { if notesSession != nil { note("notes session") } }
    }

    /// The file promises of the drag of notes under way.
    private(set) var promises: [Promise] = []

    /// Whether the promises are on the drag's pasteboard now (only while the pointer is outside Folevi's windows:
    /// over a Folevi page, WebKit reads a drag with files in it as files and hides the notes' own data).
    private var promisesOn = false

    /// The drag begins: WebKit has written its data to the session's pasteboard (over the item the promises were
    /// written by), which is what a drop inside Folevi reads. It's kept, to write again after the promises.
    func began(_ session: NSDraggingSession) {
        guard session === notesSession, let first = promises.first else { return }
        let board = session.draggingPasteboard
        let own = Set(NSFilePromiseProvider(fileType: Self.markdownType.identifier, delegate: self).writableTypes(for: board))
        let written = Self.contents(of: board).filter { !own.contains($0.0) }
        if !written.isEmpty { first.extra = written }
        promisesOn = false
        note("began: WebKit wrote \(written.count) types")
    }

    /// The pointer moved: leaving Folevi's windows, the pasteboard becomes the notes' file promises (with WebKit's
    /// data too); coming back, WebKit's data alone.
    func moved(_ session: NSDraggingSession, to screenPoint: NSPoint) {
        guard session === notesSession, let first = promises.first else { return }
        let number = NSWindow.windowNumber(at: screenPoint, belowWindowWithWindowNumber: 0)
        let outside = NSApp.window(withWindowNumber: number) == nil
        guard outside != promisesOn else { return }
        let board = session.draggingPasteboard
        board.clearContents()
        if outside {
            board.writeObjects(promises)
        } else {
            let item = NSPasteboardItem()
            for (type, data) in first.extra { item.setData(data, forType: type) }
            board.writeObjects([item])
        }
        promisesOn = outside
        note(outside ? "promises on" : "WebKit's data back")
    }

    /// What happened to the last drags (Debug builds keep it for MacEval "dragLog").
    private(set) var log: [String] = []
    func note(_ s: String) {
        #if DEBUG
        log.append(s)
        if log.count > 50 { log.removeFirst() }
        #endif
    }

    func install() {
        guard monitor == nil else { return }
        Self.installDragImage()
        monitor = NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDown, .leftMouseDragged]) { event in
            MainActor.assumeIsolated { DragOut.shared.lastMouse = event }
            return event
        }
    }

    /// A Finder-safe file name for a note (Electron's dragFileName): the title without the characters Finder
    /// refuses, at most 120 characters, "Untitled" when nothing's left.
    nonisolated static func fileName(_ title: String, ext: String = "md") -> String {
        var base = title.replacingOccurrences(of: #"[\u0000-\u001F\u007F/\\:*?"<>|]+"#, with: "-", options: .regularExpression)
        while base.hasPrefix(".") { base.removeFirst() }
        base = String(base.trimmingCharacters(in: .whitespacesAndNewlines).prefix(120))
        if base.isEmpty { base = "Untitled" }
        return ext.isEmpty ? base : "\(base).\(ext)"
    }

    // MARK: dragFile (the page cancelled its own drag)

    func dragText(name: String, text: String, from view: FoleviWebView) {
        guard let event = lastMouse, let window = view.window, event.window === window else { return }
        let provider = NSFilePromiseProvider(fileType: Self.markdownType.identifier, delegate: self)
        provider.userInfo = Payload.text(name: Self.fileName(name), text: text)
        let item = NSDraggingItem(pasteboardWriter: provider)
        let icon = NSWorkspace.shared.icon(for: Self.markdownType)
        icon.size = NSSize(width: 32, height: 32)
        let point = view.convert(event.locationInWindow, from: nil)
        item.setDraggingFrame(NSRect(x: point.x - 16, y: point.y - 16, width: 32, height: 32), contents: icon)
        starting = true
        defer { starting = false }
        view.beginDraggingSession(with: [item], event: event, source: TextDragSource.shared)
    }

    // MARK: dragNotes (the page's own drag becomes a file promise)

    func expect(_ notes: [NoteRef], token: String, from view: FoleviWebView) {
        note("expect \(notes.count)")
        expected = notes.isEmpty ? nil : (ObjectIdentifier(view), notes, token, Date())
    }

    /// The notes the drag `view` is starting carries, if the page said so just now (taken once).
    func takeExpected(for view: FoleviWebView) -> (notes: [NoteRef], token: String)? {
        guard let e = expected, e.view == ObjectIdentifier(view), Date().timeIntervalSince(e.at) < 3 else { return nil }
        expected = nil
        return (e.notes, e.token)
    }

    /// File promises for `notes` that also carry what WebKit wrote for its drag, laid out like WebKit's item.
    func items(for notes: [NoteRef], token: String, view: FoleviWebView, carrying extra: [(NSPasteboard.PasteboardType, Data)], frame: NSRect, image: Any?) -> [NSDraggingItem] {
        promises = []
        return notes.enumerated().map { i, note in
            let provider = Promise(fileType: Self.markdownType.identifier, delegate: self)
            provider.userInfo = Payload.note(note, token: token, view: Weak(view))
            promises.append(provider)
            if i == 0 { provider.extra = extra }
            let item = NSDraggingItem(pasteboardWriter: provider)
            item.setDraggingFrame(frame.offsetBy(dx: CGFloat(i) * 4, dy: CGFloat(i) * -4), contents: i == 0 ? image : nil)
            return item
        }
    }

    /// Everything on a pasteboard, as type and data (read now: WebKit may fill some types lazily).
    static func contents(of pasteboard: NSPasteboard) -> [(NSPasteboard.PasteboardType, Data)] {
        guard let item = pasteboard.pasteboardItems?.first else { return [] }
        return item.types.compactMap { type in item.data(forType: type).map { (type, $0) } }
    }

    /// The page's answer for a dropped note: { request, text, files: [{ path, data }] } or { request, error }.
    func reply(_ o: [String: Any]) {
        guard let id = o["request"] as? String, let cont = replies.removeValue(forKey: id) else { return }
        cont.resume(returning: o)
    }

    private func ask(_ note: NoteRef, token: String, view: FoleviWebView?, folder: String) async -> [String: Any]? {
        guard let view else { return nil }
        let id = UUID().uuidString.lowercased()
        return await withCheckedContinuation { cont in
            replies[id] = cont
            view.events.emit("FoleviDesktop", "noteFile", ["request": id, "token": token, "id": note.id, "folder": folder])
            Task { @MainActor in
                try? await Task.sleep(for: .seconds(60))
                self.replies.removeValue(forKey: id)?.resume(returning: nil)
            }
        }
    }

    // MARK: NSFilePromiseProviderDelegate

    nonisolated func filePromiseProvider(_ provider: NSFilePromiseProvider, fileNameForType fileType: String) -> String {
        MainActor.assumeIsolated {
            switch provider.userInfo as? Payload {
            case .text(let name, _)?: return name
            case .note(let note, _, _)?: return Self.fileName(note.title)
            case nil: return "Untitled.md"
            }
        }
    }

    nonisolated func filePromiseProvider(_ provider: NSFilePromiseProvider, writePromiseTo url: URL, completionHandler: @escaping (Error?) -> Void) {
        MainActor.assumeIsolated {
            switch provider.userInfo as? Payload {
            case .text(_, let text)?:
                completionHandler(Self.write(text: text, files: [], to: url))
            case .note(let note, let token, let weak)?:
                let folder = Self.fileName(note.title, ext: "") + " files"
                Task { @MainActor in
                    guard let answer = await self.ask(note, token: token, view: weak.view, folder: folder), let text = answer["text"] as? String else {
                        return completionHandler(CocoaError(.fileWriteUnknown))
                    }
                    let files = (answer["files"] as? [[String: Any]] ?? []).compactMap { f -> (String, Data)? in
                        guard let path = f["path"] as? String, let b64 = f["data"] as? String, let data = Data(base64Encoded: b64) else { return nil }
                        return (path, data)
                    }
                    completionHandler(Self.write(text: text, files: files, to: url))
                }
            case nil:
                completionHandler(CocoaError(.fileWriteUnknown))
            }
        }
    }

    /// Writes the note, and its attachments beside it at their relative paths (inside the folder it names, never
    /// above it). Nil when it worked.
    nonisolated static func write(text: String, files: [(String, Data)], to url: URL) -> Error? {
        do {
            try Data(text.utf8).write(to: url, options: .atomic)
            let base = url.deletingLastPathComponent().standardizedFileURL
            for (path, data) in files.prefix(500) {
                guard let target = safeTarget(path, under: base) else { continue }
                try FileManager.default.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
                try data.write(to: target, options: .atomic)
            }
            return nil
        } catch {
            return error
        }
    }

    /// `path` (relative, "/"-separated) under `base`, or nil when it would leave it or isn't a plain path.
    nonisolated static func safeTarget(_ path: String, under base: URL) -> URL? {
        let parts = path.split(separator: "/", omittingEmptySubsequences: false).map(String.init)
        guard !parts.isEmpty, parts.count <= 8, !path.hasPrefix("/") else { return nil }
        for p in parts where p.isEmpty || p == "." || p == ".." || p.count > 200 || p.unicodeScalars.contains(where: { $0.value < 0x20 || $0 == "\\" || $0 == ":" }) { return nil }
        var url = base
        for p in parts { url.appendPathComponent(p) }
        return url.standardizedFileURL.path.hasPrefix(base.path + "/") ? url : nil
    }
}

/// The source of a drag the app started itself (dragFile): a copy outside the app; when it ends, the page's
/// view hears the mouse go up (the drag took the real one).
@MainActor
final class TextDragSource: NSObject, NSDraggingSource {
    static let shared = TextDragSource()

    nonisolated func draggingSession(_ session: NSDraggingSession, sourceOperationMaskFor context: NSDraggingContext) -> NSDragOperation {
        context == .outsideApplication ? .copy : []
    }

    nonisolated func draggingSession(_ session: NSDraggingSession, endedAt screenPoint: NSPoint, operation: NSDragOperation) {
        MainActor.assumeIsolated {
            guard let down = DragOut.shared.lastMouse, let window = down.window, let view = window.contentView?.hitTest(down.locationInWindow) as? FoleviWebView ?? Self.webView(in: window) else { return }
            let point = window.convertPoint(fromScreen: screenPoint)
            if let up = NSEvent.mouseEvent(with: .leftMouseUp, location: point, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber, context: nil, eventNumber: 0, clickCount: 1, pressure: 0) {
                view.mouseUp(with: up)
            }
        }
    }

    private static func webView(in window: NSWindow) -> FoleviWebView? {
        WindowManager.shared.allViews.first { $0.window === window }
    }
}

// WebKit starts a page's drag with NSView's dragImage(_:at:offset:event:pasteboard:source:slideBack:) (or
// beginDraggingSession for its own promises). When the page said the drag carries notes, the dragged item becomes
// the notes' file promises instead. dragImage is unavailable to Swift, so its stand-in is added to FoleviWebView at
// launch (DragOut.installDragImage), calling WKWebView's own for every other drag.
extension DragOut {
    typealias DragImage = @convention(c) (AnyObject, Selector, NSImage, NSPoint, NSSize, NSEvent, NSPasteboard, AnyObject, ObjCBool) -> Void

    static let dragImageSelector = NSSelectorFromString("dragImage:at:offset:event:pasteboard:source:slideBack:")

    static func installDragImage() {
        let sel = dragImageSelector
        guard let method = class_getInstanceMethod(WKWebView.self, sel), let types = method_getTypeEncoding(method) else { return }
        let original = unsafeBitCast(method_getImplementation(method), to: DragImage.self)
        let block: @convention(block) (FoleviWebView, NSImage, NSPoint, NSSize, NSEvent, NSPasteboard, AnyObject, ObjCBool) -> Void = { view, image, at, offset, event, pasteboard, source, slideBack in
            let drag = MainActor.assumeIsolated { DragOut.shared.starting ? nil : DragOut.shared.takeExpected(for: view) }
            MainActor.assumeIsolated { DragOut.shared.note("dragImage notes=\(drag?.notes.count ?? 0) types=\(pasteboard.types?.map(\.rawValue) ?? [])") }
            guard let drag, let src = source as? NSDraggingSource else {
                return original(view, sel, image, at, offset, event, pasteboard, source, slideBack)
            }
            MainActor.assumeIsolated {
                let extra = DragOut.contents(of: pasteboard)
                // dragImage's point is the image's bottom-left corner (in a flipped view, its largest y).
                let frame = NSRect(x: at.x, y: view.isFlipped ? at.y - image.size.height : at.y, width: image.size.width, height: image.size.height)
                let items = DragOut.shared.items(for: drag.notes, token: drag.token, view: view, carrying: extra, frame: frame, image: image)
                DragOut.shared.starting = true
                defer { DragOut.shared.starting = false }
                let session = view.beginDraggingSession(with: items, event: event, source: src)
                session.animatesToStartingPositionsOnCancelOrFail = slideBack.boolValue
                session.draggingFormation = .pile
                DragOut.shared.notesSession = session
            }
        }
        class_addMethod(FoleviWebView.self, sel, imp_implementationWithBlock(block), types)
    }
}

extension FoleviWebView {
    override func beginDraggingSession(with items: [NSDraggingItem], event: NSEvent, source: NSDraggingSource) -> NSDraggingSession {
        let drag = MainActor.assumeIsolated { DragOut.shared.starting ? nil : DragOut.shared.takeExpected(for: self) }
        MainActor.assumeIsolated { DragOut.shared.note("beginDraggingSession items=\(items.count) starting=\(DragOut.shared.starting) notes=\(drag?.notes.count ?? 0)") }
        guard let drag, let first = items.first else { return super.beginDraggingSession(with: items, event: event, source: source) }
        return MainActor.assumeIsolated {
            var extra: [(NSPasteboard.PasteboardType, Data)] = []
            if let writer = first.item as? NSPasteboardWriting {
                let board = NSPasteboard(name: NSPasteboard.Name("com.folevi.mac.drag-copy"))
                board.clearContents()
                board.writeObjects([writer])
                extra = DragOut.contents(of: board)
            }
            var image: Any?
            if let component = first.imageComponents?.first { image = component.contents }
            let mine = DragOut.shared.items(for: drag.notes, token: drag.token, view: self, carrying: extra, frame: first.draggingFrame, image: image)
            DragOut.shared.starting = true
            defer { DragOut.shared.starting = false }
            let session = super.beginDraggingSession(with: mine, event: event, source: source)
            DragOut.shared.notesSession = session
            return session
        }
    }

    /// The drag begins: WebKit writes its data (kept for DragOut.moved).
    @objc(draggingSession:willBeginAtPoint:)
    func foleviDraggingSession(_ session: NSDraggingSession, willBeginAt point: NSPoint) {
        typealias Original = @convention(c) (AnyObject, Selector, NSDraggingSession, NSPoint) -> Void
        let sel = #selector(foleviDraggingSession(_:willBeginAt:))
        if WKWebView.instancesRespond(to: sel), let imp = class_getMethodImplementation(WKWebView.self, sel) {
            unsafeBitCast(imp, to: Original.self)(self, sel, session, point)
        }
        MainActor.assumeIsolated { DragOut.shared.began(session) }
    }

    @objc(draggingSession:movedToPoint:)
    func foleviDraggingSession(_ session: NSDraggingSession, movedTo point: NSPoint) {
        typealias Original = @convention(c) (AnyObject, Selector, NSDraggingSession, NSPoint) -> Void
        let sel = #selector(foleviDraggingSession(_:movedTo:))
        if WKWebView.instancesRespond(to: sel), let imp = class_getMethodImplementation(WKWebView.self, sel) {
            unsafeBitCast(imp, to: Original.self)(self, sel, session, point)
        }
        MainActor.assumeIsolated { DragOut.shared.moved(session, to: point) }
    }

    /// WebKit allows what the page allowed (a note's drag is a "move"); notes dragged out of the app are copied.
    @objc(draggingSession:sourceOperationMaskForDraggingContext:)
    func foleviDraggingSession(_ session: NSDraggingSession, sourceOperationMaskFor context: NSDraggingContext) -> NSDragOperation {
        typealias Original = @convention(c) (AnyObject, Selector, NSDraggingSession, NSDraggingContext) -> NSDragOperation
        let sel = #selector(foleviDraggingSession(_:sourceOperationMaskFor:))
        var mask: NSDragOperation = []
        if let imp = class_getMethodImplementation(WKWebView.self, sel), WKWebView.instancesRespond(to: sel) {
            mask = unsafeBitCast(imp, to: Original.self)(self, sel, session, context)
        }
        let notes = MainActor.assumeIsolated { DragOut.shared.notesSession === session }
        if notes, context == .outsideApplication { mask.insert(.copy) }
        return mask
    }
}
