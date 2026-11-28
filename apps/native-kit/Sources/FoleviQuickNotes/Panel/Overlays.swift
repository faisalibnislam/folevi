import FoleviDesign
import SwiftUI

/// Card container used by all in-panel overlays (rename, link, confirmations, sync, shortcuts).
struct OverlayCard<Content: View>: View {
    @Environment(AppModel.self) private var model
    var width: CGFloat = 280
    @ViewBuilder var content: Content

    var body: some View {
        ZStack {
            Color.black.opacity(0.18)
                .contentShape(Rectangle())
                .onTapGesture { Motion.animate(Motion.fade) { model.overlay = nil } }
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 12) { content }
                .padding(16)
                .frame(maxWidth: width)
                .quickGlass(in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                .padding(16)
                .onKeyPress(.escape) {
                    Motion.animate(Motion.fade) { model.overlay = nil }
                    model.editor.focusEditor()
                    return .handled
                }
        }
    }
}

struct RenameOverlay: View {
    @Environment(AppModel.self) private var model
    let dotID: UUID
    @State private var name = ""
    @FocusState private var focused: Bool

    var body: some View {
        OverlayCard {
            Text("Rename Quick Note").font(QNStyle.title)
            TextField("Name", text: $name, prompt: Text("Untitled"))
                .textFieldStyle(.roundedBorder)
                .focused($focused)
                .onSubmit(save)
            HStack {
                Spacer()
                Button("Cancel") { close() }.buttonStyle(.glass).keyboardShortcut(.cancelAction)
                Button("Rename", action: save).buttonStyle(.glassProminent).keyboardShortcut(.defaultAction)
            }
        }
        .onAppear {
            name = model.dots.first { $0.id == dotID }?.name ?? ""
            focused = true
        }
    }

    private func save() {
        model.renameDot(dotID, to: name)
        close()
    }

    private func close() {
        Motion.animate(Motion.fade) { model.overlay = nil }
        model.editor.focusEditor()
    }
}

struct LinkOverlay: View {
    @Environment(AppModel.self) private var model
    let request: LinkRequest
    @State private var url = ""
    @State private var text = ""
    @FocusState private var focused: Bool

    var body: some View {
        OverlayCard(width: 320) {
            Text(request.url.isEmpty ? "Add Link" : "Edit Link").font(QNStyle.title)
            TextField("Text", text: $text).textFieldStyle(.roundedBorder)
            TextField("URL", text: $url, prompt: Text(verbatim: "https://"))
                .textFieldStyle(.roundedBorder)
                .focused($focused)
                .onSubmit { model.applyLink(req, url: url) }
            HStack {
                if !request.url.isEmpty {
                    Button("Remove Link", role: .destructive) { model.applyLink(req, url: nil) }
                        .buttonStyle(.glass)
                }
                Spacer()
                Button("Cancel") {
                    Motion.animate(Motion.fade) { model.overlay = nil }
                    model.editor.focusEditor()
                }
                .buttonStyle(.glass).keyboardShortcut(.cancelAction)
                Button("Apply") { model.applyLink(req, url: url) }
                    .buttonStyle(.glassProminent).keyboardShortcut(.defaultAction)
                    .disabled(url.trimmingCharacters(in: .whitespaces).isEmpty || text.isEmpty)
            }
        }
        .onAppear {
            url = request.url
            text = request.text
            focused = true
        }
    }

    private var req: LinkRequest { var r = request; r.text = text; return r }
}

struct ConfirmOverlay: View {
    @Environment(AppModel.self) private var model
    let title: String
    let message: String
    let confirmTitle: String
    let action: () -> Void

    var body: some View {
        OverlayCard {
            Text(title).font(QNStyle.title)
            Text(message).font(QNStyle.label).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            HStack {
                Spacer()
                Button("Cancel") { Motion.animate(Motion.fade) { model.overlay = nil } }
                    .buttonStyle(.glass).keyboardShortcut(.cancelAction)
                Button(confirmTitle, role: .destructive, action: action)
                    .buttonStyle(.glassProminent).tint(.red).keyboardShortcut(.defaultAction)
            }
        }
    }
}

/// ⌘/, every shortcut, grouped. Also shown in the menus.
struct CheatSheetOverlay: View {
    @Environment(AppModel.self) private var model

    static let groups: [(String, [(String, String)])] = [
        ("Quick notes", [
            ("Show or hide", "⌥Space"), ("Hide", "Esc"), ("Save to note", "⌘S"),
            ("Pin on top", "⇧⌘P"), ("Open as a window, or back", "⌥⌘D"), ("Keyboard shortcuts", "⌘/"),
        ]),
        ("Notes", [
            ("Go to note 1 to 9", "⌘1 to ⌘9"), ("Previous or next", "⌘[  ⌘]"), ("Previous or next", "⌃⇧⇥  ⌃⇥"),
            ("Move left or right", "⌥⌘[  ⌥⌘]"), ("New quick note", "⌘N"), ("Rename", "⌘R"),
            ("Delete", "⌘⌫"), ("Clear text", "⌥⌘⌫"),
        ]),
        ("Formatting", [
            ("Rich text or Markdown", "⇧⌘T"), ("Bold", "⌘B"), ("Italic", "⌘I"), ("Underline", "⌘U"),
            ("Strikethrough", "⇧⌘X"), ("Link", "⌘K"), ("Checkbox", "⇧⌘L"), ("Divider", "⇧⌘-"),
            ("Indent or outdent", "⇥  ⇧⇥"), ("Bigger, smaller, actual size", "⌘+  ⌘-  ⌘0"),
        ]),
        ("Capture", [("Screenshot into this note", "⇧⌘5"), ("Copy as Markdown", "⇧⌘C")]),
    ]

    var body: some View {
        OverlayCard(width: 520) {
            HStack {
                Text("Keyboard Shortcuts").font(QNStyle.title)
                Spacer()
                Button {
                    Motion.animate(Motion.fade) { model.overlay = nil }
                } label: { QNIcon(.x, size: 14).frame(width: 14, height: 14) }
                .buttonStyle(.glass).buttonBorderShape(.circle).controlSize(.small)
                .keyboardShortcut(.cancelAction)
                .accessibilityLabel("Close")
            }
            ScrollView {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 210), alignment: .top)], alignment: .leading, spacing: 14) {
                    ForEach(Self.groups, id: \.0) { group in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(group.0).font(QNStyle.font(.caps)).foregroundStyle(.secondary).textCase(.uppercase)
                            ForEach(Array(group.1.enumerated()), id: \.offset) { _, row in
                                HStack {
                                    Text(row.0).font(QNStyle.label)
                                    Spacer(minLength: 8)
                                    Text(row.1 == "⌥Space" ? (model.host?.shortcutLabel ?? "Off") : row.1)
                                        .font(QNStyle.label)
                                        .foregroundStyle(.secondary)
                                }
                                .accessibilityElement(children: .combine)
                            }
                        }
                    }
                }
            }
            .frame(maxHeight: 420)
        }
    }
}
