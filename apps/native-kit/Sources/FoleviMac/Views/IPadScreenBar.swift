// The iPad's top bar, inside the content card (the owner's Mac UI guide, docs/design/macloving-mac-ui.md, as the
// Mac's ScreenTopBar draws it; chosen for the iPad on 2026-11-23):
//
//   (‹ ›)  All notes                    ..............   (▦ ▤ ⇅ …)  (+ New note)  (🔍 ˅)
//          12 notes
//
// Back and Forward in one glass capsule, the title with its subtitle under it, then trailing the screen's own
// controls together in one glass capsule (CardItems), New note as Folevi's ink pill, and the search capsule. Every
// control is 44 pt tall, a finger's size; only the controls are glass, the bar itself is the card's own fill, and
// the screen starts below it (nothing runs on under the bar). A note has the same bar: Back, Forward, its title, New
// note and search; its own tools stay in the page.
#if os(iOS)
import SwiftUI
import FoleviDesign
import FoleviEngine
import FoleviScreens

@MainActor
struct IPadScreenBar: View {
    @Bindable var model: FrameModel
    /// Where iPhone Duo's fold crosses the bar, partly closed (FoldSpan), in the bar's coordinates.
    @State private var fold: FoldSpan?

    var body: some View {
        // The screen's own controls (CardItems.swift), when it handed any.
        let items = model.route.isNote ? nil : model.cardItems[model.route.tabKey]
        NativeGlassContainer(spacing: MacLook.barSpacing) {
            if let fold, let split = split(fold) {
                // iPhone Duo partly closed: Back, Forward and the title before the fold, the controls past it (Apple's
                // book pose: they're where they'll be when the phone opens flat again); nothing in the crease.
                HStack(spacing: 0) {
                    heading(items: items)
                        .frame(width: split.lead, alignment: .leading)
                    Color.clear.frame(width: split.gap)
                    ViewThatFits(in: .horizontal) {
                        ForEach(CardFit.allCases, id: \.self) { fit in controls(items: items, fit: fit, leadingGroups: true) }
                    }
                    .frame(maxWidth: .infinity, alignment: .trailing)
                }
            } else {
                // As much as fits beside the title: everything; segmented groups as pull-downs; all in "…".
                ViewThatFits(in: .horizontal) {
                    ForEach(CardFit.allCases, id: \.self) { fit in row(items: items, fit: fit) }
                }
            }
        }
        .padding(.top, MacLook.barPaddingTop)
        .padding(.horizontal, MacLook.barPaddingSides)
        .padding(.bottom, MacLook.barPaddingBottom)
        .frame(height: MacLook.barHeight)
        .frame(maxWidth: .infinity)
        .readFold { fold = $0 }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Toolbar")
    }

    /// The room before the fold and the fold's own (with its margins), inside the bar's side padding; nil when the
    /// fold runs too near an end of the bar for a split to help.
    private func split(_ fold: FoldSpan) -> (lead: CGFloat, gap: CGFloat)? {
        let lead = fold.minX - MacLook.barPaddingSides - FoldSpan.margin
        guard lead > 120 else { return nil }
        return (lead, fold.width + FoldSpan.margin * 2)
    }

    /// One line of the bar at a fit.
    private func row(items: CardItems?, fit: CardFit) -> some View {
        HStack(spacing: MacLook.barSpacing) {
            heading(items: items)
            if let items, !items.leading.isEmpty, fit != .folded {
                CardGroupsView(groups: items.leading, fit: fit)
            }
            Spacer(minLength: MacLook.barSpacing)
            controls(items: items, fit: fit, leadingGroups: false)
        }
    }

    /// Back and Forward, then the title with its subtitle under it.
    private func heading(items: CardItems?) -> some View {
        HStack(spacing: MacLook.barSpacing) {
            IPadHistoryCapsule(model: model)
            VStack(alignment: .leading, spacing: 0) {
                Text(CardControls.title(model))
                    .font(MacLook.Text.headline)
                    .foregroundStyle(MacLook.Colors.label)
                if let sub = items?.subtitle, !sub.isEmpty {
                    Text(sub).font(MacLook.Text.small).monospacedDigit().foregroundStyle(MacLook.Colors.secondary)
                }
            }
            .lineLimit(1)
            .truncationMode(.tail)
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isHeader)
            .layoutPriority(-1)
            .allowsHitTesting(false)
        }
    }

    /// The screen's controls, New note and search. `leadingGroups`: the screen's leading groups come along (past the
    /// fold, where nothing is left beside the title for them).
    private func controls(items: CardItems?, fit: CardFit, leadingGroups: Bool) -> some View {
        HStack(spacing: MacLook.barSpacing) {
            if leadingGroups, let items, !items.leading.isEmpty, fit != .folded {
                CardGroupsView(groups: items.leading, fit: fit)
            }
            if let items {
                CardGroupsView(groups: fit == .folded ? items.leading + items.trailing : items.trailing, fit: fit, oneCapsule: true)
            }
            MacNewNotePill(model: model, height: MacLook.barControlHeight)
            CardSearch(model: model)
        }
    }
}

/// Back and Forward in one glass capsule: a view of its own, so the history changing (every tab switch) redraws only
/// these two buttons, not the whole bar.
@MainActor
struct IPadHistoryCapsule: View {
    let model: FrameModel

    var body: some View {
        HStack(spacing: 0) {
            button("chevron.left", label: "Back", help: "Back (⌘[)", enabled: model.canGoBack) { model.goBack() }
            button("chevron.right", label: "Forward", help: "Forward (⌘])", enabled: model.history.canGoForward) { model.goForward() }
        }
        .padding(.horizontal, MacLook.capsuleInset)
        .frame(height: MacLook.barControlHeight)
        .nativeGlass(Capsule(), interactive: true)
        .fixedSize()
    }

    private func button(_ symbol: String, label: String, help: String, enabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            MacSymbol(symbol, size: 16, weight: .medium)
                .frame(width: 40, height: MacLook.barControlHeight - MacLook.capsuleInset * 2)
                .contentShape(Capsule())
        }
        .buttonStyle(QuietHoverStyle(shape: AnyShape(Capsule())))
        .foregroundStyle(MacLook.Colors.label)
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.35)
        .foleviTooltip(help)
        .accessibilityLabel(label)
    }
}
#endif
