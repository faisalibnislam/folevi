// nextChange (Model/Observe.swift): a wait for an @Observable change ends when its task is cancelled, and lets go
// of what it held. The bare continuation it replaces never returned once nothing changed, so FrameModel's
// observers kept every closed window's model and a store for each change of tabs.
import Foundation
import Observation
import Testing
@testable import FoleviMac

@MainActor @Observable
private final class Box { var n = 0 }

@MainActor
struct NextChangeTests {
    @Test func returnsOnAChange() async {
        let box = Box()
        let task = Task { @MainActor in await nextChange { _ = box.n } ; return true }
        try? await Task.sleep(for: .milliseconds(50))
        box.n += 1
        #expect(await task.value)
    }

    @Test func returnsWhenCancelledWithNoChange() async {
        let box = Box()
        let task = Task { @MainActor in await nextChange { _ = box.n } ; return true }
        try? await Task.sleep(for: .milliseconds(50))
        task.cancel()
        #expect(await task.value)
    }

    @Test func returnsAtOnceWhenAlreadyCancelled() async {
        let box = Box()
        let task = Task { @MainActor in
            withUnsafeCurrentTask { $0?.cancel() }
            await nextChange { _ = box.n }
            return true
        }
        #expect(await task.value)
    }

    @Test func aCancelledLoopLetsTheModelGo() async {
        weak var gone: Box?
        var task: Task<Void, Never>?
        do {
            let box = Box()
            gone = box
            task = Task { @MainActor [weak box] in
                while !Task.isCancelled {
                    guard box != nil else { return }
                    await nextChange { _ = box?.n }
                }
            }
            try? await Task.sleep(for: .milliseconds(50))
        }
        task?.cancel()
        await task?.value
        #expect(gone == nil)
    }
}
