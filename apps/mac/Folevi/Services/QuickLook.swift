// Quick Look for attachments (foleviDesktop.quickLook): the Mac's own preview panel for a file in a note (a PDF,
// an image, a document, audio or video), the one Finder shows on Space, without saving it anywhere first. The page
// hands over the file's bytes; they're written to a temporary folder the panel reads, which is emptied when it
// closes. The panel finds its controller through the responder chain: the web view that asked answers for it.
import AppKit
import Quartz

@MainActor
final class QuickLook: NSObject, QLPreviewPanelDataSource, QLPreviewPanelDelegate {
    static let shared = QuickLook()

    struct File {
        let name: String
        let data: Data
    }

    private var urls: [URL] = []
    private var folder: URL?
    /// The view whose responder chain holds the panel now.
    private(set) weak var owner: FoleviWebView?

    func show(_ files: [File], from view: FoleviWebView) throws {
        clear()
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("Folevi Quick Look", isDirectory: true).appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        folder = dir
        urls = try files.map { f in
            let url = dir.appendingPathComponent(DragOut.fileName(f.name, ext: ""))
            try f.data.write(to: url, options: .atomic)
            return url
        }
        owner = view
        view.window?.makeFirstResponder(view)
        guard let panel = QLPreviewPanel.shared() else { return }
        if panel.isVisible {
            panel.reloadData()
        } else {
            panel.makeKeyAndOrderFront(nil)
        }
        panel.currentPreviewItemIndex = 0
    }

    private func clear() {
        if let folder { try? FileManager.default.removeItem(at: folder) }
        folder = nil
        urls = []
    }

    func ended() {
        clear()
        owner = nil
    }

    nonisolated func numberOfPreviewItems(in panel: QLPreviewPanel!) -> Int {
        MainActor.assumeIsolated { urls.count }
    }

    nonisolated func previewPanel(_ panel: QLPreviewPanel!, previewItemAt index: Int) -> (any QLPreviewItem)! {
        MainActor.assumeIsolated { urls.indices.contains(index) ? urls[index] as NSURL : nil }
    }
}

extension FoleviWebView {
    override func acceptsPreviewPanelControl(_ panel: QLPreviewPanel!) -> Bool {
        MainActor.assumeIsolated { QuickLook.shared.owner === self }
    }

    override func beginPreviewPanelControl(_ panel: QLPreviewPanel!) {
        panel.dataSource = QuickLook.shared
        panel.delegate = QuickLook.shared
        panel.reloadData()
    }

    override func endPreviewPanelControl(_ panel: QLPreviewPanel!) {
        MainActor.assumeIsolated { QuickLook.shared.ended() }
    }
}
