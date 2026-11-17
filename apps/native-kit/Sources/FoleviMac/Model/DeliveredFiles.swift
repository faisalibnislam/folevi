// A file a notification delivers (an export prepared on request), downloaded on the iPad: its signed link from the
// engine's `files.urls` (the web's NotificationsButton DownloadFile asks Convex the same), the bytes to a temporary
// file under the file's own name, then the Files app's export picker saves a copy where the person chooses.
#if os(iOS)
import Foundation
import UIKit

@MainActor
extension FrameModel {
    public func downloadDeliveredFile(_ id: String) {
        toast("Downloading…")
        Task { @MainActor in
            do {
                let links = try await client.query(.filesUrls(ids: [id]))
                // (A sealed file's bytes are ciphertext only a note page can open.)
                guard let link = links.urls[id], !link.sealed, let s = link.url, let url = URL(string: s) else {
                    return toast("That download has expired.", tone: .error)
                }
                let file = try await DeliveredFiles.fetch(url, name: link.filename)
                DocumentPickerRelay.export(file) { _ in try? FileManager.default.removeItem(at: file.deletingLastPathComponent()) }
            } catch {
                toast("That file couldn't be downloaded. Try again.", tone: .error)
            }
        }
    }
}

enum DeliveredFiles {
    /// The bytes at `url` in a temporary folder of their own, under `name` (or the server's name for them).
    nonisolated static func fetch(_ url: URL, name: String?) async throws -> URL {
        let (temp, response) = try await URLSession.shared.download(from: url)
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) { throw URLError(.badServerResponse) }
        guard let dir = FilePanelFiles.newTemporaryFolder() else { throw URLError(.cannotCreateFile) }
        let file = dir.appendingPathComponent(FilePanelFiles.fileName(name ?? response.suggestedFilename ?? "Folevi export"))
        try FileManager.default.moveItem(at: temp, to: file)
        return file
    }
}
#endif
