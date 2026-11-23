// Small pieces several screens share: importing Markdown and text files (opened with the app or dropped on a window),
// the menu for empty space, and middle-click to open in a background tab.
import AppKit
import FoleviEngine
import SwiftUI
import UniformTypeIdentifiers

@MainActor
enum FileImport {
    static let types: [UTType] = [.plainText, UTType(filenameExtension: "md") ?? .plainText, UTType(filenameExtension: "markdown") ?? .plainText]

    static func accepts(_ url: URL) -> Bool { ["md", "markdown", "txt", "text"].contains(url.pathExtension.lowercased()) }

    /// Each file becomes a note: its name the title, its text the body (in the folder on screen, if any).
    static func importFiles(_ urls: [URL], window: WindowModel?) {
        let files = urls.filter(accepts)
        guard !files.isEmpty else { return }
        let folder: String? = { if case .folder(let id) = window?.current { return id } else { return nil } }()
        let app = AppModel.shared
        app.perform { client in
            var last: String?
            for url in files {
                let access = url.startAccessingSecurityScopedResource()
                defer { if access { url.stopAccessingSecurityScopedResource() } }
                guard let text = try? String(contentsOf: url, encoding: .utf8) else { continue }
                let title = url.deletingPathExtension().lastPathComponent
                let r = try await client.command(Commands.NoteCreate(NoteCreateArgs(space: nil, folderId: folder, parentId: nil, title: title, templateId: nil, open: false, text: text)))
                last = r.id
            }
            if let last {
                if files.count == 1 { window?.go(.note(last)) ?? app.open(.note(last)) } else { app.toast("Imported \(files.count) notes") }
            }
        }
    }
}

/// Right-click on empty space: what you can start from anywhere.
struct AnywhereMenu: View {
    let window: WindowModel
    private var app: AppModel { .shared }

    var body: some View {
        Button("New Note") { NoteActions.newNote(app: app, window: window) }
        Button("New Folder…") { window.newFolderRequested = true }
        Button("Quick Add Task…") { window.quickAddShown = true }
        Divider()
        Button("Search…") { window.go(.search("")) }
        Button("Command Palette…") { window.paletteShown = true }
        if app.session.value?.capabilities.ai != false { Button("Ask Foli AI") { window.askShown = true } }
    }
}

/// Middle-click: an NSView over the content that answers only middle-button presses, so ordinary clicks, drags
/// and right-clicks reach the view underneath.
private final class MiddleClickView: NSView {
    var action: () -> Void = {}
    override func hitTest(_ point: NSPoint) -> NSView? {
        NSApp.currentEvent?.type == .otherMouseDown || NSApp.currentEvent?.type == .otherMouseUp ? super.hitTest(point) : nil
    }
    override func otherMouseUp(with event: NSEvent) { if event.buttonNumber == 2 { action() } }
}

private struct MiddleClick: NSViewRepresentable {
    let action: () -> Void
    func makeNSView(context: Context) -> MiddleClickView { let v = MiddleClickView(); v.action = action; return v }
    func updateNSView(_ v: MiddleClickView, context: Context) { v.action = action }
}

extension View {
    /// Runs `action` on a middle-button click (open in a background tab).
    func onMiddleClick(_ action: @escaping () -> Void) -> some View { overlay(MiddleClick(action: action)) }
}
