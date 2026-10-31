// Debug builds only: a stand-in for the model when FOLEVI_FAKE_AI=1 (the screen diffs, scripts/screen-match.mjs,
// and checking Foli AI in the Simulator), the twin of the Mac's apps/mac/Folevi/Bridge/FakeAI.swift. It answers
// every request the same way, offline and free: nothing leaves the device, no key and no Apple Intelligence
// needed. Plumbing requests (JSON) get an empty object, titles a short title, everything else one fixed answer
// that cites the first note it was given, written out a few words at a time.
#if DEBUG
import Foundation

enum FakeAI {
    static var on: Bool { ProcessInfo.processInfo.environment["FOLEVI_FAKE_AI"] == "1" }

    static let capabilities: [String: Any] = [
        "onDevice": true, "onDeviceStatus": "available", "onDeviceContext": 8192,
        "keys": ["ai.openai": false, "ai.anthropic": false, "ai.google": false],
    ]

    static let answer = """
    Here is a plan for three days in Kyoto, from your notes [1].

    **Day 1:** the temples, and the moss garden at Saiho-ji in the morning.

    **Day 2:** a slow walk through Nishiki market, with lunch there.

    **Day 3:** pack light: passport, adapters and a rain jacket.
    """

    static func generate(_ req: AiRequest, onChunk: @escaping (String) -> Void) async -> AiResult {
        let system = (req.system ?? "").lowercased()
        if req.json { return AiResult(text: "{}", stopReason: "end", error: nil, errorCode: nil) }
        // (The local engine names a conversation with "Write a short title for this conversation" in its prompt.)
        let asked = req.messages.last?.content.lowercased() ?? ""
        if (system.contains("title") && !system.contains("answer")) || system.contains("name conversations") || asked.contains("write a short title") {
            return AiResult(text: "Three days in Kyoto", stopReason: "end", error: nil, errorCode: nil)
        }
        var shown = ""
        for (i, word) in answer.split(separator: " ", omittingEmptySubsequences: false).enumerated() {
            if Task.isCancelled { return AiResult(text: shown, stopReason: "cancelled", error: nil, errorCode: nil) }
            let piece = (i == 0 ? "" : " ") + word
            shown += piece
            onChunk(piece)
            try? await Task.sleep(for: .milliseconds(15))
        }
        return AiResult(text: answer, stopReason: "end", error: nil, errorCode: nil)
    }
}
#endif
