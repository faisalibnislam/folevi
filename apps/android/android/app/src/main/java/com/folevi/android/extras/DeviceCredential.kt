package com.folevi.android.extras

import android.content.Context
import com.folevi.android.BuildConfig
import com.folevi.android.FoleviApp
import com.folevi.android.secure.Secrets

/**
 * The REST API token this phone holds for the parts of the app that run outside the web view (widgets, the
 * share target, Quick Settings, notification actions): made for the device by the page (lib/nativeDevice.ts,
 * apiTokens.ensureDevice), kept sealed in the Keystore, never handed back to the page. The account and token
 * ids (not secret) are in preferences.
 */
class DeviceCredential(context: Context, private val secrets: Secrets) {
    private val prefs = context.applicationContext.getSharedPreferences("folevi-device", Context.MODE_PRIVATE)

    val accountId: String? get() = prefs.getString("accountId", null)
    val tokenId: String? get() = prefs.getString("tokenId", null)
    fun token(): String? = secrets.get(TOKEN)

    /** Where the REST API lives: the website the app signs in with, /api/v1. */
    val apiBase: String get() = BuildConfig.SERVICE_URL.trimEnd('/') + "/api/v1"

    fun set(token: String, tokenId: String, accountId: String) {
        secrets.set(TOKEN, token)
        prefs.edit().putString("tokenId", tokenId).putString("accountId", accountId).apply()
    }

    fun clear() {
        secrets.delete(TOKEN)
        prefs.edit().remove("tokenId").remove("accountId").apply()
    }

    companion object {
        const val TOKEN = "device.token"
        private var shared: DeviceCredential? = null
        fun get(context: Context): DeviceCredential = shared ?: DeviceCredential(context, FoleviApp.instance.secrets).also { shared = it }
        val TOKEN_RE = Regex("^[A-Za-z0-9._~+/=-]{16,512}$")
        val ID_RE = Regex("^[A-Za-z0-9_-]{1,64}$")
    }
}
