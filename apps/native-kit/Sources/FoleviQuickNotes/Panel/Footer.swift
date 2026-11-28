// The panel's bottom bar: where "Save to note" will put this quick note (always in sight, picked from a menu,
// remembered), the word count, and the Save to note button. Then the toast and the dot's hover card.
import AppKit
import FoleviDesign
import SwiftUI

struct FooterBar: View {
    @Environment(QuickNotesModel.self) private var model
    @State private var anchor = MenuAnchor()
    @State private var hoveringDestination = false

    var body: some View {
        let destination = model.destination
        HStack(spacing: 6) {
            Button {
                anchor.pop(model.destinationMenu(), below: false)
            } label: {
                HStack(spacing: 5) {
                    QNIcon(destination.folderId == nil ? .inbox : .folder, size: 14)
                    Text(destination.label)
                        .font(QNStyle.label)
                        .lineLimit(1)
                        .truncationMode(.middle)
                    QNIcon(.chevronsUpDown, size: 12).foregroundStyle(.tertiary)
                }
                .padding(.horizontal, 8)
                .frame(height: 26)
                .background(Capsule().fill(Color.primary.opacity(hoveringDestination ? 0.07 : 0)))
                .contentShape(Capsule())
            }
            .buttonStyle(.plain)
            .foregroundStyle(.secondary)
            .onHover { hoveringDestination = $0 }
            .background(MenuAnchorView(anchor: anchor))
            .help("Where Save to note puts this quick note. Click to choose.")
            .accessibilityLabel("Saves to \(destination.spaceName), \(destination.folderName ?? "Drafts")")
            .accessibilityHint("Opens a menu of workspaces and folders.")
            .layoutPriority(1)
            Spacer(minLength: 4)
            ViewThatFits(in: .horizontal) {
                Text(countsText).font(QNStyle.meta).monospacedDigit().foregroundStyle(.tertiary).lineLimit(1)
                Color.clear.frame(width: 0, height: 0)
            }
            .accessibilityLabel(countsText)
            SaveButton()
        }
        .padding(.leading, 4)
        .padding(.trailing, 3)
        .frame(height: 32)
        .quickGlass(in: Capsule())
    }

    private var countsText: String {
        let words = model.counts.words
        if let sw = model.counts.selectionWords { return "\(sw) of \(words) words" }
        return words == 1 ? "1 word" : "\(words) words"
    }
}

/// "Save to note" (⌘S): a new Folevi note from this quick note, which then empties (with Undo).
struct SaveButton: View {
    @Environment(QuickNotesModel.self) private var model

    var body: some View {
        let empty = model.activeDot?.isEmpty ?? true
        Button {
            model.saveToNote()
        } label: {
            HStack(spacing: 5) {
                if model.saving {
                    ProgressView().controlSize(.mini).tint(.white)
                } else {
                    QNIcon(.fileUp, size: 14)
                }
                Text("Save to note").font(QNStyle.labelStrong).lineLimit(1)
            }
        }
        .buttonStyle(SaveButtonStyle())
        .disabled(empty || model.saving)
        .help("Save to note (⌘S): a new note in \(model.destination.label), then this quick note empties")
        .accessibilityLabel(model.saving ? "Saving" : "Save to note in \(model.destination.label)")
    }
}

/// Folevi's primary button: the accent filled capsule, white label, a lighter fill on hover, dimmed when there's
/// nothing to save. Solid, so it reads the same over glass, under Reduce Transparency and in both appearances.
struct SaveButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var enabled
    @Environment(\.colorSchemeContrast) private var contrast
    @State private var hovering = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .foregroundStyle(.white)
            .padding(.horizontal, 11)
            .frame(height: 26)
            .background(Capsule().fill(Color.accentColor.opacity(enabled ? (configuration.isPressed ? 0.8 : 1) : 0.4)))
            .overlay {
                if hovering && enabled { Capsule().fill(Color.white.opacity(0.12)) }
                if contrast == .increased { Capsule().strokeBorder(Color.primary.opacity(0.6), lineWidth: 1) }
            }
            .contentShape(Capsule())
            .scaleEffect(configuration.isPressed && Motion.isEnabled ? 0.97 : 1)
            .animation(Motion.quick, value: configuration.isPressed)
            .onHover { hovering = $0 }
    }
}

struct ToastView: View {
    @Environment(QuickNotesModel.self) private var model
    let toast: Toast

    var body: some View {
        HStack(spacing: 10) {
            if let symbol = toast.symbol {
                Image(systemName: symbol).font(.system(size: 12, weight: .regular)).foregroundStyle(.secondary)
            }
            Text(toast.message)
                .font(QNStyle.label)
                .lineLimit(3)
                .fixedSize(horizontal: false, vertical: true)
            ForEach(toast.actions) { action in
                Button(action.title) { model.performToastAction(action) }
                    .font(QNStyle.labelStrong)
                    .buttonStyle(.glass)
                    .controlSize(.small)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .quickGlass(in: Capsule())
        .onTapGesture { if toast.actions.isEmpty { model.dismissToast() } }
        .accessibilityElement(children: .contain)
    }
}

/// The card shown after resting on a dot: its name, words and when it was last edited.
struct DotHoverCard: View {
    let dot: DotState

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Circle().fill(dot.color).frame(width: 8, height: 8)
                Text(dot.displayName).font(QNStyle.labelStrong)
            }
            Group {
                Text(dot.isEmpty ? "Empty" : (dot.wordCount == 1 ? "1 word" : "\(dot.wordCount) words"))
                Text("Edited \(dot.updatedAt.formatted(.relative(presentation: .named)))")
            }
            .font(QNStyle.meta)
            .foregroundStyle(.secondary)
        }
        .padding(10)
        .fixedSize()
        .quickGlass(in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}
