package com.folevi.android.server

import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.net.Inet6Address
import java.net.InetAddress
import java.net.URI
import java.util.concurrent.TimeUnit

/**
 * Folevi Server places (docs/SELF_HOSTING_PLAN.md §4 and §8, docs/self-hosting/CONTRACT.md §6), the Android twin of
 * the iPhone, iPad and Mac apps' ShellServer.swift (keep the two in step):
 * - what an account place keeps of its own server (a place without one is Folevi Cloud's, as before): the address
 *   the person added, the addresses its /.well-known/folevi.json gave, its other names (Folevi Connect's home and
 *   public hostnames) and the one in use now;
 * - the rules for an address someone adds (https, or http only on the home network), the version check, and the
 *   Content-Security-Policy a page of that place gets ([Policy]).
 * The best connection is the page's (lib/server-edition/connection.ts, run by the bridge script); this only checks
 * that what it picks is one of the server's names. Nothing here is secret. Pure logic, so the JVM tests run it.
 */
data class ShellServer(
    /** The address the person added (or picked from the home network), as [normalizeOrigin] writes it. */
    val origin: String,
    val name: String,
    /** The server's own version (folevi.json `version`). */
    val version: String,
    /** Folevi Connect's id, when the server is linked. */
    val serverId: String?,
    /** The addresses folevi.json gave for [origin]. */
    val urls: Urls,
    /** Folevi Connect's names ("host" or "host:port", always https); [candidates] puts them in the order to try. */
    val hostnames: List<String> = emptyList(),
    /** The origin in use now (the page's best connection); null: [origin]. */
    val active: String? = null,
) {
    data class Urls(val app: String, val convex: String, val convexSite: String)

    val activeOrigin: String get() = active ?: origin

    /** The addresses for the origin in use now: each of [urls] on [origin] moves to the active origin, same path. */
    val activeUrls: Urls get() = addresses(activeOrigin)

    fun addresses(at: String): Urls = Urls(move(urls.app, origin, at), move(urls.convex, origin, at), move(urls.convexSite, origin, at))

    /** The website of this place now (sign-in and /api/auth: AuthBridge). */
    val appUrl: String get() = activeUrls.app

    /**
     * Every origin this server can be reached at, in the order to try: home names (Connect's
     * `192-168-1-20.<id>.folevi.app`), then the address the person added, then the other names (public, relay).
     */
    val candidates: List<String>
        get() {
            val named = hostnames.mapNotNull { normalizeOrigin("https://$it") }
            return (named.filter(::isHomeName) + origin + named).distinct()
        }

    /** What the page starts with (`places.server`) and what the places list carries (ShellServerInfo). */
    fun json(): JSONObject {
        val u = activeUrls
        return JSONObject()
            .put("origin", activeOrigin).put("addedOrigin", origin).put("name", name).put("version", version)
            .put("serverId", serverId ?: JSONObject.NULL)
            .put("urls", JSONObject().put("app", u.app).put("convex", u.convex).put("convexSite", u.convexSite))
    }

    /** What the bridge script needs for the best connection (connection.ts ServerPlaceAddresses), page-private. */
    fun reachJson(): JSONObject = JSONObject()
        .put("addedOrigin", origin).put("hostnames", JSONArray(hostnames)).put("serverId", serverId ?: JSONObject.NULL).put("active", activeOrigin)

    /** As places.json keeps it. */
    fun store(): JSONObject = JSONObject()
        .put("origin", origin).put("name", name).put("version", version).put("serverId", serverId ?: JSONObject.NULL)
        .put("urls", JSONObject().put("app", urls.app).put("convex", urls.convex).put("convexSite", urls.convexSite))
        .put("hostnames", JSONArray(hostnames)).put("active", active ?: JSONObject.NULL)

    /** Why a server can't be added; `code` is what the page reads, `message` its words for people. */
    enum class Problem(val code: String, val message: String) {
        BAD_ADDRESS("bad_address", "That isn't an address Folevi can use. Use https, or http only for an address on your home network."),
        UNREACHABLE("unreachable", "Folevi couldn't reach that server. Check the address and that the server is running."),
        NOT_FOLEVI("not_folevi", "That address isn't a Folevi server."),
        FOLEVI_CLOUD("folevi_cloud", "That's Folevi Cloud. Sign in with Folevi Cloud instead."),
        SERVER_OUTDATED("server_outdated", "This server is too old for this app. Ask the person who runs this server to update it."),
        APP_OUTDATED("app_outdated", "This server needs a newer Folevi. Update Folevi, then try again."),
        NEEDS_SETUP("needs_setup", "This server isn't set up yet. Open its address in a browser to finish setting it up."),
    }

    sealed class Result {
        data class Ok(val server: ShellServer) : Result()
        data class Refused(val problem: Problem) : Result()
    }

    companion object {
        /** The API version this app speaks (CONTRACT §6 `apiVersion`). */
        const val API_VERSION = 1

        /** The oldest server this app works with. */
        const val MIN_SERVER_VERSION = "1.0.0"

        private val HOME_LABEL = Regex("^\\d{1,3}-\\d{1,3}-\\d{1,3}-\\d{1,3}$")
        private val HOST_CHARS = Regex("^[a-z0-9.:-]+$")
        private val HOSTNAME = Regex("^[a-z0-9.-]{1,253}(:[0-9]{1,5})?$")
        private val SERVER_ID = Regex("^[a-z0-9]{1,32}$")
        private val BARE_NAME = Regex("^[a-z0-9-]+$")

        private fun move(url: String, from: String, to: String): String =
            if (from == to || !(url == from || url.startsWith("$from/"))) url else to + url.substring(from.length)

        /** A Connect home name: its first label is a dashed IPv4 address ("https://192-168-1-20.abc.folevi.app"). */
        fun isHomeName(origin: String): Boolean {
            val host = runCatching { URI(origin).host }.getOrNull() ?: return false
            return host.contains('.') && HOME_LABEL.matches(host.substringBefore('.'))
        }

        /**
         * An address as the person typed it, as an origin ("https://host[:port]", lower case, no default port), or
         * null when Folevi won't use it: https anywhere; http only for an address on this network ([isLocalHost]).
         * No path, query, fragment or user name. "nas.example.com" is read as https.
         */
        fun normalizeOrigin(raw: String): String? {
            var text = raw.trim()
            if (text.isEmpty() || text.length > 300 || text.any { it.isWhitespace() }) return null
            if (!text.contains("://")) text = "https://$text"
            val u = runCatching { URI(text) }.getOrNull() ?: return null
            val scheme = u.scheme?.lowercase() ?: return null
            if (scheme != "https" && scheme != "http") return null
            if (u.rawUserInfo != null || u.rawQuery != null || u.rawFragment != null) return null
            val path = u.rawPath ?: ""
            if (path.isNotEmpty() && path != "/") return null
            val host = (u.host ?: return null).trim('[', ']').lowercase()
            if (host.isEmpty() || !HOST_CHARS.matches(host) || host.startsWith(".") || host.endsWith(".") || host.contains("..")) return null
            if (scheme == "http" && !isLocalHost(host)) return null
            val port = u.port
            if (port != -1 && port !in 1..65535) return null
            val shownPort = if (port == -1 || (scheme == "https" && port == 443) || (scheme == "http" && port == 80)) "" else ":$port"
            val shown = if (host.contains(':')) "[$host]" else host
            return "$scheme://$shown$shownPort"
        }

        /**
         * Whether a host (no brackets) is on this network: localhost, a name with no dots, a `.local` name, or a
         * private, loopback, link-local or shared (Tailscale's 100.64/10) address. Written addresses only: names are
         * never looked up.
         */
        fun isLocalHost(host: String): Boolean {
            val h = host.lowercase().trim('[', ']')
            if (h == "localhost" || h.endsWith(".local") || h.endsWith(".localhost")) return true
            ipv4(h)?.let { (a, b) ->
                return a == 10 || a == 127 || (a == 172 && b in 16..31) || (a == 192 && b == 168) || (a == 169 && b == 254) || (a == 100 && b in 64..127)
            }
            if (h.contains(':')) {
                // An IPv6 literal only (a colon never appears in a name, so this never asks DNS).
                if (!Regex("^[0-9a-f:.]+$").matches(h)) return false
                val a = runCatching { InetAddress.getByName(h) }.getOrNull() as? Inet6Address ?: return false
                val b = a.address
                val loopback = (0 until 15).all { b[it].toInt() == 0 } && b[15].toInt() == 1
                return loopback || (b[0].toInt() and 0xfe) == 0xfc || (b[0].toInt() and 0xff == 0xfe && (b[1].toInt() and 0xc0) == 0x80)
            }
            // A bare name ("nas"): the home network's own.
            return !h.contains('.') && BARE_NAME.matches(h)
        }

        private fun ipv4(h: String): Pair<Int, Int>? {
            val parts = h.split('.')
            if (parts.size != 4) return null
            val n = parts.map { p -> if (p.isNotEmpty() && p.length <= 3 && p.all(Char::isDigit)) p.toInt() else return null }
            return if (n.all { it in 0..255 }) n[0] to n[1] else null
        }

        /** A URL folevi.json gives (urls.app and the rest): http(s) under the same rules as an added address, any path. */
        fun allowedUrl(raw: String): Boolean {
            if (raw.length > 500) return false
            val u = runCatching { URI(raw) }.getOrNull() ?: return false
            val scheme = u.scheme?.lowercase() ?: return false
            val host = u.host ?: return false
            if (u.rawUserInfo != null || u.rawQuery != null || u.rawFragment != null) return false
            val port = if (u.port == -1) "" else ":${u.port}"
            return normalizeOrigin("$scheme://$host$port") != null
        }

        /**
         * -1, 0 or 1 as `a` is older than, the same as, or newer than `b`. Dotted numbers; anything after "-" (a
         * pre-release) is ignored, missing parts count as 0 ("1.6" == "1.6.0").
         */
        fun compareVersions(a: String, b: String): Int {
            fun parts(s: String) = s.trim().substringBefore('-').split('.').map { p -> p.filter(Char::isDigit).toIntOrNull() ?: 0 }
            val x = parts(a)
            val y = parts(b)
            for (i in 0 until maxOf(x.size, y.size)) {
                val p = x.getOrElse(i) { 0 }
                val q = y.getOrElse(i) { 0 }
                if (p != q) return if (p < q) -1 else 1
            }
            return 0
        }

        /**
         * The server folevi.json describes, checked against this app (CONTRACT §6): a Folevi server, an API version
         * this app speaks, set up, new enough for this app and this app new enough for it, and addresses Folevi uses.
         */
        fun check(info: JSONObject, origin: String, appVersion: String): Result {
            val kind = info.opt("kind") as? String ?: return Result.Refused(Problem.NOT_FOLEVI)
            if (kind == "folevi-cloud") return Result.Refused(Problem.FOLEVI_CLOUD)
            if (kind != "folevi-server") return Result.Refused(Problem.NOT_FOLEVI)
            val api = (info.opt("apiVersion") as? Number)?.toInt() ?: 0
            if (api > API_VERSION) return Result.Refused(Problem.APP_OUTDATED)
            if (api < API_VERSION) return Result.Refused(Problem.SERVER_OUTDATED)
            if (info.opt("needsSetup") == true) return Result.Refused(Problem.NEEDS_SETUP)
            val version = info.opt("version") as? String ?: "0"
            if (compareVersions(version, MIN_SERVER_VERSION) < 0) return Result.Refused(Problem.SERVER_OUTDATED)
            (info.opt("minAppVersion") as? String)?.let { if (compareVersions(appVersion, it) < 0) return Result.Refused(Problem.APP_OUTDATED) }
            val u = info.optJSONObject("urls") ?: return Result.Refused(Problem.NOT_FOLEVI)
            val app = u.opt("app") as? String
            val convex = u.opt("convex") as? String
            val site = u.opt("convexSite") as? String
            if (app == null || convex == null || site == null || !listOf(app, convex, site).all(::allowedUrl)) return Result.Refused(Problem.NOT_FOLEVI)
            val connect = info.optJSONObject("connect")
            val raw = connect?.optJSONArray("hostnames") ?: JSONArray()
            val hostnames = (0 until raw.length()).mapNotNull { raw.opt(it) as? String }.map { it.lowercase() }
                .filter { HOSTNAME.matches(it) && normalizeOrigin("https://$it") != null }.take(10)
            val serverId = (connect?.opt("serverId") as? String)?.takeIf { SERVER_ID.matches(it) }
            val name = (info.opt("name") as? String ?: "").trim().ifEmpty { "Folevi Server" }.take(120)
            fun trim(s: String) = s.removeSuffix("/")
            return Result.Ok(ShellServer(origin, name, version.take(40), serverId, Urls(trim(app), trim(convex), trim(site)), hostnames))
        }

        /** As places.json keeps it, checked again (a file is never trusted more than folevi.json was). */
        fun fromStore(o: JSONObject?): ShellServer? {
            if (o == null) return null
            val origin = (o.opt("origin") as? String)?.let(::normalizeOrigin) ?: return null
            val u = o.optJSONObject("urls") ?: return null
            val urls = Urls(u.optString("app"), u.optString("convex"), u.optString("convexSite"))
            if (!listOf(urls.app, urls.convex, urls.convexSite).all(::allowedUrl)) return null
            val raw = o.optJSONArray("hostnames") ?: JSONArray()
            val hostnames = (0 until raw.length()).mapNotNull { raw.opt(it) as? String }.filter { HOSTNAME.matches(it) }.take(10)
            val s = ShellServer(
                origin = origin,
                name = o.optString("name").ifEmpty { "Folevi Server" }.take(120),
                version = o.optString("version").take(40),
                serverId = (o.opt("serverId") as? String)?.takeIf { SERVER_ID.matches(it) },
                urls = urls,
                hostnames = hostnames,
            )
            val active = o.opt("active") as? String
            return if (active != null && active in s.candidates && active != origin) s.copy(active = active) else s
        }

        /** An OkHttp client for folevi.json: no cookies, no redirects, short timeouts. */
        fun client(base: OkHttpClient): OkHttpClient = base.newBuilder()
            .followRedirects(false).followSslRedirects(false)
            .connectTimeout(10, TimeUnit.SECONDS).readTimeout(10, TimeUnit.SECONDS).callTimeout(12, TimeUnit.SECONDS)
            .build()

        /** GETs `<origin>/.well-known/folevi.json` (64 KB at most). Throws when it can't be reached; NOT_FOLEVI otherwise. */
        fun fetchInfo(http: OkHttpClient, origin: String): JSONObject? {
            val req = Request.Builder().url("$origin/.well-known/folevi.json").header("accept", "application/json").header("cache-control", "no-store").build()
            http.newCall(req).execute().use { res ->
                if (res.code != 200) return null
                val source = res.body.source()
                // More than 64 KB isn't a folevi.json.
                if (source.request(64L * 1024 + 1)) return null
                return runCatching { JSONObject(source.buffer.readUtf8()) }.getOrNull()
            }
        }

        /** Checks an address someone added: the server it names, ready to become a place. Blocking (network). */
        fun lookUp(http: OkHttpClient, raw: String, appVersion: String): Result {
            val origin = normalizeOrigin(raw) ?: return Result.Refused(Problem.BAD_ADDRESS)
            val info = try {
                fetchInfo(http, origin)
            } catch (_: Exception) {
                return Result.Refused(Problem.UNREACHABLE)
            } ?: return Result.Refused(Problem.NOT_FOLEVI)
            return check(info, origin, appVersion)
        }
    }

    /**
     * The Content-Security-Policy header for the built-in interface's pages (FoleviWebViewClient). It narrows the
     * export's own meta policy (both apply), which since Folevi Server allows any http(s) and ws(s) origin.
     */
    object Policy {
        /**
         * What a page of a server place may connect to: every origin of the server's addresses, at each of its
         * names, over http(s) and the matching ws(s). Never Folevi Cloud's Convex.
         */
        fun connectSources(server: ShellServer): List<String> {
            val out = LinkedHashSet<String>()
            for (origin in server.candidates) {
                val u = server.addresses(origin)
                for (raw in listOf(u.app, u.convex, u.convexSite)) {
                    val uri = runCatching { URI(raw) }.getOrNull() ?: continue
                    val scheme = uri.scheme?.lowercase() ?: continue
                    val host = uri.host ?: continue
                    val port = if (uri.port == -1) "" else ":${uri.port}"
                    val ws = if (scheme == "https") "wss" else "ws"
                    out += "$scheme://$host$port"
                    out += "$ws://$host$port"
                }
            }
            return out.toList()
        }

        /**
         * Every place that isn't a server's: the connections, images and media the export's meta policy allowed
         * before it was widened for server places (apps/web/src/lib/shell/csp.ts). Only these directives, so they
         * narrow just them; everything else stays as the meta policy says. As iOS's ShellPolicy.cloudNarrowing.
         */
        const val CLOUD_NARROWING =
            "connect-src 'self' folevi-file: https://*.convex.cloud wss://*.convex.cloud https://*.convex.site; " +
                "img-src 'self' data: blob: folevi-file: https://*.convex.site https:; " +
                "media-src 'self' blob: folevi-file: https://*.convex.site"

        /** A server place's pages (or its sign-in screen): that server's origins only, for connections and media. */
        fun forServer(server: ShellServer): String {
            val sources = connectSources(server)
            val http = sources.filter { it.startsWith("http") }.joinToString(" ")
            return "connect-src 'self' ${sources.joinToString(" ")}; " +
                "img-src 'self' data: blob: https: $http; " +
                "media-src 'self' blob: https: $http"
        }
    }
}
