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
        if #available(iOS 27, *) {
            ToolbarItem(placement: .primaryAction) { IPadNewNoteButton(model: model) }
                .visibilityPriority(.high)
        } else {
            ToolbarItem(placement: .primaryAction) { IPadNewNoteButton(model: model) }
        }
        if #available(iOS 26, *) {
            ToolbarSpacer(.fixed, placement: .primaryAction)
        }
        ToolbarItemGroup(placement: .primaryAction) {
            IPadSyncButton(model: model)
            IPadBellButton(model: model)
        }
        if model.route.isNote {
            if #available(iOS 26, *) {
                ToolbarSpacer(.fixed, placement: .primaryAction)
            }
            ToolbarItem(placement: .primaryAction) {
                Button { inspectorShown.toggle() } label: { Label(inspectorShown ? "Hide note tools" : "Show note tools", systemImage: "sidebar.right") }
                    .accessibilityIdentifier("ipad-note-tools")
            }
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

    var body: some View {
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
