package com.folevi.android.auth

import com.folevi.android.secure.Secrets
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull

/**
 * Signed-in mode for the built-in interface (docs/LOCAL_MODE_PLAN.md §1, docs/ANDROID_PLAN.md "Sign-in"):
 * `foleviShell.auth`, the Android twin of the Mac's apps/desktop/src/authBridge.ts.
 *   1. signIn() opens the website's /connect page in a Custom Tab (client "folevi-android", PKCE S256); the
 *      person signs in there as usual (password, two-step, Google, passkeys) and presses Continue;
 *   2. the website sends the browser to the app's redirect: an App Link (https://app.folevi.com/native/callback)
 *      in release builds, `com.folevi.android://auth/callback` in debug builds (emulators can't verify App
 *      Links for a dev server). MainActivity hands it to handleCallback();
 *   3. the app trades the code and its verifier for a session of its own at /api/auth/native/token and keeps
 *      the bearer token in the Keystore-sealed SecretStore. It never reaches the page.
 * Afterwards the page's Better Auth client sends every request through fetch() here: only the website's
 * /api/auth/..., GET or POST, a few harmless page headers, `Authorization: Bearer`, no cookies, `Origin` set to
 * the website, a rotated `set-auth-token` kept, and the token scrubbed from anything handed back.
 */
class AuthBridge(
    serviceUrl: String,
    val redirectUri: String,
    private val http: OkHttpClient,
    private val store: Secrets,
    private val deviceName: () -> String,
    private val random: SecureRandom = SecureRandom(),
    private val signInTimeoutMs: Long = 10 * 60_000L,
    /** Several places (com.folevi.android.Places): the open account's user id, whose session the page's calls use. */
    private val currentUser: () -> String? = { null },
) {
    val service: HttpUrl = requireNotNull(serviceUrl.toHttpUrlOrNull()) { "Not a website: $serviceUrl" }.newBuilder().encodedPath("/").query(null).build()
    private val origin = service.toString().removeSuffix("/")

    data class Response(val status: Int, val headers: Map<String, String>, val body: String)

    private class Pending(val state: String, val answer: CompletableDeferred<String?>)

    @Volatile private var pending: Pending? = null

    /** Each account's session is its own secret, `auth.session.<user id>`; null is the one older builds kept. */
    private fun slotName(user: String?) = if (user == null) TOKEN else "$TOKEN.$user"

    fun token(user: String?): String? = store.get(slotName(user))?.takeIf { TOKEN_RE.matches(it) }

    private fun token(): String? = token(currentUser())

    fun signedIn(): Boolean = token() != null

    data class User(val userId: String, val name: String, val email: String, val avatarUrl: String?)

    /** Who a session belongs to (get-session with that bearer), or null. */
    suspend fun userOf(bearer: String): User? = withContext(Dispatchers.IO) {
        runCatching {
            val (res) = send(service.resolve("/api/auth/get-session")!!, "GET", emptyMap(), null, bearer, keep = false)
            res.use {
                if (it.code != 200) return@use null
                val user = JSONObject(it.body.string()).optJSONObject("user") ?: return@use null
                val id = user.optString("id").takeIf { i -> Regex("^[A-Za-z0-9_-]{1,64}$").matches(i) } ?: return@use null
                User(id, user.optString("name"), user.optString("email"), user.optString("image").takeIf { u -> u.startsWith("https://") })
            }
        }.getOrNull()
    }

    /** The single session an older build kept, moved to its account's own secret: that account, or null. */
    suspend fun adoptLegacy(): User? {
        val legacy = token(null) ?: return null
        val user = userOf(legacy) ?: return null
        if (token(user.userId) == null) store.set(slotName(user.userId), legacy)
        store.delete(TOKEN)
        return user
    }

    /** Builds a sign-in for one more account: the /connect address, and what finishes it (who it was, or null). */
    fun beginAccount(): Pair<String, suspend () -> User?> {
        val (url, code) = beginCode()
        return url to finish@{
            val access = code() ?: return@finish null
            val user = userOf(access)
            if (user == null) {
                withContext(Dispatchers.IO) { endSession(access) }
                return@finish null
            }
            val previous = token(user.userId)
            store.set(slotName(user.userId), access)
            // The same person again: only their old session here ends.
            if (previous != null && previous != access) withContext(Dispatchers.IO) { endSession(previous) }
            user
        }
    }

    /** Another account's Convex token (moving notes between two accounts). */
    suspend fun convexTokenFor(user: String): String? = withContext(Dispatchers.IO) {
        val bearer = token(user) ?: return@withContext null
        val (res) = send(service.resolve("/api/auth/convex/token")!!, "GET", emptyMap(), null, bearer, slot = user)
        res.use { if (!it.isSuccessful) null else JSONObject(it.body.string()).optString("token").takeIf { t -> t.isNotEmpty() } }
    }

    /** Ends one account's session here and forgets its token. */
    suspend fun signOutUser(user: String) = withContext(Dispatchers.IO) {
        token(user)?.let { endSession(it) }
        store.delete(slotName(user))
    }

    /** Whether a link that opened the app ends a sign-in (the custom scheme or the App Link). */
    fun isCallback(url: String): Boolean = Companion.isCallback(url, redirectUri)

    /** A redirect from the browser: true when it was one of ours (whether or not a sign-in was waiting). */
    fun handleCallback(url: String): Boolean {
        if (!isCallback(url)) return false
        val state = queryParam(url, "state")
        val p = pending
        // Only the sign-in this app started (its state): a link someone else crafted signs nobody in.
        if (p != null && state != null && state == p.state) {
            pending = null
            p.answer.complete(url)
        }
        return true
    }

    /** The person came back to the app without finishing (closed the Custom Tab): the sign-in ends. */
    fun cancelPending() {
        val p = pending
        pending = null
        p?.answer?.complete(null)
    }

    fun pendingSignIn(): Boolean = pending != null

    /** Builds the /connect address for a new sign-in; what finishes it stores the session as the open place's. */
    fun begin(): Pair<String, suspend () -> Boolean> {
        val (url, code) = beginCode()
        return url to finish@{
            val access = code() ?: return@finish false
            val previous = token()
            store.set(slotName(currentUser()), access)
            // Signing in again (after a stale session) ends the session this phone held before.
            if (previous != null && previous != access) withContext(Dispatchers.IO) { endSession(previous) }
            true
        }
    }

    /** The /connect address for a new sign-in, and what waits for it to end in a new session's token (or null). */
    private fun beginCode(): Pair<String, suspend () -> String?> {
        cancelPending()
        val verifier = b64url(bytes(32))
        val challenge = b64url(MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray()))
        val state = b64url(bytes(24))
        val connect = service.newBuilder()
            .encodedPath("/connect")
            .addQueryParameter("client_id", CLIENT_ID)
            .addQueryParameter("redirect_uri", redirectUri)
            .addQueryParameter("code_challenge", challenge)
            .addQueryParameter("code_challenge_method", "S256")
            .addQueryParameter("state", state)
            .build()
        val entry = Pending(state, CompletableDeferred())
        pending = entry
        val finish: suspend () -> String? = finish@{
            val callback = withTimeoutOrNull(signInTimeoutMs) { entry.answer.await() }
            if (pending === entry) pending = null
            if (callback == null) return@finish null
            if (queryParam(callback, "error") != null) return@finish null
            val code = queryParam(callback, "code")?.takeIf { it.isNotEmpty() && it.length <= 128 } ?: return@finish null
            exchange(code, verifier)
        }
        return connect.toString() to finish
    }

    private suspend fun exchange(code: String, verifier: String): String? = withContext(Dispatchers.IO) {
        val body = JSONObject()
            .put("grant_type", "authorization_code")
            .put("code", code)
            .put("code_verifier", verifier)
            .put("client_id", CLIENT_ID)
            .put("redirect_uri", redirectUri)
            .put("device_name", deviceName().take(60))
            .toString()
        val request = Request.Builder()
            .url(service.resolve("/api/auth/native/token")!!)
            .post(body.toRequestBody(JSON))
            .header("origin", origin)
            .header("cache-control", "no-store")
            .build()
        val access = runCatching {
            http.newCall(request).execute().use { res ->
                if (res.code != 200) return@use null
                JSONObject(res.body.string()).optString("access_token").takeIf { TOKEN_RE.matches(it) }
            }
        }.getOrNull()
        access
    }

    /** `keep`: a rotated token goes back to `slot` (the open place's by default); false for a token being checked. */
    private fun send(url: HttpUrl, method: String, headers: Map<String, String>, body: String?, bearer: String?, keep: Boolean = true, slot: String? = currentUser()): Pair<okhttp3.Response, String?> {
        val b = Request.Builder().url(url)
        for ((k, v) in headers) b.header(k, v)
        b.header("origin", origin)
        if (bearer != null) b.header("authorization", "Bearer $bearer")
        if (method == "POST") b.post((body ?: "").toRequestBody(headers["content-type"]?.toMediaType())) else b.get()
        val res = http.newCall(b.build()).execute()
        // A refreshed session comes back as a new token (Better Auth's bearer plugin): keep it.
        val rotated = res.header("set-auth-token")
        if (keep && bearer != null && rotated != null && rotated != bearer && TOKEN_RE.matches(rotated)) store.set(slotName(slot), rotated)
        return res to rotated
    }

    private fun endSession(bearer: String) {
        runCatching {
            send(service.resolve("/api/auth/sign-out")!!, "POST", mapOf("content-type" to "application/json"), "{}", bearer).first.close()
        }
        // Offline: the session expires on its own, and Settings > Devices can end it from anywhere.
    }

    suspend fun signOut() = withContext(Dispatchers.IO) {
        cancelPending()
        token()?.let { endSession(it) }
        store.delete(slotName(currentUser()))
    }

    /** The page's request, only to the website's /api/auth. Throws for anything else. */
    suspend fun fetch(path: String, method: String, headers: Map<String, String>, body: String?): Response = withContext(Dispatchers.IO) {
        val url = authUrl(service, path) ?: throw IllegalArgumentException("Folevi only sends the website's /api/auth requests from here.")
        val m = method.uppercase()
        if (m !in METHODS) throw IllegalArgumentException("Only GET and POST reach the website from here.")
        if (body != null && (m == "GET" || body.length > MAX_BODY)) throw IllegalArgumentException("That request can't be sent.")
        val clean = cleanHeaders(headers)
        val bearer = token()
        val (res, rotated) = send(url, m, clean, body, bearer)
        res.use {
            val out = LinkedHashMap<String, String>()
            for (name in it.headers.names()) {
                val key = name.lowercase()
                if (key !in HIDDEN_HEADERS) out[key] = it.headers.values(name).joinToString(", ")
            }
            Response(it.code, out, scrub(it.body.string(), listOf(bearer, rotated, token())))
        }
    }

    /** A short-lived Convex JWT for the page, or null when signed out. Throws when the website can't be reached. */
    suspend fun convexToken(): String? = withContext(Dispatchers.IO) {
        val bearer = token() ?: return@withContext null
        val (res) = send(service.resolve("/api/auth/convex/token")!!, "GET", emptyMap(), null, bearer)
        res.use {
            when {
                it.code == 401 -> {
                    // The session ended (signed out from Settings > Devices, expired): forget it.
                    store.delete(slotName(currentUser()))
                    null
                }
                it.code == 403 -> null
                !it.isSuccessful -> throw IllegalStateException("Folevi couldn't get a sync token (${it.code}).")
                else -> JSONObject(it.body.string()).optString("token").takeIf { t -> t.isNotEmpty() }
            }
        }
    }

    private fun bytes(n: Int) = ByteArray(n).also { random.nextBytes(it) }

    companion object {
        const val CLIENT_ID = "folevi-android"
        const val TOKEN = "auth.session"
        private val JSON = "application/json".toMediaType()
        private val METHODS = setOf("GET", "POST")
        /** Request headers the page may set; everything else (Authorization, Cookie, Origin, Host…) is the app's. */
        private val PAGE_HEADERS = setOf("accept", "accept-language", "content-type", "cache-control", "pragma")
        /** Response headers the page never sees. */
        private val HIDDEN_HEADERS = setOf("set-cookie", "set-cookie2", "set-auth-token")
        private const val MAX_BODY = 1_000_000
        private const val MAX_PATH = 4096
        val TOKEN_RE = Regex("^[A-Za-z0-9._~+/=-]{16,1024}$")

        fun b64url(bytes: ByteArray): String = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)

        fun queryParam(url: String, name: String): String? = runCatching { java.net.URI(url) }.getOrNull()?.rawQuery
            ?.split('&')
            ?.map { it.split('=', limit = 2) }
            ?.firstOrNull { it[0] == name }
            ?.let { java.net.URLDecoder.decode(it.getOrElse(1) { "" }, "UTF-8") }

        fun isCallback(url: String, redirectUri: String): Boolean {
            if (url.length > 2000) return false
            val u = runCatching { java.net.URI(url) }.getOrNull() ?: return false
            val r = runCatching { java.net.URI(redirectUri) }.getOrNull() ?: return false
            return u.scheme.equals(r.scheme, true) && u.host.equals(r.host, true) && (u.port == r.port) && u.rawPath == r.rawPath
        }

        /**
         * The page's path as a URL on the website's /api/auth, or null. Plain paths only: no other host, no
         * traversal (dot segments resolved, encoded or not), no encoded slashes or backslashes, no control characters.
         */
        fun authUrl(service: HttpUrl, path: String): HttpUrl? {
            if (path.length > MAX_PATH || !path.startsWith("/api/auth/")) return null
            if (path.any { it.code < 0x20 || it.code == 0x7f || it == '\\' }) return null
            if (Regex("%(2f|5c|00)", RegexOption.IGNORE_CASE).containsMatchIn(path)) return null
            val url = service.resolve(path) ?: return null
            if (url.scheme != service.scheme || url.host != service.host || url.port != service.port) return null
            if (!url.encodedPath.startsWith("/api/auth/") || url.username.isNotEmpty() || url.password.isNotEmpty()) return null
            return url.newBuilder().fragment(null).build()
        }

        fun cleanHeaders(headers: Map<String, String>): Map<String, String> = headers
            .mapKeys { it.key.lowercase() }
            .filter { (k, v) -> k in PAGE_HEADERS && v.length <= 1000 && !v.contains('\r') && !v.contains('\n') }

        /** Removes every form of the session token (signed "raw.signature" and raw) from text bound for the page. */
        fun scrub(text: String, tokens: List<String?>): String {
            val forms = LinkedHashSet<String>()
            for (t in tokens) {
                if (t.isNullOrEmpty()) continue
                for (form in listOf(t, java.net.URLEncoder.encode(t, "UTF-8"), t.substringBefore('.'))) if (form.length >= 16) forms.add(form)
            }
            var out = text
            for (form in forms.sortedByDescending { it.length }) out = out.replace(form, "")
            return out
        }
    }
}
