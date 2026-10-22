// Change detection for the library (docs/LOCAL_MODE_PLAN.md §3.7) on iPhone and iPad: for iCloud an
// NSMetadataQuery over the app's container (iCloud says when files arrive, change or finish downloading), and
// for every kind a full listing every 30 seconds while the app is in front and each time it comes back (third
// party File Providers notify unreliably, so polling is the real mechanism). Each listing is compared with
// the last one reported, so the page gets one batch per burst, each path once, and never its own writes back.
//
// Kinds: "changed" (new or a different etag), "removed", "downloaded" (a placeholder's contents arrived).
import Foundation
#if os(iOS)
import UIKit
#else
import AppKit
#endif

final class LibraryWatcher: NSObject {
    private struct Known {
        var etag: String
        var downloaded: Bool
    }

    private let list: () throws -> [LibraryEntry]
    private let onChanges: ([[String: String]]) -> Void
    private let queue: DispatchQueue
    private var state: [String: Known] = [:]
    private var timer: DispatchSourceTimer?
    private var query: NSMetadataQuery?
    private var observers: [NSObjectProtocol] = []
    private var pending: DispatchWorkItem?
    private var stopped = false

    /// `list` and `onChanges` run on `queue` (the library's own).
    init(queue: DispatchQueue, iCloudScope: Bool, list: @escaping () throws -> [LibraryEntry], onChanges: @escaping ([[String: String]]) -> Void) {
        self.queue = queue
        self.list = list
        self.onChanges = onChanges
        super.init()
        queue.async { self.baseline() }
        let t = DispatchSource.makeTimerSource(queue: queue)
        t.schedule(deadline: .now() + 30, repeating: 30, leeway: .seconds(5))
        t.setEventHandler { [weak self] in
            guard let self else { return }
            // Only while Folevi is in front (the page isn't running in the background anyway).
            DispatchQueue.main.async {
                guard Platform.isActive else { return }
                self.queue.async { self.scan() }
            }
        }
        t.resume()
        timer = t
        observers.append(NotificationCenter.default.addObserver(forName: Platform.didBecomeActive, object: nil, queue: nil) { [weak self] _ in self?.soon() })
        if iCloudScope {
            DispatchQueue.main.async { self.startQuery() }
        }
    }

    private func baseline() {
        guard let entries = try? list() else { return }
        for e in entries { state[e.path] = Known(etag: e.etag, downloaded: e.downloaded) }
    }

    /// NSMetadataQuery needs a run loop: it lives on the main thread and only nudges a scan.
    private func startQuery() {
        guard !stopped else { return }
        let q = NSMetadataQuery()
        q.searchScopes = [NSMetadataQueryUbiquitousDocumentsScope]
        q.predicate = NSPredicate(format: "%K LIKE %@", NSMetadataItemFSNameKey, "*")
        q.notificationBatchingInterval = 0.5
        let center = NotificationCenter.default
        observers.append(center.addObserver(forName: .NSMetadataQueryDidFinishGathering, object: q, queue: .main) { [weak self] _ in self?.gathered(q) })
        observers.append(center.addObserver(forName: .NSMetadataQueryDidUpdate, object: q, queue: .main) { [weak self] _ in self?.soon() })
        q.start()
        query = q
    }

    /// The first gathering: whatever isn't on this device yet starts downloading (notes always; attachments are
    /// asked for when they're shown).
    private func gathered(_ q: NSMetadataQuery) {
        q.disableUpdates()
        defer { q.enableUpdates() }
        for case let item as NSMetadataItem in q.results {
            guard let url = item.value(forAttribute: NSMetadataItemURLKey) as? URL else { continue }
            let status = item.value(forAttribute: NSMetadataUbiquitousItemDownloadingStatusKey) as? String
            let name = url.lastPathComponent
            let wanted = name.hasSuffix(".fnote") || name.hasSuffix(".fcat") || name.hasSuffix(".findex") || name == LibraryPaths.libraryFile || url.deletingLastPathComponent().lastPathComponent == "devices"
            if wanted, status == NSMetadataUbiquitousItemDownloadingStatusNotDownloaded {
                try? FileManager.default.startDownloadingUbiquitousItem(at: url)
            }
        }
        soon()
    }

    /// A scan a moment from now (bursts of changes become one).
    func soon() {
        queue.async {
            self.pending?.cancel()
            let work = DispatchWorkItem { [weak self] in self?.scan() }
            self.pending = work
            self.queue.asyncAfter(deadline: .now() + 0.3, execute: work)
        }
    }

    /// The page wrote or removed this file itself: remember it so it isn't reported back. On `queue`.
    func noteOwnChange(_ path: String, etag: String?) {
        if let etag { state[path] = Known(etag: etag, downloaded: true) } else { state.removeValue(forKey: path) }
    }

    /// A full listing now (the timer, coming to the front, "Sync now"). On `queue`.
    func scan() {
        guard !stopped, let entries = try? list() else { return }
        var changes: [String: String] = [:]
        var seen = Set<String>()
        for e in entries {
            seen.insert(e.path)
            if let k = state[e.path] {
                if !k.downloaded && e.downloaded { changes[e.path] = "downloaded" } else if k.etag != e.etag { changes[e.path] = "changed" }
            } else {
                changes[e.path] = "changed"
            }
            state[e.path] = Known(etag: e.etag, downloaded: e.downloaded)
        }
        for path in state.keys where !seen.contains(path) {
            state.removeValue(forKey: path)
            changes[path] = "removed"
        }
        guard !changes.isEmpty else { return }
        onChanges(changes.keys.sorted().map { ["path": $0, "kind": changes[$0]!] })
    }

    func stop() {
        stopped = true
        timer?.cancel()
        timer = nil
        pending?.cancel()
        let q = query
        let obs = observers
        observers = []
        DispatchQueue.main.async {
            q?.stop()
            obs.forEach(NotificationCenter.default.removeObserver)
        }
    }
}
