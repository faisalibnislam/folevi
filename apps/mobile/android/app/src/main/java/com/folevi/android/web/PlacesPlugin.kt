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
import kotlinx.coroutines.withContext
import com.folevi.android.BuildConfig
import com.folevi.android.net.Http
import com.folevi.android.server.LocalServers
import com.folevi.android.server.ShellServer

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

    // ---------------------------------------------------------------- Folevi Server (CONTRACT §6.1)

    private val localServers by lazy { LocalServers(context) }

    /**
     * "Your own server" (the page's addServerPlace): checks the address, fetches the server's folevi.json here
     * (what the page read is never trusted), checks the versions, then opens that server's sign-in screen: the page
     * loads again bound to it, and the account that signs in there becomes a place on that server. Answers
     * { value: server } or rejects with the reason (ShellServer.Problem's code and words).
     */
    @PluginMethod
    fun addServer(call: PluginCall) {
        val raw = call.getString("origin") ?: ""
        scope.launch {
            val result = withContext(Dispatchers.IO) { ShellServer.lookUp(ShellServer.client(Http.client), raw, BuildConfig.VERSION_NAME) }
            when (result) {
                is ShellServer.Result.Refused -> call.reject(result.problem.message, result.problem.code)
                is ShellServer.Result.Ok -> {
                    places.setCurrent(null, pending = true, server = result.server)
                    // The sign-in screen is account mode's (from the first launch's choice too), as ShellPlugin.setMode.
                    val settings = app.settings
                    if (settings.mode != "account") {
                        if (settings.mode == "local") {
                            com.folevi.android.extras.LocalActions.get(context).clear()
                            com.folevi.android.extras.Widgets.clear(context)
                        }
                        settings.mode = "account"
                    }
                    call.resolve(JSObject().put("value", JSObject(result.server.json().toString())))
                    reload()
                }
            }
        }
    }

    /** Folevi servers on the home network (DNS-SD): { servers: [{ name, origin, serverId, version }] }. */
    @PluginMethod
    fun localServers(call: PluginCall) {
        scope.launch {
            val list = runCatching { localServers.list() }.getOrDefault(emptyList())
            call.resolve(JSObject().put("servers", com.getcapacitor.JSArray(org.json.JSONArray(list).toString())))
        }
    }

    /**
     * The best connection (the bridge script runs lib/server-edition/connection.ts): the open server place now
     * uses `origin`, one of its own names only. The page loads again there (`path`), still signed in: the
     * session is the server's, not one name's.
     */
    @PluginMethod
    fun setActiveOrigin(call: PluginCall) {
        val place = places.state.current
        val origin = call.getString("origin")
        if (place == null || origin == null || places.serverOf(place) == null) return call.resolve(JSObject().put("value", false))
        val changed = places.setActiveOrigin(place, origin)
        call.resolve(JSObject().put("value", changed))
        if (changed) {
            val path = call.getString("path")?.takeIf { it.startsWith("/") && !it.startsWith("//") && it.length <= 500 } ?: "/documents"
            reload(path)
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
