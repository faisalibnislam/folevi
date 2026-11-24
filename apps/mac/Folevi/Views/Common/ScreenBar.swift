// What a screen puts in the window's toolbar, the way Finder and Notes do it: the window is a system split view
// (sidebar and screen) with a unified toolbar, so each screen adds its items to that toolbar. A screen says what it
// needs (`.screenActions`, `.screenLeading`, `.screenSearch`, `.screenSubtitle`, `.screenTitle`) and the system
// draws it: Liquid Glass item groups, the search field at the trailing end, the subtitle under the title.
import AppKit
import FoleviDesign
import SwiftUI

extension View {
    /// The screen's actions in the toolbar's trailing group, after New Note: buttons, menus and choices, grouped
    /// by the system.
    func screenActions<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        let items = content()
        return toolbar { ToolbarItemGroup(placement: .primaryAction) { items } }
    }

    /// Something after Back and Forward (a note's folder).
    func screenLeading<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        let item = content()
        return toolbar { ToolbarItem(placement: .navigation) { item } }
    }

    /// The screen's search field in the toolbar (⌘F, the window's Find, focuses it; Esc clears it).
    func screenSearch(text: Binding<String>, prompt: String) -> some View {
        modifier(ScreenSearch(text: text, prompt: prompt))
    }

    /// The line under the window's title (a count, a date).
    func screenSubtitle(_ subtitle: String) -> some View {
        navigationSubtitle(subtitle)
    }

    /// A title other than the window's.
    func screenTitle(_ title: String) -> some View {
        navigationTitle(title)
    }
}

/// New Note: Folevi's ink pill (black, white in dark mode), the one New Note in the window. It carries its own
/// fill, so the toolbar draws no glass behind it.
struct NewNoteItem: ToolbarContent {
    var body: some ToolbarContent {
        ToolbarItem(placement: .primaryAction) { NewNoteButton() }
            .sharedBackgroundVisibility(.hidden)
    }
}

private struct NewNoteButton: View {
    @Environment(WindowModel.self) private var window

    var body: some View {
        Button {
            NoteActions.newNote(app: .shared, window: window)
        } label: {
            Label { Text("New Note") } icon: { WebIcon.plus.image(size: 14) }
                .labelStyle(.titleAndIcon)
        }
        .buttonStyle(InkPillStyle())
        .help("New Note (⌘N)")
    }
}

private struct ScreenSearch: ViewModifier {
    let text: Binding<String>
    let prompt: String
    @Environment(WindowModel.self) private var window
    @FocusState private var focused: Bool

    func body(content: Content) -> some View {
        content
            .searchable(text: text, placement: .toolbar, prompt: Text(prompt))
            .searchFocused($focused)
            .onChange(of: window.filterFocus) { focused = true }
    }
}

/// One of a few views or filters: the system's segmented control (in the toolbar it takes the toolbar's glass). Each
/// segment shows its symbol (or a short title), with the title as its tooltip and accessibility label.
struct SegmentedChoice<Value: Hashable>: View {
    struct Option {
        let value: Value
        let title: String
        var symbol: String? = nil
    }

    @Binding var selection: Value
    let options: [Option]
    var label = "View"

    var body: some View {
        Picker(selection: Binding(get: { selection }, set: { v in Motion.run(Motion.tap) { selection = v } })) {
            ForEach(options.indices, id: \.self) { i in
                let option = options[i]
                Group {
                    if let symbol = option.symbol {
                        Label { Text(option.title) } icon: { AppIcons.image(symbol) }
                            .labelStyle(.iconOnly)
                    } else {
                        Text(option.title)
                    }
                }
                .help(option.title)
                .accessibilityLabel(option.title)
                .tag(option.value)
            }
        } label: {
            Text(label)
        }
        .pickerStyle(.segmented)
        .labelsHidden()
        .fixedSize()
    }
}

/// A search field inside a pane (a list of its own, such as Foli AI's chats): the system's search field.
struct InlineSearchField: NSViewRepresentable {
    @Binding var text: String
    let prompt: String

    func makeNSView(context: Context) -> NSSearchField {
        let field = NSSearchField()
        field.placeholderString = prompt
        field.delegate = context.coordinator
        field.controlSize = .large
        field.sendsSearchStringImmediately = true
        return field
    }

    func updateNSView(_ field: NSSearchField, context: Context) {
        if field.stringValue != text { field.stringValue = text }
        field.placeholderString = prompt
    }

    func makeCoordinator() -> Coordinator { Coordinator(text: $text) }

    @MainActor final class Coordinator: NSObject, NSSearchFieldDelegate {
        var text: Binding<String>
        init(text: Binding<String>) { self.text = text }

        func controlTextDidChange(_ note: Notification) {
            guard let field = note.object as? NSSearchField else { return }
            text.wrappedValue = field.stringValue
        }
    }
}
