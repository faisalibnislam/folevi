// A list row's swipe actions on the iPhone, as the web's SwipeRow (apps/web/src/components/iphone/Swipe.tsx) does
// them: swipe left for the trailing actions (Archive, Trash), right for the leading ones (Star); each 76 wide in
// its colour with the icon over the label in white; a swipe past 60% of the row runs the first action (it
// stretches across, with a tap of feedback); the row settles on the swipe spring (response 0.3, damping 0.86).
// One row open at a time; a tap on an open row closes it. The same actions are in the row's long-press menu.
import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

public struct PhoneSwipeAction: Identifiable {
    public var id: String { label }
    public var label: String
    public var icon: WebIcon
    public var tone: RGBA
    public var danger: Bool
    public var action: () -> Void

    public init(_ label: String, icon: WebIcon, tone: RGBA, danger: Bool = false, action: @escaping () -> Void) {
        self.label = label
        self.icon = icon
        self.tone = tone
        self.danger = danger
        self.action = action
    }
}

/// Which row is open (one at a time, across a list).
@MainActor
@Observable
public final class PhoneSwipeState {
    public var open: String?
    public init() {}
}

public struct PhoneSwipeRow<Content: View>: View {
    let id: String
    let leading: [PhoneSwipeAction]
    let trailing: [PhoneSwipeAction]
    let state: PhoneSwipeState
    let content: Content
    @State private var offset: CGFloat = 0
    @State private var base: CGFloat = 0
    @State private var horizontal: Bool?
    @State private var full = false
    @State private var width: CGFloat = 0
    @Environment(\.colorScheme) private var scheme

    static var actionWidth: CGFloat { 76 }
    static var spring: Animation { .spring(response: 0.3, dampingFraction: 0.86) }

    public init(id: String, leading: [PhoneSwipeAction], trailing: [PhoneSwipeAction], state: PhoneSwipeState, @ViewBuilder content: () -> Content) {
        self.id = id
        self.leading = leading
        self.trailing = trailing
        self.state = state
        self.content = content()
    }

    public var body: some View {
        let side = offset > 0 ? leading : offset < 0 ? Array(trailing.reversed()) : []
        ZStack(alignment: offset > 0 ? .leading : .trailing) {
            if !side.isEmpty {
                HStack(spacing: 0) {
                    ForEach(Array(side.enumerated()), id: \.element.id) { i, a in
                        let first = offset > 0 ? i == 0 : i == side.count - 1
                        Button { run(a) } label: {
                            VStack(spacing: 4) {
                                WebIconView(a.icon, size: 20)
                                Text(a.label).webText(.role(.footnote, weight: 500)).lineLimit(1)
                            }
                            .foregroundStyle(.white)
                            .padding(.horizontal, 12)
                            .frame(maxWidth: full && !first ? 0 : .infinity, maxHeight: .infinity, alignment: full ? (offset > 0 ? .trailing : .leading) : .center)
                            .background(a.tone.color)
                            .clipped()
                        }
                        .buttonStyle(.plain)
                        .accessibilityHidden(true)
                    }
                }
                .frame(width: abs(offset))
                .animation(Self.spring, value: full)
            }
            content
                .background(FoleviTokens.Chrome.canvas.resolve(scheme).color)
                .offset(x: offset)
        }
        .clipped()
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
        .simultaneousGesture(drag)
        .onChange(of: state.open) { _, open in
            if open != id, offset != 0 { settle(0) }
        }
        .overlay {
            // An open row: a tap anywhere on it closes it instead of opening the note.
            if offset != 0 && horizontal == nil {
                Color.clear.contentShape(Rectangle())
                    .padding(offset > 0 ? .leading : .trailing, abs(offset))
                    .onTapGesture { settle(0) }
            }
        }
    }

    private var drag: some Gesture {
        DragGesture(minimumDistance: 8, coordinateSpace: .local)
            .onChanged { g in
                if horizontal == nil {
                    horizontal = abs(g.translation.width) > abs(g.translation.height)
                    base = offset
                }
                guard horizontal == true else { return }
                var next = base + g.translation.width
                if next > 0 && leading.isEmpty { next /= 6 }
                if next < 0 && trailing.isEmpty { next /= 6 }
                offset = next
                let past = width > 0 && abs(next) >= width * 0.6 && (next > 0 ? !leading.isEmpty : !trailing.isEmpty)
                if past != full {
                    full = past
                    if past { tap(.medium) }
                }
            }
            .onEnded { _ in
                defer { horizontal = nil }
                guard horizontal == true else { return }
                let x = offset
                full = false
                if width > 0, abs(x) >= width * 0.6 {
                    if x > 0, let a = leading.first { return run(a) }
                    if x < 0, let a = trailing.first { return run(a) }
                }
                let open = x > 40 && !leading.isEmpty ? CGFloat(leading.count) * Self.actionWidth
                    : x < -40 && !trailing.isEmpty ? -CGFloat(trailing.count) * Self.actionWidth : 0
                settle(open)
                if open != 0 { state.open = id }
            }
    }

    private func run(_ a: PhoneSwipeAction) {
        settle(0)
        if a.danger { tap(.rigid) }
        a.action()
    }

    private func settle(_ to: CGFloat) {
        withAnimation(Self.spring) { offset = to }
        if to == 0, state.open == id { state.open = nil }
    }

    private func tap(_ style: TapStyle) {
        #if canImport(UIKit)
        UIImpactFeedbackGenerator(style: style == .rigid ? .rigid : .medium).impactOccurred()
        #endif
    }

    private enum TapStyle { case medium, rigid }
}
