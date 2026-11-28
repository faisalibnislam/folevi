// The folder card (web views/FolderCardArt.tsx), "Frosted" (the owner, 20 November 2026): square; a back with a
// curved tab in the folder's muted colour; up to five notes inside drawn as today's note cards, fanned both ways;
// up to two subfolders stacked behind; and a see-through frosted front with the name, counts and last change. Drawn by
// WebFolderCard (Web/WebNoteCard.swift), the one drawing the Mac, iPad and iPhone screens share.
import SwiftUI

public struct FolderCardModel: Hashable, Sendable, Identifiable {
    /// A note peeking out of the folder, with what its own card shows: it is drawn as exactly that card
    /// (WebNoteCard, as the web's FolderCardArt draws NoteCardFace; the owner, 28 November 2026).
    public struct Note: Hashable, Sendable {
        public var title: String
        public var excerpt: String
        public var cover: NoteCover
        /// "Created 3 days ago", under the title on the page peeking out of the card; empty when unknown.
        public var createdText: String
        /// The note's first blocks, font, "Edited 2 days ago" and page shape (empty or nil when unknown).
        public var preview: [CardPreviewLine]
        public var fontType: NoteFontType
        public var timeText: String
        public var shape: String?
        public var template: Bool
        public init(title: String, excerpt: String = "", cover: NoteCover = .plain, createdText: String = "", preview: [CardPreviewLine] = [], fontType: NoteFontType = .system, timeText: String = "", shape: String? = nil, template: Bool = false) {
            self.title = title
            self.excerpt = excerpt
            self.cover = cover
            self.createdText = createdText
            self.preview = preview
            self.fontType = fontType
            self.timeText = timeText
            self.shape = shape
            self.template = template
        }

        /// The note as its own card shows it, without the folder chip (it is in this folder) or a bookmark.
        public var card: NoteCardModel {
            NoteCardModel(id: title, title: title, excerpt: excerpt, preview: preview, cover: cover, fontType: fontType, createdText: createdText, timeText: timeText, showsFolder: false, shape: shape, template: template)
        }
    }

    public var id: String
    public var name: String
    public var colorId: String?
    public var count: Int
    /// "2 days ago" (`AgeText`).
    public var ageText: String
    /// Up to five notes inside, most recently edited first.
    public var notes: [Note]
    /// "in Projects" for nested folders shown outside their parent.
    public var parentName: String?
    /// Folders directly inside, and the colours of the two most recently changed (drawn stacked behind the card).
    public var subfolders: Int
    public var subfolderColorIds: [String?]
    /// "Edited 2 days ago" on the front; empty when unknown.
    public var editedText: String

    public init(id: String, name: String, colorId: String? = nil, count: Int, ageText: String, notes: [Note] = [], parentName: String? = nil, subfolders: Int = 0, subfolderColorIds: [String?] = [], editedText: String? = nil) {
        self.id = id
        self.name = name
        self.colorId = colorId
        self.count = count
        self.ageText = ageText
        self.notes = notes
        self.parentName = parentName
        self.subfolders = subfolders
        self.subfolderColorIds = subfolderColorIds
        self.editedText = editedText ?? (ageText.isEmpty ? "" : "Edited \(ageText.hasPrefix("Just") ? "just now" : ageText)")
    }

    /// "3 notes", "1 folder · 2 notes", "3 folders", or "No notes yet" (FolderCardArt's folderCountText).
    public var countText: String {
        var parts: [String] = []
        if subfolders > 0 { parts.append("\(subfolders.formatted()) \(subfolders == 1 ? "folder" : "folders")") }
        if count > 0 { parts.append("\(count.formatted()) \(count == 1 ? "note" : "notes")") }
        return parts.isEmpty ? "No notes yet" : parts.joined(separator: " · ")
    }

    public var accessibilityText: String {
        "\(name)\(parentName.map { ", in \($0)" } ?? ""), \(count == 1 ? "1 note" : "\(count.formatted()) notes"), updated \(ageText)"
    }
}

public struct FolderCardView: View {
    public static let aspectRatio: CGFloat = WebFolderCard.aspect
    let model: FolderCardModel

    public init(_ model: FolderCardModel) { self.model = model }

    public var body: some View {
        WebFolderCard(model)
            .accessibilityRemoveTraits(.isLink)
            .accessibilityAddTraits(.isButton)
    }
}
