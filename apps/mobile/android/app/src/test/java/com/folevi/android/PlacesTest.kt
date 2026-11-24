package com.folevi.android

import com.folevi.android.auth.AuthBridge
import com.folevi.android.secure.Secrets
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import mockwebserver3.Dispatcher
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import mockwebserver3.RecordedRequest
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

/** Several places (Places.kt, docs/MULTI_ACCOUNT_PLAN.md §2.2): the list, the open place, each account's own session. */
class PlacesTest {
    private fun memory(): Places.Store = object : Places.Store {
        var json: String? = null
        override fun read() = json
        override fun write(json: String) {
            this.json = json
        }
    }

    @Test
    fun theLibraryAndAccountsTheOpenOneAndQuickAdd() {
        val store = memory()
        val p = Places(store)
        p.setLibrary(true)
        val ana = p.addAccount("userAna", "Ana", "ana@example.com", null)!!
        p.addAccount("userBen", "Ben", "ben@example.com", "https://example.com/b.png")
        p.setCurrent(ana.id)
        assertEquals("userAna", p.currentUserId)
        assertEquals("account", p.modeOf(p.state.current))
        p.setQuickAdd(Places.LIBRARY)
        val again = Places(store)
        assertEquals("acct:userAna", again.state.current)
        assertEquals(listOf("userAna", "userBen"), again.state.accounts.map { it.userId })
        assertEquals(Places.LIBRARY, again.state.quickAdd)
        assertEquals("local", again.modeOf(Places.LIBRARY))
        assertEquals(3, again.list("device", "Folevi's storage on this phone", true).length())
        // A place that isn't here changes nothing.
        again.setCurrent("acct:nobody")
        assertEquals("acct:userAna", again.state.current)
    }

    @Test
    fun whatAPageSaysOfItsAccountAndRemovingOne() {
        val p = Places(memory())
        val ana = p.addAccount("userAna", "Ana", "a@example.com", null)!!
        val ben = p.addAccount("userBen", "Ben", "b@example.com", null)!!
        p.setCurrent(ana.id)
        p.describe(ana.id, JSONObject("""{"profileId":"prof_1","unread":3,"workspaces":[{"id":"w1","name":"Acme","logoUrl":"javascript:x"},{"bad":true}]}"""))
        val a = p.state.accounts.first { it.id == ana.id }
        assertEquals("prof_1", a.profileId)
        assertEquals(3, a.unread)
        assertEquals(listOf(Places.Workspace("w1", "Acme", null)), a.workspaces)
        assertEquals(ben.id, p.removeAccount(ana.id))
        assertEquals(listOf("userBen"), p.state.accounts.map { it.userId })
        // An older build's mode becomes the places once.
        val fresh = Places(memory())
        fresh.migrate("local", false)
        assertEquals(Places.LIBRARY, fresh.state.current)
        assertEquals(true, fresh.state.library)
    }

    @Test
    fun eachAccountKeepsItsOwnSessionAndTheLegacyOneMovesToItsAccount() = runBlocking {
        val anaToken = "sess_" + "a".repeat(40)
        val benToken = "sess_" + "b".repeat(40)
        val issue = ArrayDeque(listOf(anaToken, benToken))
        val people = mapOf(anaToken to "userAna", benToken to "userBen")
        val server = MockWebServer()
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val bearer = request.headers["authorization"]?.removePrefix("Bearer ")
                return when (request.url.encodedPath) {
                    "/api/auth/native/token" -> MockResponse.Builder().code(200).body(JSONObject().put("access_token", issue.removeFirst()).toString()).build()
                    "/api/auth/get-session" -> people[bearer]?.let { MockResponse.Builder().code(200).body("{\"user\":{\"id\":\"$it\",\"email\":\"$it@example.com\"}}").build() } ?: MockResponse.Builder().code(200).body("null").build()
                    "/api/auth/convex/token" -> people[bearer]?.let { MockResponse.Builder().code(200).body("{\"token\":\"jwt-$it\"}").build() } ?: MockResponse.Builder().code(401).build()
                    else -> MockResponse.Builder().code(200).body("{}").build()
                }
            }
        }
        server.start()
        val secrets = object : Secrets {
            val map = HashMap<String, String>()
            override fun get(name: String) = map[name]
            override fun set(name: String, value: String) { map[name] = value }
            override fun delete(name: String) { map.remove(name) }
        }
        val places = Places(memory())
        val bridge = AuthBridge(server.url("/").toString(), "com.folevi.android://auth/callback", OkHttpClient(), secrets, { "Pixel" }, currentUser = { places.currentUserId })
        suspend fun signIn(): AuthBridge.User? {
            val (url, finish) = bridge.beginAccount()
            val r = async { finish() }
            delay(30)
            bridge.handleCallback("com.folevi.android://auth/callback?code=c&state=${url.toHttpUrl().queryParameter("state")}")
            return r.await()
        }
        val ana = signIn()!!
        val ben = signIn()!!
        assertEquals("userAna", ana.userId)
        assertEquals(anaToken, secrets.map["auth.session.userAna"])
        assertEquals(benToken, secrets.map["auth.session.userBen"])
        places.addAccount(ana.userId, ana.name, ana.email, null)
        places.addAccount(ben.userId, ben.name, ben.email, null)
        places.setCurrent("acct:userBen")
        assertEquals("jwt-userBen", bridge.convexToken())
        places.setCurrent("acct:userAna")
        assertEquals("jwt-userAna", bridge.convexToken())
        assertEquals("jwt-userBen", bridge.convexTokenFor("userBen"))
        bridge.signOutUser("userBen")
        assertNull(secrets.map["auth.session.userBen"])
        assertNotNull(secrets.map["auth.session.userAna"])
        // The single session an older build kept.
        secrets.map.clear()
        secrets.map[AuthBridge.TOKEN] = anaToken
        assertEquals("userAna", bridge.adoptLegacy()?.userId)
        assertNull(secrets.map[AuthBridge.TOKEN])
        assertEquals(anaToken, secrets.map["auth.session.userAna"])
        server.close()
    }
}
