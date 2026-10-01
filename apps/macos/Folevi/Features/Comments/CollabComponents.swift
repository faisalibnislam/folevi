import AppKit
import SwiftUI

// Small pieces shared by comments, notifications and sharing: avatars, a custom action menu and choice
// button (no OS pop-up menus, as on the web), and the comment field with @mention suggestions.

/// A person's picture, or their initial on a soft disc (the web's Avatar).
struct CollabAvatar: View {
    var name: String
    var url: String?
    var size: CGFloat = 24

    var body: some View {
        Group {
            if let url = url.flatMap(URL.init(string:)) {
                AsyncImage(url: url) { image in image.resizable().scaledToFill() } placeholder: { initial }
            } else {
                initial
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .accessibilityHidden(true)
    }

    private var initial: some View {
        Text(String(name.trimmingCharacters(in: .whitespaces).prefix(1)).uppercased())
            .font(.ui(size * 0.42, .semibold))
            .foregroundStyle(FoleviColor.accentSoftInk)
            .frame(width: size, height: size)
            .background(Circle().fill(FoleviColor.accentSoft))
    }
}

/// One row in a custom menu.
struct CollabMenuItem: Identifiable {
    var id = UUID()
    var title: String
    var systemImage: String?
    var checked = false
    var destructive = false
    var action: () -> Void
}

/// A row of a custom menu (popover), like the sidebar's scope menu.
struct CollabMenuRow: View {
    var item: CollabMenuItem
    var close: () -> Void
    @State private var hover = false

    var body: some View {
        Button {
            close()
            item.action()
        } label: {
            HStack(spacing: 9) {
                if let icon = item.systemImage {
                    Image(systemName: icon).font(.system(size: 12)).frame(width: 16)
                        .foregroundStyle(item.destructive ? FoleviColor.destructive : FoleviColor.inkMuted)
                }
                Text(item.title).font(.ui(13)).foregroundStyle(item.destructive ? FoleviColor.destructive : FoleviColor.ink).lineLimit(1)
                Spacer(minLength: 8)
                if item.checked {
                    Image(systemName: "checkmark").font(.system(size: 11, weight: .semibold)).foregroundStyle(FoleviColor.heading)
                }
            }
            .padding(.horizontal, 8)
            .frame(height: 28)
            .background(hover ? FoleviGlass.hover : .clear, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
        .accessibilityAddTraits(item.checked ? .isSelected : [])
    }
}

/// A list of custom menu rows in a popover.
struct CollabMenuList: View {
    var items: [CollabMenuItem]
    var width: CGFloat = 220
    var close: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            ForEach(items) { CollabMenuRow(item: $0, close: close) }
        }
        .padding(5)
        .frame(width: width)
    }
}

/// "…" (or any icon) that opens a custom menu.
struct CollabMenuButton: View {
    var systemImage = "ellipsis"
    var label: LocalizedStringKey
    var size: CGFloat = 26
    var items: () -> [CollabMenuItem]
    @State private var open = false

    var body: some View {
        IconButton(systemImage: systemImage, label: label, size: size, isActive: open) { open.toggle() }
            .foleviPopover(isPresented: $open, arrowEdge: .bottom) {
                CollabMenuList(items: items()) { open = false }
            }
    }
}

/// A custom "select": the current choice and a chevron; the choices in a popover with a check.
struct CollabChoiceButton<Value: Hashable>: View {
    var options: [(value: Value, title: String)]
    @Binding var selection: Value
    var accessibilityLabel: LocalizedStringKey
    var width: CGFloat? = nil
    var height: CGFloat = 32
    @State private var open = false
    @State private var hover = false

    var body: some View {
        Button { open.toggle() } label: {
            HStack(spacing: 6) {
                Text(options.first { $0.value == selection }?.title ?? "").font(.ui(12.5, .medium)).foregroundStyle(FoleviColor.ink).lineLimit(1)
                Spacer(minLength: 4)
                Image(systemName: "chevron.up.chevron.down").font(.system(size: 9, weight: .semibold)).foregroundStyle(FoleviColor.inkFaint)
            }
            .padding(.horizontal, 11)
            .frame(width: width, height: height)
            .foleviSurface(.color(hover || open ? FoleviColor.surfaceRaised : FoleviColor.surface), shape: .capsule,
                           shadow: FoleviDepth.well + [FoleviShadowLayer(x: 0, y: 0, blur: 0, spread: 1, color: FoleviColor.line, inset: false)])
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
        .fixedSize(horizontal: width == nil, vertical: false)
        .accessibilityLabel(Text(accessibilityLabel))
        .accessibilityValue(Text(options.first { $0.value == selection }?.title ?? ""))
        .foleviPopover(isPresented: $open, arrowEdge: .bottom) {
            CollabMenuList(items: options.map { o in
                CollabMenuItem(title: o.title, checked: o.value == selection) { selection = o.value }
            }, width: max(180, width ?? 0)) { open = false }
        }
    }
}

/// A comment's text with @mentions drawn as soft chips (the web's CommentBody).
func commentBodyText(_ body: [InlineNode]) -> Text {
    var out = AttributedString()
    for node in body {
        switch node {
        case .text(let text, _):
            out += AttributedString(text)
        case .mention(_, let label):
            var m = AttributedString("@" + label)
            m.foregroundColor = FoleviColor.heading
            m.backgroundColor = FoleviColor.accentSoft
            m.font = .ui(13.5, .medium)
            out += m
        case .pageLink(_, let label):
            out += AttributedString(label)
        case .date(let date):
            out += AttributedString(date)
        }
    }
    return Text(out)
}

// MARK: - The comment field

enum MentionCommand { case enter, up, down, tab, escape }

/// A plain multi-line text field (AppKit) that grows with its text, for comments: Enter sends, Shift+Enter
/// adds a line, and ↑ ↓ Tab Esc go to the @mention list while it's open. Reports the caret (UTF-16).
struct MentionTextView: NSViewRepresentable {
    @Binding var text: String
    @Binding var caret: Int
    @Binding var height: CGFloat
    var fontSize: CGFloat = 13.5
    var maxHeight: CGFloat = 160
    /// Focuses the field whenever this changes (and when it appears, with `focusOnAppear`).
    var focusToken: Int
    var focusOnAppear = false
    var accessibilityLabel: String
    var onCommand: (MentionCommand) -> Bool

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeNSView(context: Context) -> NSScrollView {
        let scroll = NSTextView.scrollableTextView()
        scroll.drawsBackground = false
        scroll.hasVerticalScroller = false
        scroll.borderType = .noBorder
        guard let tv = scroll.documentView as? NSTextView else { return scroll }
        tv.delegate = context.coordinator
        tv.isRichText = false
        tv.importsGraphics = false
        tv.allowsUndo = true
        tv.writingToolsBehavior = .none
        tv.drawsBackground = false
        tv.font = FoleviFont.nsFont(.sans, size: fontSize)
        tv.textColor = .foleviInk
        tv.insertionPointColor = .foleviInk
        tv.textContainerInset = NSSize(width: 0, height: 3)
        tv.textContainer?.lineFragmentPadding = 0
        tv.isAutomaticQuoteSubstitutionEnabled = false
        tv.isAutomaticDashSubstitutionEnabled = false
        tv.isAutomaticTextReplacementEnabled = false
        tv.setAccessibilityLabel(accessibilityLabel)
        tv.string = text
        context.coordinator.textView = tv
        DispatchQueue.main.async { context.coordinator.measure() }
        return scroll
    }

    func updateNSView(_ scroll: NSScrollView, context: Context) {
        let c = context.coordinator
        c.parent = self
        guard let tv = c.textView else { return }
        if tv.string != text {
            tv.string = text
            let at = min(caret, (text as NSString).length)
            tv.setSelectedRange(NSRange(location: at, length: 0))
            DispatchQueue.main.async { c.measure() }
        }
        if c.focusToken != focusToken {
            c.focusToken = focusToken
            DispatchQueue.main.async {
                tv.window?.makeFirstResponder(tv)
                tv.setSelectedRange(NSRange(location: (tv.string as NSString).length, length: 0))
            }
        }
    }

    @MainActor
    final class Coordinator: NSObject, NSTextViewDelegate {
        var parent: MentionTextView
        weak var textView: NSTextView?
        var focusToken: Int

        init(_ parent: MentionTextView) {
            self.parent = parent
            focusToken = parent.focusOnAppear ? parent.focusToken - 1 : parent.focusToken
        }

        func measure() {
            guard let tv = textView, let lm = tv.layoutManager, let tc = tv.textContainer else { return }
            lm.ensureLayout(for: tc)
            let line = lm.defaultLineHeight(for: tv.font ?? .systemFont(ofSize: parent.fontSize))
            let used = max(lm.usedRect(for: tc).height, line) + tv.textContainerInset.height * 2
            let h = min(ceil(used), parent.maxHeight)
            (tv.enclosingScrollView)?.hasVerticalScroller = used > parent.maxHeight
            if abs(parent.height - h) > 0.5 { parent.height = h }
        }

        func textDidChange(_ notification: Notification) {
            guard let tv = textView else { return }
            parent.text = tv.string
            parent.caret = tv.selectedRange().location
            measure()
        }

        func textViewDidChangeSelection(_ notification: Notification) {
            guard let tv = textView else { return }
            let at = tv.selectedRange().location
            if parent.caret != at { parent.caret = at }
        }

        /// Comments are at most 5,000 characters (the web field's maxLength).
        func textView(_ textView: NSTextView, shouldChangeTextIn range: NSRange, replacementString: String?) -> Bool {
            guard let replacementString else { return true }
            let length = (textView.string as NSString).length - range.length + (replacementString as NSString).length
            return length <= 5000 || (replacementString as NSString).length <= range.length
        }

        func textView(_ textView: NSTextView, doCommandBy selector: Selector) -> Bool {
            switch selector {
            case #selector(NSResponder.insertNewline(_:)):
                let flags = NSApp.currentEvent?.modifierFlags ?? []
                if flags.contains(.shift) && !flags.contains(.command) { return false }
                _ = parent.onCommand(.enter)
                return true
            case #selector(NSResponder.moveUp(_:)): return parent.onCommand(.up)
            case #selector(NSResponder.moveDown(_:)): return parent.onCommand(.down)
            case #selector(NSResponder.insertTab(_:)): return parent.onCommand(.tab)
            case #selector(NSResponder.cancelOperation(_:)): return parent.onCommand(.escape)
            default: return false
            }
        }
    }
}

/// The comment field with its @mention suggestions under it (people who can see the page).
struct MentionField: View {
    @Binding var text: String
    @Binding var picked: [MentionPerson]
    var people: [MentionPerson]
    var placeholder: String
    var accessibilityLabel: String
    var focusToken: Int
    var focusOnAppear = false
    var fontSize: CGFloat = 13.5
    var onSubmit: () -> Void
    var onEscape: (() -> Void)?

    @State private var caret = 0
    @State private var height: CGFloat = 22
    @State private var active = 0
    @State private var closedAt: Int?

    private var query: (start: Int, query: String)? { CommentText.mentionQuery(in: text, caret: caret) }
    private var matches: [MentionPerson] { query.map { CommentText.matches($0.query, in: people) } ?? [] }
    private var listOpen: Bool { !matches.isEmpty && closedAt != query?.start }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            MentionTextView(text: $text, caret: $caret, height: $height, fontSize: fontSize, focusToken: focusToken,
                            focusOnAppear: focusOnAppear, accessibilityLabel: accessibilityLabel, onCommand: command)
                .frame(height: height)
                .overlay(alignment: .topLeading) {
                    if text.isEmpty {
                        Text(placeholder).font(.ui(fontSize)).foregroundStyle(FoleviColor.inkFaint)
                            .padding(.top, 3).allowsHitTesting(false).accessibilityHidden(true)
                    }
                }
            if listOpen {
                VStack(alignment: .leading, spacing: 1) {
                    ForEach(Array(matches.enumerated()), id: \.element.id) { i, p in
                        let current = i == min(active, matches.count - 1)
                        Button { choose(p) } label: {
                            HStack(spacing: 8) {
                                Text(String(p.displayName.prefix(1)).uppercased())
                                    .font(.ui(11, .semibold))
                                    .foregroundStyle(FoleviColor.heading)
                                    .frame(width: 24, height: 24)
                                    .background(Circle().fill(FoleviColor.surfaceSunken))
                                    .accessibilityHidden(true)
                                Text(p.displayName).font(.ui(14)).foregroundStyle(current ? FoleviColor.heading : FoleviColor.ink).lineLimit(1)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                if p.isYou == true {
                                    Text("you").font(.ui(12)).foregroundStyle(FoleviColor.inkFaint)
                                } else if p.guest == true {
                                    Text("guest").font(.ui(12)).foregroundStyle(FoleviColor.inkFaint)
                                }
                            }
                            .padding(.horizontal, 8)
                            .padding(.vertical, 6)
                            .background(current ? FoleviColor.accentSoft : .clear, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .onHover { if $0 { active = i } }
                        .accessibilityAddTraits(current ? .isSelected : [])
                    }
                }
                .padding(6)
                .foleviPop(radius: 14)
                .accessibilityElement(children: .contain)
                .accessibilityLabel(Text("People to mention"))
            }
        }
        .onChange(of: query?.query) { _, _ in active = 0 }
    }

    private func command(_ c: MentionCommand) -> Bool {
        if listOpen {
            switch c {
            case .up: active = (active - 1 + matches.count) % matches.count; return true
            case .down: active = (active + 1) % matches.count; return true
            case .enter, .tab: choose(matches[min(active, matches.count - 1)]); return true
            case .escape: closedAt = query?.start; return true
            }
        }
        switch c {
        case .enter: onSubmit(); return true
        case .escape:
            guard let onEscape else { return false }
            onEscape()
            return true
        default: return false
        }
    }

    private func choose(_ p: MentionPerson) {
        guard let q = query else { return }
        let next = CommentText.insertMention(p.displayName, into: text, start: q.start, caret: caret)
        picked = picked.filter { $0.profileId != p.profileId } + [p]
        caret = next.caret
        text = next.text
    }
}
