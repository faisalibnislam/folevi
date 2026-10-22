package com.folevi.android.ai

import org.json.JSONArray
import org.json.JSONObject

/**
 * Foli AI with the person's own key in local mode (docs/LOCAL_MODE.md WP11): the request checks, the HTTPS
 * request for each provider, their streams and their errors, the same as the Mac's apps/desktop/src/ai.ts (and
 * its tests' cases, AiProvidersTest). Nothing goes through Folevi; the key is read from the Keystore just before a
 * request, only ever put in the provider's header, and scrubbed from anything said back.
 */
object AiProviders {
    val KEY_PROVIDERS = listOf("openai", "anthropic", "google")
    val PROVIDERS = listOf("on-device") + KEY_PROVIDERS

    /** The only hosts ever requested (https, default port). Never Folevi's own. */
    val HOSTS = mapOf("openai" to "api.openai.com", "anthropic" to "api.anthropic.com", "google" to "generativelanguage.googleapis.com")

    /** Used when a request names no model (the Mac's DEFAULT_MODELS). */
    val DEFAULT_MODELS = mapOf("openai" to "gpt-6.1-sol", "anthropic" to "claude-sonnet-5-5", "google" to "gemini-3.8-flash")
    val NAMES = mapOf("openai" to "OpenAI", "anthropic" to "Anthropic", "google" to "Google")

    val MODEL_ID = Regex("^[A-Za-z0-9._:-]{1,80}$")
    const val MAX_TURNS = 64
    const val MAX_REQUEST_BYTES = 400 * 1024
    private const val MAX_SCHEMA_BYTES = 32 * 1024
    const val REASONING_HEADROOM = 2048
    private const val ANTHROPIC_DEFAULT_MAX = 8192
    const val JSON_ONLY = "Answer with one JSON value only: no Markdown fences, no text before or after it."

    data class Message(val role: String, val content: String)

    data class Request(
        val provider: String,
        val model: String? = null,
        val system: String? = null,
        val messages: List<Message>,
        val maxTokens: Int? = null,
        val temperature: Double? = null,
        val json: Boolean = false,
        val schema: String? = null,
    )

    class Refused(message: String) : Exception(message)

    /** A request from the page, checked field by field; anything else is refused with a plain reason. */
    fun check(r: JSONObject?): Request {
        if (r == null) throw Refused("Not a request Foli AI can send.")
        val provider = r.optString("provider")
        if (provider !in PROVIDERS) throw Refused("Foli AI can't use that provider.")
        val model = if (r.has("model") && !r.isNull("model")) r.optString("model").also { if (!MODEL_ID.matches(it) || it.startsWith(".")) throw Refused("That isn't a model name Foli AI can use.") } else null
        val system = if (r.has("system") && !r.isNull("system")) (r.get("system") as? String ?: throw Refused("Not a request Foli AI can send.")) else null
        val arr = r.optJSONArray("messages") ?: throw Refused("A request has between 1 and $MAX_TURNS messages.")
        if (arr.length() == 0 || arr.length() > MAX_TURNS) throw Refused("A request has between 1 and $MAX_TURNS messages.")
        val messages = (0 until arr.length()).map { i ->
            val m = arr.optJSONObject(i) ?: throw Refused("Not a request Foli AI can send.")
            val role = m.optString("role")
            val content = m.opt("content") as? String ?: throw Refused("Not a request Foli AI can send.")
            if (role != "user" && role != "assistant") throw Refused("Not a request Foli AI can send.")
            Message(role, content)
        }
        if (messages.last().role != "user") throw Refused("The last message of a request is the person's.")
        val maxTokens = if (r.has("maxTokens") && !r.isNull("maxTokens")) {
            val v = r.get("maxTokens")
            if (v !is Int || v < 1 || v > 32768) throw Refused("maxTokens is between 1 and 32768.")
            v
        } else null
        val temperature = if (r.has("temperature") && !r.isNull("temperature")) {
            val v = (r.get("temperature") as? Number)?.toDouble() ?: throw Refused("temperature is between 0 and 2.")
            if (v.isNaN() || v < 0 || v > 2) throw Refused("temperature is between 0 and 2.")
            v
        } else null
        val json = r.optBoolean("json", false)
        val schema = if (r.has("schema") && !r.isNull("schema")) r.get("schema").toString().also { if (it.toByteArray().size > MAX_SCHEMA_BYTES) throw Refused("The answer's schema is too long.") } else null
        val bytes = (system ?: "").toByteArray().size + (schema ?: "").toByteArray().size + messages.sumOf { it.content.toByteArray().size }
        if (bytes > MAX_REQUEST_BYTES) throw Refused("This is too long for Foli AI to send in one request.")
        return Request(provider, model, system, messages, maxTokens, temperature, json, schema)
    }

    /** The instructions sent: the page's system prompt, plus the JSON rule and the schema when asked for. */
    fun instructions(req: Request): String? {
        val parts = ArrayList<String>()
        req.system?.takeIf { it.isNotEmpty() }?.let { parts.add(it) }
        if (req.json || req.schema != null) parts.add(JSON_ONLY)
        if (req.schema != null) parts.add("The JSON follows this JSON Schema:\n${req.schema}")
        return if (parts.isEmpty()) null else parts.joinToString("\n\n")
    }

    data class HttpRequest(val url: String, val headers: Map<String, String>, val body: String)

    /** The HTTPS request for one generation (or, with `probe`, a tiny one that checks the key). */
    fun build(provider: String, req: Request, key: String, probe: Boolean = false): HttpRequest {
        val model = req.model ?: DEFAULT_MODELS.getValue(provider)
        if (!MODEL_ID.matches(model) || model.startsWith(".")) throw Refused("That isn't a model name Foli AI can use.")
        val system = instructions(req)
        val budget = req.maxTokens?.let { it + REASONING_HEADROOM }
        val turns = JSONArray().apply { req.messages.forEach { put(JSONObject().put("role", it.role).put("content", it.content)) } }
        return when (provider) {
            "openai" -> {
                val body = JSONObject().put("model", model).put("input", turns).put("stream", !probe).put("store", false).put("reasoning", JSONObject().put("effort", "low"))
                if (system != null) body.put("instructions", system)
                if (probe) body.put("max_output_tokens", 16) else if (budget != null) body.put("max_output_tokens", budget)
                if (req.json || req.schema != null) body.put("text", JSONObject().put("format", JSONObject().put("type", "json_object")))
                HttpRequest("https://api.openai.com/v1/responses", mapOf("content-type" to "application/json", "authorization" to "Bearer $key"), body.toString())
            }
            "anthropic" -> {
                val body = JSONObject().put("model", model).put("max_tokens", if (probe) 8 else budget ?: ANTHROPIC_DEFAULT_MAX).put("messages", turns).put("stream", !probe)
                if (system != null) body.put("system", system)
                HttpRequest("https://api.anthropic.com/v1/messages", mapOf("content-type" to "application/json", "x-api-key" to key, "anthropic-version" to "2023-06-01"), body.toString())
            }
            "google" -> {
                val config = JSONObject()
                req.temperature?.let { config.put("temperature", it) }
                if (probe) config.put("maxOutputTokens", 8) else if (budget != null) config.put("maxOutputTokens", budget)
                if (req.json || req.schema != null) config.put("responseMimeType", "application/json")
                val contents = JSONArray().apply { req.messages.forEach { put(JSONObject().put("role", if (it.role == "assistant") "model" else "user").put("parts", JSONArray().put(JSONObject().put("text", it.content)))) } }
                val body = JSONObject().put("contents", contents).put("generationConfig", config)
                if (system != null) body.put("systemInstruction", JSONObject().put("parts", JSONArray().put(JSONObject().put("text", system))))
                val path = "/v1beta/models/${java.net.URLEncoder.encode(model, "UTF-8")}:${if (probe) "generateContent" else "streamGenerateContent"}"
                if (path.contains("..")) throw Refused("That isn't a model name Foli AI can use.")
                HttpRequest("https://generativelanguage.googleapis.com$path${if (probe) "" else "?alt=sse"}", mapOf("content-type" to "application/json", "x-goog-api-key" to key), body.toString())
            }
            else -> throw Refused("Foli AI can't use that provider.")
        }
    }

    /** Whether an address is one of the providers' own (https, the exact host, the default port). */
    fun allowed(url: String, provider: String): Boolean {
        val u = runCatching { java.net.URI(url) }.getOrNull() ?: return false
        return u.scheme == "https" && u.port == -1 && u.userInfo == null && u.host == HOSTS[provider]
    }

    /** Removes the key (and anything shaped like a provider key) from text before it goes anywhere. */
    fun scrub(text: String, key: String?): String {
        var out = text
        if (!key.isNullOrEmpty()) out = out.replace(key, "[key]")
        return out.replace(Regex("\\b(sk-[A-Za-z0-9_-]{8,}|AIza[A-Za-z0-9_-]{20,})"), "[key]")
    }

    private val CONTEXT_HINT = Regex("context|too long|too many tokens|maximum.*tokens|token.*limit|exceeds", RegexOption.IGNORE_CASE)

    /** What an HTTP error from a provider means, in words for people (never the key). */
    fun httpError(provider: String, status: Int, body: String, model: String): Pair<String, String?> {
        val name = NAMES.getValue(provider)
        var message = ""
        var code = ""
        runCatching {
            val d = JSONObject(body)
            val e = d.optJSONObject("error") ?: JSONObject()
            message = e.optString("message").ifEmpty { d.optString("message") }
            code = e.optString("code").ifEmpty { e.optString("type") }.ifEmpty { e.optString("status") }
            e.optJSONArray("details")?.let { a -> val r = (0 until a.length()).joinToString(" ") { a.optJSONObject(it)?.optString("reason").orEmpty() }; if (r.isNotBlank()) code = "$code $r" }
        }
        val both = "$code $message"
        if (status == 401 || status == 403 || Regex("API_KEY_INVALID|API key not valid|invalid.api.key|authentication_error", RegexOption.IGNORE_CASE).containsMatchIn(both))
            return "The $name key was refused. Check it in Settings > AI." to "auth"
        if (status == 429) {
            if (Regex("insufficient_quota|quota|billing|credit", RegexOption.IGNORE_CASE).containsMatchIn(both)) return "The $name account is out of credit or over its quota." to "rate"
            return "$name asked Foli AI to slow down. Try again in a moment." to "rate"
        }
        if ((status == 400 || status == 413) && (code.contains("context_length_exceeded") || CONTEXT_HINT.containsMatchIn(message))) return "This is too long for $name's model." to "context"
        if (status == 404) return "$name doesn't offer the model \"$model\" to this key." to "invalid"
        if (status >= 500) return "$name isn't answering right now. Try again later." to "unavailable"
        val said = if (message.isNotEmpty()) ": ${message.take(300)}" else ""
        return "$name refused the request ($status)$said" to (if (status == 400) "invalid" else null)
    }

    // ---------------------------------------------------------------- streams

    data class SseEvent(val event: String, val data: String)

    /** An incremental text/event-stream parser: feed it lines as they arrive, get whole events. */
    class SseParser {
        private var event = ""
        private val data = ArrayList<String>()

        fun line(line: String): SseEvent? {
            if (line.isEmpty()) {
                val out = if (data.isNotEmpty()) SseEvent(event.ifEmpty { "message" }, data.joinToString("\n")) else null
                event = ""
                data.clear()
                return out
            }
            if (line.startsWith(":")) return null
            val colon = line.indexOf(':')
            val field = if (colon == -1) line else line.substring(0, colon)
            var value = if (colon == -1) "" else line.substring(colon + 1)
            if (value.startsWith(" ")) value = value.substring(1)
            if (field == "event") event = value else if (field == "data") data.add(value)
            return null
        }

        fun end(): SseEvent? = line("")
    }

    /** What a stream said so far: how it ended. */
    class StreamState {
        var stop: String? = null
        var error: String? = null
        var errorCode: String? = null
    }

    /** Applies one event to the state; returns the new text it carried. */
    fun onEvent(provider: String, ev: SseEvent, state: StreamState): String {
        val d = runCatching { JSONObject(ev.data) }.getOrNull() ?: return ""
        return when (provider) {
            "openai" -> {
                when (val type = d.optString("type").ifEmpty { ev.event }) {
                    "response.output_text.delta" -> return d.optString("delta")
                    "response.completed" -> if (state.stop == null) state.stop = "end"
                    "response.incomplete" -> {
                        val reason = d.optJSONObject("response")?.optJSONObject("incomplete_details")?.optString("reason")
                        if (reason == "content_filter") {
                            state.stop = "error"; state.error = "OpenAI stopped this answer (its content filter)."
                        } else state.stop = "length"
                    }
                    "response.failed", "error" -> {
                        val e = if (type == "error") d.optJSONObject("error") ?: d else d.optJSONObject("response")?.optJSONObject("error") ?: JSONObject()
                        val code = e.optString("code")
                        val message = e.optString("message")
                        state.stop = "error"
                        if (code == "context_length_exceeded" || (code.isEmpty() && CONTEXT_HINT.containsMatchIn(message) && message.contains("context", true))) {
                            state.errorCode = "context"; state.error = "This is too long for OpenAI's model."
                        } else if (code == "rate_limit_exceeded") {
                            state.errorCode = "rate"; state.error = "OpenAI asked Foli AI to slow down. Try again in a moment."
                        } else state.error = if (message.isNotEmpty()) "OpenAI: $message" else "OpenAI couldn't answer."
                    }
                }
                ""
            }
            "anthropic" -> {
                when (d.optString("type").ifEmpty { ev.event }) {
                    "content_block_delta" -> {
                        val delta = d.optJSONObject("delta") ?: JSONObject()
                        return if (delta.optString("type") == "text_delta") delta.optString("text") else ""
                    }
                    "message_delta" -> {
                        val reason = d.optJSONObject("delta")?.optString("stop_reason").orEmpty()
                        when {
                            reason == "max_tokens" || reason == "model_context_window_exceeded" -> state.stop = "length"
                            reason == "refusal" -> { state.stop = "error"; state.error = "Claude declined to answer this." }
                            reason.isNotEmpty() -> state.stop = "end"
                        }
                    }
                    "message_stop" -> if (state.stop == null) state.stop = "end"
                    "error" -> {
                        val e = d.optJSONObject("error") ?: JSONObject()
                        state.stop = "error"
                        if (e.optString("type") == "rate_limit_error" || e.optString("type") == "overloaded_error") {
                            state.errorCode = "rate"; state.error = "Anthropic asked Foli AI to slow down. Try again in a moment."
                        } else state.error = e.optString("message").takeIf { it.isNotEmpty() }?.let { "Anthropic: $it" } ?: "Anthropic couldn't answer."
                    }
                }
                ""
            }
            else -> {
                d.optJSONObject("error")?.let { e ->
                    state.stop = "error"
                    state.error = e.optString("message").takeIf { it.isNotEmpty() }?.let { "Google: $it" } ?: "Google couldn't answer."
                    return ""
                }
                val blocked = d.optJSONObject("promptFeedback")?.optString("blockReason").orEmpty()
                if (blocked.isNotEmpty()) {
                    state.stop = "error"; state.error = "Gemini didn't answer this (${blocked.lowercase()})."
                    return ""
                }
                val candidate = d.optJSONArray("candidates")?.optJSONObject(0) ?: JSONObject()
                val parts = candidate.optJSONObject("content")?.optJSONArray("parts") ?: JSONArray()
                val text = (0 until parts.length()).joinToString("") { i -> parts.optJSONObject(i)?.let { p -> if (p.optBoolean("thought", false)) "" else p.optString("text") }.orEmpty() }
                when (val finish = candidate.optString("finishReason")) {
                    "MAX_TOKENS" -> state.stop = "length"
                    "STOP" -> state.stop = "end"
                    "", "FINISH_REASON_UNSPECIFIED" -> Unit
                    else -> { state.stop = "error"; state.error = "Gemini stopped this answer (${finish.lowercase().replace('_', ' ')})." }
                }
                text
            }
        }
    }
}
