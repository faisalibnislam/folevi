package com.folevi.android

import android.content.Context
import android.os.Build
import android.provider.Settings
import java.util.UUID

/**
 * What the app keeps about itself on this device (never on Folevi's servers): the mode the built-in
 * interface opens in ("unset" on the very first launch, then "local" or "account"), and the app's install id.
 */
class ShellSettings(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("folevi-shell", Context.MODE_PRIVATE)
    private val app = context.applicationContext

    var mode: String
        get() = prefs.getString(KEY_MODE, null)?.takeIf { it in MODES } ?: "unset"
        set(value) {
            require(value in MODES)
            prefs.edit().putString(KEY_MODE, value).commit()
        }

    /** One id per install, for the REST token the widgets and the share target use (lib/nativeDevice.ts). */
    val installId: String
        get() = prefs.getString(KEY_INSTALL, null) ?: UUID.randomUUID().toString().also { prefs.edit().putString(KEY_INSTALL, it).apply() }

    /** The name people gave this phone ("Faisal's Pixel"), else its model ("Pixel 9"). */
    val deviceName: String
        get() {
            val named = runCatching { Settings.Global.getString(app.contentResolver, Settings.Global.DEVICE_NAME) }.getOrNull()
            return (named?.trim()?.takeIf { it.isNotEmpty() } ?: model).take(60)
        }

    val model: String
        get() {
            val m = Build.MODEL.orEmpty().trim()
            val maker = Build.MANUFACTURER.orEmpty().trim()
            return when {
                m.isEmpty() -> "Android device"
                maker.isEmpty() || m.startsWith(maker, ignoreCase = true) || maker.equals("Google", true) -> m
                else -> "${maker.replaceFirstChar { it.uppercase() }} $m"
            }
        }

    companion object {
        private const val KEY_MODE = "mode"
        private const val KEY_INSTALL = "installId"
        val MODES = setOf("unset", "local", "account")
    }
}
