package com.folevi.android.extras

import android.content.Intent
import android.provider.Settings
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
@CapacitorPlugin(name = "FoleviNative")
class NativePlugin : Plugin() {
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
