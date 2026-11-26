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

    private fun on(origin: String) = JSONObject().put("app", origin).put("convex", "$origin/convex").put("convexSite", "$origin/convex-site")

    /** A stand-in server whose folevi.json is whatever `body` returns at the time. */
    private fun answering(body: () -> String) = MockWebServer().apply {
        dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse =
                if (request.url.encodedPath == "/.well-known/folevi.json") MockResponse.Builder().code(200).body(body()).build() else MockResponse.Builder().code(404).build()
        }
        start()
    }

    /**
     * What a server could publish to have the app sign in at Folevi Cloud and then talk to the server with what
     * Folevi Cloud issued: Folevi Cloud's website for sign-in, its own address for the data.
     */
    @Test
    fun aServersAddressesAreOneOriginAndNeverFoleviClouds() {
        val cloud = "https://app.folevi.com"
        fun urls(u: JSONObject, typed: String) = ShellServer.check(info { put("urls", u) }, typed, "1.6.0", cloud)
        val attack = JSONObject().put("app", "https://app.folevi.com").put("convex", "https://evil.example/convex").put("convexSite", "https://evil.example/convex-site")
        assertEquals("not_folevi", refused(urls(attack, "https://evil.example")))
        assertEquals("not_folevi", refused(urls(on("https://evil.example").put("convex", "https://other.example/convex"), "https://evil.example")))
        assertEquals("not_folevi", refused(urls(on("https://evil.example").put("convexSite", "https://evil.example:8443/convex-site"), "https://evil.example")))
        for (host in listOf("app.folevi.com", "folevi.com", "x.folevi.com", "happy-otter-123.convex.cloud", "happy-otter-123.convex.site")) {
            assertEquals(host, "not_folevi", refused(urls(on("https://$host"), "https://evil.example")))
        }
        // This build's own website, whatever it is called (a debug build's).
        assertEquals("not_folevi", refused(ShellServer.check(info { put("urls", on("https://dev.example")) }, "https://evil.example", "1.6.0", "https://dev.example")))
        // A genuine server: one origin, its own (a Folevi Connect name is under folevi.app, not Folevi Cloud).
        assertEquals("https://nas.example.com", ok(urls(on("https://nas.example.com"), "https://nas.example.com")).publishedOrigin)
        assertEquals("https://abc123.folevi.app", ok(urls(on("https://abc123.folevi.app"), "http://192.168.1.20:8460")).publishedOrigin)
        assertEquals("http://192.168.1.20:8460", ok(urls(on("http://192.168.1.20:8460"), "http://192.168.1.20:8460")).publishedOrigin)
        // Folevi Cloud's names are left out of a server's other names too.
        val named = ok(ShellServer.check(info { put("connect", JSONObject().put("serverId", "abc123").put("hostnames", JSONArray(listOf("abc123.folevi.app", "app.folevi.com", "x.convex.cloud")))) }, "https://nas.example.com", "1.6.0", cloud))
        assertEquals(listOf("abc123.folevi.app"), named.hostnames)
    }

    @Test
    fun aServerPublishedAtAnotherAddressMustBeItselfThere() {
        val cloud = "https://app.folevi.com"
        val http = ShellServer.client(OkHttpClient())
        // Two stand-ins: the address typed, and the address the server says is its own.
        var there = "{}"
        val published = answering { there }
        val name = "http://127.0.0.1:${published.port}"
        val genuine = info { put("urls", on(name)) }
        val typed = answering { genuine.toString() }
        val origin = "http://127.0.0.1:${typed.port}"
        // The same server answers at its own address.
        there = genuine.toString()
        val s = ok(ShellServer.lookUp(http, origin, "1.6.0", cloud))
        assertEquals(origin, s.origin)
        assertEquals(name, s.publishedOrigin)
        // Someone else's server (another Folevi Connect id), Folevi Cloud, not a Folevi server, other addresses.
        there = info { put("urls", on(name)); put("connect", JSONObject().put("serverId", "zzz999")) }.toString()
        assertEquals("not_folevi", refused(ShellServer.lookUp(http, origin, "1.6.0", cloud)))
        there = info { put("urls", on(name)); put("kind", "folevi-cloud") }.toString()
        assertEquals("not_folevi", refused(ShellServer.lookUp(http, origin, "1.6.0", cloud)))
        there = "<html>hello</html>"
        assertEquals("not_folevi", refused(ShellServer.lookUp(http, origin, "1.6.0", cloud)))
        there = info { put("urls", on("https://evil.example")) }.toString()
        assertEquals("not_folevi", refused(ShellServer.lookUp(http, origin, "1.6.0", cloud)))
        // Its own address doesn't answer.
        published.close()
        assertEquals("unreachable", refused(ShellServer.lookUp(http, origin, "1.6.0", cloud)))
        typed.close()
    }

    @Test
    fun lookUpFetchesFolevi_jsonItself() {
        val server = MockWebServer()
        // (Its addresses are on the address asked, so that one answer is the whole check.)
        var body = ""
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse =
                if (request.url.encodedPath == "/.well-known/folevi.json") MockResponse.Builder().code(200).body(body).build() else MockResponse.Builder().code(404).build()
        }
        server.start()
        val origin = "http://127.0.0.1:${server.port}"
        body = info { remove("minAppVersion"); put("urls", on(origin)) }.toString()
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

    /**
     * Sessions are kept by user id, and a server says what its user ids are. A server that answers a sign-in with
     * the id of an account from elsewhere is refused and never sees that account's session; the same the other way
     * round; and the one session older builds kept (Folevi Cloud's) never goes to a server's sign-in screen.
     */
    @Test
    fun aSignInThatComesBackAsAnotherServersAccountIsRefused() = runBlocking {
        val cloudToken = "sess_" + "c".repeat(40)
        val nasToken = "sess_" + "n".repeat(40)
        val legacy = "sess_" + "l".repeat(40)
        // Both websites answer get-session with the same user id (the server picked Folevi Cloud's).
        fun site(token: String, bearers: MutableList<String>) = MockWebServer().apply {
            dispatcher = object : Dispatcher() {
                override fun dispatch(request: RecordedRequest): MockResponse {
                    val bearer = request.headers["authorization"]?.removePrefix("Bearer ")
                    if (bearer != null) bearers += bearer
                    return when (request.url.encodedPath) {
                        "/api/auth/native/token" -> MockResponse.Builder().code(200).body(JSONObject().put("access_token", token).toString()).build()
                        "/api/auth/get-session" -> if (bearer == token) MockResponse.Builder().code(200).body("{\"user\":{\"id\":\"sameId\",\"email\":\"ana@example.com\"}}").build() else MockResponse.Builder().code(200).body("null").build()
                        else -> MockResponse.Builder().code(200).body("{}").build()
                    }
                }
            }
            start()
        }
        val atCloud = ArrayList<String>()
        val atNas = ArrayList<String>()
        val cloud = site(cloudToken, atCloud)
        val nasSite = site(nasToken, atNas)
        val nasOrigin = "http://127.0.0.1:${nasSite.port}"
        val nas = ShellServer(nasOrigin, "NAS", "1.0.0", null, ShellServer.Urls(nasOrigin, "$nasOrigin/convex", "$nasOrigin/convex-site"))
        fun world(): Triple<Places, AuthBridge, HashMap<String, String>> {
            val map = HashMap<String, String>()
            val secrets = object : Secrets {
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
                elsewhere = { places.belongsElsewhere(it) },
            )
            return Triple(places, bridge, map)
        }
        suspend fun signIn(bridge: AuthBridge): AuthBridge.User? {
            val (url, finish) = bridge.beginAccount()
            val r = async { finish() }
            delay(30)
            bridge.handleCallback("com.folevi.android://auth/callback?code=c&state=${url.toHttpUrl().queryParameter("state")}")
            return r.await()
        }

        // A Folevi Cloud account here, then the server's sign-in comes back with its id.
        run {
            val (places, bridge, map) = world()
            places.setCurrent(null, pending = true)
            val c = signIn(bridge)!!
            places.addAccount(c.userId, c.name, c.email, null)
            assertFalse(places.belongsElsewhere("sameId"))
            places.setCurrent(null, pending = true, server = nas)
            assertTrue(places.belongsElsewhere("sameId"))
            assertNull("refused", signIn(bridge))
            assertEquals("Folevi Cloud's session is still its account's", cloudToken, map["auth.session.sameId"])
            assertFalse("the server never saw Folevi Cloud's session", atNas.contains(cloudToken))
            // The same person signing in to Folevi Cloud again is not refused.
            places.setCurrent(null, pending = true)
            assertEquals("sameId", signIn(bridge)?.userId)
        }
        // The other way round: the server's account first, then Folevi Cloud's sign-in comes back with its id.
        atNas.clear()
        run {
            val (places, bridge, map) = world()
            places.setCurrent(null, pending = true, server = nas)
            val n = signIn(bridge)!!
            places.addAccount(n.userId, n.name, n.email, null)
            assertEquals(nas, places.serverOfUser("sameId"))
            places.setCurrent(null, pending = true)
            assertTrue(places.belongsElsewhere("sameId"))
            assertNull("refused", signIn(bridge))
            assertEquals("the server's session is still its account's", nasToken, map["auth.session.sameId"])
            assertFalse("the server never saw Folevi Cloud's session", atNas.contains(cloudToken))
        }
        // The one session older builds kept: read on Folevi Cloud's sign-in screen, never on a server's.
        atNas.clear()
        atCloud.clear()
        run {
            val (places, bridge, map) = world()
            map["auth.session"] = legacy
            places.setCurrent(null, pending = true, server = nas)
            assertFalse(bridge.signedIn())
            bridge.fetch("/api/auth/get-session", "GET", emptyMap(), null)
            assertNull(bridge.convexToken())
            bridge.signOut()
            assertTrue("nothing went to the server", atNas.isEmpty())
            assertEquals("and it was not forgotten", legacy, map["auth.session"])
            places.setCurrent(null, pending = true)
            assertTrue(bridge.signedIn())
            bridge.fetch("/api/auth/get-session", "GET", emptyMap(), null)
            assertEquals(listOf(legacy), atCloud)
        }
        cloud.close()
        nasSite.close()
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
