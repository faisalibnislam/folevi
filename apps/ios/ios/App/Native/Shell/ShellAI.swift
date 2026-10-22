// Foli AI in local mode on iPhone and iPad (docs/LOCAL_MODE_PLAN.md §4.1, §4.3, R10): `foleviShell.ai` and
// `foleviShell.secrets`, the iOS twin of the Mac's apps/desktop/src/ai.ts and native/folevi-ai.swift. A request
// goes either to Apple's on-device model (FoundationModels, iOS 26 and later on Apple Intelligence devices),
// or to one of the person's own providers (OpenAI, Anthropic, Google) over HTTPS with the key they stored. The
// keys stay in native code: they're read from the Keychain just before a request, go only in that provider's
// own header, and never reach the page, a log or an error message. Folevi's own servers are never contacted.
import Foundation
#if canImport(FoundationModels)
import FoundationModels
#endif

enum ShellSecrets {
    static let names: Set<String> = ["ai.openai", "ai.anthropic", "ai.google"]
    private static let service = "com.folevi.shell-secrets"

    static func has(_ name: String) -> Bool { names.contains(name) && get(name) != nil }
    static func get(_ name: String) -> String? { names.contains(name) ? Keychain.getString(service, name) : nil }

    static func set(_ name: String, _ value: String) throws {
        guard names.contains(name) else { throw LibraryError(.invalidArgument, "Folevi doesn't keep that.") }
        let v = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !v.isEmpty, v.count <= 4096, !v.contains("\n") else { throw LibraryError(.invalidArgument, "That doesn't look like a key.") }
        guard Keychain.setString(service, name, v) else { throw LibraryError(.io, "Folevi couldn't keep that key.") }
    }

    static func delete(_ name: String) throws {
        guard names.contains(name) else { throw LibraryError(.invalidArgument, "Folevi doesn't keep that.") }
        Keychain.delete(service, name)
    }
}

struct AiRequest {
    var provider: String
    var model: String?
    var system: String?
    var messages: [(role: String, content: String)]
    var maxTokens: Int?
    var temperature: Double?
    var json: Bool
    var schema: Any?
}

struct AiResult {
    var text: String
    var stopReason: String
    var error: String?
    var errorCode: String?

    var json: [String: Any] {
        var o: [String: Any] = ["text": text, "stopReason": stopReason]
        if let error { o["error"] = error }
        if let errorCode { o["errorCode"] = errorCode }
        return o
    }
}

enum ShellAI {
    static let keyProviders = ["openai", "anthropic", "google"]
    static let hosts = ["openai": "api.openai.com", "anthropic": "api.anthropic.com", "google": "generativelanguage.googleapis.com"]
    /// Used when a request names no model (the Mac's DEFAULT_MODELS).
    static let defaultModels = ["openai": "gpt-6.1-sol", "anthropic": "claude-sonnet-5-5", "google": "gemini-3.8-flash"]
    static let names = ["openai": "OpenAI", "anthropic": "Anthropic", "google": "Google"]
    static let modelPattern = #"^[A-Za-z0-9._:-]{1,80}$"#
    static let maxTurns = 64
    static let maxRequestBytes = 400 * 1024
    static let reasoningHeadroom = 2048
    private static let jsonOnly = "Answer with one JSON value only: no Markdown fences, no text before or after it."

    // MARK: checking a request

    static func check(_ input: [String: Any]) -> Result<AiRequest, AiError> {
        let bad = { (e: String) in Result<AiRequest, AiError>.failure(AiError(message: e)) }
        guard let provider = input["provider"] as? String, provider == "on-device" || keyProviders.contains(provider) else { return bad("Foli AI can't use that provider.") }
        if let m = input["model"] {
            guard let s = m as? String, s.range(of: modelPattern, options: .regularExpression) != nil, !s.hasPrefix(".") else { return bad("That isn't a model name Foli AI can use.") }
        }
        if input["system"] != nil, !(input["system"] is String) { return bad("Not a request Foli AI can send.") }
        guard let list = input["messages"] as? [[String: Any]], !list.isEmpty, list.count <= maxTurns else { return bad("A request has between 1 and \(maxTurns) messages.") }
        var messages: [(role: String, content: String)] = []
        for m in list {
            guard let role = m["role"] as? String, role == "user" || role == "assistant", let content = m["content"] as? String else { return bad("Not a request Foli AI can send.") }
            messages.append((role, content))
        }
        guard messages.last?.role == "user" else { return bad("The last message of a request is the person's.") }
        var maxTokens: Int?
        if let n = input["maxTokens"] {
            guard let i = (n as? NSNumber)?.intValue, Double(i) == (n as? NSNumber)?.doubleValue, i >= 1, i <= 32768 else { return bad("maxTokens is between 1 and 32768.") }
            maxTokens = i
        }
        var temperature: Double?
        if let t = input["temperature"] {
            guard let d = (t as? NSNumber)?.doubleValue, d >= 0, d <= 2 else { return bad("temperature is between 0 and 2.") }
            temperature = d
        }
        let schema = input["schema"].flatMap { $0 is NSNull ? nil : $0 }
        var schemaBytes = 0
        if let schema {
            guard JSONSerialization.isValidJSONObject(schema), let d = try? JSONSerialization.data(withJSONObject: schema) else { return bad("The answer's schema isn't JSON.") }
            guard d.count <= 32 * 1024 else { return bad("The answer's schema is too long.") }
            schemaBytes = d.count
        }
        let system = input["system"] as? String
        let bytes = (system?.utf8.count ?? 0) + schemaBytes + messages.reduce(0) { $0 + $1.content.utf8.count }
        guard bytes <= maxRequestBytes else { return bad("This is too long for Foli AI to send in one request.") }
        return .success(AiRequest(provider: provider, model: input["model"] as? String, system: system, messages: messages, maxTokens: maxTokens, temperature: temperature, json: (input["json"] as? Bool) == true, schema: schema))
    }

    struct AiError: Error { let message: String }

    /// The instructions sent: the page's system prompt, plus the JSON rule and the schema when asked for.
    static func instructions(_ req: AiRequest) -> String? {
        var parts: [String] = []
        if let s = req.system, !s.isEmpty { parts.append(s) }
        if req.json || req.schema != nil { parts.append(jsonOnly) }
        if let schema = req.schema, let d = try? JSONSerialization.data(withJSONObject: schema), let s = String(data: d, encoding: .utf8) { parts.append("The JSON follows this JSON Schema:\n\(s)") }
        return parts.isEmpty ? nil : parts.joined(separator: "\n\n")
    }

    // MARK: the providers' requests

    static func buildRequest(_ provider: String, _ req: AiRequest, key: String, probe: Bool = false) throws -> URLRequest {
        let model = req.model ?? defaultModels[provider]!
        guard model.range(of: modelPattern, options: .regularExpression) != nil, !model.hasPrefix(".") else { throw AiError(message: "That isn't a model name Foli AI can use.") }
        let system = instructions(req)
        let budget = req.maxTokens.map { $0 + reasoningHeadroom }
        var url: URL
        var headers = ["content-type": "application/json"]
        var body: [String: Any]
        switch provider {
        case "openai":
            body = ["model": model, "input": req.messages.map { ["role": $0.role, "content": $0.content] }, "stream": !probe, "store": false, "reasoning": ["effort": "low"]]
            if let system { body["instructions"] = system }
            if probe { body["max_output_tokens"] = 16 } else if let budget { body["max_output_tokens"] = budget }
            if req.json || req.schema != nil { body["text"] = ["format": ["type": "json_object"]] }
            url = URL(string: "https://api.openai.com/v1/responses")!
            headers["authorization"] = "Bearer \(key)"
        case "anthropic":
            body = ["model": model, "max_tokens": probe ? 8 : (budget ?? 8192), "messages": req.messages.map { ["role": $0.role, "content": $0.content] }, "stream": !probe]
            if let system { body["system"] = system }
            url = URL(string: "https://api.anthropic.com/v1/messages")!
            headers["x-api-key"] = key
            headers["anthropic-version"] = "2023-06-01"
        default:
            var config: [String: Any] = [:]
            if let t = req.temperature { config["temperature"] = t }
            if probe { config["maxOutputTokens"] = 8 } else if let budget { config["maxOutputTokens"] = budget }
            if req.json || req.schema != nil { config["responseMimeType"] = "application/json" }
            body = ["contents": req.messages.map { ["role": $0.role == "assistant" ? "model" : "user", "parts": [["text": $0.content]]] }, "generationConfig": config]
            if let system { body["systemInstruction"] = ["parts": [["text": system]]] }
            guard let encoded = model.addingPercentEncoding(withAllowedCharacters: .alphanumerics.union(CharacterSet(charactersIn: "-._"))) else { throw AiError(message: "That isn't a model name Foli AI can use.") }
            var c = URLComponents(string: "https://generativelanguage.googleapis.com/v1beta/models/\(encoded):\(probe ? "generateContent" : "streamGenerateContent")")!
            if !probe { c.queryItems = [URLQueryItem(name: "alt", value: "sse")] }
            url = c.url!
            headers["x-goog-api-key"] = key
        }
        guard allowed(url, provider) else { throw AiError(message: "Foli AI only talks to the provider's own address.") }
        var r = URLRequest(url: url)
        r.httpMethod = "POST"
        for (k, v) in headers { r.setValue(v, forHTTPHeaderField: k) }
        r.httpBody = try JSONSerialization.data(withJSONObject: body)
        r.timeoutInterval = 90
        return r
    }

    /// https, exactly the provider's host, the default port, no user or password.
    static func allowed(_ url: URL, _ provider: String) -> Bool {
        url.scheme == "https" && url.host == hosts[provider] && url.port == nil && url.user == nil && url.password == nil
    }

    static func scrub(_ text: String, key: String?) -> String {
        var out = text
        if let key, !key.isEmpty { out = out.replacingOccurrences(of: key, with: "[key]") }
        return out.replacingOccurrences(of: #"\b(sk-[A-Za-z0-9_-]{8,}|AIza[A-Za-z0-9_-]{20,})"#, with: "[key]", options: .regularExpression)
    }

    private static let contextHint = try! NSRegularExpression(pattern: "context|too long|too many tokens|maximum.*tokens|token.*limit|exceeds", options: .caseInsensitive)
    private static func hints(_ s: String) -> Bool { contextHint.firstMatch(in: s, range: NSRange(location: 0, length: (s as NSString).length)) != nil }

    static func httpError(_ provider: String, status: Int, body: String, model: String) -> (String, String?) {
        let name = names[provider]!
        var message = ""
        var code = ""
        if let d = try? JSONSerialization.jsonObject(with: Data(body.utf8)) as? [String: Any] {
            let e = d["error"] as? [String: Any] ?? [:]
            message = (e["message"] as? String) ?? (d["message"] as? String) ?? ""
            code = (e["code"] as? String) ?? (e["type"] as? String) ?? (e["status"] as? String) ?? ""
            if let details = e["details"] as? [[String: Any]] { code += " " + details.compactMap { $0["reason"] as? String }.joined(separator: " ") }
        }
        let both = "\(code) \(message)"
        if status == 401 || status == 403 || both.range(of: "API_KEY_INVALID|API key not valid|invalid.api.key|authentication_error", options: [.regularExpression, .caseInsensitive]) != nil {
            return ("The \(name) key was refused. Check it in Settings > AI.", "auth")
        }
        if status == 429 {
            if both.range(of: "insufficient_quota|quota|billing|credit", options: [.regularExpression, .caseInsensitive]) != nil { return ("The \(name) account is out of credit or over its quota.", "rate") }
            return ("\(name) asked Foli AI to slow down. Try again in a moment.", "rate")
        }
        if (status == 400 || status == 413) && (code.contains("context_length_exceeded") || hints(message)) { return ("This is too long for \(name)'s model.", "context") }
        if status == 404 { return ("\(name) doesn't offer the model \"\(model)\" to this key.", "invalid") }
        if status >= 500 { return ("\(name) isn't answering right now. Try again later.", "unavailable") }
        let said = message.isEmpty ? "" : ": \(message.prefix(300))"
        return ("\(name) refused the request (\(status))\(said)", status == 400 ? "invalid" : nil)
    }

    // MARK: server-sent events

    struct StreamState {
        var text = ""
        var stop: String?
        var error: String?
        var errorCode: String?
    }

    /// One event's new text (and how the stream ended, in `state`), per provider (the Mac's handlers).
    static func apply(_ provider: String, event: String, data: String, _ state: inout StreamState) -> String {
        guard let d = try? JSONSerialization.jsonObject(with: Data(data.utf8)) as? [String: Any] else { return "" }
        switch provider {
        case "openai":
            let type = (d["type"] as? String) ?? event
            if type == "response.output_text.delta" { return d["delta"] as? String ?? "" }
            if type == "response.completed" { state.stop = state.stop ?? "end" }
            else if type == "response.incomplete" {
                let reason = ((d["response"] as? [String: Any])?["incomplete_details"] as? [String: Any])?["reason"] as? String
                if reason == "content_filter" { state.stop = "error"; state.error = "OpenAI stopped this answer (its content filter)." } else { state.stop = "length" }
            } else if type == "response.failed" || type == "error" {
                let e = type == "error" ? ((d["error"] as? [String: Any]) ?? d) : (((d["response"] as? [String: Any])?["error"] as? [String: Any]) ?? [:])
                let code = e["code"] as? String ?? ""
                let message = e["message"] as? String ?? ""
                state.stop = "error"
                if code == "context_length_exceeded" || (code.isEmpty && hints(message) && message.lowercased().contains("context")) {
                    state.errorCode = "context"; state.error = "This is too long for OpenAI's model."
                } else if code == "rate_limit_exceeded" {
                    state.errorCode = "rate"; state.error = "OpenAI asked Foli AI to slow down. Try again in a moment."
                } else { state.error = message.isEmpty ? "OpenAI couldn't answer." : "OpenAI: \(message)" }
            }
            return ""
        case "anthropic":
            let type = (d["type"] as? String) ?? event
            if type == "content_block_delta" {
                let delta = d["delta"] as? [String: Any] ?? [:]
                return delta["type"] as? String == "text_delta" ? (delta["text"] as? String ?? "") : ""
            }
            if type == "message_delta" {
                let reason = (d["delta"] as? [String: Any])?["stop_reason"] as? String ?? ""
                if reason == "max_tokens" || reason == "model_context_window_exceeded" { state.stop = "length" }
                else if reason == "refusal" { state.stop = "error"; state.error = "Claude declined to answer this." }
                else if !reason.isEmpty { state.stop = "end" }
            } else if type == "message_stop" { state.stop = state.stop ?? "end" }
            else if type == "error" {
                let e = d["error"] as? [String: Any] ?? [:]
                state.stop = "error"
                if e["type"] as? String == "rate_limit_error" || e["type"] as? String == "overloaded_error" {
                    state.errorCode = "rate"; state.error = "Anthropic asked Foli AI to slow down. Try again in a moment."
                } else { state.error = (e["message"] as? String).map { "Anthropic: \($0)" } ?? "Anthropic couldn't answer." }
            }
            return ""
        default:
            if let e = d["error"] as? [String: Any] {
                state.stop = "error"
                state.error = (e["message"] as? String).map { "Google: \($0)" } ?? "Google couldn't answer."
                return ""
            }
            if let blocked = (d["promptFeedback"] as? [String: Any])?["blockReason"] as? String, !blocked.isEmpty {
                state.stop = "error"
                state.error = "Gemini didn't answer this (\(blocked.lowercased()))."
                return ""
            }
            let candidate = (d["candidates"] as? [[String: Any]])?.first ?? [:]
            let parts = ((candidate["content"] as? [String: Any])?["parts"] as? [[String: Any]]) ?? []
            let text = parts.map { ($0["thought"] as? Bool) == true ? "" : ($0["text"] as? String ?? "") }.joined()
            let finish = candidate["finishReason"] as? String ?? ""
            if finish == "MAX_TOKENS" { state.stop = "length" }
            else if finish == "STOP" { state.stop = "end" }
            else if !finish.isEmpty && finish != "FINISH_REASON_UNSPECIFIED" {
                state.stop = "error"
                state.error = "Gemini stopped this answer (\(finish.lowercased().replacingOccurrences(of: "_", with: " ")))."
            }
            return text
        }
    }

    /// An incremental text/event-stream parser.
    struct SseParser {
        private var event = ""
        private var data: [String] = []

        mutating func line(_ line: String) -> (event: String, data: String)? {
            if line.isEmpty {
                defer { event = ""; data = [] }
                return data.isEmpty ? nil : (event.isEmpty ? "message" : event, data.joined(separator: "\n"))
            }
            if line.hasPrefix(":") { return nil }
            let field: String
            var value: String
            if let colon = line.firstIndex(of: ":") {
                field = String(line[..<colon])
                value = String(line[line.index(after: colon)...])
                if value.hasPrefix(" ") { value.removeFirst() }
            } else {
                field = line
                value = ""
            }
            if field == "event" { event = value } else if field == "data" { data.append(value) }
            return nil
        }
    }

    private static let session: URLSession = {
        let c = URLSessionConfiguration.ephemeral
        c.httpCookieStorage = nil
        c.httpShouldSetCookies = false
        c.urlCache = nil
        return URLSession(configuration: c, delegate: NoRedirects(), delegateQueue: nil)
    }()

    // MARK: generating

    /// Streams an answer: `onChunk` gets each new piece; returns the whole text and how it ended.
    static func generate(_ req: AiRequest, onChunk: @escaping (String) -> Void) async -> AiResult {
        if req.provider == "on-device" { return await OnDeviceModel.generate(req, onChunk: onChunk) }
        let provider = req.provider
        let name = names[provider]!
        guard let key = ShellSecrets.get("ai.\(provider)") else { return AiResult(text: "", stopReason: "error", error: "Add your \(name) key in Settings > AI first.", errorCode: "auth") }
        var state = StreamState()
        do {
            let request = try buildRequest(provider, req, key: key)
            let (bytes, response) = try await session.bytes(for: request)
            guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
            if (300..<400).contains(http.statusCode) || !(http.url.map { allowed($0, provider) } ?? false) {
                return AiResult(text: "", stopReason: "error", error: "\(name) answered from somewhere else; Foli AI didn't follow.", errorCode: "network")
            }
            if !(200..<300).contains(http.statusCode) {
                var body = Data()
                for try await b in bytes {
                    body.append(b)
                    if body.count > 65536 { break }
                }
                let e = httpError(provider, status: http.statusCode, body: String(data: body, encoding: .utf8) ?? "", model: req.model ?? defaultModels[provider]!)
                return AiResult(text: "", stopReason: "error", error: scrub(e.0, key: key), errorCode: e.1)
            }
            var parser = SseParser()
            var line = Data()
            func take(_ text: String) {
                if let ev = parser.line(text) {
                    let piece = apply(provider, event: ev.event, data: ev.data, &state)
                    if !piece.isEmpty {
                        state.text += piece
                        onChunk(piece)
                    }
                }
            }
            for try await b in bytes {
                if Task.isCancelled { return AiResult(text: state.text, stopReason: "cancelled") }
                if b == 0x0a {
                    if line.last == 0x0d { line.removeLast() }
                    take(String(data: line, encoding: .utf8) ?? "")
                    line.removeAll(keepingCapacity: true)
                } else {
                    line.append(b)
                }
            }
            if !line.isEmpty { take(String(data: line, encoding: .utf8) ?? "") }
            take("")
            if state.stop == nil {
                // Gemini's stream simply ends; the others always say how it ended, so a silent end was cut off.
                if provider == "google" { state.stop = "end" } else { return AiResult(text: state.text, stopReason: "error", error: "The answer from \(name) was cut off.", errorCode: "network") }
            }
            return AiResult(text: state.text, stopReason: state.stop!, error: state.error.map { scrub($0, key: key) }, errorCode: state.errorCode)
        } catch let e as AiError {
            return AiResult(text: "", stopReason: "error", error: scrub(e.message, key: key), errorCode: "invalid")
        } catch {
            if Task.isCancelled { return AiResult(text: state.text, stopReason: "cancelled") }
            return AiResult(text: state.text, stopReason: "error", error: "Foli AI couldn't reach \(name). Check the connection.", errorCode: "network")
        }
    }

    /// Checks a stored key with one tiny request (Settings > AI, "Test").
    static func testKey(_ provider: String) async -> [String: Any] {
        guard keyProviders.contains(provider), let name = names[provider] else { return ["ok": false, "error": "Foli AI can't use that provider."] }
        guard let key = ShellSecrets.get("ai.\(provider)") else { return ["ok": false, "error": "Add your \(name) key first."] }
        let probe = AiRequest(provider: provider, model: nil, system: nil, messages: [("user", "Say OK.")], maxTokens: nil, temperature: nil, json: false, schema: nil)
        do {
            var request = try buildRequest(provider, probe, key: key, probe: true)
            request.timeoutInterval = 30
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
            if (200..<300).contains(http.statusCode) { return ["ok": true] }
            let e = httpError(provider, status: http.statusCode, body: String(data: data, encoding: .utf8) ?? "", model: defaultModels[provider]!)
            return ["ok": false, "error": scrub(e.0, key: key)]
        } catch {
            return ["ok": false, "error": "Foli AI couldn't reach \(name). Check the connection."]
        }
    }

    static func capabilities() -> [String: Any] {
        let device = OnDeviceModel.availability()
        var keys: [String: Bool] = [:]
        for n in ShellSecrets.names { keys[n] = ShellSecrets.has(n) }
        var out: [String: Any] = ["onDevice": device.status == "available", "onDeviceStatus": device.status, "keys": keys]
        if let c = device.context { out["onDeviceContext"] = c }
        return out
    }
}

/// Apple's on-device model (FoundationModels): iOS 26 and later, on devices with Apple Intelligence turned on.
enum OnDeviceModel {
    static func availability() -> (status: String, context: Int?) {
        #if canImport(FoundationModels)
        if #available(iOS 26.0, macOS 26.0, *) {
            let model = SystemLanguageModel.default
            switch model.availability {
            case .available: return ("available", model.contextSize)
            case .unavailable(let reason):
                switch reason {
                case .deviceNotEligible: return ("notSupported", nil)
                case .appleIntelligenceNotEnabled: return ("notEnabled", nil)
                case .modelNotReady: return ("notReady", nil)
                @unknown default: return ("unknown", nil)
                }
            @unknown default: return ("unknown", nil)
            }
        }
        #endif
        return ("notSupported", nil)
    }

    static func generate(_ req: AiRequest, onChunk: @escaping (String) -> Void) async -> AiResult {
        #if canImport(FoundationModels)
        if #available(iOS 26.0, macOS 26.0, *) { return await run(req, onChunk: onChunk) }
        #endif
        return AiResult(text: "", stopReason: "error", error: "Apple's on-device model needs iOS 26 or later.", errorCode: "unavailable")
    }

    #if canImport(FoundationModels)
    @available(iOS 26.0, macOS 26.0, *)
    private static func describe(_ error: Error) -> (String, String?) {
        if let e = error as? LanguageModelSession.GenerationError {
            switch e {
            case .exceededContextWindowSize: return ("This is too long for Apple's on-device model.", "context")
            case .assetsUnavailable: return ("Apple's on-device model isn't ready on this device.", "unavailable")
            case .rateLimited, .concurrentRequests: return ("Apple's on-device model is busy. Try again in a moment.", "rate")
            case .guardrailViolation, .refusal: return ("Apple's on-device model declined to answer this.", nil)
            case .unsupportedLanguageOrLocale: return ("Apple's on-device model doesn't support this language.", nil)
            default: return (e.localizedDescription, nil)
            }
        }
        return (error.localizedDescription, nil)
    }

    @available(iOS 26.0, macOS 26.0, *)
    private static func run(_ req: AiRequest, onChunk: @escaping (String) -> Void) async -> AiResult {
        let model = SystemLanguageModel.default
        let status = availability().status
        guard status == "available" else { return AiResult(text: "", stopReason: "error", error: "Apple's on-device model isn't available on this device (\(status)).", errorCode: "unavailable") }
        var entries: [Transcript.Entry] = []
        if let instructions = ShellAI.instructions(req) {
            entries.append(.instructions(Transcript.Instructions(segments: [.text(Transcript.TextSegment(content: instructions))], toolDefinitions: [])))
        }
        for m in req.messages.dropLast() {
            let segments: [Transcript.Segment] = [.text(Transcript.TextSegment(content: m.content))]
            entries.append(m.role == "user" ? .prompt(Transcript.Prompt(segments: segments)) : .response(Transcript.Response(assetIDs: [], segments: segments)))
        }
        let session = LanguageModelSession(model: model, tools: [], transcript: Transcript(entries: entries))
        let options = GenerationOptions(temperature: req.temperature, maximumResponseTokens: req.maxTokens)
        var text = ""
        do {
            for try await snapshot in session.streamResponse(to: req.messages[req.messages.count - 1].content, options: options) {
                if Task.isCancelled { break }
                let full: String = snapshot.content
                // Snapshots carry the whole answer so far: send what's new.
                if full.hasPrefix(text) {
                    let delta = String(full.dropFirst(text.count))
                    if !delta.isEmpty { onChunk(delta) }
                }
                text = full
            }
            return AiResult(text: text, stopReason: Task.isCancelled ? "cancelled" : "end")
        } catch is CancellationError {
            return AiResult(text: text, stopReason: "cancelled")
        } catch {
            if Task.isCancelled { return AiResult(text: text, stopReason: "cancelled") }
            let d = describe(error)
            return AiResult(text: text, stopReason: "error", error: d.0, errorCode: d.1)
        }
    }
    #endif
}
