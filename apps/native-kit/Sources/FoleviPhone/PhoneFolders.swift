// Folders on the iPhone, as the web draws them: every folder (apps/web/src/components/iphone/Organize.tsx
// IphoneFolders: search, the folder cards two to a row or rows, View as and Sort), cards put in order by dragging
// as icons on the Home Screen (held, then moved: over another card's middle it goes inside that folder, over its
// left or right quarter the others make room), and New folder
// (iphone/NewFolderSheet.tsx: a card in the middle of the screen, over the keyboard: the title, the colour, where
// it goes, Create).
#if os(iOS)
import SwiftUI
#if canImport(UIKit)
import UIKit
#endif
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
    /// Closes a card's long-press menu (a held card moved off it is dragged instead).
    public var closeMenu: () -> Void = {}
    let scrollToTop: Int
    @State private var moreFrame: CGRect = .zero
    /// The card held and dragged about, the order on show while it is (the cards' ids), and the card it would go
    /// inside if let go now.
    @State private var drag: CardDrag?
    @State private var order: [String]?
    @State private var nest: String?
    /// Each card's frame in the grid, laid out (not where a drag has it).
    @State private var frames: [String: CGRect] = [:]
    @Environment(\.colorScheme) private var scheme

    private struct CardDrag: Equatable {
        var id: String
        /// Where the finger took hold of the card, from its corner.
        var grab: CGSize
        var location: CGPoint
    }

    private static let grid = "phone.folders.grid"
    private var slide: Animation? { WebMotion.reduced ? nil : .spring(response: 0.32, dampingFraction: 0.82) }

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
                let draggable = model.canEdit
                LazyVGrid(columns: [GridItem(.flexible(), spacing: grid.gap), GridItem(.flexible(), spacing: grid.gap)], spacing: 20) {
                    ForEach(arranged(shown), id: \.id) { f in
                        let held = drag?.id == f.id
                        VStack(alignment: .leading, spacing: 6) {
                            PhonePressable(scale: 0.97, onTap: { if drag == nil { open("/folders/\(f.id)") } }, onLongPress: { folderMenu(f, $0) }) {
                                WebFolderCard(model.cardModel(f))
                                    .background {
                                        // Held over its middle: the folder it would go inside lights up.
                                        if nest == f.id {
                                            RoundedRectangle(cornerRadius: FoleviTokens.Radius.panel, style: .continuous)
                                                .fill((WebStyles.vars["glass-active"]?.resolve(scheme) ?? RGBA(0, 0, 0, 0.06)).color)
                                                .overlay(RoundedRectangle(cornerRadius: FoleviTokens.Radius.panel, style: .continuous).strokeBorder(FoleviTokens.Chrome.heading.resolve(scheme).color, lineWidth: 2))
                                                .padding(-6)
                                        }
                                    }
                            }
                            // A search finds folders at every level: a nested one says where it is.
                            if let path = model.path(f) {
                                Text("in \(path)").webText(.role(.footnote)).lineLimit(1).foregroundStyle(Folevi.color.inkMuted)
                                    .accessibilityHidden(true)
                            }
                        }
                        .onGeometryChange(for: CGRect.self) { $0.frame(in: .named(Self.grid)) } action: { frames[f.id] = $0 }
                        .scaleEffect(held ? 1.06 : 1)
                        .shadow(color: .black.opacity(held ? 0.22 : 0), radius: held ? 18 : 0, y: held ? 10 : 0)
                        .offset(liftOffset(f.id))
                        .zIndex(held ? 1 : 0)
                        .simultaneousGesture(dragGesture(f), including: draggable ? .all : .subviews)
                        .accessibilityActions {
                            if model.canReorder, let i = shown.firstIndex(where: { $0.id == f.id }) {
                                if i > 0 { Button("Move earlier") { Task { await model.dropFolder(item(f.id), gap: i - 1) } } }
                                if i < shown.count - 1 { Button("Move later") { Task { await model.dropFolder(item(f.id), gap: i + 1) } } }
                            }
                        }
                    }
                }
                .coordinateSpace(name: Self.grid)
                .padding(grid.padding.edgeInsets)
                .environment(\.webPhoneCards, true)
            }
        }
        // (The finger moves the card, not the list, while one is held.)
        .scrollDisabled(drag != nil)
        .refreshable { await model.refresh() }
        .onAppear { model.setVisible(true) }
        .onDisappear {
            model.setVisible(false)
            drag = nil
            nest = nil
        }
    }

    /// The cards in the order on show: the list's, or the one a drag is making.
    private func arranged(_ shown: [FolderNode]) -> [FolderNode] {
        guard let order else { return shown }
        let byId = Dictionary(shown.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        let out = order.compactMap { byId[$0] }
        return out.count == shown.count ? out : shown
    }

    private func item(_ id: String) -> FolderDragItem {
        let node = model.nodes.first { $0.id == id }
        return FolderDragItem(id: id, name: node?.name ?? "Folder", parentId: node?.parentId)
    }

    /// Held for the menu's time, then moved off it, a card follows the finger; let go, it lands.
    private func dragGesture(_ f: FolderNode) -> some Gesture {
        LongPressGesture(minimumDuration: 0.45)
            .sequenced(before: DragGesture(minimumDistance: 0, coordinateSpace: .named(Self.grid)))
            .onChanged { value in
                guard case .second(true, let d?) = value else { return }
                if drag == nil {
                    // Held for the menu, it stays a menu until the finger moves off.
                    guard hypot(d.translation.width, d.translation.height) > 10, let frame = frames[f.id] else { return }
                    closeMenu()
                    #if canImport(UIKit)
                    UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                    #endif
                    order = order ?? model.shown.map(\.id)
                    withAnimation(slide) { drag = CardDrag(id: f.id, grab: CGSize(width: d.startLocation.x - frame.minX, height: d.startLocation.y - frame.minY), location: d.location) }
                    return
                }
                drag?.location = d.location
                follow()
            }
            .onEnded { _ in letGo() }
    }

    /// The card under the held one's middle: over its middle the held folder would go inside it; over its left or
    /// right quarter it gives up its place (not while searching).
    private func follow() {
        guard let drag, var next = order, let f = frames[drag.id], let from = next.firstIndex(of: drag.id) else { return }
        let mid = CGPoint(x: drag.location.x - drag.grab.width + f.width / 2, y: drag.location.y - drag.grab.height + f.height / 2)
        guard let target = next.first(where: { $0 != drag.id && frames[$0]?.contains(mid) == true }), let box = frames[target] else {
            if nest != nil { nest = nil }
            return
        }
        let zone = FolderRules.zone(at: mid.x - box.minX, length: box.width)
        if zone == .inside {
            if nest != target {
                nest = target
                #if canImport(UIKit)
                UISelectionFeedbackGenerator().selectionChanged()
                #endif
            }
            return
        }
        nest = nil
        guard model.canReorder else { return }
        next.remove(at: from)
        guard let at = next.firstIndex(of: target) else { return }
        next.insert(drag.id, at: zone == .before ? at : at + 1)
        guard next != order else { return }
        #if canImport(UIKit)
        UISelectionFeedbackGenerator().selectionChanged()
        #endif
        withAnimation(slide) { order = next }
    }

    /// Let go: inside the folder it's over, or in the place the others made for it (in Name or Recent that order
    /// becomes the manual one).
    private func letGo() {
        guard let held = drag else { return }
        let into = nest
        withAnimation(slide) {
            drag = nil
            nest = nil
        }
        if let into {
            order = nil
            Task { await model.dropFolder(item(held.id), into: into) }
            return
        }
        let ids = model.shown.map(\.id)
        guard let next = order, let gap = next.firstIndex(of: held.id), next != ids else {
            withAnimation(slide) { order = nil }
            return
        }
        Task {
            await model.dropFolder(item(held.id), gap: gap)
            // (Normally the list's new order has replaced this one already.)
            try? await Task.sleep(for: .seconds(1))
            if drag == nil { order = nil }
        }
    }

    /// Where a held card is drawn: under the finger, from its laid-out place.
    private func liftOffset(_ id: String) -> CGSize {
        guard let drag, drag.id == id, let f = frames[id] else { return .zero }
        return CGSize(width: drag.location.x - drag.grab.width - f.minX, height: drag.location.y - drag.grab.height - f.minY)
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
