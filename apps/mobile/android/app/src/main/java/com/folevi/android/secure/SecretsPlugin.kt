package com.folevi.android.secure

import com.folevi.android.FoleviApp
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import org.json.JSONObject

/**
 * "FoleviSecrets": `foleviShell.secrets`, the person's own Foli AI keys. The page can store, remove and ask whether
 * one is set, and read one back only to send it with a Folevi Cloud request on the person's own key (web
 * lib/ai/ownKey.ts; the server uses it for that request only). Only the names the contract allows (SecretName).
 */
@CapacitorPlugin(name = "FoleviSecrets")
class SecretsPlugin : Plugin() {
    private fun name(call: PluginCall): String? = call.getString("name")?.takeIf { it in PAGE_SECRETS }

    @PluginMethod
    fun has(call: PluginCall) {
        val n = name(call) ?: return call.reject("Not a secret this page may use.", "invalid_argument")
        call.resolve(JSObject().put("value", FoleviApp.instance.secrets.has(n)))
    }

    @PluginMethod
    fun set(call: PluginCall) {
        val n = name(call) ?: return call.reject("Not a secret this page may use.", "invalid_argument")
        val value = call.getString("value")?.trim().orEmpty()
        if (value.isEmpty() || value.length > 4096 || value.any { it.code < 0x20 }) return call.reject("That doesn't look like a key.", "invalid_argument")
        try {
            FoleviApp.instance.secrets.set(n, value)
            call.resolve()
        } catch (e: Exception) {
            call.reject("Folevi couldn't keep that key on this device.", "unavailable")
        }
    }

    /** A Foli AI key for one Folevi Cloud request on the person's own key; null when none is stored. */
    @PluginMethod
    fun reveal(call: PluginCall) {
        val n = name(call) ?: return call.reject("Not a secret this page may use.", "invalid_argument")
        call.resolve(JSObject().put("value", FoleviApp.instance.secrets.get(n) ?: JSONObject.NULL))
    }

    @PluginMethod
    fun delete(call: PluginCall) {
        val n = name(call) ?: return call.reject("Not a secret this page may use.", "invalid_argument")
        FoleviApp.instance.secrets.delete(n)
        call.resolve()
    }

    companion object {
        val PAGE_SECRETS = setOf("ai.openai", "ai.anthropic", "ai.google")
    }
}
