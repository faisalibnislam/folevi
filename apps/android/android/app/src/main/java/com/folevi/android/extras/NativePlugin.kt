package com.folevi.android.extras

import android.content.Intent
import android.provider.Settings
import android.util.Base64
import kotlinx.coroutines.launch
import com.folevi.android.FoleviApp
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * "FoleviNative": the phone extras the iPhone app also has (apps/web/src/lib/nativeApp.ts NativeBridge): this
 * device and its REST token, shares waiting for the page, the scanner, notifications, text in images. Each
 * part answers in its own file; this plugin is only the door.
 */
@CapacitorPlugin(name = "FoleviNative", permissions = [com.getcapacitor.annotation.Permission(alias = "notifications", strings = [android.Manifest.permission.POST_NOTIFICATIONS])])
class NativePlugin : Plugin() {
    private val scope = kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.SupervisorJob() + kotlinx.coroutines.Dispatchers.Main)
    private val credential get() = DeviceCredential.get(context)

    @PluginMethod
    fun device(call: PluginCall) {
        val s = FoleviApp.instance.settings
        val c = credential
        val device = JSObject()
            .put("id", s.installId)
            .put("family", "Android")
            .put("model", s.model)
            .put("accountId", if (c.token() != null) c.accountId else null)
            .put("tokenId", if (c.token() != null) c.tokenId else null)
            .put("scanner", Scanner.available(context))
        call.resolve(JSObject().put("device", device))
    }

    @PluginMethod
    fun setCredential(call: PluginCall) {
        val token = call.getString("token").orEmpty()
        val tokenId = call.getString("tokenId").orEmpty()
        val accountId = call.getString("accountId").orEmpty()
        if (!DeviceCredential.TOKEN_RE.matches(token) || !DeviceCredential.ID_RE.matches(tokenId) || !DeviceCredential.ID_RE.matches(accountId))
            return call.resolve(JSObject().put("value", false))
        try {
            credential.set(token, tokenId, accountId)
            Widgets.refreshSoon(context)
            call.resolve(JSObject().put("value", true))
        } catch (e: Exception) {
            call.resolve(JSObject().put("value", false))
        }
    }

    @PluginMethod
    fun clearCredential(call: PluginCall) {
        credential.clear()
        scope.launch { com.folevi.android.push.Push.disable(context) }
        Widgets.clear(context)
        call.resolve()
    }

    @PluginMethod
    fun takeShares(call: PluginCall) {
        val arr = JSArray()
        for (share in ShareQueue.get(context).pending()) arr.put(share)
        call.resolve(JSObject().put("shares", arr))
    }

    @PluginMethod
    fun finishShare(call: PluginCall) {
        call.getString("id")?.let { ShareQueue.get(context).remove(it) }
        call.resolve()
    }

    // ---------------------------------------------------------------- local mode's widgets

    /** Local mode: the widgets' copy from the page that holds the library (components/app/LocalExtensions.tsx). */
    @PluginMethod
    fun setWidgetSnapshot(call: PluginCall) {
        if (FoleviApp.instance.settings.mode != "local") return call.resolve()
        val snapshot = call.getObject("snapshot") ?: return call.reject("No snapshot.", "invalid_argument")
        Widgets.setSnapshot(context, snapshot)
        call.resolve()
    }

    @PluginMethod
    fun takeLocalActions(call: PluginCall) {
        val all = LocalActions.get(context).pending()
        call.resolve(JSObject().put("actions", JSArray().also { a -> for (i in 0 until all.length()) a.put(all.get(i)) }))
    }

    @PluginMethod
    fun finishLocalAction(call: PluginCall) {
        call.getString("id")?.let { LocalActions.get(context).finish(it) }
        call.resolve()
    }

    @PluginMethod
    fun scanDocument(call: PluginCall) {
        val a = activity as? com.folevi.android.MainActivity ?: return call.resolve(JSObject().put("scan", null))
        scope.launch {
            try {
                val pages = if (call.getString("source") == "photos") a.pickImages() else Scanner.scan(a) { a.showForResult(it) }
                if (pages.isNullOrEmpty()) call.resolve(JSObject().put("scan", null))
                else call.resolve(JSObject().put("scan", Scanner.answer(context, pages)))
            } catch (e: Exception) {
                call.reject("The scanner couldn't open on this phone.", "unavailable")
            }
        }
    }

    /** The words in an image (search in files), read on the phone. Null when it couldn't be read. */
    @PluginMethod
    fun recognizeText(call: PluginCall) {
        val data = call.getString("data") ?: return call.resolve(JSObject().put("text", null))
        scope.launch {
            val text = runCatching {
                val bytes = Base64.decode(data, Base64.NO_WRAP)
                if (bytes.size > 40 * 1024 * 1024) return@runCatching null
                val bitmap = Scanner.decodeBytes(bytes) ?: return@runCatching null
                Scanner.read(bitmap).also { bitmap.recycle() }
            }.getOrNull()
            call.resolve(JSObject().put("text", text))
        }
    }

    @PluginMethod
    fun pushStatus(call: PluginCall) = call.resolve(JSObject().put("status", com.folevi.android.push.Push.status(context)))

    /** Asks Android the first time (Android 13's notification permission), then gets the FCM token. */
    @PluginMethod
    fun enablePush(call: PluginCall) {
        if (!com.folevi.android.push.Push.configured()) return call.resolve(JSObject().put("status", null))
        if (getPermissionState("notifications") != com.getcapacitor.PermissionState.GRANTED) {
            com.folevi.android.push.Push.markAsked(context)
            requestPermissionForAlias("notifications", call, "afterPushAsk")
        } else afterPushAsk(call)
    }

    @com.getcapacitor.annotation.PermissionCallback
    private fun afterPushAsk(call: PluginCall) {
        com.folevi.android.push.Push.markAsked(context)
        if (getPermissionState("notifications") != com.getcapacitor.PermissionState.GRANTED) return call.resolve(JSObject().put("status", com.folevi.android.push.Push.status(context)))
        scope.launch { call.resolve(JSObject().put("status", com.folevi.android.push.Push.enable(context))) }
    }

    @PluginMethod
    fun disablePush(call: PluginCall) {
        scope.launch {
            com.folevi.android.push.Push.disable(context)
            call.resolve()
        }
    }

    @PluginMethod
    fun setBadge(call: PluginCall) {
        // Android draws a launcher's dot from the notifications themselves; nothing to set.
        call.resolve()
    }

    @PluginMethod
    fun openNotificationSettings(call: PluginCall) {
        val intent = Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        runCatching { context.startActivity(intent) }
        call.resolve()
    }
}
