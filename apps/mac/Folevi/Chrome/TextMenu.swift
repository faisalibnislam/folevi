// The native services Folevi's own text menu offers on the Mac (decision M1: Folevi's menus everywhere, text
// included, so the system's text menu isn't shown): spelling suggestions and learning a word (NSSpellChecker),
// and Look Up (the dictionary panel at the word); Share is the Mac capabilities' foleviDesktop.share (Sharing.swift).
// The page draws the menu (WM4) and asks through foleviDesktop.spelling / learnWord / ignoreWord / lookUp.
import AppKit
import WebKit

@MainActor
enum TextMenu {
    /// A document tag per view, so "Ignore Spelling" lasts for that page only.
    private static var tags: [ObjectIdentifier: Int] = [:]

    private static func tag(_ view: FoleviWebView?) -> Int {
        guard let view else { return 0 }
        let id = ObjectIdentifier(view)
        if let t = tags[id] { return t }
        let t = NSSpellChecker.uniqueSpellDocumentTag()
        tags[id] = t
        return t
    }

    /// One word only (letters, marks, apostrophes and hyphens inside), or nil.
    nonisolated static func word(_ raw: String) -> String? {
        let w = raw.trimmingCharacters(in: .whitespacesAndNewlines.union(.punctuationCharacters))
        guard !w.isEmpty, w.count <= 64, w.rangeOfCharacter(from: .whitespacesAndNewlines) == nil else { return nil }
        return w
    }

    static func spelling(_ raw: String, view: FoleviWebView?) -> [String: Any] {
        guard let w = word(raw) else { return ["misspelled": false, "guesses": [String]()] }
        let checker = NSSpellChecker.shared
        let t = tag(view)
        let range = checker.checkSpelling(of: w, startingAt: 0, language: nil, wrap: false, inSpellDocumentWithTag: t, wordCount: nil)
        guard range.location != NSNotFound else { return ["misspelled": false, "guesses": [String]()] }
        let guesses = checker.guesses(forWordRange: NSRange(location: 0, length: (w as NSString).length), in: w, language: nil, inSpellDocumentWithTag: t) ?? []
        return ["misspelled": true, "guesses": Array(guesses.prefix(8))]
    }

    static func learn(_ raw: String) {
        guard let w = word(raw) else { return }
        NSSpellChecker.shared.learnWord(w)
    }

    static func ignore(_ raw: String, view: FoleviWebView?) {
        guard let w = word(raw) else { return }
        NSSpellChecker.shared.ignoreWord(w, inSpellDocumentWithTag: tag(view))
    }

    /// The page's point (CSS px) in the view's own coordinates.
    static func point(_ x: Double, _ y: Double, in view: NSView) -> NSPoint {
        let zoom = (view as? WKWebView)?.pageZoom ?? 1
        let px = CGFloat(x * zoom), py = CGFloat(y * zoom)
        return NSPoint(x: px, y: view.isFlipped ? py : view.bounds.height - py)
    }

    /// The dictionary panel for the text, its baseline at the point.
    static func lookUp(_ text: String, x: Double, y: Double, view: FoleviWebView) {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty else { return }
        let font = NSFont.systemFont(ofSize: 13.5 * view.pageZoom)
        view.showDefinition(for: NSAttributedString(string: String(t.prefix(2000)), attributes: [.font: font]), at: point(x, y, in: view))
    }

    static func forget(_ view: FoleviWebView) {
        if let t = tags.removeValue(forKey: ObjectIdentifier(view)) { NSSpellChecker.shared.closeSpellDocument(withTag: t) }
    }
}
