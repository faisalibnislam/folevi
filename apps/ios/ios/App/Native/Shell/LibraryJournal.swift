// The native journal (docs/LOCAL_MODE_PLAN.md §3.6, `shell.library.journal`): every local edit is appended here,
// fsync'd, before the page calls it saved, so an edit survives the app being stopped before the note file is
// written. It lives in Application Support, never in the library (a sync provider must not see it).
//
// The file is the Mac's format (the Electron Mac app's library/journal.ts): "FLVJ" 0x01, then frames of u32 BE length ‖
// u32 BE CRC-32 ‖ the record. A torn last frame (the app stopped mid-append) fails its length or CRC: reading
// stops there, and the next append first cuts the file back to the last whole frame.
import Foundation

final class LibraryJournal {
    static let magic: [UInt8] = [0x46, 0x4c, 0x56, 0x4a, 0x01]
    static let maxRecord = 16 * 1024 * 1024
    let url: URL
    private var end = -1

    init(url: URL) {
        self.url = url
    }

    private static let table: [UInt32] = (0..<256).map { n -> UInt32 in
        var c = UInt32(n)
        for _ in 0..<8 { c = (c & 1) != 0 ? 0xedb8_8320 ^ (c >> 1) : c >> 1 }
        return c
    }

    static func crc32(_ bytes: Data) -> UInt32 {
        var c: UInt32 = 0xffff_ffff
        for b in bytes { c = table[Int((c ^ UInt32(b)) & 0xff)] ^ (c >> 8) }
        return c ^ 0xffff_ffff
    }

    static func frame(_ record: Data) -> Data {
        var out = Data(capacity: record.count + 8)
        var len = UInt32(record.count).bigEndian
        var crc = crc32(record).bigEndian
        out.append(Data(bytes: &len, count: 4))
        out.append(Data(bytes: &crc, count: 4))
        out.append(record)
        return out
    }

    /// The whole frames in a journal file's bytes, and where the last one ends.
    static func parse(_ data: Data) -> (records: [Data], validLength: Int, torn: Bool) {
        let b = [UInt8](data)
        if b.isEmpty { return ([], 0, false) }
        guard b.count >= magic.count, Array(b[0..<magic.count]) == magic else { return ([], 0, true) }
        var records: [Data] = []
        var off = magic.count
        func u32(_ at: Int) -> Int { Int(UInt32(b[at]) << 24 | UInt32(b[at + 1]) << 16 | UInt32(b[at + 2]) << 8 | UInt32(b[at + 3])) }
        while off < b.count {
            if b.count - off < 8 { break }
            let len = u32(off)
            let crc = UInt32(u32(off + 4))
            if len > maxRecord || off + 8 + len > b.count { break }
            let rec = Data(b[(off + 8)..<(off + 8 + len)])
            if crc32(rec) != crc { break }
            records.append(rec)
            off += 8 + len
        }
        return (records, off, off < b.count)
    }

    private func readAll() -> Data { (try? Data(contentsOf: url)) ?? Data() }

    private func fullSync(_ fd: Int32) {
        if fcntl(fd, F_FULLFSYNC) != 0 { _ = fsync(fd) }
    }

    /// Opens the file for appends: a new one gets its header, a torn tail is cut off first.
    private func prepare() throws {
        if end >= 0 { return }
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        let parsed = Self.parse(readAll())
        if parsed.validLength == 0 {
            try Data(Self.magic).write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            FolderFS.fsync(url.path)
            FolderFS.fsync(url.deletingLastPathComponent().path)
            end = Self.magic.count
        } else {
            if parsed.torn {
                let fd = open(url.path, O_WRONLY)
                guard fd >= 0 else { throw LibraryError(.io, "The journal can't be opened.") }
                ftruncate(fd, off_t(parsed.validLength))
                fullSync(fd)
                close(fd)
            }
            end = parsed.validLength
        }
    }

    /// Appends one record and returns once it is on disk (F_FULLFSYNC).
    func append(_ record: Data) throws {
        guard record.count <= Self.maxRecord else { throw LibraryError(.invalidArgument, "A journal record is bytes, at most 16 MB.") }
        try prepare()
        let f = Self.frame(record)
        let fd = open(url.path, O_WRONLY)
        guard fd >= 0 else { throw LibraryError(.io, "The journal can't be opened.") }
        defer { close(fd) }
        var written = 0
        try f.withUnsafeBytes { raw in
            while written < f.count {
                let n = pwrite(fd, raw.baseAddress! + written, f.count - written, off_t(end + written))
                if n <= 0 { throw LibraryError(.io, "The journal couldn't be written.") }
                written += n
            }
        }
        fullSync(fd)
        end += f.count
    }

    /// Every whole record, oldest first (a torn last append is left out).
    func records() -> [Data] { Self.parse(readAll()).records }

    /// Drops the first `n` records (the library files hold them now): the rest are rewritten atomically.
    func truncate(_ n: Int) throws {
        guard n >= 0 else { throw LibraryError(.invalidArgument, "truncate takes a whole number.") }
        if n == 0 { return }
        let keep = Array(records().dropFirst(n))
        var body = Data(Self.magic)
        for r in keep { body.append(Self.frame(r)) }
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try body.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        FolderFS.fsync(url.path)
        FolderFS.fsync(url.deletingLastPathComponent().path)
        end = -1
    }

    func destroy() {
        try? FileManager.default.removeItem(at: url)
        end = -1
    }
}
