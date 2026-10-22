package com.folevi.android.host

import android.Manifest
import android.os.Build
import android.util.Base64
import com.folevi.android.BuildConfig
import com.folevi.android.FoleviApp
import com.folevi.android.MainActivity
import com.folevi.android.net.Http
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.util.concurrent.ConcurrentHashMap

/** "FoleviNotify": `foleviShell.notify`, local reminders (Reminders.kt). Asks for notifications the first time. */
@CapacitorPlugin(name = "FoleviNotify", permissions = [Permission(alias = "notifications", strings = [Manifest.permission.POST_NOTIFICATIONS])])
class NotifyPlugin : Plugin() {
    private val reminders by lazy { Reminders(context) }

    @PluginMethod
    fun schedule(call: PluginCall) {
        val id = call.getString("id")?.takeIf { it.isNotEmpty() && it.length <= 200 } ?: return call.reject("No reminder id.", "invalid_argument")
        val at = call.getData().optLong("at", -1).takeIf { it > 0 } ?: return call.reject("No time.", "invalid_argument")
        val title = (call.getString("title") ?: "").take(200)
        val body = (call.getString("body") ?: "").take(500)
        val path = call.getString("path")?.takeIf { it.startsWith("/") && it.length <= 300 } ?: "/tasks/today"
        reminders.schedule(Reminders.Reminder(id, at, title, body, path))
        // The first reminder asks Android for notifications (once; after that the system setting decides).
        if (getPermissionState("notifications") == PermissionState.PROMPT && !asked()) {
            context.getSharedPreferences("folevi-notify", 0).edit().putBoolean("asked", true).apply()
            requestPermissionForAlias("notifications", call, "afterAsk")
        } else call.resolve()
    }

    private fun asked() = context.getSharedPreferences("folevi-notify", 0).getBoolean("asked", false)

    @PermissionCallback
    private fun afterAsk(call: PluginCall) = call.resolve()

    @PluginMethod
    fun cancel(call: PluginCall) {
        call.getString("id")?.let { reminders.cancel(it) }
        call.resolve()
    }
}

/** "FoleviFiles": `foleviShell.files.save`, through Android's "Save to" screen (the person picks where). */
@CapacitorPlugin(name = "FoleviFiles")
class FilesPlugin : Plugin() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val uploads = ConcurrentHashMap<String, ByteArrayOutputStream>()

    @PluginMethod
    fun chunk(call: PluginCall) {
        val id = call.getString("upload") ?: return call.reject("No upload.", "invalid_argument")
        val buf = uploads.getOrPut(id) { ByteArrayOutputStream() }
        if (buf.size() + 3 * 1024 * 1024 > 600 * 1024 * 1024) return call.reject("That file is too big.", "invalid_argument")
        buf.write(Base64.decode(call.getString("data") ?: "", Base64.NO_WRAP))
        call.resolve()
    }

    @PluginMethod
    fun save(call: PluginCall) {
        val name = call.getString("name")?.replace(Regex("[\\u0000-\\u001f/\\\\]"), " ")?.trim()?.take(200)?.ifEmpty { null } ?: "Folevi export"
        val bytes = call.getString("upload")?.let { uploads.remove(it)?.toByteArray() } ?: Base64.decode(call.getString("data") ?: "", Base64.NO_WRAP)
        val a = activity as? MainActivity ?: return call.resolve(JSObject().put("saved", false))
        scope.launch {
            val ok = runCatching { a.saveDocument(name, mimeOf(name), bytes) }.getOrDefault(false)
            call.resolve(JSObject().put("saved", ok))
        }
    }

    private fun mimeOf(name: String) = when (name.substringAfterLast('.', "").lowercase()) {
        "zip" -> "application/zip"
        "md" -> "text/markdown"
        "html" -> "text/html"
        "pdf" -> "application/pdf"
        "json" -> "application/json"
        "png" -> "image/png"
        else -> "application/octet-stream"
    }
}

/** "FoleviHttp": `foleviShell.http`, subscribed calendars fetched by the phone from their own sites. */
@CapacitorPlugin(name = "FoleviHttp")
class HttpPlugin : Plugin() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val calendars by lazy { CalendarFetch(Http.client, java.net.URI(BuildConfig.SERVICE_URL).host ?: "app.folevi.com") }

    @PluginMethod
    fun calendar(call: PluginCall) {
        val url = call.getString("url") ?: return call.reject("No address.", "invalid_argument")
        val etag = call.getData().optString("etag").takeIf { it.isNotEmpty() && it != "null" }
        val modified = call.getData().optString("lastModified").takeIf { it.isNotEmpty() && it != "null" }
        scope.launch { call.resolve(JSObject(calendars.download(url, etag, modified).toString())) }
    }

    /** Bookmark previews aren't in local mode yet on any app (the Mac's says the same). */
    @PluginMethod
    fun preview(call: PluginCall) = call.reject("Bookmark previews aren't in this build of Folevi for Android yet.", "unavailable")
}

internal suspend fun <T> io(block: () -> T): T = withContext(Dispatchers.IO) { block() }
