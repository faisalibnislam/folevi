// A stand-in engine for debug builds (launch with the extra `demo=true`): it answers from the contract fixtures
// (apps/web/src/lib/engine/fixtures, copied into the debug assets), so every screen and layout can be checked on
// any emulator without an account or the page. The same idea as FoleviEngine's ScriptedTransport previews.
package com.folevi.android.engine

import android.content.Context
import com.folevi.engine.generated.EngineContract
import com.folevi.engine.transport.ScriptedTransport
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

object DemoEngine {
    fun available(context: Context): Boolean = runCatching { context.assets.list("demo")?.isNotEmpty() == true }.getOrDefault(false)

    fun transport(context: Context, scope: CoroutineScope): ScriptedTransport {
        val fixtures: Map<String, JsonObject> = context.assets.list("demo").orEmpty().associateWith { name ->
            kotlinx.serialization.json.Json.parseToJsonElement(context.assets.open("demo/$name").bufferedReader().readText()).jsonObject
        }

        /**
         * The fixture for a kind and name (from its contents): `view.home.json` before its variants
         * (`view.home.empty.json`); for lists, the one with the most rows in its first window.
         */
        val byName = fixtures.entries.groupBy { (it.value["kind"]?.jsonPrimitive?.contentOrNull ?: "") + ":" + (it.value["name"]?.jsonPrimitive?.contentOrNull ?: "") }
        fun fixture(kind: String, name: String): JsonObject? = fixtures["$kind.$name.json"] ?: byName["$kind:$name"]?.minByOrNull { it.key.length }?.value

        lateinit var t: ScriptedTransport
        t = ScriptedTransport { msg ->
            val name = msg["name"]?.jsonPrimitive?.contentOrNull ?: ""
            when (msg["kind"]?.jsonPrimitive?.contentOrNull) {
                "hello" -> hello(fixtures)
                "watch" -> {
                    val sub = msg["sub"]!!.jsonPrimitive.content
                    val view = fixture("view", name)
                    val list = fixture("list", name)
                    scope.launch {
                        delay(16)
                        val update = when {
                            view != null -> ScriptedTransport.update(sub, 1, value = view["value"])
                            list != null -> (list["updates"] as? JsonArray)?.firstOrNull()?.jsonObject?.let { u -> ScriptedTransport.update(sub, 1, diff = u["diff"]?.jsonObject) }
                            else -> null
                        }
                        update?.let { t.push(buildJsonArray { add(it) }) }
                    }
                    buildJsonObject { put("sub", sub) }
                }
                "query" -> fixture("view", name)?.get("value") ?: JsonNull
                "command" -> fixture("command", name)?.get("result") ?: buildJsonObject { put("ok", true) }
                "editor" -> fixture("editor", name)?.get("result") ?: buildJsonObject { put("ok", true) }
                else -> JsonObject(emptyMap())
            }
        }
        return t
    }

    private fun hello(fixtures: Map<String, JsonObject>): JsonElement {
        val base = (fixtures["envelope.hello.json"]?.get("fromEngine") as? JsonArray)?.firstOrNull()?.jsonObject?.get("value")?.jsonObject ?: JsonObject(emptyMap())
        // Ready, with no gate: the app itself.
        return JsonObject(
            base + mapOf(
                "ready" to JsonPrimitive(true),
                "place" to JsonPrimitive("acct:demo"),
                "schemaHash" to JsonPrimitive(EngineContract.SCHEMA_HASH),
                "gate" to buildJsonObject {
                    put("gate", JsonNull)
                    put("title", "")
                    put("message", "")
                    put("busy", false)
                    put("actions", JsonArray(emptyList()))
                    put("fields", JsonArray(emptyList()))
                    put("progress", JsonNull)
                    put("migration", JsonNull)
                    put("deviceLimit", JsonNull)
                    put("e2ee", JsonNull)
                    put("onboarding", JsonNull)
                    put("error", JsonNull)
                },
            ),
        )
    }
}
