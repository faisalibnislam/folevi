// The clipboard for Folevi's own menus (docs/MAC_WEBKIT_PLAN.md §6.7): WebKit asks with a "Paste" bubble when a
// page reads the clipboard outside a paste (⌘V), so the app's context menus' Paste and Paste as Plain Text read it
// here instead (foleviDesktop.clipboard.read / write). ⌘V and Edit > Paste keep WebKit's own paste.
// Text, HTML and a PNG image; at most 20 MB of each.
import AppKit

@MainActor
enum Clipboard {
    static let maxBytes = 20 * 1024 * 1024

    /// What's on the clipboard: { text?, html?, image? (base64 PNG) }.
    static func read(_ board: NSPasteboard = .general) -> [String: Any] {
        var out: [String: Any] = [:]
        if let text = board.string(forType: .string), text.utf8.count <= maxBytes { out["text"] = text }
        if let html = board.string(forType: .html), html.utf8.count <= maxBytes { out["html"] = html }
        if let png = imagePNG(board), png.count <= maxBytes { out["image"] = png.base64EncodedString() }
        return out
    }

    /// Replaces the clipboard with { text?, html?, image? (base64 PNG) } (at least one).
    static func write(_ o: [String: Any], to board: NSPasteboard = .general) throws {
        let text = o["text"] as? String
        let html = o["html"] as? String
        let image = (o["image"] as? String).flatMap { Data(base64Encoded: $0) }
        guard text != nil || html != nil || image != nil else { throw BridgeError.invalid("There's nothing to copy.") }
        guard (text?.utf8.count ?? 0) <= maxBytes, (html?.utf8.count ?? 0) <= maxBytes, (image?.count ?? 0) <= maxBytes else { throw BridgeError.invalid("That's too big to copy.") }
        board.clearContents()
        if let text { board.setString(text, forType: .string) }
        if let html { board.setString(html, forType: .html) }
        if let image, NSImage(data: image) != nil { board.setData(image, forType: .png) }
    }

    /// The clipboard's image as PNG (a PNG as it is; TIFF and the rest converted).
    static func imagePNG(_ board: NSPasteboard) -> Data? {
        if let png = board.data(forType: .png) { return png }
        guard let tiff = board.data(forType: .tiff), let rep = NSBitmapImageRep(data: tiff) else { return nil }
        return rep.representation(using: .png, properties: [:])
    }
}
