package com.folevi.android.ai

import com.folevi.android.FoleviApp
import com.folevi.android.bridge.JSObject
import com.folevi.android.bridge.Plugin
import com.folevi.android.bridge.PluginCall
import com.folevi.android.bridge.PluginMethod
import com.folevi.android.bridge.annotation.BridgePlugin
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/** "FoleviAi": `foleviShell.ai` (AiService.kt). An answer streams back on the call's callback, chunk by chunk. */
@BridgePlugin(name = "FoleviAi")
class AiPlugin : Plugin() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val ai get() = FoleviApp.instance.ai

    override fun handleOnDestroy() = scope.cancel()

    @PluginMethod
    fun capabilities(call: PluginCall) {
        scope.launch { call.resolve(JSObject(ai.capabilities().toString())) }
    }

    @PluginMethod(returnType = PluginMethod.RETURN_CALLBACK)
    fun generate(call: PluginCall) {
        val id = call.getString("id")?.takeIf { Regex("^[A-Za-z0-9_-]{1,64}$").matches(it) } ?: return call.reject("No request id.", "invalid")
        call.setKeepAlive(true)
        scope.launch {
            val result = ai.generate(id, call.getObject("request")) { piece -> call.resolve(JSObject().put("chunk", piece)) }
            call.resolve(JSObject().put("result", JSObject(result.json().toString())))
            call.setKeepAlive(false)
            bridge.releaseCall(call)
        }
    }

    @PluginMethod
    fun cancel(call: PluginCall) {
        call.getString("id")?.let { ai.cancel(it) }
        call.resolve()
    }

    @PluginMethod
    fun testKey(call: PluginCall) {
        val provider = call.getString("provider") ?: ""
        scope.launch { call.resolve(JSObject(ai.testKey(provider).toString())) }
    }
}
