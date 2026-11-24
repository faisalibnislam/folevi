package com.folevi.android.secure

import com.folevi.android.FoleviApp
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * "FoleviSecrets": `foleviShell.secrets`, the person's own Foli AI keys. Write-only from the page: it can store,
 * remove and ask whether one is set, never read one back. Only the names the contract allows (SecretName).
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
