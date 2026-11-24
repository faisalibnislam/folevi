// The envelope of the bridge (protocol.ts "The envelope"), hand-written as in Swift (FoleviEngine/Protocol/
// Envelope.swift): payloads are typed per subscription, so updates keep their value as JSON until the client
// knows which subscription they belong to.
package com.folevi.engine.protocol

import com.folevi.engine.generated.EngineContract
import com.folevi.engine.generated.EngineError
import com.folevi.engine.generated.ListWindow
import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put

/**
 * The one Json every part of the client uses. A newer engine may add fields (ignored), `?` fields and
 * [Patch.Keep] stay out of what is sent, and a required `T | null` is sent as null.
 */
val FoleviJson: Json = Json {
    ignoreUnknownKeys = true
    encodeDefaults = false
    explicitNulls = true
    coerceInputValues = true
}

/** How the app introduces itself in `hello` (protocol.ts `AppInfo`, with Android's platform name). */
data class AppIdentity(val platform: String, val version: String, val build: String)

/** The kinds of message native sends (`ToEngine`). */
enum class OutgoingKind(val wire: String) { HELLO("hello"), WATCH("watch"), UNWATCH("unwatch"), WINDOW("window"), QUERY("query"), COMMAND("command"), EDITOR("editor") }

/** One `ToEngine` message, built as JSON. */
data class OutgoingMessage(
    val id: String,
    val kind: OutgoingKind,
    val place: String? = null,
    val name: String? = null,
    val args: JsonElement? = null,
    val sub: String? = null,
    val window: ListWindow? = null,
    val app: AppIdentity? = null,
) {
    fun json(): String = buildJsonObject {
        put("v", EngineContract.PROTOCOL_VERSION)
        put("id", id)
        put("kind", kind.wire)
        place?.let { put("place", it) }
        name?.let { put("name", it) }
        // Watch, query and command always carry args (an empty object when there are none).
        when {
            args != null -> put("args", args)
            kind == OutgoingKind.WATCH || kind == OutgoingKind.QUERY || kind == OutgoingKind.COMMAND -> put("args", JsonObject(emptyMap()))
        }
        sub?.let { put("sub", it) }
        window?.let { put("window", buildJsonObject { put("start", it.start); put("count", it.count) }) }
        app?.let {
            put(
                "app",
                buildJsonObject {
                    put("platform", it.platform)
                    put("version", it.version)
                    put("build", it.build)
                    put("protocol", EngineContract.PROTOCOL_VERSION)
                    put("schemaHash", EngineContract.SCHEMA_HASH)
                },
            )
        }
    }.toString()
}

/** Encodes a spec's arguments for the envelope. */
fun <A> encodeArgs(serializer: KSerializer<A>, args: A): JsonElement = FoleviJson.encodeToJsonElement(serializer, args)

/** A reply (`Reply`), with its value still as JSON. */
data class ReplyEnvelope(val id: String, val ok: Boolean, val value: JsonElement?, val error: EngineError?) {
    companion object {
        fun parse(json: String): ReplyEnvelope {
            val o = try {
                FoleviJson.parseToJsonElement(json).jsonObject
            } catch (e: Exception) {
                throw EngineFailure.Decoding("The reply isn't JSON: ${e.message}")
            }
            val ok = o["ok"]?.jsonPrimitive?.booleanOrNull ?: false
            val error = o["error"]?.takeIf { it !is JsonNull }?.let { FoleviJson.decodeFromJsonElement(EngineError.serializer(), it) }
            return ReplyEnvelope(o["id"]?.jsonPrimitive?.contentOrNull ?: "", ok, o["value"], error)
        }
    }
}

/** What one batch from the engine holds, in order, before it is typed. */
sealed interface RawInbound {
    data class Update(val sub: String, val rev: Int, val value: JsonElement?, val diff: JsonObject?, val stale: Boolean, val error: EngineError?) : RawInbound
    data class Event(val name: String, val data: JsonElement?) : RawInbound

    companion object {
        /**
         * Reads an `EngineBatch` (a JSON array of updates and events). A `BigBatchPointer` never reaches Android:
         * the engine hands big batches straight to `foleviEngineHost`, which has no size limit that matters.
         */
        fun parseBatch(json: String): List<RawInbound> {
            val root = FoleviJson.parseToJsonElement(json)
            if (root !is JsonArray) throw EngineFailure.Decoding("A batch must be an array; got ${json.take(80)}")
            return root.mapNotNull { item ->
                val o = item as? JsonObject ?: return@mapNotNull null
                when (o["kind"]?.jsonPrimitive?.contentOrNull) {
                    "update" -> Update(
                        sub = o["sub"]?.jsonPrimitive?.contentOrNull ?: return@mapNotNull null,
                        rev = o["rev"]?.jsonPrimitive?.intOrNull ?: 0,
                        value = o["value"],
                        diff = o["diff"] as? JsonObject,
                        stale = o["stale"]?.jsonPrimitive?.booleanOrNull ?: false,
                        error = o["error"]?.takeIf { it !is JsonNull }?.let { FoleviJson.decodeFromJsonElement(EngineError.serializer(), it) },
                    )
                    "event" -> Event(o["event"]?.jsonPrimitive?.contentOrNull ?: o["name"]?.jsonPrimitive?.contentOrNull ?: return@mapNotNull null, o["data"])
                    else -> null
                }
            }
        }
    }
}

/** A list diff for any row type (the contract's `ListDiff`, generic). Apply: reset, remove, upsert, then order. */
data class RowDiff<R>(
    val reset: Boolean = false,
    val total: Int,
    val complete: Boolean,
    val start: Int,
    val order: List<String>? = null,
    val upsert: Map<String, R>? = null,
    val remove: List<String>? = null,
) {
    companion object {
        fun <R> decode(o: JsonObject, row: KSerializer<R>): RowDiff<R> = RowDiff(
            reset = o["reset"]?.jsonPrimitive?.booleanOrNull ?: false,
            total = o["total"]?.jsonPrimitive?.longOrNull?.toInt() ?: 0,
            complete = o["complete"]?.jsonPrimitive?.booleanOrNull ?: true,
            start = o["start"]?.jsonPrimitive?.longOrNull?.toInt() ?: 0,
            order = o["order"]?.takeIf { it !is JsonNull }?.jsonArray?.map { it.jsonPrimitive.content },
            upsert = (o["upsert"] as? JsonObject)?.mapValues { (_, v) -> FoleviJson.decodeFromJsonElement(row, v) },
            remove = o["remove"]?.takeIf { it !is JsonNull }?.jsonArray?.map { it.jsonPrimitive.content },
        )
    }
}

/** Why a call failed. */
sealed class EngineFailure(message: String) : Exception(message) {
    /** The page is booting or signed out (`engine_not_ready`). */
    data object NotReady : EngineFailure("Folevi is still starting.")
    /** The page went away mid-call (a reload, the renderer ended). */
    data object PageGone : EngineFailure("The page went away.")
    class Timeout(label: String) : EngineFailure("No answer to $label in time.")
    class Transport(message: String) : EngineFailure(message)
    class Decoding(message: String) : EngineFailure(message)
    class ProtocolMismatch(val app: Int, val engine: Int) : EngineFailure("The app speaks protocol $app, the engine $engine.")
    /** The engine answered with an error (its text is for people). */
    class Engine(val error: EngineError) : EngineFailure(error.message)

    companion object {
        fun from(error: EngineError): EngineFailure = when (error.code) {
            "engine_not_ready" -> NotReady
            "page_gone" -> PageGone
            else -> Engine(error)
        }
    }
}

/** FNV-1a 32-bit over UTF-16 code units, as 8 hex digits (protocol.ts `fnv1a`: row hashes, the schema hash). */
fun fnv1a(text: String): String {
    var h = 0x811c9dc5.toInt()
    for (ch in text) {
        h = h xor ch.code
        h *= 0x01000193
    }
    return (h.toLong() and 0xffffffffL).toString(16).padStart(8, '0')
}

internal fun JsonElement?.isNullOrJsonNull(): Boolean = this == null || this is JsonNull

internal fun jsonString(s: String): String = JsonPrimitive(s).toString()
