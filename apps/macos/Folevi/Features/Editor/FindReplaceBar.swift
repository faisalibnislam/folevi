import SwiftUI

extension EditorModel {
    /// Replaces the current match (the first occurrence in the current matching block). Returns whether
    /// anything changed. Goes through an ordinary edit, so it syncs and ⌘Z undoes it.
    @discardableResult
    func replaceCurrent(with replacement: String) -> Bool {
        guard !isReadOnly, findMatches.indices.contains(findIndex), let block = blocks[findMatches[findIndex]],
              let result = FindReplace.replace(in: block, query: findQuery, with: replacement, limit: 1) else {
            NSSound.beep()
            return false
        }
        let index = findIndex
        commit(upserts: [result.block], actionName: String(localized: "Replace"))
        updateFind()
        // The replaced text is no longer a match, so the same place now holds the next one.
        if !findMatches.isEmpty {
            findIndex = min(index, findMatches.count - 1)
            revealMatch()
        }
        return true
    }

    /// Replaces every match in one edit (one Undo step). Returns how many were replaced.
    @discardableResult
    func replaceAll(with replacement: String) -> Int {
        guard !isReadOnly, !findQuery.isEmpty else { return 0 }
        var upserts: [Block] = []
        var count = 0
        for id in findMatches {
            guard let block = blocks[id], let r = FindReplace.replace(in: block, query: findQuery, with: replacement) else { continue }
            upserts.append(r.block)
            count += r.count
        }
        guard !upserts.isEmpty else { return 0 }
        commit(upserts: upserts, actionName: String(localized: "Replace All"))
        updateFind()
        return count
    }
}

/// The find & replace bar floating at the top of the note (the web's FindBar): ⌘F finds, ⌘⌥F also
/// replaces. Return / Shift-Return step through matches, Escape closes.
struct FindReplaceBar: View {
    @Bindable var model: EditorModel
    var showFind: Binding<Bool>
    @Environment(AppModel.self) private var app
    @Environment(\.undoManager) private var undoManager
    @State private var replacement = ""
    @FocusState private var focus: Field?

    private enum Field { case find, replace }

    private var showsReplace: Bool { model.findShowsReplace && !model.isReadOnly }

    private var status: String {
        guard !model.findQuery.isEmpty else { return "" }
        return model.findMatches.isEmpty ? String(localized: "No results") : String(localized: "\(model.findIndex + 1) of \(model.findMatches.count)")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 4) {
                if !model.isReadOnly {
                    IconButton(systemImage: showsReplace ? "chevron.down" : "chevron.right", label: showsReplace ? "Hide replace" : "Show replace", size: 26) {
                        model.findShowsReplace.toggle()
                        focus = model.findShowsReplace ? .replace : .find
                    }
                }
                HStack(spacing: 6) {
                    Image(systemName: "magnifyingglass").font(.system(size: 11.5)).foregroundStyle(FoleviColor.inkFaint).accessibilityHidden(true)
                    TextField("Find in note", text: $model.findQuery)
                        .textFieldStyle(.plain)
                        .font(.ui(13))
                        .focused($focus, equals: .find)
                        .onSubmit { model.findNext(backwards: NSEvent.modifierFlags.contains(.shift)) }
                        .accessibilityIdentifier("findField")
                }
                .padding(.horizontal, 10)
                .frame(width: 220, height: 30)
                .foleviWell(shape: .rounded(6))
                Text(status)
                    .font(.ui(12).monospacedDigit())
                    .foregroundStyle(FoleviColor.inkMuted)
                    .frame(minWidth: 64, alignment: .trailing)
                    .accessibilityAddTraits(.updatesFrequently)
                IconButton(systemImage: "chevron.up", label: "Previous match", shortcutHint: "⇧↩", size: 28) { model.findNext(backwards: true) }
                    .disabled(model.findMatches.isEmpty)
                IconButton(systemImage: "chevron.down", label: "Next match", shortcutHint: "↩", size: 28) { model.findNext() }
                    .disabled(model.findMatches.isEmpty)
                IconButton(systemImage: "xmark", label: "Close find", shortcutHint: "Esc", size: 28) { close() }
            }
            if showsReplace {
                HStack(spacing: 6) {
                    TextField("Replace with", text: $replacement)
                        .textFieldStyle(.plain)
                        .font(.ui(13))
                        .focused($focus, equals: .replace)
                        .onSubmit { model.replaceCurrent(with: replacement) }
                        .padding(.horizontal, 10)
                        .frame(width: 220, height: 30)
                        .foleviWell(shape: .rounded(6))
                    Button("Replace") {
                        model.replaceCurrent(with: replacement)
                        if model.findMatches.isEmpty { focus = .find }
                    }
                    .buttonStyle(.folevi(.secondary, .small))
                    .disabled(model.findMatches.isEmpty)
                    Button("Replace all") { replaceAll() }
                        .buttonStyle(.folevi(.secondary, .small))
                        .disabled(model.findMatches.isEmpty)
                }
                .padding(.leading, 30)
            }
        }
        .padding(6)
        .foleviPop(radius: 12)
        .onAppear { focus = showsReplace ? .replace : .find }
        .onChange(of: model.findShowsReplace) { _, on in focus = on && !model.isReadOnly ? .replace : .find }
        .onExitCommand { close() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Find in note"))
    }

    private func replaceAll() {
        let n = model.replaceAll(with: replacement)
        focus = .find
        guard n > 0 else { return }
        let undo = undoManager
        app.showToast(n == 1 ? String(localized: "Replaced 1 match") : String(localized: "Replaced \(n.formatted()) matches"),
                      action: .undo { undo?.undo() })
    }

    private func close() {
        model.findQuery = ""
        model.findShowsReplace = false
        showFind.wrappedValue = false
    }
}
