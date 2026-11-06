// The folder card (web views/FolderCardArt.tsx): a folder, portrait (820:912). A back with a sloped tab, lighter
// at the top; up to three of the notes inside, fanned; and a front pocket in the folder's softened colour over their
// lower half, with the name in the serif and, under it, the count and last update ("2 notes · 1 min ago"). Drawn by
// WebFolderCard (Web/WebNoteCard.swift), the one drawing the Mac, iPad and iPhone screens share.
import SwiftUI

public struct FolderCardModel: Hashable, Sendable, Identifiable {
    public struct Note: Hashable, Sendable {
        public var title: String
        public var excerpt: String
        public var cover: NoteCover
        public init(title: String, excerpt: String = "", cover: NoteCover = .plain) {
            self.title = title
            self.excerpt = excerpt
            self.cover = cover
        }
    }

    public var id: String
    public var name: String
    public var colorId: String?
    public var count: Int
    /// "2 days ago" (`AgeText`).
    public var ageText: String
    /// Up to three notes inside, most recently edited first.
    public var notes: [Note]
    /// "in Projects" for nested folders shown outside their parent.
    public var parentName: String?

    public init(id: String, name: String, colorId: String? = nil, count: Int, ageText: String, notes: [Note] = [], parentName: String? = nil) {
        self.id = id
        self.name = name
        self.colorId = colorId
        self.count = count
        self.ageText = ageText
        self.notes = notes
        self.parentName = parentName
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
