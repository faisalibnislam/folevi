// Folders on the iPhone, as the web draws them: every folder (apps/web/src/components/iphone/Organize.tsx
// IphoneFolders: search, the folder cards two to a row or rows, View as and Sort), and New folder
// (iphone/NewFolderSheet.tsx: a card in the middle of the screen, over the keyboard: the title, the colour, where
// it goes, Create).
#if os(iOS)
import SwiftUI
import FoleviDesign
import FoleviEngine
import FoleviScreens

public struct PhoneAllFoldersScreen: View {
    @Bindable var model: AllFoldersModel
    let open: (String) -> Void
    let back: () -> Void
    let menu: (CGRect) -> Void
    /// A folder card's menu (its long press), from the card.
    public var folderMenu: (FolderNode, CGRect) -> Void = { _, _ in }
    let scrollToTop: Int
    @State private var moreFrame: CGRect = .zero
    @Environment(\.colorScheme) private var scheme

    public init(model: AllFoldersModel, open: @escaping (String) -> Void, back: @escaping () -> Void, menu: @escaping (CGRect) -> Void, scrollToTop: Int = 0) {
        self.model = model
        self.open = open
        self.back = back
        self.menu = menu
        self.scrollToTop = scrollToTop
    }

    public var body: some View {
        let grid = WebStyles.named("phone.grid").resolve(scheme)
        PhoneScreen(PhoneScreenOptions(title: "Folders"), root: false, scrollToTop: scrollToTop, back: back) {
            EmptyView()
        } trailing: {
            WebGlassPill {
                WebPillButton("Folders options", action: { menu(moreFrame) }) {
                    WebIconView(.ellipsis, size: 24, strokeWidth: 2.2)
                }
                .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { moreFrame = $0 }
            }
        } header: {
            PhoneSearchField("Search", text: $model.query)
        } content: {
            let shown = model.shown
            if !model.isLoading && shown.isEmpty {
                let q = model.query.trimmingCharacters(in: .whitespaces)
                PhoneScreenEmpty(icon: .folderOpen, title: q.isEmpty ? "No folders yet" : "No folders match “\(q)”", message: q.isEmpty ? "Folders keep related notes together." : nil)
            } else if model.layout == .list {
                LazyVStack(spacing: 0) {
                    ForEach(shown, id: \.id) { f in
                        PhoneListRow(f.name, detail: f.noteCount.map(String.init), action: { open("/folders/\(f.id)") }) {
                            FolderGlyph(colorId: f.color, size: 22)
                        }
                    }
                }
                .padding(.top, 8)
            } else {
                LazyVGrid(columns: [GridItem(.flexible(), spacing: grid.gap), GridItem(.flexible(), spacing: grid.gap)], spacing: 20) {
                    ForEach(shown, id: \.id) { f in
                        PhonePressable(scale: 0.97, onTap: { open("/folders/\(f.id)") }, onLongPress: { folderMenu(f, $0) }) {
                            WebFolderCard(model.cardModel(f))
                        }
                    }
                }
                .padding(grid.padding.edgeInsets)
                .environment(\.webPhoneCards, true)
            }
        }
        .refreshable { await model.refresh() }
        .onAppear { model.setVisible(true) }
        .onDisappear { model.setVisible(false) }
    }
}

/// A short form in a card in the middle of the screen (Sheet.tsx `variant="card"`): the screen dimmed by a
/// quarter, the card (min(400, screen less 24) wide, the sheet's corners, its solid surface) growing from 94% in
/// 260 ms, kept above the keyboard; a tap outside or Close dismisses it.
public struct PhoneCardSheet<Content: View>: View {
    let title: String
    let close: () -> Void
    let content: Content
    @State private var shown = false
    @Environment(\.colorScheme) private var scheme

    public init(title: String, close: @escaping () -> Void, @ViewBuilder content: () -> Content) {
        self.title = title
        self.close = close
        self.content = content()
    }

    public var body: some View {
        GeometryReader { geo in
            ZStack {
                Color.black.opacity(shown ? 0.25 : 0)
                    .ignoresSafeArea()
                    .onTapGesture(perform: close)
                    .accessibilityHidden(true)
                VStack(spacing: 0) {
                    PhoneSheetHeader(title: title, close: close, leading: { EmptyView() }, trailing: { EmptyView() })
                        .padding(.top, 4)
                    content
                }
                .frame(width: min(400, geo.size.width - 24))
                .background(
                    RoundedRectangle(cornerRadius: FoleviTokens.Radius.sheet, style: .continuous)
                        .fill(PhoneSurface.solid.resolve(scheme).color)
                        .shadow(color: .black.opacity(0.18), radius: 24, y: 10)
                )
                .clipShape(RoundedRectangle(cornerRadius: FoleviTokens.Radius.sheet, style: .continuous))
                .scaleEffect(shown ? 1 : 0.94)
                .opacity(shown ? 1 : 0)
                .accessibilityAddTraits(.isModal)
                .accessibilityAction(.escape, close)
            }
            .frame(width: geo.size.width, height: geo.size.height)
        }
        .onAppear { withAnimation(.timingCurve(0.2, 0.9, 0.25, 1.05, duration: 0.26)) { shown = true } }
    }
}

/// New folder's form: Title (the folder's glyph in its colour beside the field), Color (the folder colours as
/// 34 pt swatches in 44 pt targets, the chosen one ringed and ticked; a random one to start), Inside (the top
/// level or a folder), and Create.
public struct PhoneNewFolderForm: View {
    let folders: [FolderNode]
    let create: (String, String, String?) -> Void
    @State private var name = ""
    @State private var color: String
    @State private var parent: String?
    @State private var insideFrame: CGRect = .zero
    let pickParent: (CGRect, String?, @escaping (String?) -> Void) -> Void
    @FocusState private var focused: Bool
    @Environment(\.colorScheme) private var scheme

    public init(folders: [FolderNode], parent: String?, pickParent: @escaping (CGRect, String?, @escaping (String?) -> Void) -> Void, create: @escaping (String, String, String?) -> Void) {
        self.folders = folders
        self.create = create
        self.pickParent = pickParent
        _parent = State(initialValue: parent)
        _color = State(initialValue: FoleviTokens.folderColors.randomElement()?.id ?? FolderColor.defaultId)
    }

    public var body: some View {
        let ink = FoleviTokens.Chrome.ink.resolve(scheme)
        let muted = FoleviTokens.Chrome.inkMuted.resolve(scheme)
        let label = WebTextStyle(size: 13, leading: 18)
        let trimmed = name.trimmingCharacters(in: .whitespaces)
        VStack(alignment: .leading, spacing: 0) {
            Text("Title").webText(label).foregroundStyle(muted.color).padding(.horizontal, 4).padding(.bottom, 6)
            HStack(spacing: 12) {
                FolderGlyph(colorId: color, size: 22)
                TextField("", text: $name, prompt: Text("Folder name").foregroundStyle(FoleviTokens.Chrome.inkFaint.resolve(scheme).color))
                    .font(Font(WebTextStyle(size: 17, leading: 22).ctFont))
                    .foregroundStyle(ink.color)
                    .focused($focused)
                    .submitLabel(.done)
                    .onSubmit(submit)
                    .onChange(of: name) { _, v in if v.count > 80 { name = String(v.prefix(80)) } }
                    .frame(height: 48)
            }
            .padding(.horizontal, 12)
            .background(RoundedRectangle(cornerRadius: FoleviTokens.Radius.panel, style: .continuous).fill(ink.opacity(0.06).color))
            Text("Color").webText(label).foregroundStyle(muted.color).padding(.horizontal, 4).padding(.top, 16).padding(.bottom, 4)
            ScrollViewReader { proxy in
                ScrollView(.horizontal) {
                    HStack(spacing: 2) {
                        ForEach(FoleviTokens.folderColors) { c in
                            let on = c.id == color
                            Button { color = c.id } label: {
                                ZStack {
                                    Circle().fill(c.color.color)
                                    Circle().strokeBorder(Color.black.opacity(0.16), lineWidth: 0.5)
                                    if on { WebIconView(.check, size: 17, strokeWidth: 2.6).foregroundStyle(RGBA(0x17, 0x17, 0x1a).color) }
                                }
                                .frame(width: 34, height: 34)
                                .padding(2)
                                .overlay { if on { Circle().strokeBorder(FoleviTokens.Chrome.heading.resolve(scheme).color, lineWidth: 2) } }
                                .frame(width: 44, height: 44)
                                .contentShape(Circle())
                            }
                            .buttonStyle(PhoneSwatchPressStyle())
                            .id(c.id)
                            .accessibilityLabel(c.name)
                            .accessibilityAddTraits(on ? [.isSelected] : [])
                        }
                    }
                    .padding(.horizontal, 12)
                    .padding(.bottom, 4)
                }
                .scrollIndicators(.hidden)
                .padding(.horizontal, -16)
                .onAppear { proxy.scrollTo(color, anchor: .center) }
            }
            if !folders.isEmpty {
                HStack(spacing: 12) {
                    Text("Inside").webText(WebTextStyle(size: 15, leading: 20)).foregroundStyle(muted.color)
                    Spacer(minLength: 0)
                    Button { pickParent(insideFrame, parent) { parent = $0 } } label: {
                        HStack(spacing: 6) {
                            Text(parent.flatMap { id in folders.first { $0.id == id }?.name } ?? "Top level")
                                .webText(WebTextStyle(size: 15, leading: 20)).lineLimit(1)
                            WebIconView(.chevronsUpDown, size: 14).foregroundStyle(muted.color)
                        }
                        .foregroundStyle(ink.color)
                        .padding(.horizontal, 12)
                        .frame(height: 40)
                        .background(RoundedRectangle(cornerRadius: FoleviTokens.Radius.control, style: .continuous).fill(ink.opacity(0.06).color))
                    }
                    .buttonStyle(.plain)
                    .frame(maxWidth: 220, alignment: .trailing)
                    .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { insideFrame = $0 }
                }
                .padding(.horizontal, 4)
                .padding(.top, 16)
            }
            Button(action: submit) {
                Text("Create")
                    .webText(WebTextStyle(size: 17, leading: 22, weight: 600))
                    .foregroundStyle((trimmed.isEmpty ? FoleviTokens.Chrome.inkFaint : FoleviTokens.Chrome.canvas).resolve(scheme).color)
                    .frame(maxWidth: .infinity)
                    .frame(height: 48)
                    .background(RoundedRectangle(cornerRadius: FoleviTokens.Radius.panel, style: .continuous).fill(trimmed.isEmpty ? ink.opacity(0.08).color : FoleviTokens.Chrome.heading.resolve(scheme).color))
            }
            .buttonStyle(PhoneCardPressStyle())
            .disabled(trimmed.isEmpty)
            .padding(.top, 20)
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 16)
        .onAppear { focused = true }
    }

    private func submit() {
        let t = name.trimmingCharacters(in: .whitespaces)
        guard !t.isEmpty else { return }
        create(t, color, parent)
    }
}

/// A swatch pressed: it shrinks to 90%.
struct PhoneSwatchPressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.scaleEffect(configuration.isPressed ? 0.9 : 1).animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}
#endif
