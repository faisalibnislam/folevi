// Search on the iPhone, as the web draws it (apps/web/src/components/app/CommandPalette.tsx, `iphone`): the whole
// screen; on iOS 26 the field and its close button at the foot above the keyboard (before iOS 26, at the top with
// Cancel), the scope chips (Folder, Tag, Edited, and where when there are several
// places), then Recent and Actions; with something typed, the notes found (the words marked), those found by
// meaning, and the actions that match. Results come from FoleviScreens' SearchModel (`search`).
#if os(iOS)
import SwiftUI
import FoleviDesign
import FoleviEngine
import FoleviScreens

/// An action the search offers (the palette's, iPhone order): what it says, its icon, what it does.
public struct PhoneSearchAction: Identifiable {
    public var id: String
    public var label: String
    public var icon: WebIcon?
    public var ai: Bool
    public var run: () -> Void
    public init(id: String, label: String, icon: WebIcon?, ai: Bool = false, run: @escaping () -> Void) {
        self.id = id
        self.label = label
        self.icon = icon
        self.ai = ai
        self.run = run
    }
}

public struct PhoneSearchScreen: View {
    @Bindable var model: SearchModel
    let aiOn: Bool
    /// The palette's actions (New document, Go to Tasks · Today, …), in order; four show before anything is typed.
    let actions: [PhoneSearchAction]
    let askAI: (String?) -> Void
    let openNote: (String) -> Void
    let close: () -> Void
    /// A scope chip's menu, from where it was tapped.
    let scopeMenu: (String, CGRect) -> Void
    /// iOS's own menus for the chips (the native look): `scopeMenu`'s rows through them.
    var menus: PhoneMenus?
    @FocusState private var focused: Bool
    /// The opening: the field rises from where Home's search sits to the top, the rest fades up after it (the
    /// owner's videos), on FoleviSpring.pop; under Reduce Motion everything only fades.
    @State private var arrived = false
    /// Recent: the notes opened last (`recent.viewed`, the palette's), not the ones edited last.
    @State private var viewed: ValueStore<RecentViewedValue>?
    @Environment(\.colorScheme) private var scheme

    public init(model: SearchModel, aiOn: Bool, actions: [PhoneSearchAction], askAI: @escaping (String?) -> Void, openNote: @escaping (String) -> Void, close: @escaping () -> Void, scopeMenu: @escaping (String, CGRect) -> Void, menus: PhoneMenus? = nil) {
        self.model = model
        self.menus = menus
        self.aiOn = aiOn
        self.actions = actions
        self.askAI = askAI
        self.openNote = openNote
        self.close = close
        self.scopeMenu = scopeMenu
    }

    private var ink: RGBA { FoleviTokens.Chrome.ink.resolve(scheme) }
    private var muted: RGBA { FoleviTokens.Chrome.inkMuted.resolve(scheme) }
    private var faint: RGBA { FoleviTokens.Chrome.inkFaint.resolve(scheme) }
    private var body17: WebTextStyle { WebTextStyle(size: 17, leading: 22) }
    private var sub15: WebTextStyle { WebTextStyle(size: 15, leading: 20) }

    public var body: some View {
        if #available(iOS 26, *) {
            nativeBody
        } else {
            legacyBody
        }
    }

    /// The native look (the owner, 2026-11-19): search is the tab bar's own search tab. iOS 26's direction (the
    /// owner, 21 November 2026): the field and its close button sit at the screen's foot, where the tab bar was, and
    /// ride up with the keyboard (`.searchable` with its default placement in a `Tab(role: .search)`); the scope
    /// chips sit just above the field (`safeAreaBar`, so results fade under them), and the results fill the screen
    /// from the top.
    @available(iOS 26, *)
    private var nativeBody: some View {
        NavigationStack {
            List { results }
            .listStyle(.insetGrouped)
            .listSectionSpacing(.compact)
            .environment(\.defaultMinListRowHeight, 0)
            .environment(\.phoneInList, true)
            .scrollContentBackground(.hidden)
            .scrollDismissesKeyboard(.interactively)
            .safeAreaBar(edge: .bottom) { scopes.padding(.top, 8).padding(.bottom, 4) }
            .background(PhoneLook.frame.resolve(scheme).color.ignoresSafeArea())
            // The field's own close button ends the search: back to the screen search was opened from (the
            // owner, 2026-11-19), not the Search tab left empty.
            .background(SearchEndWatcher(ended: close))
            .navigationTitle("Search")
            .navigationBarTitleDisplayMode(.large)
        }
        .searchable(text: $model.text, prompt: Text("Search notes and commands"))
        .searchFocused($focused)
        .autocorrectionDisabled()
        .textInputAutocapitalization(.never)
        .onSubmit(of: .search) { model.remember() }
        .onAppear {
            if viewed == nil { viewed = model.client.watch(.recentViewed(limit: 8)) }
            // (A moment after it shows: the field is in the tab bar by then.)
            if !Self.noKeyboard { DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { focused = true } }
        }
        .task {
            await EarlyKeys.current?.settle { [model] text in model.text = text + model.text }
        }
        .onDisappear { EarlyKeys.current?.cancel() }
    }

    private var legacyBody: some View {
        GeometryReader { geo in
            VStack(spacing: 0) {
                header
                    .offset(y: arrived || WebMotion.reduced ? 0 : 110)
                Group {
                    scopes
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 0) { results }
                            .padding(.bottom, geo.safeAreaInsets.bottom + 16)
                    }
                    .scrollDismissesKeyboard(.interactively)
                }
                .opacity(arrived ? 1 : 0)
                .offset(y: arrived || WebMotion.reduced ? 0 : 24)
            }
            .padding(.top, geo.safeAreaInsets.top)
            .ignoresSafeArea(edges: [.top, .bottom])
        }
        .background(PhoneLook.frame.resolve(scheme).color.ignoresSafeArea())
        .onAppear {
            withAnimation(FoleviSpring.pop) { arrived = true }
            focused = !Self.noKeyboard
            if viewed == nil { viewed = model.client.watch(.recentViewed(limit: 8)) }
        }
        .task {
            // Typed on a keyboard after ⌘K, before the field had the focus (F04): it goes first in the field.
            #if os(iOS)
            await EarlyKeys.current?.settle { [model] text in model.text = text + model.text }
            #endif
        }
        .onDisappear {
            #if os(iOS)
            EarlyKeys.current?.cancel()
            #endif
        }
        .onSubmit { model.remember() }
    }

    static func relative(_ ms: Double) -> String {
        PhoneFormat.relative(ms)
    }

    /// FOLEVI_GATE_NO_KEYBOARD=1 (Debug): opens without the keyboard, for comparing the screen.
    static var noKeyboard: Bool { ProcessInfo.processInfo.environment["FOLEVI_GATE_NO_KEYBOARD"] == "1" }

    // MARK: The field and Cancel (px-4 pt-2 pb-2, 8 apart)

    private var header: some View {
        HStack(spacing: 8) {
            HStack(spacing: 8) {
                WebIconView(.search, size: 19, strokeWidth: 2.1).foregroundStyle(faint.color)
                TextField("", text: $model.text, prompt: Text("Search notes and commands").foregroundStyle(faint.color))
                    .font(Font(body17.ctFont))
                    .foregroundStyle(ink.color)
                    .focused($focused)
                    .submitLabel(.search)
                    .autocorrectionDisabled()
                    #if os(iOS)
                    .textInputAutocapitalization(.never)
                    #endif
                    .accessibilityLabel("Search documents or type a command")
            }
            .padding(.horizontal, 12)
            .frame(height: 44)
            .background(RoundedRectangle(cornerRadius: FoleviTokens.Radius.panel, style: .continuous).fill(ink.opacity(0.065).color))
            // (The whole box takes the tap, not only the text line.)
            .contentShape(RoundedRectangle(cornerRadius: FoleviTokens.Radius.panel, style: .continuous))
            .onTapGesture { focused = true }
            Button("Cancel", action: close)
                .webText(body17)
                .foregroundStyle(FoleviTokens.Chrome.heading.resolve(scheme).color)
                .padding(.horizontal, 4)
                .frame(height: 44)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
    }

    // MARK: Scopes (IphoneScopes: 32 pt capsules in 44 pt targets, 8 apart)

    private var scopes: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 8) {
                if model.offersEverywhere {
                    PhoneScopeChip(label: model.scope == .everywhere ? "All places" : model.spaceName, on: model.scope == .everywhere, menus: menus, build: { scopeMenu("where", .zero) }) { scopeMenu("where", $0) }
                }
                if model.filtersAllowed {
                    PhoneScopeChip(label: model.folderName ?? "Folder", on: model.folderId != nil, menus: menus, build: { scopeMenu("folder", .zero) }) { scopeMenu("folder", $0) }
                    PhoneScopeChip(label: model.tagName.map { "#\($0)" } ?? "Tag", on: model.tagId != nil, menus: menus, build: { scopeMenu("tag", .zero) }) { scopeMenu("tag", $0) }
                }
                PhoneScopeChip(label: model.updated?.title ?? "Edited", on: model.updated != nil, menus: menus, build: { scopeMenu("updated", .zero) }) { scopeMenu("updated", $0) }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 4)
        }
        .scrollIndicators(.hidden)
        .accessibilityLabel("Search filters")
    }

    // MARK: Results

    @ViewBuilder private var results: some View {
        let typed = !model.text.trimmingCharacters(in: .whitespaces).isEmpty
        if typed && model.searching && model.result == nil {
            Text("Searching…").webText(sub15).foregroundStyle(muted.color).padding(.horizontal, 20).padding(.vertical, 12)
                .listRowBackground(Color.clear)
        }
        if model.noResults {
            Text("No notes match “\(model.text.trimmingCharacters(in: .whitespaces))”.").webText(sub15).foregroundStyle(muted.color).padding(.horizontal, 20).padding(.vertical, 12)
                .listRowBackground(Color.clear)
        }
        // Each part a section of iOS's own List (the owner, 2026-11-24).
        if typed {
            if !model.noteHits.isEmpty {
                PhoneListSection("Notes") { ForEach(model.noteHits, id: \.id) { hit in noteRow(hit) } }
            }
            let meaning = model.meaningHits
            if !meaning.isEmpty {
                PhoneListSection("By meaning") { ForEach(meaning, id: \.id) { hit in noteRow(hit) } }
            }
        } else if let rows = viewed?.value?.rows, !rows.isEmpty {
            PhoneListSection("Recent") { ForEach(rows, id: \.id) { row in recentRow(row) } }
        }
        let q = model.text.trimmingCharacters(in: .whitespaces)
        let matching = q.isEmpty ? Array(actions.prefix(4)) : actions.filter { $0.label.localizedCaseInsensitiveContains(q) }
        if aiOn || !matching.isEmpty {
            PhoneListSection("Actions") {
                if aiOn {
                    actionRow(PhoneSearchAction(id: "ask-ai", label: q.isEmpty ? "Ask Foli AI about your notes" : "Ask Foli AI: “\(q)”", icon: nil, ai: true) { askAI(q.isEmpty ? nil : q) })
                }
                ForEach(matching) { actionRow($0) }
            }
        }
    }

    private func noteRow(_ hit: SearchHit) -> some View {
        row(icon: AnyView(WebIconView(.fileText, size: 22, strokeWidth: 1.8)), minHeight: 64, iconTop: hit.snippet.isEmpty ? nil : 10 + (body17.leading - 22) / 2) {
            // (The snippet 2 below the title: `mt-0.5`.)
            VStack(alignment: .leading, spacing: 2) {
                PhoneHighlighted(text: hit.title.isEmpty ? "Untitled" : hit.title, query: model.answeredText, style: body17, color: ink).lineLimit(1)
                if !hit.snippet.isEmpty {
                    // (The place only when searching all of them; the snippet's line breaks collapse, as in a span.)
                    let place = model.scope == .everywhere ? hit.spaceName.map { "\($0) · " } ?? "" : ""
                    // (Two lines at most, ending in an ellipsis: IPHONE-17, one hit took five.)
                    PhoneHighlighted(text: place + hit.snippet.split(whereSeparator: \.isWhitespace).joined(separator: " "), query: model.answeredText, style: sub15, color: muted)
                        .lineLimit(2)
                        .truncationMode(.tail)
                }
            }
            .padding(.vertical, 10)
        } action: {
            model.remember()
            openNote(hit.id)
        }
        // Its title and what it is, then the snippet (F05).
        .accessibilityLabel("\(hit.title.isEmpty ? "Untitled" : hit.title), \(hit.matchIn == "meaning" ? "note found by meaning" : "note")")
        .accessibilityValue(hit.snippet.split(whereSeparator: \.isWhitespace).joined(separator: " "))
    }

    private func recentRow(_ row: RecentViewedRow) -> some View {
        self.row(icon: AnyView(WebIconView(.fileText, size: 22, strokeWidth: 1.8)), minHeight: 64) {
            VStack(alignment: .leading, spacing: 2) {
                Text(row.title.isEmpty ? "Untitled" : row.title).webText(body17).lineLimit(1).foregroundStyle(ink.color)
                Text("Edited \(Self.relative(row.updatedAt))").webText(sub15).lineLimit(1).foregroundStyle(faint.color)
            }
            .padding(.vertical, 10)
        } action: { openNote(row.id) }
        .accessibilityLabel("\(row.title.isEmpty ? "Untitled" : row.title), note")
        .accessibilityValue("Edited \(Self.relative(row.updatedAt))")
    }

    private func actionRow(_ a: PhoneSearchAction) -> some View {
        row(icon: a.ai ? AnyView(WebAiMark(size: 22)) : AnyView(a.icon.map { WebIconView($0, size: 22) }), minHeight: 52) {
            Text(a.label).webText(body17).lineLimit(1).foregroundStyle(ink.color)
        } action: {
            if a.id != "ask-ai" { model.remember() }
            a.run()
        }
    }

    /// A result row: 20 in, the icon in a 28 column, 12 to the text; the hairline from the text to the edge.
    /// `iconTop`: the icon lined up with the first line (a note's title) instead of the middle of a taller row.
    private func row<Content: View>(icon: AnyView, minHeight: CGFloat, iconTop: CGFloat? = nil, @ViewBuilder content: () -> Content, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(alignment: iconTop == nil ? .center : .top, spacing: 12) {
                icon.frame(width: 28).foregroundStyle(muted.color).padding(.top, iconTop ?? 0)
                content()
                    .frame(maxWidth: .infinity, minHeight: minHeight, alignment: .leading)
            }
            .padding(.leading, 14)
            .padding(.trailing, 12)
            .contentShape(Rectangle())
        }
        .buttonStyle(PhoneRowPressStyle())
    }
}

/// A scope chip: a 32 pt capsule of 6.5% ink (15 pt text, its chevron), in a 44 pt target.
struct PhoneScopeChip: View {
    let label: String
    let on: Bool
    /// iOS's own menu, its rows from `build` (the native look); else `action` shows Folevi's from the chip.
    var menus: PhoneMenus? = nil
    var build: (() -> Void)? = nil
    let action: (CGRect) -> Void
    @State private var frame = PhoneFrameBox()
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        if let menus, let build {
            PhoneMenuButton(label, menus: menus, build: build) { chip }
        } else {
            Button { action(frame.rect) } label: { chip }
                .buttonStyle(PhoneChipPressStyle())
                .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { frame.rect = $0 }
                .accessibilityLabel(label)
        }
    }

    private var chip: some View {
        let ink = FoleviTokens.Chrome.ink.resolve(scheme)
        return Group {
            HStack(spacing: 4) {
                Text(label).webText(WebTextStyle(size: 15, leading: 20)).lineLimit(1)
                WebIconView(.chevronDown, size: 14, strokeWidth: 2.4)
                    .foregroundStyle(on ? FoleviTokens.Chrome.canvas.resolve(scheme).color.opacity(0.7) : FoleviTokens.Chrome.inkMuted.resolve(scheme).color)
            }
            .foregroundStyle((on ? FoleviTokens.Chrome.canvas : FoleviTokens.Chrome.ink).resolve(scheme).color)
            .padding(.leading, 14)
            .padding(.trailing, 10)
            .frame(minHeight: 32)
            .frame(maxWidth: 180)
            .background(Capsule().fill(on ? FoleviTokens.Chrome.heading.resolve(scheme).color : ink.opacity(0.065).color))
            .frame(height: 44)
            .contentShape(Rectangle())
        }
    }
}

/// Text with what was searched for marked (the web's Highlight, a `<mark>`: a pale yellow box with 4 pt corners
/// over the font's ascent and descent, 1 pt of padding inside either end).
struct PhoneHighlighted: View {
    let text: String
    let query: String
    let style: WebTextStyle
    let color: RGBA
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        composed
            .textRenderer(MarkRenderer(fill: (scheme == .dark ? RGBA(74, 63, 28) : RGBA(252, 239, 180)).color, radius: FoleviTokens.Radius.tiny))
            .webText(style)
            .foregroundStyle(color.color)
    }

    /// The text in pieces, each mark's padding as kerning: a zero-width space 1 pt wide before it, 1 pt after its
    /// last letter.
    private var composed: Text {
        let shaped = text.webKitShaped
        let q = query.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty else { return Text(shaped) }
        let ink = FoleviTokens.Chrome.ink.resolve(scheme).color
        var out = Text("")
        var at = shaped.startIndex
        while at < shaped.endIndex, let r = shaped.range(of: q, options: .caseInsensitive, range: at..<shaped.endIndex) {
            if r.lowerBound > at { out = out + Text(shaped[at..<r.lowerBound]) }
            let last = shaped.index(before: r.upperBound)
            out = out + Text("\u{200B}").kerning(1).customAttribute(MarkAttribute())
            if last > r.lowerBound { out = out + Text(shaped[r.lowerBound..<last]).foregroundStyle(ink).customAttribute(MarkAttribute()) }
            out = out + Text(shaped[last..<r.upperBound]).kerning(1).foregroundStyle(ink).customAttribute(MarkAttribute())
            at = r.upperBound
        }
        if at < shaped.endIndex { out = out + Text(shaped[at...]) }
        return out
    }
}

private struct MarkAttribute: TextAttribute {}

/// Draws a box behind each line's marked runs, then the text.
private struct MarkRenderer: TextRenderer {
    let fill: Color
    let radius: CGFloat

    func draw(layout: Text.Layout, in ctx: inout GraphicsContext) {
        for line in layout {
            var box: CGRect?
            func flush() {
                if let b = box { ctx.fill(Path(roundedRect: b, cornerRadius: radius, style: .circular), with: .color(fill)) }
                box = nil
            }
            for run in line {
                if run[MarkAttribute.self] != nil {
                    let t = run.typographicBounds
                    let r = CGRect(x: t.rect.minX, y: t.origin.y - t.ascent, width: t.width, height: t.ascent + t.descent)
                    box = box.map { $0.union(r) } ?? r
                } else {
                    flush()
                }
            }
            flush()
        }
        for line in layout { ctx.draw(line) }
    }
}

/// Calls `ended` when iOS's search field stops searching (its close button) after it has been searching. Read
/// inside the stack `.searchable` is on, where `isSearching` is set.
private struct SearchEndWatcher: View {
    let ended: () -> Void
    @Environment(\.isSearching) private var isSearching
    @State private var searched = false

    var body: some View {
        Color.clear
            .frame(width: 0, height: 0)
            .accessibilityHidden(true)
            .onChange(of: isSearching) { _, now in
                if now { searched = true } else if searched { searched = false; ended() }
            }
    }
}
#endif
