// The cells Home and the lists share: note cards, note rows and folder cards, with what each does on touch,
// pointer and keyboard: press (touch-down prepares the note for the zoom), open with the card's frame, long-press
// / right-click menus, drag (notes and folders) and drop (onto folder cards: before, inside or after), hover on
// the Mac and iPad pointer, Select mode marks, and VoiceOver actions in place of swipes and menus.
import SwiftUI
import FoleviDesign
import FoleviEngine

/// A card's press: scales a little and tells `onPress` at touch-down (the frame prepares the note then).
public struct CardPressStyle: ButtonStyle {
    var onPress: () -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    public init(onPress: @escaping () -> Void = {}) { self.onPress = onPress }

    public func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.97 : 1)
            .animation(reduceMotion ? nil : .folevi(FoleviTokens.Motion.fast), value: configuration.isPressed)
            .onChange(of: configuration.isPressed) { _, pressed in if pressed { onPress() } }
    }
}

/// Records where a card is on screen (for the zoom), without redrawing anything.
struct RecordsFrame: ViewModifier {
    let id: String
    let kind: CardSource.Kind
    func body(content: Content) -> some View {
        content.onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { frame in
            CardFrames.shared.record(CardSource(id: id, kind: kind, frame: frame))
        }
    }
}

/// Lifts a little under the pointer (Mac hover, iPad pointer).
struct HoverLift: ViewModifier {
    @State private var hovering = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    func body(content: Content) -> some View {
        content
            .scaleEffect(hovering && !reduceMotion ? 1.015 : 1)
            .brightness(hovering ? 0.01 : 0)
            .animation(reduceMotion ? nil : .folevi(FoleviTokens.Motion.fast), value: hovering)
            .onHover { hovering = $0 }
            #if os(iOS)
            .hoverEffect(.lift)
            #endif
    }
}

/// The check on a card in Select mode (a rounded square: nothing fully round outside the glass).
struct SelectMark: View {
    let on: Bool
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: FoleviTokens.Radius.small, style: .continuous)
                .fill(on ? Folevi.color.heading : Color.white.opacity(0.88))
            RoundedRectangle(cornerRadius: FoleviTokens.Radius.small, style: .continuous)
                .strokeBorder(on ? Color.clear : Color.black.opacity(0.25), lineWidth: 1.5)
            if on { Image(systemName: "checkmark").font(.system(size: 13, weight: .bold)).foregroundStyle(Folevi.color.canvas) }
        }
        .frame(width: 26, height: 26)
        .shadow(color: .black.opacity(0.2), radius: 2, y: 1)
        .accessibilityHidden(true)
    }
}

/// A note as a card: opens with the zoom, its menu on long press / right click, draggable onto folders.
struct NoteCardCell<Menu: View>: View {
    let row: NoteRow
    let model: NoteCardModel
    var selecting = false
    var selected = false
    var onTap: (CardSource?) -> Void
    var onToggle: () -> Void = {}
    var accessibilityActions: [(String, () -> Void)] = []
    /// What a drag carries (the whole selection when this note is part of one).
    var drag: NoteDragItem? = nil
    @ViewBuilder var menu: () -> Menu
    @Environment(\.screenNavigator) private var navigator

    var body: some View {
        Button {
            if selecting { onToggle() } else { onTap(CardFrames.shared.source(for: row.id)) }
        } label: {
            NoteCardView(model)
                .overlay(alignment: .topTrailing) {
                    if selecting { SelectMark(on: selected).padding(8) }
                }
                .contentShape(Rectangle())
        }
        .buttonStyle(CardPressStyle { if !selecting { navigator.prepareNote(row.id) } })
        .modifier(RecordsFrame(id: row.id, kind: .noteCard))
        .modifier(HoverLift())
        .contextMenu { if !selecting { menu() } } preview: {
            NoteCardView(model).frame(width: 240)
        }
        .draggable(drag ?? NoteDragItem(id: row.id, title: row.title, folderId: row.folder?.id)) {
            DragStack(count: drag?.notes.count ?? 1) { NoteCardView(model).frame(width: 150) }
        }
        .accessibilityLabel(model.accessibilityText)
        .accessibilityAddTraits(selecting && selected ? [.isButton, .isSelected] : .isButton)
        .accessibilityHint(selecting ? "Selects the note" : "Opens the note")
        .accessibilityActions {
            ForEach(Array(accessibilityActions.enumerated()), id: \.offset) { _, action in
                Button(action.0, action: action.1)
            }
        }
        .accessibilityIdentifier("note-card-\(row.id)")
    }
}

/// A small page with its folder's colour down the spine (web NoteList.tsx NoteGlyph): rows of a mixed list
/// tell their folders apart. Templates have no folder: a plain page.
struct NoteGlyph: View {
    let folderColor: String?
    let plain: Bool
    @Environment(\.colorScheme) private var scheme
    var body: some View {
        let spine = plain
            ? FoleviTokens.Chrome.heading.resolve(scheme).mix(FoleviTokens.Chrome.canvas.resolve(scheme), 0.14).color
            : FolderColor.resolve(folderColor).color.color
        ZStack(alignment: .leading) {
            UnevenRoundedRectangle(topLeadingRadius: 3, bottomLeadingRadius: 3, bottomTrailingRadius: 5, topTrailingRadius: 5, style: .continuous)
                .fill(Folevi.color.surface)
                .overlay(UnevenRoundedRectangle(topLeadingRadius: 3, bottomLeadingRadius: 3, bottomTrailingRadius: 5, topTrailingRadius: 5, style: .continuous).strokeBorder(Folevi.color.line, lineWidth: 1))
            Rectangle().fill(spine).frame(width: 4).clipShape(UnevenRoundedRectangle(topLeadingRadius: 3, bottomLeadingRadius: 3, style: .continuous))
            VStack(alignment: .leading, spacing: 4.5) {
                Capsule().fill(Folevi.color.lineStrong).frame(width: 9, height: 1.5)
                Capsule().fill(Folevi.color.line).frame(width: 7, height: 1.5)
            }
            .padding(.leading, 8)
            .padding(.top, -6)
        }
        .frame(width: 20, height: 24)
        .frame(width: 28, height: 28)
        .accessibilityHidden(true)
    }
}

/// A note as a list row: glyph, title (with a star), "5 mins ago · Trips".
struct NoteRowView: View {
    let row: NoteRow
    let title: String
    let subtitle: String
    let starred: Bool

    var body: some View {
        HStack(spacing: 12) {
            NoteGlyph(folderColor: row.folder?.color, plain: row.kind == "template" || row.folder == nil)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 5) {
                    if let icon = row.icon, !icon.isEmpty { Text(icon).font(.system(size: 15)) }
                    Text(title)
                        .foleviFont(.body)
                        .foregroundStyle(Folevi.color.ink)
                        .lineLimit(1)
                    if starred {
                        Image(systemName: "star.fill").font(.system(size: 11)).foregroundStyle(Folevi.color.inkFaint).accessibilityLabel("Starred")
                    }
                }
                Text(subtitle)
                    .foleviFont(.footnote)
                    .foregroundStyle(row.sync == .saved ? Folevi.color.inkMuted : Folevi.color.emberInk)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 6)
        .frame(minHeight: 56)
        .contentShape(Rectangle())
    }
}

/// A placeholder while a row's window loads (or the first answer hasn't come).
struct PlaceholderCard: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var dim = false
    var body: some View {
        RoundedRectangle(cornerRadius: FoleviTokens.Radius.container, style: .continuous)
            .fill(Folevi.color.surfaceSunken)
            .aspectRatio(NoteCardView.aspectRatio, contentMode: .fit)
            .opacity(dim ? 0.55 : 1)
            .onAppear {
                guard !reduceMotion else { return }
                withAnimation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true)) { dim = true }
            }
            .accessibilityHidden(true)
    }
}

struct PlaceholderRow: View {
    var body: some View {
        HStack(spacing: 12) {
            RoundedRectangle(cornerRadius: 5, style: .continuous).fill(Folevi.color.surfaceSunken).frame(width: 20, height: 24).frame(width: 28)
            VStack(alignment: .leading, spacing: 6) {
                RoundedRectangle(cornerRadius: 3).fill(Folevi.color.surfaceSunken).frame(width: 160, height: 12)
                RoundedRectangle(cornerRadius: 3).fill(Folevi.color.surfaceSunken).frame(width: 110, height: 10)
            }
            Spacer()
        }
        .frame(minHeight: 56)
        .accessibilityHidden(true)
    }
}

// MARK: Folder cards

/// A folder card: opens the folder, its menu on long press / right click (and a "…" button under the pointer),
/// draggable into other folders, and a drop target for notes and folders.
struct FolderCardCell: View {
    let card: FolderCardModel
    let folder: MenuFolder
    let context: FolderMenuContext
    let actions: NoteActions
    let dialogs: FolderDialogState
    var onOpen: (CardSource?) -> Void
    var onDropNotes: ([NoteDragItem]) -> Void
    var onDropFolder: (FolderDragItem, FolderRules.Zone) -> Void
    @State private var hovering = false
    @State private var dropZone: FolderRules.Zone?
    @State private var spring = SpringLoader()
    @State private var width: CGFloat = 142

    var body: some View {
        Button {
            onOpen(CardFrames.shared.source(for: folder.id))
        } label: {
            FolderCardView(card)
                .overlay { dropIndicator }
                .contentShape(Rectangle())
        }
        .buttonStyle(CardPressStyle())
        .modifier(RecordsFrame(id: folder.id, kind: .folderCard))
        .overlay(alignment: .topTrailing) {
            if hovering {
                Menu {
                    FolderMenuItems(folder: folder, context: context, actions: actions, dialogs: dialogs)
                } label: {
                    Image(systemName: "ellipsis")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Folevi.color.ink)
                        .frame(width: 28, height: 28)
                        .foleviGlass(in: RoundedRectangle(cornerRadius: FoleviTokens.Radius.small, style: .continuous))
                }
                .menuStyle(.button)
                .buttonStyle(.plain)
                .menuIndicator(.hidden)
                .fixedSize()
                .padding(.top, 14)
                .padding(.trailing, 6)
                .accessibilityLabel("Folder options for \(folder.name)")
            }
        }
        .onHover { hovering = $0 }
        .modifier(HoverLift())
        .contextMenu {
            FolderMenuItems(folder: folder, context: context, actions: actions, dialogs: dialogs)
        }
        .draggable(FolderDragItem(id: folder.id, name: folder.name, parentId: folder.parentId)) {
            FolderCardView(card).frame(width: 130)
        }
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
        .onDrop(of: [.foleviNoteRef, .foleviFolderRef], delegate: FolderDrop(folderId: folder.id, axis: .horizontal, length: width, zone: $dropZone, spring: spring, onSpring: { onOpen(nil) }, onNotes: onDropNotes, onFolder: onDropFolder))
        .accessibilityLabel(card.accessibilityText)
        .accessibilityHint("Opens the folder")
        .accessibilityIdentifier("folder-card-\(folder.id)")
    }

    @ViewBuilder private var dropIndicator: some View {
        let shape = RoundedRectangle(cornerRadius: FoleviTokens.Radius.panel, style: .continuous)
        switch dropZone {
        case .inside?:
            shape.strokeBorder(Folevi.color.ember, lineWidth: 2.5).padding(.top, 6)
        case .before?:
            HStack { Capsule().fill(Folevi.color.ember).frame(width: 3); Spacer() }.offset(x: -8)
        case .after?:
            HStack { Spacer(); Capsule().fill(Folevi.color.ember).frame(width: 3) }.offset(x: 8)
        case nil:
            EmptyView()
        }
    }
}

/// Gathers the notes of a multi-item drop, then hands them over once.
@MainActor
final class DropCollector {
    private var items: [NoteDragItem] = []
    private var remaining: Int
    private let done: ([NoteDragItem]) -> Void
    init(expected: Int, done: @escaping ([NoteDragItem]) -> Void) {
        self.remaining = expected
        self.done = done
    }
    func add(_ item: NoteDragItem?) {
        if let item { items.append(item) }
        remaining -= 1
        if remaining == 0, !items.isEmpty { done(items) }
    }
}

/// A drag's preview: the card, with the cards behind it and a count when it carries several.
struct DragStack<Content: View>: View {
    let count: Int
    @ViewBuilder let content: () -> Content
    var body: some View {
        ZStack(alignment: .topTrailing) {
            if count > 1 {
                content().rotationEffect(.degrees(4)).opacity(0.6)
                if count > 2 { content().rotationEffect(.degrees(-3)).opacity(0.6) }
            }
            content()
            if count > 1 { Badge(count: count).offset(x: 6, y: -6) }
        }
        .accessibilityLabel(count > 1 ? "\(count) notes" : "")
    }
}
