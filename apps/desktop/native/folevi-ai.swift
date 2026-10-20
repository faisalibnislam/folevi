// folevi-ai: Foli AI on this Mac with Apple's on-device model (FoundationModels), for local mode
// (docs/LOCAL_MODE_PLAN.md §4.2, R10; src/ai.ts drives it). Nothing leaves the Mac: the model runs here.
//
// It runs as long as the app wants it and speaks JSON lines: one request per line on stdin, answers on stdout.
// - {"id":"1","op":"availability"} -> {"id":"1","availability":"available","contextTokens":4096}
//   availability: "available" | "notSupported" (this Mac can't run Apple Intelligence, or macOS is older than
//   26, or this build has no FoundationModels) | "notEnabled" | "notReady" (still downloading) | "unknown".
// - {"id":"2","op":"generate","system":"...","messages":[{"role":"user","content":"..."}],"maxTokens":512,
//   "temperature":0.7,"json":false} (earlier turns go into the session's transcript) -> any number of {"id":"2","delta":"..."} then one
//   {"id":"2","done":true,"text":"...","stopReason":"end"|"length"|"cancelled"|"error","error":"...","errorCode":"..."}
//   (errorCode "context" when the request doesn't fit the model's context window).
// - {"id":"2","op":"cancel"} stops that generation (its "done" says "cancelled", with the text so far).
// - {"id":"3","op":"countTokens","text":"..."} -> {"id":"3","tokens":42}, or {"id":"3","tokens":null} when this
//   macOS has no token count (before 26.4): the app then estimates.
// Several requests can be in flight. stdin closing ends the helper once they have answered.
import Foundation
#if canImport(FoundationModels) && !FOLEVI_NO_FOUNDATION_MODELS
import FoundationModels
#endif

// ---------------------------------------------------------------- output

let outputLock = NSLock()
func emit(_ object: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: object, options: []) else { return }
    outputLock.lock()
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([0x0a]))
    outputLock.unlock()
}

func finish(_ id: String, text: String, stop: String, error: String? = nil, code: String? = nil) {
    var out: [String: Any] = ["id": id, "done": true, "text": text, "stopReason": stop]
    if let error = error { out["error"] = error }
    if let code = code { out["errorCode"] = code }
    emit(out)
}

/// The generations in flight, by request id (so "cancel" can stop one).
final class Running: @unchecked Sendable {
    private let lock = NSLock()
    private var tasks: [String: Task<Void, Never>] = [:]
    func add(_ id: String, _ task: Task<Void, Never>) {
        lock.lock(); tasks[id] = task; lock.unlock()
    }
    func remove(_ id: String) {
        lock.lock(); tasks[id] = nil; lock.unlock()
    }
    func cancel(_ id: String) {
        lock.lock(); let t = tasks[id]; lock.unlock()
        t?.cancel()
    }
    func has(_ id: String) -> Bool {
        lock.lock(); defer { lock.unlock() }
        return tasks[id] != nil
    }
}
let running = Running()
/// Work still answering (a generation, a token count): waited for when stdin closes.
let inFlight = DispatchGroup()

/// One request, checked: only what the protocol says, within sane sizes (src/ai.ts checks first too).
struct GenerateRequest: Sendable {
    let system: String
    let messages: [(role: String, content: String)]
    let maxTokens: Int?
    let temperature: Double?
    let json: Bool

    init?(_ req: [String: Any]) {
        guard let list = req["messages"] as? [[String: Any]], !list.isEmpty, list.count <= 64 else { return nil }
        var turns: [(role: String, content: String)] = []
        for m in list {
            guard let role = m["role"] as? String, role == "user" || role == "assistant",
                  let content = m["content"] as? String else { return nil }
            turns.append((role, content))
        }
        guard turns.last?.role == "user" else { return nil }
        messages = turns
        system = (req["system"] as? String) ?? ""
        if let n = req["maxTokens"] as? Int, n >= 1, n <= 32768 { maxTokens = n } else { maxTokens = nil }
        if let t = req["temperature"] as? Double, t >= 0, t <= 2 { temperature = t } else { temperature = nil }
        json = (req["json"] as? Bool) ?? false
    }

    var instructions: String? {
        var parts: [String] = []
        if !system.isEmpty { parts.append(system) }
        if json { parts.append("Answer with one JSON value only: no Markdown fences, no text before or after it.") }
        return parts.isEmpty ? nil : parts.joined(separator: "\n\n")
    }
}

// ---------------------------------------------------------------- the model

#if canImport(FoundationModels) && !FOLEVI_NO_FOUNDATION_MODELS

@available(macOS 26.0, *)
func availabilityName(_ model: SystemLanguageModel) -> String {
    switch model.availability {
    case .available:
        return "available"
    case .unavailable(let reason):
        switch reason {
        case .deviceNotEligible: return "notSupported"
        case .appleIntelligenceNotEnabled: return "notEnabled"
        case .modelNotReady: return "notReady"
        @unknown default: return "unknown"
        }
    @unknown default:
        return "unknown"
    }
}

func availability(_ id: String) {
    if #available(macOS 26.0, *) {
        let model = SystemLanguageModel.default
        let name = availabilityName(model)
        var out: [String: Any] = ["id": id, "availability": name]
        if name == "available" { out["contextTokens"] = model.contextSize }
        emit(out)
    } else {
        emit(["id": id, "availability": "notSupported"])
    }
}

/// What a failed generation tells the person, and its code for the app ("context", "rate", "unavailable").
func describe(_ error: Error) -> (message: String, code: String?) {
    if #available(macOS 27.0, *), let e = error as? LanguageModelError {
        switch e {
        case .contextSizeExceeded: return ("This is too long for Apple's on-device model.", "context")
        case .rateLimited: return ("Apple's on-device model is busy. Try again in a moment.", "rate")
        case .guardrailViolation, .refusal: return ("Apple's on-device model declined to answer this.", nil)
        case .unsupportedLanguageOrLocale: return ("Apple's on-device model doesn't support this language.", nil)
        default: return (e.localizedDescription, nil)
        }
    }
    if #available(macOS 27.0, *), let e = error as? SystemLanguageModel.Error {
        switch e {
        case .assetsUnavailable: return ("Apple's on-device model isn't ready on this Mac.", "unavailable")
        @unknown default: return (e.localizedDescription, nil)
        }
    }
    if #available(macOS 26.0, *), let e = error as? LanguageModelSession.GenerationError {
        switch e {
        case .exceededContextWindowSize: return ("This is too long for Apple's on-device model.", "context")
        case .assetsUnavailable: return ("Apple's on-device model isn't ready on this Mac.", "unavailable")
        case .rateLimited, .concurrentRequests: return ("Apple's on-device model is busy. Try again in a moment.", "rate")
        case .guardrailViolation, .refusal: return ("Apple's on-device model declined to answer this.", nil)
        case .unsupportedLanguageOrLocale: return ("Apple's on-device model doesn't support this language.", nil)
        default: return (e.localizedDescription, nil)
        }
    }
    return (error.localizedDescription, nil)
}

/// The instructions and the earlier turns, as the session's transcript; the last user turn is the prompt.
@available(macOS 26.0, *)
func transcript(_ req: GenerateRequest) -> Transcript {
    var entries: [Transcript.Entry] = []
    if let instructions = req.instructions {
        entries.append(.instructions(Transcript.Instructions(segments: [.text(Transcript.TextSegment(content: instructions))], toolDefinitions: [])))
    }
    for m in req.messages.dropLast() {
        let segments: [Transcript.Segment] = [.text(Transcript.TextSegment(content: m.content))]
        if m.role == "user" {
            entries.append(.prompt(Transcript.Prompt(segments: segments)))
        } else {
            entries.append(.response(Transcript.Response(assetIDs: [], segments: segments)))
        }
    }
    return Transcript(entries: entries)
}

@available(macOS 26.0, *)
func run(_ id: String, _ req: GenerateRequest) async {
    let model = SystemLanguageModel.default
    let status = availabilityName(model)
    guard status == "available" else {
        finish(id, text: "", stop: "error", error: "Apple's on-device model isn't available on this Mac (\(status)).", code: "unavailable")
        return
    }
    let session = LanguageModelSession(model: model, tools: [], transcript: transcript(req))
    let options = GenerationOptions(temperature: req.temperature, maximumResponseTokens: req.maxTokens)
    var text = ""
    var outputTokens = 0
    do {
        let stream = session.streamResponse(to: req.messages[req.messages.count - 1].content, options: options)
        for try await snapshot in stream {
            if Task.isCancelled { break }
            let full: String = snapshot.content
            // Snapshots carry the whole answer so far: send what's new.
            if full.hasPrefix(text) {
                let delta = String(full.dropFirst(text.count))
                if !delta.isEmpty { emit(["id": id, "delta": delta]) }
            }
            text = full
            if #available(macOS 27.0, *) { outputTokens = snapshot.usage.output.totalTokenCount }
        }
        if Task.isCancelled {
            finish(id, text: text, stop: "cancelled")
        } else if let max = req.maxTokens, outputTokens >= max {
            finish(id, text: text, stop: "length")
        } else {
            finish(id, text: text, stop: "end")
        }
    } catch is CancellationError {
        finish(id, text: text, stop: "cancelled")
    } catch {
        if Task.isCancelled {
            finish(id, text: text, stop: "cancelled")
            return
        }
        let d = describe(error)
        finish(id, text: text, stop: "error", error: d.message, code: d.code)
    }
}

func generate(_ id: String, _ req: GenerateRequest) {
    if #available(macOS 26.0, *) {
        inFlight.enter()
        let task = Task {
            await run(id, req)
            running.remove(id)
            inFlight.leave()
        }
        running.add(id, task)
    } else {
        finish(id, text: "", stop: "error", error: "Apple's on-device model needs macOS 26 or later.", code: "unavailable")
    }
}

func countTokens(_ id: String, _ text: String) {
    if #available(macOS 26.4, *) {
        inFlight.enter()
        Task {
            defer { inFlight.leave() }
            do {
                let n = try await SystemLanguageModel.default.tokenCount(for: text)
                emit(["id": id, "tokens": n])
            } catch {
                emit(["id": id, "tokens": NSNull()])
            }
        }
    } else {
        emit(["id": id, "tokens": NSNull()])
    }
}

#else

// Built without FoundationModels (an older SDK, or the Intel slice): the capability is simply off.
func availability(_ id: String) {
    emit(["id": id, "availability": "notSupported"])
}

func generate(_ id: String, _ req: GenerateRequest) {
    finish(id, text: "", stop: "error", error: "Apple's on-device model isn't in this build of Folevi.", code: "unavailable")
}

func countTokens(_ id: String, _ text: String) {
    emit(["id": id, "tokens": NSNull()])
}

#endif

// ---------------------------------------------------------------- requests

func handle(_ req: [String: Any]) {
    guard let id = req["id"] as? String, !id.isEmpty, id.count <= 64 else {
        emit(["id": NSNull(), "error": "A request needs an id."])
        return
    }
    switch req["op"] as? String {
    case "availability":
        availability(id)
    case "generate":
        guard !running.has(id) else {
            finish(id, text: "", stop: "error", error: "That request is already running.", code: "invalid")
            return
        }
        guard let g = GenerateRequest(req) else {
            finish(id, text: "", stop: "error", error: "Not a request Foli AI can send.", code: "invalid")
            return
        }
        generate(id, g)
    case "cancel":
        running.cancel(id)
    case "countTokens":
        guard let text = req["text"] as? String, text.utf8.count <= 1_000_000 else {
            emit(["id": id, "tokens": NSNull()])
            return
        }
        countTokens(id, text)
    default:
        emit(["id": id, "error": "Unknown request."])
    }
}

let reader = Thread {
    while let line = readLine(strippingNewline: true) {
        if line.isEmpty { continue }
        guard let data = line.data(using: .utf8),
              let req = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
            emit(["id": NSNull(), "error": "Not a JSON object."])
            continue
        }
        handle(req)
    }
    // stdin closed: the app is done with the helper. What's still answering finishes first (if the app is
    // gone, writing to the closed pipe ends the helper anyway).
    _ = inFlight.wait(timeout: .now() + 120)
    exit(0)
}
reader.stackSize = 1 << 20
reader.start()
dispatchMain()
