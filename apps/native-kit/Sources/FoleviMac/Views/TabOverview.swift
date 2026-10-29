// The Tab Overview (the web's TabOverview.tsx): every open tab at once as pictures of their pages, like Safari's
// tab overview. Search them, open one, close them, or start a new note; the arrows move the selection, Return opens
// it, Esc (or Done, the grid button, ⌘⇧\, a click on the background) closes it.
#if os(macOS)
import AppKit
import SwiftUI
import FoleviDesign

public struct TabOverviewLayer: View {
    @Bindable var model: FrameModel
    @Environment(\.colorScheme) private var scheme
    @State private var query = ""
    @State private var sel = 0
    @State private var cols = 4
    @State private var shownIn = false
    @State private var monitor: Any?
    @FocusState private var searching: Bool

    public init(model: FrameModel) { self.model = model }

    struct Entry: Identifiable {
        let tab: FrameTab?
        var id: String { tab?.id ?? FrameTab.homeID }
    }

    /// Home, then every tab (the strip's own Home is the overview's first card either way).
    private var entries: [Entry] {
        [Entry(tab: nil)] + model.tabs.tabs.filter { !$0.isHome }.map { Entry(tab: $0) }
    }

    private func label(_ e: Entry) -> String { e.tab.map { model.tabs.label($0) } ?? "Home" }
    private func active(_ e: Entry) -> Bool { (e.tab?.id ?? FrameTab.homeID) == model.tabs.activeID }

    private var shown: [Entry] {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        return q.isEmpty ? entries : entries.filter { label($0).lowercased().contains(q) }
    }

    public var body: some View {
        let list = shown
        VStack(spacing: 0) {
            header
            GeometryReader { g in
                let columns = max(1, Int((g.size.width - 64 + 24) / (260 + 24)))
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 24, alignment: .bottom), count: columns), alignment: .leading, spacing: 24) {
                            if list.isEmpty {
                                Text("No tabs match “\(query.trimmingCharacters(in: .whitespaces))”.").webText(WebTextStyle(size: 13, leading: 18))
                                    .foregroundStyle(color("color-ink-muted"))
                                    .frame(maxWidth: .infinity).padding(.vertical, 40)
                                    .gridCellColumns(columns)
                            }
                            ForEach(Array(list.enumerated()), id: \.element.id) { i, e in
                                card(e, index: i).id(i)
                            }
                            if query.trimmingCharacters(in: .whitespaces).isEmpty { newNoteCard(index: list.count).id(list.count) }
                        }
                        .padding(.horizontal, 32).padding(.top, 16).padding(.bottom, 40)
                        .scaleEffect(shownIn || reduceMotion ? 1 : 0.97)
                    }
                    .scrollIndicators(.automatic)
                    .onChange(of: sel) { proxy.scrollTo(sel) }
                }
                .onAppear { cols = columns }
                .onChange(of: columns) { cols = columns }
            }
        }
        .padding(.top, 8)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background {
            ZStack {
                VisualEffectBlur()
                color("color-canvas").opacity(0.82)
            }
            .contentShape(Rectangle())
            .onTapGesture { dismiss() }
        }
        .opacity(shownIn || reduceMotion ? 1 : 0)
        .onAppear {
            sel = max(0, entries.firstIndex(where: active) ?? 0)
            searching = true
            withAnimation(.easeOut(duration: 0.2)) { shownIn = true }
            installKeys()
        }
        .onDisappear { removeKeys() }
        .onChange(of: query) { sel = 0 }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Tab Overview")
        .accessibilityAddTraits(.isModal)
    }

    private var reduceMotion: Bool { NSWorkspace.shared.accessibilityDisplayShouldReduceMotion }

    private var header: some View {
        HStack(spacing: 12) {
            Text("\(entries.count) \(entries.count == 1 ? "tab" : "tabs")").webText(WebTextStyle(size: 15, leading: 20, weight: 600)).foregroundStyle(color("color-heading"))
            Spacer(minLength: 0)
            HStack(spacing: 8) {
                WebIconView(.search, size: 14).foregroundStyle(color("color-ink-faint"))
                TextField("Search tabs", text: $query)
                    .textFieldStyle(.plain)
                    .font(.system(size: 13))
                    .focused($searching)
                    .accessibilityLabel("Search tabs")
                if !query.isEmpty {
                    Button { query = "" } label: {
                        WebIconView(.x, size: 12).frame(width: 20, height: 20).foregroundStyle(color("color-ink-faint")).contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Clear search")
                }
            }
            .padding(.horizontal, 10)
            .frame(width: 288, height: 36)
            .background(RoundedRectangle(cornerRadius: FoleviTokens.Radius.control, style: .continuous).fill(color("color-surface-raised")))
            .overlay(RoundedRectangle(cornerRadius: FoleviTokens.Radius.control, style: .continuous).strokeBorder(searching ? color("color-focus") : color("color-line"), lineWidth: searching ? 2 : 1))
            .shadow(color: .black.opacity(0.05), radius: 1, y: 1)
            Button { dismiss() } label: {
                Text("Done").webText(WebTextStyle(size: 13, leading: 18, weight: 600)).foregroundStyle(color("color-heading"))
                    .padding(.horizontal, 12).frame(height: 36).contentShape(Rectangle())
            }
            .buttonStyle(WebHoverRowStyle(radius: FoleviTokens.Radius.control, hover: WebStyles.vars["glass-hover"], press: WebStyles.vars["mac-press"], selected: false))
        }
        .padding(.horizontal, 32).padding(.top, 20).padding(.bottom, 8)
    }

    private func card(_ e: Entry, index i: Int) -> some View {
        let pinned = e.tab?.pinned == true
        let closable = e.tab != nil && !pinned
        let on = active(e)
        let shape = RoundedRectangle(cornerRadius: FoleviTokens.Radius.container, style: .continuous)
        let hovered = sel == i
        return VStack(spacing: 0) {
            HStack(spacing: 8) {
                if closable, let t = e.tab {
                    Button { model.closeTab(t.id) } label: {
                        WebIconView(.x, size: 13).frame(width: 20, height: 20).foregroundStyle(color("color-ink-faint")).contentShape(Rectangle())
                    }
                    .buttonStyle(WebHoverRowStyle(radius: FoleviTokens.Radius.chip, hover: WebStyles.vars["glass-hover"], press: WebStyles.vars["mac-press"], selected: false))
                    .accessibilityLabel("Close \(label(e))")
                } else {
                    Group { if pinned { WebIconView(.pin, size: 12).accessibilityLabel("Pinned") } }
                        .frame(width: 20, height: 20).foregroundStyle(color("color-ink-faint"))
                }
                HStack(spacing: 6) {
                    WebIconView(e.tab.map { $0.isJoined ? .squareSplitHorizontal : WebTopBar.icon(for: $0.route) } ?? .house, size: 14).opacity(0.7)
                    TruncatingLabel(text: label(e), style: WebTextStyle(size: 13, leading: 18, weight: on ? 600 : 400))
                        .foregroundStyle(on ? color("color-heading") : color("color-ink"))
                }
                .frame(maxWidth: .infinity)
                .padding(.trailing, 20)
            }
            .padding(.horizontal, 12)
            .frame(height: 40)
            Rectangle().fill(color("color-line")).frame(height: 1)
            Button { open(e) } label: {
                TabPicture(tab: e.tab, model: model).aspectRatio(16 / 10, contentMode: .fit).contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Open \(label(e))")
        }
        .background(color("color-surface-raised"))
        .clipShape(shape)
        .overlay {
            if hovered { shape.strokeBorder(color("color-focus"), lineWidth: 2) } else if on { shape.strokeBorder(color("color-heading").opacity(0.3), lineWidth: 1.5) }
        }
        .shadow(color: .black.opacity(hovered ? 0.14 : 0.08), radius: hovered ? 13 : 5, y: hovered ? 8 : 2)
        .offset(y: hovered ? -2 : 0)
        .animation(.easeOut(duration: 0.15), value: hovered)
        .onHover { if $0 { sel = i } }
    }

    private func newNoteCard(index: Int) -> some View {
        let shape = RoundedRectangle(cornerRadius: FoleviTokens.Radius.container, style: .continuous)
        return Button { newNote() } label: {
            shape.fill(color("glass-hover"))
                .aspectRatio(16 / 10, contentMode: .fit)
                .overlay {
                    WebIconView(.plus, size: 40, strokeWidth: 1.5)
                        .foregroundStyle(sel == index ? color("color-heading") : color("color-ink-faint"))
                }
                .overlay { if sel == index { shape.strokeBorder(color("color-focus"), lineWidth: 2) } }
                .contentShape(shape)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("New note")
        .onHover { if $0 { sel = index } }
    }

    // MARK: actions

    private func open(_ e: Entry) {
        dismiss()
        if let t = e.tab { model.selectTab(t.id) } else { model.selectTab(FrameTab.homeID) }
    }

    private func newNote() {
        dismiss()
        model.newNote()
    }

    private func dismiss() { model.overviewShown = false }

    /// The keys while it shows (the search field keeps the others): arrows move, Return opens, Esc closes.
    private func installKeys() {
        guard monitor == nil else { return }
        monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { event in
            let list = shown
            let last = query.trimmingCharacters(in: .whitespaces).isEmpty ? list.count : max(0, list.count - 1)
            switch event.keyCode {
            case 53: dismiss()
            case 124: sel = min(last, sel + 1)
            case 123: sel = max(0, sel - 1)
            case 125: sel = min(last, sel + cols)
            case 126: sel = max(0, sel - cols)
            case 36, 76:
                if sel == list.count { newNote() } else if list.indices.contains(sel) { open(list[sel]) }
            default: return event
            }
            return nil
        }
    }

    private func removeKeys() {
        if let m = monitor { NSEvent.removeMonitor(m) }
        monitor = nil
    }

    private func color(_ name: String) -> Color { WebStyles.vars[name]?.resolve(scheme).color ?? .clear }
}

/// The overview's backdrop-blur-xl over the window.
private struct VisualEffectBlur: NSViewRepresentable {
    func makeNSView(context: Context) -> NSVisualEffectView {
        let v = NSVisualEffectView()
        v.material = .underWindowBackground
        v.blendingMode = .withinWindow
        v.state = .active
        return v
    }
    func updateNSView(_ v: NSVisualEffectView, context: Context) {}
}
#endif
