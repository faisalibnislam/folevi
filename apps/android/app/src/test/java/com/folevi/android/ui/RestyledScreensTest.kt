// The restyled Foli AI, Vault, Shared and Changes screens' pure parts: ages, second lines, the "can't use Foli
// AI" words, and the empty Foli AI tab's suggestions (headless on Robolectric).
package com.folevi.android.ui

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import com.folevi.android.design.FoleviTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [36], application = android.app.Application::class)
class RestyledScreensTest {
    @get:Rule val compose = createComposeRule()

    private val now = 1_800_000_000_000L

    @Test fun agesAreShortLikeTheWebsList() {
        assertEquals("", ageText(0.0, now))
        assertEquals("now", ageText((now - 20_000).toDouble(), now))
        assertEquals("5m", ageText((now - 5 * 60_000).toDouble(), now))
        assertEquals("3h", ageText((now - 3 * 3_600_000).toDouble(), now))
        assertEquals("2d", ageText((now - 2 * 86_400_000L).toDouble(), now))
    }

    @Test fun secondLinesLeaveOutBlanks() {
        assertEquals("Mia · Team", metaLine("Mia", "", "Team", null))
        assertEquals("", metaLine(null, " "))
        assertEquals("Login · mia@example.test", vaultMeta("Login", "mia@example.test", ""))
    }

    @Test fun foliAiSaysWhyItCantBeUsed() {
        assertEquals("Foli AI is turned off. Turn it on in Settings > Foli AI.", unavailableText("off"))
        assertEquals("Foli AI isn't on this workspace's plan.", unavailableText("workspacePlan"))
        // An unknown reason reads as the plan's.
        assertEquals("Foli AI isn't on your plan.", unavailableText("something-new"))
    }

    @Test fun theSuggestionsAreTheWebsOnes() {
        assertEquals(4, AI_SUGGESTIONS.size)
        compose.setContent { FoleviTheme(dark = false) { androidx.compose.foundation.layout.Column { AI_SUGGESTIONS.forEach { androidx.compose.material3.Text(it) } } } }
        compose.onNodeWithText("Find my open to-dos").assertIsDisplayed()
    }
}
