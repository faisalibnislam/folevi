// The polish pass's behaviour, headless: swipe actions reachable without swiping (TalkBack's actions menu), the
// reduced-motion switch, the palette's new tokens, and the switch rows as one toggle.
package com.folevi.android.ui

import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.assertIsOff
import androidx.compose.ui.test.assertIsOn
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.folevi.android.design.FoleviPalette
import com.folevi.android.design.FoleviTheme
import com.folevi.android.design.SwipeAction
import com.folevi.android.design.SwipeRow
import com.folevi.android.design.WebIcon
import com.folevi.android.design.reducedMotion
import com.folevi.android.design.swipeAccessibilityActions
import androidx.compose.ui.graphics.Color
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [36], application = android.app.Application::class, qualifiers = "w411dp-h891dp")
class PolishTest {
    @get:Rule val compose = createComposeRule()

    @Test fun animationsOffOnlyAtZero() {
        assertTrue(reducedMotion(0f))
        assertFalse(reducedMotion(1f))
        assertFalse(reducedMotion(0.5f))
    }

    @Test fun swipeActionsRunWithoutSwiping() {
        val ran = mutableListOf<String>()
        val actions = swipeAccessibilityActions(
            leading = listOf(SwipeAction("Bookmark", WebIcon.BOOKMARK, Color.Red) { ran += "bookmark" }),
            trailing = listOf(SwipeAction("Trash", WebIcon.TRASH, Color.Red) { ran += "trash" }, SwipeAction("Archive", WebIcon.ARCHIVE, Color.Red) { ran += "archive" }),
        )
        assertEquals(listOf("Bookmark", "Trash", "Archive"), actions.map { it.label })
        actions.forEach { it.action() }
        assertEquals(listOf("bookmark", "trash", "archive"), ran)
    }

    @Test fun aSwipeRowOffersItsActionsToTalkBack() {
        var trashed = false
        compose.setContent {
            FoleviTheme(dark = false) {
                SwipeRow(trailing = listOf(SwipeAction("Trash", WebIcon.TRASH, Color.Red) { trashed = true })) { Text("A note") }
            }
        }
        val node = compose.onAllNodes(SemanticsMatcher.keyIsDefined(SemanticsActions.CustomActions)).fetchSemanticsNodes().single()
        val action = node.config[SemanticsActions.CustomActions].single()
        assertEquals("Trash", action.label)
        compose.runOnIdle { action.action() }
        assertTrue(trashed)
    }

    @Test fun aSwitchRowIsOneToggle() {
        var on by mutableStateOf(false)
        compose.setContent { FoleviTheme(dark = false) { SwitchRow("Show editors", checked = on, onChange = { on = it }) } }
        compose.onNodeWithText("Show editors").assertIsOff().performClick().assertIsOn()
        assertTrue(on)
    }

    @Test fun theNewTokensKeepTheWebsValues() {
        assertEquals(Color(0xFFF7F7F8), FoleviPalette.Light.glassBase)
        assertEquals(Color(0xFF2C2C2E), FoleviPalette.Dark.glassBase)
        assertEquals(Color(0xFF1C1C1E), FoleviPalette.Dark.groupedRow)
        assertEquals(Color(0xFFD6453D), FoleviPalette.Light.swipeTrash)
        assertNotEquals(FoleviPalette.Light.groupedBg, FoleviPalette.Dark.groupedBg)
        assertEquals(FoleviPalette.Light.priorityHigh, priorityColor("high"))
    }
}
