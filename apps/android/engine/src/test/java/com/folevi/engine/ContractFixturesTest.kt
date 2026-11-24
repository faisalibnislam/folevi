// Decodes every contract fixture (apps/web/src/lib/engine/fixtures, checked against protocol.ts by the web's
// vitest suite) with the generated Kotlin, and runs the list fixtures through ListState, as the Swift contract
// tests do. A failure here means the Kotlin codegen and protocol.ts disagree.
package com.folevi.engine

import com.folevi.engine.client.ListState
import com.folevi.engine.generated.EngineCatalog
import com.folevi.engine.generated.EngineContract
import com.folevi.engine.generated.EngineEvent
import com.folevi.engine.generated.HelloValue
import com.folevi.engine.generated.NoteRow
import com.folevi.engine.protocol.FoleviJson
import com.folevi.engine.protocol.RawInbound
import com.folevi.engine.protocol.ReplyEnvelope
import com.folevi.engine.protocol.RowDiff
import com.folevi.engine.protocol.fnv1a
import java.io.File
import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class ContractFixturesTest {
    private val dir = File(System.getProperty("folevi.fixtures") ?: "../../web/src/lib/engine/fixtures")
    private fun fixtures(prefix: String) = dir.listFiles { f -> f.name.startsWith("$prefix.") && f.name.endsWith(".json") }!!.sortedBy { it.name }
    private fun read(f: File) = FoleviJson.parseToJsonElement(f.readText()).jsonObject

    /** Decodes, encodes and decodes again: the round trip must keep the value. */
    private fun roundTrip(label: String, serializer: KSerializer<*>?, json: JsonElement?, errors: MutableList<String>) {
        if (serializer == null) {
            errors += "$label: no serializer"
            return
        }
        @Suppress("UNCHECKED_CAST")
        val s = serializer as KSerializer<Any?>
        try {
            val value = FoleviJson.decodeFromJsonElement(s, json ?: JsonObject(emptyMap()))
            val again = FoleviJson.decodeFromJsonElement(s, FoleviJson.encodeToJsonElement(s, value))
            if (again != value) errors += "$label: changed in a round trip"
        } catch (e: Exception) {
            errors += "$label: ${e.message?.lineSequence()?.take(2)?.joinToString(" ")}"
        }
    }

    @Test
    fun everyFixtureDecodes() {
        assertTrue("no fixtures in $dir", dir.isDirectory)
        val errors = mutableListOf<String>()
        var count = 0
        for (f in fixtures("view")) {
            val j = read(f)
            val name = j["name"]!!.jsonPrimitive.content
            roundTrip("${f.name} args", EngineCatalog.viewArgs[name], j["args"], errors)
            roundTrip("${f.name} value", EngineCatalog.viewValues[name], j["value"], errors)
            count++
        }
        for (f in fixtures("command")) {
            val j = read(f)
            val name = j["name"]!!.jsonPrimitive.content
            roundTrip("${f.name} args", EngineCatalog.commandArgs[name], j["args"], errors)
            if (j.containsKey("result")) roundTrip("${f.name} result", EngineCatalog.commandResults[name], j["result"]?.takeIf { it !is JsonNull } ?: JsonObject(emptyMap()), errors)
            count++
        }
        for (f in fixtures("editor")) {
            val j = read(f)
            val name = j["name"]!!.jsonPrimitive.content
            roundTrip("${f.name} args", EngineCatalog.editorArgs[name], j["args"], errors)
            if (j.containsKey("result")) roundTrip("${f.name} result", EngineCatalog.editorResults[name], j["result"]?.takeIf { it !is JsonNull } ?: JsonObject(emptyMap()), errors)
            count++
        }
        for (f in fixtures("event")) {
            val j = read(f)
            val name = j["name"]!!.jsonPrimitive.content
            try {
                val event = EngineEvent.decode(FoleviJson, name, j["data"])
                if (event is EngineEvent.Unknown) errors += "${f.name}: $name decoded as unknown"
            } catch (e: Exception) {
                errors += "${f.name}: ${e.message?.lineSequence()?.first()}"
            }
            count++
        }
        if (errors.isNotEmpty()) fail("${errors.size} of the fixtures don't decode:\n" + errors.joinToString("\n"))
        assertTrue("too few fixtures ($count)", count > 300)
    }

    @Test
    fun listFixturesApplyThroughListState() {
        for (f in fixtures("list")) {
            val j = read(f)
            var state = ListState<NoteRow>()
            for (u in j["updates"]!!.jsonArray) {
                val diff = u.jsonObject["diff"] as? JsonObject ?: continue
                state = state.apply(RowDiff.decode(diff, NoteRow.serializer()))
            }
            val expected = j["expected"]?.jsonObject ?: continue
            expected["total"]?.let { assertEquals("${f.name} total", it.jsonPrimitive.content.toInt(), state.total) }
            expected["order"]?.let { order -> assertEquals("${f.name} order", order.jsonArray.map { it.jsonPrimitive.content }, state.order) }
        }
    }

    @Test
    fun helloMatchesThisBuild() {
        val j = read(File(dir, "envelope.hello.json"))
        val reply = ReplyEnvelope.parse(j["fromEngine"]!!.jsonArray.first().toString())
        val hello = FoleviJson.decodeFromJsonElement(HelloValue.serializer(), reply.value!!)
        assertEquals(EngineContract.SCHEMA_HASH, hello.schemaHash)
        assertEquals(EngineContract.REVISION.toLong(), hello.revision)
    }

    @Test
    fun batchesParseInOrder() {
        val j = read(File(dir, "envelope.batch.json"))
        val items = RawInbound.parseBatch((j["batch"] as JsonArray).toString())
        assertEquals((j["batch"] as JsonArray).size, items.size)
        assertTrue(items.first() is RawInbound.Update)
    }

    @Test
    fun fnv1aMatchesTheEngine() {
        // protocol.ts fnv1a("") and a known value.
        assertEquals("811c9dc5", fnv1a(""))
        assertEquals("e40c292c", fnv1a("a"))
    }
}
