// The phone bar (PhoneBar.kt), headless on Robolectric: the web's tabs and buttons, what + offers, and + on Tasks.
package com.folevi.android.ui

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.assertIsNotSelected
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
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
@Config(sdk = [36], application = android.app.Application::class, qualifiers = "w411dp-h891dp")
class PhoneBarTest {
    @get:Rule val compose = createComposeRule()

    @Test fun theWebsTabsAndButtons() {
        var tab by mutableStateOf(Tab.HOME)
        var notes = 0
        compose.setContent { FoleviTheme(dark = false) { PhoneBar(tab, { tab = it }, { notes++ }) } }
        for (label in listOf("Home", "Tasks", "Calendar", "Foli AI")) compose.onNodeWithContentDescription(label).assertIsDisplayed()
        // The right capsule is the "Create" group, as on the web; its + is the "Create" button.
        compose.onNodeWithTag("button-Create").assertIsDisplayed()
        compose.onNodeWithContentDescription("Home").assertIsSelected()
        compose.onNodeWithContentDescription("Calendar").performClick()
        assertEquals(Tab.CALENDAR, tab)
        compose.onNodeWithContentDescription("Calendar").assertIsSelected()
        compose.onNodeWithContentDescription("Home").assertIsNotSelected()
        compose.onNodeWithContentDescription("Foli AI").performClick()
        assertEquals(Tab.AI, tab)
    }

    @Test fun plusOffersNoteFolderAndTask() {
        var notes = 0
        compose.setContent { FoleviTheme(dark = false) { PhoneBar(Tab.HOME, {}, { notes++ }) } }
        compose.onNodeWithTag("button-Create").performClick()
        compose.onNodeWithText("New folder").assertIsDisplayed()
        compose.onNodeWithText("Quick task").assertIsDisplayed()
        compose.onNodeWithText("New note").performClick()
        assertEquals(1, notes)
    }

    @Test fun onTasksPlusIsAQuickTask() {
        compose.setContent { FoleviTheme(dark = false) { PhoneBar(Tab.TASKS, {}, {}) } }
        compose.onNodeWithTag("button-Quick task").assertIsDisplayed()
        compose.onNodeWithTag("button-Create").assertDoesNotExist()
    }
}
