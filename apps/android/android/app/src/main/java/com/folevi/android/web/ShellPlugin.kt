package com.folevi.android.web

import android.annotation.SuppressLint
import android.net.Uri
import com.folevi.android.FoleviApp
import com.folevi.android.MainActivity
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * "FoleviShell": the mode, the system bars, haptics, links out and the back gesture. Its load() runs before
 * Capacitor loads the page, so the bridge script and the web view client are in place for the first load.
 */
@CapacitorPlugin(name = "FoleviShell")
class ShellPlugin : Plugin() {
    private val activityOrNull get() = activity as? MainActivity

    @SuppressLint("SetJavaScriptEnabled")
    override fun load() {
        activityOrNull?.attachBridge(bridge)
    }

    @PluginMethod
    fun setMode(call: PluginCall) {
        val mode = call.getString("mode")
        if (mode != "local" && mode != "account") return call.reject("Not a mode.", "invalid_argument")
        FoleviApp.instance.settings.mode = mode
        call.resolve(JSObject().put("ok", true))
        // The page reloads in the new mode (its bridge says so before the first render).
        activity.runOnUiThread { activityOrNull?.reloadForMode() }
    }

    @PluginMethod
    fun haptic(call: PluginCall) {
        val kind = call.getString("kind") ?: "light"
        activity.runOnUiThread { Haptics.perform(bridge.webView, kind) }
        call.resolve()
    }

    @PluginMethod
    fun setSystemBars(call: PluginCall) {
        val dark = call.getString("theme") == "dark"
        activity.runOnUiThread { activityOrNull?.setPageTheme(dark) }
        call.resolve()
    }

    @PluginMethod
    fun openExternal(call: PluginCall) {
        val url = call.getString("url") ?: return call.reject("No link.", "invalid_argument")
        val a = activityOrNull ?: return call.resolve(JSObject().put("value", false))
        activity.runOnUiThread {
            val ok = a.openLink(url)
            call.resolve(JSObject().put("value", ok))
        }
    }

    @PluginMethod
    fun setBackEnabled(call: PluginCall) {
        val on = call.getBoolean("enabled") == true
        activity.runOnUiThread { activityOrNull?.setBackEnabled(on) }
        call.resolve()
    }

    @PluginMethod
    fun leave(call: PluginCall) {
        activity.runOnUiThread { activityOrNull?.leave() }
        call.resolve()
    }

    @PluginMethod
    fun pageReady(call: PluginCall) {
        activity.runOnUiThread { activityOrNull?.pageReady() }
        call.resolve()
    }

    @PluginMethod
    fun info(call: PluginCall) {
        val s = FoleviApp.instance.settings
        call.resolve(JSObject().put("mode", s.mode).put("deviceName", s.deviceName).put("model", s.model))
    }

    companion object {
        fun parse(url: String): Uri? = runCatching { Uri.parse(url) }.getOrNull()
    }
}
