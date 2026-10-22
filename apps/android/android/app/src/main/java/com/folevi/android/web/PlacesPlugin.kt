package com.folevi.android.web

import com.folevi.android.FoleviApp
import com.folevi.android.MainActivity
import com.folevi.android.Places
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

/**
 * "FoleviPlaces": `foleviShell.places` (docs/MULTI_ACCOUNT_PLAN.md §2.2): the library and any number of accounts.
 * The page is the open place's (one web view); it never names another for its session, keys or reminders, except
 * convexToken for moving notes between two accounts.
 */
@CapacitorPlugin(name = "FoleviPlaces")
class PlacesPlugin : Plugin() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val app get() = FoleviApp.instance
    private val places get() = app.places

    override fun handleOnDestroy() {
        scope.cancel()
    }

    private fun list(): com.getcapacitor.JSArray {
        val info = app.library.info()
        val configured = info.optBoolean("configured")
        return com.getcapacitor.JSArray(places.list(if (configured) info.optString("kind") else null, info.optString("displayPath"), configured).toString())
    }

    /** The page hears of a change to the list (a sign-in, an account gone). */
    private fun changed() {
        val data = org.json.JSONObject().put("places", org.json.JSONArray(list().toString()))
        activity.runOnUiThread { (activity as? MainActivity)?.event("places", data) }
    }

    /** Every place opens again in the web view (a switch, a sign-out of the open account). */
    private fun reload(path: String = "/documents") {
        activity.runOnUiThread { (activity as? MainActivity)?.reloadForMode(path) }
    }

    @PluginMethod
    fun list(call: PluginCall) {
        call.resolve(JSObject().put("places", list()))
    }

    @PluginMethod
    fun switchTo(call: PluginCall) {
        val id = call.getString("id")
        if (!places.has(id)) return call.reject("That place isn't on this phone.", "invalid_argument")
        val path = call.getString("path")?.takeIf { it.startsWith("/") && !it.startsWith("//") && it.length <= 500 } ?: "/documents"
        places.setCurrent(id)
        call.resolve()
        reload(path)
    }

    @PluginMethod
    fun signIn(call: PluginCall) {
        val a = activity as? MainActivity ?: return call.resolve(JSObject().put("value", JSObject.NULL))
        scope.launch {
            val (url, finish) = app.auth.beginAccount()
            a.openSignIn(url)
            val user = runCatching { finish() }.getOrNull() ?: return@launch call.resolve(JSObject().put("value", JSObject.NULL))
            val first = places.state.accounts.isEmpty()
            val added = places.addAccount(user.userId, user.name, user.email, user.avatarUrl)
            if (first) app.adoptLegacyKeys(user.userId)
            changed()
            call.resolve(JSObject().put("value", added?.id ?: JSObject.NULL))
        }
    }

    @PluginMethod
    fun describe(call: PluginCall) {
        val place = places.state.current
        if (place != null && Places.userIdOf(place) != null) places.describe(place, call.data)
        call.resolve()
    }

    @PluginMethod
    fun signOut(call: PluginCall) {
        val id = call.getString("id")
        val user = Places.userIdOf(id)
        if (id == null || user == null || !places.has(id)) return call.reject("That account isn't on this phone.", "invalid_argument")
        val next = call.getString("next")
        scope.launch {
            runCatching { app.auth.signOutUser(user) }
            app.forgetKeys(user)
            val wasOpen = places.state.current == id
            var after = places.removeAccount(id)
            if (next == Places.LIBRARY) {
                places.setLibrary(true)
                after = Places.LIBRARY
            }
            if (wasOpen) places.setCurrent(after)
            call.resolve()
            if (wasOpen) reload() else changed()
        }
    }

    @PluginMethod
    fun forgetLibrary(call: PluginCall) {
        app.library.forget()
        val wasOpen = places.state.current == Places.LIBRARY
        places.setLibrary(false)
        com.folevi.android.host.Reminders.cancelAll(context)
        if (wasOpen) places.setCurrent(places.state.accounts.firstOrNull()?.id)
        call.resolve()
        if (wasOpen) reload()
    }

    @PluginMethod
    fun convexToken(call: PluginCall) {
        val id = call.getString("id")
        val user = Places.userIdOf(id)
        // Only a page that is itself signed in moves notes between accounts.
        if (user == null || !places.has(id) || places.currentUserId == null) return call.resolve(JSObject().put("value", JSObject.NULL))
        scope.launch {
            val token = runCatching { app.auth.convexTokenFor(user) }.getOrNull()
            call.resolve(JSObject().put("value", token ?: JSObject.NULL))
        }
    }

    @PluginMethod
    fun quickAddPlace(call: PluginCall) {
        call.resolve(JSObject().put("value", places.state.quickAdd ?: places.state.current ?: JSObject.NULL))
    }

    @PluginMethod
    fun setQuickAddPlace(call: PluginCall) {
        call.getString("id")?.let { places.setQuickAdd(it) }
        call.resolve()
    }
}
