// "Save to Folevi" in the share sheet: links, text, images and PDFs from any app, saved as a note in the
// Inbox of the place chosen. A compact sheet in Folevi's neutral look (ShareView): a title, a short preview,
// where it goes, Cancel and Save. Saving goes straight to Folevi through the REST API when it can, else is
// kept for the app (ShareSaver): either way it's saved before the sheet says so.
import SwiftUI
import UIKit
import UniformTypeIdentifiers

final class ShareViewController: UIViewController {
    private let model = ShareModel()

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .clear
        model.finish = { [weak self] cancelled in
            guard let context = self?.extensionContext else { return }
            if cancelled {
                context.cancelRequest(withError: NSError(domain: NSCocoaErrorDomain, code: NSUserCancelledError))
            } else {
                context.completeRequest(returningItems: nil)
            }
        }
        let host = UIHostingController(rootView: ShareView(model: model))
        host.view.backgroundColor = .clear
        addChild(host)
        host.view.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(host.view)
        NSLayoutConstraint.activate([
            host.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            host.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            host.view.topAnchor.constraint(equalTo: view.topAnchor),
            host.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])
        host.didMove(toParent: self)
        let items = (extensionContext?.inputItems as? [NSExtensionItem]) ?? []
        Task { await model.load(items) }
    }
}

/// What the sheet shows and does.
@MainActor
final class ShareModel: ObservableObject {
    enum Phase: Equatable {
        case loading
        case editing
        case saving
        case done(String)
        case failed(String)
    }

    @Published var phase: Phase = .loading
    @Published var title = ""
    @Published var content = ShareContent(title: "", text: "", url: nil)
    @Published var files: [SharedFile] = []
    @Published var skipped: [String] = []
    @Published var places: [Place] = PlacesCache.load()
    @Published var place = "personal"
    /// Several places on this device (SaveTargets): the library and each account, the last one chosen first.
    /// Empty with one place: the sheet saves as it always has.
    @Published var targets: [SaveTarget] = SaveTargets.several() ? SaveTargets.load() : []
    @Published var target: SaveTarget? = SaveTargets.several() ? SaveTargets.preferred() : nil

    var finish: (Bool) -> Void = { _ in }

    struct SharedFile: Identifiable {
        let id = UUID()
        let name: String
        let type: String
        let data: Data
        var isImage: Bool { type.hasPrefix("image/") }
    }

    /// Reads the shared items: links, text, images (as JPEG unless PNG, GIF or WebP) and PDFs.
    func load(_ items: [NSExtensionItem]) async {
        var url: String?
        var texts: [String] = []
        var title = items.first?.attributedContentText?.string ?? items.first?.attributedTitle?.string
        for item in items {
            for provider in item.attachments ?? [] {
                if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier), !provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier) {
                    if let value = try? await provider.loadItem(forTypeIdentifier: UTType.url.identifier), let link = (value as? URL)?.absoluteString ?? (value as? String) {
                        if url == nil { url = link }
                    }
                } else if provider.hasItemConformingToTypeIdentifier(UTType.pdf.identifier) {
                    if let file = await Self.file(provider, type: .pdf) { add(file) }
                } else if provider.hasItemConformingToTypeIdentifier(UTType.image.identifier) {
                    if let file = await Self.image(provider) { add(file) }
                } else if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
                    if let value = try? await provider.loadItem(forTypeIdentifier: UTType.plainText.identifier), let text = value as? String { texts.append(text) }
                } else {
                    skipped.append(provider.suggestedName ?? "A file")
                }
            }
        }
        // Safari's title arrives as the item's text when there's a link; text shared from Notes (and most
        // apps) arrives both as the item's text and as an attachment, once is enough.
        if title == url { title = nil }
        if let t = title?.trimmingCharacters(in: .whitespacesAndNewlines), texts.contains(where: { $0.trimmingCharacters(in: .whitespacesAndNewlines) == t }) { title = nil }
        content = ShareContent.tidy(title: url != nil ? title : nil, text: url != nil ? texts.joined(separator: "\n\n") : ([title].compactMap { $0 } + texts).joined(separator: "\n\n"), url: url)
        if content.title.isEmpty, let first = files.first { content.title = (first.name as NSString).deletingPathExtension }
        self.title = content.title
        if let target { places = target.isLibrary ? [] : PlacesCache.load(userId: target.userId) }
        if let saved = PlacesCache.lastPlace, places.contains(where: { $0.id == saved }) { place = saved }
        phase = .editing
        await refreshPlaces()
    }

    /// Another place chosen: its own workspaces (as last seen, then fetched again).
    func choose(_ next: SaveTarget) {
        target = next
        places = next.isLibrary ? [] : PlacesCache.load(userId: next.userId)
        if !places.contains(where: { $0.id == place }) { place = places.first?.id ?? "personal" }
        Task { await refreshPlaces() }
    }

    private func add(_ file: SharedFile) {
        if files.count < ShareQueue.maxFiles, file.data.count <= ShareQueue.maxFileBytes { files.append(file) } else { skipped.append(file.name) }
    }

    /// The places this device's token can use, fetched again in case a workspace was added.
    private func refreshPlaces() async {
        let chosen = target
        if let chosen, chosen.isLibrary { return }
        guard let api = chosen.flatMap({ SaveTargets.api(for: $0) }) ?? (chosen == nil || SaveTargets.isOpen(chosen?.id) ? SharedAccount.api() : nil),
              let fresh = try? await api.places(), !fresh.isEmpty, chosen == target else { return }
        PlacesCache.save(fresh, userId: chosen?.userId)
        places = fresh
        if !fresh.contains(where: { $0.id == place }) { place = fresh[0].id }
    }

    func save() {
        guard phase == .editing else { return }
        phase = .saving
        var chosen = content
        chosen.title = title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? content.title : title.trimmingCharacters(in: .whitespacesAndNewlines)
        PlacesCache.lastPlace = place
        let files = self.files.map { (name: $0.name, type: $0.type, data: $0.data) }
        let place = self.place
        let target = self.target
        if let target { SaveTargets.remember(target.id) }
        Task {
            do {
                let outcome = try await ShareSaver().save(chosen, place: place, target: target, files: files)
                phase = .done(Self.doneMessage(outcome, target: target))
                try? await Task.sleep(nanoseconds: 1_600_000_000)
                finish(false)
            } catch {
                phase = .failed("Folevi couldn't keep this. Make sure there's space on this device and try again.")
            }
        }
    }

    func cancel() {
        finish(true)
    }

    static func doneMessage(_ outcome: ShareSaver.Outcome, target: SaveTarget?) -> String {
        guard let target else { return outcome == .queued ? "Saved, it will sync when Folevi opens" : "Saved to your Inbox" }
        if outcome != .queued { return "Saved to the Inbox in \(target.name)" }
        return target.isLibrary ? "Saved. It goes into the library when you next open it" : "Saved. It goes to \(target.name) when you next open it"
    }

    // MARK: Reading attachments

    private static func file(_ provider: NSItemProvider, type: UTType) async -> SharedFile? {
        await withCheckedContinuation { done in
            provider.loadFileRepresentation(forTypeIdentifier: type.identifier) { url, _ in
                guard let url, let data = try? Data(contentsOf: url) else { return done.resume(returning: nil) }
                let name = provider.suggestedName.map { $0.hasSuffix(".pdf") ? $0 : "\($0).pdf" } ?? url.lastPathComponent
                done.resume(returning: SharedFile(name: name, type: type.preferredMIMEType ?? "application/pdf", data: data))
            }
        }
    }

    /// An image as Folevi takes it: PNG, GIF and WebP as they are, anything else (HEIC from Photos) as JPEG.
    private static func image(_ provider: NSItemProvider) async -> SharedFile? {
        let kept: [UTType] = [.png, .gif, .webP, .jpeg]
        for type in kept where provider.hasItemConformingToTypeIdentifier(type.identifier) {
            if let file = await file(provider, type: type) {
                let base = provider.suggestedName ?? "Image"
                let ext = type.preferredFilenameExtension ?? "jpg"
                return SharedFile(name: (base as NSString).pathExtension.isEmpty ? "\(base).\(ext)" : base, type: type.preferredMIMEType ?? "image/jpeg", data: file.data)
            }
        }
        let image: UIImage? = await withCheckedContinuation { done in
            provider.loadObject(ofClass: UIImage.self) { object, _ in done.resume(returning: object as? UIImage) }
        }
        guard let image, let jpeg = image.jpegData(compressionQuality: 0.85) else { return nil }
        let base = ((provider.suggestedName ?? "Image") as NSString).deletingPathExtension
        return SharedFile(name: "\(base).jpg", type: "image/jpeg", data: jpeg)
    }
}
