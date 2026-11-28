import AppKit
import UniformTypeIdentifiers

/// Reads `.md`, `.markdown`, `.txt` and `.rtf` files (drop on a dot or the window, File ▸ Import).
enum FileImporter {
    enum Content {
        case markdown(String)
        case rich(NSAttributedString)
    }

    static let types: [UTType] = [.plainText, UTType(filenameExtension: "md") ?? .plainText, .rtf, .rtfd]

    static func read(_ url: URL) -> Content? {
        let ext = url.pathExtension.lowercased()
        let type = UTType(filenameExtension: ext)
        let access = url.startAccessingSecurityScopedResource()
        defer { if access { url.stopAccessingSecurityScopedResource() } }
        if ext == "rtf" || ext == "rtfd" || type?.conforms(to: .rtf) == true {
            if let attributed = try? NSAttributedString(url: url, options: [:], documentAttributes: nil) { return .rich(attributed) }
            return nil
        }
        if ["md", "markdown", "mdown", "txt", "text"].contains(ext) || type?.conforms(to: .plainText) == true {
            guard let data = try? Data(contentsOf: url) else { return nil }
            let text = String(data: data, encoding: .utf8) ?? String(data: data, encoding: .utf16) ?? String(decoding: data, as: UTF8.self)
            return .markdown(text)
        }
        return nil
    }
}

/// Writes a dot as Markdown, RTF or plain text via the standard save panel.
enum FileExporter {
    enum Format: String, CaseIterable, Identifiable {
        case markdown, rtf, plainText
        var id: String { rawValue }
        var type: UTType {
            switch self {
            case .markdown: UTType(filenameExtension: "md") ?? .plainText
            case .rtf: .rtf
            case .plainText: .plainText
            }
        }
        var ext: String {
            switch self { case .markdown: "md"; case .rtf: "rtf"; case .plainText: "txt" }
        }
        var title: String {
            switch self {
            case .markdown: String(localized: "Markdown (.md)")
            case .rtf: String(localized: "Rich Text (.rtf)")
            case .plainText: String(localized: "Plain Text (.txt)")
            }
        }
    }

    @MainActor
    static func data(for dotID: UUID, format: Format, model: AppModel) -> Data {
        let editor = model.editor
        switch format {
        case .markdown:
            return Data(editor.markdown(of: dotID).utf8)
        case .plainText:
            if let attributed = editor.attributedText(of: dotID) {
                return Data(AttributedMarkdown.readableText(from: attributed).utf8)
            }
            return Data(editor.markdown(of: dotID).utf8)
        case .rtf:
            guard let attributed = editor.attributedText(of: dotID) else { return Data() }
            return RichTextCodec.displayRTF(attributed)
        }
    }

    @MainActor
    static func export(dotID: UUID, model: AppModel, preferred: Format? = nil) {
        guard let dot = model.dots.first(where: { $0.id == dotID }) else { return }
        let panel = NSSavePanel()
        var format = preferred ?? (dot.isRichText ? .rtf : .markdown)
        panel.nameFieldStringValue = dot.displayName
        panel.allowedContentTypes = [format.type]
        panel.canCreateDirectories = true
        panel.title = String(localized: "Export Dot")
        let popup = NSPopUpButton(frame: .zero, pullsDown: false)
        for f in Format.allCases { popup.addItem(withTitle: f.title) }
        popup.selectItem(at: Format.allCases.firstIndex(of: format) ?? 0)
        let handler = PopupHandler { index in
            format = Format.allCases[index]
            panel.allowedContentTypes = [format.type]
        }
        popup.target = handler
        popup.action = #selector(PopupHandler.changed(_:))
        let label = NSTextField(labelWithString: String(localized: "Format:"))
        let stack = NSStackView(views: [label, popup])
        stack.edgeInsets = NSEdgeInsets(top: 8, left: 12, bottom: 8, right: 12)
        panel.accessoryView = stack
        model.runModalPanel {
            if panel.runModal() == .OK, let url = panel.url {
                let data = Self.data(for: dotID, format: format, model: model)
                do {
                    try data.write(to: url, options: .atomic)
                    model.showToast(String(localized: "Exported “\(url.lastPathComponent)”"), symbol: "square.and.arrow.up")
                } catch {
                    model.showToast(String(localized: "Couldn’t export: \(error.localizedDescription)"), symbol: "exclamationmark.triangle")
                }
            }
        }
        withExtendedLifetime(handler) {}
    }
}

@MainActor
final class PopupHandler: NSObject {
    let onChange: (Int) -> Void
    init(_ onChange: @escaping (Int) -> Void) { self.onChange = onChange }
    @objc func changed(_ sender: NSPopUpButton) { onChange(sender.indexOfSelectedItem) }
}

/// Prints a dot with a clean layout: light appearance, the note's fonts, a title line.
enum NotePrinter {
    @MainActor
    static func print(dotID: UUID, model: AppModel) {
        guard let attributed = model.editor.attributedText(of: dotID),
              let dot = model.dots.first(where: { $0.id == dotID }) else { return }
        let info = NSPrintInfo.shared.copy() as! NSPrintInfo
        info.horizontalPagination = .fit
        info.verticalPagination = .automatic
        info.isVerticallyCentered = false
        info.topMargin = 54; info.bottomMargin = 54; info.leftMargin = 54; info.rightMargin = 54
        let width = info.paperSize.width - info.leftMargin - info.rightMargin
        let content = NSMutableAttributedString(string: dot.displayName + "\n",
                                                attributes: [.font: NSFont.systemFont(ofSize: 17, weight: .semibold),
                                                             .foregroundColor: NSColor.black])
        let body = NSMutableAttributedString(attributedString: attributed)
        body.removeAttribute(.backgroundColor, range: NSRange(location: 0, length: body.length))
        body.enumerateAttribute(.foregroundColor, in: NSRange(location: 0, length: body.length)) { value, range, _ in
            let dimmed = (value as? NSColor) == NSColor.secondaryLabelColor
            body.addAttribute(.foregroundColor, value: dimmed ? NSColor.darkGray : NSColor.black, range: range)
        }
        content.append(body)
        let textView = NSTextView(frame: NSRect(x: 0, y: 0, width: width, height: 100))
        textView.appearance = NSAppearance(named: .aqua)
        textView.textContainerInset = .zero
        textView.textStorage?.setAttributedString(content)
        textView.isVerticallyResizable = true
        textView.sizeToFit()
        let op = NSPrintOperation(view: textView, printInfo: info)
        op.jobTitle = dot.displayName
        op.showsPrintPanel = true
        op.showsProgressPanel = true
        model.runModalPanel {
            op.run()
        }
    }
}
