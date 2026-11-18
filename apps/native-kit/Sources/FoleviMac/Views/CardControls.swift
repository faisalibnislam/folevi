// The content card's own controls on the Mac (docs/MAC_NATIVE_LOOK.md; the owner's layout, 2026-11-18): Liquid
// Glass floating at the card's top, with no bar behind them. Content runs on under them.
//
//   (‹) (›) (+)  Calendar  ..........................................  (🔍 ˅)      a screen
//   (‹) (+)  ..........................................................  (Share)    a note
//
// Leading: Back (and Forward) while there's history, New note; on a screen its title. Trailing: on a screen the
// search control (it opens into the field on a click or ⌘K, and closes again on Escape while empty; typing opens
// the palette with the query), on a note Share (the note's own). ContentViewController hosts them over the card,
// letting every click outside them through.
#if os(macOS)
import AppKit
import SwiftUI
import FoleviDesign
import FoleviEngine
import FoleviScreens

@MainActor
struct CardControls: View {
    @Bindable var model: FrameModel
    @State private var text = ""
    @FocusState private var focused: Bool
    @State private var searching = false
    /// The card's width (a page's own panel takes its last `inspectorWidth` only where the note keeps its room).
    @State private var width: CGFloat = 0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let note = model.route.isNote
        // The screen's own controls (CardItems.swift), when it handed any.
        let items = note ? nil : model.cardItems[model.route.tabKey]
        GlassEffectContainer(spacing: MacLook.barSpacing) {
            if let items {
                // As much as fits beside the title: everything; segmented groups as pull-downs; all in "…".
                ViewThatFits(in: .horizontal) {
                    ForEach(CardFit.allCases, id: \.self) { fit in row(note: note, items: items, fit: fit) }
                }
            } else {
                row(note: note, items: nil, fit: .full)
            }
        }
        .padding(.top, MacLook.barPaddingTop)
        .padding(.leading, MacLook.barPaddingSides)
        // On a note with the page's own panel open beside it, the card's controls end where the note's card does (in
        // a window too narrow for both the panel lies over the note, and they keep the card's edge).
        .padding(.trailing, MacLook.barPaddingSides + (Self.panelBeside(model, width: width) ? MacLook.inspectorWidth : 0))
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .onGeometryChange(for: CGFloat.self, of: { $0.size.width }) { width = $0 }
        .animation(MacLook.animation(reduceMotion), value: model.history.canGoBack)
        .animation(MacLook.animation(reduceMotion), value: searching)
        // ⌘K and Edit > Search All Notes: the search control opens and takes the keyboard.
        .onChange(of: model.barSearchFocus) {
            searching = true
            DispatchQueue.main.async { focused = true }
        }
        .macClickThrough()
    }

    /// One line of the controls at a fit.
    private func row(note: Bool, items: CardItems?, fit: CardFit) -> some View {
        HStack(spacing: MacLook.barSpacing) {
            if model.history.canGoBack {
                circle("chevron.left", label: "Back", help: "Back (⌘[)") { model.goBack() }
            }
            if model.history.canGoForward {
                circle("chevron.right", label: "Forward", help: "Forward (⌘])") { model.goForward() }
            }
            circle("plus", label: "New note", help: "New Note (⌘N)") { model.newNote() }
            if !note {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(Self.title(model))
                        .font(MacLook.Text.title3Strong)
                        .foregroundStyle(MacLook.Colors.label)
                        .accessibilityAddTraits(.isHeader)
                    if let sub = items?.subtitle, !sub.isEmpty {
                        Text(sub).font(MacLook.Text.body).monospacedDigit().foregroundStyle(MacLook.Colors.secondary)
                    }
                }
                .lineLimit(1)
                .truncationMode(.tail)
                .padding(.leading, 4)
                .layoutPriority(-1)
                .allowsHitTesting(false)
                if let items, !items.leading.isEmpty, fit != .folded {
                    CardGroupsView(groups: items.leading, fit: fit)
                }
            }
            Spacer(minLength: MacLook.barSpacing)
            if note {
                share
            } else {
                if let items {
                    CardGroupsView(groups: fit == .folded ? items.leading + items.trailing : items.trailing, fit: fit)
                }
                search
            }
        }
    }

    /// A round glass button: a symbol, its tooltip (with the shortcut) and its accessible name.
    private func circle(_ symbol: String, label: String, help: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol).font(.system(size: 15, weight: .medium))
                .frame(width: MacLook.barControlHeight, height: MacLook.barControlHeight)
                .contentShape(Circle())
        }
        .buttonStyle(QuietHoverStyle(shape: AnyShape(Circle())))
        .foregroundStyle(MacLook.Colors.label)
        .glassEffect(.regular.interactive(), in: .circle)
        .foleviTooltip(help)
        .accessibilityLabel(label)
    }

    /// The note's Share (its own share sheet, as the note's menu opens it).
    private var share: some View {
        Button { model.noteMenu(.share) } label: {
            HStack(spacing: 6) {
                Image(systemName: "square.and.arrow.up")
                Text("Share")
            }
            .font(MacLook.Text.body.weight(.medium))
            .padding(.horizontal, 14)
            .frame(height: MacLook.barControlHeight)
            .contentShape(Capsule())
        }
        .buttonStyle(QuietHoverStyle(shape: AnyShape(Capsule())))
        .foregroundStyle(MacLook.Colors.label)
        .glassEffect(.regular.interactive(), in: .capsule)
        .fixedSize()
        .foleviTooltip("Share this note")
        .accessibilityLabel("Share")
    }

    /// The search control: a glass capsule with the magnifier that opens into the field.
    @ViewBuilder private var search: some View {
        if searching {
            BarSearchField(text: $text, prompt: "Search", focus: $focused) { openPalette(text) }
                .frame(minWidth: 170, idealWidth: 240, maxWidth: 240)
                .foleviTooltip("Search or jump to… (⌘K)")
                .onChange(of: text) { _, q in if !q.isEmpty { openPalette(q) } }
                .onKeyPress(.escape) {
                    guard text.isEmpty else { return .ignored }
                    close()
                    return .handled
                }
                .onChange(of: focused) { _, has in if !has && text.isEmpty { searching = false } }
                .transition(.opacity)
        } else {
            Button {
                searching = true
                DispatchQueue.main.async { focused = true }
            } label: {
                HStack(spacing: 4) {
                    Image(systemName: "magnifyingglass").font(.system(size: 14, weight: .medium))
                    Image(systemName: "chevron.down").font(.system(size: 9, weight: .semibold)).foregroundStyle(MacLook.Colors.secondary)
                }
                .padding(.horizontal, 13)
                .frame(height: MacLook.barControlHeight)
                .contentShape(Capsule())
            }
            .buttonStyle(QuietHoverStyle(shape: AnyShape(Capsule())))
            .foregroundStyle(MacLook.Colors.label)
            .glassEffect(.regular.interactive(), in: .capsule)
            .foleviTooltip("Search or jump to… (⌘K)")
            .accessibilityLabel("Search")
        }
    }

    private func close() {
        focused = false
        searching = false
    }

    /// What was typed into the search field opens the palette with it. The field gives up the keyboard first, so the
    /// keys typed next wait for the palette's own field (EarlyKeys) instead of landing here again.
    private func openPalette(_ query: String) {
        text = ""
        close()
        FrameSheets.window(for: model)?.makeFirstResponder(nil)
        CommandPalette.show(model, query: query)
    }

    /// A note's own panel (Style, Format, Insert, Foli AI) has the card's last `inspectorWidth` points beside the note:
    /// open, and the card wide enough to keep `inspectorMinContent` for the note.
    static func panelBeside(_ model: FrameModel, width: CGFloat) -> Bool {
        model.route.isNote && model.editorPanel != nil && width - MacLook.inspectorWidth >= MacLook.inspectorMinContent
    }

    /// The title for what's on screen: a folder's name, a view's name (the tab's label).
    static func title(_ model: FrameModel) -> String {
        if case .folder(let id) = model.route, let f = model.folders.value?.folders.first(where: { $0.id == id }) { return f.name }
        return model.tabs.label(model.tabs.active)
    }
}

/// A hosting view that takes only the clicks its SwiftUI controls take: everything else goes through to what's
/// under it (the card's controls over a screen or a note).
final class PassThroughControlsHostingView<Content: View>: ClickThroughHostingView<Content> {
    override func hitTest(_ point: NSPoint) -> NSView? {
        let hit = super.hitTest(point)
        return hit === self ? nil : hit
    }
}
#endif
