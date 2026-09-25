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
            editor.commit(upserts: [block], focus: FocusRequest(blockId: block.id, caret: .end), actionName: "Automation")
            // A second edit to the same block while offline (coalesced by the reducer).
            try? await Task.sleep(for: .seconds(1))
            editor.textChanged(blockId: block.id, text: RichText.text(marker + " (edited twice)"))
            try? await Task.sleep(for: .seconds(offlineSeconds))
            await app.setForcedOffline(false)
        default:
            break
        }
    }
}
#endif
