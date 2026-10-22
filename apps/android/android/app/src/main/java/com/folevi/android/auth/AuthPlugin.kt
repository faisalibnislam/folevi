package com.folevi.android.auth

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
import kotlinx.coroutines.withContext

/** "FoleviAuth": `foleviShell.auth` (AuthBridge.kt). The session never crosses to the page. */
@CapacitorPlugin(name = "FoleviAuth")
class AuthPlugin : Plugin() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val auth get() = FoleviApp.instance.auth

    override fun handleOnDestroy() {
        scope.cancel()
    }

    @PluginMethod
    fun signIn(call: PluginCall) {
        val a = activity as? MainActivity ?: return call.resolve(JSObject().put("value", false))
        scope.launch {
            // Several places: the account becomes one of them. From the library the page goes on itself (move my
            // notes, or keep them separate) and opens it; otherwise the app opens it now.
            val places = FoleviApp.instance.places
            val place = places.state.current
            val (url, finish) = auth.beginAccount()
            a.openSignIn(url)
            val user = runCatching { finish() }.getOrNull() ?: return@launch call.resolve(JSObject().put("value", false))
            val first = places.state.accounts.isEmpty()
            val added = places.addAccount(user.userId, user.name, user.email, user.avatarUrl) ?: return@launch call.resolve(JSObject().put("value", false))
            if (first) FoleviApp.instance.adoptLegacyKeys(user.userId)
            if (place != com.folevi.android.Places.LIBRARY && added.id != place) places.setCurrent(added.id)
            call.resolve(JSObject().put("value", true))
        }
    }

    @PluginMethod
    fun signOut(call: PluginCall) {
        scope.launch {
            val places = FoleviApp.instance.places
            val place = places.state.current
            val user = com.folevi.android.Places.userIdOf(place)
            if (place != null && user != null) {
                runCatching { auth.signOutUser(user) }
                FoleviApp.instance.forgetKeys(user)
                places.setCurrent(places.removeAccount(place))
            } else {
                runCatching { auth.signOut() }
            }
            call.resolve()
        }
    }

    @PluginMethod
    fun fetch(call: PluginCall) {
        val path = call.getString("path") ?: return call.reject("No path.", "invalid_argument")
        val method = call.getString("method") ?: "GET"
        val headers = HashMap<String, String>()
        call.getObject("headers")?.let { o -> o.keys().forEach { k -> headers[k] = o.optString(k) } }
        val body = if (call.data.isNull("body")) null else call.getString("body")
        scope.launch {
            try {
                val res = auth.fetch(path, method, headers, body)
                val h = JSObject()
                res.headers.forEach { (k, v) -> h.put(k, v) }
                call.resolve(JSObject().put("status", res.status).put("headers", h).put("body", res.body))
            } catch (e: IllegalArgumentException) {
                call.reject(e.message ?: "That request can't be sent.", "invalid_argument")
            } catch (e: Exception) {
                // No network: the page's auth phase reads a failed fetch as "offline", never as signed out.
                call.reject("Folevi couldn't reach the website.", "offline")
            }
        }
    }

    @PluginMethod
    fun convexToken(call: PluginCall) {
        scope.launch {
            try {
                val token = auth.convexToken()
                call.resolve(JSObject().put("token", token))
            } catch (e: Exception) {
                call.reject("Folevi couldn't reach the website.", "offline")
            }
        }
    }

    companion object {
        suspend fun <T> io(block: () -> T): T = withContext(Dispatchers.IO) { block() }
    }
}
