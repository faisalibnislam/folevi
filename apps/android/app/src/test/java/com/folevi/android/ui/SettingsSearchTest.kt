// Settings, Search, the account sheet and New folder: the parts that don't need a live session, headless on
// Robolectric (the list Settings shows and where each row goes, the search scopes and lines, the account sheet's
// words, the folder colors) and one grouped screen drawn.
package com.folevi.android.ui

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import com.folevi.android.design.FoleviTheme
import com.folevi.engine.generated.SearchHit
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [36], application = android.app.Application::class)
class SettingsSearchTest {
    @get:Rule val compose = createComposeRule()

    private fun targets(groups: List<SettingsGroup>) = groups.flatMap { it.entries }.associate { it.title to it.target }

    @Test fun theOwnersTechnicalSectionsAreWebPages() {
        val all = settingsGroups(local = false, workspace = "Acme", canManage = true, serviceUrl = "https://app.folevi.com")
        val webPages = all.flatMap { it.entries }.mapNotNull { (it.target as? SettingsTarget.Web)?.page }.toSet()
        // Webhooks, API tokens and Connected apps are one web page; Foli AI export is inside Foli AI.
        assertTrue("settings.connectedApps" in webPages)
        assertTrue("settings.workspaceData" in webPages)
        // Everything else in "You" that the engine has a view for is native.
        val t = targets(all.filter { it.header == "You" })
        for (title in listOf("Account", "Foli AI", "Plan & billing", "Security", "Privacy", "Devices", "Appearance", "Notifications", "Offline & sync", "This device")) {
            assertTrue(title, t[title] is SettingsTarget.Native)
        }
        assertEquals(listOf("You", "Acme", "Support"), all.map { it.header })
    }

    @Test fun personalOffersAWorkspaceAndTheLibraryHasNoAccountSections() {
        val personal = settingsGroups(local = false, workspace = null, canManage = false, serviceUrl = "https://app.folevi.com")
        val ws = personal.first { it.header == "Workspace" }
        assertEquals(SettingsTarget.CreateWorkspace, ws.entries.single().target)
        assertTrue(ws.footer!!.startsWith("Work with a team"))
        val local = settingsGroups(local = true, workspace = null, canManage = false, serviceUrl = "https://app.folevi.com")
        val titles = local.flatMap { it.entries }.map { it.title }
        assertEquals("Library", titles.first())
        for (gone in listOf("Account", "Security", "Devices", "Notifications", "Connected apps", "Create a workspace")) assertFalse(gone, gone in titles)
        assertEquals(SettingsTarget.Link("https://app.folevi.com/help"), targets(local)["Help"])
    }

    @Test fun onlyManagersSeeGuestsAndBilling() {
        val member = settingsGroups(local = false, workspace = "Acme", canManage = false, serviceUrl = "x").first { it.header == "Acme" }.entries.map { it.title }
        assertEquals(listOf("General", "Members", "Import & export"), member)
    }

    @Test fun appearanceWords() {
        assertEquals("100% (default)", zoomLabel(1.0))
        assertEquals("115%", zoomLabel(1.15))
        assertEquals("1.5 KB", bytesLabel(1536))
        assertEquals("12 MB", bytesLabel(12L * 1024 * 1024))
        assertEquals("Unknown", bytesLabel(null))
    }

    private fun hit(snippet: String = "", page: Long? = null, space: String? = null) = SearchHit(
        id = "n1", title = "Kyoto trip", icon = null, snippet = snippet, folder = null, updatedAt = 1_000_000.0, archived = false,
        kind = "note", space = null, spaceName = space, matchIn = "title", blockId = null, page = page,
    )

    @Test fun searchLines() {
        val now = 1_000_000L + 3 * 3_600_000L
        assertEquals("Edited 3 hours ago", hitDetail(hit(), showPlace = false, now = now))
        assertEquals("Work · Page 4 · the ryokan", hitDetail(hit("the ryokan", page = 4, space = "Work"), showPlace = true, now = now))
        assertEquals("the ryokan", hitDetail(hit("the ryokan", space = "Work"), showPlace = false, now = now))
        assertEquals("just now", relativeAge(1_000_000.0, 1_000_000L))
        assertEquals("yesterday", relativeAge(0.0, 30L * 3_600_000L))
    }

    @Test fun searchScopes() {
        assertNull(updatedAfter(null, 10_000_000_000L))
        assertEquals(10_000_000_000L - 7 * 86_400_000L, updatedAfter(7, 10_000_000_000L))
        assertEquals(listOf("Any time", "Past week", "Past month", "Past year"), EDITED_CHOICES.map { it.second })
    }

    @Test fun matchesAreHighlighted() {
        val s = highlighted("Kyoto in Kyoto", "kyoto")
        assertEquals("Kyoto in Kyoto", s.text)
        assertEquals(2, s.spanStyles.size)
        assertEquals(0, highlighted("Plain", "").spanStyles.size)
    }

    @Test fun actionsFollowTheWords() {
        val idle = searchActions("", ai = true, graph = false)
        assertEquals("Ask Foli AI", idle.first().label)
        assertFalse(idle.any { it.id == "graph" })
        val typing = searchActions("trash", ai = true, graph = true)
        assertEquals(listOf("Ask Foli AI: \"trash\"", "Open Trash"), typing.map { it.label })
        assertTrue(searchActions("x", ai = false, graph = false).none { it.id == "ask" })
    }

    @Test fun accountSheetWords() {
        assertEquals("short@mail.com", middleEllipsis("short@mail.com"))
        val cut = middleEllipsis("a.very.long.name.indeed@example.org", 28)
        assertTrue(cut, cut.endsWith("@example.org") && cut.contains("…") && cut.length <= 28)
        assertEquals("99+", unreadBadge(120))
        assertEquals("7", unreadBadge(7))
    }

    @Test fun folderColorsAndNames() {
        assertEquals(25, FOLDER_SWATCHES.size)
        assertEquals(0xFF77B7DF, FOLDER_SWATCHES.first { it.first == "sky" }.second)
        assertTrue(folderNameOk(" Trips "))
        assertFalse(folderNameOk("   "))
        assertFalse(folderNameOk("x".repeat(81)))
    }

    @Test fun aGroupedScreenDrawsItsRows() {
        var tapped = 0
        var back = 0
        compose.setContent {
            FoleviTheme(dark = false) {
                GroupedScreen("Settings", onBack = { back++ }) {
                    item { GroupHeader("You", first = true) }
                    item { GroupCard { SettingRow("Appearance", onClick = { tapped++ }, last = true) } }
                }
            }
        }
        compose.onNodeWithText("YOU").assertIsDisplayed()
        compose.onNodeWithText("Appearance").performClick()
        assertEquals(1, tapped)
        compose.onNodeWithContentDescription("Back").performClick()
        assertEquals(1, back)
    }
}
