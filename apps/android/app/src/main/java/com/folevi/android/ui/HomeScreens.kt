// Home, the note lists, All folders and Notifications, as the web's phone layout draws them
// (apps/web/src/components/iphone/IphoneHome.tsx, NoteList.tsx, Rows.tsx, Swipe.tsx, Organize.tsx), from the
// engine's live views. Owner 2026-11-25: the Capacitor app's UX with Folevi's styling and Android's ripple.
package com.folevi.android.ui

import androidx.compose.ui.semantics.heading

import androidx.compose.foundation.layout.widthIn

import androidx.compose.foundation.layout.fillMaxHeight

import androidx.compose.ui.text.style.Hyphens

import androidx.compose.ui.text.style.LineBreak

import androidx.compose.ui.platform.LocalDensity

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.dropShadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.shadow.Shadow
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.DpOffset
import androidx.compose.ui.unit.dp
import com.folevi.android.design.AiMark
import com.folevi.android.design.AvatarButton
import com.folevi.android.design.CardTitle
import com.folevi.android.design.EmptyNote
import com.folevi.android.design.FilterField
import com.folevi.android.design.FoleviIcon
import com.folevi.android.design.FrostedFolder
import com.folevi.android.design.GlassCircle
import com.folevi.android.design.GlassPill
import com.folevi.android.design.GlassTextButton
import com.folevi.android.design.ListRow
import com.folevi.android.design.LocalPalette
import com.folevi.android.design.PhoneRadius
import com.folevi.android.design.PhoneScreen
import com.folevi.android.design.PhoneType
import com.folevi.android.design.PillButton
import com.folevi.android.design.Placeholder
import com.folevi.android.design.RowGroup
import com.folevi.android.design.ScreenEmpty
import com.folevi.android.design.SearchPill
import com.folevi.android.design.SectionHeader
import com.folevi.android.design.SwipeAction
import com.folevi.android.design.SwipeRow
import com.folevi.android.design.WebIcon
import com.folevi.android.design.folderColor
import com.folevi.android.design.foleviGlass
import com.folevi.android.design.phoneColors
import com.folevi.engine.generated.Commands
import com.folevi.engine.generated.HomeRow
import com.folevi.engine.generated.ListViews
import com.folevi.engine.generated.NoteRow
import com.folevi.engine.generated.NotesListView
import com.folevi.engine.generated.NotesSort
import com.folevi.engine.protocol.Patch
import com.folevi.engine.generated.SyncMark
import com.folevi.engine.generated.Views
import kotlinx.coroutines.launch

/** What the phone frame hides while a list is in Select mode (the tab bar gives way to the select bar). */
object PhoneChrome {
    val selecting: MutableState<Boolean> = mutableStateOf(false)
}

/** Opens the account sheet and the New folder sheet (AppShell provides them). */
class PhoneSheets(val account: () -> Unit, val newFolder: (parentId: String?) -> Unit)

val LocalPhoneSheets = staticCompositionLocalOf { PhoneSheets({}, {}) }

// ---------------------------------------------------------------- Home

@Composable
fun HomeScreen(open: (Route) -> Unit) {
    val home by rememberView(Views.home())
    val sessionView by rememberView(Views.session())
    val sync by rememberView(Views.syncStatus())
    val notes by rememberView(Views.notificationsList())
    val sheets = LocalPhoneSheets.current
    val v = home.value
    val profile = sessionView.value?.profile
    val signedIn = sessionView.value?.mode?.value == "account"
    val graph = sessionView.value?.capabilities?.graph == true
    val place = v?.spaceName?.takeIf { it.isNotBlank() } ?: "Personal"
    var tagsOpen by rememberSaveable { mutableStateOf(false) }
    var more by remember { mutableStateOf(false) }
    PhoneScreen(
        title = "Home",
        eyebrow = v?.spaceName?.takeIf { it.isNotBlank() && it != "Personal" },
        leading = { AvatarButton(profile?.name ?: "", onClick = sheets.account) },
        trailing = {
            GlassPill {
                if (signedIn) SyncButton(sync.value?.pending ?: 0, sync.value?.online != false)
                PillButton("Notifications", onClick = { open(NotificationsRoute) }) {
                    FoleviIcon(WebIcon.BELL, null, size = 21.dp, tint = LocalPalette.current.ink)
                    if ((notes.value?.unread ?: 0) > 0) {
                        Box(Modifier.align(Alignment.TopEnd).offset(x = (-4).dp, y = 6.dp).size(10.dp).clip(CircleShape).background(LocalPalette.current.canvas).padding(2.dp).clip(CircleShape).background(LocalPalette.current.coral))
                    }
                }
                Box {
                    PillButton("More", onClick = { more = true }) { FoleviIcon(WebIcon.ELLIPSIS, null, size = 24.dp, tint = LocalPalette.current.ink) }
                    PhoneMenu(more, { more = false }) {
                        MenuItem("New folder", WebIcon.FOLDER_PLUS) { more = false; sheets.newFolder(null) }
                        MenuItem("All folders", WebIcon.FOLDER_TREE) { more = false; open(FoldersRoute) }
                        if (graph) MenuItem("Foli DNA", WebIcon.WAYPOINTS) { more = false; open(WebShowRoute("graph", "Foli DNA")) }
                    }
                }
            }
        },
        header = { SearchPill("Search in $place", onClick = { open(SearchRoute) }) },
    ) {
        if (v == null) {
            item { Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) { repeat(3) { Placeholder(64.dp, shape = PhoneRadius.container) } } }
            return@PhoneScreen
        }
        // Recent notes: a snapping row of notebook cards.
        item(key = "recent") {
            when {
                !v.recentsLoaded -> Row(Modifier.padding(start = 16.dp, top = 12.dp, bottom = 24.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    repeat(3) { Box(Modifier.width(156.dp * LocalDensity.current.fontScale.coerceIn(1f, 1.6f)).aspectRatio(25f / 27f).clip(PhoneRadius.container).background(LocalPalette.current.surfaceSunken)) }
                }
                v.recents.isEmpty() -> EmptyNote("Notes you open show up here.", Modifier.padding(top = 12.dp, bottom = 12.dp))
                else -> LazyRow(
                    contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 24.dp),
                    horizontalArrangement = Arrangement.spacedBy(14.dp),
                    flingBehavior = androidx.compose.foundation.gestures.snapping.rememberSnapFlingBehavior(rememberLazyListState()),
                ) {
                    items(v.recents.take(10), key = { it.id }) { r -> NoteMenuHost(r, open) { m -> NotebookCard(r, m.width(156.dp * LocalDensity.current.fontScale.coerceIn(1f, 1.6f))) } }
                }
            }
        }
        if (v.catchUp.available) item(key = "catchup") { CatchUpCard(v.catchUp) }
        // The tiles: All notes, Drafts, Shared with Me, Changes, Reviews (an odd last one spans both columns).
        item(key = "tiles") {
            Column(Modifier.padding(horizontal = 16.dp).padding(top = if (v.catchUp.available) 10.dp else 0.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                v.rows.chunked(2).forEach { pair ->
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        pair.forEach { r -> HomeTile(r, Modifier.weight(1f)) { openHomeRow(r, open) } }
                    }
                }
            }
        }
        // Bookmarks.
        item(key = "bookmarks-h") {
            SectionHeader("Bookmarks", onTitle = { open(NotesRoute(NotesListView.STARRED.value, "Bookmarks")) }, seeAll = if (v.starred.more || v.starred.rows.size > 5) ({ open(NotesRoute(NotesListView.STARRED.value, "Bookmarks")) }) else null)
        }
        item(key = "bookmarks") {
            if (v.starred.rows.isEmpty()) EmptyNote("Bookmark a note to keep it here.")
            else RowGroup {
                v.starred.rows.take(5).forEach { r ->
                    NoteMenuHost(r, open) { m -> ListRow(r.title.ifEmpty { "Untitled" }, onClick = { open(NoteRoute(r.id, r.title)) }, modifier = m, icon = WebIcon.FILE_TEXT) }
                }
            }
        }
        // Folders.
        item(key = "folders-h") {
            var menu by remember { mutableStateOf(false) }
            SectionHeader("Folders", onTitle = { open(FoldersRoute) }, more = {
                Box {
                    Box(Modifier.size(44.dp).clip(CircleShape).clickable(role = Role.Button, onClickLabel = "Folder actions") { menu = true }, contentAlignment = Alignment.Center) {
                        FoleviIcon(WebIcon.ELLIPSIS, "Folder actions", size = 22.dp, tint = LocalPalette.current.inkMuted)
                    }
                    PhoneMenu(menu, { menu = false }) {
                        MenuItem("New folder", WebIcon.FOLDER_PLUS) { menu = false; sheets.newFolder(null) }
                        MenuItem("All folders", WebIcon.FOLDER_TREE) { menu = false; open(FoldersRoute) }
                    }
                }
            })
        }
        item(key = "folders") {
            if (v.folders.isEmpty()) EmptyNote("Folders keep related notes together.")
            else LazyRow(contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 0.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                items(v.folders, key = { it.id }) { f -> FrostedFolder(f, onClick = { open(NotesRoute(NotesListView.FOLDER.value, f.name, folderId = f.id)) }, modifier = Modifier.width(142.dp)) }
            }
        }
        // Tags: folded away until opened (remembered).
        if (v.tags.isNotEmpty()) {
            item(key = "tags-h") { SectionHeader("Tags", onTitle = { tagsOpen = !tagsOpen }, chevronTurned = tagsOpen) }
            if (tagsOpen) item(key = "tags") {
                RowGroup {
                    v.tags.forEach { t -> ListRow(t.name, onClick = { open(NotesRoute(NotesListView.TAG.value, t.name, tagId = t.id)) }, icon = WebIcon.HASH, iconTint = folderColor(t.color)) }
                }
            }
        }
        item(key = "end") {
            RowGroup(Modifier.padding(top = 28.dp)) {
                ListRow("Vault", onClick = { open(VaultRoute) }, icon = WebIcon.LOCK_KEYHOLE)
                ListRow("Templates", onClick = { open(NotesRoute(NotesListView.TEMPLATES.value, "Templates")) }, icon = WebIcon.LAYOUT_TEMPLATE)
                ListRow("Archive", onClick = { open(NotesRoute(NotesListView.ARCHIVE.value, "Archive")) }, icon = WebIcon.ARCHIVE)
                ListRow("Trash", onClick = { open(NotesRoute(NotesListView.TRASH.value, "Trash")) }, icon = WebIcon.TRASH)
            }
        }
    }
}

private fun openHomeRow(r: HomeRow, open: (Route) -> Unit) = when (r.id) {
    HomeRow.Id.NOTES -> open(NotesRoute(NotesListView.ALL.value, r.title))
    // Drafts are the notes in no folder (`unsorted`), as on iPhone.
    HomeRow.Id.DRAFTS -> open(NotesRoute(NotesListView.UNSORTED.value, r.title))
    HomeRow.Id.SHARED -> open(SharedRoute)
    HomeRow.Id.CHANGES -> open(ChangesRoute)
    HomeRow.Id.REVIEWS -> open(WebShowRoute("reviews", r.title))
}

private fun homeIcon(id: HomeRow.Id): WebIcon = when (id) {
    HomeRow.Id.NOTES -> WebIcon.FILES
    HomeRow.Id.DRAFTS -> WebIcon.INBOX
    HomeRow.Id.SHARED -> WebIcon.SHARE_2
    HomeRow.Id.CHANGES -> WebIcon.FILE_DIFF
    HomeRow.Id.REVIEWS -> WebIcon.LAYERS
}

/** A Home tile (min 80, radius 14, the card fill): icon and count on top, the label below. */
@Composable
private fun HomeTile(r: HomeRow, modifier: Modifier, onClick: () -> Unit) {
    val p = LocalPalette.current
    val c = phoneColors()
    Column(
        modifier.heightIn(min = 80.dp).clip(PhoneRadius.panel).background(c.card).clickable(role = Role.Button, onClick = onClick).padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            FoleviIcon(homeIcon(r.id), null, size = 22.dp, tint = p.inkMuted)
            Spacer(Modifier.weight(1f))
            r.count?.takeIf { it > 0 }?.let { Text("$it", style = PhoneType.title3.copy(fontWeight = FontWeight.SemiBold, fontFeatureSettings = "tnum"), color = p.heading) }
        }
        Text(r.title, style = PhoneType.body.copy(fontWeight = FontWeight.Medium), color = p.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
private fun CatchUpCard(card: com.folevi.engine.generated.CatchUpCard) {
    val p = LocalPalette.current
    val c = phoneColors()
    val session = LocalSession.current
    val scope = rememberCoroutineScope()
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp).clip(PhoneRadius.container).background(c.card).padding(20.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            AiMark(20.dp)
            Text("Catch me up", style = PhoneType.headline, color = p.heading)
        }
        val brief = card.brief
        when {
            brief != null -> Text(simpleMarkdown(brief.text), style = PhoneType.subheadline, color = p.ink)
            card.error != null -> Text(card.error!!.message, style = PhoneType.subheadline, color = p.destructive)
            else -> Text("Foli AI sums up what changed since you last looked.", style = PhoneType.subheadline, color = p.inkMuted)
        }
        GlassTextButton(if (brief != null) "Refresh" else "Catch me up", onClick = { scope.launch { runCatching { session.client.command(Commands.catchUpRun()) } } })
    }
}

@Composable
private fun SyncButton(pending: Long, online: Boolean) {
    val p = LocalPalette.current
    val icon = when {
        !online -> WebIcon.CLOUD_OFF
        pending > 0 -> WebIcon.CLOUD
        else -> WebIcon.CLOUD_CHECK
    }
    var open by remember { mutableStateOf(false) }
    PillButton(if (pending > 0) "$pending changes waiting to sync" else "Synced", onClick = { open = true }) { FoleviIcon(icon, null, size = 20.dp, tint = p.ink) }
    if (open) AlertDialog(
        onDismissRequest = { open = false },
        title = { Text(if (!online) "Offline" else if (pending > 0) "Syncing" else "Up to date") },
        text = { Text(if (pending > 0) "$pending ${if (pending == 1L) "change is" else "changes are"} waiting to sync." else "Everything on this phone is saved.") },
        confirmButton = { TextButton(onClick = { open = false }) { Text("OK") } },
    )
}

// ---------------------------------------------------------------- cards and glyphs

/** The notebook corners: 4 at the spine, 8 at the edge. */
private val NotebookShape = RoundedCornerShape(topStart = 4.dp, bottomStart = 4.dp, topEnd = 8.dp, bottomEnd = 8.dp)

/** A note as the web's notebook card (156 wide, 25:27, the three-layer shadow, a dark ribbon when bookmarked). */
@Composable
fun NotebookCard(row: NoteRow, modifier: Modifier = Modifier) {
    val p = LocalPalette.current
    // Large text: the card grows to fit rather than keep the web's 25:27 page (where long words would break).
    val scale = LocalDensity.current.fontScale
    val big = scale > 1.15f
    Box(
        (if (big) modifier.heightIn(min = 168.dp * scale.coerceIn(1f, 1.6f)) else modifier.aspectRatio(25f / 27f))
            // The web's layered shadow, folded into one soft drop (Compose clips spread shadows at the row's edge).
            .dropShadow(NotebookShape, Shadow(radius = 14.dp, offset = DpOffset((-2).dp, 6.dp), color = Color(20, 20, 30).copy(alpha = 0.09f)))
            .clip(NotebookShape).background(p.surface).border(0.5.dp, p.line, NotebookShape),
    ) {
        // The spine in the folder's color.
        Box(Modifier.matchParentSize()) {
            Box(Modifier.width(4.dp).fillMaxHeight().background(row.folder?.let { folderColor(it.color) } ?: p.heading.copy(alpha = 0.14f)))
        }
        Column(
            (if (big) Modifier.fillMaxWidth() else Modifier.fillMaxSize()).padding(start = 14.dp, end = 12.dp, top = 12.dp, bottom = 10.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Row(verticalAlignment = Alignment.Top) {
                row.icon?.let { Text(it, modifier = Modifier.padding(end = 4.dp)) }
                Text(
                    row.title.ifEmpty { "Untitled" },
                    style = CardTitle.copy(fontSize = CardTitle.fontSize * 0.88f, lineBreak = LineBreak.Heading, hyphens = Hyphens.None),
                    color = p.heading,
                    maxLines = if (big) 3 else 2,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
            }
            val text = row.preview?.joinToString("\n") { it.x }?.takeIf { it.isNotBlank() } ?: row.excerpt
            if (big) {
                if (text.isNotBlank()) Text(text, style = PhoneType.footnote, color = p.inkMuted, maxLines = 3, overflow = TextOverflow.Ellipsis)
                Spacer(Modifier.height(6.dp))
            } else if (text.isNotBlank()) Text(text, style = PhoneType.footnote, color = p.inkMuted, maxLines = 5, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
            else Spacer(Modifier.weight(1f))
            Text(relativeAge(row.updatedAt), style = PhoneType.caption2, color = p.inkFaint, maxLines = 1)
        }
        if (row.starred) {
            Box(Modifier.align(Alignment.TopEnd).padding(end = 12.dp).size(width = 10.dp, height = 16.dp).clip(RoundedCornerShape(bottomStart = 2.dp, bottomEnd = 2.dp)).background(p.heading).semantics { contentDescription = "Bookmarked" })
        }
    }
}

/** The list row's page glyph (28 box, a 20×24 page with a 4 spine in the folder's color and two lines). */
@Composable
private fun NoteGlyph(row: NoteRow) {
    val p = LocalPalette.current
    val page = RoundedCornerShape(topStart = 4.dp, bottomStart = 4.dp, topEnd = 6.dp, bottomEnd = 6.dp)
    Box(Modifier.size(28.dp), contentAlignment = Alignment.Center) {
        Box(Modifier.size(width = 20.dp, height = 24.dp).dropShadow(page, Shadow(radius = 2.dp, offset = DpOffset(0.dp, 1.dp), color = Color.Black.copy(alpha = 0.06f))).clip(page).background(p.surface).border(1.dp, p.line, page)) {
            Box(Modifier.width(4.dp).height(24.dp).background(row.folder?.let { folderColor(it.color) } ?: p.heading.copy(alpha = 0.14f)))
            Column(Modifier.padding(start = 7.dp, top = 7.dp, end = 3.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Box(Modifier.fillMaxWidth().height(1.5.dp).background(p.lineStrong))
                Box(Modifier.fillMaxWidth(0.7f).height(1.5.dp).background(p.lineStrong))
            }
        }
    }
}

private fun relativeAge(ms: Double): String {
    if (ms <= 0) return ""
    val mins = ((System.currentTimeMillis() - ms) / 60_000).toLong()
    return when {
        mins < 1 -> "Just now"
        mins < 60 -> "${mins}m ago"
        mins < 60 * 24 -> "${mins / 60}h ago"
        mins < 60 * 24 * 7 -> "${mins / (60 * 24)}d ago"
        else -> com.folevi.android.design.shortDate(ms)
    }
}

// ---------------------------------------------------------------- menus

@Composable
fun PhoneMenu(expanded: Boolean, onDismiss: () -> Unit, content: @Composable androidx.compose.foundation.layout.ColumnScope.() -> Unit) {
    DropdownMenu(
        expanded = expanded,
        onDismissRequest = onDismiss,
        shape = PhoneRadius.panel,
        containerColor = LocalPalette.current.surfaceRaised,
        tonalElevation = 0.dp,
        shadowElevation = 8.dp,
        content = content,
    )
}

@Composable
fun MenuItem(label: String, icon: WebIcon? = null, destructive: Boolean = false, checked: Boolean = false, enabled: Boolean = true, onClick: () -> Unit) {
    val p = LocalPalette.current
    DropdownMenuItem(
        text = { Text(label, style = PhoneType.body, color = if (destructive) p.destructive else p.ink) },
        leadingIcon = icon?.let { { FoleviIcon(it, null, tint = if (destructive) p.destructive else p.ink) } },
        trailingIcon = if (checked) ({ FoleviIcon(WebIcon.CHECK, "Selected", tint = p.ink) }) else null,
        enabled = enabled,
        onClick = onClick,
    )
}

@Composable
fun MenuHeading(text: String) {
    Text(text, style = PhoneType.footnote.copy(fontWeight = FontWeight.SemiBold), color = LocalPalette.current.inkMuted, modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp))
}

/** Long press (or right-click) opens the note's menu, in the web phone's order. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun NoteMenuHost(row: NoteRow, open: (Route) -> Unit, onSelect: (() -> Unit)? = null, selected: Boolean = false, manual: Boolean = false, onClick: (() -> Unit)? = null, content: @Composable (Modifier) -> Unit) {
    var menu by remember { mutableStateOf(false) }
    var moving by remember { mutableStateOf(false) }
    var deleting by remember { mutableStateOf(false) }
    val act = rememberNoteActs()
    Box {
        content(Modifier.combinedClickable(onClick = onClick ?: { open(NoteRoute(row.id, row.title)) }, onLongClickLabel = "More actions", onLongClick = { menu = true }))
        PhoneMenu(menu, { menu = false }) {
            if (row.inTrash) {
                MenuItem("Restore", WebIcon.ROTATE_CCW) { menu = false; act.restore(listOf(row.id)) }
                if (onSelect != null) MenuItem(if (selected) "Deselect" else "Select", WebIcon.CIRCLE_CHECK) { menu = false; onSelect() }
                HorizontalDivider(color = phoneColors().separator)
                MenuItem("Delete permanently…", WebIcon.TRASH, destructive = true) { menu = false; deleting = true }
            } else {
                if (row.kind == "template") {
                    MenuItem("New page from template", WebIcon.FILE_PLUS_CORNER) { menu = false; act.fromTemplate(row.id, open) }
                    MenuItem("Edit template", WebIcon.PENCIL) { menu = false; open(NoteRoute(row.id, row.title)) }
                }
                MenuItem(if (row.starred) "Remove bookmark" else "Bookmark", if (row.starred) WebIcon.BOOKMARK_OFF else WebIcon.BOOKMARK) { menu = false; act.star(listOf(row.id), !row.starred) }
                MenuItem("Move to folder…", WebIcon.FOLDER_INPUT) { menu = false; moving = true }
                MenuItem("Duplicate", WebIcon.COPY) { menu = false; act.duplicate(row.id) }
                MenuItem(if (row.archived) "Unarchive" else "Archive", if (row.archived) WebIcon.ARCHIVE_RESTORE else WebIcon.ARCHIVE) { menu = false; act.archive(listOf(row.id), !row.archived) }
                if (onSelect != null) MenuItem(if (selected) "Deselect" else "Select", WebIcon.CIRCLE_CHECK) { menu = false; onSelect() }
                HorizontalDivider(color = phoneColors().separator)
                MenuItem("Move to Trash", WebIcon.TRASH, destructive = true) { menu = false; act.trash(listOf(row.id)) }
            }
        }
    }
    if (moving) FolderPicker(onDismiss = { moving = false }) { folderId -> moving = false; act.move(listOf(row.id), folderId) }
    if (deleting) ConfirmDelete(1, onDismiss = { deleting = false }) { deleting = false; act.deleteForever(listOf(row.id)) }
}

/** The note commands the lists and menus use. */
class NoteActs(private val run: (suspend () -> Unit) -> Unit, private val session: com.folevi.android.engine.AppSession) {
    fun star(ids: List<String>, on: Boolean) = run { session.client.command(Commands.noteStar(ids = ids, starred = on)) }
    fun archive(ids: List<String>, on: Boolean) = run { session.client.command(Commands.noteArchive(ids = ids, archived = on)) }
    fun trash(ids: List<String>) = run { session.client.command(Commands.noteTrash(ids = ids)) }
    fun restore(ids: List<String>) = run { session.client.command(Commands.noteRestore(ids = ids)) }
    fun deleteForever(ids: List<String>) = run { session.client.command(Commands.noteDeleteForever(ids = ids)) }
    fun move(ids: List<String>, folderId: String?) = run { session.client.command(Commands.noteMove(ids = ids, folderId = folderId)) }
    fun duplicate(id: String) = run { session.client.command(Commands.noteDuplicate(id = id)) }
    fun fromTemplate(id: String, open: (Route) -> Unit) = run {
        val made = session.client.command(Commands.noteCreate(templateId = Patch.Set(id), open = false))
        open(NoteRoute(made.id, "Untitled"))
    }
}

@Composable
fun rememberNoteActs(): NoteActs {
    val session = LocalSession.current
    val scope = rememberCoroutineScope()
    return remember(session) { NoteActs({ block -> scope.launch { runCatching { block() } } }, session) }
}

/** Picks a folder (or none: Drafts) for Move to folder. */
@Composable
fun FolderPicker(onDismiss: () -> Unit, onPick: (String?) -> Unit) {
    val tree by rememberView(Views.foldersTree())
    val p = LocalPalette.current
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Move to folder") },
        text = {
            androidx.compose.foundation.lazy.LazyColumn(Modifier.heightIn(max = 420.dp)) {
                item { ListRow("Drafts (no folder)", onClick = { onPick(null) }, icon = WebIcon.INBOX, chevron = false) }
                items(tree.value?.folders.orEmpty(), key = { it.id }) { f ->
                    ListRow(f.name, onClick = { onPick(f.id) }, icon = WebIcon.FOLDER, iconTint = folderColor(f.color), chevron = false, modifier = Modifier.padding(start = (f.depth.toInt() * 16).dp))
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("Cancel", color = p.ink) } },
    )
}

@Composable
private fun ConfirmDelete(count: Int, onDismiss: () -> Unit, onConfirm: () -> Unit) {
    val p = LocalPalette.current
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (count == 1) "Delete this note permanently?" else "Delete $count notes permanently?") },
        text = { Text("This can't be undone.") },
        confirmButton = { TextButton(onClick = onConfirm) { Text("Delete permanently", color = p.destructive) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel", color = p.ink) } },
    )
}

// ---------------------------------------------------------------- note lists


/** A windowed notes list (`notes.list`) as the web's IphoneNoteList: cards or rows, filter, sort, swipe, Select. */
@Composable
fun NotesScreen(route: NotesRoute, open: (Route) -> Unit, onBack: (() -> Unit)? = null) {
    val view = NotesListView.of(route.view) ?: NotesListView.ALL
    val trash = view == NotesListView.TRASH
    val templates = view == NotesListView.TEMPLATES
    var filter by rememberSaveable(route) { mutableStateOf("") }
    var sort by rememberSaveable(route) { mutableStateOf(NotesSort.UPDATED.value) }
    var cards by rememberSaveable(route) { mutableStateOf(!(trash || view == NotesListView.ARCHIVE)) }
    val (store, state) = rememberList(
        ListViews.notesList(view = view, folderId = route.folderId, tagId = route.tagId, sort = NotesSort.of(sort), filter = filter.takeIf { it.isNotBlank() }),
        key = Triple(route, sort, filter),
    )
    val list = state.value.list
    val listState = rememberLazyListState()
    val selected = remember(route) { mutableStateListOf<String>() }
    var selecting by remember(route) { mutableStateOf(false) }
    LaunchedEffect(selecting) { PhoneChrome.selecting.value = selecting }
    androidx.compose.runtime.DisposableEffect(Unit) { onDispose { PhoneChrome.selecting.value = false } }
    val perLine = if (cards) 2 else 1
    // The store's window follows the rows on screen (the first list item is the title, then subfolders).
    LaunchedEffect(store, perLine) {
        snapshotFlow { listState.layoutInfo.visibleItemsInfo.mapNotNull { (it.key as? String)?.removePrefix("line")?.toIntOrNull() } }.collect { lines ->
            if (lines.isNotEmpty()) store.visibleRows((lines.min() * perLine)..(lines.max() * perLine + perLine - 1))
        }
    }
    val subfolders by rememberView(Views.foldersCards(parentId = route.folderId?.let { Patch.Set(it) } ?: Patch.Keep), key = route.folderId)
    val act = rememberNoteActs()
    val sheets = LocalPhoneSheets.current
    var menu by remember { mutableStateOf(false) }
    var emptying by remember { mutableStateOf(false) }
    val session = LocalSession.current
    val scope = rememberCoroutineScope()
    val nav = WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()
    Box(Modifier.fillMaxSize()) {
        PhoneScreen(
            title = route.title,
            state = listState,
            leading = if (selecting) ({
                GlassTextButton(if (selected.size == list.total && list.total > 0) "Deselect All" else "Select All", onClick = {
                    if (selected.size == list.total) selected.clear() else { selected.clear(); selected.addAll(list.order) }
                })
            }) else onBack?.let { back -> { GlassCircle(WebIcon.CHEVRON_LEFT, "Back", back) } },
            trailing = {
                if (selecting) {
                    GlassTextButton("Done", onClick = { selecting = false; selected.clear() }, strong = true)
                } else {
                    if (!templates && list.total > 0) GlassTextButton("Select", onClick = { selecting = true })
                    GlassPill {
                        Box {
                            PillButton("More", onClick = { menu = true }) { FoleviIcon(WebIcon.ELLIPSIS, null, size = 24.dp, tint = LocalPalette.current.ink) }
                            PhoneMenu(menu, { menu = false }) {
                                if (templates) {
                                    MenuItem("New template", WebIcon.FILE_PLUS_CORNER) {
                                        menu = false
                                        scope.launch { runCatching { session.client.command(Commands.templateCreate(open = false)) }.getOrNull()?.let { open(NoteRoute(it.id, "Untitled")) } }
                                    }
                                    HorizontalDivider(color = phoneColors().separator)
                                }
                                MenuHeading("View as")
                                MenuItem("Cards", WebIcon.LAYOUT_GRID, checked = cards) { menu = false; cards = true }
                                MenuItem("List", WebIcon.LIST, checked = !cards) { menu = false; cards = false }
                                HorizontalDivider(color = phoneColors().separator)
                                MenuHeading("Sort by")
                                MenuItem("Last edited", checked = sort == NotesSort.UPDATED.value) { menu = false; sort = NotesSort.UPDATED.value }
                                MenuItem("Created", checked = sort == NotesSort.CREATED.value) { menu = false; sort = NotesSort.CREATED.value }
                                MenuItem("Title", checked = sort == NotesSort.TITLE.value) { menu = false; sort = NotesSort.TITLE.value }
                                if (!trash) MenuItem("Manual order", checked = sort == NotesSort.MANUAL.value) { menu = false; sort = NotesSort.MANUAL.value }
                                if (trash) {
                                    HorizontalDivider(color = phoneColors().separator)
                                    MenuItem("Empty Trash", WebIcon.TRASH, destructive = true, enabled = list.total > 0) { menu = false; emptying = true }
                                }
                            }
                        }
                    }
                }
            },
            header = { FilterField(filter, { filter = it }, "Filter notes") },
            bottomPadding = if (selecting) 110.dp else 96.dp,
        ) {
            if (templates) item(key = "builtins") { BuiltInTemplates(open) }
            val subs = subfolders.value?.folders.orEmpty().filter { route.folderId != null }
            if (subs.isNotEmpty()) item(key = "subfolders") {
                Column(Modifier.padding(top = 8.dp)) {
                    subs.forEach { f -> ListRow(f.name, onClick = { open(NotesRoute(NotesListView.FOLDER.value, f.name, folderId = f.id)) }, icon = WebIcon.FOLDER, iconTint = folderColor(f.color), detail = "${f.noteCount}", grouped = false) }
                }
            }
            if (list.total == 0) {
                item(key = "empty") {
                    if (state.value.status == com.folevi.engine.client.StoreStatus.LOADING) Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) { repeat(4) { Placeholder(64.dp) } }
                    else if (filter.isNotBlank()) ScreenEmpty(WebIcon.SEARCH, "No notes match", "Try other words.")
                    else when (view) {
                        NotesListView.TRASH -> ScreenEmpty(WebIcon.TRASH, "Trash is empty", "Deleted notes stay here for 30 days.")
                        NotesListView.ARCHIVE -> ScreenEmpty(WebIcon.ARCHIVE, "Archive is empty", "Archived notes rest here, out of your lists but never lost.")
                        NotesListView.TEMPLATES -> ScreenEmpty(WebIcon.LAYOUT_TEMPLATE, "No templates of your own yet", "Save any note as a template from its menu.")
                        NotesListView.STARRED -> ScreenEmpty(WebIcon.BOOKMARK, "No bookmarks yet", "Bookmark a note to keep it here.")
                        else -> ScreenEmpty(WebIcon.FILE_TEXT, "No notes here yet", "Notes you add here show up in this list.")
                    }
                }
                return@PhoneScreen
            }
            if (templates) item(key = "yours") { MenuHeadingRow("Your templates") }
            val lines = (list.total + perLine - 1) / perLine
            items(count = lines, key = { "line$it" }, contentType = { if (cards) "cards" else "row" }) { line ->
                if (cards) {
                    Row(Modifier.padding(start = 16.dp, end = 16.dp, top = if (line == 0) 16.dp else 0.dp, bottom = 20.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                        for (k in 0 until 2) {
                            val i = line * 2 + k
                            val row = if (i < list.total) list.rowAt(i) else null
                            Box(Modifier.weight(1f)) {
                                if (row != null) {
                                    val on = row.id in selected
                                    NoteMenuHost(row, open, onSelect = if (templates) null else ({ toggle(selected, row.id); selecting = true }), selected = on, onClick = if (selecting) ({ toggle(selected, row.id) }) else null) { m ->
                                        Box(m) {
                                            NotebookCard(row)
                                            if (selecting) SelectMark(on, Modifier.align(Alignment.TopEnd).padding(8.dp), size = 28.dp)
                                        }
                                    }
                                } else if (i < list.total) Box(Modifier.fillMaxWidth().aspectRatio(25f / 27f).clip(PhoneRadius.container).background(LocalPalette.current.surfaceSunken))
                            }
                        }
                    }
                } else {
                    val row = list.rowAt(line)
                    if (row == null) Box(Modifier.fillMaxWidth().height(64.dp))
                    else {
                        val on = row.id in selected
                        val leading = when {
                            selecting -> emptyList()
                            trash -> listOf(SwipeAction("Restore", WebIcon.ROTATE_CCW, LocalPalette.current.swipeRestore) { act.restore(listOf(row.id)) })
                            else -> listOf(if (row.starred) SwipeAction("Remove", WebIcon.BOOKMARK_OFF, LocalPalette.current.swipeUnbookmark) { act.star(listOf(row.id), false) } else SwipeAction("Bookmark", WebIcon.BOOKMARK, LocalPalette.current.swipeBookmark) { act.star(listOf(row.id), true) })
                        }
                        val trailing = if (selecting || trash) emptyList() else listOf(
                            SwipeAction("Trash", WebIcon.TRASH, LocalPalette.current.swipeTrash) { act.trash(listOf(row.id)) },
                            if (row.archived) SwipeAction("Unarchive", WebIcon.ARCHIVE_RESTORE, LocalPalette.current.swipeArchive) { act.archive(listOf(row.id), false) } else SwipeAction("Archive", WebIcon.ARCHIVE, LocalPalette.current.swipeArchive) { act.archive(listOf(row.id), true) },
                        )
                        SwipeRow(leading, trailing) {
                            NoteMenuHost(row, open, onSelect = if (templates) null else ({ toggle(selected, row.id); selecting = true }), selected = on, onClick = if (selecting) ({ toggle(selected, row.id) }) else null) { m ->
                                NoteListRow(row, m, if (selecting) on else null)
                            }
                        }
                    }
                }
            }
        }
        // The select bar takes the tab bar's place.
        AnimatedVisibility(
            visible = selecting,
            enter = slideInVertically(com.folevi.android.design.Motion.defaultSpatial()) { it },
            exit = slideOutVertically(com.folevi.android.design.Motion.fastSpatial()) { it },
            modifier = Modifier.align(Alignment.BottomCenter),
        ) {
            SelectBar(trash, selected.toList(), nav, act, onDone = { selected.clear(); selecting = false }, onEmpty = { emptying = true })
        }
    }
    if (emptying) {
        val p = LocalPalette.current
        AlertDialog(
            onDismissRequest = { emptying = false },
            title = { Text("Empty Trash?") },
            text = { Text("Every note in the Trash is deleted permanently. This can't be undone.") },
            confirmButton = { TextButton(onClick = { emptying = false; scope.launch { runCatching { session.client.command(Commands.trashEmpty()) } } }) { Text("Delete permanently", color = p.destructive) } },
            dismissButton = { TextButton(onClick = { emptying = false }) { Text("Cancel", color = p.ink) } },
        )
    }
}

private fun toggle(list: MutableList<String>, id: String) {
    if (id in list) list.remove(id) else list.add(id)
}

@Composable
private fun MenuHeadingRow(text: String) {
    Text(text.uppercase(), style = PhoneType.eyebrow, color = LocalPalette.current.inkMuted, modifier = Modifier.padding(start = 20.dp, top = 24.dp, bottom = 6.dp).semantics { heading() })
}

/** A list row (NoteList.tsx): the page glyph (or the select circle), title with a bookmark, "{age} · {folder}". */
@Composable
private fun NoteListRow(row: NoteRow, modifier: Modifier, selected: Boolean?) {
    val p = LocalPalette.current
    val c = phoneColors()
    Row(modifier.fillMaxWidth().background(p.canvas).padding(start = 20.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        if (selected != null) SelectMark(selected, Modifier.size(28.dp), size = 22.dp) else NoteGlyph(row)
        Column(
            Modifier.weight(1f).heightIn(min = 64.dp)
                .drawBehindHairline(c.separator)
                .padding(end = 16.dp, top = 10.dp, bottom = 10.dp),
            verticalArrangement = Arrangement.Center,
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(row.title.ifEmpty { "Untitled" }, style = PhoneType.body, color = p.ink, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                if (row.starred) FoleviIcon(WebIcon.BOOKMARK, "Bookmarked", size = 13.dp, tint = p.inkFaint, modifier = Modifier.padding(start = 4.dp))
            }
            Text(rowMeta(row), style = PhoneType.subheadline, color = p.inkMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

/** The row's second line: "{age} · {folder}" or " · Draft", plus " · Waiting to sync"; in Trash "Deleted {age}". */
internal fun rowMeta(row: NoteRow, now: Long = System.currentTimeMillis()): String {
    if (row.inTrash) return "Deleted ${relativeAgeAt(row.deletedAt ?: row.updatedAt, now).replaceFirstChar { it.lowercase() }}"
    val parts = mutableListOf(relativeAgeAt(row.updatedAt, now))
    parts += row.folder?.name ?: "Draft"
    if (row.sync == SyncMark.WAITING) parts += "Waiting to sync"
    return parts.filter { it.isNotBlank() }.joinToString(" · ")
}

internal fun relativeAgeAt(ms: Double, now: Long): String {
    if (ms <= 0) return ""
    val mins = ((now - ms) / 60_000).toLong()
    return when {
        mins < 1 -> "Just now"
        mins < 60 -> "${mins}m ago"
        mins < 60 * 24 -> "${mins / 60}h ago"
        mins < 60 * 24 * 7 -> "${mins / (60 * 24)}d ago"
        else -> com.folevi.android.design.shortDate(ms)
    }
}

private fun Modifier.drawBehindHairline(color: Color): Modifier =
    drawBehind { drawLine(color, androidx.compose.ui.geometry.Offset(0f, size.height), androidx.compose.ui.geometry.Offset(size.width, size.height), 0.5.dp.toPx()) }

/** The select circle (22 in rows, 28 on cards): a 1.5 ring off, the heading fill with a check on. */
@Composable
private fun SelectMark(on: Boolean, modifier: Modifier, size: androidx.compose.ui.unit.Dp) {
    val p = LocalPalette.current
    Box(modifier, contentAlignment = Alignment.Center) {
        Box(
            Modifier.size(size).clip(CircleShape).background(if (on) p.heading else p.canvas.copy(alpha = 0.6f)).then(if (on) Modifier else Modifier.border(1.5.dp, p.lineStrong, CircleShape)),
            contentAlignment = Alignment.Center,
        ) { if (on) FoleviIcon(WebIcon.CHECK, "Selected", size = 14.dp, tint = p.canvas) }
    }
}

/** The bar in Select mode: a glass capsule, 64 tall, with icon-over-label buttons. */
@Composable
private fun SelectBar(trash: Boolean, ids: List<String>, nav: androidx.compose.ui.unit.Dp, act: NoteActs, onDone: () -> Unit, onEmpty: () -> Unit) {
    val p = LocalPalette.current
    var moving by remember { mutableStateOf(false) }
    var deleting by remember { mutableStateOf(false) }
    val none = ids.isEmpty()
    Row(
        Modifier.padding(start = 16.dp, end = 16.dp, bottom = maxOf(10.dp, nav)).widthIn(max = 480.dp).fillMaxWidth().heightIn(min = 64.dp).foleviGlass(CircleShape).padding(4.dp),
        horizontalArrangement = Arrangement.SpaceEvenly,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        @Composable
        fun B(label: String, icon: WebIcon, danger: Boolean = false, run: () -> Unit) {
            Column(
                Modifier.weight(1f).heightIn(min = 56.dp).clip(CircleShape).clickable(enabled = !none, role = Role.Button, onClick = run).padding(top = 6.dp, bottom = 4.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                val tint = (if (danger) p.destructive else p.ink).copy(alpha = if (none) 0.35f else 1f)
                FoleviIcon(icon, null, size = 22.dp, tint = tint)
                Text(label, style = PhoneType.caption2.copy(fontWeight = FontWeight.Medium), color = tint, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 3.dp))
            }
        }
        if (trash) {
            B("Restore", WebIcon.ROTATE_CCW) { act.restore(ids); onDone() }
            B("Delete", WebIcon.TRASH, danger = true) { deleting = true }
        } else {
            B("Move", WebIcon.FOLDER_INPUT) { moving = true }
            B("Bookmark", WebIcon.BOOKMARK) { act.star(ids, true); onDone() }
            B("Archive", WebIcon.ARCHIVE) { act.archive(ids, true); onDone() }
            B("Trash", WebIcon.TRASH, danger = true) { act.trash(ids); onDone() }
        }
    }
    if (moving) FolderPicker(onDismiss = { moving = false }) { folderId -> moving = false; act.move(ids, folderId); onDone() }
    if (deleting) ConfirmDelete(ids.size, onDismiss = { deleting = false }) { deleting = false; act.deleteForever(ids); onDone() }
}

/** Templates: the built-in ones first, each making a note from it. */
@Composable
private fun BuiltInTemplates(open: (Route) -> Unit) {
    val builtIn by rememberView(Views.templatesBuiltIn())
    val act = rememberNoteActs()
    val list = builtIn.value?.templates.orEmpty()
    if (list.isEmpty()) return
    Column {
        MenuHeadingRow("Built-in templates")
        RowGroup {
            list.forEach { t -> ListRow(t.name, onClick = { act.fromTemplate(t.key, open) }, icon = WebIcon.LAYOUT_TEMPLATE, detail = null) }
        }
    }
}

// ---------------------------------------------------------------- All folders, Notifications

@Composable
fun FoldersScreen(open: (Route) -> Unit, onBack: (() -> Unit)?) {
    val cards by rememberView(Views.foldersCards(all = true))
    val sheets = LocalPhoneSheets.current
    PhoneScreen(
        title = "Folders",
        leading = onBack?.let { back -> { GlassCircle(WebIcon.CHEVRON_LEFT, "Back", back) } },
        trailing = { GlassCircle(WebIcon.FOLDER_PLUS, "New folder", { sheets.newFolder(null) }, iconSize = 21.dp) },
    ) {
        val folders = cards.value?.folders
        if (folders == null) item { Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) { repeat(4) { Placeholder(52.dp) } } }
        else if (folders.isEmpty()) item { ScreenEmpty(WebIcon.FOLDER, "No folders yet", "Folders keep related notes together.", action = { GlassTextButton("New folder", onClick = { sheets.newFolder(null) }) }) }
        else folders.chunked(2).forEach { pair ->
            item(key = pair.first().id) {
                Row(Modifier.padding(horizontal = 16.dp, vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    pair.forEach { f -> FrostedFolder(f, onClick = { open(NotesRoute(NotesListView.FOLDER.value, f.name, folderId = f.id)) }, modifier = Modifier.weight(1f)) }
                    if (pair.size == 1) Spacer(Modifier.weight(1f))
                }
            }
        }
    }
}

@Composable
fun NotificationsScreen(open: (Route) -> Unit, onBack: (() -> Unit)?) {
    val notes by rememberView(Views.notificationsList())
    val p = LocalPalette.current
    PhoneScreen(title = "Notifications", leading = onBack?.let { back -> { GlassCircle(WebIcon.CHEVRON_LEFT, "Back", back) } }) {
        val rows = notes.value?.rows
        if (rows == null) item { Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) { repeat(4) { Placeholder(64.dp) } } }
        else if (rows.isEmpty()) item { ScreenEmpty(WebIcon.BELL, "You're all caught up", "Mentions, comments and shares show up here.") }
        else items(rows, key = { it.id }) { n ->
            Row(
                Modifier.fillMaxWidth().clickable(role = Role.Button) { n.route?.let { open(routeOfPath(it, n.noteId)) } }.padding(start = 20.dp, end = 16.dp, top = 10.dp, bottom = 10.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Box(Modifier.padding(top = 8.dp).size(8.dp).clip(CircleShape).background(if (n.read) Color.Transparent else p.coral))
                Column(Modifier.weight(1f)) {
                    Text(n.title, style = PhoneType.body.copy(fontWeight = if (n.read) FontWeight.Normal else FontWeight.Medium), color = p.ink, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    if (n.body.isNotBlank()) Text(n.body, style = PhoneType.subheadline, color = p.inkMuted, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    Text(relativeAge(n.at), style = PhoneType.footnote, color = p.inkFaint)
                }
            }
        }
    }
}

/** Catch me up's markdown, as plain styled text: **bold**, and "- " lists as bullets. */
internal fun simpleMarkdown(text: String): androidx.compose.ui.text.AnnotatedString = androidx.compose.ui.text.buildAnnotatedString {
    text.lines().forEachIndexed { i, raw ->
        if (i > 0) append("\n")
        val line = if (raw.startsWith("- ") || raw.startsWith("* ")) "\u2022 " + raw.drop(2) else raw
        var rest = line
        while (true) {
            val a = rest.indexOf("**")
            val b = if (a >= 0) rest.indexOf("**", a + 2) else -1
            if (a < 0 || b < 0) { append(rest); break }
            append(rest.substring(0, a))
            withStyle(androidx.compose.ui.text.SpanStyle(fontWeight = FontWeight.SemiBold)) { append(rest.substring(a + 2, b)) }
            rest = rest.substring(b + 2)
        }
    }
}
