package com.folevi.android

import com.folevi.android.cloud.CloudAuth
import com.folevi.android.cloud.CloudException
import com.folevi.android.secure.Secrets
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import mockwebserver3.Dispatcher
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import mockwebserver3.RecordedRequest
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/** CloudAuth against a fake Dropbox: every request to a dropboxapi.com host is answered by MockWebServer. */
class CloudAuthTest {
    private val server = MockWebServer()
    private val secrets = object : Secrets {
        val map = HashMap<String, String>()
        override fun get(name: String) = map[name]
        override fun set(name: String, value: String) { map[name] = value }
        override fun delete(name: String) { map.remove(name) }
    }
    private val prefs = object : CloudAuth.Prefs {
        val map = HashMap<String, String>()
        override fun get(key: String) = map[key]
        override fun set(key: String, value: String?) { if (value == null) map.remove(key) else map[key] = value }
    }
    private val seen = ArrayList<RecordedRequest>()
    private var accessValid = "access-1"
    private var refreshWorks = true
    private lateinit var cloud: CloudAuth

    @Before
    fun start() {
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                seen.add(request)
                return when (request.url.encodedPath) {
                    "/oauth2/token" -> {
                        val form = request.body!!.utf8()
                        when {
                            form.contains("grant_type=authorization_code") && form.contains("code_verifier=") -> MockResponse.Builder().body(JSONObject().put("access_token", accessValid).put("refresh_token", "refresh-1").put("expires_in", 14400).toString()).build()
                            form.contains("grant_type=refresh_token") && refreshWorks -> {
                                accessValid = "access-2"
                                MockResponse.Builder().body(JSONObject().put("access_token", accessValid).put("expires_in", 14400).toString()).build()
                            }
                            else -> MockResponse.Builder().code(400).body("{\"error\":\"invalid_grant\"}").build()
                        }
                    }
                    "/2/users/get_current_account" -> MockResponse.Builder().body("{\"email\":\"person@example.com\"}").build()
                    "/2/files/list_folder" -> if (request.headers["authorization"] == "Bearer $accessValid") MockResponse.Builder().body("{\"entries\":[]}").build() else MockResponse.Builder().code(401).build()
                    else -> MockResponse.Builder().code(404).build()
                }
            }
        }
        server.start()
        val toFake = Interceptor { chain ->
            val r = chain.request()
            chain.proceed(r.newBuilder().url(r.url.newBuilder().scheme("http").host(server.hostName).port(server.port).build()).build())
        }
        cloud = CloudAuth(secrets, OkHttpClient.Builder().addInterceptor(toFake).build(), "abcdefgh12345678", false, null, prefs)
    }

    @After
    fun stop() = server.close()

    private fun connect() = runBlocking {
        var opened = ""
        val done = async { cloud.connect("dropbox") { opened = it } }
        delay(100)
        val url = opened.toHttpUrl()
        assertEquals(CloudAuth.DROPBOX_REDIRECT, url.queryParameter("redirect_uri"))
        assertEquals("offline", url.queryParameter("token_access_type"))
        // Another state is ignored; the right one finishes.
        assertTrue(cloud.handleCallback("${CloudAuth.DROPBOX_REDIRECT}?code=c&state=nope"))
        assertTrue(cloud.handleCallback("${CloudAuth.DROPBOX_REDIRECT}?code=c&state=${url.queryParameter("state")}"))
        done.await()
    }

    @Test
    fun connectsAndAddsTheTokenItself() = runBlocking {
        val s = connect()
        assertEquals("connected", s.state)
        assertEquals("person@example.com", s.account)
        val r = cloud.request("dropbox", "https://api.dropboxapi.com/2/files/list_folder", "POST", mapOf("authorization" to "Bearer page-token", "content-type" to "application/json"), "{}".toByteArray(), true)
        assertEquals(200, r.status)
        assertEquals("Bearer access-1", seen.last().headers["authorization"])
    }

    @Test
    fun aRefusedTokenIsRefreshedOnceThenReconnect() = runBlocking {
        connect()
        accessValid = "rotated-elsewhere"
        val r = cloud.request("dropbox", "https://api.dropboxapi.com/2/files/list_folder", "POST", emptyMap(), "{}".toByteArray(), true)
        assertEquals(200, r.status) // refreshed to access-2
        accessValid = "gone"
        refreshWorks = false
        try {
            cloud.request("dropbox", "https://api.dropboxapi.com/2/files/list_folder", "POST", emptyMap(), "{}".toByteArray(), true)
        } catch (e: CloudException) {
            assertEquals("reconnect", e.kind)
        }
        assertEquals("reconnect", cloud.status().state)
        assertFalse(secrets.map.containsKey("cloud.dropbox"))
    }

    @Test
    fun onlyTheProvidersHosts() = runBlocking {
        connect()
        for ((url, authorized) in listOf("https://example.com/2/x" to true, "http://api.dropboxapi.com/2/x" to true, "https://notify.dropboxapi.com/2/x" to true, "https://api.dropboxapi.com/2/x" to false, "https://www.googleapis.com/drive/v3/files" to true)) {
            try {
                cloud.request("dropbox", url, "POST", emptyMap(), null, authorized)
                throw AssertionError("sent $url")
            } catch (e: CloudException) {
                assertEquals("invalid", e.kind)
            }
        }
    }

    @Test
    fun signingOutForgetsTheTokens() = runBlocking {
        connect()
        assertEquals("none", cloud.signOut().state)
        assertFalse(secrets.map.containsKey("cloud.dropbox"))
    }
}
