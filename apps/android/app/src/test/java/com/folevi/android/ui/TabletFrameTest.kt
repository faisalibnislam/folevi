// The tablet frame (TabletSidebar.kt, TabStrip.kt): which folders the sidebar's tree lists, which row is the open
// page, and the strip's buttons, headless on Robolectric at a tablet's width.
package com.folevi.android.ui

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import com.folevi.android.design.FoleviTheme
import com.folevi.engine.generated.FolderNode
import com.folevi.engine.generated.NotesListView
import com.folevi.engine.generated.SyncMark
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
@Config(sdk = [36], application = android.app.Application::class, qualifiers = "w1000dp-h800dp")
class TabletFrameTest {
    @get:Rule val compose = createComposeRule()

    private fun folder(id: String, depth: Long = 0, parent: String? = null, children: Long = 0) =
        FolderNode(id = id, name = id.uppercase(), color = null, parentId = parent, depth = depth, rank = id, childCount = children, noteCount = 0, encrypted = false, sync = SyncMark.SAVED)

    @Test fun theTreeListsFiveTopLevelFoldersAndOpensFolded() {
        val folders = listOf(folder("a", children = 1), folder("a1", 1, "a"), folder("b"), folder("c"), folder("d"), folder("e"), folder("f"))
        assertEquals(listOf("a", "b", "c", "d", "e"), visibleFolders(folders, open = emptySet(), all = false, activeFolder = null).map { it.id })
        assertEquals(listOf("a", "a1", "b", "c", "d", "e"), visibleFolders(folders, open = setOf("a"), all = false, activeFolder = null).map { it.id })
        assertEquals(7, visibleFolders(folders, open = setOf("a"), all = true, activeFolder = null).size)
    }

    @Test fun theFolderOnScreenIsListedAndOpenedDownToIt() {
        val folders = listOf(folder("a"), folder("b"), folder("c"), folder("d"), folder("e"), folder("f", children = 1), folder("f1", 1, "f"))
        val shown = visibleFolders(folders, open = emptySet(), all = false, activeFolder = "f1").map { it.id }
        assertTrue("f" in shown && "f1" in shown)
    }

    @Test fun theOpenPagesRowIsActive() {
        val drafts = NotesRoute(NotesListView.UNSORTED.value, "Drafts")
        assertTrue(sidebarActive(drafts, NotesRoute(NotesListView.UNSORTED.value, "Drafts")))
        assertFalse(sidebarActive(drafts, NotesRoute(NotesListView.ALL.value, "All notes")))
        assertTrue(sidebarActive(AiChatRoute("x"), AiRoute))
        assertTrue(sidebarActive(NotesRoute(NotesListView.FOLDER.value, "A", folderId = "a"), NotesRoute(NotesListView.FOLDER.value, "Other name", folderId = "a")))
        assertTrue(sidebarActive(HomeRoute, HomeRoute))
    }

    @Test fun theStripHasHomeBackForwardAndNewNote() {
        val tabs = TabsModel()
        var notes = 0
        var shown = 0
        compose.setContent { FoleviTheme(dark = false) { TabStrip(tabs, { notes++ }, onShowSidebar = { shown++ }, onAi = {}) } }
        compose.onNodeWithText("Home").assertIsDisplayed()
        compose.onNodeWithContentDescription("Home").assertIsSelected()
        compose.onNodeWithContentDescription("Back").assertIsNotEnabled()
        compose.onNodeWithContentDescription("New note").performClick()
        compose.onNodeWithContentDescription("Show sidebar").performClick()
        compose.onNodeWithContentDescription("Foli AI").assertIsDisplayed()
        assertEquals(1, notes)
        assertEquals(1, shown)
    }

    @Test fun aNoteTabShowsItsNameAndCloses() {
        val tabs = TabsModel()
        tabs.show(NoteRoute("n1", "Kyoto"), fromPage = false)
        compose.setContent { FoleviTheme(dark = false) { TabStrip(tabs, {}) } }
        compose.onNodeWithText("Kyoto").assertIsDisplayed()
        compose.onNodeWithContentDescription("Close Kyoto").performClick()
        compose.waitForIdle()
        assertEquals(1, tabs.tabs.size)
    }
}
