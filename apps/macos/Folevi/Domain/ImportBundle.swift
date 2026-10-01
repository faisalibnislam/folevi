import Compression
import Foundation

/// Markdown import bundles (the web's components/doc/importBundle.ts): loose files, a folder, or a ZIP.
/// Markdown files are imported as documents; the images they reference by relative path
/// (`![](assets/photo.png)`) are uploaded first and passed to the server as an image map, so they arrive as
/// real image blocks instead of dead links.
enum ImportBundle {
    struct Entry: Sendable, Hashable {
        /// Path inside the bundle, "/"-separated, no leading "./" (just the file name for loose files).
        var path: String
        var data: Data
    }

    static let maxDocs = 50
    static let maxZipBytes = 300 * 1024 * 1024

    private static let imageTypes = ["png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "gif": "image/gif", "webp": "image/webp"]

    /// `TEXT_EXT`: .md, .markdown, .txt, .text.
    static func isText(_ path: String) -> Bool {
        ["md", "markdown", "txt", "text"].contains((path as NSString).pathExtension.lowercased())
    }

    /// Plain text rather than Markdown (`/\.(txt|text)$/i`).
    static func isPlainText(_ path: String) -> Bool {
        ["txt", "text"].contains((path as NSString).pathExtension.lowercased())
    }

    static func imageMime(_ path: String) -> String? {
        imageTypes[(path as NSString).pathExtension.lowercased()]
    }

    /// Collapses "." and ".." segments; nil when the path escapes the bundle root.
    static func normalizePath(_ path: String) -> String? {
        var out: [Substring] = []
        for part in path.replacingOccurrences(of: "\\", with: "/").split(separator: "/", omittingEmptySubsequences: true) {
            if part == "." { continue }
            if part == ".." {
                if out.isEmpty { return nil }
                out.removeLast()
            } else {
                out.append(part)
            }
        }
        return out.joined(separator: "/")
    }

    static func dirname(_ path: String) -> String {
        guard let i = path.lastIndex(of: "/") else { return "" }
        return String(path[..<i])
    }

    /// Every image source written in a Markdown text, exactly as written (the server looks them up verbatim).
    static func imageSources(_ markdown: String) -> [String] {
        guard let re = try? NSRegularExpression(pattern: #"!\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)"#) else { return [] }
        var seen = Set<String>()
        var out: [String] = []
        let ns = markdown as NSString
        for m in re.matches(in: markdown, range: NSRange(location: 0, length: ns.length)) {
            let src = ns.substring(with: m.range(at: 1))
            if seen.insert(src).inserted { out.append(src) }
        }
        return out
    }

    /// Path → entry, also by lower-cased path (the web's `entryMap`).
    static func entryMap(_ entries: [Entry]) -> [String: Entry] {
        var map: [String: Entry] = [:]
        for e in entries {
            map[e.path] = e
            if map[e.path.lowercased()] == nil { map[e.path.lowercased()] = e }
        }
        return map
    }

    /// The entry an image source in `fromPath` points to: relative to the Markdown file first, then from the
    /// bundle root, then (if unambiguous) by file name alone.
    static func resolveImage(_ map: [String: Entry], all entries: [Entry], from fromPath: String, src: String) -> Entry? {
        if src.range(of: #"^[a-z][a-z0-9+.-]*:"#, options: [.regularExpression, .caseInsensitive]) != nil || src.hasPrefix("//") || src.hasPrefix("#") { return nil }
        let decoded = src.removingPercentEncoding ?? src
        for candidate in [normalizePath("\(dirname(fromPath))/\(decoded)"), normalizePath(decoded)] {
            guard let c = candidate else { continue }
            if let hit = map[c] ?? map[c.lowercased()] { return hit }
        }
        let base = (decoded.split(separator: "/").last.map(String.init) ?? "").lowercased()
        guard !base.isEmpty else { return nil }
        let byName = entries.filter { ($0.path.split(separator: "/").last.map(String.init) ?? "").lowercased() == base }
        return byName.count == 1 ? byName[0] : nil
    }

    /// Loose files, a picked folder (paths start with the folder's name, like `webkitRelativePath`) or ZIPs
    /// (expanded under their name) → entries, with an error for each ZIP that can't be used.
    static func entries(files: [URL], folder: URL? = nil) -> (entries: [Entry], errors: [(name: String, message: String)]) {
        var entries: [Entry] = []
        var errors: [(String, String)] = []
        for url in files {
            let name = url.lastPathComponent
            if url.pathExtension.lowercased() == "zip" {
                let size = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
                if size > maxZipBytes {
                    errors.append((name, String(localized: "ZIP files can be up to 300 MB.")))
                    continue
                }
                guard let data = try? Data(contentsOf: url), let files = try? ZipReader.extract(data) else {
                    errors.append((name, String(localized: "This ZIP file couldn’t be opened.")))
                    continue
                }
                let prefix = (name as NSString).deletingPathExtension
                for f in files { entries.append(Entry(path: "\(prefix)/\(normalizePath(f.path) ?? f.path)", data: f.data)) }
                continue
            }
            guard let data = try? Data(contentsOf: url) else { continue }
            var rel = name
            if let folder {
                let root = folder.standardizedFileURL.path
                let full = url.standardizedFileURL.path
                if full.hasPrefix(root + "/") { rel = folder.lastPathComponent + "/" + String(full.dropFirst(root.count + 1)) }
            }
            entries.append(Entry(path: normalizePath(rel) ?? name, data: data))
        }
        return (entries, errors)
    }
}

/// A small ZIP reader (stored and deflated entries, the central directory), enough for import bundles.
/// Folders and macOS metadata (`__MACOSX/`, `.DS_Store`) are skipped, like the web's `entriesFromZip`.
enum ZipReader {
    enum ZipError: Error { case notZip, corrupt, unsupported }

    struct File: Sendable { var path: String; var data: Data }

    static func extract(_ data: Data) throws -> [File] {
        let bytes = [UInt8](data)
        func u16(_ o: Int) throws -> Int {
            guard o + 2 <= bytes.count else { throw ZipError.corrupt }
            return Int(bytes[o]) | Int(bytes[o + 1]) << 8
        }
        func u32(_ o: Int) throws -> Int {
            guard o + 4 <= bytes.count else { throw ZipError.corrupt }
            return Int(bytes[o]) | Int(bytes[o + 1]) << 8 | Int(bytes[o + 2]) << 16 | Int(bytes[o + 3]) << 24
        }
        // End of central directory: the last "PK\u{5}\u{6}" within the final 64 KB + 22 bytes.
        guard bytes.count >= 22 else { throw ZipError.notZip }
        var eocd = -1
        var i = bytes.count - 22
        let floor = max(0, bytes.count - 22 - 65_535)
        while i >= floor {
            if bytes[i] == 0x50, bytes[i + 1] == 0x4B, bytes[i + 2] == 0x05, bytes[i + 3] == 0x06 { eocd = i; break }
            i -= 1
        }
        guard eocd >= 0 else { throw ZipError.notZip }
        let count = try u16(eocd + 10)
        var p = try u32(eocd + 16)
        var out: [File] = []
        for _ in 0..<count {
            guard try u32(p) == 0x0201_4B50 else { throw ZipError.corrupt }
            let method = try u16(p + 10)
            let compressed = try u32(p + 20)
            let size = try u32(p + 24)
            let nameLen = try u16(p + 28)
            let extraLen = try u16(p + 30)
            let commentLen = try u16(p + 32)
            let local = try u32(p + 42)
            guard p + 46 + nameLen <= bytes.count else { throw ZipError.corrupt }
            let name = String(decoding: bytes[(p + 46)..<(p + 46 + nameLen)], as: UTF8.self)
            p += 46 + nameLen + extraLen + commentLen
            if name.hasSuffix("/") || name.hasPrefix("__MACOSX/") || name == ".DS_Store" || name.hasSuffix("/.DS_Store") { continue }
            guard try u32(local) == 0x0403_4B50 else { throw ZipError.corrupt }
            let start = local + 30 + (try u16(local + 26)) + (try u16(local + 28))
            guard start + compressed <= bytes.count else { throw ZipError.corrupt }
            let raw = Data(bytes[start..<(start + compressed)])
            switch method {
            case 0: out.append(File(path: name, data: raw))
            case 8: out.append(File(path: name, data: try inflate(raw, size: size)))
            default: throw ZipError.unsupported
            }
        }
        return out
    }

    /// Raw DEFLATE (RFC 1951), which Apple's Compression calls ZLIB.
    private static func inflate(_ data: Data, size: Int) throws -> Data {
        if size == 0 { return Data() }
        guard !data.isEmpty else { throw ZipError.corrupt }
        var out = Data(count: size)
        let written = out.withUnsafeMutableBytes { dst in
            data.withUnsafeBytes { src in
                compression_decode_buffer(dst.bindMemory(to: UInt8.self).baseAddress!, size,
                                          src.bindMemory(to: UInt8.self).baseAddress!, data.count, nil, COMPRESSION_ZLIB)
            }
        }
        guard written == size else { throw ZipError.corrupt }
        return out
    }
}
