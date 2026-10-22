package com.folevi.android.cloud

import com.folevi.android.secure.Secrets
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import okhttp3.FormBody
import okhttp3.Headers.Companion.toHeaders
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64

/**
 * "Sync with Dropbox" and "Sync with Google Drive" on Android (docs/LOCAL_MODE_PLAN.md WP9b, docs/ANDROID_PLAN.md):
 * the sign-in and the tokens. The provider code itself (listing, downloads, uploads, the change feed) is the
 * shared packages/cloud-folders, running in the bridge; every request it makes comes through [request], which
 * allows only the provider's own API hosts and adds the token here, so the page never holds one.
 *
 * - Dropbox: OAuth 2 with PKCE (no client secret) in a Custom Tab, back on `com.folevi.android://oauth/dropbox`
 *   (registered in the Dropbox App Console), with a refresh token; app-folder access.
 * - Google Drive: Google's Android authorization ([DriveAuthorizer], play-services-auth) for the `drive.file`
 *   scope, which knows the app by its package and signing key (an Android OAuth client in the Folevi Google
 *   Cloud project). Its access tokens are short-lived and asked for again, without a screen, when they expire.
 * A provider that refuses for good (access revoked) leaves the connection in "reconnect".
 */
class CloudAuth(
    private val store: Secrets,
    private val http: OkHttpClient,
    private val dropboxAppKey: String,
    val driveEnabled: Boolean,
    private val drive: DriveAuthorizer?,
    private val prefs: Prefs,
    private val now: () -> Long = System::currentTimeMillis,
    private val random: SecureRandom = SecureRandom(),
) {
    /** Where the connection's non-secret facts live (SharedPreferences in the app, a map in tests). */
    interface Prefs {
        fun get(key: String): String?
        fun set(key: String, value: String?)
    }

    /** Google's Android authorization: an access token for drive.file, asking with a screen only when `interactive`. */
    interface DriveAuthorizer {
        /** The token, or null when the person must see a consent screen (and `interactive` was false) or refused. */
        suspend fun authorize(interactive: Boolean): DriveToken?
        suspend fun revoke(token: String)
    }

    data class DriveToken(val accessToken: String, val account: String?)

    data class Tokens(val accessToken: String, val refreshToken: String?, val expiresAt: Long)

    data class Status(val available: List<String>, val provider: String?, val state: String, val account: String?) {
        fun json(): JSONObject = JSONObject().put("available", org.json.JSONArray(available)).put("provider", provider).put("state", state).put("account", account)
    }

    private val mutex = Mutex()
    private var listeners = listOf<(Status) -> Unit>()
    @Volatile private var connecting: String? = null
    @Volatile private var pending: Pair<String, CompletableDeferred<String?>>? = null

    val available: List<String>
        get() = buildList {
            if (DROPBOX_KEY.matches(dropboxAppKey)) add("dropbox")
            if (driveEnabled && drive != null) add("googleDrive")
        }

    val provider: String? get() = prefs.get("provider")?.takeIf { it in available }

    fun status(): Status {
        val p = provider
        val state = when {
            connecting != null -> "connecting"
            p == null -> "none"
            prefs.get("reconnect") == "1" -> "reconnect"
            prefs.get("offline") == "1" -> "offline"
            else -> "connected"
        }
        return Status(available, p, state, if (p != null) prefs.get("account") else null)
    }

    fun onStatus(cb: (Status) -> Unit): () -> Unit {
        listeners = listeners + cb
        return { listeners = listeners - cb }
    }

    private fun changed() {
        val s = status()
        for (l in listeners) runCatching { l(s) }
    }

    private fun tokens(provider: String): Tokens? = store.get("cloud.$provider")?.let {
        runCatching { JSONObject(it) }.getOrNull()?.let { o -> Tokens(o.getString("accessToken"), o.optString("refreshToken").takeIf { r -> r.isNotEmpty() }, o.optLong("expiresAt")) }
    }

    private fun saveTokens(provider: String, t: Tokens) {
        store.set("cloud.$provider", JSONObject().put("accessToken", t.accessToken).put("refreshToken", t.refreshToken ?: "").put("expiresAt", t.expiresAt).toString())
    }

    // ---------------------------------------------------------------- connecting

    /** A redirect from the browser: true when it was Dropbox's (whether or not a sign-in was waiting). */
    fun handleCallback(url: String): Boolean {
        if (!url.startsWith(DROPBOX_REDIRECT)) return false
        val parsed = url.toHttpUrlOrNull() ?: runCatching { url.replaceFirst("com.folevi.android://", "https://app.invalid/").toHttpUrl() }.getOrNull() ?: return true
        val p = pending
        if (p != null && parsed.queryParameter("state") == p.first) {
            pending = null
            p.second.complete(url)
        }
        return true
    }

    fun cancel() {
        val p = pending
        pending = null
        p?.second?.complete(null)
    }

    /**
     * Signs in to the provider (also to reconnect). `openBrowser` shows Dropbox's sign-in in a Custom Tab.
     * Throws when cancelled, refused or another provider holds the library.
     */
    suspend fun connect(provider: String, openBrowser: (String) -> Unit): Status {
        if (provider !in available) throw CloudException("unavailable", "${name(provider)} isn't in this build of Folevi.")
        val current = this.provider
        if (current != null && current != provider) throw CloudException("one_connection", "This library syncs with ${name(current)}. Sign out of ${name(current)} first.")
        connecting = provider
        changed()
        try {
            val (tokens, account) = if (provider == "dropbox") connectDropbox(openBrowser) else connectDrive()
            saveTokens(provider, tokens)
            prefs.set("provider", provider)
            prefs.set("account", account)
            prefs.set("reconnect", null)
            prefs.set("offline", null)
            connecting = null
            return status()
        } finally {
            connecting = null
            changed()
        }
    }

    private suspend fun connectDropbox(openBrowser: (String) -> Unit): Pair<Tokens, String?> {
        val verifier = b64url(bytes(32))
        val challenge = b64url(MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray()))
        val state = b64url(bytes(16))
        val url = DROPBOX_AUTHORIZE.toHttpUrl().newBuilder()
            .addQueryParameter("client_id", dropboxAppKey)
            .addQueryParameter("response_type", "code")
            .addQueryParameter("redirect_uri", DROPBOX_REDIRECT)
            .addQueryParameter("code_challenge", challenge)
            .addQueryParameter("code_challenge_method", "S256")
            .addQueryParameter("token_access_type", "offline")
            .addQueryParameter("state", state)
            .build()
        val answer = CompletableDeferred<String?>()
        cancel()
        pending = state to answer
        openBrowser(url.toString())
        val back = withTimeoutOrNull(10 * 60_000L) { answer.await() } ?: throw CloudException("cancelled", "The Dropbox sign-in was closed.")
        val q = back.replaceFirst("com.folevi.android://", "https://app.invalid/").toHttpUrl()
        val code = q.queryParameter("code") ?: throw CloudException("cancelled", "Dropbox didn't sign Folevi in (${q.queryParameter("error") ?: "no code"}).")
        val tokens = tokenRequest(FormBody.Builder().add("grant_type", "authorization_code").add("code", code).add("code_verifier", verifier).add("client_id", dropboxAppKey).add("redirect_uri", DROPBOX_REDIRECT).build(), null)
        val account = runCatching { dropboxAccount(tokens.accessToken) }.getOrNull()
        return tokens to account
    }

    private suspend fun connectDrive(): Pair<Tokens, String?> {
        val d = drive ?: throw CloudException("unavailable", "Google Drive isn't in this build of Folevi.")
        val t = d.authorize(interactive = true) ?: throw CloudException("cancelled", "Google didn't give Folevi access to Drive.")
        val account = t.account ?: runCatching { driveAccount(t.accessToken) }.getOrNull()
        return Tokens(t.accessToken, null, now() + DRIVE_TOKEN_MS) to account
    }

    private suspend fun tokenRequest(form: FormBody, previousRefresh: String?): Tokens = withContext(Dispatchers.IO) {
        val res = try {
            http.newCall(Request.Builder().url(DROPBOX_TOKEN).post(form).header("accept", "application/json").build()).execute()
        } catch (e: java.io.IOException) {
            throw CloudException("offline", "Can't reach Dropbox.")
        }
        res.use {
            val body = runCatching { JSONObject(it.body.string()) }.getOrDefault(JSONObject())
            val access = body.optString("access_token")
            if (!it.isSuccessful || access.isEmpty()) {
                if (it.code == 400 || it.code == 401) throw CloudException("reconnect", "Dropbox refused the sign-in (${body.optString("error", it.code.toString())}).")
                throw CloudException("protocol", "Unexpected answer from Dropbox (${it.code}).")
            }
            val refresh = body.optString("refresh_token").takeIf { r -> r.isNotEmpty() } ?: previousRefresh
            Tokens(access, refresh, now() + maxOf(60, body.optLong("expires_in", 3600)) * 1000)
        }
    }

    private suspend fun dropboxAccount(token: String): String? = withContext(Dispatchers.IO) {
        val req = Request.Builder().url("https://api.dropboxapi.com/2/users/get_current_account").post("null".toRequestBody("application/json".toMediaTypeOrNull())).header("authorization", "Bearer $token").build()
        http.newCall(req).execute().use { r -> if (!r.isSuccessful) null else JSONObject(r.body.string()).let { it.optString("email").ifEmpty { it.optJSONObject("name")?.optString("display_name") } } }
    }

    private suspend fun driveAccount(token: String): String? = withContext(Dispatchers.IO) {
        val req = Request.Builder().url("https://www.googleapis.com/drive/v3/about?fields=user(emailAddress%2CdisplayName)").header("authorization", "Bearer $token").build()
        http.newCall(req).execute().use { r -> if (!r.isSuccessful) null else JSONObject(r.body.string()).optJSONObject("user")?.let { it.optString("emailAddress").ifEmpty { it.optString("displayName") } } }
    }

    // ---------------------------------------------------------------- tokens in use

    private suspend fun markReconnect() {
        prefs.set("reconnect", "1")
        changed()
    }

    /** A fresh access token for the provider (refreshed a minute before it expires, or after a 401). */
    private suspend fun accessToken(provider: String, force: Boolean): String = mutex.withLock {
        val t = tokens(provider) ?: run {
            markReconnect()
            throw CloudException("reconnect", "${name(provider)} needs to be connected again.")
        }
        if (!force && t.expiresAt - now() > 60_000) return t.accessToken
        val next = try {
            if (provider == "dropbox") {
                val refresh = t.refreshToken ?: throw CloudException("reconnect", "Dropbox needs to be connected again.")
                tokenRequest(FormBody.Builder().add("grant_type", "refresh_token").add("refresh_token", refresh).add("client_id", dropboxAppKey).build(), refresh)
            } else {
                val d = drive?.authorize(interactive = false) ?: throw CloudException("reconnect", "Google Drive needs to be connected again.")
                Tokens(d.accessToken, null, now() + DRIVE_TOKEN_MS)
            }
        } catch (e: CloudException) {
            if (e.kind == "reconnect") {
                store.delete("cloud.$provider")
                markReconnect()
            }
            throw e
        }
        saveTokens(provider, next)
        next.accessToken
    }

    data class Response(val status: Int, val headers: Map<String, String>, val body: ByteArray)

    /**
     * One request from the bridge's provider code: only the connected provider's API hosts (or Dropbox's
     * longpoll host without a token), https only, no redirects. The token is added here; a 401 refreshes it once
     * and tries again; a second 401 is answered as it is and the connection waits for "Reconnect".
     */
    suspend fun request(provider: String, url: String, method: String, headers: Map<String, String>, body: ByteArray?, authorized: Boolean): Response {
        val u = url.toHttpUrlOrNull() ?: throw CloudException("invalid", "Not an address.")
        val hosts = if (provider == "dropbox") (if (authorized) DROPBOX_HOSTS else setOf("notify.dropboxapi.com")) else GOOGLE_HOSTS
        if (u.scheme != "https" || u.host !in hosts || u.username.isNotEmpty() || u.port != 443) throw CloudException("invalid", "Folevi only talks to ${name(provider)} from here.")
        if (authorized && provider != this.provider) throw CloudException("reconnect", "${name(provider)} isn't connected.")
        val m = method.uppercase()
        if (m !in setOf("GET", "POST", "PUT", "PATCH", "DELETE")) throw CloudException("invalid", "Not a method Folevi sends.")
        val clean = headers.filterKeys { it.lowercase() !in FORBIDDEN_HEADERS }
        for (attempt in 1..2) {
            val token = if (authorized) accessToken(provider, force = attempt > 1) else null
            val b = Request.Builder().url(u).headers(clean.toHeaders())
            if (token != null) b.header("authorization", "Bearer $token")
            val rb = body?.toRequestBody(clean.entries.firstOrNull { it.key.equals("content-type", true) }?.value?.toMediaTypeOrNull())
            b.method(m, if (m == "GET") null else rb ?: ByteArray(0).toRequestBody(null))
            val res = withContext(Dispatchers.IO) {
                try {
                    http.newCall(b.build()).execute()
                } catch (e: java.io.IOException) {
                    if (prefs.get("offline") != "1") {
                        prefs.set("offline", "1")
                        changed()
                    }
                    throw CloudException("offline", "Can't reach ${name(provider)}.")
                }
            }
            if (prefs.get("offline") == "1") {
                prefs.set("offline", null)
                changed()
            }
            val out = res.use { r ->
                val h = LinkedHashMap<String, String>()
                for (n in r.headers.names()) h[n.lowercase()] = r.headers.values(n).joinToString(", ")
                Response(r.code, h, r.body.bytes())
            }
            if (out.status != 401 || !authorized) return out
            if (attempt == 2) {
                store.delete("cloud.$provider")
                markReconnect()
                return out
            }
        }
        error("unreachable")
    }

    /** Signs out: the grant is revoked (best effort), the tokens deleted; the library's copy here stays. */
    suspend fun signOut(): Status {
        cancel()
        val p = prefs.get("provider")
        if (p != null) {
            tokens(p)?.let { t ->
                runCatching {
                    withContext(Dispatchers.IO) {
                        if (p == "dropbox") http.newCall(Request.Builder().url("https://api.dropboxapi.com/2/auth/token/revoke").post(ByteArray(0).toRequestBody(null)).header("authorization", "Bearer ${t.accessToken}").build()).execute().close()
                        else drive?.revoke(t.accessToken)
                    }
                }
            }
            store.delete("cloud.$p")
        }
        prefs.set("provider", null)
        prefs.set("account", null)
        prefs.set("reconnect", null)
        prefs.set("offline", null)
        changed()
        return status()
    }

    private fun bytes(n: Int) = ByteArray(n).also { random.nextBytes(it) }

    companion object {
        const val DROPBOX_REDIRECT = "com.folevi.android://oauth/dropbox"
        const val DROPBOX_AUTHORIZE = "https://www.dropbox.com/oauth2/authorize"
        const val DROPBOX_TOKEN = "https://api.dropboxapi.com/oauth2/token"
        val DROPBOX_HOSTS = setOf("api.dropboxapi.com", "content.dropboxapi.com")
        val GOOGLE_HOSTS = setOf("www.googleapis.com")
        val DROPBOX_KEY = Regex("^[a-z0-9]{8,32}$")
        /** Google's Android authorization gives hour-long tokens without saying so; asked for again after 55 minutes. */
        const val DRIVE_TOKEN_MS = 55 * 60_000L
        /** Headers the provider code may not set: the app's own. */
        val FORBIDDEN_HEADERS = setOf("authorization", "cookie", "host", "origin", "referer", "proxy-authorization")

        fun name(provider: String) = if (provider == "dropbox") "Dropbox" else "Google Drive"
        fun b64url(b: ByteArray): String = Base64.getUrlEncoder().withoutPadding().encodeToString(b)
    }
}

class CloudException(val kind: String, message: String) : Exception(message)
