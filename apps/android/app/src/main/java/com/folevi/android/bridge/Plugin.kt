// The host bridge's plugins (docs/ANDROID_NATIVE_PLAN.md section 3, "Host bridge"): the Kotlin services the page
// reaches through `window.foleviShell` and `window.foleviNative` (assets/folevi-bridge.js). The bridge script
// calls `Capacitor.nativePromise(plugin, method, args)`; HostBridge answers it without Capacitor, with the same
// shapes, so the services moved from the Capacitor app unchanged apart from their imports.
package com.folevi.android.bridge

import android.app.Activity
import android.content.Context
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import com.folevi.android.bridge.annotation.BridgePlugin
import com.folevi.android.bridge.annotation.PermissionCallback
import java.lang.reflect.Method

/** Marks a method the page may call (`fun x(call: PluginCall)`). */
@Retention(AnnotationRetention.RUNTIME)
@Target(AnnotationTarget.FUNCTION)
annotation class PluginMethod(val returnType: String = RETURN_PROMISE) {
    companion object {
        /** Answers once (the page's nativePromise). */
        const val RETURN_PROMISE = "promise"
        /** Answers many times (the page's nativeCallback; the call is kept alive). */
        const val RETURN_CALLBACK = "callback"
        const val RETURN_NONE = "none"
    }
}

enum class PermissionState { GRANTED, DENIED, PROMPT }

abstract class Plugin {
    lateinit var bridge: Bridge
        internal set
    val activity: Activity get() = bridge.activity
    val context: Context get() = bridge.activity

    internal val info: BridgePlugin by lazy { javaClass.getAnnotation(BridgePlugin::class.java) ?: error("${javaClass.name} has no @BridgePlugin") }
    internal val methods: Map<String, Method> by lazy {
        javaClass.methods.filter { it.isAnnotationPresent(PluginMethod::class.java) && it.parameterTypes.contentEquals(arrayOf(PluginCall::class.java)) }.associateBy { it.name }
    }

    /** Before the page loads (the Page View exists). */
    open fun load() {}

    open fun handleOnDestroy() {}

    fun getPermissionState(alias: String): PermissionState {
        val strings = info.permissions.firstOrNull { it.alias == alias }?.strings ?: return PermissionState.GRANTED
        if (strings.all { ContextCompat.checkSelfPermission(context, it) == PackageManager.PERMISSION_GRANTED }) return PermissionState.GRANTED
        val asked = bridge.permissionsAsked(alias)
        val rationale = strings.any { activity.shouldShowRequestPermissionRationale(it) }
        return if (asked && !rationale) PermissionState.DENIED else PermissionState.PROMPT
    }

    /** Asks for the alias's permissions, then runs the @PermissionCallback method named `callbackName` with the call. */
    fun requestPermissionForAlias(alias: String, call: PluginCall, callbackName: String) {
        val strings = info.permissions.firstOrNull { it.alias == alias }?.strings ?: return runCallback(callbackName, call)
        bridge.requestPermissions(alias, strings) { runCallback(callbackName, call) }
    }

    private fun runCallback(name: String, call: PluginCall) {
        val m = javaClass.declaredMethods.firstOrNull { it.name == name && it.isAnnotationPresent(PermissionCallback::class.java) }
            ?: return call.reject("No permission callback $name.", "failed")
        m.isAccessible = true
        bridge.runOnBackground { runCatching { m.invoke(this, call) }.onFailure { call.reject(it.cause?.message ?: it.message ?: "failed", "failed") } }
    }
}
