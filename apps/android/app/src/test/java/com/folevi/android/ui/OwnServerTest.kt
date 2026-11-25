// "Your own server" under the sign-in screen (OwnServer.kt), headless on Robolectric: the web's steps and words,
// a refusal under the field, and the server's card after a real lookup of its folevi.json (MockWebServer on this
// machine, which the app may reach over http as a home address).
package com.folevi.android.ui

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import com.folevi.android.design.FoleviTheme
import mockwebserver3.Dispatcher
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import mockwebserver3.RecordedRequest
import org.json.JSONObject
import org.junit.After
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [36], application = android.app.Application::class)
class OwnServerTest {
    @get:Rule val compose = createComposeRule()
    private val server = MockWebServer()

    @After fun stop() = server.close()

    private fun serve(info: JSONObject?) {
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse =
                if (info != null && request.url.encodedPath == "/.well-known/folevi.json") MockResponse.Builder().code(200).body(info.toString()).build()
                else MockResponse.Builder().code(404).build()
        }
        server.start()
    }

    private fun info() = JSONObject()
        .put("kind", "folevi-server").put("apiVersion", 1).put("name", "Smith family").put("version", "1.0.0").put("minAppVersion", "1.6.0")
        .put("urls", JSONObject().put("app", "http://127.0.0.1:${server.port}").put("convex", "http://127.0.0.1:${server.port}/convex").put("convexSite", "http://127.0.0.1:${server.port}/convex-site"))
        .put("connect", JSONObject().put("serverId", JSONObject.NULL).put("hostnames", org.json.JSONArray()))
        .put("needsSetup", false)

    private fun open() {
        compose.setContent { FoleviTheme(dark = false) { OwnServerSignIn() } }
        compose.onNodeWithText("Sign in to your own server").assertIsDisplayed().performClick()
        compose.onNodeWithText("Your own server").assertIsDisplayed()
        compose.onNodeWithText("The address the person who runs it gave you, or the one on your NAS's Folevi page.").assertIsDisplayed()
    }

    @Test fun aFoleviServerShowsItsCard() {
        serve(null)
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse =
                if (request.url.encodedPath == "/.well-known/folevi.json") MockResponse.Builder().code(200).body(info().toString()).build()
                else MockResponse.Builder().code(404).build()
        }
        open()
        compose.onNodeWithTag("server-address").performTextInput("http://127.0.0.1:${server.port}")
        compose.onNodeWithText("Continue").performClick()
        compose.waitUntil(10_000) { compose.onAllNodesWithTextExists("Sign in to Smith family") }
        compose.onNodeWithText("127.0.0.1:${server.port}").assertIsDisplayed()
        compose.onNodeWithText("Back").performClick()
        compose.onNodeWithText("Continue").assertIsDisplayed()
    }

    @Test fun somethingElseSaysWhyUnderTheField() {
        serve(null)
        open()
        compose.onNodeWithTag("server-address").performTextInput("http://127.0.0.1:${server.port}")
        compose.onNodeWithText("Continue").performClick()
        compose.waitUntil(10_000) { compose.onAllNodesWithTextExists("That address isn't a Folevi server.") }
    }

    @Test fun plainHttpOnTheInternetIsRefused() {
        serve(null)
        open()
        compose.onNodeWithTag("server-address").performTextInput("http://8.8.8.8")
        compose.onNodeWithText("Continue").performClick()
        compose.waitUntil(5_000) { compose.onAllNodesWithTextExists("That isn't an address Folevi can use. Use https, or http only for an address on your home network.") }
    }
}

private fun androidx.compose.ui.test.junit4.ComposeContentTestRule.onAllNodesWithTextExists(text: String): Boolean =
    onAllNodes(androidx.compose.ui.test.hasText(text)).fetchSemanticsNodes().isNotEmpty()
