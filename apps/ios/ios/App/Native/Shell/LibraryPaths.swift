// Library paths and note file names, as packages/local-store/src/layout.ts defines them (the same rules as
// the Electron Mac app's library/paths.ts; FoleviTests checks both against local-store's fs-contract fixture).
import Foundation

enum LibraryPaths {
    static let libraryFile = "folevi-library.json"
    static let notesDir = "notes"
    static let filesDir = "files"
    static let historyDir = "history"
    static let tmpDir = ".folevi-tmp"
    static let noteExt = ".fnote"

    /// Relative, forward slashes, no `..`, `.` or empty parts, no backslash or control characters.
    static func isValid(_ path: String) -> Bool {
        guard !path.isEmpty, path.utf16.count <= 1024, !path.hasPrefix("/"), !path.hasSuffix("/"), !path.contains("\\") else { return false }
        if path.unicodeScalars.contains(where: { $0.value < 0x20 || $0.value == 0x7f }) { return false }
        return path.split(separator: "/", omittingEmptySubsequences: false).allSatisfy { !$0.isEmpty && $0 != "." && $0 != ".." }
    }

    static func check(_ path: Any?) throws -> String {
        guard let p = path as? String, isValid(p) else { throw LibraryError(.invalidPath, "Invalid library path.") }
        return p
    }

    /// A directory argument: "" (the whole library) or a valid path.
    static func checkDir(_ dir: Any?) throws -> String {
        if let d = dir as? String, d.isEmpty { return "" }
        return try check(dir)
    }

    static func isValidId(_ v: String) -> Bool { v.range(of: #"^[A-Za-z0-9_-]{1,64}$"#, options: .regularExpression) != nil }

    struct NoteName: Equatable {
        enum Provider: String { case dropbox, icloud, numbered, onedrive }
        let id: String
        let copy: (provider: Provider, label: String)?
        let placeholder: Bool
        static func == (a: NoteName, b: NoteName) -> Bool { a.id == b.id && a.copy?.provider == b.copy?.provider && a.copy?.label == b.copy?.label && a.placeholder == b.placeholder }
    }

    private static let strictShapes = [#"[0-9A-Z]{26}"#, #"[0-9a-z]{26}"#, #"daily-\d{4}-\d{2}-\d{2}-[0-9a-f]{16}"#, #"inbox-[0-9a-f]{16}"#].map { try! NSRegularExpression(pattern: "^(\($0))(?:-(.+))?$") }

    private static func matches(_ s: String, _ pattern: String) -> Bool { s.range(of: pattern, options: .regularExpression) != nil }

    /// local-store's `parseNoteFileName`: a note file's id, a provider's copy of one, or an iCloud placeholder.
    static func parseNoteFileName(_ fileName: String) -> NoteName? {
        var name = fileName
        var placeholder = false
        if let real = fromPlaceholder(name) {
            name = real
            placeholder = true
        }
        guard name.hasSuffix(noteExt) else { return nil }
        let stem = String(name.dropLast(noteExt.count))
        if let cut = stem.firstIndex(where: { $0 == " " || $0 == "(" }) {
            guard cut != stem.startIndex else { return nil }
            let id = String(stem[..<cut])
            let rest = String(stem[cut...])
            guard isValidId(id) else { return nil }
            var provider: NoteName.Provider?
            if rest.range(of: #"^ \(.*conflict.*\)$"#, options: [.regularExpression, .caseInsensitive]) != nil { provider = .dropbox }
            else if matches(rest, #"^ ?\(\d+\)$"#) { provider = .numbered }
            else if matches(rest, #"^ \d+$"#) { provider = .icloud }
            guard let provider else { return nil }
            return NoteName(id: id, copy: (provider, rest.trimmingCharacters(in: .whitespaces)), placeholder: placeholder)
        }
        let ns = stem as NSString
        for shape in strictShapes {
            guard let m = shape.firstMatch(in: stem, range: NSRange(location: 0, length: ns.length)) else { continue }
            let id = ns.substring(with: m.range(at: 1))
            if m.range(at: 2).location == NSNotFound { return NoteName(id: id, copy: nil, placeholder: placeholder) }
            let label = ns.substring(with: m.range(at: 2))
            if isValidId(label) { return NoteName(id: id, copy: (.onedrive, label), placeholder: placeholder) }
        }
        if isValidId(stem) { return NoteName(id: stem, copy: nil, placeholder: placeholder) }
        return nil
    }

    /// `.<name>.icloud`: the placeholder iCloud leaves for a file whose contents aren't on this device yet.
    static func placeholderName(_ fileName: String) -> String { ".\(fileName).icloud" }

    static func fromPlaceholder(_ fileName: String) -> String? {
        guard fileName.hasPrefix("."), fileName.hasSuffix(".icloud"), fileName.count > ".x.icloud".count - 1 else { return nil }
        let inner = String(fileName.dropFirst().dropLast(".icloud".count))
        return inner.isEmpty ? nil : inner
    }
}

/// Errors with a code the page can act on (local-store's LocalFsErrorCode plus the host's own), sent to the
/// page as `{ code, message, path }`.
struct LibraryError: Error {
    enum Code: String {
        case notFound = "not_found", unreadable, mismatch, invalidPath = "invalid_path", io
        case notSetUp = "not_set_up", locked, unavailable, busy, invalidArgument = "invalid_argument"
        case notDownloaded = "not_downloaded", targetHasLibrary = "target_has_library", wrongPassphrase = "wrong_passphrase"
        case cancelled
    }

    let code: Code
    let message: String
    var path: String?

    init(_ code: Code, _ message: String, path: String? = nil) {
        self.code = code
        self.message = message
        self.path = path
    }
}
