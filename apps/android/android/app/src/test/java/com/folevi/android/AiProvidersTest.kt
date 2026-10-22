package com.folevi.android

import com.folevi.android.ai.AiProviders
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The same requests, streams and errors as the Mac's apps/desktop/src/ai.ts (its ai.test.ts cases). */
class AiProvidersTest {
    private fun req(vararg extra: Pair<String, Any>) = JSONObject().put("provider", "openai").put("messages", JSONArray().put(JSONObject().put("role", "user").put("content", "Hi"))).apply { extra.forEach { put(it.first, it.second) } }

    @Test
    fun checksRequests() {
        assertEquals("openai", AiProviders.check(req()).provider)
        for (bad in listOf(req("provider" to "evil"), req("model" to "../x"), req("maxTokens" to 0), req("temperature" to 3), JSONObject().put("provider", "openai").put("messages", JSONArray())))
            try {
                AiProviders.check(bad)
                throw AssertionError("took $bad")
            } catch (_: AiProviders.Refused) {
            }
        val lastAssistant = JSONObject().put("provider", "anthropic").put("messages", JSONArray().put(JSONObject().put("role", "assistant").put("content", "x")))
        try {
            AiProviders.check(lastAssistant)
            throw AssertionError("took a request ending with the assistant")
        } catch (_: AiProviders.Refused) {
        }
    }

    @Test
    fun buildsEachProvidersRequestWithTheKeyOnlyInItsHeader() {
        val r = AiProviders.check(req("system" to "Be brief.", "json" to true, "maxTokens" to 100))
        val openai = AiProviders.build("openai", r, "sk-test-key-123456")
        assertEquals("https://api.openai.com/v1/responses", openai.url)
        assertEquals("Bearer sk-test-key-123456", openai.headers["authorization"])
        val body = JSONObject(openai.body)
        assertEquals(100 + AiProviders.REASONING_HEADROOM, body.getInt("max_output_tokens"))
        assertTrue(body.getString("instructions").contains(AiProviders.JSON_ONLY))
        val google = AiProviders.build("google", r.copy(provider = "google"), "AIzaSyTestKeyTestKeyTestKey")
        assertTrue(google.url.startsWith("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse"))
        assertFalse(google.url.contains("AIza"))
        assertEquals("2023-06-01", AiProviders.build("anthropic", r.copy(provider = "anthropic"), "k").headers["anthropic-version"])
    }

    @Test
    fun readsStreams() {
        val state = AiProviders.StreamState()
        val p = AiProviders.SseParser()
        val events = listOf("event: response.output_text.delta", "data: {\"type\":\"response.output_text.delta\",\"delta\":\"Hel\"}", "", "data: {\"type\":\"response.output_text.delta\",\"delta\":\"lo\"}", "", "data: {\"type\":\"response.completed\"}", "").mapNotNull { p.line(it) }
        assertEquals("Hello", events.joinToString("") { AiProviders.onEvent("openai", it, state) })
        assertEquals("end", state.stop)
        val a = AiProviders.StreamState()
        AiProviders.onEvent("anthropic", AiProviders.SseEvent("message_delta", "{\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"max_tokens\"}}"), a)
        assertEquals("length", a.stop)
        val g = AiProviders.StreamState()
        assertEquals("ok", AiProviders.onEvent("google", AiProviders.SseEvent("message", "{\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"secret\",\"thought\":true},{\"text\":\"ok\"}]},\"finishReason\":\"STOP\"}]}"), g))
    }

    @Test
    fun explainsErrorsAndScrubsKeys() {
        assertEquals("auth", AiProviders.httpError("openai", 401, "{}", "m").second)
        assertEquals("rate", AiProviders.httpError("anthropic", 429, "{\"error\":{\"message\":\"slow\"}}", "m").second)
        assertEquals("context", AiProviders.httpError("openai", 400, "{\"error\":{\"code\":\"context_length_exceeded\",\"message\":\"too long\"}}", "m").second)
        assertEquals("said [key] and [key]", AiProviders.scrub("said sk-abcdefghijkl and mykey-123", "mykey-123"))
        assertTrue(AiProviders.allowed("https://api.anthropic.com/v1/messages", "anthropic"))
        assertFalse(AiProviders.allowed("https://api.anthropic.com:8443/v1/messages", "anthropic"))
        assertFalse(AiProviders.allowed("https://app.folevi.com/v1/messages", "anthropic"))
    }
}
