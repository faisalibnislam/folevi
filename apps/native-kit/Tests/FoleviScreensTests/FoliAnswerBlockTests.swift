import Testing
import Observation
import Synchronization
@testable import FoleviScreens

@Suite("Streaming answer rows") @MainActor
struct FoliAnswerBlockTests {
    @Test func growingTextPreservesSettledRows() throws {
        let answer = FoliAnswer(messageId: "answer")
        answer.show("# Guide\n\nFirst paragraph"[...])
        let heading = try #require(answer.renderedBlocks.first)
        let paragraph = try #require(answer.renderedBlocks.last)
        answer.show("# Guide\n\nFirst paragraph keeps growing"[...])
        #expect(answer.renderedBlocks.first === heading)
        #expect(answer.renderedBlocks.last === paragraph)
        #expect(heading.block.source == "Guide")
        #expect(paragraph.block.source == "First paragraph keeps growing")
        #expect(answer.renderedBlocks.map(\.block) == answer.blocks)

        answer.show("# Guide\n\nFirst paragraph keeps growing\n\n- Next step"[...])
        #expect(answer.renderedBlocks.count == 3)
        #expect(answer.renderedBlocks[0] === heading)
        #expect(answer.renderedBlocks[1] === paragraph)
        #expect(answer.renderedBlocks.map(\.block) == answer.blocks)
    }

    @Test func typingInvalidatesOnlyTheGrowingBlock() throws {
        let answer = FoliAnswer(messageId: "answer")
        answer.show("# Guide\n\nFirst words"[...])
        let heading = try #require(answer.renderedBlocks.first)
        let paragraph = try #require(answer.renderedBlocks.last)
        let structure = Mutex(0), settled = Mutex(0), growing = Mutex(0)
        withObservationTracking { _ = answer.renderedBlocks } onChange: { structure.withLock { $0 += 1 } }
        withObservationTracking { _ = heading.block } onChange: { settled.withLock { $0 += 1 } }
        withObservationTracking { _ = paragraph.block } onChange: { growing.withLock { $0 += 1 } }
        answer.show("# Guide\n\nFirst words and more"[...])
        #expect(structure.withLock { $0 } == 0)
        #expect(settled.withLock { $0 } == 0)
        #expect(growing.withLock { $0 } == 1)
        answer.show("# Guide\n\nFirst words and more\n\n- A new block"[...])
        #expect(structure.withLock { $0 } == 1)
    }

    @Test func revealCompletionHasItsOwnState() {
        let answer = FoliAnswer(messageId: "answer")
        #expect(!answer.revealing)
        answer.reveal = StreamReveal()
        #expect(answer.revealing)
        let changes = Mutex(0)
        withObservationTracking { _ = answer.revealing } onChange: { changes.withLock { $0 += 1 } }
        answer.reveal?.receive("Finished")
        #expect(changes.withLock { $0 } == 0)
        answer.reveal = nil
        // Finished actions must redraw even if the last text update had already caught up.
        #expect(changes.withLock { $0 } == 1)
        #expect(!answer.revealing)
    }

    @Test func growingAnswersDoNotUnpinReaders() {
        let end = AiScrollFollow.Reading(offset: 400, atEnd: true)
        let grown = AiScrollFollow.Reading(offset: 400, atEnd: false)
        #expect(AiScrollFollow.following(true, old: end, new: grown))
        let up = AiScrollFollow.Reading(offset: 200, atEnd: false)
        #expect(!AiScrollFollow.following(true, old: grown, new: up))
        #expect(!AiScrollFollow.following(false, old: up, new: grown))
        #expect(AiScrollFollow.following(false, old: up, new: end))
    }

    @Test func replacementAndEmptyAnswersRemoveStaleRows() {
        let answer = FoliAnswer(messageId: "answer")
        answer.show("# Old heading\n\nOld paragraph\n\n- Old step"[...])
        answer.show("A replacement answer"[...])
        #expect(answer.renderedBlocks.count == 1)
        #expect(answer.renderedBlocks.first?.block.source == "A replacement answer")
        #expect(answer.renderedBlocks.first?.block.kind == .paragraph)
        #expect(answer.renderedBlocks.map(\.block) == answer.blocks)
        answer.show(""[...])
        #expect(answer.renderedBlocks.isEmpty)
        #expect(answer.blocks.isEmpty)
        #expect(!answer.hasText)
    }
}
