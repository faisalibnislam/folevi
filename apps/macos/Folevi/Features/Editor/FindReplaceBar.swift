import SwiftUI

/// One occurrence of the find query: its block and where it is in the block's text.
struct FindHit: Equatable {
    var blockId: String
    var range: NSRange
}

extension EditorModel {
    /// Replaces the current match and moves on to the next one. Returns whether anything changed. Goes
    /// through an ordinary edit, so it syncs and ⌘Z undoes it.
    @discardableResult
    func replaceCurrent(with replacement: String) -> Bool {
        guard !isReadOnly, findHits.indices.contains(findIndex) else { return false }
        let hit = findHits[findIndex]
        // Which of this block's occurrences it is.
        let skip = findHits[..<findIndex].filter { $0.blockId == hit.blockId }.count
        guard let block = blocks[hit.blockId],
              let result = FindReplace.replace(in: block, query: findQuery, with: replacement, limit: 1, caseSensitive: findCaseSensitive, skip: skip) else {
            return false
        }
        let index = findIndex
        commit(upserts: [result.block], actionName: String(localized: "Replace"))
        updateFind()
        // The replaced text is no longer a match, so the same index is now the next one, unless the
        // replacement itself contains the query: then step past it.
        let stillMatches = !FindReplace.ranges(of: findQuery, in: replacement, caseSensitive: findCaseSensitive).isEmpty
        if !findHits.isEmpty {
            let n = findHits.count
            findIndex = ((stillMatches ? index + 1 : index) % n + n) % n
            revealMatch()
        }
        return true
    }

    /// Replaces every match in one edit (one Undo step). Returns how many were replaced.
    @discardableResult
    func replaceAll(with replacement: String) -> Int {
        guard !isReadOnly, !findQuery.isEmpty, !findHits.isEmpty else { return 0 }
        var upserts: [Block] = []
        var count = 0
        for id in findMatches {
            guard let block = blocks[id],
                  let r = FindReplace.replace(in: block, query: findQuery, with: replacement, caseSensitive: findCaseSensitive) else { continue }
            upserts.append(r.block)
            count += r.count
        }
        guard !upserts.isEmpty else { return 0 }
        commit(upserts: upserts, actionName: String(localized: "Replace All"))
        findIndex = 0
        updateFind()
        return count
    }

    /// The find bar's starting text: the selected words, when a short piece of one line is selected.
    var findSeed: String? {
        guard let id = focusedBlockId, let tv = textView(id) else { return nil }
        let r = tv.selectedRange()
        guard r.length > 0 else { return nil }
        let text = (tv.string as NSString).substring(with: r)
        return text.count <= 100 && !text.contains("\n") ? text : nil
    }
}

/// The find & replace bar floating at the top right of the note (the web's FindBar): ⌘F finds, ⌘⌥F or the
/// page menu also replaces. Return / Shift-Return step through matches, Escape closes and puts the cursor
/// on the current match.
struct FindReplaceBar: View {
    @Bindable var model: EditorModel
    var showFind: Binding<Bool>
    @Environment(AppModel.self) private var app
    @Environment(\.undoManager) private var undoManager
    @State private var replacement = ""
    @FocusState private var focus: Field?

    private enum Field { case find, replace }

    private var showsReplace: Bool { model.findShowsReplace && !model.isReadOnly }

    private var count: Int { model.findHits.count }

    private var status: String {
        guard !model.findQuery.isEmpty else { return "" }
        guard count > 0 else { return String(localized: "No results") }
        let total = count >= FindReplace.maxMatches ? "\(count)+" : "\(count)"
        return String(localized: "\(model.findIndex + 1) of \(total)")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 2) {
                if !model.isReadOnly {
                    PageIconButton(systemImage: showsReplace ? "chevron.down" : "chevron.right",
                                   label: showsReplace ? String(localized: "Hide replace") : String(localized: "Show replace"),
                                   size: 32, width: 28, iconSize: 12) {
                        model.findShowsReplace.toggle()
                    }
                    .accessibilityValue(Text(showsReplace ? "Expanded" : "Collapsed"))
                }
                HStack(spacing: 7) {
                    Image(systemName: "magnifyingglass").font(.system(size: 11.5, weight: .medium)).foregroundStyle(FoleviColor.inkFaint)
                        .accessibilityHidden(true)
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
                .frame(height: 32)
                .frame(maxWidth: .infinity)
                .pageInput(focused: focus == .find)
                Text(status)
                    .font(.ui(12).monospacedDigit())
                    .foregroundStyle(FoleviColor.inkMuted)
                    .lineLimit(1)
                    .frame(minWidth: 72, alignment: .trailing)
                    .padding(.horizontal, 6)
                    .accessibilityAddTraits(.updatesFrequently)
                PageIconButton(systemImage: "textformat", label: String(localized: "Match case"), size: 32, iconSize: 13, isOn: model.findCaseSensitive) {
                    model.findCaseSensitive.toggle()
                }
                PageIconButton(systemImage: "chevron.up", label: String(localized: "Previous match"), shortcut: "Shift+Enter", size: 32) {
                    model.findNext(backwards: true)
                }
                .disabled(count == 0)
                PageIconButton(systemImage: "chevron.down", label: String(localized: "Next match"), shortcut: "Enter", size: 32) {
                    model.findNext()
                }
                .disabled(count == 0)
                PageIconButton(systemImage: "xmark", label: String(localized: "Close find"), shortcut: "Esc", size: 32) { close() }
            }
            if showsReplace {
                HStack(spacing: 4) {
                    TextField("Replace with", text: $replacement)
                        .textFieldStyle(.plain)
                        .font(.ui(13))
                        .focused($focus, equals: .replace)
                        .onSubmit { model.replaceCurrent(with: replacement) }
                        .accessibilityLabel(Text("Replace with"))
                        .padding(.horizontal, 10)
                        .frame(height: 32)
                        .frame(maxWidth: .infinity)
                        .pageInput(focused: focus == .replace)
                    Button("Replace") {
                        model.replaceCurrent(with: replacement)
                        // The last match gone disables this button; keep the keyboard in the bar.
                        if count == 0 { focus = .find }
                    }
                    .buttonStyle(.page(.secondary, .sm))
                    .disabled(count == 0)
                    Button("Replace all") { replaceAll() }
                        .buttonStyle(.page(.secondary, .sm))
                        .disabled(count == 0)
                }
                .padding(.leading, 30)
            }
        }
        .padding(6)
        .frame(maxWidth: 460)
        .foleviGlassPop(radius: 12)
        .onAppear {
            if model.findQuery.isEmpty, let seed = model.findSeed { model.findQuery = seed }
            takeFocus()
        }
        .onChange(of: model.page.findFocusToken) { _, _ in takeFocus() }
        .onChange(of: model.findShowsReplace) { _, on in focus = on && !model.isReadOnly ? .replace : .find }
        .onExitCommand { close() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Find in note"))
    }

    private func takeFocus() {
        if let window = NSApp.keyWindow, window.firstResponder is BlockTextView {
            window.makeFirstResponder(nil)
        }
        Task { @MainActor in
            focus = showsReplace ? .replace : .find
            try? await Task.sleep(for: .milliseconds(60))
            focus = showsReplace ? .replace : .find
        }
    }

    private func replaceAll() {
        let n = model.replaceAll(with: replacement)
        focus = .find
        guard n > 0 else { return }
        let undo = undoManager
        app.showToast(n == 1 ? String(localized: "Replaced 1 match") : String(localized: "Replaced \(n.formatted()) matches"),
                      action: .undo { undo?.undo() })
    }

    /// Back to the note, with the current match selected.
    private func close() {
        model.selectCurrentMatch()
        model.findQuery = ""
        model.findShowsReplace = false
        showFind.wrappedValue = false
    }
}
