// The component gallery (Debug builds only): every FoleviDesign component, in light and dark, for eyeballing,
// SwiftUI previews and the snapshot tests. Hosts show it from a debug menu: `DesignGallery()`.
#if DEBUG
import SwiftUI

public struct DesignGallery: View {
    public init() {}
    public var body: some View {
        ScrollView {
            HStack(alignment: .top, spacing: 0) {
                DesignGalleryContent().environment(\.colorScheme, .light).background(Folevi.color.canvas).environment(\.colorScheme, .light)
                DesignGalleryContent().environment(\.colorScheme, .dark).background(Folevi.color.canvas).environment(\.colorScheme, .dark)
            }
        }
        .environment(\.coverArt, .none)
    }
}

/// One column of every component (in whatever colour scheme the environment has).
public struct DesignGalleryContent: View {
    @State private var segment = "cards"
    @State private var search = ""
    @State private var done = true
    @State private var notDone = false

    public init() {}

    public var body: some View {
        VStack(alignment: .leading, spacing: 22) {
            GallerySection("Type") {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(FoleviTextStyle.allCases, id: \.self) { style in
                        Text(style == .mono ? "let note = \"Kyoto\"" : "\(style.rawValue): Notes carry the colour")
                            .foleviFont(style)
                            .foregroundStyle(Folevi.color.ink)
                    }
                }
            }
            GallerySection("Colour") {
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 6), count: 6), spacing: 6) {
                    ForEach(GallerySwatch.all, id: \.name) { s in
                        VStack(spacing: 3) {
                            RoundedRectangle(cornerRadius: FoleviTokens.Radius.chip, style: .continuous).fill(s.color).frame(height: 30)
                                .overlay(RoundedRectangle(cornerRadius: FoleviTokens.Radius.chip, style: .continuous).strokeBorder(Folevi.color.line, lineWidth: 0.5))
                            Text(s.name).font(FoleviFonts.font(.ui, size: 9)).foregroundStyle(Folevi.color.inkMuted).lineLimit(1)
                        }
                    }
                }
            }
            GallerySection("Buttons") {
                VStack(alignment: .leading, spacing: 10) {
                    HStack(spacing: 8) {
                        Button("New note") {}.buttonStyle(.foleviPrimary)
                        Button("Share") {}.buttonStyle(.foleviSecondary)
                        Button("Cancel") {}.buttonStyle(.foleviGhost)
                    }
                    HStack(spacing: 8) {
                        Button("Delete") {}.buttonStyle(.foleviDestructive)
                        Button("Small") {}.buttonStyle(.folevi(.secondary, size: .small))
                        Button("Disabled") {}.buttonStyle(.foleviPrimary).disabled(true)
                    }
                    Button("Continue") {}.buttonStyle(.folevi(.primary, size: .large, fullWidth: true))
                }
            }
            GallerySection("Icon buttons and pills") {
                HStack(spacing: 14) {
                    IconButton("magnifyingglass", label: "Search") {}
                    IconButton("square.and.arrow.up", label: "Share") {}
                    GlassPill {
                        IconButton("bell", label: "Notifications", badge: 3) {}
                        IconButton("ellipsis", label: "More") {}
                    }
                    SyncStatusView(.saved)
                }
            }
            GallerySection("Chips and badges") {
                VStack(alignment: .leading, spacing: 10) {
                    HStack(spacing: 6) {
                        Chip("Inbox", count: 4, isSelected: true) {}
                        Chip("Today", count: 2) {}
                        Chip("Upcoming") {}
                        Chip("Travel", systemImage: "tag") {}
                    }
                    HStack(spacing: 10) {
                        Badge(count: 3)
                        Badge(count: 128)
                        Badge(count: 12, tone: .neutral)
                        SignalDot()
                        Avatar(name: "Faisal Islam")
                        Avatar(name: "Airly Studio", size: 22)
                        Checkbox(isOn: $done, label: "Book the ryokan")
                        Checkbox(isOn: $notDone, label: "Rail pass")
                    }
                }
            }
            GallerySection("Segmented control") {
                SegmentedControl(selection: $segment, options: [("cards", "Cards"), ("list", "List"), ("compact", "Compact")])
            }
            GallerySection("Search field") {
                VStack(spacing: 8) {
                    SearchField(text: $search, prompt: "Search notes")
                    SearchField(text: .constant("kyoto"), prompt: "Search notes")
                }
            }
            GallerySection("Rows") {
                RowGroup {
                    ListRow("All notes", systemImage: "doc.on.doc", accessory: .count(128))
                    RowDivider()
                    ListRow("Drafts", systemImage: "pencil.line", accessory: .count(7))
                    RowDivider()
                    ListRow("Changes", subtitle: "3 notes changed by others", systemImage: "arrow.triangle.2.circlepath", accessory: .badge(3))
                    RowDivider()
                    ListRow("Appearance", systemImage: "circle.lefthalf.filled", accessory: .text("Match system"))
                    RowDivider()
                    ListRow("Trips", accessory: .chevron) { FolderGlyph(colorId: "teal", size: 18) }
                }
            }
            GallerySection("Section headers") {
                VStack(spacing: 6) {
                    SectionHeader("Recent notes", actionTitle: "See all") {}
                    SectionHeader("Folders", style: .caps)
                }
            }
            GallerySection("Note cards") {
                LazyVGrid(columns: [GridItem(.flexible(), spacing: 14), GridItem(.flexible(), spacing: 14)], spacing: 16) {
                    ForEach(GallerySamples.notes) { NoteCardView($0) }
                }
            }
            GallerySection("Folder cards") {
                LazyVGrid(columns: [GridItem(.flexible(), spacing: 14), GridItem(.flexible(), spacing: 14)], spacing: 16) {
                    ForEach(GallerySamples.folders) { FolderCardView($0) }
                }
            }
            GallerySection("Sync status") {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(GallerySamples.syncStates, id: \.self) { SyncStatusView($0, showsLabel: true) }
                }
            }
            GallerySection("Empty state") {
                EmptyState(systemImage: "tray", title: "Nothing in Drafts", message: "New notes land here until you file them in a folder.", actionTitle: "New note") {}
            }
        }
        .padding(16)
        .frame(width: 420)
    }
}

struct GallerySection<Content: View>: View {
    let title: String
    let content: Content
    init(_ title: String, @ViewBuilder content: () -> Content) {
        self.title = title
        self.content = content()
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeader(title, style: .caps)
            content
        }
    }
}

struct GallerySwatch {
    let name: String
    let color: Color
    static let all: [GallerySwatch] = [
        .init(name: "canvas", color: Folevi.color.canvas), .init(name: "surface", color: Folevi.color.surface),
        .init(name: "raised", color: Folevi.color.surfaceRaised), .init(name: "sunken", color: Folevi.color.surfaceSunken),
        .init(name: "ink", color: Folevi.color.ink), .init(name: "heading", color: Folevi.color.heading),
        .init(name: "muted", color: Folevi.color.inkMuted), .init(name: "faint", color: Folevi.color.inkFaint),
        .init(name: "line", color: Folevi.color.line), .init(name: "accent", color: Folevi.color.accent),
        .init(name: "accentSoft", color: Folevi.color.accentSoft), .init(name: "ember", color: Folevi.color.ember),
        .init(name: "moss", color: Folevi.color.moss), .init(name: "coral", color: Folevi.color.coral),
        .init(name: "marigold", color: Folevi.color.marigold), .init(name: "destructive", color: Folevi.color.destructive),
        .init(name: "focus", color: Folevi.color.focus), .init(name: "selection", color: Folevi.color.selection),
    ]
}

/// Sample data for the gallery, previews and snapshot tests.
public enum GallerySamples {
    public static let notes: [NoteCardModel] = [
        NoteCardModel(
            id: "n1", title: "Kyoto in November",
            preview: [
                CardPreviewLine(type: "heading", text: "Plan", level: 2),
                CardPreviewLine(type: "todo", text: "Book the ryokan", checked: true),
                CardPreviewLine(type: "todo", text: "Rail pass", checked: false),
                CardPreviewLine(type: "paragraph", text: "Arashiyama early, before the crowds. Tofuku-ji for the maples."),
            ],
            cover: .theme("art-01"), createdText: "10 hours ago", timeText: "1 hour ago", starred: true, folderName: "Trips", folderColorId: "teal"
        ),
        NoteCardModel(
            id: "n2", title: "Weekly review",
            preview: [
                CardPreviewLine(type: "bulleted", text: "Ship the folder cards"),
                CardPreviewLine(type: "bulleted", text: "Native Home"),
                CardPreviewLine(type: "paragraph", text: "Notes carry the colour; the chrome stays neutral."),
            ],
            createdText: "Sep 10", timeText: "Yesterday"
        ),
        NoteCardModel(
            id: "n3", title: "An extraordinarily long note title that has to wrap between words",
            excerpt: "The title wraps at most twice and ends in an ellipsis instead of splitting a word.",
            cover: .theme("art-07"), fontType: .serif, createdText: "3 days ago", timeText: "2 days ago", folderName: "Writing", folderColorId: "violet"
        ),
        NoteCardModel(id: "n4", title: "", cover: .color(RGBA(120, 157, 223)), fontType: .mono, createdText: "Just now", timeText: "Just now"),
    ]

    public static let folders: [FolderCardModel] = [
        FolderCardModel(id: "f1", name: "Trips", colorId: "teal", count: 12, ageText: "2 hours ago", notes: [
            .init(title: "Kyoto in November", excerpt: "Arashiyama early, before the crowds.", cover: .theme("art-01")),
            .init(title: "Lisbon", excerpt: "Tram 28, the miradouros.", cover: .theme("art-12")),
            .init(title: "Packing list", excerpt: "Adapter, rain jacket."),
        ]),
        FolderCardModel(id: "f2", name: "Extraordinarily long folder names wrap", colorId: "amber", count: 1, ageText: "Sep 2"),
        FolderCardModel(id: "f3", name: "Supercalifragilisticexpialidocious", colorId: "rose", count: 1_204, ageText: "Just now", notes: [
            .init(title: "One note", excerpt: "Peeking out.", cover: .theme("art-20")),
        ]),
        FolderCardModel(id: "f4", name: "Work", colorId: nil, count: 0, ageText: "5 mins ago"),
    ]

    public static let syncStates: [SyncIndicator] = [.saved, .saving, .syncing(progress: "Downloading notes, 412 of 1,530"), .offline(waiting: 3), .conflict, .error()]
}

#Preview("Gallery") {
    DesignGallery()
}
#endif
