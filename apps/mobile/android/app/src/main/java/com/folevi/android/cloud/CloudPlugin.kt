package com.folevi.android.cloud

import android.util.Base64
import com.folevi.android.FoleviApp
import com.folevi.android.MainActivity
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import org.json.JSONObject

/**
 * "FoleviCloud": `foleviShell.library.cloud` (status, connect, cancel, sign out) and the provider requests the
 * bridge's shared provider code makes (`request`). Tokens stay in CloudAuth.kt.
 */
@CapacitorPlugin(name = "FoleviCloud")
class CloudPlugin : Plugin() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val cloud get() = FoleviApp.instance.cloud
    private var off: (() -> Unit)? = null

    override fun load() {
        off = cloud.onStatus { s -> (activity as? MainActivity)?.event("cloud-status", JSONObject().put("status", s.json())) }
    }

    override fun handleOnDestroy() {
        off?.invoke()
        scope.cancel()
    }

    private fun fail(call: PluginCall, e: Throwable) {
        val kind = (e as? CloudException)?.kind ?: "io"
        call.reject(e.message ?: "Folevi couldn't reach its cloud connection.", kind)
    }

    @PluginMethod
    fun status(call: PluginCall) = call.resolve(JSObject(cloud.status().json().toString()))

    @PluginMethod
    fun connect(call: PluginCall) {
        val provider = call.getString("provider") ?: return call.reject("No provider.", "invalid_argument")
        val a = activity as? MainActivity ?: return call.reject("Folevi isn't on screen.", "unavailable")
        scope.launch {
            try {
                call.resolve(JSObject(cloud.connect(provider) { url -> a.runOnUiThread { a.openSignIn(url) } }.json().toString()))
            } catch (e: Throwable) {
                fail(call, e)
            }
        }
    }

    @PluginMethod
    fun cancel(call: PluginCall) {
        cloud.cancel()
        call.resolve()
    }

    @PluginMethod
    fun signOut(call: PluginCall) {
        scope.launch {
            try {
                call.resolve(JSObject(cloud.signOut().json().toString()))
            } catch (e: Throwable) {
                fail(call, e)
            }
        }
    }

    /** One request from the bridge's provider code (base64 body both ways). */
    @PluginMethod
    fun request(call: PluginCall) {
        val provider = call.getString("provider") ?: return call.reject("No provider.", "invalid_argument")
        val url = call.getString("url") ?: return call.reject("No address.", "invalid_argument")
        val method = call.getString("method") ?: "GET"
        val headers = HashMap<String, String>()
        call.getObject("headers")?.let { o -> o.keys().forEach { k -> headers[k] = o.optString(k) } }
        val body = call.getString("body")?.let { Base64.decode(it, Base64.NO_WRAP) }
        val authorized = call.getBoolean("authorized") != false
        scope.launch {
            try {
                val r = cloud.request(provider, url, method, headers, body, authorized)
                val h = JSObject()
                r.headers.forEach { (k, v) -> h.put(k, v) }
                call.resolve(JSObject().put("status", r.status).put("headers", h).put("body", Base64.encodeToString(r.body, Base64.NO_WRAP)))
            } catch (e: Throwable) {
                fail(call, e)
            }
        }
    }
}
