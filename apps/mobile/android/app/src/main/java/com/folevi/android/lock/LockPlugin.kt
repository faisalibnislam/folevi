package com.folevi.android.lock

import com.folevi.android.MainActivity
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/** "FoleviLock": `foleviShell.lock` and `foleviNative.getSettings`/`setSettings` (AppLock.kt). */
@CapacitorPlugin(name = "FoleviLock")
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
