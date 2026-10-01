import AppKit
import Observation

/// ai:write's reply.
struct AiWritten: Decodable, Sendable { var text: String }

/// One live AI reply, as on the web (useAiStream): `begin` opens a stream row (pass its id to the AI
/// action), `text` is what's arrived so far, revealed word by word, `stop` asks the AI to stop (the action
/// then returns what it had), `finish` lets the reveal catch up with the whole reply, `end` closes it.
/// When a stream can't be opened, `begin` returns nil and the caller waits for the plain reply.
@MainActor
@Observable
final class AiStreamRunner {
    /// The reply revealed so far (empty until the first words arrive).
    private(set) var text = ""
    /// A stream is open.
    private(set) var live = false

    @ObservationIgnored private var target = ""
    @ObservationIgnored private var shown = 0
    @ObservationIgnored private var finalText: String?
    @ObservationIgnored private var streamId: String?
    @ObservationIgnored private var convex: ConvexService?
    @ObservationIgnored private var listen: Task<Void, Never>?
    @ObservationIgnored private var ticker: Task<Void, Never>?
    @ObservationIgnored private var settle: CheckedContinuation<Void, Never>?

    /// Opens a stream for the next AI call; nil when that isn't possible (the call still works without one).
    func begin(_ session: SessionContext) async -> String? {
        end()
        let id: String
        do {
            id = try await session.convex.mutation("ai:startStream", [:], timeout: 10)
        } catch {
            return nil
        }
        streamId = id
        convex = session.convex
        live = true
        let rows: AsyncThrowingStream<JSONValue, Error> = session.convex.subscribe("ai:stream", ["id": .string(id)])
        listen = Task { [weak self] in
            do {
                for try await row in rows {
                    guard let self, !Task.isCancelled else { return }
                    if self.finalText == nil, let t = row["text"]?.stringValue { self.target = t }
                }
            } catch {}
        }
        ticker = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(30))
                guard let self else { return }
                self.step()
            }
        }
        return id
    }

    private func step() {
        if target.count < shown { shown = 0 }
        let next = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion ? target.count : Typewriter.next(shown: shown, target: target)
        if next != shown {
            shown = next
            text = String(target.prefix(next))
        }
        if finalText != nil, shown >= target.count, let s = settle {
            settle = nil
            s.resume()
        }
    }

    /// Asks the AI to stop; the action returns what it had written.
    func stop() {
        guard let id = streamId, let convex else { return }
        Task { try? await convex.mutationVoid("ai:cancelStream", ["id": .string(id)]) }
    }

    /// Lets the reveal catch up with the whole reply (at once if nothing was streamed), then closes.
    func finish(_ full: String) async {
        guard streamId != nil, !full.isEmpty, !text.isEmpty else {
            end()
            return
        }
        finalText = full
        target = full
        if shown < target.count {
            await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in settle = c }
        }
        end()
    }

    /// Closes the stream (keeps nothing).
    func end() {
        listen?.cancel()
        ticker?.cancel()
        listen = nil
        ticker = nil
        if let s = settle {
            settle = nil
            s.resume()
        }
        streamId = nil
        convex = nil
        finalText = nil
        target = ""
        shown = 0
        if !text.isEmpty { text = "" }
        if live { live = false }
    }
}
