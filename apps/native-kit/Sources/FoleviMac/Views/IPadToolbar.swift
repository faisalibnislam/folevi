// The iPad's toolbar (the owner, 2026-11-24: "native like the Mac", whose window has a unified Liquid Glass
// toolbar): iPadOS's own navigation bar over the detail column of the split view, with
//
//   [sidebar] (‹ ›)  All notes                    (▦ ▤) (⇅) (…)  (+ New note)  (☁︎ 🔔)  (🔍 Search)  [tools]
//                    12 notes
//
// Back and Forward, the title and its subtitle (the bar's own), the screen's own items (CardItems, each group a
// toolbar item the system draws in its glass), New note as the one prominent action in Folevi's ink, the sync status
// and the bell, then the search field, which opens the palette with what's typed (as the Mac's and the old card's
// search did). On a note the last button shows and hides the note's tools in the system inspector.
//
// iPhone Duo open across (`sideBars`, iOS 27.1): iOS lays the toolbar out in a column at the side, as it does with the
// phone closed, and Apple's HIG asks for the same controls in the same places in every pose. So the whole toolbar goes
// there: Back and Forward on top, New note as a symbol pinned right under them (words stay in a horizontal bar), the
// sync status and the bell, and on a note its tools at the foot (Foli AI, Insert, Format, Style, Share; the rest of its
// "…" in the system's overflow menu), where the closed phone has them, instead of the page's floating dock.
#if os(iOS)
import SwiftUI
import UIKit
import FoleviDesign
import FoleviEngine
import FoleviScreens

@MainActor
struct IPadToolbar: ToolbarContent {
    @Bindable var model: FrameModel
    @Binding var inspectorShown: Bool
    @Binding var tool: IPadNoteTool
    var sideBars = false
    /// A narrow window (iPhone Duo's inner screen upright, an iPad mini in portrait): New note's words would leave the
    /// title a letter or two, so it shows its symbol alone.
    var narrow = false

    var body: some ToolbarContent {
        ToolbarItemGroup(placement: .topBarLeading) {
            Button { model.goBack() } label: { Label("Back", systemImage: "chevron.left") }
                .disabled(!model.canGoBack)
                .accessibilityIdentifier("ipad-back")
            Button { model.goForward() } label: { Label("Forward", systemImage: "chevron.right") }
                .disabled(!model.history.canGoForward)
                .accessibilityIdentifier("ipad-forward")
        }
        // The screen's own controls, each group its own glass capsule (the system groups a toolbar's items): those
        // that belong right after the title (the calendar's ‹ Today ›) on the bar's leading side, the rest trailing.
        let items = model.route.isNote ? nil : model.cardItems[model.route.tabKey]
        ForEach(items?.leading ?? []) { g in
            ToolbarItem(placement: .topBarLeading) { IPadToolbarGroup(group: g) }
        }
        ForEach(items?.trailing ?? []) { g in
            ToolbarItem(placement: .primaryAction) { IPadToolbarGroup(group: g) }
        }
        if #available(iOS 26, *) {
            ToolbarSpacer(.fixed, placement: .primaryAction)
        }
        // (The last to go into the bar's overflow in a narrow window.)
        if #available(iOS 27.1, *), sideBars {
            // The prominent action, right under Back and Forward in the column (the HIG's order: navigation first).
            ToolbarItem(placement: .primaryAction) { IPadNewNoteButton(model: model, symbolOnly: true) }
                .visibilityPriority(.high)
        } else if #available(iOS 27, *) {
            ToolbarItem(placement: .primaryAction) { IPadNewNoteButton(model: model, symbolOnly: narrow) }
                .visibilityPriority(.high)
        } else {
            ToolbarItem(placement: .primaryAction) { IPadNewNoteButton(model: model, symbolOnly: narrow) }
        }
        if #available(iOS 26, *) {
            ToolbarSpacer(.fixed, placement: .primaryAction)
        }
        if #available(iOS 27.1, *), sideBars {
            // (The sync status is a view of its own: it joins the column only when asked.)
            ToolbarItemGroup(placement: .primaryAction) {
                IPadSyncButton(model: model)
                IPadBellButton(model: model)
            }
            .axisBehavior(.verticalPreferred)
        } else {
            ToolbarItemGroup(placement: .primaryAction) {
                IPadSyncButton(model: model)
                IPadBellButton(model: model)
            }
        }
        if model.route.isNote {
            if #available(iOS 26, *) {
                ToolbarSpacer(.fixed, placement: .primaryAction)
            }
            ToolbarItem(placement: .primaryAction) {
                Button { inspectorShown.toggle() } label: { Label(inspectorShown ? "Hide note tools" : "Show note tools", systemImage: "sidebar.right") }
                    .accessibilityIdentifier("ipad-note-tools")
            }
            if #available(iOS 27.1, *), sideBars {
                noteTools
            }
        }
    }

    /// The note's tools as the closed phone's column has them (RebuildNote's side bar items), in the same order and
    /// with the same symbols, so they sit where they did before the phone opened: Share up top; Comments, Style,
    /// Format, Foli AI and Insert at the foot (Style, Format, Insert and Foli AI open their panel in the inspector,
    /// again: close it); the note's "…" in the system's overflow menu.
    @available(iOS 27.1, *)
    @ToolbarContentBuilder
    private var noteTools: some ToolbarContent {
        let id = model.route.noteId ?? ""
        let meta = model.noteMeta[id]
        let canEdit = meta.map { $0.found ? $0.canEdit : true } ?? true
        let canShare = meta.map { $0.found && $0.access != "read" } ?? true
        ToolbarItemGroup(placement: .primaryAction) {
            if canShare {
                Button { model.noteMenu(.share) } label: { Label { Text("Share") } icon: { WebIcon.share.image(size: 20, strokeWidth: 1.9) } }
                    .accessibilityIdentifier("ipad-note-share")
            }
        }
        ToolbarItemGroup(placement: .bottomBar) {
            Button {
                if model.editorPanel == .comments { model.editor(.panelClose) } else { model.editor(.panelOpen(panel: .comments)) }
            } label: { Label { Text("Comments") } icon: { WebIcon.messageCircle.image(size: 21) } }
            if canEdit {
                toolButton(.style) { WebIcon.paintbrush.image(size: 20, strokeWidth: 1.85) }
                toolButton(.format) { WebIcon.type.image(size: 21) }
            }
            if model.session.value?.capabilities.ai ?? true {
                toolButton(.ai) { AiMarkImage.image(size: 22) }
            }
            if canEdit {
                toolButton(.insert) { WebIcon.plus.image(size: 21, strokeWidth: 2.4) }
            }
        }
        .visibilityPriority(.high)
        ToolbarOverflowMenu {
            IPadNoteMenu(model: model)
        }
    }

    private func toolButton(_ t: IPadNoteTool, @ViewBuilder icon: () -> some View) -> some View {
        Button {
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
            if inspectorShown, tool == t { inspectorShown = false } else { tool = t; inspectorShown = true }
        } label: {
            Label { Text(t.title) } icon: { icon() }
        }
        .accessibilityIdentifier("ipad-note-tool-\(t.rawValue)")
        .accessibilityAddTraits(inspectorShown && tool == t ? .isSelected : [])
    }
}

/// The note's "…" menu (NoteMenuPlan: the same rows as the page's own menu and the phone's), for iOS's overflow menu.
@MainActor
struct IPadNoteMenu: View {
    let model: FrameModel

    var body: some View {
        if let id = model.route.noteId {
            let state = model.editorState?.noteId == id ? model.editorState?.menu : nil
            let input = NoteMenuPlan.Input(meta: model.noteMeta[id], menu: state, reviewCards: nil, graph: model.session.value?.capabilities.graph == true)
            let sections = NoteMenuPlan.sections(input)
            ForEach(sections.indices, id: \.self) { i in
                Section {
                    ForEach(sections[i].indices, id: \.self) { j in
                        switch sections[i][j] {
                        case .item(let item): button(item, id: id)
                        case .submenu(let group, let items):
                            Menu {
                                ForEach(items.indices, id: \.self) { k in button(items[k], id: id) }
                            } label: {
                                Label { Text(group.rawValue) } icon: { group.webIcon.image() }
                            }
                        }
                    }
                }
            }
        }
    }

    private func button(_ item: NoteMenuItem, id: String) -> some View {
        Button(role: item.danger ? .destructive : nil) { run(item, id: id) } label: {
            Label { Text(item.title) } icon: { item.webIcon.image() }
        }
        .disabled(item.disabled)
    }

    private func run(_ item: NoteMenuItem, id: String) {
        switch item {
        case .bookmark(let on): model.star([id], !on)
        case .info: model.editor(.panelOpen(panel: .info))
        case .related: model.editor(.panelOpen(panel: .related))
        case .find: model.noteMenu(.find)
        case .review: model.open(.web("/review?note=\(id)"))
        case .readImages: model.noteMenu(.readImages)
        case .dna: model.open(.web("/graph?note=\(id)"))
        case .history: model.noteMenu(.history)
        case .showEditors: model.noteMenu(.showEditors)
        case .move: model.noteMenu(.move)
        case .copyTo: model.noteMenu(.copyTo)
        case .duplicate: model.noteMenu(.duplicate)
        case .moveToVault: model.noteMenu(.moveToVault)
        case .export: model.noteMenu(.export)
        case .present: model.noteMenu(.present)
        case .print: model.noteMenu(.print)
        case .saveAsTemplate: model.noteMenu(.saveAsTemplate)
        case .archive(let on, _): model.archive([id], !on)
        case .trash: model.trash([id])
        case .restore: model.perform { _ = try await model.client.command(.noteRestore(ids: [id])) }
        // The page asks first, the title typed to confirm, as the web's menu does.
        case .deleteForever: model.noteMenu(.delete)
        }
    }
}

/// One of a screen's groups (CardGroup) the way a toolbar holds it: a choice as the system's segmented control, a
/// pull-down or "…" as a menu button, an action as a button. Their glass is the toolbar's.
@MainActor
struct IPadToolbarGroup: View {
    let group: CardGroup

    var body: some View {
        switch group.kind {
        case .segmented(let options, let selected, let pick):
            Picker(group.label, selection: Binding(get: { selected }, set: { pick($0) })) {
                ForEach(options) { o in
                    if let symbol = o.symbol {
                        // (An image: the system's segmented control draws images and words, not views.)
                        Self.image(symbol).accessibilityLabel(o.title).tag(o.id)
                    } else {
                        Text(o.count.map { $0 > 0 ? "\(o.title) \($0)" : o.title } ?? o.title).tag(o.id)
                    }
                }
            }
            .pickerStyle(.segmented)
            .fixedSize()
            .accessibilityLabel(group.label)
        case .actions(let options, let run):
            // (One row: a toolbar item holds one view.)
            HStack(spacing: 4) {
                ForEach(options) { o in
                    Button { run(o.id) } label: {
                        if let symbol = o.symbol { Self.image(symbol).padding(.horizontal, 6) } else { Text(o.title).padding(.horizontal, 8) }
                    }
                    .accessibilityLabel(o.title)
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel(group.label)
        default:
            // (Their own buttons, menus and anchors, with the toolbar's glass rather than their own.)
            CardGroupsView(groups: [group], fit: .full)
                .environment(\.cardGroupGlass, false)
        }
    }
}

/// New note, the one prominent action: the system's prominent glass in Folevi's ink (black, white in dark mode), its
/// words in the ink's opposite.
@MainActor
struct IPadNewNoteButton: View {
    let model: FrameModel
    /// In iOS's column at the side (iPhone Duo): the symbol alone, as a column holds it (words keep a bar horizontal).
    var symbolOnly = false

    var body: some View {
        if symbolOnly {
            let button = Button { model.newNote() } label: { Label("New note", systemImage: "plus") }
                .tint(PhoneNativeLook.accent)
                .accessibilityIdentifier("strip.newNote")
            if #available(iOS 26, *) {
                button.buttonStyle(.glassProminent)
            } else {
                button.buttonStyle(.borderedProminent)
            }
        } else {
            wordsButton
        }
    }

    @ViewBuilder private var wordsButton: some View {
        // (Its words and its +, side by side: a toolbar shows a Label's icon alone.)
        let button = Button { model.newNote() } label: {
            HStack(spacing: 6) {
                Image(systemName: "plus").fontWeight(.semibold)
                Text("New note").fontWeight(.semibold)
            }
            .foregroundStyle(PhoneNativeLook.onAccent)
        }
        .accessibilityLabel("New note")
        .tint(PhoneNativeLook.accent)
        .accessibilityIdentifier("strip.newNote")
        if #available(iOS 26, *) {
            button.buttonStyle(.glassProminent)
        } else {
            button.buttonStyle(.borderedProminent)
        }
    }
}

extension IPadToolbarGroup {
    /// A control's symbol as an image: Folevi's own icon where it has one for the name (MacSymbol's choice), else the
    /// SF Symbol.
    static func image(_ symbol: String) -> Image {
        if let icon = MacSymbol.icon(symbol) { return icon.image(size: 17, strokeWidth: 2) }
        return Image(systemName: symbol)
    }
}

/// Whether everything is saved and synced (the strip's cloud), opening its popover from where it sits.
@MainActor
struct IPadSyncButton: View {
    let model: FrameModel

    var body: some View {
        MacSyncStatus(model: model) { model.showSync?($0) }
    }
}

/// The bell, opening the notifications popover from where it sits.
@MainActor
struct IPadBellButton: View {
    let model: FrameModel
    @State private var anchor: NSView?

    var body: some View {
        Button { model.showNotifications?(anchor) } label: {
            Label("Notifications", systemImage: "bell")
                .background(MenuAnchor { anchor = $0 })
        }
        .accessibilityIdentifier("ipad-bell")
    }
}
#endif
