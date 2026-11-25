// The sidebar of tablet, open-foldable and Googlebook windows, as the web draws it on a tablet
// (apps/web/src/components/app/Sidebar.tsx with globals.css's data-tablet rules): 320 wide on the sidebar color, the
// Folevi mark with the bell and Hide sidebar, a "Search or jump to…" capsule, 44 rows in body text with 20 icons
// (the open one a 9% heading capsule, no raised card), counts in small pills, then Folders (a tree that folds
// open, five top-level folders until "Show more"), Tags (folded away at first), Archive and Trash, and the
// account at the foot. Owner 2026-11-25: the Capacitor app's UX, Folevi's styling, Android's ripple.
package com.folevi.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.folevi.android.design.AiMark
import com.folevi.android.design.FoleviIcon
import com.folevi.android.design.LocalPalette
import com.folevi.android.design.PhoneType
import com.folevi.android.design.Spectral
import com.folevi.android.design.WebIcon
import com.folevi.android.design.folderColor
import com.folevi.android.design.phoneColors
import com.folevi.engine.generated.FolderNode
import com.folevi.engine.generated.HomeRow
import com.folevi.engine.generated.NotesListView
import com.folevi.engine.generated.TagRow
import com.folevi.engine.generated.Views

/** How many top-level folders, tags and bookmarks the sidebar lists before "Show more" (the web's SIDEBAR_LIMIT). */
internal const val SIDEBAR_LIMIT = 5

/** Whether a sidebar row stands for the page on screen (the web's isActive). */
internal fun sidebarActive(route: Route, target: Route): Boolean = when (target) {
    is NotesRoute -> route is NotesRoute && route.view == target.view && route.folderId == target.folderId && route.tagId == target.tagId
    AiRoute -> route is AiRoute || route is AiChatRoute
    is WebShowRoute -> route is WebShowRoute && route.page == target.page
    is NoteRoute -> route is NoteRoute && route.id == target.id
    else -> route == target
}

/**
 * The folders the tree shows: the top-level ones (the first [SIDEBAR_LIMIT] unless [all], plus the one holding
 * [activeFolder]), each followed by its children when it's open. [folders] is depth first, as the engine sends it.
 */
internal fun visibleFolders(folders: List<FolderNode>, open: Set<String>, all: Boolean, activeFolder: String?): List<FolderNode> {
    val byId = folders.associateBy { it.id }
    // The folder on screen opens down to it, and its top-level folder is always listed.
    val path = generateSequence(activeFolder?.let { byId[it] }) { f -> f.parentId?.let { byId[it] } }.map { it.id }.toSet()
    val roots = folders.filter { it.depth == 0L }
    val shownRoots = roots.filterIndexed { i, f -> all || i < SIDEBAR_LIMIT || f.id in path }.map { it.id }.toSet()
    val out = mutableListOf<FolderNode>()
    var rootShown = false
    // A folder shows when its top-level folder is listed and every folder above it is open.
    val openChain = ArrayList<Boolean>()
    for (f in folders) {
        val d = f.depth.toInt()
        if (d == 0) rootShown = f.id in shownRoots
        while (openChain.size > d) openChain.removeAt(openChain.lastIndex)
        val visible = rootShown && openChain.all { it }
        if (visible) out += f
        openChain += visible && (f.id in open || f.id in path)
    }
    return out
}

@Composable
internal fun TabletSidebar(route: Route, open: (Route) -> Unit, onHide: (() -> Unit)?, modifier: Modifier = Modifier) {
    val p = LocalPalette.current
    val home by rememberView(Views.home())
    val tree by rememberView(Views.foldersTree())
    val sessionView by rememberView(Views.session())
    val counts by rememberView(Views.tasksCounts())
    val notes by rememberView(Views.notificationsList())
    val sheets = LocalPhoneSheets.current
    val caps = sessionView.value?.capabilities
    val homeRows = home.value?.rows.orEmpty().associateBy { it.id }
    var bookmarksOpen by rememberSaveable { mutableStateOf(true) }
    var foldersOpen by rememberSaveable { mutableStateOf(true) }
    var tagsOpen by rememberSaveable { mutableStateOf(false) }
    var allFolders by rememberSaveable { mutableStateOf(false) }
    var openFolders by rememberSaveable { mutableStateOf(emptyList<String>()) }
    Column(modifier.width(320.dp).fillMaxHeight().background(p.sidebar).testTag("tablet-sidebar")) {
        // The top bar: the mark, the bell, Hide sidebar.
        Row(Modifier.fillMaxWidth().height(52.dp).padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("Folevi", style = PhoneType.title2Serif.copy(fontSize = 24.sp), color = p.heading, modifier = Modifier.weight(1f).clickable(onClickLabel = "Go to Home") { open(HomeRoute) })
            SidebarIconButton(WebIcon.BELL, "Notifications", { open(NotificationsRoute) }, dot = (notes.value?.unread ?: 0) > 0)
            if (onHide != null) SidebarIconButton(WebIcon.PANEL_LEFT, "Hide sidebar", onHide)
        }
        // Search or jump to…
        Row(
            Modifier.padding(horizontal = 10.dp).padding(top = 4.dp).fillMaxWidth().heightIn(min = 44.dp).clip(CircleShape).background(p.surfaceSunken)
                .clickable(role = Role.Button) { open(SearchRoute) }.padding(start = 14.dp, end = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            FoleviIcon(WebIcon.SEARCH, null, size = 18.dp, tint = p.inkMuted)
            Text("Search or jump to…", style = PhoneType.body, color = p.inkMuted, maxLines = 1)
        }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 10.dp).padding(bottom = 16.dp)) {
            Spacer(Modifier.height(12.dp))
            NavRow("Home", WebIcon.HOUSE, route, HomeRoute, open)
            if (caps?.ai == true) NavRow("Work with Foli AI", null, route, AiRoute, open, leading = { AiMark(20.dp) })
            if (caps?.graph == true) NavRow("Foli DNA", WebIcon.WAYPOINTS, route, WebShowRoute("graph", "Foli DNA"), open)
            val starred = home.value?.starred?.rows.orEmpty()
            NavRow(
                "Bookmarks", WebIcon.BOOKMARK, route, NotesRoute(NotesListView.STARRED.value, "Bookmarks"), open,
                trailing = if (starred.isNotEmpty()) ({ FoldChevron(bookmarksOpen, "Bookmarks") { bookmarksOpen = !bookmarksOpen } }) else null,
            )
            if (bookmarksOpen && starred.isNotEmpty()) {
                Column(Modifier.padding(start = 20.dp)) {
                    starred.take(SIDEBAR_LIMIT).forEach { n -> NavRow(n.title.ifEmpty { "Untitled" }, WebIcon.FILE_TEXT, route, NoteRoute(n.id, n.title), open, iconSize = 17.dp) }
                    if (starred.size > SIDEBAR_LIMIT || home.value?.starred?.more == true) MoreRow("View all") { open(NotesRoute(NotesListView.STARRED.value, "Bookmarks")) }
                }
            }
            NavRow("Drafts", WebIcon.INBOX, route, NotesRoute(NotesListView.UNSORTED.value, "Drafts"), open, count = homeRows[HomeRow.Id.DRAFTS]?.count)
            NavRow("All notes", WebIcon.FILES, route, NotesRoute(NotesListView.ALL.value, "All notes"), open)
            NavRow("Tasks", WebIcon.SQUARE_CHECK_BIG, route, TasksRoute, open, count = counts.value?.today)
            NavRow("Calendar", WebIcon.CALENDAR_DAYS, route, CalendarRoute, open)
            homeRows[HomeRow.Id.REVIEWS]?.takeIf { (it.count ?: 0) > 0 }?.let { NavRow("Reviews", WebIcon.LAYERS, route, WebShowRoute("reviews", "Reviews"), open, count = it.count) }
            if (caps?.sharing == true) NavRow("Shared with Me", WebIcon.SHARE_2, route, SharedRoute, open)
            NavRow("Vault", WebIcon.LOCK, route, VaultRoute, open)
            if (caps?.changes == true) NavRow("Changes", WebIcon.FILE_DIFF, route, ChangesRoute, open, count = homeRows[HomeRow.Id.CHANGES]?.count)
            NavRow("Templates", WebIcon.LAYOUT_TEMPLATE, route, NotesRoute(NotesListView.TEMPLATES.value, "Templates"), open)

            // Folders.
            SectionHead("Folders", foldersOpen, { foldersOpen = !foldersOpen }, onTitle = { open(FoldersRoute) }) {
                SidebarIconButton(WebIcon.FOLDER_PLUS, "New folder", { sheets.newFolder(null) }, size = 18.dp)
            }
            if (foldersOpen) {
                val folders = tree.value?.folders.orEmpty()
                val activeFolder = (route as? NotesRoute)?.folderId
                if (tree.value != null && folders.isEmpty()) Text("No folders yet", style = PhoneType.footnote, color = p.inkFaint, modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp))
                for (f in visibleFolders(folders, openFolders.toSet(), allFolders, activeFolder)) {
                    val isOpen = f.id in openFolders || folders.any { it.id == activeFolder } && isAncestor(folders, f.id, activeFolder)
                    Row(Modifier.padding(start = (f.depth.toInt() * 14).dp), verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.width(28.dp), contentAlignment = Alignment.Center) {
                            if (f.childCount > 0) FoldChevron(isOpen, f.name) { openFolders = if (f.id in openFolders) openFolders - f.id else openFolders + f.id }
                        }
                        NavRow(
                            f.name, WebIcon.FOLDER, route, NotesRoute(NotesListView.FOLDER.value, f.name, folderId = f.id), open,
                            iconTint = folderColor(f.color), modifier = Modifier.weight(1f),
                            trailing = if (f.locked) ({ FoleviIcon(WebIcon.LOCK, "Always fully encrypted", size = 13.dp, tint = p.inkFaint) }) else null,
                        )
                    }
                }
                val roots = folders.count { it.depth == 0L }
                if (!allFolders && roots > SIDEBAR_LIMIT) MoreRow("Show more") { allFolders = true }
                else if (allFolders && roots > SIDEBAR_LIMIT) MoreRow("Show less") { allFolders = false }
            }

            // Tags (folded away at first, as on the web).
            val tags: List<TagRow> = tree.value?.tags ?: home.value?.tags.orEmpty()
            SectionHead("Tags", tagsOpen, { tagsOpen = !tagsOpen })
            if (tagsOpen) {
                if (tags.isEmpty()) Text("Add tags from a note's Info panel", style = PhoneType.footnote, color = p.inkFaint, modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp))
                tags.filterIndexed { i, t -> i < SIDEBAR_LIMIT || (route as? NotesRoute)?.tagId == t.id }.forEach { t ->
                    NavRow(t.name, WebIcon.HASH, route, NotesRoute(NotesListView.TAG.value, t.name, tagId = t.id), open, iconTint = folderColor(t.color))
                }
            }

            Spacer(Modifier.height(20.dp))
            NavRow("Archive", WebIcon.ARCHIVE, route, NotesRoute(NotesListView.ARCHIVE.value, "Archive"), open)
            NavRow("Trash", WebIcon.TRASH, route, NotesRoute(NotesListView.TRASH.value, "Trash"), open)
        }
        // The account at the foot (the web's WorkspaceMenu): opens the account sheet.
        val profile = sessionView.value?.profile
        val place = home.value?.spaceName?.takeIf { it.isNotBlank() } ?: "Personal"
        Row(
            Modifier.padding(horizontal = 10.dp, vertical = 8.dp).fillMaxWidth().heightIn(min = 52.dp).clip(CircleShape)
                .clickable(role = Role.Button, onClickLabel = "Account", onClick = sheets.account).padding(horizontal = 10.dp)
                .semantics { contentDescription = "Account" },
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Box(Modifier.size(32.dp).clip(CircleShape).background(p.accentSoft).border(0.5.dp, Color.Black.copy(alpha = 0.12f), CircleShape), contentAlignment = Alignment.Center) {
                Text(profile?.name?.trim()?.firstOrNull()?.uppercase() ?: "F", style = PhoneType.subheadline.copy(fontWeight = FontWeight.SemiBold), color = p.accentSoftInk)
            }
            Column(Modifier.weight(1f)) {
                Text(place, style = PhoneType.body.copy(fontWeight = FontWeight.Medium), color = p.heading, maxLines = 1, overflow = TextOverflow.Ellipsis)
                profile?.name?.takeIf { it.isNotBlank() }?.let { Text(it, style = PhoneType.footnote, color = p.inkMuted, maxLines = 1, overflow = TextOverflow.Ellipsis) }
            }
            FoleviIcon(WebIcon.CHEVRON_DOWN, null, size = 16.dp, tint = p.inkFaint)
        }
    }
}

private fun isAncestor(folders: List<FolderNode>, id: String, of: String?): Boolean {
    val byId = folders.associateBy { it.id }
    var at = of?.let { byId[it] }?.parentId
    while (at != null) {
        if (at == id) return true
        at = byId[at]?.parentId
    }
    return false
}

/** A sidebar row: 44 tall, a capsule, 20 icon and body text; the open page a 9% heading capsule in semibold. */
@Composable
private fun NavRow(
    label: String,
    icon: WebIcon?,
    route: Route,
    target: Route,
    open: (Route) -> Unit,
    modifier: Modifier = Modifier,
    count: Long? = null,
    iconTint: Color? = null,
    iconSize: Dp = 20.dp,
    leading: (@Composable () -> Unit)? = null,
    trailing: (@Composable () -> Unit)? = null,
) {
    val p = LocalPalette.current
    val active = sidebarActive(route, target)
    Row(
        modifier.fillMaxWidth().heightIn(min = 44.dp).clip(CircleShape).background(if (active) p.heading.copy(alpha = 0.09f) else Color.Transparent)
            .clickable(role = Role.Button) { open(target) }.padding(start = 12.dp, end = 8.dp)
            .semantics { selected = active }.testTag("sidebar-$label"),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(Modifier.size(20.dp), contentAlignment = Alignment.Center) {
            if (leading != null) leading() else if (icon != null) FoleviIcon(icon, null, size = iconSize, tint = iconTint ?: if (active) p.heading else p.inkMuted)
        }
        Text(
            label,
            style = PhoneType.body.copy(fontWeight = if (active) FontWeight.SemiBold else FontWeight.Normal),
            color = if (active) p.heading else p.ink.copy(alpha = 0.9f),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
        if (count != null && count > 0) {
            Box(
                Modifier.widthIn(min = 20.dp).clip(com.folevi.android.design.PhoneRadius.chip).background(if (active) p.heading else phoneColors().ink(0.06f)).padding(horizontal = 6.dp),
                contentAlignment = Alignment.Center,
            ) { Text("$count", style = PhoneType.caption2.copy(fontWeight = FontWeight.SemiBold, fontFeatureSettings = "tnum", lineHeight = 20.sp), color = if (active) p.canvas else p.inkMuted) }
        }
        trailing?.invoke()
    }
}

/** A section's header (the web's caps title): a fold chevron, the title (a link when [onTitle]), its actions. */
@Composable
private fun SectionHead(title: String, open: Boolean, toggle: () -> Unit, onTitle: (() -> Unit)? = null, actions: (@Composable () -> Unit)? = null) {
    val p = LocalPalette.current
    Row(Modifier.fillMaxWidth().padding(top = 20.dp).height(36.dp).padding(start = 4.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        FoldChevron(open, title, toggle)
        Text(
            title.uppercase(),
            style = PhoneType.eyebrow,
            color = p.inkMuted,
            modifier = Modifier.weight(1f).clip(CircleShape).clickable(role = Role.Button) { (onTitle ?: toggle)() }.padding(horizontal = 6.dp, vertical = 8.dp).semantics { heading() },
        )
        actions?.invoke()
    }
}

@Composable
private fun FoldChevron(open: Boolean, name: String, onClick: () -> Unit) {
    val p = LocalPalette.current
    Box(
        Modifier.size(28.dp).clip(CircleShape).clickable(role = Role.Button, onClickLabel = if (open) "Collapse $name" else "Expand $name", onClick = onClick)
            .semantics { contentDescription = if (open) "Collapse $name" else "Expand $name" },
        contentAlignment = Alignment.Center,
    ) { FoleviIcon(if (open) WebIcon.CHEVRON_DOWN else WebIcon.CHEVRON_RIGHT, null, size = 14.dp, tint = p.inkFaint) }
}

@Composable
private fun MoreRow(label: String, onClick: () -> Unit) {
    val p = LocalPalette.current
    Text(
        label,
        style = PhoneType.subheadline,
        color = p.inkMuted,
        modifier = Modifier.fillMaxWidth().heightIn(min = 44.dp).clip(CircleShape).clickable(role = Role.Button, onClick = onClick).padding(start = 44.dp, top = 12.dp, bottom = 12.dp),
    )
}

@Composable
private fun SidebarIconButton(icon: WebIcon, label: String, onClick: () -> Unit, size: Dp = 20.dp, dot: Boolean = false) {
    val p = LocalPalette.current
    Box(
        Modifier.size(44.dp).clip(CircleShape).clickable(role = Role.Button, onClickLabel = label, onClick = onClick).semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) {
        FoleviIcon(icon, null, size = size, tint = p.inkMuted)
        if (dot) Box(Modifier.align(Alignment.TopEnd).padding(top = 10.dp, end = 10.dp).size(8.dp).clip(CircleShape).background(p.coral))
    }
}
