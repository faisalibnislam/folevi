// Pieces the web's views share, as Folevi for Mac draws them (from "more.*" styles): the empty state
// (components/ui/EmptyState.tsx, size "page"), the facts row under the glass bar (ViewChrome's header: a
// view's subtitle and actions), and the bare Select trigger those rows carry.
#if os(macOS)
import AppKit
import SwiftUI
import FoleviDesign

/// `<EmptyState>` at page size: an icon in a soft tile, a Spectral title, a muted line and a fainter hint.
struct WebEmptyState: View {
    let icon: WebIcon?
    let title: String
    var message: String? = nil
    var hint: String? = nil
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let box = moreStyle("more.empty", scheme)
        let tile = moreStyle("more.empty.tile", scheme)
        let t = moreStyle("more.empty.title", scheme)
        let b = moreStyle("more.empty.body", scheme)
        let h = moreStyle("more.review.empty.hint", scheme)
        VStack(spacing: 0) {
            if let icon {
                WebIconView(icon, size: 19, strokeWidth: 1.9)
                    .foregroundStyle(tile.color.color)
                    .frame(width: tile.width, height: tile.height)
                    .background(RoundedRectangle(cornerRadius: tile.radius, style: .circular).fill(tile.background.color))
                    .padding(.bottom, tile.margin.bottom)
            }
            Text(verbatim: title).webText(t.text).lineLimit(1).foregroundStyle(t.color.color)
            if let message {
                WebPrettyText(message, style: b.text, alignment: .center).foregroundStyle(b.color.color).padding(.top, b.margin.top)
            }
            if let hint {
                WebPrettyText(hint, style: h.text, alignment: .center).foregroundStyle(h.color.color).padding(.top, h.margin.top)
            }
        }
        .padding(box.padding.edgeInsets)
        .frame(maxWidth: box.width)
        .frame(maxWidth: .infinity)
    }
}

/// ViewChrome's facts row: the view's subtitle on the left (muted), its actions on the right.
struct WebFactsRow<Actions: View>: View {
    let subtitle: String?
    @ViewBuilder let actions: () -> Actions
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let row = moreStyle("more.review.header", scheme)
        let sub = moreStyle("more.review.subtitle", scheme)
        HStack(spacing: row.gap) {
            Text(verbatim: subtitle ?? "").webText(sub.text).lineLimit(1).foregroundStyle(sub.color.color)
            Spacer(minLength: 0)
            HStack(spacing: 6) { actions() }
        }
        .padding(.horizontal, row.padding.left)
        .frame(height: row.height)
        .padding(.horizontal, row.margin.left)
    }
}

/// A bare `<Select className="h-8 text-subheadline">` trigger: the chosen label and a chevron, opening a
/// Folevi-drawn menu of the options (the chosen one checked).
struct WebBareSelect: View {
    let label: String
    let options: [(id: String, title: String)]
    let selected: String
    let onSelect: @MainActor (String) -> Void
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let s = moreStyle("more.review.select", scheme)
        let l = moreStyle("more.review.select.label", scheme)
        let c = moreStyle("more.review.select.chevron", scheme)
        WebMenuButton(width: 224, entries: {
            options.map { o in WebMenuEntry(.item(o.title, checked: o.id == selected, id: o.id)) { onSelect(o.id) } }
        }) {
            HStack(spacing: s.gap) {
                Text(verbatim: label).webText(l.text).lineLimit(1).foregroundStyle(l.color.color)
                WebIconView(.chevronDown, size: 14).foregroundStyle(c.color.color).opacity(c.opacity)
            }
            .frame(height: s.height)
            .contentShape(Rectangle())
        }
    }
}
#endif
