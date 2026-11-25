package com.folevi.android

import com.folevi.android.auth.AuthBridge
import com.folevi.android.secure.Secrets
import com.folevi.android.server.LocalServers
import com.folevi.android.server.ShellServer
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import mockwebserver3.Dispatcher
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import mockwebserver3.RecordedRequest
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.InetAddress

/** Folevi Server places (server/ShellServer.kt, docs/self-hosting/CONTRACT.md §6), as iOS's ServerTests. */
class ServerTest {
    private fun info(extra: JSONObject.() -> Unit = {}) = JSONObject()
        .put("kind", "folevi-server").put("apiVersion", 1).put("name", "Smith family").put("version", "1.0.0").put("minAppVersion", "1.6.0")
        .put("urls", JSONObject().put("app", "https://nas.example.com").put("convex", "https://nas.example.com/convex").put("convexSite", "https://nas.example.com/convex-site"))
        .put("connect", JSONObject().put("serverId", "abc123").put("hostnames", JSONArray(listOf("abc123.folevi.app", "192-168-1-20.abc123.folevi.app"))))
        .put("needsSetup", false)
        .apply(extra)

    private fun ok(r: ShellServer.Result) = (r as ShellServer.Result.Ok).server

    private fun refused(r: ShellServer.Result) = (r as ShellServer.Result.Refused).problem.code

    @Test
    fun addressesAreHttpsAnywhereAndHttpOnlyAtHome() {
        assertEquals("https://nas.example.com", ShellServer.normalizeOrigin(" nas.example.com "))
        assertEquals("https://nas.example.com:8443", ShellServer.normalizeOrigin("https://NAS.example.com:8443/"))
        assertEquals("https://nas.example.com", ShellServer.normalizeOrigin("https://nas.example.com:443"))
        assertEquals("http://192.168.1.20:8460", ShellServer.normalizeOrigin("http://192.168.1.20:8460"))
        assertEquals("http://10.0.2.2:8460", ShellServer.normalizeOrigin("http://10.0.2.2:8460"))
        assertEquals("http://nas", ShellServer.normalizeOrigin("http://nas:80"))
        assertEquals("http://nas.local:8460", ShellServer.normalizeOrigin("http://nas.local:8460"))
        assertEquals("http://100.100.1.2", ShellServer.normalizeOrigin("http://100.100.1.2"))
        assertEquals("http://[fd00::1]:8460", ShellServer.normalizeOrigin("http://[fd00::1]:8460"))
        assertEquals("http://[fe80::1]", ShellServer.normalizeOrigin("http://[fe80::1]"))
        // Plain http on the internet, other schemes, paths, queries, user names: refused.
        for (bad in listOf("http://nas.example.com", "http://8.8.8.8", "http://100.200.1.1", "http://[2001:db8::1]", "ftp://nas", "https://nas.example.com/app", "https://nas.example.com?x=1", "https://me@nas.example.com", "https://nas .com", "", "https://", "https://a..b")) {
            assertNull(bad, ShellServer.normalizeOrigin(bad))
        }
    }

    @Test
    fun versionsCompareByNumbers() {
        assertEquals(0, ShellServer.compareVersions("1.6", "1.6.0"))
        assertEquals(-1, ShellServer.compareVersions("1.5.74", "1.6.0"))
        assertEquals(1, ShellServer.compareVersions("1.10.0", "1.9.9"))
        assertEquals(0, ShellServer.compareVersions("1.6.0-beta.2", "1.6.0"))
    }

    @Test
    fun folevi_jsonIsCheckedAgainstThisApp() {
        val s = ok(ShellServer.check(info(), "https://nas.example.com", "1.6.0"))
        assertEquals("Smith family", s.name)
        assertEquals("abc123", s.serverId)
        assertEquals(ShellServer.Urls("https://nas.example.com", "https://nas.example.com/convex", "https://nas.example.com/convex-site"), s.urls)
        // Home names first, then the address added, then the rest.
        assertEquals(listOf("https://192-168-1-20.abc123.folevi.app", "https://nas.example.com", "https://abc123.folevi.app"), s.candidates)

        assertEquals("app_outdated", refused(ShellServer.check(info(), "https://nas.example.com", "1.5.74")))
        assertEquals("folevi_cloud", refused(ShellServer.check(info { put("kind", "folevi-cloud") }, "https://app.folevi.com", "1.6.0")))
        assertEquals("not_folevi", refused(ShellServer.check(JSONObject().put("hello", 1), "https://x.example.com", "1.6.0")))
        assertEquals("needs_setup", refused(ShellServer.check(info { put("needsSetup", true) }, "https://nas.example.com", "1.6.0")))
        assertEquals("server_outdated", refused(ShellServer.check(info { put("apiVersion", 0) }, "https://nas.example.com", "1.6.0")))
        assertEquals("app_outdated", refused(ShellServer.check(info { put("apiVersion", 2) }, "https://nas.example.com", "1.6.0")))
        assertEquals("server_outdated", refused(ShellServer.check(info { put("version", "0.9.0") }, "https://nas.example.com", "1.6.0")))
        // Addresses Folevi won't use (plain http on the internet) make it not a server this app can use.
        val plain = info { put("urls", JSONObject().put("app", "http://nas.example.com").put("convex", "http://nas.example.com/convex").put("convexSite", "http://nas.example.com/convex-site")) }
        assertEquals("not_folevi", refused(ShellServer.check(plain, "https://nas.example.com", "1.6.0")))
    }

    @Test
    fun lookUpFetchesFolevi_jsonItself() {
        val server = MockWebServer()
        var body = info { remove("minAppVersion") }.toString()
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse =
                if (request.url.encodedPath == "/.well-known/folevi.json") MockResponse.Builder().code(200).body(body).build() else MockResponse.Builder().code(404).build()
        }
        server.start()
        val origin = "http://127.0.0.1:${server.port}"
        val http = ShellServer.client(OkHttpClient())
        assertEquals("Smith family", ok(ShellServer.lookUp(http, origin, "1.6.0")).name)
        body = "<html>not json</html>"
        assertEquals("not_folevi", refused(ShellServer.lookUp(http, origin, "1.6.0")))
        body = "x".repeat(70_000)
        assertEquals("not_folevi", refused(ShellServer.lookUp(http, origin, "1.6.0")))
        assertEquals("bad_address", refused(ShellServer.lookUp(http, "http://8.8.8.8", "1.6.0")))
        server.close()
        assertEquals("unreachable", refused(ShellServer.lookUp(http, origin, "1.6.0")))
    }

    private fun memory(initial: String? = null): Places.Store = object : Places.Store {
        var json: String? = initial
        override fun read() = json
        override fun write(json: String) {
            this.json = json
        }
    }

    @Test
    fun aServerAccountKeepsItsServerAndAnOlderFileReadsUnchanged() {
        val nas = ok(ShellServer.check(info(), "https://nas.example.com", "1.6.0"))
        val store = memory()
        val p = Places(store)
        // The sign-in screen of that server: the account that signs in there is on it.
        p.setCurrent(null, pending = true, server = nas)
        assertEquals(nas, p.serverOf(null))
        assertEquals(nas, p.actingServer)
        val ana = p.addAccount("userAna", "Ana", "ana@example.com", null)!!
        assertEquals(nas, ana.server)
        p.setCurrent(ana.id)
        assertNull(p.pendingServer)
        // A Folevi Cloud account beside it.
        val ben = p.addAccount("userBen", "Ben", "ben@example.com", null, server = null)!!
        assertNull(ben.server)
        val listed = p.list(null, "", false)
        assertEquals("Smith family", listed.getJSONObject(0).getJSONObject("server").getString("name"))
        assertTrue(listed.getJSONObject(1).isNull("server"))
        // The best connection: one of the server's names only.
        assertFalse(p.setActiveOrigin(ana.id, "https://evil.example.com"))
        assertTrue(p.setActiveOrigin(ana.id, "https://192-168-1-20.abc123.folevi.app"))
        assertEquals("https://192-168-1-20.abc123.folevi.app/convex", p.serverOf(ana.id)!!.activeUrls.convex)
        assertEquals("https://192-168-1-20.abc123.folevi.app", p.serverOf(ana.id)!!.json().getString("origin"))
        assertEquals("https://nas.example.com", p.serverOf(ana.id)!!.json().getString("addedOrigin"))
        assertFalse(p.setActiveOrigin(ben.id, "https://nas.example.com"))
        // It all survives a restart.
        val again = Places(memory(store.read()))
        assertEquals(p.state, again.state)

        // A file from before servers: every account is Folevi Cloud's and it writes back without a `server` key.
        val old = """{"v":1,"current":"acct:userAna","library":true,"accounts":[{"userId":"userAna","profileId":null,"name":"Ana","email":"ana@example.com","avatarUrl":null,"workspaces":[],"unread":0,"reminders":0,"waiting":0}],"quickAdd":null,"lastAdded":null}"""
        val before = Places(memory(old))
        assertNull(before.state.accounts.single().server)
        assertEquals(JSONObject(old).toString(), Places.serialize(before.state))
    }

    @Test
    fun aServerPlacesPagesReachThatServerOnly() {
        val nas = ok(ShellServer.check(info(), "https://nas.example.com", "1.6.0"))
        val sources = ShellServer.Policy.connectSources(nas)
        assertTrue("https://nas.example.com" in sources)
        assertTrue("wss://nas.example.com" in sources)
        assertTrue("wss://192-168-1-20.abc123.folevi.app" in sources)
        val policy = ShellServer.Policy.forServer(nas)
        assertTrue(policy.startsWith("connect-src 'self' https://192-168-1-20.abc123.folevi.app"))
        assertFalse(policy.contains("convex.cloud"))
        val home = ok(ShellServer.check(info { put("urls", JSONObject().put("app", "http://192.168.1.20:8460").put("convex", "http://192.168.1.20:8460/convex").put("convexSite", "http://192.168.1.20:8460/convex-site")); remove("connect") }, "http://192.168.1.20:8460", "1.6.0"))
        assertEquals(listOf("http://192.168.1.20:8460", "ws://192.168.1.20:8460"), ShellServer.Policy.connectSources(home))
        assertTrue(ShellServer.Policy.CLOUD_NARROWING.startsWith("connect-src 'self' folevi-file: https://*.convex.cloud"))
    }

    @Test
    fun serversOnTheHomeNetworkComeWithAnAddress() {
        val withUrl = LocalServers.entry("folevi-nas", mapOf("url" to "https://192-168-1-20.abc123.folevi.app", "name" to "Smith family", "id" to "abc123", "v" to "1.0.0"), InetAddress.getByName("192.168.1.20"), 443)!!
        assertEquals("https://192-168-1-20.abc123.folevi.app", withUrl.getString("origin"))
        assertEquals("Smith family", withUrl.getString("name"))
        assertEquals("abc123", withUrl.getString("serverId"))
        assertEquals("1.0.0", withUrl.getString("version"))
        val bare = LocalServers.entry("folevi-nas", emptyMap(), InetAddress.getByName("192.168.1.20"), 8460)!!
        assertEquals("http://192.168.1.20:8460", bare.getString("origin"))
        assertEquals("folevi-nas", bare.getString("name"))
        assertTrue(bare.isNull("serverId"))
        // A public address without a url isn't one Folevi reaches over http.
        assertNull(LocalServers.entry("x", emptyMap(), InetAddress.getByName("8.8.8.8"), 80))
    }

    @Test
    fun anAccountOnAServerSignsInAndTalksToThatServer() = runBlocking {
        val cloudToken = "sess_" + "c".repeat(40)
        val nasToken = "sess_" + "n".repeat(40)
        fun site(token: String, user: String) = MockWebServer().apply {
            dispatcher = object : Dispatcher() {
                override fun dispatch(request: RecordedRequest): MockResponse {
                    val bearer = request.headers["authorization"]?.removePrefix("Bearer ")
                    return when (request.url.encodedPath) {
                        "/api/auth/native/token" -> MockResponse.Builder().code(200).body(JSONObject().put("access_token", token).toString()).build()
                        "/api/auth/get-session" -> if (bearer == token) MockResponse.Builder().code(200).body("{\"user\":{\"id\":\"$user\",\"email\":\"$user@example.com\"}}").build() else MockResponse.Builder().code(200).body("null").build()
                        "/api/auth/convex/token" -> if (bearer == token) MockResponse.Builder().code(200).body("{\"token\":\"jwt-$user\"}").build() else MockResponse.Builder().code(401).build()
                        else -> MockResponse.Builder().code(200).body("{}").build()
                    }
                }
            }
            start()
        }
        val cloud = site(cloudToken, "userCloud")
        val nasSite = site(nasToken, "userNas")
        val nasOrigin = "http://127.0.0.1:${nasSite.port}"
        val nas = ShellServer(nasOrigin, "NAS", "1.0.0", null, ShellServer.Urls(nasOrigin, "$nasOrigin/convex", "$nasOrigin/convex-site"))
        val secrets = object : Secrets {
            val map = HashMap<String, String>()
            override fun get(name: String) = map[name]
            override fun set(name: String, value: String) { map[name] = value }
            override fun delete(name: String) { map.remove(name) }
        }
        val places = Places(memory())
        val bridge = AuthBridge(
            cloud.url("/").toString(), "com.folevi.android://auth/callback", OkHttpClient(), secrets, { "Pixel" },
            currentUser = { places.currentUserId },
            actingSite = { places.actingServer?.appUrl },
            siteOfUser = { places.serverOfUser(it)?.appUrl },
        )
        suspend fun signIn(): AuthBridge.User? {
            val (url, finish) = bridge.beginAccount()
            val r = async { finish() }
            delay(30)
            bridge.handleCallback("com.folevi.android://auth/callback?code=c&state=${url.toHttpUrl().queryParameter("state")}")
            return r.await()
        }
        // The server's sign-in screen: /connect is the server's, and so is the session.
        places.setCurrent(null, pending = true, server = nas)
        assertEquals(nasSite.port, bridge.beginAccount().first.toHttpUrl().port)
        val n = signIn()!!
        assertEquals("userNas", n.userId)
        places.addAccount(n.userId, n.name, n.email, null)
        // Folevi Cloud's sign-in, from a fresh sign-in screen.
        places.setCurrent(null, pending = true)
        val c = signIn()!!
        assertEquals("userCloud", c.userId)
        places.addAccount(c.userId, c.name, c.email, null)
        assertEquals(nas, places.serverOfUser("userNas"))
        assertNull(places.serverOfUser("userCloud"))
        // Each account's calls go to its own website, with that website's origin.
        places.setCurrent("acct:userNas")
        assertEquals("jwt-userNas", bridge.convexToken())
        places.setCurrent("acct:userCloud")
        assertEquals("jwt-userCloud", bridge.convexToken())
        assertEquals("jwt-userNas", bridge.convexTokenFor("userNas"))
        val sent = nasSite.takeRequest()
        assertEquals(nasOrigin, sent.headers["origin"])
        cloud.close()
        nasSite.close()
    }
}
