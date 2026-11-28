import Foundation
import SwiftData

/// One colored dot = one note. CloudKit rules apply: every property is optional or defaulted,
/// relationships are optional with inverses, and there are no unique constraints (dots are merged
/// by `id` in `NoteStore.normalize()` instead).
@Model
final class Dot {
    var id: UUID = UUID()
    var order: Int = 0
    var name: String?
    /// A `DotColorID` raw value. Ignored when `customColorHex` is set.
    var colorID: String?
    var customColorHex: String?
    var isRichText: Bool = true
    var createdAt: Date = Date()
    var updatedAt: Date = Date()

    @Relationship(deleteRule: .cascade, inverse: \Note.dot)
    var note: Note?

    init(order: Int, colorID: DotColorID, isRichText: Bool) {
        self.id = UUID()
        self.order = order
        self.colorID = colorID.rawValue
        self.isRichText = isRichText
        self.createdAt = .now
        self.updatedAt = .now
    }
}

@Model
final class Note {
    var dot: Dot?
    /// Canonical RTF (see `RichTextCodec`). For plain-text dots this holds the Markdown source as
    /// plain RTF so the field is always populated; `plainText` is the source of truth there.
    var rtfData: Data?
    /// Markdown rendering of the note. Derived for rich dots; the source for plain dots. Used by
    /// widgets, intents, backups and exports.
    var plainText: String = ""
    var updatedAt: Date = Date()
    /// Identifies the Mac that wrote the last change (conflict policy + sync diagnostics).
    var deviceID: String = ""

    @Relationship(deleteRule: .cascade, inverse: \Attachment.note)
    var attachments: [Attachment]? = []

    init() {}
}

@Model
final class Attachment {
    var id: UUID = UUID()
    var note: Note?
    var filename: String = ""
    var utType: String = "public.png"
    var byteCount: Int = 0
    var createdAt: Date = Date()
    @Attribute(.externalStorage)
    var cloudAssetData: Data?

    init(id: UUID, filename: String, utType: String, data: Data) {
        self.id = id
        self.filename = filename
        self.utType = utType
        self.byteCount = data.count
        self.cloudAssetData = data
        self.createdAt = .now
    }
}
