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

    /// Whether `raw` is misspelt, and the guesses for it. `context` is the text around the word (its paragraph, from
    /// chrome-page.js): the word is checked there, so its language is told from its sentence, as WebKit tells it
    /// for the page's red underline, and by the person's own spelling settings (one language, or Automatic by
    /// Language). A word on its own says little: with several languages on, "teh" alone passes as a word of one
    /// of them, so the menu had no guesses for a word the page had underlined.
    static func spelling(_ raw: String, context: String = "", view: FoleviWebView?) -> [String: Any] {
        let none: [String: Any] = ["misspelled": false, "guesses": [String]()]
        guard let w = word(raw) else { return none }
        let checker = NSSpellChecker.shared
        let t = tag(view)
        if context.contains(w) {
            let text = context as NSString
            var orthography: NSOrthography?
            let found = checker.check(context, range: NSRange(location: 0, length: text.length), types: NSTextCheckingResult.CheckingType.spelling.rawValue, options: nil, inSpellDocumentWithTag: t, orthography: &orthography, wordCount: nil)
            if let hit = found.first(where: { $0.resultType == .spelling && text.substring(with: $0.range) == w }) {
                let language = checker.language(forWordRange: hit.range, in: context, orthography: orthography)
                let guesses = checker.guesses(forWordRange: hit.range, in: context, language: language, inSpellDocumentWithTag: t) ?? []
                return ["misspelled": true, "guesses": Array(guesses.prefix(8))]
            }
        }
        // No text around it (or the checker split the word another way): the word alone, in the language of the
        // Spelling settings (`language: nil`; with Automatic by Language, a word of any of the person's languages).
        let range = checker.checkSpelling(of: w, startingAt: 0, language: nil, wrap: false, inSpellDocumentWithTag: t, wordCount: nil)
        guard range.location != NSNotFound else { return none }
        let guesses = checker.guesses(forWordRange: NSRange(location: 0, length: (w as NSString).length), in: w, language: nil, inSpellDocumentWithTag: t) ?? []
        return ["misspelled": true, "guesses": Array(guesses.prefix(8))]
    }

    /// "Learn Spelling": the word joins the Mac's dictionary, and the page stops underlining it.
    static func learn(_ raw: String, view: FoleviWebView? = nil) {
        guard let w = word(raw) else { return }
        NSSpellChecker.shared.learnWord(w)
        clearUnderline(w, view: view)
    }

    /// "Ignore Spelling": the word passes for this page (in Folevi's own check and in WebKit's).
    static func ignore(_ raw: String, view: FoleviWebView?) {
        guard let w = word(raw) else { return }
        NSSpellChecker.shared.ignoreWord(w, inSpellDocumentWithTag: tag(view))
        clearUnderline(w, view: view)
    }

    /// Takes the red underline off the word in the page. The underline is WebKit's, from a spell document of its
    /// own that the app can't reach, so learning or ignoring the word above left it there until the word was
    /// typed again. WebKit's own Ignore Spelling (`ignoreSpelling:`) removes the mark and has its document pass
    /// the word from then on; it acts on the selected word, so the page selects it first (chrome-page.js, where
    /// the right-click landed) and says whether it could.
    private static func clearUnderline(_ w: String, view: FoleviWebView?) {
        guard let view else { return }
        let action = #selector(NSIgnoreMisspelledWords.ignoreSpelling(_:))
        guard view.responds(to: action) else { return }
        let script = "return typeof window.__foleviSelectWord === 'function' && window.__foleviSelectWord(word) === true;"
        view.callAsyncJavaScript(script, arguments: ["word": w], in: nil, in: .page) { [weak view] result in
            guard case .success(let value) = result, (value as? Bool) == true else { return }
            view?.perform(action, with: nil)
        }
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
