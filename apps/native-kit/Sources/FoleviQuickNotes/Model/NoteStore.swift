import Foundation
import SwiftData
import AppKit

/// CRUD for dots, notes and attachments on the main context. All writes are local and immediate;
/// CloudKit mirroring (when on) happens in the background and never blocks typing.
@MainActor
final class NoteStore {
    let context: ModelContext
    static let hardCap = 20
    static let softCap = 12

    /// Stable per-Mac identifier recorded on every write.
    static let deviceID: String = {
        let key = "folevi.quicknotes.device"
        if let id = UserDefaults.standard.string(forKey: key) { return id }
        let id = UUID().uuidString
        UserDefaults.standard.set(id, forKey: key)
        return id
    }()

    init(context: ModelContext) {
        self.context = context
    }

    // MARK: Dots

    func fetchDots() -> [Dot] {
        let descriptor = FetchDescriptor<Dot>(sortBy: [SortDescriptor(\.order), SortDescriptor(\.createdAt)])
        return (try? context.fetch(descriptor)) ?? []
    }

    /// Seeds the seven default dots on first launch and repairs anything sync may have left
    /// inconsistent (duplicate ids from concurrent creation, missing notes, order gaps).
    @discardableResult
    func prepare(defaultRichText: Bool) -> [Dot] {
        var dots = fetchDots()
        if dots.isEmpty {
            for (i, color) in DotColorID.defaults.enumerated() {
                let dot = Dot(order: i, colorID: color, isRichText: defaultRichText)
                dot.note = Note()
                context.insert(dot)
            }
            save()
            dots = fetchDots()
        }
        return normalize(dots)
    }

    /// Merges dots that share an `id` (keeping all text), gives every dot a note, and renumbers
    /// `order` contiguously. Two Macs that created dots concurrently keep both.
    @discardableResult
    func normalize(_ input: [Dot]? = nil) -> [Dot] {
        var dots = input ?? fetchDots()
        var seen: [UUID: Dot] = [:]
        var changed = false
        for dot in dots {
            if let keeper = seen[dot.id] {
                // Same logical dot twice: keep the newer text, append the other if it differs.
                let a = keeper.note?.plainText ?? "", b = dot.note?.plainText ?? ""
                if !b.isEmpty, a != b, let note = keeper.note {
                    if (dot.note?.updatedAt ?? .distantPast) > note.updatedAt, let other = dot.note {
                        note.rtfData = other.rtfData
                        note.plainText = other.plainText
                        note.updatedAt = other.updatedAt
                    }
                }
                context.delete(dot)
                changed = true
            } else {
                seen[dot.id] = dot
                if dot.note == nil { dot.note = Note(); changed = true }
            }
        }
        dots = dots.filter { seen[$0.id] === $0 }
        for (i, dot) in dots.enumerated() where dot.order != i {
            dot.order = i
            changed = true
        }
        if changed { save() }
        return dots
    }

    /// Every install seeds its own default dots with random ids, so a second Mac would show them all
    /// twice. This removes an untouched default dot when an older dot of the same color exists. Older
    /// dots are never removed, and every Mac reaches the same answer. A default dot is recognized by
    /// being created in a batch: nothing else creates several dots within two seconds.
    /// - Parameter protecting: dots with unsaved or open text on this Mac.
    @discardableResult
    func removeDuplicateDefaultDots(protecting: Set<UUID> = []) -> Int {
        let dots = fetchDots()
        func isOlder(_ a: Dot, than b: Dot) -> Bool {
            a.createdAt == b.createdAt ? a.id.uuidString < b.id.uuidString : a.createdAt < b.createdAt
        }
        func isUntouchedDefault(_ dot: Dot) -> Bool {
            let batch = dots.filter { abs($0.createdAt.timeIntervalSince(dot.createdAt)) <= 2 }
            return batch.count >= 4
                && dot.note?.plainText.isEmpty != false
                && dot.note?.attachments?.isEmpty != false
                && dot.name?.isEmpty != false
                && dot.customColorHex == nil
        }
        let doomed = dots.filter { dot in
            !protecting.contains(dot.id) && isUntouchedDefault(dot)
                && dots.contains { $0 !== dot && $0.colorID == dot.colorID && isOlder($0, than: dot) }
        }
        guard !doomed.isEmpty else { return 0 }
        for dot in doomed { context.delete(dot) }
        save()
        return doomed.count
    }

    func addDot(defaultRichText: Bool) -> Dot? {
        let dots = fetchDots()
        guard dots.count < Self.hardCap else { return nil }
        let used = Set(dots.compactMap(\.colorID))
        let color = DotColorID.allCases.first { !used.contains($0.rawValue) } ?? DotColorID.allCases[dots.count % DotColorID.allCases.count]
        let dot = Dot(order: dots.count, colorID: color, isRichText: defaultRichText)
        dot.note = Note()
        context.insert(dot)
        save()
        return dot
    }

    func delete(_ dot: Dot) {
        context.delete(dot)
        save()
        normalize()
    }

    func move(from source: Int, to destination: Int) {
        var dots = fetchDots()
        guard dots.indices.contains(source) else { return }
        let dot = dots.remove(at: source)
        dots.insert(dot, at: min(max(0, destination), dots.count))
        for (i, d) in dots.enumerated() { d.order = i; d.updatedAt = .now }
        save()
    }

    // MARK: Notes

    func updateNote(of dot: Dot, rtf: Data, markdown: String) {
        let note = dot.note ?? {
            let n = Note(); dot.note = n; return n
        }()
        guard note.plainText != markdown || note.rtfData != rtf else { return }
        note.rtfData = rtf
        note.plainText = markdown
        note.updatedAt = .now
        note.deviceID = Self.deviceID
        dot.updatedAt = .now
        save()
    }

    // MARK: Attachments

    func addAttachment(to dot: Dot, id: UUID = UUID(), data: Data, utType: String, filename: String) -> UUID {
        let attachment = Attachment(id: id, filename: filename, utType: utType, data: data)
        context.insert(attachment)
        attachment.note = dot.note
        save()
        return id
    }

    func attachment(id: UUID) -> Attachment? {
        var descriptor = FetchDescriptor<Attachment>(predicate: #Predicate { $0.id == id })
        descriptor.fetchLimit = 1
        return try? context.fetch(descriptor).first
    }

    /// Deletes attachments no note references any more, once they are older than the backup
    /// retention window (so restoring an old backup still finds its images).
    func collectGarbage(retentionDays: Int) {
        let cutoff = Date.now.addingTimeInterval(-Double(retentionDays) * 86_400)
        // Only attachments old enough to be collected are candidates; skip the text scan otherwise.
        let all = (try? context.fetch(FetchDescriptor<Attachment>(predicate: #Predicate { $0.createdAt < cutoff }))) ?? []
        guard !all.isEmpty else { return }
        let referenced = Set(fetchDots().flatMap { dot -> [UUID] in
            guard let text = dot.note?.plainText else { return [] }
            return Self.attachmentIDs(inMarkdown: text)
        })
        var changed = false
        for attachment in all where !referenced.contains(attachment.id) {
            context.delete(attachment)
            changed = true
        }
        if changed { save() }
    }

    nonisolated static func attachmentIDs(inMarkdown markdown: String) -> [UUID] {
        var ids: [UUID] = []
        var search = markdown[...]
        let token = QuickNoteLink.attachment + ":"
        while let r = search.range(of: token) {
            let idText = search[r.upperBound...].prefix(36)
            if let id = UUID(uuidString: String(idText)) { ids.append(id) }
            search = search[r.upperBound...]
        }
        return ids
    }

    func save() {
        guard context.hasChanges else { return }
        do {
            try context.save()
        } catch {
            PersistenceController.logger.error("Save failed: \(error.localizedDescription, privacy: .public)")
        }
    }
}
