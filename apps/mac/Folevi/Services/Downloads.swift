// Downloads (docs/MAC_WEBKIT_PLAN.md §6.8): what the page saves as a browser would (an export's Markdown, HTML or
// ZIP from a blob: link with `download`, an attachment's Download button) goes where the person picks in a save
// panel on the window, starting in Downloads with the name the page gave. WKWebView does nothing with such links
// unless its host takes the download; Electron's Chromium saved them on its own.
// A Debug build can save the next download to a path without the panel (MacEval "downloadTo"), for scripts.
import AppKit
import UniformTypeIdentifiers
import WebKit

@MainActor
final class Downloads: NSObject, WKDownloadDelegate {
    static let shared = Downloads()

    /// Debug: the next download goes here without a panel.
    static var nextTo: URL?

    /// Where each download is being written, to say so when it ends.
    private var targets: [ObjectIdentifier: URL] = [:]

    /// Whether a page's link or response is a download (a `download` link, an attachment, or nothing to show).
    static func isDownload(action: WKNavigationAction) -> Bool { action.shouldPerformDownload }

    static func isDownload(response: WKNavigationResponse) -> Bool {
        if !response.canShowMIMEType { return true }
        let disposition = (response.response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Disposition") ?? ""
        return disposition.lowercased().hasPrefix("attachment")
    }

    func adopt(_ download: WKDownload) {
        download.delegate = self
    }

    /// A file name the save panel can start with: the page's, without path or control characters.
    nonisolated static func cleanName(_ name: String) -> String {
        let base = (name as NSString).lastPathComponent
            .replacingOccurrences(of: #"[\u0000-\u001F\u007F/\\:]+"#, with: "-", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmed = base.hasPrefix(".") ? String(base.drop(while: { $0 == "." })) : base
        return trimmed.isEmpty ? "Download" : String(trimmed.prefix(200))
    }

    nonisolated func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        MainActor.assumeIsolated {
            let name = Self.cleanName(suggestedFilename)
            if let to = Self.nextTo {
                Self.nextTo = nil
                try? FileManager.default.removeItem(at: to)
                targets[ObjectIdentifier(download)] = to
                return completionHandler(to)
            }
            let panel = NSSavePanel()
            panel.nameFieldStringValue = name
            panel.canCreateDirectories = true
            panel.isExtensionHidden = false
            panel.directoryURL = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first
            let finish: (NSApplication.ModalResponse) -> Void = { result in
                guard result == .OK, let url = panel.url else { return completionHandler(nil) }
                // The panel already asked about replacing a file of that name.
                try? FileManager.default.removeItem(at: url)
                self.targets[ObjectIdentifier(download)] = url
                completionHandler(url)
            }
            if let window = download.webView?.window ?? NSApp.keyWindow {
                panel.beginSheetModal(for: window, completionHandler: finish)
            } else {
                finish(panel.runModal())
            }
        }
    }

    nonisolated func downloadDidFinish(_ download: WKDownload) {
        MainActor.assumeIsolated {
            guard let url = targets.removeValue(forKey: ObjectIdentifier(download)) else { return }
            // As Safari: the Downloads stack bounces for a file saved in Downloads.
            DistributedNotificationCenter.default().post(name: Notification.Name("com.apple.DownloadFileFinished"), object: url.path)
        }
    }

    nonisolated func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        MainActor.assumeIsolated {
            guard let url = targets.removeValue(forKey: ObjectIdentifier(download)) else { return }
            try? FileManager.default.removeItem(at: url)
            let alert = NSAlert()
            alert.messageText = "Folevi couldn't save \(url.lastPathComponent)"
            alert.informativeText = (error as NSError).localizedDescription
            if let window = download.webView?.window { alert.beginSheetModal(for: window) } else { alert.runModal() }
        }
    }
}

// The navigation delegate's half: a response the page can't show, or one sent as an attachment, is a download,
// and so is every navigation WebKit turned into one (Navigation.swift sends `download` links here).
extension Navigation {
    func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        decisionHandler(Downloads.isDownload(response: response) ? .download : .allow)
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        Downloads.shared.adopt(download)
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        Downloads.shared.adopt(download)
    }
}
