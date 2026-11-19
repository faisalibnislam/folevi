// The content card's own controls on the Mac (docs/MAC_NATIVE_LOOK.md; the owner's layout, 2026-11-18): Liquid
// Glass floating at the card's top, with no bar behind them. Content runs on under them.
//
//   Calendar  ......................................................  (🔍 ˅)      a screen
//                                                                                   a note: nothing
//
// On a screen: its title, then trailing its own controls and the search control (it opens into the field on a click
// or ⌘K, and closes again on Escape while empty; typing opens the palette with the query). ContentViewController
// hosts them over the card, letting every click outside them through. The iPad's wide layout lays the same view over
// its card (IPadFrameView): SwiftUI lets every touch outside the controls through by itself.
//
// Nothing here repeats a control that is already on screen (the owner, 2026-11-18: no unnecessary buttons), and
// nothing floats over a note: Back and Forward are in the title bar strip, New note is the sidebar's row (and ⌘N,
// and File > New Note), a note's Share is in the note's own bar at the page's foot. So a note needs no empty band
// at its top for controls (the owner, 2026-11-18: "weird empty space on the note page").
#if os(macOS) || os(iOS)
#if os(macOS)
import AppKit
#endif
import SwiftUI
import FoleviDesign
import FoleviEngine
import FoleviScreens

@MainActor
struct CardControls: View {
    @Bindable var model: FrameModel
    /// Where its controls are, for its hosting view's hit test (PassThroughControlsHostingView).
    let regions: CardHitRegions
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
        NativeGlassContainer(spacing: MacLook.barSpacing) {
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
        .animation(MacLook.animation(reduceMotion), value: searching)
        // ⌘K and Edit > Search All Notes: the search control opens and takes the keyboard.
        .onChange(of: model.barSearchFocus) {
            searching = true
            DispatchQueue.main.async { focused = true }
        }
        .macClickThrough()
        .environment(\.cardHitRegions, regions)
        // (The whole hosting view: the controls' frames in it.)
        .coordinateSpace(.named(CardHitRegions.space))
    }

    /// One line of the controls at a fit.
    private func row(note: Bool, items: CardItems?, fit: CardFit) -> some View {
        HStack(spacing: MacLook.barSpacing) {
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
                // (The title starts on the page's own content edge.)
                .padding(.leading, MacLook.titleInset)
                .layoutPriority(-1)
                .allowsHitTesting(false)
                if let items, !items.leading.isEmpty, fit != .folded {
                    CardGroupsView(groups: items.leading, fit: fit)
                }
            }
            Spacer(minLength: MacLook.barSpacing)
            if !note {
                if let items {
                    CardGroupsView(groups: fit == .folded ? items.leading + items.trailing : items.trailing, fit: fit)
                }
                search
            }
        }
    }

    /// The search control: a glass capsule with the magnifier that opens into the field.
    @ViewBuilder private var search: some View {
        if searching {
            BarSearchField(text: $text, prompt: "Search", focus: $focused) { openPalette(text) }
                .frame(minWidth: 170, idealWidth: 240, maxWidth: 240)
                .foleviTooltip("Search or jump to… (⌘K)")
                .cardHitRegion()
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
                    MacSymbol("magnifyingglass", size: 14, weight: .medium)
                    MacSymbol("chevron.down", size: 9, weight: .semibold).foregroundStyle(MacLook.Colors.secondary)
                }
                .padding(.horizontal, 13)
                .frame(height: MacLook.barControlHeight)
                .contentShape(Capsule())
            }
            .buttonStyle(QuietHoverStyle(shape: AnyShape(Capsule())))
            .foregroundStyle(MacLook.Colors.label)
            .nativeGlass(Capsule(), interactive: true)
            .cardHitRegion()
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
        #if os(macOS)
        FrameSheets.window(for: model)?.makeFirstResponder(nil)
        #endif
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

/// Where the card's controls are drawn, in their hosting view (top left origin): the clicks it takes.
@MainActor
final class CardHitRegions {
    nonisolated static let space = "cardControls"
    private var rects: [UUID: CGRect] = [:]
    func set(_ id: UUID, _ rect: CGRect?) { rects[id] = rect }
    func contains(_ p: CGPoint) -> Bool { rects.values.contains { $0.insetBy(dx: -2, dy: -2).contains(p) } }
}

extension EnvironmentValues {
    @Entry var cardHitRegions: CardHitRegions? = nil
}

private struct CardHitRegion: ViewModifier {
    @State private var id = UUID()
    @Environment(\.cardHitRegions) private var regions
    func body(content: Content) -> some View {
        content
            .onGeometryChange(for: CGRect.self, of: { $0.frame(in: .named(CardHitRegions.space)) }) { regions?.set(id, $0) }
            .onDisappear { regions?.set(id, nil) }
    }
}

extension View {
    /// A control of the card's: its hosting view takes the clicks on it.
    func cardHitRegion() -> some View { modifier(CardHitRegion()) }
}

#if os(macOS)
/// A hosting view that takes only the clicks on its controls (cardHitRegion): everything else goes through to what's
/// under it (the card's controls over a screen or a note). SwiftUI draws its buttons in the hosting view itself, with
/// no view of their own, so a hit test alone can't tell a button from the empty room around it: it was taken as room,
/// and every click on Sort, the layouts or "…" went to the page under them.
final class PassThroughControlsHostingView<Content: View>: ClickThroughHostingView<Content> {
    var regions: CardHitRegions?
    override func hitTest(_ point: NSPoint) -> NSView? {
        let local = convert(point, from: superview)
        let top = isFlipped ? local : CGPoint(x: local.x, y: bounds.height - local.y)
        guard regions?.contains(top) == true else { return nil }
        return super.hitTest(point) ?? self
    }
}
#endif
#endif
