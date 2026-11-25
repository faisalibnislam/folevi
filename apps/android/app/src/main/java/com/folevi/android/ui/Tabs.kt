// Tabs on tablets, open foldables and Googlebooks (the owner, 2026-11-24: "everything will open in new tab just like
// the web app"), with the web's rules (apps/web/src/lib/app/tabs.tsx) as the Mac app has them
// (apps/native-kit/Sources/FoleviMac/Model/TabsModel.swift):
//
// - Home is the first tab and never closes. Every other view gets one tab (one per view kind, one per folder or
//   tag) that follows you inside it; every note opened from a list, Home, search or New note gets its own tab.
// - Folders open like Finder: a folder shows in a folder tab, which navigates rather than adding a tab. From a
//   folder tab it goes there; from anywhere else the folder tab used last does, or a new one opens.
// - A tab opened from a page (Home's See all and cards, a folder card, a note from a list, a search result)
//   remembers the tab it came from. Back with nothing left in it closes it and shows that tab again, as Safari
//   does. The sidebar, the rail and New note open fresh tabs with no way back.
// - Opening a page from inside a note (a link, a nested page) replaces the note's tab; its Back goes to the note
//   before. A page in another tab by then switches to that tab instead.
// - Each tab has its own Back and Forward. At most 12 tabs besides Home: one more drops the oldest other one.
// - Closing the tab on screen shows its right neighbour, else its left one. Closed tabs reopen, newest first.
//
// Phones keep their single page with Back (AppShell). Pure state: TabsModelTest drives it directly.
package com.folevi.android.ui

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.Saver
import androidx.compose.runtime.setValue
import com.folevi.android.design.WebIcon
import com.folevi.engine.generated.NotesListView
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.util.UUID

/** The page a route shows, as the strip knows it (web tabs.tsx `viewKey`; the Mac's FrameRoute.tabKey). */
fun Route.tabKey(): String = when (this) {
    HomeRoute -> FrameTab.HOME_ID
    is NoteRoute -> id
    is NotesRoute -> when {
        folderId != null -> "view:folder:$folderId"
        tagId != null -> "view:tag:$tagId"
        else -> "view:$view"
    }
    // Foli AI is one tab: a chat keeps its tab (the web's /ai and /ai/<id>).
    AiRoute, is AiChatRoute -> "view:ai"
    SettingsRoute -> "view:settings"
    VaultRoute -> "view:vault"
    SharedRoute -> "view:shared"
    ChangesRoute -> "view:changes"
    TasksRoute -> "view:tasks"
    CalendarRoute -> "view:calendar"
    SearchRoute -> "view:search"
    is PageRoute -> "view:web:$route"
    is WebShowRoute -> "view:web:$page"
    FoldersRoute -> "view:folders"
    NotificationsRoute -> "view:notifications"
    // Screens added later (Settings pages) key by what they are.
    else -> "view:$this"
}

/** A folder: it shows in a folder tab that moves between folders. */
val Route.isFolderBrowsing: Boolean get() = this is NotesRoute && folderId != null

val Route.isNote: Boolean get() = this is NoteRoute

/** A tab's name before anything better is known (notes are named again from their titles). */
fun Route.tabTitle(): String = when (this) {
    HomeRoute -> "Home"
    is NoteRoute -> title.ifEmpty { "Untitled" }
    is NotesRoute -> title
    AiRoute, is AiChatRoute -> "Foli AI"
    SettingsRoute -> "Settings"
    VaultRoute -> "Vault"
    SharedRoute -> "Shared with Me"
    ChangesRoute -> "Changes"
    TasksRoute -> "Tasks"
    CalendarRoute -> "Calendar"
    SearchRoute -> "Search"
    is PageRoute -> title
    is WebShowRoute -> title
    FoldersRoute -> "Folders"
    NotificationsRoute -> "Notifications"
    else -> "Settings"
}

fun Route.tabIcon(): WebIcon = when (this) {
    HomeRoute -> WebIcon.HOUSE
    is NoteRoute -> WebIcon.FILE_TEXT
    is NotesRoute -> when {
        folderId != null -> WebIcon.FOLDER
        view == NotesListView.UNSORTED.value -> WebIcon.PENCIL_LINE
        else -> WebIcon.FILE_TEXT
    }
    AiRoute, is AiChatRoute -> WebIcon.SPARKLES
    SettingsRoute -> WebIcon.SETTINGS
    VaultRoute -> WebIcon.LOCK
    SharedRoute -> WebIcon.USERS
    ChangesRoute -> WebIcon.ACTIVITY
    TasksRoute -> WebIcon.SQUARE_CHECK_BIG
    CalendarRoute -> WebIcon.CALENDAR_DAYS
    SearchRoute -> WebIcon.SEARCH
    is PageRoute, is WebShowRoute -> WebIcon.FILE_TEXT
    FoldersRoute -> WebIcon.FOLDER_TREE
    NotificationsRoute -> WebIcon.BELL
    else -> WebIcon.SETTINGS
}

/** A tab's own Back and Forward (Finder style): the pages it showed, oldest first, and the one it shows. */
@Serializable
data class RouteHistory(val entries: List<Route>, val at: Int) {
    constructor(route: Route) : this(listOf(route), 0)

    val current: Route get() = entries[at]
    val canGoBack: Boolean get() = at > 0
    val canGoForward: Boolean get() = at < entries.lastIndex

    /** A new page: what was ahead goes, and the oldest go past [LIMIT]. */
    fun push(route: Route): RouteHistory {
        if (current == route) return this
        val kept = (entries.take(at + 1) + route).takeLast(LIMIT)
        return RouteHistory(kept, kept.lastIndex)
    }

    fun back(): RouteHistory? = if (canGoBack) copy(at = at - 1) else null
    fun forward(): RouteHistory? = if (canGoForward) copy(at = at + 1) else null

    /** A page that's gone (a note in the Trash) leaves the history; `fallback` if nothing is left. */
    fun forget(route: Route, fallback: Route): RouteHistory {
        val before = entries.take(at + 1).count { it != route }
        val kept = entries.filter { it != route }
        if (kept.isEmpty()) return RouteHistory(fallback)
        return RouteHistory(kept, (before - 1).coerceIn(0, kept.lastIndex))
    }

    companion object {
        /** The most pages a tab's Back remembers (the web's TRAIL_LIMIT). */
        const val LIMIT = 50
    }
}

@Serializable
data class FrameTab(
    val id: String,
    val history: RouteHistory,
    /** The tab this one was opened from (`home` for Home), when it was opened from a page. */
    val opener: String? = null,
    /** The note's title as the engine last told it (notes); null keeps the route's. */
    val title: String? = null,
) {
    val route: Route get() = history.current
    val isHome: Boolean get() = id == HOME_ID
    val isFolderTab: Boolean get() = id.startsWith(FOLDER_PREFIX)
    val name: String get() = title?.ifEmpty { null } ?: route.tabTitle()

    /** Whether this tab shows the page with key `key`. */
    fun holds(key: String): Boolean = id == key || route.tabKey() == key

    companion object {
        const val HOME_ID = "home"
        const val FOLDER_PREFIX = "folders:"

        fun of(route: Route, opener: String? = null) = FrameTab(
            id = if (route.isFolderBrowsing) FOLDER_PREFIX + UUID.randomUUID().toString().replace("-", "").take(8) else route.tabKey(),
            history = RouteHistory(route),
            opener = opener,
        )
    }
}

class TabsModel {
    enum class Opening {
        /** From a list, Home, search, the sidebar or New note: its own tab (or the one it already has). */
        NEW_TAB,
        /** From inside a note (a link, a nested page): the note's tab follows it. */
        REPLACE,
    }

    /** Home first, then the open tabs in strip order. */
    var tabs: List<FrameTab> by mutableStateOf(listOf(FrameTab.of(HomeRoute)))
        private set
    var activeId: String by mutableStateOf(FrameTab.HOME_ID)
        private set
    /** Closed tabs, newest last. */
    var closed: List<FrameTab> by mutableStateOf(emptyList())
        private set

    /** When each tab was last on screen (a clock that only goes up): a folder from Home reuses the folder tab used last. */
    private val usedAt = HashMap<String, Long>()
    private var clock = 0L

    val active: FrameTab get() = tabs.firstOrNull { it.id == activeId } ?: tabs[0]
    val activeRoute: Route get() = active.route
    private val activeIndex: Int get() = tabs.indexOfFirst { it.id == activeId }.coerceAtLeast(0)

    private fun activate(id: String) {
        activeId = id
        usedAt[id] = ++clock
    }

    private fun replace(i: Int, t: FrameTab) {
        tabs = tabs.toMutableList().also { it[i] = t }
    }

    /**
     * Shows a route, following the web's tab rules. `fromPage`: opened from the page on screen (it becomes a new
     * tab's opener); false from the sidebar, the rail or New note.
     */
    fun show(route: Route, opening: Opening = Opening.NEW_TAB, fromPage: Boolean = true) {
        val from = if (fromPage) activeId else null
        if (route.isFolderBrowsing) return showFolder(route, from)
        val key = route.tabKey()
        val open = tabs.indexOfFirst { it.holds(key) }
        if (open != -1) {
            // A view's tab follows you inside it (a chat in Foli AI's tab).
            val t = tabs[open]
            if (t.route != route) replace(open, t.copy(history = t.history.push(route)))
            activate(t.id)
            return
        }
        val here = activeIndex
        if (opening == Opening.REPLACE && route.isNote && !tabs[here].isHome && tabs[here].route.isNote) {
            val t = tabs[here]
            replace(here, FrameTab(id = key, history = t.history.push(route), opener = t.opener))
            activate(key)
            return
        }
        add(FrameTab.of(route, from))
    }

    private fun showFolder(route: Route, from: String?) {
        tabs.indexOfFirst { it.holds(route.tabKey()) }.takeIf { it != -1 }?.let { return activate(tabs[it].id) }
        val i = if (active.isFolderTab) activeIndex else lastFolderTab()
        if (i != null) {
            val t = tabs[i]
            replace(i, t.copy(history = t.history.push(route)))
            return activate(t.id)
        }
        add(FrameTab.of(route, from))
    }

    /** The folder tab on screen last (the rightmost when none has been yet). */
    private fun lastFolderTab(): Int? = tabs.indices.filter { tabs[it].isFolderTab }.maxWithOrNull(compareBy({ usedAt[tabs[it].id] ?: 0L }, { it }))

    private fun add(t: FrameTab, inBackground: Boolean = false) {
        tabs = tabs + t
        if (!inBackground) activate(t.id)
        trim(keeping = t.id, alsoKeeping = activeId)
    }

    /** Keeps the strip bounded: drops the oldest tabs other than `keeping` (Home never goes). */
    private fun trim(keeping: String, alsoKeeping: String?) {
        var next = tabs
        while (next.size - 1 > MAX_TABS) {
            val i = next.indexOfFirst { !it.isHome && it.id != keeping && it.id != alsoKeeping }
            if (i == -1) break
            next = next.filterIndexed { j, _ -> j != i }
        }
        tabs = next
    }

    /** Adds a route's tab behind the one on screen ("Open in new tab"); a page that has a tab keeps it. */
    fun addInBackground(route: Route, fromPage: Boolean = true): String? {
        if (tabs.any { it.holds(route.tabKey()) }) return null
        val t = FrameTab.of(route, if (fromPage) activeId else null)
        add(t, inBackground = true)
        return t.id
    }

    fun select(id: String) {
        if (tabs.any { it.id == id }) activate(id)
    }

    /** Whether Back goes anywhere: back in the tab, or to the tab it was opened from. */
    val canGoBack: Boolean get() = active.history.canGoBack || openerOf(active) != null
    val canGoForward: Boolean get() = active.history.canGoForward

    private fun openerOf(t: FrameTab): FrameTab? = t.opener?.takeIf { it != t.id }?.let { o -> tabs.firstOrNull { it.id == o } }

    /** Back in the tab on screen; then, in a tab opened from a page, closes it and shows its opener. False when there's nowhere to go. */
    fun goBack(): Boolean = travel(back = true)

    fun goForward(): Boolean = travel(back = false)

    private fun travel(back: Boolean): Boolean {
        val i = activeIndex
        val t = tabs[i]
        val h = (if (back) t.history.back() else t.history.forward()) ?: run {
            if (!back) return false
            val o = openerOf(t) ?: return false
            remember(t)
            tabs = tabs.filterIndexed { j, _ -> j != i }
            activate(o.id)
            return true
        }
        // A page that's in another tab by now: that tab comes forward, and this one stays where it was.
        val key = h.current.tabKey()
        tabs.firstOrNull { it.id != t.id && it.holds(key) }?.let { activate(it.id); return true }
        // A note's tab is named by its note: going back to another note gives the tab that note's key.
        val id = if (t.isFolderTab || !h.current.isNote) t.id else key
        replace(i, t.copy(id = id, history = h, title = null))
        activate(id)
        return true
    }

    private fun remember(t: FrameTab) {
        closed = (closed + t).takeLast(MAX_CLOSED)
    }

    /** Closes a tab (Home stays). The tab on screen gives way to its right neighbour, else its left one. */
    fun close(id: String) {
        if (id == FrameTab.HOME_ID) return
        val i = tabs.indexOfFirst { it.id == id }.takeIf { it != -1 } ?: return
        remember(tabs[i])
        val next = tabs.filterIndexed { j, _ -> j != i }
        tabs = next
        if (id == activeId) activate((next.getOrNull(i) ?: next[i - 1]).id)
    }

    /** Closes every tab but `id` and Home. */
    fun closeOthers(id: String) {
        val gone = tabs.filter { !it.isHome && it.id != id }
        if (gone.isEmpty()) return
        closed = (closed + gone).takeLast(MAX_CLOSED)
        tabs = tabs.filter { it.isHome || it.id == id }
        if (tabs.none { it.id == activeId }) activate(tabs.firstOrNull { it.id == id }?.id ?: FrameTab.HOME_ID)
    }

    /** Brings the last closed tab back, unless its page is open again by now. */
    fun reopenClosed(): Boolean {
        var left = closed
        while (left.isNotEmpty()) {
            val last = left.last()
            left = left.dropLast(1)
            if (tabs.any { it.id == last.id || it.holds(last.route.tabKey()) }) continue
            closed = left
            add(last)
            return true
        }
        closed = left
        return false
    }

    /** The next or previous tab (Ctrl+Tab, Ctrl+Shift+Tab), round the strip. */
    fun cycle(by: Int) {
        val n = tabs.size
        activate(tabs[((activeIndex + by) % n + n) % n].id)
    }

    /** A note's title from the engine names its tab. */
    fun named(noteId: String, title: String) {
        val i = tabs.indexOfFirst { it.route is NoteRoute && (it.route as NoteRoute).id == noteId }
        if (i != -1 && tabs[i].title != title) replace(i, tabs[i].copy(title = title))
    }

    /** A page that's gone (a note in the Trash) leaves every tab's history; a tab showing it goes back. */
    fun forget(route: Route) {
        tabs = tabs.map { t -> if (t.isHome) t else t.copy(history = t.history.forget(route, fallback = HomeRoute)) }
        closed = closed.filter { it.route != route }
    }

    private fun snapshot() = Saved(tabs, activeId, closed)

    private fun restore(s: Saved) {
        if (s.tabs.firstOrNull()?.isHome != true) return
        tabs = s.tabs
        closed = s.closed
        activate(s.tabs.firstOrNull { it.id == s.activeId }?.id ?: FrameTab.HOME_ID)
    }

    @Serializable
    private data class Saved(val tabs: List<FrameTab>, val activeId: String, val closed: List<FrameTab>)

    companion object {
        const val MAX_TABS = 12
        const val MAX_CLOSED = 20
        private val json = Json { ignoreUnknownKeys = true }

        /** Keeps the strip across a configuration change or the process going away. */
        val saver: Saver<TabsModel, String> = Saver(
            save = { json.encodeToString(Saved.serializer(), it.snapshot()) },
            restore = { s -> TabsModel().also { m -> runCatching { json.decodeFromString(Saved.serializer(), s) }.getOrNull()?.let(m::restore) } },
        )
    }
}

/**
 * A web path from the engine (`navigate.request`: `/d/<id>`, `/folders/<id>`, `/tasks/today`) as a route, the way
 * the web router and the Mac's FrameRoute read it. Paths native has no screen for show as the web's page.
 */
fun routeOfPath(path: String, noteId: String? = null): Route {
    if (noteId != null) return NoteRoute(noteId, "")
    val clean = path.substringBefore('#')
    val parts = clean.substringBefore('?').trim('/').split('/').filter { it.isNotEmpty() }.map { java.net.URLDecoder.decode(it, "UTF-8") }
    val a = parts.getOrNull(1)
    return when (parts.firstOrNull()) {
        null, "documents", "home" -> HomeRoute
        "d" -> a?.let { NoteRoute(it, "") } ?: HomeRoute
        "notes" -> NotesRoute(NotesListView.ALL.value, "All notes")
        "drafts", "unsorted" -> NotesRoute(NotesListView.UNSORTED.value, "Drafts")
        "starred" -> NotesRoute(NotesListView.STARRED.value, "Bookmarks")
        "archive" -> NotesRoute(NotesListView.ARCHIVE.value, "Archive")
        "trash" -> NotesRoute(NotesListView.TRASH.value, "Trash")
        "templates" -> NotesRoute(NotesListView.TEMPLATES.value, "Templates")
        "folders" -> a?.let { NotesRoute(NotesListView.FOLDER.value, "Folder", folderId = it) } ?: PageRoute(clean, "Folders")
        "tags" -> a?.let { NotesRoute(NotesListView.TAG.value, "Tag", tagId = it) } ?: PageRoute(clean, "Tags")
        "shared" -> if (a == null) SharedRoute else PageRoute(clean, "Shared")
        "changes" -> ChangesRoute
        "inbox", "tasks" -> TasksRoute
        "calendar" -> CalendarRoute
        "search" -> SearchRoute
        "ai" -> if (a == null) AiRoute else AiChatRoute(a)
        "vault" -> VaultRoute
        "settings" -> if (a == null && !clean.contains('?')) SettingsRoute else PageRoute(clean, "Settings")
        else -> PageRoute(clean, parts.first().replaceFirstChar { it.uppercase() })
    }
}
