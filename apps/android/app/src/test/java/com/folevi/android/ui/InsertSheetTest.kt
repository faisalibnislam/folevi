// The native Insert sheet (InsertSheet.kt), headless on Robolectric: the catalogue's sections, the iPhone's search
// rules, a tile inserting its kind, the quick table.
package com.folevi.android.ui

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import com.folevi.android.design.FoleviTheme
import com.folevi.android.design.InsertCatalog
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
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
class InsertSheetTest {
    @get:Rule val compose = createComposeRule()

    @Test fun theCatalogueHasTheWebsSectionsAndPictures() {
        val titles = InsertCatalog.sections.map { it.title }
        assertEquals("Suggested", titles.first())
        assertTrue("Data and more" in titles)
        for (s in InsertCatalog.sections) for (t in s.tiles) t.preview?.let { assertTrue("no picture for $it", InsertCatalog.pictures.containsKey(it)) }
    }

    @Test fun searchMatchesWordStartsOrAPhrase() {
        assertTrue(insertMatches("tab", "Table grid rows"))
        assertFalse(insertMatches("tab", "Database collection"))
        assertTrue(insertMatches("", "anything"))
        assertTrue(insertMatches("todo", "To-do todo task"))
        assertTrue(insertMatches("check list", "a check list here"))
        // Media gains the scanner's tiles only where the phone can scan; Unsplash only off local mode.
        val media = { scanner: Boolean, stock: Boolean -> insertSections("", scanner, stock).first { it.title == "Media" }.tiles.map { it.kind } }
        assertTrue("scan-document" in media(true, true))
        assertFalse("scan-document" in media(false, true))
        assertFalse("image-from-unsplash" in media(false, false))
        // Nothing matches: no sections.
        assertTrue(insertSections("zzzqqq", false, true).isEmpty())
    }

    @Test fun aTileInsertsItsKind() {
        var got: String? = null
        compose.setContent { FoleviTheme(dark = false) { InsertSheetContent(scanner = false, stockPhotos = true) { got = it } } }
        compose.onNodeWithText("SUGGESTED").assertIsDisplayed()
        // To-do is in Suggested and in Lists and tasks: the first is Suggested's.
        compose.onAllNodesWithTag("insert-to-do")[0].performClick()
        assertEquals("to-do", got)
    }

    @Test fun searchingNarrowsTheTiles() {
        compose.setContent { FoleviTheme(dark = false) { InsertSheetContent(scanner = false, stockPhotos = true) {} } }
        compose.onNodeWithTag("insert-search").performTextInput("zzzqqq")
        compose.onNodeWithText("No matches").assertIsDisplayed()
    }

    @Test fun theQuickTableShowsWithData() {
        compose.setContent { FoleviTheme(dark = false) { InsertSheetContent(scanner = false, stockPhotos = true) {} } }
        compose.onNodeWithText("Simple table").performScrollTo().assertIsDisplayed()
    }
}
