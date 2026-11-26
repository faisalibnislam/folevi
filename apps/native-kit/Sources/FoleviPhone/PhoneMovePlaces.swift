// "Move or copy notes" on the iPhone: the web's MovePlaces.tsx dialog (To, What, How, Bring version history, and
// Copy notes or Move notes) as a phone sheet, each choice a row that opens Folevi's own menu with a check by the
// one chosen (as the task sheet's Priority). The kit's MovePlacesModel does the work (`places.move.preview`,
// `places.move`); the move's progress shows as the placeMove screen over the app.
#if os(iOS)
import SwiftUI
import FoleviDesign
import FoleviEngine
import FoleviScreens

private func C(_ pair: ColorPair, _ scheme: ColorScheme) -> Color { pair.resolve(scheme).color }

public struct PhoneMovePlacesSheet: View {
    let model: MovePlacesModel
    let close: () -> Void
    /// The sheet's own menus (it sits above the frame's menu layer).
    @State private var menus = PhoneMenus()
    @State private var rowFrames = PhoneFrameBoxes()
    @Environment(\.colorScheme) private var scheme

    public init(model: MovePlacesModel, close: @escaping () -> Void) {
        self.model = model
        self.close = close
    }

    public var body: some View {
        PhoneSheetPanel(title: "Move or copy notes", description: model.loaded && !model.destinations.isEmpty ? model.description : nil, close: close) {
            content.padding(.bottom, 12)
        }
        .overlay { PhoneMenuLayer(menus: menus) }
        .task { await model.load() }
    }

    @ViewBuilder
    private var content: some View {
        VStack(alignment: .leading, spacing: 20) {
            if !model.loaded {
                if let e = model.error {
                    message(e, danger: true)
                } else {
                    ProgressView().frame(maxWidth: .infinity).padding(.vertical, 24)
                }
            } else if model.destinations.isEmpty {
                message(MovePlacesModel.noOtherPlace, danger: false)
            } else {
                PhoneSheetGroup {
                    choiceRow("to", icon: .arrowRightLeft, label: "To", value: model.chosen?.label ?? "") { toMenu() }
                    choiceRow("what", icon: .files, label: "What", value: model.whatLabel, enabled: model.hasPick) { whatMenu() }
                    choiceRow("how", icon: model.copy ? .copy : .folderInput, label: "How", value: MovePlacesModel.howLabel(copy: model.copy)) { howMenu() }
                }
                PhoneSheetGroup {
                    HStack(spacing: 12) {
                        PhoneSheetRowIcon(.rotateCcwClock)
                        Text("Bring version history").webText(PhoneType.body()).foregroundStyle(C(FoleviTokens.Chrome.ink, scheme))
                            .frame(maxWidth: .infinity, alignment: .leading)
                        FoleviSwitch("Bring version history", on: model.versions) { model.versions = $0 }
                    }
                    .padding(.horizontal, 16)
                    .frame(minHeight: 52)
                }
                VStack(alignment: .leading, spacing: 8) {
                    message(model.summary, danger: false)
                    if let note = model.switchNote { message(note, danger: false) }
                    if model.preview?.fits == false { message("It doesn't fit in that account's storage.", danger: true) }
                    if let e = model.error { message(e, danger: true) }
                }
                runButton
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 4)
    }

    private func message(_ text: String, danger: Bool) -> some View {
        Text(text)
            .webText(PhoneType.subheadline(leading: WebTypeRole.subheadline.metrics.size * 1.375))
            .foregroundStyle(C(danger ? FoleviTokens.Chrome.destructive : FoleviTokens.Chrome.inkMuted, scheme))
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 4)
    }

    /// A choice: its name above, what's chosen under it (the web's longer words fit), a menu's chevron.
    private func choiceRow(_ key: String, icon: WebIcon, label: String, value: String, enabled: Bool = true, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                PhoneSheetRowIcon(icon)
                VStack(alignment: .leading, spacing: 0) {
                    Text(label).webText(WebTextStyle(size: WebTypeRole.footnote.metrics.size, leading: 18))
                        .foregroundStyle(C(FoleviTokens.Chrome.inkMuted, scheme))
                    Text(value).webText(PhoneType.body()).lineLimit(2)
                        .foregroundStyle(C(FoleviTokens.Chrome.ink, scheme))
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                if enabled { PhoneSheetChevron(turned: true) }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
            .frame(minHeight: 60)
            .contentShape(Rectangle())
        }
        .buttonStyle(PhoneRowPressStyle())
        .disabled(!enabled || model.running)
        .accessibilityLabel("\(label): \(value)")
        .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { rowFrames[key] = $0 }
    }

    private func toMenu() {
        let current = model.destination
        menus.show(model.destinations.map { d in
            PhoneMenuEntry(.item(d.label, checked: d.value == current, id: "to:\(d.value)")) {
                Task { await model.choose(destination: d.value) }
            }
        }, from: rowFrames["to"] ?? .zero, side: .bottom, align: .end)
    }

    private func whatMenu() {
        let all = model.everything
        menus.show([
            PhoneMenuEntry(.item("Everything in \(model.here)", checked: all, id: "what:all")) { Task { await model.setEverything(true) } },
            PhoneMenuEntry(.item("Folders and notes I pick", checked: !all, id: "what:pick")) { Task { await model.setEverything(false) } },
        ], from: rowFrames["what"] ?? .zero, side: .bottom, align: .end)
    }

    private func howMenu() {
        let copy = model.copy
        menus.show([true, false].map { c in
            PhoneMenuEntry(.item(MovePlacesModel.howLabel(copy: c), checked: c == copy, id: "how:\(c ? "copy" : "move")")) { model.copy = c }
        }, from: rowFrames["how"] ?? .zero, side: .bottom, align: .end)
    }

    /// Copy notes or Move notes: New folder's full-width button (the heading's ink, the canvas's words).
    private var runButton: some View {
        let ink = FoleviTokens.Chrome.ink.resolve(scheme)
        let on = model.canRun
        return Button {
            Task { if await model.run() { close() } }
        } label: {
            ZStack {
                if model.running {
                    ProgressView().tint(C(FoleviTokens.Chrome.canvas, scheme))
                } else {
                    Text(model.actionTitle)
                        .webText(WebTextStyle(size: 17, leading: 22, weight: 600))
                        .foregroundStyle((on ? FoleviTokens.Chrome.canvas : FoleviTokens.Chrome.inkFaint).resolve(scheme).color)
                }
            }
            .frame(maxWidth: .infinity)
            .frame(height: 48)
            .background(RoundedRectangle(cornerRadius: FoleviTokens.Radius.panel, style: .continuous).fill(on || model.running ? FoleviTokens.Chrome.heading.resolve(scheme).color : ink.opacity(0.08).color))
        }
        .buttonStyle(PhoneCardPressStyle())
        .disabled(!on)
    }
}
#endif
