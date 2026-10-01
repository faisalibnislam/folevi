import Foundation

/// An audio recording block (`audio`, written by "/record" on the web and here). The Swift block types
/// leave it out (packages/editor-schema keeps web-only blocks out of BlockSchema.swift), so it travels as
/// `.unknown(type: "audio", props:)` and these helpers read and write its props.
struct AudioProps: Hashable {
    var fileId: String
    var name: String
    var size: Double
    var mimeType: String
    /// Seconds.
    var duration: Double

    static let type = "audio"
    /// The web caps a recording at one hour (AudioRecorder.tsx `MAX_RECORDING_MS`).
    static let maxSeconds: Double = 3600

    init(fileId: String, name: String, size: Double, mimeType: String, duration: Double) {
        self.fileId = fileId
        self.name = name
        self.size = size
        self.mimeType = mimeType
        self.duration = duration
    }

    init?(_ props: JSONValue) {
        guard let o = props.objectValue else { return nil }
        fileId = o["fileId"]?.stringValue ?? ""
        name = o["name"]?.stringValue ?? String(localized: "Audio recording")
        size = o["size"]?.doubleValue ?? 0
        mimeType = o["mimeType"]?.stringValue ?? "audio/mp4"
        duration = o["duration"]?.doubleValue ?? 0
    }

    var json: JSONValue {
        .object(["fileId": .string(fileId), "name": .string(name), "size": .number(size), "mimeType": .string(mimeType),
                 "duration": .number((duration * 10).rounded() / 10)])
    }

    /// "Recording 2026-10-01 14.03.m4a": sorts by date in Finder and in a ZIP export, as on the web.
    static func fileName(at date: Date = Date()) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd HH.mm"
        return "Recording \(f.string(from: date)).m4a"
    }

    /// "4:05", or "1:02:09" past an hour.
    static func format(_ seconds: Double) -> String {
        let s = max(0, Int(seconds.rounded(.down)))
        let h = s / 3600, m = (s % 3600) / 60, r = s % 60
        return h > 0 ? String(format: "%d:%02d:%02d", h, m, r) : String(format: "%d:%02d", m, r)
    }
}
