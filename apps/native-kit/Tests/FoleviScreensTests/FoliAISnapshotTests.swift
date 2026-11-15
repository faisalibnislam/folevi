// Foli AI chat (N12) drawn in real windows: snapshots light and dark at iPhone and iPad sizes (iOS Simulator)
// or the Mac size (macOS); a frame strip of an answer streaming in over 2 s; and the performance of a
// 5,000-word answer streamed into the chat.
//
//   FOLEVI_SCREENS_OUT=/dir   every picture at 2x      FOLEVI_AI_FRAMES=/dir   the streaming frame strip
import Foundation
import SwiftUI
import Testing
@testable import FoleviDesign
@testable import FoleviEngine
@testable import FoleviScreens
import FoleviPhone
#if os(macOS)
@testable import FoleviMac
#endif
#if canImport(UIKit)
import UIKit
#else
import AppKit
#endif

@MainActor
func richConversation() -> JSONValue {
    let answer = """
    ## What's left for Kyoto

    Two things are still open in **Kyoto in November** [1]:

    1. The rail pass, best bought a week ahead
    2. A dinner booking for the last night

    | Item | Status |
    | --- | --- |
    | Hotel | Booked |
    | Rail pass | Open |

    Want me to make a packing list?
    """
    let run = ChatAgentRun(id: "run_1", status: "preview", operations: [
        ChatAgentOperation(id: "op_1", kind: "edit_note", summary: "Add a packing list", status: "pending", noteId: "doc_00001", noteTitle: "Kyoto in November", edits: [ChatAgentEdit(action: "insert", before: "", after: "- Passport\n- Rail pass")]),
    ])
    return conversationValue("conv_1", title: "Trip planning for Kyoto in November with the family", [
        chatMessage("u1", .user, "What's left to book for Kyoto?"),
        chatMessage("a1", .assistant, answer, citations: [ChatCitation(n: 1, noteId: "doc_00001", title: "Kyoto in November")], actions: [ChatAction(type: "createNote", title: "Packing list", markdown: "- Passport", folderName: "Trips")], memory: ChatMemoryOffer(kind: "length", text: "Keeps answers short", status: "proposed")),
        chatMessage("u2", .user, "Add a packing list to the note"),
        chatMessage("a2", .assistant, "I can add the packing list to **Kyoto in November**.", suggestions: ["Also add a day-by-day plan", "What's the weather like?"], agentRun: run),
    ])
}

extension Rendering {
@Suite("Foli AI chat snapshots", .serialized) @MainActor
struct FoliAISnapshotTests {
    init() { ScreenClock.fixed = fixedNow }

    func run(_ name: String, reference: Bool, model: FoliChatModel, ready: @escaping () -> Bool) async {
        for size in hostSizes {
            for scheme in [ColorScheme.light, .dark] {
                let host = ScreenHost(chatFrame(model, size: size), size: size, scheme: scheme)
                await eventually(name, timeout: .seconds(8), ready)
                await host.settle(0.6)
                checkScreen(host, named: "\(name)-\(size.rawValue)-\(scheme == .dark ? "dark" : "light")-\(hostPlatform)", reference: reference)
                host.close()
            }
        }
    }

    /// The chat as each device shows it: the iPhone sheet fills the width, the iPad form sheet is 560 wide, the
    /// Mac panel 440.
    @ViewBuilder
    func chatFrame(_ model: FoliChatModel, size: DeviceSize) -> some View {
        switch size {
        case .iphone:
            FoliAIChatView(model: model, compact: true).padding(.top, 8)
        case .ipad:
            FoliAIChatView(model: model, compact: false)
                .frame(width: 560, height: 760)
                .clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color.black.opacity(0.2))
        case .mac:
            FoliAIChatView(model: model, compact: false)
                .frame(width: 440, height: 720)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color.gray.opacity(0.25))
        }
    }

    @Test(arguments: [false, true]) func streamingBlocksKeepTheSameLayout(phone: Bool) async throws {
        let answer = FoliAnswer(messageId: "layout")
        answer.show("""
        ## A guide

        A **bold** paragraph with *emphasis*, a [link](https://example.com) and a source [1].

        - First item
        - Second item

        > A quotation

        | Day | Plan |
        | --- | --- |
        | One | Explore |

        ```swift
        let days = 3
        ```
        """[...])
        for scheme in [ColorScheme.light, .dark] {
            let live = ScreenHost(ScrollView { AiAnswerText(answer: answer, cited: [1]).environment(\.aiPhone, phone)
                .frame(width: phone ? 350 : 440) }, size: hostSizes[0], scheme: scheme)
            await live.settle()
            let liveImage = try #require(live.image(scale: 1))
            live.close()
            let settled = ScreenHost(ScrollView { AiAnswerText(blocks: answer.blocks, cited: [1]).environment(\.aiPhone, phone)
                .frame(width: phone ? 350 : 440) }, size: hostSizes[0], scheme: scheme)
            await settled.settle()
            let settledImage = try #require(settled.image(scale: 1))
            settled.close()
            // Use the existing snapshot policy: up to 1% of pixels may vary by >10 levels due to text
            // antialiasing at fractional positions in lazy/eager containers. Layout and styling stay the same.
            let a = screenPixels(liveImage), b = screenPixels(settledImage)
            let off = stride(from: 0, to: a.count, by: 4).filter { i in
                (0..<3).contains { abs(Int(a[i + $0]) - Int(b[i + $0])) > 10 }
            }.count
            let same = Double(off) / Double(a.count / 4) <= 0.01
            if !same {
                let stem = "folevi-answer-\(phone)-\(scheme == .dark ? "dark" : "light")"
                for (name, image) in [("live", liveImage), ("settled", settledImage)] {
                    if let png = screenPNG(image) { Attachment.record(png, named: "\(stem)-\(name).png") }
                }
            }
            #expect(same, "Per-block observation preserves the finished answer's layout and styling")
        }
    }

    #if os(iOS)
    @Test func phoneThreadKeepsReadingPosition() async throws {
        let engine = chatEngine()
        let text = longAnswer(words: 1800)
        engine.values["ai.conversation"] = conversationValue("c1", title: "Guide", [chatMessage("a1", .assistant, "", status: "streaming", live: true, phase: "writing")])
        engine.values["ai.stream"] = streamValue("a1", text)
        let model = FoliChatModel(client: engine.client(), defaults: scratchDefaults())
        model.reduceMotion = true
        model.open(conversationId: "c1")
        let host = ScreenHost(PhoneAiThread(model: model, variant: .sheet, host: PhoneAiHost(session: nil), menus: PhoneMenus()), size: .iphone, scheme: .light)
        defer { host.close() }
        await eventually { model.answer("a1")?.shownText == text }
        await host.settle(0.5)
        let scroll = try #require(host.scrollView())
        scroll.setContentOffset(CGPoint(x: 0, y: 200), animated: false)
        await host.settle(0.3)
        let reading = scroll.contentOffset.y
        engine.update(view: "ai.stream", streamValue("a1", text + "\n\nMore words arrive while reading earlier paragraphs."))
        await host.settle(0.5)
        #expect(abs(scroll.contentOffset.y - reading) < 2, "Streaming must not pull a reader back to the bottom")
    }
    #endif

    @Test func conversation() async {
        let engine = chatEngine()
        engine.values["ai.conversation"] = richConversation()
        let model = FoliChatModel(client: engine.client(), defaults: scratchDefaults())
        model.reduceMotion = true
        model.open(conversationId: "conv_1")
        await run("foli-chat", reference: true, model: model, ready: { model.messages.count == 4 && model.caps != nil && model.session.value != nil })
    }

    @Test func emptyWithSuggestions() async {
        let engine = chatEngine()
        let model = FoliChatModel(client: engine.client(), defaults: scratchDefaults())
        await run("foli-empty", reference: true, model: model, ready: { model.caps != nil && model.session.value != nil })
    }

    @Test func aboutAFolderInResearchMode() async {
        let engine = chatEngine()
        let d = scratchDefaults()
        d.set("research", forKey: FoliChatModel.modeKey)
        let model = FoliChatModel(client: engine.client(), about: .folder(id: "fld_trips", name: "Trips"), defaults: d)
        await run("foli-research-empty", reference: false, model: model, ready: { model.caps != nil })
    }

    @Test func history() async {
        let engine = chatEngine()
        let model = FoliChatModel(client: engine.client(), defaults: scratchDefaults())
        model.historyOpen = true
        await run("foli-history", reference: true, model: model, ready: { model.caps != nil && engine.watches.values.contains { $0["name"]?.string == "ai.conversations" } })
    }

    @Test func streaming() async {
        let engine = chatEngine()
        let model = FoliChatModel(client: engine.client(), defaults: scratchDefaults())
        model.reduceMotion = true
        model.open(conversationId: "conv_1")
        await run("foli-streaming", reference: false, model: model, ready: { model.answer("msg_4")?.shownText.isEmpty == false })
    }

    /// An answer streaming in over 2 s on the iPhone: a picture every 200 ms (FOLEVI_AI_FRAMES), and the thread
    /// keeps the end in view the whole time (it follows without jumping back).
    @Test func streamingFrameStrip() async throws {
        let engine = chatEngine()
        let answer = longAnswer(words: 260)
        engine.values["ai.conversation"] = conversationValue("c1", title: "Kyoto", [chatMessage("u1", .user, "Plan three days in Kyoto"), chatMessage("a1", .assistant, "", status: "streaming", live: true, phase: "reading")])
        engine.values["ai.stream"] = streamValue("a1", "")
        let model = FoliChatModel(client: engine.client(), defaults: scratchDefaults())
        model.open(conversationId: "c1")
        let host = ScreenHost(chatFrame(model, size: hostSizes[0]), size: hostSizes[0], scheme: .light)
        defer { host.close() }
        await eventually { model.messages.count == 2 }
        await host.settle(0.3)
        let out = ProcessInfo.processInfo.environment["FOLEVI_AI_FRAMES"].map { URL(fileURLWithPath: $0) }
        if let out { try? FileManager.default.createDirectory(at: out, withIntermediateDirectories: true) }
        let words = answer.split(separator: " ", omittingEmptySubsequences: false)
        var frame = 0
        var gaps: [CGFloat] = []
        let t0 = CFAbsoluteTimeGetCurrent()
        for i in 1...40 {
            engine.update(view: "ai.stream", streamValue("a1", words[..<(words.count * i / 40)].joined(separator: " ")))
            try? await Task.sleep(for: .milliseconds(50))
            if i % 4 == 0 {
                if let out, let image = host.image(scale: 2), let png = screenPNG(image) {
                    try? png.write(to: out.appendingPathComponent(String(format: "frame-%02d-%04dms.png", frame, Int((CFAbsoluteTimeGetCurrent() - t0) * 1000))))
                }
                frame += 1
                if let gap = endGap(host) { gaps.append(gap) }
            }
        }
        engine.update(view: "ai.conversation", conversationValue("c1", title: "Kyoto", [chatMessage("u1", .user, "Plan three days in Kyoto"), chatMessage("a1", .assistant, answer, citations: [ChatCitation(n: 1, noteId: "doc_00001", title: "Kyoto in November")])]))
        engine.update(view: "ai.stream", streamValue("a1", nil))
        await eventually("revealed", timeout: .seconds(10)) { !model.isWorking && model.answer("a1")?.revealing == false }
        await host.settle(0.5)
        if let out, let image = host.image(scale: 2), let png = screenPNG(image) { try? png.write(to: out.appendingPathComponent(String(format: "frame-%02d-done.png", frame))) }
        print("FOLI frame strip: \(frame) frames; distance from the end at each frame (pt): \(gaps.map { Int($0) })")
        #expect(!gaps.isEmpty, "the answer grew taller than the thread")
        #expect(gaps.allSatisfy { $0 < 200 }, "the thread kept the end in view: \(gaps)")
    }

    /// How far the thread's visible bottom is from its content's end (the tallest scroll view in the chat).
    func endGap(_ host: ScreenHost) -> CGFloat? {
        #if os(iOS)
        func all(_ v: UIView) -> [UIScrollView] { ((v as? UIScrollView).map { [$0] } ?? []) + v.subviews.flatMap(all) }
        guard let s = all(host.controller.view).filter({ $0.contentSize.height > $0.bounds.height + 10 }).max(by: { $0.bounds.height < $1.bounds.height }) else { return nil }
        return s.contentSize.height - (s.contentOffset.y + s.bounds.height - s.adjustedContentInset.bottom)
        #else
        func all(_ v: NSView) -> [NSScrollView] { ((v as? NSScrollView).map { [$0] } ?? []) + v.subviews.flatMap(all) }
        guard let s = all(host.view).filter({ ($0.documentView?.frame.height ?? 0) > $0.bounds.height + 10 }).max(by: { $0.bounds.height < $1.bounds.height }) else { return nil }
        let doc = s.documentView!
        let visible = s.contentView.bounds
        return doc.isFlipped ? doc.frame.height - visible.maxY : visible.minY
        #endif
    }
}

@Suite("Streaming a 5,000-word answer", .serialized) @MainActor
struct FoliStreamingPerformanceTests {
    @ViewBuilder
    private func streamingView(_ model: FoliChatModel, sharedAnswer: Bool) -> some View {
        if sharedAnswer {
            // Exercise the shipping thread and composer as well as the legacy chat, including scrolling.
            #if os(iOS)
            PhoneAiThread(model: model, variant: .sheet, host: PhoneAiHost(session: model.session.value), menus: PhoneMenus())
            #else
            AiThreadView(model: model, variant: .floating, host: AiHost(session: model.session.value), autoFocus: false)
                .frame(width: 440)
            #endif
        } else {
            FoliAIChatView(model: model, compact: hostSizes[0] == .iphone)
        }
    }

    /// Parser cost alone: the incremental parse against re-parsing the whole answer for every update.
    @Test func incrementalParserAgainstFullReparse() {
        let text = longAnswer(words: 5000)
        let words = text.split(separator: " ", omittingEmptySubsequences: false)
        let steps = 500
        var prefixes: [String] = []
        for i in 1...steps { prefixes.append(words[..<(words.count * i / steps)].joined(separator: " ")) }
        var inc = IncrementalMarkdown()
        var incTimes: [Double] = []
        for p in prefixes {
            let t0 = CFAbsoluteTimeGetCurrent()
            inc.update(p)
            incTimes.append((CFAbsoluteTimeGetCurrent() - t0) * 1000)
        }
        var fullTimes: [Double] = []
        for p in prefixes.suffix(50) {
            let t0 = CFAbsoluteTimeGetCurrent()
            _ = MarkdownBlocks.parse(p[...])
            fullTimes.append((CFAbsoluteTimeGetCurrent() - t0) * 1000)
        }
        let incSorted = incTimes.sorted()
        let fullAvg = fullTimes.reduce(0, +) / Double(fullTimes.count)
        print("PERF \(hostPlatform) markdown 5000 words (\(text.count) chars, \(inc.blocks.count) blocks), \(steps) updates: incremental avg \(String(format: "%.3f", incTimes.reduce(0, +) / Double(steps))) ms, p95 \(String(format: "%.3f", incSorted[Int(Double(steps) * 0.95)])) ms, max \(String(format: "%.3f", incSorted.last!)) ms; full re-parse at the end \(String(format: "%.3f", fullAvg)) ms per update")
        #expect(inc.blocks == MarkdownBlocks.parse(prefixes.last![...]))
        #expect(incSorted[Int(Double(steps) * 0.95)] < fullAvg, "the incremental update is cheaper than a full parse")
    }

    /// The whole chat on the iPhone size (Mac size on macOS): 500 stream updates of about 10 words each, one
    /// every 16 ms (a 60 Hz frame) while the word-by-word reveal runs, and then until the reveal has caught up.
    /// Measures how late each 16 ms wake-up of the main thread is (the frame interval: anything over 16.7 ms is
    /// main-thread work in the way: decoding, the reveal, the incremental parse, SwiftUI's update and layout,
    /// following the end), and counts how many blocks were turned into attributed text. Budgets are loose
    /// (Simulator and debug builds on a busy machine), like the list test's.
    @Test(arguments: [false, true]) func streamsIntoTheChat(sharedAnswer: Bool) async throws {
        let engine = chatEngine()
        let text = longAnswer(words: 5000)
        engine.values["ai.conversation"] = conversationValue("c1", title: "Kyoto", [chatMessage("u1", .user, "Write me a long guide"), chatMessage("a1", .assistant, "", status: "streaming", live: true, phase: "writing")])
        engine.values["ai.stream"] = streamValue("a1", "")
        let model = FoliChatModel(client: engine.client(), defaults: scratchDefaults())
        model.open(conversationId: "c1")
        let host = ScreenHost(streamingView(model, sharedAnswer: sharedAnswer), size: hostSizes[0], scheme: .light)
        defer { host.close() }
        await eventually { model.messages.count == 2 }
        await host.settle(0.3)
        let makesBefore = InlineMarkdown.makes
        let words = text.split(separator: " ", omittingEmptySubsequences: false)
        let steps = 500
        var intervals: [Double] = []
        var last = CFAbsoluteTimeGetCurrent()
        func frame() async {
            try? await Task.sleep(for: .milliseconds(16))
            let now = CFAbsoluteTimeGetCurrent()
            intervals.append((now - last) * 1000)
            last = now
        }
        // The same wake-ups with nothing happening: what the timer alone gives on this machine.
        for _ in 0..<60 { await frame() }
        let idle = intervals.sorted()
        intervals = []
        let t0 = CFAbsoluteTimeGetCurrent()
        for i in 1...steps {
            engine.update(view: "ai.stream", streamValue("a1", words[..<(words.count * i / steps)].joined(separator: " ")))
            await frame()
        }
        let streamed = CFAbsoluteTimeGetCurrent() - t0
        engine.update(view: "ai.conversation", conversationValue("c1", title: "Kyoto", [chatMessage("u1", .user, "Write me a long guide"), chatMessage("a1", .assistant, text)]))
        engine.update(view: "ai.stream", streamValue("a1", nil))
        let revealStart = CFAbsoluteTimeGetCurrent()
        while model.answer("a1")?.revealing != false, CFAbsoluteTimeGetCurrent() - revealStart < 20 { await frame() }
        let catchUp = CFAbsoluteTimeGetCurrent() - revealStart
        let blocks = model.answer("a1")?.blocks.count ?? 0
        let makes = InlineMarkdown.makes - makesBefore
        let buildCount = sharedAnswer ? "current renderer (separate text renderer)" : "\(makes) attributed-text builds"
        let sorted = intervals.sorted()
        let avg = intervals.reduce(0, +) / Double(intervals.count)
        let p95 = sorted[Int(Double(sorted.count) * 0.95)]
        let late = intervals.filter { $0 > 33.4 }.count
        let report = "PERF \(hostPlatform) \(sharedAnswer ? "current chat" : "chat") stream 5000 words, \(steps) updates over \(String(format: "%.1f", streamed)) s + reveal \(String(format: "%.1f", catchUp)) s: frame interval avg \(String(format: "%.2f", avg)) ms, p95 \(String(format: "%.2f", p95)) ms, max \(String(format: "%.2f", sorted.last ?? 0)) ms, \(late) of \(intervals.count) frames over 33 ms (idle: avg \(String(format: "%.2f", idle.reduce(0, +) / Double(idle.count))) ms, p95 \(String(format: "%.2f", idle[Int(Double(idle.count) * 0.95)])) ms); \(blocks) blocks, \(buildCount)"
        print(report)
        Attachment.record(report, named: "stream-\(sharedAnswer ? "shared" : "legacy")-\(hostPlatform).txt")
        #expect(model.answer("a1")?.shownText == text)
        #expect(p95 < 33.4, "p95 frame interval \(p95) ms")
        // Settled blocks are built once (and again only when a lazy row is recreated), not once per update.
        if !sharedAnswer { #expect(makes < blocks * 3, "\(makes) builds for \(blocks) blocks") }
        await host.settle(0.3)
        if let gap = FoliAISnapshotTests().endGap(host) {
            if gap >= 200, let image = host.image(scale: 1), let png = screenPNG(image) {
                Attachment.record(png, named: "stream-end-\(sharedAnswer).png")
                #if os(iOS)
                func scrolls(_ v: UIView) -> [UIScrollView] { ((v as? UIScrollView).map { [$0] } ?? []) + v.subviews.flatMap(scrolls) }
                let geometry = scrolls(host.controller.view).map { "\(type(of: $0)) bounds=\($0.bounds) content=\($0.contentSize) offset=\($0.contentOffset)" }.joined(separator: "\n")
                Attachment.record(geometry, named: "stream-scrolls-\(sharedAnswer).txt")
                #endif
            }
            #expect(gap < 200, "The growing answer stays in view: \(gap) pt from the end")
        }
    }
}
}
