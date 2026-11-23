package com.folevi.android.lock

import com.folevi.android.MainActivity
import com.folevi.android.bridge.JSObject
import com.folevi.android.bridge.Plugin
import com.folevi.android.bridge.PluginCall
import com.folevi.android.bridge.PluginMethod
import com.folevi.android.bridge.annotation.BridgePlugin
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/** "FoleviLock": `foleviShell.lock` and `foleviNative.getSettings`/`setSettings` (AppLock.kt). */
@BridgePlugin(name = "FoleviLock")
class LockPlugin : Plugin() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val lock get() = (activity as MainActivity).lock

    private fun json() = JSObject().apply { lock.settings().forEach { (k, v) -> put(k, v) } }

    @PluginMethod
    fun getSettings(call: PluginCall) = call.resolve(json())

    @PluginMethod
    fun setSettings(call: PluginCall) {
        val on = if (call.getData().has("lock") && !call.getData().isNull("lock")) call.getBoolean("lock") else null
        val after = if (call.getData().has("lockAfter") && !call.getData().isNull("lockAfter")) call.getInt("lockAfter") else null
        scope.launch {
            try {
                lock.set(activity as MainActivity, on, after)
                call.resolve(json())
            } catch (e: AppLock.LockCancelled) {
                call.reject("The lock didn't change.", "cancelled")
            } catch (e: IllegalArgumentException) {
                call.reject(e.message ?: "Not a setting Folevi offers.", "invalid_argument")
            } catch (e: IllegalStateException) {
                call.reject(e.message ?: "This phone can't lock Folevi.", "unavailable")
            }
        }
    }
}
