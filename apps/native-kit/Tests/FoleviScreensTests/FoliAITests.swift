// Foli AI chat (N12): the view model against a scripted engine (the contract's fixtures and a scripted stream
// of chunks over 2 s), the incremental Markdown and the word-by-word reveal.
import Foundation
import Testing
@testable import FoleviDesign
@testable import FoleviEngine
@testable import FoleviScreens

// MARK: Builders

func chatMessage(_ id: String, _ role: ChatMessage.Role, _ text: String, status: String = "done", live: Bool = false, phase: String? = nil, citations: [ChatCitation] = [], suggestions: [String] = [], actions: [ChatAction] = [], agentMore: Bool = false, agentRun: ChatAgentRun? = nil, memory: ChatMemoryOffer? = nil, error: EngineError? = nil) -> ChatMessage {
    ChatMessage(id: id, role: role, text: text, status: status, live: live, phase: phase, error: error, citations: citations, webCitations: [], suggestions: suggestions, credits: nil, attachments: [], actions: actions, actionsOutcome: nil, agentSteps: [], agentMore: agentMore, memory: memory, createdAt: 1_792_832_400_000, agentRun: agentRun)
}

func conversationValue(_ id: String, title: String = "Trip planning", ephemeral: Bool = false, _ messages: [ChatMessage]) -> JSONValue {
    let info = ChatConversationInfo(id: id, title: title, pinned: false, ephemeral: ephemeral, space: "personal", context: "none", shared: false, canShare: false, createdAt: 1_792_832_400_000, lastMessageAt: 1_792_832_400_000)
    return try! JSONValue.from(ChatConversationValue(found: true, conversation: info, messages: messages))
}

func streamValue(_ messageId: String, _ text: String?) -> JSONValue {
    try! JSONValue.from(ChatStreamValue(messageId: messageId, text: text))
}

/// A FakeEngine with Foli AI's views from the contract fixtures.
@MainActor
func chatEngine(webResearch: Bool = true) -> FakeEngine {
    let engine = FakeEngine()
    var caps = Fixtures.decode(ChatCapabilities.self, "view.ai.capabilities.json")
    caps.webResearch = webResearch
    engine.values["ai.capabilities"] = try! JSONValue.from(caps)
    engine.values["ai.conversation"] = Fixtures.value("view.ai.conversation.json")
    engine.values["ai.stream"] = Fixtures.value("view.ai.stream.json")
    engine.values["ai.research"] = .object(["jobs": .array([])])
    engine.values["ai.conversations"] = Fixtures.value("view.ai.conversations.json")
    engine.onCommand = { name, args in
        switch name {
        case "ai.send", "ai.regenerate", "ai.edit":
            return .object(["conversationId": args["conversationId"] ?? .string("conv_new"), "messageId": .string("msg_new")])
        case "ai.agentUndo":
            return .object(["status": .string("undone"), "changed": .array([])])
        case "ai.saveAsNote", "ai.researchSave":
            return .object(["id": .string("doc_saved")])
        default:
            return .object(["ok": .bool(true)])
        }
    }
    return engine
}

func scratchDefaults() -> UserDefaults { UserDefaults(suiteName: "folevi.ai.\(UUID().uuidString)")! }

/// A long Markdown answer: headings, paragraphs, lists, a table and code, about `words` words.
func longAnswer(words: Int) -> String {
    var parts: [String] = []
    var count = 0
    var section = 1
    while count < words {
        let para = "Kyoto in late November is mild and bright, with maple leaves at their deepest red in the temple gardens of the eastern hills [1]. Trains run often, and most sights open early."
        let block = """
        ## Part \(section): planning the days

        \(para) \(para)

        - Book the rail pass a week ahead, it **saves** money
        - Pack layers: mornings are cold, afternoons warm
        - Reserve *Kinkaku-ji* early, before the tour buses

        | Day | Morning | Afternoon |
        | --- | --- | --- |
        | 1 | Fushimi Inari | Gion walk |
        | 2 | Arashiyama | Tenryu-ji |

        ```swift
        let budget = days * 12_000
        print(budget)
        ```

        1. Arrive and rest
        2. Walk the Philosopher's Path

        """
        parts.append(block)
        count += block.split(whereSeparator: \.isWhitespace).count
        section += 1
    }
    return parts.joined()
}

// MARK: Model

@Suite("Foli AI chat model") @MainActor
struct FoliChatModelTests {
    @Test func opensAConversationAndFollowsItsLiveAnswer() async {
        let engine = chatEngine()
        let model = FoliChatModel(client: engine.client(), defaults: scratchDefaults())
        model.reduceMotion = true
        model.open(conversationId: "conv_1")
        await eventually("conversation") { model.messages.count == 5 }
        #expect(model.title == "Trip planning")
        #expect(model.isWorking, "msg_4 is streaming")
        await eventually("stream watched") { engine.watches.values.contains { $0["name"]?.string == "ai.stream" } }
        await eventually("stream text shown") { model.answer("msg_4")?.shownText == "November in Kyoto is mild, 10 to 18" }
        #expect(model.status == "Writing...")
        // The fixture's settled answer is rendered as blocks with its citation.
        #expect(model.answer("msg_2")?.blocks.first?.source.contains("[1]") == true)
        model.stop()
        await eventually { !engine.commands(named: "ai.stop").isEmpty }
        #expect(engine.commands(named: "ai.stop").first?["messageId"]?.string == "msg_4")
    }

    @Test func statusLineNamesThePhaseBeforeTheFirstWords() async {
        let engine = chatEngine()
        engine.values["ai.conversation"] = conversationValue("c1", [chatMessage("u1", .user, "Hi"), chatMessage("a1", .assistant, "", status: "streaming", live: true, phase: "searching")])
        engine.values["ai.stream"] = streamValue("a1", "")
        let model = FoliChatModel(client: engine.client(), defaults: scratchDefaults())
        model.open(conversationId: "c1")
        await eventually { model.messages.count == 2 }
        #expect(model.status == "Searching your notes...")
        #expect(FoliChatModel.phaseLabel("Searching the web") == "Searching the web...")
        #expect(FoliChatModel.phaseLabel(nil) == "Thinking...")
    }

    /// The whole send: a pending question, the reply's ids, then a stream of chunks over 2 s revealed word by
    /// word, then the finished message with sources; VoiceOver hears "Answer ready." once.
    @Test func scriptedStreamOverTwoSeconds() async throws {
        let engine = chatEngine()
        let answer = """
        ## Packing for Kyoto

        November is mild, 10 to 18 degrees [1]. Bring:

        - A light down jacket
        - Comfortable walking shoes
        - A small umbrella

        | Item | Why |
        | --- | --- |
        | Rail pass | Saves money |

        Want me to add this to **Kyoto in November**?
        """
        engine.onCommand = { name, args in
            if name == "ai.send" {
                engine.values["ai.conversation"] = conversationValue("conv_s", title: "Packing", [chatMessage("q1", .user, "What should I pack?"), chatMessage("msg_a", .assistant, "", status: "streaming", live: true, phase: "writing")])
                engine.values["ai.stream"] = streamValue("msg_a", "")
                return .object(["conversationId": .string("conv_s"), "messageId": .string("msg_a")])
            }
            return .object(["ok": .bool(true)])
        }
        let model = FoliChatModel(client: engine.client(), defaults: scratchDefaults())
        model.draft = "What should I pack?"
        model.send()
        #expect(model.draft.isEmpty)
        #expect(model.shownPending?.text == "What should I pack?")
        #expect(model.status == "Thinking...")
        await eventually("conversation") { model.conversationId == "conv_s" && model.messages.count == 2 }
        let sent = try #require(engine.commands(named: "ai.send").first)
        #expect(sent["text"]?.string == "What should I pack?")
        #expect(sent["conversationId"] == nil, "a new conversation")
        #expect(sent["mode"] == nil, "Chat is the engine's auto mode")
        await eventually("stream watched") { engine.watches.values.contains { $0["name"]?.string == "ai.stream" } }

        // 40 chunks, one every 50 ms (2 s), each a few words.
        let words = answer.split(separator: " ", omittingEmptySubsequences: false)
        var shownLengths: [Int] = []
        let clock = ContinuousClock()
        let start = clock.now
        for i in 1...40 {
            let upTo = words.count * i / 40
            engine.update(view: "ai.stream", streamValue("msg_a", words[..<upTo].joined(separator: " ")))
            try? await Task.sleep(for: .milliseconds(50))
            let shown = model.answer("msg_a")?.shownText ?? ""
            shownLengths.append(shown.count)
            #expect(answer.hasPrefix(shown), "shown text is what arrived")
            if !shown.isEmpty, shown.count < answer.count {
                let next = answer[answer.index(answer.startIndex, offsetBy: shown.count)]
                #expect(next.isWhitespace, "reveal stops between words, not in one (\(shown.suffix(8)))")
            }
            #expect(model.isWorking)
        }
        let elapsed = clock.now - start
        #expect(elapsed >= .seconds(2))
        #expect(shownLengths == shownLengths.sorted(), "the reveal never goes back")
        #expect(Set(shownLengths).count > 10, "it grew in many steps: \(shownLengths)")
        #expect(model.status == "Writing...")

        // Finished: the stream ends (null) and the message is done with its source.
        engine.update(view: "ai.conversation", conversationValue("conv_s", title: "Packing", [chatMessage("q1", .user, "What should I pack?"), chatMessage("msg_a", .assistant, answer, citations: [ChatCitation(n: 1, noteId: "doc_00001", title: "Kyoto in November")], suggestions: ["Add it to the note"])]))
        engine.update(view: "ai.stream", streamValue("msg_a", nil))
        await eventually("revealed and done") { !model.isWorking && model.answer("msg_a")?.revealing == false }
        #expect(model.answer("msg_a")?.shownText == answer)
        let kinds = model.answer("msg_a")?.blocks.map(\.kind) ?? []
        #expect(kinds.first == .heading(level: 2))
        #expect(kinds.contains { if case .listItem = $0 { true } else { false } })
        #expect(kinds.contains { if case .table = $0 { true } else { false } })
        #expect(model.announcement == "Answer ready.")
        await eventually("stream unwatched") { !engine.watches.values.contains { $0["name"]?.string == "ai.stream" } }
    }

    @Test func reduceMotionShowsTheAnswerWhole() async {
        let engine = chatEngine()
        engine.values["ai.conversation"] = conversationValue("c1", [chatMessage("u1", .user, "Hi"), chatMessage("a1", .assistant, "", status: "streaming", live: true)])
        let long = String(repeating: "word ", count: 400)
        engine.values["ai.stream"] = streamValue("a1", long)
        let model = FoliChatModel(client: engine.client(), defaults: scratchDefaults())
        model.reduceMotion = true
        model.open(conversationId: "c1")
        await eventually { model.answer("a1")?.shownText == long }
    }

    @Test func newChatAboutAFolderSendsItsContextAndResearchSendsItsMode() async {
        let engine = chatEngine()
        let model = FoliChatModel(client: engine.client(), about: .folder(id: "fld_trips", name: "Trips"), defaults: scratchDefaults())
        await eventually { model.caps != nil }
        #expect(model.context.map(\.name) == ["Trips"])
        #expect(model.suggestions == FoliChatModel.folderSuggestions)
        model.send("Summarize this folder")
        await eventually { engine.commands(named: "ai.send").count == 1 }
        let args = engine.commands(named: "ai.send")[0]
        #expect(args["context"]?["kind"]?.string == "folder")
        #expect(args["context"]?["ids"] == .array([.string("fld_trips")]))

        let research = FoliChatModel(client: engine.client(), defaults: scratchDefaults())
        await eventually { research.caps != nil }
        research.mode = .research
        #expect(research.placeholder == "What should Foli AI research?")
        research.send("Best time for autumn leaves in Kyoto")
        await eventually { engine.commands(named: "ai.send").count == 2 }
        #expect(engine.commands(named: "ai.send")[1]["mode"]?.string == "research")
    }

    @Test func webChipAndNotesAsContext() async {
        let engine = chatEngine()
        let model = FoliChatModel(client: engine.client(), defaults: scratchDefaults())
        await eventually { model.caps != nil }
        #expect(model.placeholder == "Ask Foli AI anything...")
        #expect(model.footnote == "Foli AI can make mistakes.")
        model.web = true
        model.addNote(id: "doc_1", title: "Kyoto in November")
        model.addNote(id: "doc_2", title: "")
        #expect(model.context.map(\.name) == ["Kyoto in November", "Untitled"])
        model.removeContext("doc_2")
        model.send("What's left to book?")
        await eventually { engine.commands(named: "ai.send").count == 1 }
        let args = engine.commands(named: "ai.send")[0]
        #expect(args["web"] == .bool(true))
        #expect(args["context"]?["kind"]?.string == "note")
    }

    @Test func withoutWebResearchThereIsNoResearchOrWeb() async {
        let engine = chatEngine(webResearch: false)
        let d = scratchDefaults()
        d.set("research", forKey: FoliChatModel.modeKey)
        let model = FoliChatModel(client: engine.client(), defaults: d)
        await eventually { model.caps != nil }
        #expect(model.effectiveMode == .chat)
        model.web = true
        #expect(!model.webOn)
        model.send("Hello")
        await eventually { engine.commands(named: "ai.send").count == 1 }
        #expect(engine.commands(named: "ai.send")[0]["mode"] == nil)
        #expect(engine.commands(named: "ai.send")[0]["web"] == nil)
    }

    @Test func proposedChangesMemoryAndAgentRun() async {
        let engine = chatEngine()
        let model = FoliChatModel(client: engine.client(), defaults: scratchDefaults())
        model.open(conversationId: "conv_1")
        await eventually { model.messages.count == 5 }
        let withActions = model.messages.first { !$0.actions.isEmpty }!
        model.applyActions(withActions, apply: true)
        model.memory(withActions, save: true)
        let run = model.messages.compactMap(\.agentRun).first!
        model.approve(run, operations: ["op_1"])
        await eventually { engine.commands(named: "ai.actions").count == 1 && engine.commands(named: "ai.memory").count == 1 && engine.commands(named: "ai.agentApprove").count == 1 }
        #expect(engine.commands(named: "ai.actions")[0]["apply"] == .bool(true))
        #expect(engine.commands(named: "ai.actions")[0]["messageId"]?.string == withActions.id)
        #expect(engine.commands(named: "ai.memory")[0]["save"] == .bool(true))
        #expect(engine.commands(named: "ai.agentApprove")[0]["operationIds"] == .array([.string("op_1")]))
        model.discard(run)
        await eventually { engine.commands(named: "ai.agentDiscard").count == 1 }
    }

    @Test func undoAsksWhenNotesChangedSince() async {
        let engine = chatEngine()
        let base = engine.onCommand
        engine.onCommand = { name, args in
            if name == "ai.agentUndo", args["force"] == nil { return .object(["status": .string("changed"), "changed": .array([.string("doc_00001")])]) }
            return try base(name, args)
        }
        let model = FoliChatModel(client: engine.client(), defaults: scratchDefaults())
        model.open(conversationId: "conv_1")
        await eventually { model.messages.count == 5 }
        let run = model.messages.compactMap(\.agentRun).first!
        model.undo(run)
        await eventually { model.undoConflict != nil }
        #expect(model.undoConflict?.changed == ["doc_00001"])
        model.undo(run, force: .all)
        await eventually { engine.commands(named: "ai.agentUndo").count == 2 }
        #expect(engine.commands(named: "ai.agentUndo")[1]["force"]?.string == "all")
        #expect(model.undoConflict == nil)
    }

    @Test func continueEditRegenerateAndErrors() async {
        let engine = chatEngine()
        engine.values["ai.conversation"] = conversationValue("c1", [chatMessage("u1", .user, "Tidy my notes"), chatMessage("a1", .assistant, "I tidied five of them.", agentMore: true)])
        let model = FoliChatModel(client: engine.client(), defaults: scratchDefaults())
        model.open(conversationId: "c1")
        await eventually { model.messages.count == 2 }
        let answer = model.messages[1]
        #expect(model.offersContinue(answer))
        model.continueAgent()
        await eventually { engine.commands(named: "ai.send").count == 1 }
        #expect(engine.commands(named: "ai.send")[0]["mode"]?.string == "agent")
        #expect(engine.commands(named: "ai.send")[0]["text"]?.string == FoliChatModel.continueText)
        engine.update(view: "ai.conversation", conversationValue("c1", [chatMessage("u1", .user, "Tidy my notes"), chatMessage("a1", .assistant, "I tidied five of them."), chatMessage("u2", .user, FoliChatModel.continueText), chatMessage("a2", .assistant, "Done with the rest.")]))
        await eventually { !model.isWorking && model.messages.count == 4 }
        #expect(model.lastUserMessageId == "u2")

        model.edit(model.messages[0])
        #expect(model.draft.isEmpty, "only the last question can be edited")
        model.edit(model.messages[2])
        #expect(model.draft == FoliChatModel.continueText)
        model.draft = "Tidy my work notes"
        model.send()
        await eventually { engine.commands(named: "ai.edit").count == 1 }
        #expect(engine.commands(named: "ai.edit")[0]["messageId"]?.string == "u2")
        #expect(engine.commands(named: "ai.edit")[0]["text"]?.string == "Tidy my work notes")
        await eventually { !model.sending }

        model.regenerate()
        await eventually { engine.commands(named: "ai.regenerate").count == 1 }
        await eventually { !model.sending }

        engine.onCommand = { _, _ in throw EngineFailure.engine(EngineError(code: "ai_credits_exhausted", message: "You've used this month's AI credits.")) }
        model.send("One more")
        await eventually { model.problem != nil }
        #expect(model.problem == "You've used this month's AI credits.")
        #expect(model.shownPending == nil)
    }

    @Test func historyRenamePinDeleteAndEphemeralClose() async {
        let engine = chatEngine()
        let model = FoliChatModel(client: engine.client(), defaults: scratchDefaults())
        let history = FoliHistoryModel(client: model.client)
        await eventually { !history.isLoading }
        #expect(history.pinned.map(\.title) == ["Trip planning"])
        #expect(history.recent.count == 2)
        model.rename("conv_2", to: "  Q4 summary ")
        model.pin("conv_2", true)
        await eventually { engine.commands(named: "ai.rename").count == 1 && engine.commands(named: "ai.pin").count == 1 }
        #expect(engine.commands(named: "ai.rename")[0]["title"]?.string == "Q4 summary")

        model.open(conversationId: "conv_1")
        await eventually { model.messages.count == 5 }
        model.remove("conv_1")
        #expect(model.isNew, "deleting the open chat starts a new one")
        await eventually { engine.commands(named: "ai.remove").count == 1 }

        engine.values["ai.conversation"] = conversationValue("eph", ephemeral: true, [chatMessage("u1", .user, "Hi"), chatMessage("a1", .assistant, "Hello.")])
        model.open(conversationId: "eph")
        await eventually { model.info?.ephemeral == true }
        #expect(model.footnote.contains("History is off"))
        model.closed()
        await eventually { engine.commands(named: "ai.remove").count == 2 }
        #expect(model.isNew)
    }

    @Test func citationsAndSavedNotesOpenRoutes() async {
        let engine = chatEngine()
        let log = FeedbackLog()
        let model = FoliChatModel(client: engine.client(), feedback: log.feedback, defaults: scratchDefaults())
        let log2 = RouteLog()
        model.onOpen = { log2.routes.append($0) }
        model.open(conversationId: "conv_1")
        await eventually { model.messages.count == 5 }
        model.openCitation(model.messages[1].citations[0])
        #expect(log2.routes == [.note(id: "doc_00001")])
        #expect(model.openLink(URL(string: "/d/doc_9")!))
        #expect(log2.routes.last == .note(id: "doc_9"))
        model.copy(model.messages[1])
        #expect(log.copied == ["The rail pass is still open. Want a packing list?"])
        model.saveAsNote(model.messages[1].id)
        await eventually { !log.toasts.isEmpty && log.toasts.contains { $0.message == "Saved as a note." } }
        log.toasts.first { $0.message == "Saved as a note." }?.action?()
        #expect(log2.routes.last == .note(id: "doc_saved"))
    }
}

@MainActor
final class RouteLog { var routes: [ScreenRoute] = [] }

// MARK: Markdown and reveal

@Suite("Foli AI Markdown")
struct FoliMarkdownTests {
    @Test func parsesTheBlocksAnswersUse() {
        let md = """
        # Title
        Some **bold** text [2] and `code`.

        - one
          continued
        - [x] done
        1. first

        > quoted

        ```js
        let a = 1
        ```

        | A | B |
        |---|:-:|
        | 1 | 2 |
        ---
        """
        let blocks = MarkdownBlocks.parse(md[...])
        #expect(blocks.map(\.kind) == [
            .heading(level: 1), .paragraph, .listItem(marker: "•", level: 0, task: nil), .listItem(marker: nil, level: 0, task: true),
            .listItem(marker: "1.", level: 0, task: nil), .quote, .code(language: "js", closed: true), .table(header: ["A", "B"], rows: [["1", "2"]]), .rule,
        ])
        #expect(blocks[2].source == "one\ncontinued")
        #expect(blocks.map(\.id) == Array(0..<blocks.count))
    }

    @Test func incrementalParsingMatchesAFullParseAtEveryStep() {
        let text = longAnswer(words: 600)
        var inc = IncrementalMarkdown()
        var i = text.startIndex
        var steps = 0
        while i < text.endIndex {
            i = text.index(i, offsetBy: 7 + (steps % 13), limitedBy: text.endIndex) ?? text.endIndex
            let prefix = String(text[..<i])
            inc.update(prefix)
            let full = MarkdownBlocks.parse(prefix[...])
            if inc.blocks != full {
                Issue.record("step \(steps): incremental differs from full parse")
                break
            }
            steps += 1
        }
        #expect(steps > 100)
    }

    @Test func anUnclosedFenceStreamsAsCode() {
        var inc = IncrementalMarkdown()
        inc.update("Intro\n\n```py\nprint(1)\n\nprint(2)")
        #expect(inc.blocks.last?.kind == .code(language: "py", closed: false))
        #expect(inc.blocks.last?.source == "print(1)\n\nprint(2)")
    }

    @Test func plainTextForCopy() {
        #expect(MarkdownPlain.plain("## Hi\n**Bold** and *it* [1].\n- a\n| x | y |\n|---|---|\n| 1 | 2 |") == "Hi\nBold and it.\n- a\nx\ty\n1\t2")
    }

    @Test func citationsBecomeTappableMarkers() {
        let s = InlineMarkdown.make("Open [1] now")
        #expect(s.runs.contains { $0.link?.absoluteString == "folevi-cite://1" })
        #expect(String(s.characters) == "Open 1 now")
    }

    @Test func revealEndsOnWordsAndCatchesUp() {
        var r = StreamReveal()
        r.receive("The quick brown fox jumps over the lazy dog and keeps on running far away")
        r.tick()
        #expect(r.shown.last.map { !$0.isWhitespace } ?? false)
        let after = r.target[r.shown.endIndex...]
        #expect(after.first?.isWhitespace == true)
        var n = 0
        while !r.caughtUp, n < 100 { r.tick(); n += 1 }
        #expect(r.caughtUp)
        r.receive("Something else")
        #expect(r.shownBytes == 0, "a regenerated answer starts over")
        r.tick(reduceMotion: true)
        #expect(r.caughtUp)
    }

    @Test func revealCatchesUpFastWhenFarBehind() {
        var r = StreamReveal()
        r.receive(longAnswer(words: 5000))
        var ticks = 0
        while !r.caughtUp { r.tick(); ticks += 1 }
        // 30 ms ticks: a 5,000-word answer that arrived at once is fully shown in a few seconds.
        #expect(ticks < 200, "\(ticks) ticks")
    }
}
