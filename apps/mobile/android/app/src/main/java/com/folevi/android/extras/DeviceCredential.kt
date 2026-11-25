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

    // ---------------------------------------------------------------- several places (Places.kt)
    // Each account keeps its own token too ("device.token.<user id>"), so the share target and the background
    // worker reach an account that isn't open. The one above is always the open place's (the widgets use it).

    fun tokenFor(userId: String): String? = secrets.get("$TOKEN.$userId")
    fun accountIdFor(userId: String): String? = prefs.getString("accountId.$userId", null)

    fun setFor(userId: String, token: String, tokenId: String, accountId: String) {
        if (!ID_RE.matches(userId)) return
        secrets.set("$TOKEN.$userId", token)
        prefs.edit().putString("tokenId.$userId", tokenId).putString("accountId.$userId", accountId).apply()
    }

    fun clearFor(userId: String) {
        if (!ID_RE.matches(userId)) return
        secrets.delete("$TOKEN.$userId")
        prefs.edit().remove("tokenId.$userId").remove("accountId.$userId").apply()
    }

    /** The accounts holding a token of their own here. */
    fun users(): Set<String> = prefs.all.keys.filter { it.startsWith("accountId.") }.map { it.removePrefix("accountId.") }.toSet()

    /**
     * Another place opened: the open place's token becomes that account's own, or none for the library and an
     * account with none yet (its page asks for one as it opens). A token kept before places (the one account
     * this phone had) becomes that account's first.
     */
    /** The open place's token becomes `userId`'s own when it has none yet, unless it's another account's here. */
    fun keepOpen(userId: String) {
        if (tokenFor(userId) != null) return
        val legacy = token() ?: return
        val account = accountId ?: return
        val id = tokenId ?: return
        if (users().none { accountIdFor(it) == account }) setFor(userId, legacy, id, account)
    }

    fun openedPlace(userId: String?) {
        if (userId == null) return clear()
        keepOpen(userId)
        val own = tokenFor(userId) ?: return clear()
        secrets.set(TOKEN, own)
        prefs.edit().putString("tokenId", prefs.getString("tokenId.$userId", null)).putString("accountId", accountIdFor(userId)).apply()
    }

    companion object {
        const val TOKEN = "device.token"
        private var shared: DeviceCredential? = null
        fun get(context: Context): DeviceCredential = shared ?: DeviceCredential(context, FoleviApp.instance.secrets).also { shared = it }
        val TOKEN_RE = Regex("^[A-Za-z0-9._~+/=-]{16,512}$")
        val ID_RE = Regex("^[A-Za-z0-9_-]{1,64}$")
    }
}
