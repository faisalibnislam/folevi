import AppKit
import SwiftUI

// Pieces the browse views share, ported from the web's views (ViewChrome's row, FolderBadge, UnsyncedMarker,
// the Sort select, the layout radio group, the search field and the "…" buttons).

/// The row above a list view (the web's ViewChrome without a title bar): the view's facts on the left
/// (announced when they change) and its actions on the right. The page's name is in the tab and top bar.
struct ViewBar<Actions: View>: View {
    var subtitle: String?
    var statusIdentifier: String?
    @ViewBuilder var actions: Actions

    var body: some View {
        HStack(spacing: 8) {
            if let subtitle {
                Text(subtitle)
                    .font(.ui(13))
                    .foregroundStyle(FoleviColor.inkMuted)
                    .lineLimit(1)
                    .accessibilityAddTraits(.updatesFrequently)
                    .accessibilityIdentifier(statusIdentifier ?? "view.subtitle")
            }
            Spacer(minLength: 8)
            HStack(spacing: 6) { actions }
        }
        .frame(minHeight: 44)
        .padding(.horizontal, 28)
    }
}

/// Where a page lives (the web's FolderBadge): its folder, with a check, or "Draft".
struct FolderBadge: View {
    var folder: FolderInfo?

    var body: some View {
        Group {
            if let folder {
                HStack(spacing: 4) {
                    Image(systemName: "checkmark").font(.system(size: 9, weight: .bold)).accessibilityHidden(true)
                    FolderGlyph(color: folder.color, size: 13)
                    Text(folder.name).lineLimit(1)
                }
                .foregroundStyle(FoleviColor.mossInk)
                .padding(.horizontal, 8)
                .padding(.vertical, 2)
                .background(FoleviColor.mossSoft, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                .help(Text("In folder “\(folder.name)”"))
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(Text("In folder \(folder.name)"))
            } else {
                HStack(spacing: 4) {
                    Image(systemName: "pencil.line").font(.system(size: 10)).accessibilityHidden(true)
                    Text("Draft")
                }
                .foregroundStyle(FoleviColor.inkMuted)
                .padding(.horizontal, 8)
                .padding(.vertical, 2)
                .background(FoleviColor.surfaceSunken, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                .help(Text("Not in a folder yet"))
            }
        }
        .font(.ui(11, .medium))
        .fixedSize(horizontal: false, vertical: true)
    }
}

/// Marks a page with edits on this Mac the server hasn't confirmed yet.
struct UnsyncedMarker: View {
    var size: CGFloat = 11

    var body: some View {
        HStack(spacing: size * 0.36) {
            Circle().fill(FoleviColor.heading).frame(width: size * 0.55, height: size * 0.55).accessibilityHidden(true)
            Text("Not synced")
        }
        .font(.ui(size, .medium))
        .foregroundStyle(FoleviColor.heading)
        .lineLimit(1)
        .help(Text("Changes on this device haven’t synced yet"))
    }
}

/// "Sort" and its select (the web's labelled Select).
struct SortField<Value: Hashable>: View {
    @Binding var selection: Value
    var options: [FoleviSelect<Value>.Option]
    var height: CGFloat = 32

    var body: some View {
        HStack(spacing: 8) {
            Text("Sort").font(.ui(13)).foregroundStyle(FoleviColor.inkMuted).accessibilityHidden(true)
            FoleviSelect(selection: $selection, options: options, accessibilityLabel: String(localized: "Sort"), height: height)
        }
    }
}

/// An icon radio group in a well (the web's Grid / Compact cards / List switch).
struct IconRadioGroup<Value: Hashable>: View {
    struct Item: Identifiable {
        var value: Value
        var label: String
        var systemImage: String
        var id: Value { value }
    }

    @Binding var selection: Value
    var items: [Item]
    var accessibilityLabel: String

    var body: some View {
        HStack(spacing: 0) {
            ForEach(items) { item in
                let on = item.value == selection
                Button { selection = item.value } label: {
                    Image(systemName: item.systemImage)
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(on ? FoleviColor.heading : FoleviColor.inkMuted)
                        .frame(width: 36, height: 28)
                        .background {
                            if on { Color.clear.foleviSurface(.color(FoleviColor.surfaceRaised), shape: .rounded(6), shadow: FoleviShadow.control) }
                        }
                        .contentShape(Rectangle())
                }
                .buttonStyle(HoverHeadingStyle())
                .help(Text(item.label))
                .accessibilityLabel(Text(item.label))
                .accessibilityAddTraits(on ? [.isSelected] : [])
            }
        }
        .padding(2)
        .foleviWell(shape: .rounded(6))
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(accessibilityLabel))
    }
}

/// Muted until hovered, then heading (the web's `text-muted hover:text-heading`).
struct HoverHeadingStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        HoverHeadingBody(configuration: configuration)
    }

    private struct HoverHeadingBody: View {
        let configuration: ButtonStyle.Configuration
        @State private var hovering = false
        var body: some View {
            configuration.label
                .brightness(hovering ? -0.05 : 0)
                .onHover { hovering = $0 }
        }
    }
}

/// A search field with a clear button (the web's Folders and Tags pages).
struct BrowseSearchField: View {
    @Binding var text: String
    var placeholder: String

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "magnifyingglass").font(.system(size: 12)).foregroundStyle(FoleviColor.inkFaint).accessibilityHidden(true)
            TextField(placeholder, text: $text)
                .textFieldStyle(.plain)
                .font(.ui(13))
                .accessibilityLabel(Text(placeholder))
            if !text.isEmpty {
                Button { text = "" } label: {
                    Image(systemName: "xmark").font(.system(size: 10, weight: .semibold)).foregroundStyle(FoleviColor.inkFaint)
                        .frame(width: 24, height: 24).contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("Clear search"))
            }
        }
        .padding(.leading, 12)
        .padding(.trailing, 6)
        .frame(height: 36)
        .frame(maxWidth: 384)
        .foleviWell(shape: .rounded(6))
    }
}

/// The "…" button over a card or at the end of a row: the note's menu (the same items as its right-click menu).
struct NoteMenuButton<Items: View>: View {
    var title: String
    var raised = false
    @ViewBuilder var items: () -> Items

    var body: some View {
        FoleviViewMenu(label: String(localized: "Actions for \(title)"), items: items) {
            Image(systemName: "ellipsis")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(FoleviColor.inkMuted)
                .frame(width: 32, height: 32)
                .contentShape(Rectangle())
        }
        .fixedSize()
        .background {
            if raised { Color.clear.foleviSurface(.color(FoleviColor.surfaceRaised), shape: .rounded(6), shadow: FoleviShadow.control) }
        }
    }
}

/// A dashed box with a large line of copy (the web's empty note lists).
struct DashedEmptyState<Action: View>: View {
    var text: String
    @ViewBuilder var action: Action

    var body: some View {
        VStack(spacing: 24) {
            Text(text)
                .font(FoleviType.display(24))
                .tracking(FoleviType.displayTracking(24))
                .foregroundStyle(FoleviColor.heading)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            action
        }
        .padding(.horizontal, 24)
        .padding(.vertical, 64)
        .frame(maxWidth: .infinity)
        .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(FoleviColor.lineStrong, style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
    }
}

/// A pulsing placeholder (the web's `animate-pulse` blocks), still when Reduce Motion is on.
struct PulsePlaceholder: View {
    var radius: CGFloat = 8
    var fill: Color = FoleviColor.surfaceSunken
    @State private var dim = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        RoundedRectangle(cornerRadius: radius, style: .continuous)
            .fill(fill)
            .opacity(dim ? 0.5 : 1)
            .onAppear {
                guard !reduceMotion else { return }
                withAnimation(.easeInOut(duration: 1).repeatForever(autoreverses: true)) { dim = true }
            }
            .accessibilityHidden(true)
    }
}

/// A short text prompt: the web's PromptDialog (FoleviPromptDialog), the one the sidebar's menus use too.
struct PromptSheet: View {
    var title: String
    var label: String
    var initial = ""
    var confirmTitle = String(localized: "Save")
    var onSubmit: (String) -> Void

    var body: some View {
        FoleviPromptDialog(title: title, label: label, initial: initial, confirmTitle: confirmTitle, onSubmit: onSubmit)
    }
}

/// The documents with edits on this Mac the server hasn't confirmed (the web's usePendingDocs).
@MainActor
enum PendingDocuments {
    static func ids(app: AppModel) async -> Set<String> {
        guard let engine = app.session?.engine else { return [] }
        let state = await engine.state
        var out = Set((state.pending + state.inflight).compactMap(\.targetDocumentId))
        for u in state.uploads where u.state != .done { out.insert(u.documentId) }
        return out
    }
}
