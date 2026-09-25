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
