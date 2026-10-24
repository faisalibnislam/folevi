// Bridge view models (FoleviEngine) to the design system's card and status models (FoleviDesign). Pure, so the
// view model tests check exactly what the screens draw.
import Foundation
import FoleviDesign
import FoleviEngine

public enum CardMapping {
    /// A note's cover: a built-in theme, a colour, or plain. Custom images need `files.urls` (plan 3.10) and
    /// draw plain until the attachment store has them.
    public static func cover(_ c: CardCover) -> NoteCover {
        switch c.kind {
        case "theme":
            if let v = c.value, NoteTheme.named(v) != nil { return .theme(v) }
            return .plain
        case "color":
            if let v = c.value {
                let parts = v.split(separator: ",").map { String($0).trimmingCharacters(in: .whitespaces) }
                if let a = parts.first.flatMap(RGBA.init(hex:)) { return .color(a, parts.count > 1 ? RGBA(hex: parts[1]) : nil) }
            }
            return .plain
        default:
            return .plain
        }
    }

    public static func fontType(_ style: CardStyle) -> NoteFontType {
        NoteFontType(rawValue: style.font) ?? .system
    }

    public static func previewLines(_ lines: [PreviewLine]?) -> [CardPreviewLine] {
        (lines ?? []).map { CardPreviewLine(type: $0.t, text: $0.x, level: $0.l, checked: $0.c, rows: $0.rows) }
    }

    /// The footer time: the last edit, or when it went to Trash.
    public static func timeText(_ row: NoteRow, inTrash: Bool, now: Date = Date()) -> String {
        if inTrash { return "Deleted \(AgeText.relative(Date(timeIntervalSince1970: row.updatedAt / 1000), now: now))" }
        return AgeText.age(Date(timeIntervalSince1970: row.updatedAt / 1000), now: now)
    }

    public static func noteCard(_ row: NoteRow, starred: Bool? = nil, inTrash: Bool = false, now: Date = Date()) -> NoteCardModel {
        NoteCardModel(
            id: row.id,
            title: row.title,
            excerpt: row.excerpt,
            preview: previewLines(row.preview),
            cover: cover(row.cover),
            fontType: fontType(row.style),
            createdText: AgeText.age(Date(timeIntervalSince1970: row.createdAt / 1000), now: now),
            timeText: timeText(row, inTrash: inTrash, now: now),
            starred: starred ?? row.starred,
            folderName: row.folder?.name,
            folderColorId: row.folder?.color,
            showsFolder: row.kind != "template"
        )
    }

    public static func folderCard(_ f: FolderCard, parentName: String? = nil, now: Date = Date()) -> FolderCardModel {
        FolderCardModel(
            id: f.id,
            name: f.name,
            colorId: f.color,
            count: f.noteCount,
            ageText: f.updatedAt > 0 ? AgeText.age(Date(timeIntervalSince1970: f.updatedAt / 1000), now: now) : "",
            notes: f.previews.prefix(3).map { FolderCardModel.Note(title: $0.title, excerpt: $0.excerpt, cover: cover($0.cover)) },
            parentName: parentName
        )
    }

    /// A folder from the tree (no previews or update time): used until `folders.cards` answers.
    public static func folderCard(_ n: FolderNode) -> FolderCardModel {
        FolderCardModel(id: n.id, name: n.name, colorId: n.color, count: n.noteCount ?? 0, ageText: "")
    }

    /// The bridge's sync state as the design system's indicator.
    public static func sync(_ s: SyncStatusValue) -> SyncIndicator {
        switch s.state {
        case .saved: return .saved
        case .saving: return .saving
        case .syncing:
            if let space = s.spaces.first(where: { $0.state == .downloading }), let total = space.total, total > 0 {
                return .syncing(progress: "Syncing \(space.have.formatted()) of \(total.formatted())")
            }
            return .syncing()
        case .offline: return .offline(waiting: s.pending)
        case .conflict: return .conflict
        case .error: return .error(s.label)
        }
    }

    /// What VoiceOver reads for a note row in a list.
    public static func rowAccessibility(_ row: NoteRow, inTrash: Bool, starred: Bool) -> String {
        var parts = [row.title.isEmpty ? "Untitled" : row.title]
        if row.kind != "template" { parts.append(row.folder.map { "in \($0.name)" } ?? "Draft") }
        parts.append(inTrash ? timeText(row, inTrash: true).lowercased() : "edited \(AgeText.relative(Date(timeIntervalSince1970: row.updatedAt / 1000)))")
        if starred { parts.append("starred") }
        if row.sync != .saved { parts.append("not synced") }
        return parts.joined(separator: ", ")
    }
}

/// "1 note", "1,204 notes" (the web's `notes(n)`).
func notesText(_ n: Int) -> String { n == 1 ? "1 note" : "\(n.formatted()) notes" }
