package com.folevi.android.ai

import com.folevi.android.secure.Secrets
import com.google.mlkit.genai.common.FeatureStatus
import com.google.mlkit.genai.common.StreamingCallback
import com.google.mlkit.genai.prompt.Generation
import com.google.mlkit.genai.prompt.GenerativeModel
import com.google.mlkit.genai.prompt.SystemInstruction
import com.google.mlkit.genai.prompt.TextPart
import com.google.mlkit.genai.prompt.generateContentRequest
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

/**
 * Foli AI in local mode on Android (docs/ANDROID_PLAN.md "Local mode"): Gemini Nano on the phone, through ML Kit's
 * GenAI Prompt API where Android's AICore has the model, or the person's own OpenAI, Anthropic or Google key,
 * called straight from the phone. The same requests and answers as the Mac's ai.ts (`foleviShell.ai`).
 */
class AiService(private val secrets: Secrets, http: OkHttpClient, private val onDevice: OnDevice? = GeminiNano()) {
    /** The on-device model: Gemini Nano (a fake in tests). */
    interface OnDevice {
        /** "available", "notSupported", "notReady" (downloading or downloadable), "notEnabled" or "unknown". */
        suspend fun status(): String
        suspend fun contextTokens(): Int?
        suspend fun generate(system: String?, prompt: String, maxTokens: Int?, temperature: Double?, onText: (String) -> Unit): String
    }

    data class Result(val text: String, val stopReason: String, val error: String? = null, val errorCode: String? = null) {
        fun json(): JSONObject = JSONObject().put("text", text).put("stopReason", stopReason).apply {
            error?.let { put("error", it) }
            errorCode?.let { put("errorCode", it) }
        }
    }

    private val client = http.newBuilder().readTimeout(120, TimeUnit.SECONDS).callTimeout(10, TimeUnit.MINUTES).followRedirects(false).followSslRedirects(false).build()
    private val calls = ConcurrentHashMap<String, okhttp3.Call>()
    private val cancelled = ConcurrentHashMap.newKeySet<String>()

    suspend fun capabilities(): JSONObject {
        val status = runCatching { onDevice?.status() }.getOrNull() ?: "unknown"
        val keys = JSONObject()
        for (p in AiProviders.KEY_PROVIDERS) keys.put("ai.$p", secrets.get("ai.$p") != null)
        val out = JSONObject().put("onDevice", status == "available").put("onDeviceStatus", status).put("keys", keys)
        if (status == "available") runCatching { onDevice?.contextTokens() }.getOrNull()?.let { out.put("onDeviceContext", it) }
        return out
    }

    fun cancel(id: String) {
        cancelled.add(id)
        calls.remove(id)?.cancel()
    }

    suspend fun generate(id: String, raw: JSONObject?, onChunk: (String) -> Unit): Result {
        val req = try {
            AiProviders.check(raw)
        } catch (e: AiProviders.Refused) {
            return Result("", "error", e.message, "invalid")
        }
        return try {
            if (req.provider == "on-device") generateOnDevice(id, req, onChunk) else generateWithKey(id, req, onChunk)
        } catch (e: CancellationException) {
            Result("", "cancelled")
        } finally {
            calls.remove(id)
            cancelled.remove(id)
        }
    }

    private suspend fun generateOnDevice(id: String, req: AiProviders.Request, onChunk: (String) -> Unit): Result {
        val model = onDevice ?: return Result("", "error", "Gemini Nano isn't on this phone.", "unavailable")
        val status = runCatching { model.status() }.getOrDefault("unknown")
        if (status != "available") return Result("", "error", when (status) {
            "notReady" -> "Gemini Nano is still downloading on this phone. Try again in a few minutes."
            else -> "This phone can't run Gemini Nano. Add your own key in Settings > AI."
        }, "unavailable")
        // The on-device model takes one prompt: earlier turns go in it, marked, oldest first.
        val prompt = if (req.messages.size == 1) req.messages[0].content else req.messages.joinToString("\n\n") { (if (it.role == "user") "User: " else "Assistant: ") + it.content } + "\n\nAssistant:"
        val limit = runCatching { model.contextTokens() }.getOrNull()
        // About four characters a token: refuse what can't fit rather than have the model cut it off.
        if (limit != null && (prompt.length + (AiProviders.instructions(req)?.length ?: 0)) / 4 > limit) return Result("", "error", "This is too long for Gemini Nano on this phone.", "context")
        val text = StringBuilder()
        return try {
            model.generate(AiProviders.instructions(req), prompt, req.maxTokens, req.temperature) { piece ->
                if (cancelled.contains(id)) throw CancellationException()
                text.append(piece)
                onChunk(piece)
            }
            if (cancelled.contains(id)) Result(text.toString(), "cancelled") else Result(text.toString(), "end")
        } catch (e: CancellationException) {
            Result(text.toString(), "cancelled")
        } catch (e: Exception) {
            Result(text.toString(), "error", "Gemini Nano couldn't answer this.", "unavailable")
        }
    }

    private suspend fun generateWithKey(id: String, req: AiProviders.Request, onChunk: (String) -> Unit): Result = withContext(Dispatchers.IO) {
        val provider = req.provider
        val key = secrets.get("ai.$provider") ?: return@withContext Result("", "error", "Add a ${AiProviders.NAMES[provider]} key in Settings > AI first.", "auth")
        val built = try {
            AiProviders.build(provider, req, key)
        } catch (e: AiProviders.Refused) {
            return@withContext Result("", "error", e.message, "invalid")
        }
        if (!AiProviders.allowed(built.url, provider)) return@withContext Result("", "error", "Foli AI can't use that provider.", "invalid")
        val http = Request.Builder().url(built.url).post(built.body.toRequestBody("application/json".toMediaType()))
        built.headers.forEach { (k, v) -> http.header(k, v) }
        val call = client.newCall(http.build())
        calls[id] = call
        if (cancelled.contains(id)) call.cancel()
        val model = req.model ?: AiProviders.DEFAULT_MODELS.getValue(provider)
        val text = StringBuilder()
        try {
            call.execute().use { res ->
                if (!res.isSuccessful) {
                    val (error, code) = AiProviders.httpError(provider, res.code, AiProviders.scrub(res.body.string().take(20_000), key), model)
                    return@withContext Result("", "error", AiProviders.scrub(error, key), code)
                }
                val parser = AiProviders.SseParser()
                val state = AiProviders.StreamState()
                val source = res.body.source()
                fun take(ev: AiProviders.SseEvent?) {
                    if (ev == null) return
                    val piece = AiProviders.onEvent(provider, ev, state)
                    if (piece.isNotEmpty()) {
                        text.append(piece)
                        onChunk(piece)
                    }
                }
                while (!source.exhausted()) take(parser.line(source.readUtf8LineStrict().removeSuffix("\r")))
                take(parser.end())
                Result(text.toString(), state.stop ?: "end", state.error?.let { AiProviders.scrub(it, key) }, state.errorCode)
            }
        } catch (e: java.io.IOException) {
            if (cancelled.contains(id) || call.isCanceled()) Result(text.toString(), "cancelled")
            else Result(text.toString(), "error", "Foli AI couldn't reach ${AiProviders.NAMES[provider]}. Check the connection.", "network")
        }
    }

    /** Checks a stored key with one tiny request (Settings > AI, "Test"). */
    suspend fun testKey(provider: String): JSONObject = withContext(Dispatchers.IO) {
        if (provider !in AiProviders.KEY_PROVIDERS) return@withContext JSONObject().put("ok", false).put("error", "Foli AI can't use that provider.")
        val key = secrets.get("ai.$provider") ?: return@withContext JSONObject().put("ok", false).put("error", "There's no ${AiProviders.NAMES[provider]} key on this phone.")
        val req = AiProviders.Request(provider = provider, messages = listOf(AiProviders.Message("user", "Say OK.")))
        val built = AiProviders.build(provider, req, key, probe = true)
        val http = Request.Builder().url(built.url).post(built.body.toRequestBody("application/json".toMediaType()))
        built.headers.forEach { (k, v) -> http.header(k, v) }
        try {
            client.newCall(http.build()).execute().use { res ->
                if (res.isSuccessful) JSONObject().put("ok", true)
                else JSONObject().put("ok", false).put("error", AiProviders.scrub(AiProviders.httpError(provider, res.code, res.body.string().take(20_000), req.model ?: AiProviders.DEFAULT_MODELS.getValue(provider)).first, key))
            }
        } catch (e: java.io.IOException) {
            JSONObject().put("ok", false).put("error", "Foli AI couldn't reach ${AiProviders.NAMES[provider]}. Check the connection.")
        }
    }
}

/** Gemini Nano through ML Kit GenAI's Prompt API (Android's AICore keeps the model; it may download it first). */
class GeminiNano : AiService.OnDevice {
    private val model: GenerativeModel by lazy { Generation.getClient() }
    private val scope = kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.SupervisorJob() + Dispatchers.IO)
    @Volatile private var downloading = false

    override suspend fun status(): String = try {
        when (model.checkStatus()) {
            FeatureStatus.AVAILABLE -> "available"
            FeatureStatus.DOWNLOADING -> "notReady"
            FeatureStatus.DOWNLOADABLE -> {
                // Ask AICore for the model once; it downloads in the background (on Wi-Fi, as Android decides).
                if (!downloading) {
                    downloading = true
                    scope.launch { runCatching { model.download().collect { } } }
                }
                "notReady"
            }
            else -> "notSupported"
        }
    } catch (e: Exception) {
        // No AICore on this phone (most emulators, phones without Gemini Nano).
        "notSupported"
    }

    override suspend fun contextTokens(): Int? = runCatching { model.getTokenLimit() }.getOrNull()

    override suspend fun generate(system: String?, prompt: String, maxTokens: Int?, temperature: Double?, onText: (String) -> Unit): String {
        val systemFits = system != null && runCatching { model.isSystemPromptAvailable() }.getOrDefault(false)
        val text = if (system != null && !systemFits) "$system\n\n$prompt" else prompt
        val request = if (systemFits) {
            generateContentRequest(SystemInstruction(system!!), TextPart(text)) {
                maxTokens?.let { maxOutputTokens = it }
                temperature?.let { this.temperature = it.toFloat() }
            }
        } else {
            generateContentRequest(TextPart(text)) {
                maxTokens?.let { maxOutputTokens = it }
                temperature?.let { this.temperature = it.toFloat() }
            }
        }
        val response = model.generateContent(request, object : StreamingCallback {
            override fun onNewText(text: String) = onText(text)
        })
        return response.candidates.firstOrNull()?.text.orEmpty()
    }
}
