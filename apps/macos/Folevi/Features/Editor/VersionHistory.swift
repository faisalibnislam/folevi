import SwiftUI
import WebKit

/// A dialog laid out like the web's Dialog: a display title, a description, × to close, then the content.
struct PageDialog<Content: View>: View {
    var title: String
    var description: String?
    var width: CGFloat = 512
    @ViewBuilder var content: Content
    @DialogDismiss private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(title)
                        .font(FoleviType.display(21))
                        .cssLineHeight(28, family: .serif, size: 21, weight: .semibold)
                        .tracking(FoleviType.displayTracking(21))
                        .foregroundStyle(FoleviColor.heading)
                        .accessibilityAddTraits(.isHeader)
                    if let description {
                        Text(description).font(.ui(13)).uiLineHeight(13 * 1.4286, size: 13)
                            .foregroundStyle(FoleviColor.inkMuted).fixedSize(horizontal: false, vertical: true)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                PageIconButton(systemImage: "xmark", label: String(localized: "Close"), size: 32, iconSize: 14) { dismiss() }
                    .keyboardShortcut(.cancelAction)
            }
            .padding(.horizontal, 24)
            .padding(.top, 20)
            .padding(.bottom, 8)
            content
                .padding(.horizontal, 24)
                .padding(.vertical, 16)
        }
        .frame(width: width)
        .background(FoleviColor.surface)
    }
}

/// Version history (the web's VersionHistory): saved versions with a preview, and restore (the current
/// page is saved as a version first).
struct VersionHistorySheet: View {
    let documentId: String
    @Environment(AppModel.self) private var app
    @DialogDismiss private var dismiss
    @State private var list: [SnapshotInfo]?
    @State private var selected: String?
    @State private var preview: Preview = .none
    @State private var confirm = false
    @State private var canRestore = false

    enum Preview: Equatable {
        case none, loading, html(String), failed(String)
    }

    static let reasons: [String: String] = [
        "idle": String(localized: "Autosaved version"), "close": String(localized: "Saved when closed"),
        "before_restore": String(localized: "Before a restore"), "manual": String(localized: "Saved manually"), "import": String(localized: "Imported"),
    ]

    var body: some View {
        PageDialog(title: String(localized: "Version history"),
                   description: String(localized: "Versions are saved after a pause in editing and when you close a page, not on every keystroke."),
                   width: 768) {
            HStack(alignment: .top, spacing: 16) {
                versions.frame(width: 220)
                previewCard.frame(maxWidth: .infinity)
            }
            .frame(minHeight: 420)
        }
        .frame(height: 591) // the web's dialog height
        .task { await load() }
        .onChange(of: selected) { _, id in
            confirm = false
            Task { await loadPreview(id) }
        }
    }

    // MARK: List

    private var versions: some View {
        VStack(alignment: .leading, spacing: 12) {
            if canRestore {
                Button("Save a version now") { saveNow() }.buttonStyle(.page(.secondary, .sm, fullWidth: true))
            }
            ScrollView {
                VStack(alignment: .leading, spacing: 4) {
                    if list == nil {
                        Text(app.sync.isOnline ? "Loading…" : "Version history is available when you're online.").font(.ui(13)).foregroundStyle(FoleviColor.inkMuted)
                    } else if list?.isEmpty == true {
                        Text("No versions yet.").font(.ui(13)).foregroundStyle(FoleviColor.inkMuted)
                    }
                    ForEach(list ?? []) { s in
                        VersionRow(snapshot: s, selected: selected == s.id) { selected = s.id }
                    }
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel(Text("Versions"))
        }
    }

    // MARK: Preview

    private var previewCard: some View {
        VStack(spacing: 0) {
            switch preview {
            case .none:
                placeholder(String(localized: "Choose a version to preview it."))
            case .loading:
                placeholder(String(localized: "Loading preview…"))
            case .failed(let message):
                placeholder(message)
            case .html(let html):
                HTMLPreview(html: html)
                    .clipShape(UnevenRoundedRectangle(topLeadingRadius: 6, topTrailingRadius: 6, style: .continuous))
                    .accessibilityLabel(Text("Version preview"))
                if canRestore {
                    HStack(spacing: 8) {
                        if confirm {
                            Text("Your current page is saved as a version first, so you can undo this.")
                                .font(.ui(12)).foregroundStyle(FoleviColor.inkMuted)
                                .frame(maxWidth: .infinity, alignment: .leading)
                            Button("Cancel") { confirm = false }.buttonStyle(.page(.secondary, .sm))
                            Button("Restore this version") { restore() }.buttonStyle(.page(.primary, .sm))
                        } else {
                            Spacer()
                            Button("Restore…") { confirm = true }.buttonStyle(.page(.primary, .sm))
                        }
                    }
                    .padding(12)
                    .overlay(alignment: .top) { FoleviColor.line.frame(height: 1) }
                }
            }
        }
        .frame(maxHeight: .infinity)
        .foleviCard(radius: 8)
    }

    private func placeholder(_ text: String) -> some View {
        Text(text).font(.ui(13)).foregroundStyle(FoleviColor.inkMuted).multilineTextAlignment(.center)
            .padding(24).frame(maxWidth: 380).frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: Actions

    private func load() async {
        guard let session = app.session, app.sync.isOnline else { return }
        if let d = try? await session.documents.get(documentId) {
            canRestore = d.canWrite && !d.inTrash && !app.readOnlyMode
        }
        list = (try? await session.documents.snapshots(documentId)) ?? []
    }

    private func loadPreview(_ id: String?) async {
        guard let id, let session = app.session else {
            preview = .none
            return
        }
        preview = .loading
        do {
            guard let content = try await session.documents.snapshotContent(id) else {
                preview = .failed(String(localized: "This version is no longer available."))
                return
            }
            guard selected == id else { return }
            guard let raw = content.content, let json = try? JSONValue(jsonString: raw), let blocksJSON = json["blocks"]?.arrayValue else {
                preview = .failed(String(localized: "This version can’t be previewed. It may have been saved by a newer version of Folevi."))
                return
            }
            let blocks = blocksJSON.compactMap { try? WireBlock(json: $0) }
            let title = json["title"]?.stringValue.flatMap { $0.isEmpty ? nil : $0 } ?? String(localized: "Untitled")
            preview = .html(HTMLExport.blocksToHTML(blocks, .init(title: title)))
        } catch {
            preview = .failed(String(localized: "This version is no longer available."))
        }
    }

    private func saveNow() {
        guard let session = app.session else { return }
        Task {
            do {
                let created = try await session.documents.saveVersion(documentId)
                app.showToast(created ? String(localized: "Version saved") : String(localized: "No changes since the last version"))
                list = (try? await session.documents.snapshots(documentId)) ?? list
            } catch {
                app.showToast(ConvexService.mapError(error).localizedDescription)
            }
        }
    }

    private func restore() {
        guard let session = app.session, let selected else { return }
        Task {
            do {
                try await session.documents.restoreSnapshot(selected)
                await session.engine.syncNow()
                app.showToast(String(localized: "Version restored"))
                dismiss()
            } catch {
                app.showToast(ConvexService.mapError(error).localizedDescription)
            }
        }
    }
}

private struct VersionRow: View {
    var snapshot: SnapshotInfo
    var selected: Bool
    var action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 0) {
                Text(PageFormat.dateTime(snapshot.createdAt)).font(.ui(13, .medium))
                    .uiLineHeight(13 * 1.4286, size: 13, weight: .medium)
                Text("\(VersionHistorySheet.reasons[snapshot.reason] ?? String(localized: "Version")) · \(snapshot.createdBy)")
                    .font(.ui(12)).foregroundStyle(selected ? FoleviColor.accentSoftInk : FoleviColor.inkMuted)
                    .uiLineHeight(16, size: 12)
            }
            .foregroundStyle(selected ? FoleviColor.accentSoftInk : FoleviColor.ink)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(selected ? FoleviColor.accentSoft : hovering ? FoleviColor.surface : .clear, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

/// A sandboxed, read-only web view for an HTML preview (no scripts, no navigation).
struct HTMLPreview: NSViewRepresentable {
    var html: String

    func makeNSView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.defaultWebpagePreferences.allowsContentJavaScript = false
        let view = WKWebView(frame: .zero, configuration: config)
        view.navigationDelegate = context.coordinator
        view.loadHTMLString(html, baseURL: nil)
        context.coordinator.html = html
        return view
    }

    func updateNSView(_ view: WKWebView, context: Context) {
        guard context.coordinator.html != html else { return }
        context.coordinator.html = html
        view.loadHTMLString(html, baseURL: nil)
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    final class Coordinator: NSObject, WKNavigationDelegate {
        var html = ""
        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void) {
            decisionHandler(action.navigationType == .other ? .allow : .cancel)
        }
    }
}
