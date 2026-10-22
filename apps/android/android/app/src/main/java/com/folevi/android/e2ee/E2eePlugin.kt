package com.folevi.android.e2ee

import android.os.SystemClock
import android.util.Base64
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
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

/**
 * "FoleviE2ee": `foleviShell.e2ee` (DeviceKeys.kt), the same shape as the Mac's. Failures carry only a code and a
 * fixed message, never anything about a key or a box. With "Ask for your fingerprint or face to unlock encrypted
 * notes" on, opening a box asks first (BiometricPrompt, the screen lock as fallback); opens within 30 seconds of a
 * yes don't ask again. Turning it on or off asks too.
 */
@CapacitorPlugin(name = "FoleviE2ee")
class E2eePlugin : Plugin() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val keys get() = FoleviApp.instance.deviceKeys
    private var confirmedAt = 0L
    private val asking = Mutex()

    private fun fail(call: PluginCall, e: Throwable) {
        val r = e as? DeviceKeys.Refused
        call.reject(r?.message ?: "Folevi couldn't use this phone's encryption keys.", r?.code ?: "failed")
    }

    private fun settingsJson(): JSObject {
        val available = (activity as? MainActivity)?.lock?.method()?.let { it != "none" } ?: false
        return JSObject().put("touchId", available && keys.askBeforeOpening).put("available", available)
    }

    @PluginMethod
    fun deviceKeys(call: PluginCall) {
        scope.launch {
            try {
                val p = withContext(Dispatchers.IO) { keys.deviceKeys() }
                call.resolve(JSObject().put("deviceId", p.deviceId).put("x25519Pub", Base64.encodeToString(p.x25519Pub, Base64.NO_WRAP)).put("ed25519Pub", Base64.encodeToString(p.ed25519Pub, Base64.NO_WRAP)))
            } catch (e: Throwable) {
                fail(call, e)
            }
        }
    }

    private suspend fun confirm(): Boolean {
        val a = activity as? MainActivity ?: return true
        if (!keys.askBeforeOpening || a.lock.method() == "none") return true
        return asking.withLock {
            if (SystemClock.elapsedRealtime() - confirmedAt < GRACE_MS) return@withLock true
            val ok = a.lock.authenticate(a, "Unlock your encrypted notes")
            if (ok) confirmedAt = SystemClock.elapsedRealtime()
            ok
        }
    }

    @PluginMethod
    fun open(call: PluginCall) {
        val box = runCatching { Base64.decode(call.getString("box") ?: "", Base64.NO_WRAP) }.getOrNull() ?: return call.reject("Not a sealed Folevi box.", "invalid_argument")
        val context = call.getString("context") ?: return call.reject("Not an encryption context.", "invalid_argument")
        scope.launch {
            try {
                // Odd input is refused before anyone is asked for a fingerprint.
                if (box.size < DeviceKeys.HEADER + DeviceKeys.TAG || box.size > DeviceKeys.MAX_BOX) throw DeviceKeys.Refused("invalid_argument", "Not a sealed Folevi box.")
                DeviceKeys.checkContext(context)
                if (!confirm()) throw DeviceKeys.Refused("cancelled", "The fingerprint or face check didn't confirm it.")
                val out = withContext(Dispatchers.IO) { keys.open(box, context) }
                val text = Base64.encodeToString(out, Base64.NO_WRAP)
                out.fill(0)
                call.resolve(JSObject().put("data", text))
            } catch (e: Throwable) {
                fail(call, e)
            }
        }
    }

    @PluginMethod
    fun sign(call: PluginCall) {
        val kind = call.getString("kind") ?: ""
        val body = call.getString("body") ?: ""
        scope.launch {
            try {
                call.resolve(JSObject().put("signature", withContext(Dispatchers.IO) { keys.sign(kind, body) }))
            } catch (e: Throwable) {
                fail(call, e)
            }
        }
    }

    @PluginMethod
    fun reset(call: PluginCall) {
        keys.reset()
        confirmedAt = 0
        call.resolve()
    }

    @PluginMethod
    fun settings(call: PluginCall) = call.resolve(settingsJson())

    @PluginMethod
    fun setTouchId(call: PluginCall) {
        val on = call.getBoolean("on") == true
        val a = activity as? MainActivity ?: return call.reject("Folevi isn't on screen.", "unavailable")
        scope.launch {
            if (a.lock.method() == "none") return@launch call.reject("This phone has no fingerprint, face or screen lock set up.", "unavailable")
            if (on != keys.askBeforeOpening) {
                val ok = a.lock.authenticate(a, if (on) "Ask before unlocking encrypted notes" else "Stop asking before unlocking encrypted notes")
                if (!ok) return@launch call.reject("The fingerprint or face check didn't confirm it.", "cancelled")
                keys.askBeforeOpening = on
            }
            call.resolve(settingsJson())
        }
    }

    companion object {
        const val GRACE_MS = 30_000L
    }
}
