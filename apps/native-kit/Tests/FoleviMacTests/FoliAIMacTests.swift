// Foli AI on the Mac (Views/FoliAI): the AI page's route and tab, why Foli AI can't be used (AiUnavailable.tsx's
// copy, never a plan or a price in local mode), refusals as the web reads them, ages as the web writes them, and
// an agent's steps in words.
#if os(macOS)
import Foundation
import Testing
import FoleviEngine
@testable import FoleviMac

@Suite("Foli AI on the Mac") @MainActor
struct FoliAIMacTests {
    @Test func theAIPageIsOneTab() {
        #expect(FrameRoute(path: "/ai") == .web("/ai"))
        #expect(FrameRoute(path: "/ai").tabKey == "view:ai")
        #expect(FrameRoute(path: "/ai/01M5Z43CP97ENQ9KSQEP1YKAKQ").tabKey == "view:ai")
        #expect(FrameRoute(path: "/aide").tabKey == "view:web:/aide")
        #expect(FrameRoute(path: "/graph").tabKey == "view:web:/graph")
    }

    @Test @MainActor func unavailableCopy() {
        let setup = AiUnavailableView.copy("setup", local: true, purchases: false)
        #expect(setup.title == "Set up Foli AI on this Mac")
        #expect(setup.link?.section == "ai")
        // Local mode never talks about plans, whatever the reason says.
        let local = AiUnavailableView.copy("plan", local: true, purchases: false)
        #expect(local.title == "Set up Foli AI on this Mac")
        #expect(!local.body.contains("credit") && !local.body.contains("Pro"))
        let off = AiUnavailableView.copy("off", local: false, purchases: true)
        #expect(off.title == "Foli AI is turned off")
        let plan = AiUnavailableView.copy("plan", local: false, purchases: true)
        #expect(plan.link?.label == "Upgrade")
        // No buying here (iOS): no way to plans.
        #expect(AiUnavailableView.copy("workspacePlan", local: false, purchases: false).link == nil)
        for reason in ["off", "setup", "plan", "workspacePlan", "odd"] {
            let c = AiUnavailableView.copy(reason, local: false, purchases: true)
            #expect(!c.title.contains("—") && !c.body.contains("—"), "no em dashes")
            #expect(!c.title.contains("Foli ") || c.title.contains("Foli AI"), "the assistant is Foli AI")
        }
    }

    @Test func refusalsAsTheWebReadsThem() {
        let out = AiProblem(EngineError(code: "out_of_credits", message: "You've used this month's AI credits.", data: ["action": .string("buy")]))
        #expect(out.kind == .credits && out.action == "buy")
        let core = AiProblem(EngineError(code: "forbidden", message: "Foli AI isn't part of your plan.", data: ["reason": .string("ai_not_included")]))
        #expect(core.kind == .notIncluded && core.action == nil)
        let blocked = AiProblem(EngineError(code: "maintenance", message: "The AI couldn't help with that request."))
        #expect(blocked.kind == .other && blocked.message == "The AI couldn't help with that request.")
        let odd = AiProblem(EngineError(code: "out_of_credits", message: "x", data: ["action": .string("steal")]))
        #expect(odd.action == nil)
    }

    @Test func ages() {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let ms = { (s: Double) in (now.timeIntervalSince1970 - s) * 1000 }
        #expect(AiAge.text(ms(10), now: now) == "Just now")
        #expect(AiAge.text(ms(60), now: now) == "1 min ago")
        #expect(AiAge.text(ms(5 * 60), now: now) == "5 mins ago")
        #expect(AiAge.text(ms(2 * 3600), now: now) == "2 hours ago")
        #expect(AiAge.text(ms(3 * 86400), now: now) == "3 days ago")
    }

    @Test func agentStepsInWords() {
        let steps = [ChatAgentStep(tool: "search_notes", count: 4, ok: true), ChatAgentStep(tool: "get_note", count: 1, ok: true), ChatAgentStep(tool: "get_notes", count: 2, ok: true), ChatAgentStep(tool: "update_note", count: 1, ok: true), ChatAgentStep(tool: "search_notes", count: 0, ok: true), ChatAgentStep(tool: "create_note", count: 0, ok: false)]
        #expect(AiAgentSteps.lines(steps) == ["Searched notes 2 times", "Read 3 notes", "Proposed a change"])
    }

    @Test func phases() {
        #expect(AiAssistantMessage.phase("reading", hasText: false) == "Reading your notes…")
        #expect(AiAssistantMessage.phase(nil, hasText: false) == "Thinking…")
        #expect(AiAssistantMessage.phase("reading", hasText: true) == "Writing…")
    }
}
#endif
