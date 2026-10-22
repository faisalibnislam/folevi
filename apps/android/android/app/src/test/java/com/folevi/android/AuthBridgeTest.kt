package com.folevi.android

import com.folevi.android.auth.AuthBridge
import com.folevi.android.secure.Secrets
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.delay
import mockwebserver3.Dispatcher
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import mockwebserver3.RecordedRequest
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class AuthBridgeTest {
    private val server = MockWebServer()
    private val store = object : Secrets {
        val map = HashMap<String, String>()
        override fun get(name: String) = map[name]
        override fun set(name: String, value: String) { map[name] = value }
        override fun delete(name: String) { map.remove(name) }
    }
    private val seen = ArrayList<RecordedRequest>()
    private val token = "sess_" + "a".repeat(40) + ".sig" + "b".repeat(20)
    private lateinit var bridge: AuthBridge

    @Before
    fun start() {
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                seen.add(request)
                val path = request.url.encodedPath
                return when {
                    path == "/api/auth/native/token" -> MockResponse.Builder().code(200).body(JSONObject().put("access_token", token).toString()).build()
                    path == "/api/auth/get-session" -> MockResponse.Builder().code(200).addHeader("set-cookie", "x=1").body("{\"session\":{\"token\":\"$token\"},\"user\":{\"id\":\"u1\"}}").build()
                    path == "/api/auth/convex/token" && request.headers["authorization"] == "Bearer $token" -> MockResponse.Builder().code(200).body("{\"token\":\"jwt.jwt.jwt\"}").build()
                    path == "/api/auth/convex/token" -> MockResponse.Builder().code(401).build()
                    path == "/api/auth/sign-out" -> MockResponse.Builder().code(200).body("{}").build()
                    else -> MockResponse.Builder().code(404).build()
                }
            }
        }
        server.start()
        bridge = AuthBridge(server.url("/").toString(), "com.folevi.android://auth/callback", OkHttpClient(), store, { "Folevi for Android (Pixel 9)" })
    }

    @After
    fun stop() = server.close()

    private fun signIn(): Boolean = runBlocking {
        val (url, finish) = bridge.begin()
        val connect = url.toHttpUrl()
        assertEquals("/connect", connect.encodedPath)
        assertEquals("folevi-android", connect.queryParameter("client_id"))
        assertEquals("S256", connect.queryParameter("code_challenge_method"))
        val result = async { finish() }
        delay(50)
        // A link with another state signs nobody in.
        assertTrue(bridge.handleCallback("com.folevi.android://auth/callback?code=x&state=wrong"))
        assertTrue(bridge.pendingSignIn())
        assertTrue(bridge.handleCallback("com.folevi.android://auth/callback?code=thecode&state=${connect.queryParameter("state")}"))
        result.await()
    }

    @Test
    fun signsInFetchesAndScrubs() = runBlocking {
        assertTrue(signIn())
        assertEquals(token, store.map[AuthBridge.TOKEN])
        val exchange = seen.first { it.url.encodedPath == "/api/auth/native/token" }
        val body = JSONObject(exchange.body!!.utf8())
        assertEquals("thecode", body.getString("code"))
        assertEquals("Folevi for Android (Pixel 9)", body.getString("device_name"))

        val res = bridge.fetch("/api/auth/get-session", "GET", mapOf("authorization" to "Bearer evil", "accept" to "application/json"), null)
        assertEquals(200, res.status)
        assertFalse(res.body.contains("aaaaaaaaaaaaaaaa"))
        assertNull(res.headers["set-cookie"])
        val sent = seen.last()
        assertEquals("Bearer $token", sent.headers["authorization"])
        assertEquals(bridge.service.toString().removeSuffix("/"), sent.headers["origin"])
        assertNull(sent.headers["cookie"])
        assertEquals("jwt.jwt.jwt", bridge.convexToken())
    }

    @Test
    fun onlyTheWebsitesAuthPaths() = runBlocking {
        for (bad in listOf("/api/other", "/api/auth/../admin", "/api/auth/%2e%2e/x", "/api/auth/a%2fb", "https://evil.example/api/auth/x", "/api/auth/x\n"))
            try {
                bridge.fetch(bad, "GET", emptyMap(), null)
                throw AssertionError("sent $bad")
            } catch (_: IllegalArgumentException) {
            }
        try {
            bridge.fetch("/api/auth/x", "DELETE", emptyMap(), null)
            throw AssertionError("sent DELETE")
        } catch (_: IllegalArgumentException) {
        }
    }

    @Test
    fun aRevokedSessionIsForgotten() = runBlocking {
        store.map[AuthBridge.TOKEN] = "sess_" + "z".repeat(40)
        assertNull(bridge.convexToken())
        assertNull(store.map[AuthBridge.TOKEN])
    }

    @Test
    fun closingTheTabEndsTheSignIn() = runBlocking {
        val (_, finish) = bridge.begin()
        val result = async { finish() }
        delay(50)
        bridge.cancelPending()
        assertFalse(result.await())
    }
}
