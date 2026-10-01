import Foundation

#if DEBUG
/// DEBUG-only scripted scenarios for automated verification (`-FoleviAutomation <name>`), driven through
/// the real editor model and sync engine. Never compiled into Release builds.
@MainActor
enum Automation {
    static var scenario: String? { LaunchOptions.value(after: "-FoleviAutomation") }

    /// "offline-edit": go offline, append a block, stay offline for a while, reconnect and sync.
    static func run(editor: EditorModel, app: AppModel) async {
        guard let scenario else { return }
        Log.app.info("automation scenario \(scenario, privacy: .public) starting")
        for _ in 0..<50 where editor.loadState != .ready { try? await Task.sleep(for: .milliseconds(200)) }
        switch scenario {
        case "offline-edit":
            let offlineSeconds = Double(LaunchOptions.value(after: "-FoleviOfflineSeconds") ?? "8") ?? 8
            let marker = LaunchOptions.value(after: "-FoleviMarker") ?? "Mac offline edit"
            await app.setForcedOffline(true)
            try? await Task.sleep(for: .seconds(1))
            let lastRoot = editor.rows.last { $0.block.parentId == nil }
            let block = Block(id: ULID.make(), parentId: nil, rank: Rank.betweenOrAfter(lastRoot?.block.rank, nil),
                              text: RichText.text(marker), content: .paragraph(ParagraphProps()))
            editor.commit(upserts: [block], focus: LaunchOptions.flag("-FoleviNoFocus") ? nil : FocusRequest(blockId: block.id, caret: .end), actionName: "Automation")
            // A second edit to the same block while offline (coalesced by the reducer).
            try? await Task.sleep(for: .seconds(1))
            editor.textChanged(blockId: block.id, text: RichText.text(marker + " (edited twice)"))
            try? await Task.sleep(for: .seconds(offlineSeconds))
            await app.setForcedOffline(false)
        case "resolve-both", "resolve-theirs", "resolve-mine":
            let choice = ConflictChoice(rawValue: String(scenario.dropFirst("resolve-".count))) ?? .theirs
            for _ in 0..<30 where editor.conflicts.isEmpty { try? await Task.sleep(for: .milliseconds(200)) }
            for conflict in editor.conflicts { editor.resolve(conflict, choice) }
        case "export-all":
            let dir = FileManager.default.temporaryDirectory.appendingPathComponent("folevi-export-test", isDirectory: true)
            try? FileManager.default.removeItem(at: dir)
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            let title = editor.document?.displayTitle ?? "Untitled"
            for format in ExportService.Format.allCases {
                let ext = format == .markdown ? "md" : format.rawValue
                do {
                    _ = try await ExportService.write(format, to: dir.appendingPathComponent("export.\(ext)"), title: title, blocks: editor.exportBlocks(), app: app, asFolder: false)
                } catch {
                    Log.app.error("export \(format.rawValue, privacy: .public) failed")
                }
            }
        case "cover-set":
            // -FoleviCover kind:value (e.g. gradient:moss) — used to put a test document back.
            try? await Task.sleep(for: .seconds(2))
            let spec = (LaunchOptions.value(after: "-FoleviCover") ?? "none").split(separator: ":").map(String.init)
            if let kind = CoverKind(rawValue: spec[0]) {
                editor.setCover(DocumentCover(kind: kind, value: spec.count > 1 ? spec[1] : nil))
            }
        case "cover-art":
            // Show an art cover for a while (screenshots), then put the original cover back.
            try? await Task.sleep(for: .seconds(3))
            let original = editor.document?.cover ?? DocumentCover(kind: .none)
            editor.setCover(DocumentCover(kind: .art, value: LaunchOptions.value(after: "-FoleviCover") ?? "art-01"))
            try? await Task.sleep(for: .seconds(Double(LaunchOptions.value(after: "-FoleviDragHold") ?? "8") ?? 8))
            editor.setCover(original)
        case "drag", "drag-nest", "drag-cancel", "drag-tile":
            await DragAutomation.run(scenario, editor: editor)
        case "offline-conflict":
            // Edit the first paragraph offline; the test harness edits the same block remotely meanwhile.
            await app.setForcedOffline(true)
            try? await Task.sleep(for: .seconds(1))
            guard let row = editor.rows.first(where: { if case .paragraph = $0.block.content { return true } else { return false } }) else { return }
            editor.textChanged(blockId: row.id, text: row.block.text + RichText.text(" (edited on the Mac)"))
            try? await Task.sleep(for: .seconds(Double(LaunchOptions.value(after: "-FoleviOfflineSeconds") ?? "8") ?? 8))
            await app.setForcedOffline(false)
        default:
            break
        }
    }
}
#endif

#if DEBUG
import AppKit

/// Drives a real pointer drag through the app's event queue (so gesture recognizers and the drag
/// controller's event monitors see it exactly like a mouse): hover the grip, press, move in small
/// steps, hold (for screenshots), release, then undo so the document ends unchanged.
///   -FoleviAutomation drag|drag-nest|drag-cancel|drag-tile  [-FoleviDragHold seconds]
@MainActor
enum DragAutomation {
    static var log: [String] = []
    static func note(_ s: String) {
        log.append(s)
        try? log.joined(separator: "\n").write(toFile: NSTemporaryDirectory() + "drag-auto.txt", atomically: true, encoding: .utf8)
    }

    static func run(_ scenario: String, editor: EditorModel) async {
        note("start \(scenario)")
        try? await Task.sleep(for: .seconds(1.5))
        note("anchor \(editor.drag.anchor != nil) window \(editor.drag.anchor?.window != nil) frames \(editor.drag.rowFrames.count)")
        guard let anchor = editor.drag.anchor, let window = anchor.window else { return }
        // Posted mouse events only reach the views of the key window of the active app.
        NSApp.activate()
        window.makeKeyAndOrderFront(nil)
        try? await Task.sleep(for: .milliseconds(500))
        let hold = Double(LaunchOptions.value(after: "-FoleviDragHold") ?? "4") ?? 4
        // The first to-do row is the source; keep it on screen.
        guard let row = editor.rows.first(where: { if case .todo = $0.block.content { return true } else { return false } }) else { return }
        editor.revealBlockId = row.id
        try? await Task.sleep(for: .seconds(0.8))
        guard let frame = editor.drag.rowFrames[row.id] else { return }
        let scale = CGFloat(editor.app.editorScale)
        let pad = BlockStyles.verticalPadding(for: row.block, previous: row.previous)
        let lh = BlockStyles.lineHeight(BlockStyles.style(for: row.block, document: editor.style, scale: scale))
        let indent = CGFloat(row.depth) * BlockMetrics.indent(scale)
        let gripInBlocks = CGPoint(x: frame.minX + indent + BlockMetrics.gutter - 15, y: frame.minY + pad.top + max(24, lh) / 2)
        var point = anchor.convert(gripInBlocks, to: nil) // window base coordinates
        note("row frame \(frame) grip \(gripInBlocks) window point \(point)")

        if scenario == "drag-tile" {
            // Drag the "Callout" Insert tile into the page instead (the inspector must be open).
            try? await Task.sleep(for: .seconds(0.5))
            guard let content = window.contentView else { return }
            _ = content
            editor.drag.beginInsertDrag(type: "callout", title: "Callout", systemImage: "exclamationmark.bubble",
                                        at: content.convert(point, from: nil))
        } else {
            // Synthetic presses don't satisfy SwiftUI's gesture recognizer (it checks the real
            // button state), so start the drag the way the grip's DragGesture does, then drive
            // everything else with posted events through the controller's event monitors.
            guard let content = window.contentView else { return }
            let start = content.convert(point, from: nil)
            editor.drag.beginBlockDrag(blockId: row.id, start: start, current: start)
            note("after begin active=\(editor.drag.isActive)")
        }
        let dx: CGFloat = scenario == "drag-nest" ? 30 : 6
        let dy: CGFloat = Double(LaunchOptions.value(after: "-FoleviDragDY") ?? "90") ?? 90 // window base coordinates: positive = up the page
        let steps = 45
        for i in 1...steps {
            let t = CGFloat(i) / CGFloat(steps)
            point = NSPoint(x: anchor.convert(gripInBlocks, to: nil).x + dx * t, y: anchor.convert(gripInBlocks, to: nil).y + dy * t)
            post(.leftMouseDragged, point, window)
            try? await Task.sleep(for: .milliseconds(8))
        }
        note("after moves active=\(editor.drag.isActive) line=\(String(describing: editor.drag.line))")
        try? await Task.sleep(for: .seconds(hold))
        if scenario == "drag-cancel" {
            postKey(53, window)
            try? await Task.sleep(for: .milliseconds(400))
            post(.leftMouseUp, point, window)
            return
        }
        post(.leftMouseUp, point, window)
        try? await Task.sleep(for: .seconds(hold))
        // Leave Ada's document as it was.
        editor.undoManager?.undo()
    }

    private static func post(_ type: NSEvent.EventType, _ location: NSPoint, _ window: NSWindow) {
        guard let e = NSEvent.mouseEvent(with: type, location: location, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
                                         windowNumber: window.windowNumber, context: nil, eventNumber: 0, clickCount: 1,
                                         pressure: type == .leftMouseUp || type == .mouseMoved ? 0 : 1) else { return }
        if LaunchOptions.flag("-FoleviDragDirect") { window.sendEvent(e) } else { NSApp.postEvent(e, atStart: false) }
    }

    private static func postKey(_ code: UInt16, _ window: NSWindow) {
        guard let e = NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
                                       windowNumber: window.windowNumber, context: nil, characters: "\u{1b}", charactersIgnoringModifiers: "\u{1b}",
                                       isARepeat: false, keyCode: code) else { return }
        NSApp.postEvent(e, atStart: false)
    }
}

@MainActor
enum LayoutProbe {
    /// `-FoleviLayoutProbe YES`: writes window/view geometry to the app container's tmp dir after launch.
    static func scheduleIfRequested() {
        guard LaunchOptions.flag("-FoleviLayoutProbe") else { return }
        Task {
            try? await Task.sleep(for: .seconds(6))
            var out = ""
            for w in NSApp.windows where w.isVisible {
                out += "window \(w.title) frame=\(w.frame) contentLayout=\(w.contentLayoutRect) styleMask=\(w.styleMask.rawValue)\n"
                @MainActor func dump(_ v: NSView, _ depth: Int) {
                    guard depth < 7 else { return }
                    out += String(repeating: "  ", count: depth) + "\(type(of: v)) frame=\(v.frame) bounds=\(v.bounds)\n"
                    for s in v.subviews.prefix(6) { dump(s, depth + 1) }
                }
                if let cv = w.contentView { dump(cv, 0) }
            }
            let url = FileManager.default.temporaryDirectory.appendingPathComponent("folevi-layout.txt")
            try? out.write(to: url, atomically: true, encoding: .utf8)
            Log.app.info("layout probe written to \(url.path, privacy: .public)")
        }
    }
}
#endif
