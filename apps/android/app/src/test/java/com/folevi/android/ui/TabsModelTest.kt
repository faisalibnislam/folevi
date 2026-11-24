// The tab rules on tablets and Googlebooks, as the web and the Mac app have them (the Mac's TabBackTests and
// DeskTabsTests): a tab opened from a page goes Back to the page it came from and closes; the sidebar and New note
// open fresh tabs; links inside a note replace its tab; folders open in one folder tab, Finder style.
package com.folevi.android.ui

import androidx.compose.runtime.saveable.SaverScope
import com.folevi.engine.generated.NotesListView
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TabsModelTest {
    private val all = NotesRoute(NotesListView.ALL.value, "All notes")
    private fun note(id: String) = NoteRoute(id, id.uppercase())
    private fun folder(id: String) = NotesRoute(NotesListView.FOLDER.value, id, folderId = id)

    @Test fun seeAllFromHomeGoesBackToHomeAndCloses() {
        val m = TabsModel()
        assertFalse(m.canGoBack)
        m.show(all)
        val list = m.activeId
        assertTrue(m.canGoBack)
        assertTrue(m.goBack())
        assertEquals(FrameTab.HOME_ID, m.activeId)
        assertTrue(m.tabs.none { it.id == list })
        // It went to the closed tabs, so reopening brings it back.
        assertEquals(list, m.closed.last().id)
    }

    @Test fun theTabsOwnHistoryComesFirst() {
        val m = TabsModel()
        m.show(note("a"))
        m.show(note("b"), TabsModel.Opening.REPLACE)
        assertEquals(2, m.tabs.size)
        assertTrue(m.goBack())
        assertEquals(note("a"), m.activeRoute)
        assertEquals(2, m.tabs.size)
        // Then, with nothing left in it, the tab it came from.
        assertTrue(m.goBack())
        assertEquals(HomeRoute, m.activeRoute)
        assertEquals(1, m.tabs.size)
    }

    @Test fun aNoteFromAListGoesBackToTheList() {
        val m = TabsModel()
        m.show(all)
        val list = m.activeId
        m.show(note("a"))
        assertEquals(3, m.tabs.size)
        assertTrue(m.goBack())
        assertEquals(list, m.activeId)
        assertEquals(all, m.activeRoute)
    }

    @Test fun theSidebarAndNewNoteOpenFreshTabs() {
        val m = TabsModel()
        m.show(all, fromPage = false)
        assertFalse(m.canGoBack)
        assertFalse(m.goBack())
        assertEquals(2, m.tabs.size)
    }

    @Test fun noWayBackOnceTheOpenerIsClosed() {
        val m = TabsModel()
        m.show(all)
        val list = m.activeId
        m.show(note("a"))
        m.close(list)
        assertFalse(m.canGoBack)
        assertFalse(m.goBack())
    }

    @Test fun aLinkReplacingTheNoteKeepsTheOpener() {
        val m = TabsModel()
        m.show(all)
        m.show(note("a"))
        m.show(note("b"), TabsModel.Opening.REPLACE)
        assertTrue(m.goBack())
        assertEquals(note("a"), m.activeRoute)
        assertTrue(m.goBack())
        assertEquals(all, m.activeRoute)
    }

    @Test fun aPageAlreadyInATabSwitchesToIt() {
        val m = TabsModel()
        m.show(note("a"))
        m.show(HomeRoute)
        m.show(note("a"))
        assertEquals(2, m.tabs.size)
        assertEquals("a", m.activeId)
    }

    @Test fun foldersOpenInOneFolderTab() {
        val m = TabsModel()
        m.show(folder("plums"))
        val tab = m.activeId
        assertTrue(tab.startsWith(FrameTab.FOLDER_PREFIX))
        m.show(folder("pears"))
        assertEquals(tab, m.activeId)
        assertEquals(2, m.tabs.size)
        // Its Back goes to the folder before, in the same tab, then Home.
        assertTrue(m.goBack())
        assertEquals(folder("plums"), m.activeRoute)
        assertTrue(m.goBack())
        assertEquals(HomeRoute, m.activeRoute)
    }

    @Test fun aFolderFromHomeReusesTheFolderTabUsedLast() {
        val m = TabsModel()
        m.show(folder("plums"))
        val tab = m.activeId
        m.show(HomeRoute)
        m.show(folder("pears"))
        assertEquals(tab, m.activeId)
        assertEquals(folder("pears"), m.activeRoute)
    }

    @Test fun aViewsTabFollowsYouInsideIt() {
        val m = TabsModel()
        m.show(AiRoute)
        m.show(AiChatRoute("c1"))
        assertEquals(2, m.tabs.size)
        assertEquals(AiChatRoute("c1"), m.activeRoute)
        assertTrue(m.goBack())
        assertEquals(AiRoute, m.activeRoute)
    }

    @Test fun theStripKeepsTwelveTabsBesidesHome() {
        val m = TabsModel()
        for (i in 1..14) m.show(note("n$i"), fromPage = false)
        assertEquals(TabsModel.MAX_TABS + 1, m.tabs.size)
        assertTrue(m.tabs.none { it.id == "n1" || it.id == "n2" })
        assertEquals("n14", m.activeId)
    }

    @Test fun closingTheTabOnScreenShowsItsRightNeighbourElseItsLeft() {
        val m = TabsModel()
        m.show(note("a"), fromPage = false)
        m.show(note("b"), fromPage = false)
        m.show(note("c"), fromPage = false)
        m.select("b")
        m.close("b")
        assertEquals("c", m.activeId)
        m.close("c")
        assertEquals("a", m.activeId)
        m.close(FrameTab.HOME_ID)
        assertEquals(FrameTab.HOME_ID, m.tabs.first().id)
    }

    @Test fun closedTabsReopenNewestFirst() {
        val m = TabsModel()
        m.show(note("a"), fromPage = false)
        m.show(note("b"), fromPage = false)
        m.close("a")
        m.close("b")
        assertTrue(m.reopenClosed())
        assertEquals("b", m.activeId)
        assertTrue(m.reopenClosed())
        assertEquals("a", m.activeId)
        assertFalse(m.reopenClosed())
    }

    @Test fun aBackgroundTabFromAPageRemembersItsOpener() {
        val m = TabsModel()
        val id = m.addInBackground(folder("plums"))
        assertNotNull(id)
        assertEquals(FrameTab.HOME_ID, m.activeId)
        m.select(id!!)
        assertTrue(m.goBack())
        assertEquals(FrameTab.HOME_ID, m.activeId)
    }

    @Test fun theStripSurvivesBeingSaved() {
        val m = TabsModel()
        m.show(all)
        m.show(note("a"))
        val saved = with(TabsModel.saver) { SaverScope { true }.save(m) }!!
        val back = TabsModel.saver.restore(saved)!!
        assertEquals(m.tabs, back.tabs)
        assertEquals("a", back.activeId)
        assertTrue(back.goBack())
        assertEquals(all, back.activeRoute)
    }

    @Test fun pathsFromTheEngineReadAsTheWebRouterReadsThem() {
        assertEquals(NoteRoute("x", ""), routeOfPath("/d/x"))
        assertEquals(NoteRoute("y", ""), routeOfPath("/anything", noteId = "y"))
        assertEquals(folder("f1").folderId, (routeOfPath("/folders/f1") as NotesRoute).folderId)
        assertEquals(TasksRoute, routeOfPath("/tasks/today"))
        assertEquals(AiChatRoute("c9"), routeOfPath("/ai/c9"))
        assertEquals(HomeRoute, routeOfPath("/documents"))
        assertEquals(NotesListView.UNSORTED.value, (routeOfPath("/drafts") as NotesRoute).view)
        assertTrue(routeOfPath("/graph?note=a") is PageRoute)
    }
}
