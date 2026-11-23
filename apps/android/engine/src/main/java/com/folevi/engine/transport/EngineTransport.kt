// How the client reaches the engine: one call per message (native to JavaScript, answered with the reply JSON)
// and a stream of batches (JavaScript to native). WebViewTransport is the real one over an Android WebView;
// ScriptedTransport answers from Kotlin (unit tests, Compose previews, screens built before the engine runs).
package com.folevi.engine.transport

import com.folevi.engine.protocol.EngineFailure
import com.folevi.engine.protocol.FoleviJson
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

/** Lifecycle of the page behind the transport. */
enum class PageLifecycle {
    /** The page is loading again (a reload, a navigation of the whole page): every subscription is gone. */
    RELOADING,
    /** The renderer process ended (memory pressure in the background). The host reloads the view. */
    TERMINATED,
}

/** Called on the main thread only. */
interface EngineTransport {
    /** Sends one `ToEngine` message (JSON) and returns the reply (JSON). */
    suspend fun call(message: String): String
    /** Where batches from the engine go (raw JSON; the client decodes them off the main thread). */
    var onBatch: ((String) -> Unit)?
    var onLifecycle: ((PageLifecycle) -> Unit)?
}

/**
 * A transport whose engine is a Kotlin function. `respond` gets each message and returns the reply's `value`
 * (or throws [EngineFailure.Engine] for an error reply); [push] sends batches as the engine would.
 */
class ScriptedTransport(private val respond: suspend (JsonObject) -> JsonElement) : EngineTransport {
    override var onBatch: ((String) -> Unit)? = null
    override var onLifecycle: ((PageLifecycle) -> Unit)? = null
    val sent = mutableListOf<JsonObject>()

    override suspend fun call(message: String): String {
        val msg = FoleviJson.parseToJsonElement(message).jsonObject
        sent += msg
        val id = msg["id"]?.jsonPrimitive?.contentOrNull ?: ""
        return try {
            val value = respond(msg)
            buildJsonObject {
                put("kind", "reply")
                put("id", id)
                put("ok", true)
                put("value", value)
            }.toString()
        } catch (e: EngineFailure.Engine) {
            buildJsonObject {
                put("kind", "reply")
                put("id", id)
                put("ok", false)
                put("error", FoleviJson.encodeToJsonElement(com.folevi.engine.generated.EngineError.serializer(), e.error))
            }.toString()
        }
    }

    /** Delivers a batch (an array of updates and events) as if the engine had posted it. */
    fun push(batch: JsonArray) = onBatch?.invoke(batch.toString())

    fun push(json: String) = onBatch?.invoke(json)

    fun simulate(event: PageLifecycle) = onLifecycle?.invoke(event)

    companion object {
        fun update(sub: String, rev: Int, value: JsonElement? = null, diff: JsonObject? = null, stale: Boolean = false): JsonObject = buildJsonObject {
            put("kind", "update")
            put("sub", sub)
            put("rev", rev)
            value?.let { put("value", it) }
            diff?.let { put("diff", it) }
            if (stale) put("stale", true)
        }

        fun event(name: String, data: JsonElement): JsonObject = buildJsonObject {
            put("kind", "event")
            put("name", JsonPrimitive(name))
            put("data", data)
        }
    }
}
