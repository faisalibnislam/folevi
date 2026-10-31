// Search on the iPhone, as the web draws it (apps/web/src/components/app/CommandPalette.tsx, `iphone`): the whole
// screen, the field at the top with Cancel, the scope chips (Folder, Tag, Edited, and where when there are several
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
    @FocusState private var focused: Bool
    @Environment(\.colorScheme) private var scheme

    public init(model: SearchModel, aiOn: Bool, actions: [PhoneSearchAction], askAI: @escaping (String?) -> Void, openNote: @escaping (String) -> Void, close: @escaping () -> Void, scopeMenu: @escaping (String, CGRect) -> Void) {
        self.model = model
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
        GeometryReader { geo in
            VStack(spacing: 0) {
                header
                scopes
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 0) { results }
                        .padding(.bottom, geo.safeAreaInsets.bottom + 16)
                }
                .scrollDismissesKeyboard(.interactively)
            }
            .padding(.top, geo.safeAreaInsets.top)
            .ignoresSafeArea(edges: [.top, .bottom])
        }
        .background(FoleviTokens.Chrome.canvas.resolve(scheme).color.ignoresSafeArea())
        .onAppear { focused = !Self.noKeyboard }
        .onSubmit { model.remember() }
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
                    PhoneScopeChip(label: model.scope == .everywhere ? "All places" : model.spaceName, on: model.scope == .everywhere) { scopeMenu("where", $0) }
                }
                if model.filtersAllowed {
                    PhoneScopeChip(label: model.folderName ?? "Folder", on: model.folderId != nil) { scopeMenu("folder", $0) }
                    PhoneScopeChip(label: model.tagName.map { "#\($0)" } ?? "Tag", on: model.tagId != nil) { scopeMenu("tag", $0) }
                }
                PhoneScopeChip(label: model.updated?.title ?? "Edited", on: model.updated != nil) { scopeMenu("updated", $0) }
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
        }
        if model.noResults {
            Text("No notes match “\(model.text.trimmingCharacters(in: .whitespaces))”.").webText(sub15).foregroundStyle(muted.color).padding(.horizontal, 20).padding(.vertical, 12)
        }
        caps(typed ? "Notes" : "Recent", first: true)
        if typed {
            ForEach(model.noteHits, id: \.id) { hit in noteRow(hit) }
            let meaning = model.meaningHits
            if !meaning.isEmpty {
                caps("By meaning", first: false)
                ForEach(meaning, id: \.id) { hit in noteRow(hit) }
            }
        } else {
            ForEach((model.home.value?.recents ?? []).prefix(8), id: \.id) { row in
                recentRow(row)
            }
        }
        let q = model.text.trimmingCharacters(in: .whitespaces)
        let matching = q.isEmpty ? Array(actions.prefix(4)) : actions.filter { $0.label.localizedCaseInsensitiveContains(q) }
        if aiOn || !matching.isEmpty {
            caps("Actions", first: false)
            if aiOn {
                actionRow(PhoneSearchAction(id: "ask-ai", label: q.isEmpty ? "Ask Foli AI about your notes" : "Ask Foli AI: “\(q)”", icon: nil, ai: true) { askAI(q.isEmpty ? nil : q) })
            }
            ForEach(matching) { actionRow($0) }
        }
    }

    /// IPHONE_CAPS: footnote, semibold, caps, 0.04em; 24 above (12 for the first), 6 below.
    private func caps(_ text: String, first: Bool) -> some View {
        Text(text.uppercased())
            .webText(WebTextStyle(size: 13, leading: 18, weight: 600, letterSpacing: 0.52))
            .foregroundStyle(muted.color)
            .padding(.horizontal, 20)
            .padding(.top, first ? 12 : 24)
            .padding(.bottom, 6)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityAddTraits(.isHeader)
    }

    private func noteRow(_ hit: SearchHit) -> some View {
        row(icon: AnyView(WebIconView(.fileText, size: 22, strokeWidth: 1.8)), minHeight: 64) {
            VStack(alignment: .leading, spacing: 0) {
                PhoneHighlighted(text: hit.title.isEmpty ? "Untitled" : hit.title, query: model.answeredText, style: body17, color: ink).lineLimit(1)
                if !hit.snippet.isEmpty {
                    // (The place only when searching all of them; the snippet's line breaks collapse, as in a span.)
                    let place = model.scope == .everywhere ? hit.spaceName.map { "\($0) · " } ?? "" : ""
                    PhoneHighlighted(text: place + hit.snippet.split(whereSeparator: \.isWhitespace).joined(separator: " "), query: model.answeredText, style: sub15, color: muted)
                }
            }
            .padding(.vertical, 10)
        } action: {
            model.remember()
            openNote(hit.id)
        }
    }

    private func recentRow(_ row: NoteRow) -> some View {
        self.row(icon: AnyView(WebIconView(.fileText, size: 22, strokeWidth: 1.8)), minHeight: 64) {
            VStack(alignment: .leading, spacing: 0) {
                Text(row.title.isEmpty ? "Untitled" : row.title).webText(body17).lineLimit(1).foregroundStyle(ink.color)
                Text("Edited \(CardMapping.timeText(row, inTrash: false))").webText(sub15).lineLimit(1).foregroundStyle(faint.color)
            }
            .padding(.vertical, 10)
        } action: { openNote(row.id) }
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
    private func row<Content: View>(icon: AnyView, minHeight: CGFloat, @ViewBuilder content: () -> Content, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                icon.frame(width: 28).foregroundStyle(muted.color)
                content()
                    .frame(maxWidth: .infinity, minHeight: minHeight, alignment: .leading)
                    .overlay(alignment: .bottom) { PhoneRowHairlineView() }
            }
            .padding(.leading, 20)
            .padding(.trailing, 16)
            .contentShape(Rectangle())
        }
        .buttonStyle(PhoneRowPressStyle())
    }
}

/// A scope chip: a 32 pt capsule of 6.5% ink (15 pt text, its chevron), in a 44 pt target.
struct PhoneScopeChip: View {
    let label: String
    let on: Bool
    let action: (CGRect) -> Void
    @State private var frame: CGRect = .zero
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let ink = FoleviTokens.Chrome.ink.resolve(scheme)
        Button { action(frame) } label: {
            HStack(spacing: 4) {
                Text(label).webText(WebTextStyle(size: 15, leading: 20)).lineLimit(1)
                WebIconView(.chevronDown, size: 14).foregroundStyle(FoleviTokens.Chrome.inkMuted.resolve(scheme).color)
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
        .buttonStyle(.plain)
        .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { frame = $0 }
        .accessibilityLabel(label)
    }
}

/// Text with what was searched for marked (the web's Highlight: a pale yellow box, 4 pt corners).
struct PhoneHighlighted: View {
    let text: String
    let query: String
    let style: WebTextStyle
    let color: RGBA
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        Text(attributed).webText(style).foregroundStyle(color.color)
    }

    private var attributed: AttributedString {
        var a = AttributedString(text)
        let q = query.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty else { return a }
        var searchStart = a.startIndex
        while searchStart < a.endIndex, let r = a[searchStart...].range(of: q, options: .caseInsensitive) {
            a[r].backgroundColor = (scheme == .dark ? RGBA(92, 78, 24) : RGBA(252, 239, 180)).color
            a[r].foregroundColor = FoleviTokens.Chrome.ink.resolve(scheme).color
            searchStart = r.upperBound
        }
        return a
    }
}
#endif
