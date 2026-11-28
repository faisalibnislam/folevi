import Foundation

struct TextCounts: Equatable, Sendable {
    var words = 0
    var characters = 0
    var charactersExcludingSpaces = 0
    var selectionWords: Int?
    var selectionCharacters: Int?
}

/// Word and character counting. Words use the system's linguistic word boundaries, so CJK text
/// (which has no spaces) is counted correctly. Attachment characters are ignored.
enum TextCounter {
    static func count(_ text: String) -> (words: Int, characters: Int, charactersExcludingSpaces: Int) {
        var characters = 0
        var nonSpace = 0
        for ch in text where ch != "\u{FFFC}" {
            characters += 1
            if !ch.isWhitespace { nonSpace += 1 }
        }
        var words = 0
        text.enumerateSubstrings(in: text.startIndex..<text.endIndex, options: [.byWords, .substringNotRequired]) { _, _, _, _ in
            words += 1
        }
        return (words, characters, nonSpace)
    }

    static func counts(for text: String, selection: String?) -> TextCounts {
        let all = count(text)
        var result = TextCounts(words: all.words, characters: all.characters, charactersExcludingSpaces: all.charactersExcludingSpaces)
        if let selection, !selection.isEmpty {
            let sel = count(selection)
            result.selectionWords = sel.words
            result.selectionCharacters = sel.characters
        }
        return result
    }
}
