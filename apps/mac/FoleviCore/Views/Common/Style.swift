// Folevi Core's type and small shared pieces. The rule (the owner's, 21 November 2026): Folevi's own faces for
// what belongs to the notes (note titles, cards, the page: Spectral and Instrument Sans), SF Pro for everything
// around them (sidebar, toolbar, menus, Settings). Colours are the system's semantic ones; notes carry colour.
import FoleviDesign
import FoleviEngine
import AppKit
import SwiftUI

enum CoreType {
    /// A note's title in a list row or a card (Spectral).
    static func noteTitle(_ size: CGFloat = 15, weight: Font.Weight = .semibold) -> Font {
        FoleviFonts.font(.display, size: size, weight: weight, relativeTo: .body)
    }

    /// A note's excerpt (Instrument Sans).
    static func noteText(_ size: CGFloat = 13) -> Font {
        FoleviFonts.font(.ui, size: size, weight: .regular, relativeTo: .body)
    }

    /// A screen's large title over its content (Spectral, as a note page's title).
    static func screenTitle(_ size: CGFloat = 28) -> Font {
        FoleviFonts.font(.display, size: size, weight: .semibold, relativeTo: .largeTitle)
    }
}

/// Dates as the Mac says them in lists ("Today 9:41", "Yesterday", "12 Nov").
enum CoreDates {
    /// A day as the engine writes it ("2026-11-21"), in this Mac's time zone (not UTC).
    static let dayFormat = Date.ISO8601FormatStyle(timeZone: .current).year().month().day()

    static func short(_ ms: Double) -> String {
        guard ms > 0 else { return "" }
        let d = Date(timeIntervalSince1970: ms / 1000)
        let cal = Calendar.current
        if cal.isDateInToday(d) { return d.formatted(date: .omitted, time: .shortened) }
        if cal.isDateInYesterday(d) { return "Yesterday" }
        if let days = cal.dateComponents([.day], from: d, to: Date()).day, days < 7 { return d.formatted(.dateTime.weekday(.wide)) }
        return d.formatted(.dateTime.day().month(.abbreviated).year(cal.isDate(d, equalTo: Date(), toGranularity: .year) ? .omitted : .defaultDigits))
    }

    static func relative(_ ms: Double) -> String {
        guard ms > 0 else { return "" }
        return Date(timeIntervalSince1970: ms / 1000).formatted(.relative(presentation: .named))
    }
}

/// The engine's rows as FoleviDesign's card models.
enum Cards {
    static func cover(_ c: CardCover, images: Bool = true) -> NoteCover {
        switch c.kind {
        case "art", "theme":
            if let v = c.value, NoteTheme.named(v) != nil { return .theme(v) }
            return .plain
        case "image":
            if images, let v = c.value, !v.isEmpty { return .file(v) }
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

    static func note(_ row: NoteRow, inTrash: Bool = false) -> NoteCardModel {
        let edited = Date(timeIntervalSince1970: row.updatedAt / 1000)
        let created = Date(timeIntervalSince1970: row.createdAt / 1000)
        return NoteCardModel(
            id: row.id,
            title: row.title,
            excerpt: row.excerpt,
            preview: (row.preview ?? []).map { CardPreviewLine(type: $0.t, text: $0.x, level: $0.l, checked: $0.c, rows: $0.rows) },
            cover: cover(row.cover),
            fontType: NoteFontType(rawValue: row.style.font) ?? .system,
            createdText: "Created \(AgeText.relative(created))",
            timeText: inTrash ? "Deleted \(AgeText.relative(Date(timeIntervalSince1970: (row.deletedAt ?? row.updatedAt) / 1000)))" : "Edited \(AgeText.relative(edited))",
            starred: row.starred,
            folderName: row.folder?.name,
            folderColorId: row.folder?.color,
            showsFolder: row.kind != "template",
            shape: row.shape,
            template: row.kind == "template"
        )
    }

    static func folder(_ f: FolderCard, parentName: String? = nil) -> FolderCardModel {
        FolderCardModel(
            id: f.id,
            name: f.name,
            colorId: f.color,
            count: f.noteCount,
            ageText: f.updatedAt > 0 ? AgeText.age(Date(timeIntervalSince1970: f.updatedAt / 1000)) : "",
            notes: f.previews.prefix(5).map { p in
                FolderCardModel.Note(title: p.title, excerpt: p.excerpt, cover: cover(p.cover, images: false), createdText: p.createdAt > 0 ? "Created \(AgeText.relative(Date(timeIntervalSince1970: p.createdAt / 1000)))" : "")
            },
            parentName: parentName,
            subfolders: f.childCount,
            subfolderColorIds: f.childColors,
            editedText: f.updatedAt > 0 ? "Edited \(AgeText.relative(Date(timeIntervalSince1970: f.updatedAt / 1000)))" : ""
        )
    }

    static func folder(_ n: FolderNode) -> FolderCardModel {
        FolderCardModel(id: n.id, name: n.name, colorId: n.color, count: n.noteCount ?? 0, ageText: "")
    }
}

/// A folder's mark in a list or the sidebar: Folevi's folder glyph in the folder's colour.
struct FolderMark: View {
    var colorId: String?
    var size: CGFloat = 15
    var kind: FolderGlyph.Kind = .notes

    var body: some View {
        FolderGlyph(colorId: colorId, size: size, kind: kind)
    }
}

/// A note's mark (Folevi's note glyph), for rows where a note sits beside folders.
struct NoteMark: View {
    var icon: String?
    var size: CGFloat = 14

    var body: some View {
        // Notes show no emoji (the owner's rule): Folevi's note glyph for every note.
        WebIcon.fileText.image(size: size).foregroundStyle(.secondary)
    }
}

/// An empty screen's invitation to the next step.
struct EmptyScreen: View {
    var symbol: String
    var title: String
    var message: String
    var actionTitle: String?
    var action: (() -> Void)?

    var body: some View {
        ContentUnavailableView {
            Label(title, systemImage: symbol)
        } description: {
            Text(message)
        } actions: {
            if let actionTitle, let action { Button(actionTitle, action: action).buttonStyle(.borderedProminent) }
        }
    }
}

/// A placeholder while a live value loads.
struct LoadingScreen: View {
    var body: some View {
        ProgressView().controlSize(.small).frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

extension Color {
    /// A folder or tag colour id ("blue", "#4f7cff") as a colour.
    static func folevi(_ id: String?) -> Color {
        FolderColor.resolve(id).color.color
    }
}

extension Color {
    /// Folevi's ink: the main app's black buttons (white in dark mode), the same in every Mac whatever its accent
    /// colour (the owner, 21 November 2026: match the web app's black and white buttons).
    static let foleviInk = Color(nsColor: NSColor(name: "foleviInk") { a in
        a.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? NSColor(srgbRed: 0xF2 / 255, green: 0xF2 / 255, blue: 0xF3 / 255, alpha: 1) : NSColor(srgbRed: 0x1F / 255, green: 0x1F / 255, blue: 0x22 / 255, alpha: 1)
    })

    /// What sits on the ink (white on black, black on white).
    static let foleviOnInk = Color(nsColor: NSColor(name: "foleviOnInk") { a in
        a.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? NSColor(srgbRed: 0x1F / 255, green: 0x1F / 255, blue: 0x22 / 255, alpha: 1) : .white
    })
}

/// The main app's black pill (New Note, a sheet's main action): ink fill, the inverse for its text, a press dip
/// and a hover.
struct InkPillStyle: ButtonStyle {
    @State private var hovered = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.body.weight(.semibold))
            .foregroundStyle(Color.foleviOnInk)
            .padding(.horizontal, 14)
            .padding(.vertical, 6)
            .background(Capsule().fill(Color.foleviInk.opacity(configuration.isPressed ? 0.8 : hovered ? 0.9 : 1)))
            .pressFeedback(configuration.isPressed)
            .onHover { hovered = $0 }
            .contentShape(Capsule())
    }
}

/// A text link in Folevi's ink, underlined on hover (instead of the system's blue).
struct InkLinkStyle: ButtonStyle {
    @State private var hovered = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .foregroundStyle(Color.foleviInk.opacity(configuration.isPressed ? 0.6 : 1))
            .underline(hovered)
            .onHover { hovered = $0 }
    }
}
