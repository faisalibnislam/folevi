import AppKit
import SwiftUI

/// One occurrence of the find query: the block and the range in its text view.
struct FindMatch: Equatable {
    var blockId: String
    var range: NSRange
}

extension EditorModel {
    /// Replaces the current match and moves on to the next one (the web's `replaceCurrent`). Returns
    /// whether anything changed. Goes through an ordinary edit, so it syncs and ⌘Z undoes it.
    @discardableResult
    func replaceCurrent(with replacement: String) -> Bool {
        guard !isReadOnly, findMatches.indices.contains(findIndex) else {
            NSSound.beep()
            return false
        }
        let match = findMatches[findIndex]
        // Which occurrence in its block this is.
        let skip = findMatches[..<findIndex].filter { $0.blockId == match.blockId }.count
        guard let block = blocks[match.blockId],
              let result = FindReplace.replace(in: block, query: findQuery, with: replacement, limit: 1, skip: skip, caseSensitive: findCaseSensitive) else {
            NSSound.beep()
            return false
        }
        let index = findIndex
        commit(upserts: [result.block], actionName: String(localized: "Replace"))
        // The replaced text is no longer a match, so the same index now holds the next one, unless the
        // replacement itself contains the query.
        let stillMatches = findCaseSensitive ? replacement.contains(findQuery) : replacement.lowercased().contains(findQuery.lowercased())
        findIndex = stillMatches ? index + 1 : index
        updateFind()
        revealMatch()
        return true
    }

    /// Replaces every match in one edit (one Undo step). Returns how many were replaced.
    @discardableResult
    func replaceAll(with replacement: String) -> Int {
        guard !isReadOnly, !findQuery.isEmpty, !findMatches.isEmpty else { return 0 }
        var upserts: [Block] = []
        var count = 0
        var seen = Set<String>()
        for match in findMatches where seen.insert(match.blockId).inserted {
            let limit = findMatches.filter { $0.blockId == match.blockId }.count
            guard let block = blocks[match.blockId],
                  let r = FindReplace.replace(in: block, query: findQuery, with: replacement, limit: limit, caseSensitive: findCaseSensitive) else { continue }
            upserts.append(r.block)
            count += r.count
        }
        guard !upserts.isEmpty else { return 0 }
        commit(upserts: upserts, actionName: String(localized: "Replace All"))
        findIndex = 0
        updateFind()
        return count
    }
}

/// The find & replace bar floating at the top of the note (the web's FindBar): ⌘F finds, ⌘⌥F also
/// replaces. Return / Shift-Return step through matches, Escape closes and selects the current match.
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
        let count = model.findMatches.count
        guard count > 0 else { return String(localized: "No results") }
        return String(localized: "\(model.findIndex + 1) of \(count)") + (count >= 1000 ? "+" : "")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 2) {
                if !model.isReadOnly {
                    IconButton(systemImage: showsReplace ? "chevron.down" : "chevron.right", label: showsReplace ? "Hide replace" : "Show replace", size: 28) {
                        model.findShowsReplace.toggle()
                        focus = model.findShowsReplace ? .replace : .find
                    }
                    .frame(width: 28, height: 32)
                }
                HStack(spacing: 6) {
                    Image(systemName: "magnifyingglass").font(.system(size: 11.5)).foregroundStyle(FoleviColor.inkFaint).accessibilityHidden(true)
                    TextField("Find in note", text: $model.findQuery)
                        .textFieldStyle(.plain)
                        .font(.ui(13))
                        .focused($focus, equals: .find)
                        .onSubmit { model.findNext(backwards: NSEvent.modifierFlags.contains(.shift)) }
                        .accessibilityLabel(Text("Find"))
                        .accessibilityIdentifier("findField")
                }
                .padding(.leading, 10)
                .padding(.trailing, 8)
                .frame(maxWidth: .infinity)
                .frame(height: 32)
                .foleviWell(shape: .rounded(6))
                Text(status)
                    .font(.ui(12).monospacedDigit())
                    .foregroundStyle(FoleviColor.inkMuted)
                    .lineLimit(1)
                    .frame(minWidth: 72, alignment: .trailing)
                    .padding(.horizontal, 6)
                    .accessibilityAddTraits(.updatesFrequently)
                MatchCaseButton(on: $model.findCaseSensitive)
                IconButton(systemImage: "chevron.up", label: "Previous match", shortcutHint: "⇧↩", size: 32) { model.findNext(backwards: true) }
                    .disabled(model.findMatches.isEmpty)
                IconButton(systemImage: "chevron.down", label: "Next match", shortcutHint: "↩", size: 32) { model.findNext() }
                    .disabled(model.findMatches.isEmpty)
                IconButton(systemImage: "xmark", label: "Close find", shortcutHint: "Esc", size: 32) { close() }
            }
            if showsReplace {
                HStack(spacing: 4) {
                    TextField("Replace with", text: $replacement)
                        .textFieldStyle(.plain)
                        .font(.ui(13))
                        .focused($focus, equals: .replace)
                        .onSubmit { model.replaceCurrent(with: replacement) }
                        .padding(.horizontal, 10)
                        .frame(maxWidth: .infinity)
                        .frame(height: 32)
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
                .padding(.leading, 28)
            }
        }
        .padding(6)
        .frame(width: 460)
        .foleviPop(radius: 12)
        .onAppear {
            // Start from the selected words, when a short piece of one line is selected.
            if model.findQuery.isEmpty, let tv = model.focusedTextView {
                let r = tv.selectedRange()
                let text = r.length > 0 ? (tv.string as NSString).substring(with: r) : ""
                if !text.isEmpty, text.count <= 100, !text.contains("\n") { model.findQuery = text }
            }
            focus = showsReplace ? .replace : .find
        }
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
        model.closeFind()
        showFind.wrappedValue = false
    }
}

/// "Match case" (Aa): pressed shows the heading colour filled.
private struct MatchCaseButton: View {
    @Binding var on: Bool
    @State private var hovering = false

    var body: some View {
        Button { on.toggle() } label: {
            Text(verbatim: "Aa")
                .font(.ui(13, .semibold))
                .foregroundStyle(on ? FoleviColor.canvas : hovering ? FoleviColor.heading : FoleviColor.inkMuted)
                .frame(width: 32, height: 32)
                .background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(on ? FoleviColor.heading : hovering ? FoleviColor.accentSoft : .clear))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .help(Text("Match case"))
        .accessibilityLabel(Text("Match case"))
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}
