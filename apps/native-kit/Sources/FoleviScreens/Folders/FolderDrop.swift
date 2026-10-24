// Dropping on a folder (plan 5.5, web lib/app/folderDrop.ts): notes go inside; a folder goes before, inside or
// after it by where it's held along the card (cards in a row) or the row (rows in a list). Held over a folder for
// 0.6 s on the iPad and the Mac, the folder opens under the drag (spring-loaded), so a note can travel down
// nested folders in one drag.
import SwiftUI
import FoleviEngine
#if canImport(UIKit)
import UIKit
#endif

/// Opens a folder when a drag rests on it long enough.
@MainActor
@Observable
public final class SpringLoader {
    public static var delay: Duration = .milliseconds(600)
    @ObservationIgnored private var task: Task<Void, Never>?
    @ObservationIgnored private var armedFor: String?
    public private(set) var sprung: String?

    public init() {}

    /// Spring-loading is for pointer and multitasking drags: the iPad and the Mac (as the web does).
    public static var enabled: Bool {
        #if os(macOS)
        true
        #else
        UIDevice.current.userInterfaceIdiom == .pad
        #endif
    }

    public func arm(_ id: String, open: @escaping @MainActor () -> Void) {
        guard Self.enabled || Self.forceEnabled, armedFor != id else { return }
        cancel()
        armedFor = id
        let delay = Self.delay
        task = Task { @MainActor [weak self] in
            try? await Task.sleep(for: delay)
            guard let self, !Task.isCancelled, self.armedFor == id else { return }
            self.sprung = id
            self.armedFor = nil
            open()
        }
    }

    public func cancel() {
        task?.cancel()
        task = nil
        armedFor = nil
    }

    /// Tests turn it on on any device.
    nonisolated(unsafe) public static var forceEnabled = false
}

struct FolderDrop: DropDelegate {
    enum Axis { case horizontal, vertical }
    let folderId: String
    let axis: Axis
    let length: CGFloat
    @Binding var zone: FolderRules.Zone?
    let spring: SpringLoader
    var onSpring: (@MainActor () -> Void)?
    var onNotes: ([NoteDragItem]) -> Void
    var onFolder: (FolderDragItem, FolderRules.Zone) -> Void

    private func zone(_ info: DropInfo) -> FolderRules.Zone {
        guard info.hasItemsConforming(to: [.foleviFolderRef]) else { return .inside }
        return FolderRules.zone(at: axis == .horizontal ? info.location.x : info.location.y, length: length)
    }

    func dropEntered(info: DropInfo) {
        zone = zone(info)
        armSpring(info)
    }

    func dropUpdated(info: DropInfo) -> DropProposal? {
        let z = zone(info)
        zone = z
        if z == .inside { armSpring(info) } else { spring.cancel() }
        return DropProposal(operation: .move)
    }

    func dropExited(info: DropInfo) {
        zone = nil
        spring.cancel()
    }

    private func armSpring(_ info: DropInfo) {
        guard let onSpring, zone(info) == .inside else { return }
        spring.arm(folderId, open: onSpring)
    }

    func performDrop(info: DropInfo) -> Bool {
        let at = zone(info)
        zone = nil
        spring.cancel()
        if let provider = info.itemProviders(for: [.foleviFolderRef]).first {
            _ = provider.loadTransferable(type: FolderDragItem.self) { result in
                guard case .success(let item) = result else { return }
                Task { @MainActor in onFolder(item, at) }
            }
            return true
        }
        let notes = info.itemProviders(for: [.foleviNoteRef])
        guard !notes.isEmpty else { return false }
        let collector = DropCollector(expected: notes.count) { items in onNotes(items) }
        for provider in notes {
            _ = provider.loadTransferable(type: NoteDragItem.self) { result in
                Task { @MainActor in collector.add(try? result.get()) }
            }
        }
        return true
    }
}
