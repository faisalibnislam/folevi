// Search on the phone, as the web draws it (components/app/CommandPalette.tsx's iPhone branch and
// iphone/SearchScopes.tsx): a filled 44 field with Cancel, scope chips (place, folder, tag, created by, edited),
// then Recent (nothing typed yet) or Notes, By meaning and Actions.
package com.folevi.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.folevi.android.design.FoleviIcon
import com.folevi.android.design.LocalPalette
import com.folevi.android.design.PhoneRadius
import com.folevi.android.design.PhoneType
import com.folevi.android.design.WebIcon
import com.folevi.android.design.phoneColors
import com.folevi.android.design.shortDate
import com.folevi.engine.generated.Commands
import com.folevi.engine.generated.NotesListView
import com.folevi.engine.generated.SearchArgs
import com.folevi.engine.generated.SearchHit
import com.folevi.engine.generated.SearchValue
import com.folevi.engine.generated.SpaceInfo
import com.folevi.engine.generated.Views
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.launch

// ---------------------------------------------------------------- pure parts (tested)

/** The "Edited" chip's choices: days back, or null for any time. */
val EDITED_CHOICES: List<Pair<Int?, String>> = listOf(null to "Any time", 7 to "Past week", 30 to "Past month", 365 to "Past year")

/** The `updatedAfter` for "edited in the past [days]" (milliseconds), or null. */
fun updatedAfter(days: Int?, now: Long): Long? = days?.let { now - it * 86_400_000L }

/** "just now", "5 minutes ago", "3 hours ago", "yesterday", "4 days ago", then the date. */
fun relativeAge(at: Double, now: Long): String {
    val ms = now - at.toLong()
    val min = ms / 60_000
    return when {
        min < 1 -> "just now"
        min < 60 -> if (min == 1L) "1 minute ago" else "$min minutes ago"
        min < 60 * 24 -> (min / 60).let { if (it == 1L) "1 hour ago" else "$it hours ago" }
        min < 60 * 48 -> "yesterday"
        min < 60 * 24 * 7 -> "${min / (60 * 24)} days ago"
        else -> shortDate(at)
    }
}

/** A hit's second line: the place (searching everywhere), the page of a file, the snippet, or when it was edited. */
fun hitDetail(hit: SearchHit, showPlace: Boolean, now: Long): String {
    val parts = mutableListOf<String>()
    if (showPlace && !hit.spaceName.isNullOrBlank()) parts += hit.spaceName!!
    if (hit.page != null) parts += "Page ${hit.page}"
    parts += hit.snippet.trim().ifEmpty { "Edited " + relativeAge(hit.updatedAt, now) }
    return parts.joinToString(" · ")
}

/** [text] with every match of [query] in semibold (case doesn't matter). */
fun highlighted(text: String, query: String): AnnotatedString = buildAnnotatedString {
    val q = query.trim()
    if (q.isEmpty()) { append(text); return@buildAnnotatedString }
    var i = 0
    while (i < text.length) {
        val at = text.indexOf(q, i, ignoreCase = true)
        if (at < 0) { append(text.substring(i)); break }
        append(text.substring(i, at))
        pushStyle(SpanStyle(fontWeight = FontWeight.SemiBold))
        append(text.substring(at, at + q.length))
        pop()
        i = at + q.length
    }
}

/** One of search's actions. */
data class SearchAction(val id: String, val label: String, val icon: WebIcon)

/**
 * The actions under the results, in the web's order. While typing, Ask Foli AI carries the words and the rest are
 * those whose label has them.
 */
fun searchActions(query: String, ai: Boolean, graph: Boolean): List<SearchAction> {
    val q = query.trim()
    val all = buildList {
        add(SearchAction("new", "New note", WebIcon.FILE_PLUS_CORNER))
        add(SearchAction("tasks", "Go to Tasks · Today", WebIcon.SQUARE_CHECK_BIG))
        add(SearchAction("calendar", "Go to Calendar", WebIcon.CALENDAR_DAYS))
        add(SearchAction("reviews", "Go to Reviews", WebIcon.LAYERS))
        add(SearchAction("changes", "Go to Changes", WebIcon.FILE_DIFF))
        if (graph) add(SearchAction("graph", "Go to Foli DNA", WebIcon.WAYPOINTS))
        add(SearchAction("home", "Go to Home", WebIcon.HOUSE))
        add(SearchAction("trash", "Open Trash", WebIcon.TRASH))
        add(SearchAction("settings", "Open Settings", WebIcon.SETTINGS))
    }
    val ask = if (ai) listOf(SearchAction("ask", if (q.isEmpty()) "Ask Foli AI" else "Ask Foli AI: \"$q\"", WebIcon.SPARKLES)) else emptyList()
    return ask + if (q.isEmpty()) all else all.filter { it.label.contains(q, ignoreCase = true) }
}

// ---------------------------------------------------------------- the screen

@OptIn(FlowPreview::class)
@Composable
fun SearchScreen(open: (Route) -> Unit, onBack: (() -> Unit)? = null) {
    val session = LocalSession.current
    val scope = rememberCoroutineScope()
    val p = LocalPalette.current
    val c = phoneColors()
    val haptics = LocalHapticFeedback.current
    val sess by rememberView(Views.session())
    val places by rememberView(Views.placesList())
    val tree by rememberView(Views.foldersTree())
    val recent by rememberView(Views.recent(limit = 8))
    val s = sess.value
    val inWorkspace = s?.spaces?.firstOrNull { it.id == s.space }?.kind == SpaceInfo.Kind.WORKSPACE
    val members by rememberView(Views.members(), key = "members:$inWorkspace")

    var text by rememberSaveable { mutableStateOf("") }
    var everywhere by rememberSaveable { mutableStateOf(false) }
    var folderId by rememberSaveable { mutableStateOf<String?>(null) }
    var tagId by rememberSaveable { mutableStateOf<String?>(null) }
    var creatorId by rememberSaveable { mutableStateOf<String?>(null) }
    var editedDays by rememberSaveable { mutableStateOf<Int?>(null) }
    var result by remember { mutableStateOf<SearchValue?>(null) }
    var meaning by remember { mutableStateOf<SearchValue?>(null) }
    var searching by remember { mutableStateOf(false) }

    val filters = listOf(everywhere, folderId, tagId, creatorId, editedDays)
    LaunchedEffect(filters) {
        snapshotFlow { text }.debounce(200).collect { q ->
            if (q.isBlank()) { result = null; meaning = null; searching = false; return@collect }
            searching = true
            val now = System.currentTimeMillis()
            val scopeArg = if (everywhere) SearchArgs.Scope.EVERYWHERE else null
            val f = if (everywhere) null else folderId
            val t = if (everywhere) null else tagId
            val who = if (everywhere) null else creatorId
            result = runCatching { session.client.query(Views.search(text = q, scope = scopeArg, folderId = f, tagId = t, creatorId = who, updatedAfter = updatedAfter(editedDays, now))) }.getOrNull()
            meaning = if (q.trim().length >= 3 && result?.meaningAvailable == true) {
                runCatching { session.client.query(Views.search(text = q, scope = scopeArg, folderId = f, tagId = t, creatorId = who, updatedAfter = updatedAfter(editedDays, now), meaning = true)) }.getOrNull()
            } else null
            searching = false
        }
    }

    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
    // The frame (AppShell's scaffold, the tab strip) already keeps clear of the status and navigation bars.
    val top = 0.dp
    val nav = 0.dp
    val now = System.currentTimeMillis()

    Column(Modifier.fillMaxSize().background(p.canvas).padding(top = top)) {
        // The field and Cancel.
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Row(
                Modifier.weight(1f).height(44.dp).clip(PhoneRadius.panel).background(c.ink(0.065f)).padding(horizontal = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                FoleviIcon(WebIcon.SEARCH, null, size = 19.dp, tint = p.inkFaint)
                Box(Modifier.weight(1f)) {
                    if (text.isEmpty()) Text("Search notes and commands", style = PhoneType.body, color = p.inkFaint, maxLines = 1)
                    BasicTextField(
                        text, { text = it },
                        singleLine = true,
                        textStyle = PhoneType.body.copy(color = p.ink),
                        cursorBrush = SolidColor(p.accent),
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                        keyboardActions = KeyboardActions(onSearch = { result?.hits?.firstOrNull()?.let { h -> open(NoteRoute(h.id, h.title)) } }),
                        modifier = Modifier.fillMaxWidth().focusRequester(focus).semantics { contentDescription = "Search notes and commands" },
                    )
                }
                if (text.isNotEmpty()) {
                    Box(Modifier.size(28.dp).clip(CircleShape).clickable(onClickLabel = "Clear") { text = "" }, contentAlignment = Alignment.Center) {
                        FoleviIcon(WebIcon.CIRCLE_X, "Clear", size = 17.dp, tint = p.inkFaint)
                    }
                }
            }
            if (onBack != null) {
                Text(
                    "Cancel",
                    style = PhoneType.body,
                    color = p.heading,
                    modifier = Modifier.height(44.dp).clip(CircleShape).clickable(role = Role.Button, onClick = onBack).padding(start = 12.dp, end = 4.dp).wrapCenter(),
                )
            }
        }
        // The scope chips.
        val chosen: (() -> Unit) = { haptics.performHapticFeedback(HapticFeedbackType.SegmentTick) }
        LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(bottom = 4.dp)) {
            if ((places.value?.places?.size ?: 0) > 1) item {
                ScopeChip(if (everywhere) "All places" else "This place", on = everywhere, options = listOf(false to "This place", true to "All places"), selected = everywhere) { everywhere = it; chosen() }
            }
            val folders = tree.value?.folders.orEmpty()
            item {
                val name = folders.firstOrNull { it.id == folderId }?.name
                ScopeChip(name ?: "Folder", on = folderId != null, enabled = !everywhere, options = listOf<Pair<String?, String>>(null to "Any folder") + folders.map { it.id to ("    ".repeat(it.depth.toInt()) + it.name) }, selected = folderId, separatorAfterFirst = true) { folderId = it; chosen() }
            }
            val tags = tree.value?.tags.orEmpty()
            if (tags.isNotEmpty()) item {
                val name = tags.firstOrNull { it.id == tagId }?.name
                ScopeChip(name?.let { "#$it" } ?: "Tag", on = tagId != null, enabled = !everywhere, options = listOf<Pair<String?, String>>(null to "Any tag") + tags.map { it.id to "#${it.name}" }, selected = tagId) { tagId = it; chosen() }
            }
            val people = members.value?.members.orEmpty()
            if (inWorkspace && people.isNotEmpty()) item {
                val who = people.firstOrNull { it.id == creatorId }
                ScopeChip(who?.let { if (it.isYou) "Me" else it.name } ?: "Created by", on = creatorId != null, enabled = !everywhere, options = listOf<Pair<String?, String>>(null to "Anyone") + people.map { it.id to if (it.isYou) "Me" else it.name.ifEmpty { it.email } }, selected = creatorId) { creatorId = it; chosen() }
            }
            item {
                ScopeChip(EDITED_CHOICES.first { it.first == editedDays }.second.takeIf { editedDays != null } ?: "Edited", on = editedDays != null, options = EDITED_CHOICES, selected = editedDays) { editedDays = it; chosen() }
            }
        }
        // The results.
        val q = text.trim()
        val showPlace = everywhere
        LazyColumn(Modifier.weight(1f), contentPadding = PaddingValues(bottom = nav + 24.dp)) {
            if (q.isEmpty()) {
                val rows = recent.value?.rows.orEmpty()
                if (rows.isNotEmpty()) {
                    item { ResultsHeading("Recent", first = true) }
                    items(rows, key = { "r" + it.row.id }) { r ->
                        HitRow(highlighted(r.row.title.ifEmpty { "Untitled" }, ""), (if (showPlace) r.spaceName + " · " else "") + "Edited " + relativeAge(r.row.updatedAt, now)) { open(NoteRoute(r.row.id, r.row.title)) }
                    }
                }
            } else {
                val hits = result?.hits.orEmpty()
                item { ResultsHeading("Notes", first = true) }
                when {
                    hits.isEmpty() && (searching || result == null) -> item { Message("Searching…") }
                    hits.isEmpty() -> item { Message("No notes match “$q”.") }
                    else -> items(hits, key = { "n" + it.id + (it.blockId ?: "") }) { h ->
                        HitRow(highlighted(h.title.ifEmpty { "Untitled" }, q), hitDetail(h, showPlace, now)) { open(NoteRoute(h.id, h.title)) }
                    }
                }
                val seen = hits.map { it.id }.toSet()
                val byMeaning = meaning?.hits.orEmpty().filter { it.id !in seen }
                if (byMeaning.isNotEmpty()) {
                    item { ResultsHeading("By meaning") }
                    items(byMeaning, key = { "m" + it.id + (it.blockId ?: "") }) { h ->
                        HitRow(highlighted(h.title.ifEmpty { "Untitled" }, q), hitDetail(h, showPlace, now)) { open(NoteRoute(h.id, h.title)) }
                    }
                }
            }
            val actions = searchActions(q, ai = s?.capabilities?.ai == true, graph = s?.capabilities?.graph == true)
            if (actions.isNotEmpty()) {
                item { ResultsHeading("Actions", first = q.isEmpty() && recent.value?.rows.isNullOrEmpty()) }
                items(actions, key = { "a" + it.id }) { a ->
                    ActionRow(a) {
                        when (a.id) {
                            "ask" -> open(AiChatRoute(null, first = q.ifEmpty { null }))
                            "new" -> scope.launch {
                                runCatching { session.client.command(Commands.noteCreate(open = false)) }.getOrNull()?.let { open(NoteRoute(it.id, "Untitled")) }
                            }
                            "tasks" -> open(TasksRoute)
                            "calendar" -> open(CalendarRoute)
                            "reviews" -> open(WebShowRoute("reviews", "Reviews"))
                            "changes" -> open(ChangesRoute)
                            "graph" -> open(WebShowRoute("graph", "Foli DNA"))
                            "home" -> open(HomeRoute)
                            "trash" -> open(NotesRoute(NotesListView.TRASH.value, "Trash"))
                            "settings" -> open(SettingsRoute)
                        }
                    }
                }
            }
        }
    }
}

private fun Modifier.wrapCenter(): Modifier = this.then(Modifier.padding(vertical = 11.dp))

/** A scope chip (SearchScopes.tsx): a 44 target around a 32 capsule, with a menu of choices. */
@Composable
private fun <T> ScopeChip(label: String, on: Boolean, options: List<Pair<T, String>>, selected: T, enabled: Boolean = true, separatorAfterFirst: Boolean = false, pick: (T) -> Unit) {
    val p = LocalPalette.current
    val c = phoneColors()
    var open by remember { mutableStateOf(false) }
    Box(Modifier.alpha(if (enabled) 1f else 0.4f)) {
        Box(Modifier.height(44.dp).clip(CircleShape).clickable(enabled = enabled, role = Role.Button) { open = true }, contentAlignment = Alignment.Center) {
            Row(
                Modifier.heightIn(min = 32.dp).widthIn(max = 180.dp).clip(CircleShape).background(if (on) p.heading else c.ink(0.065f)).padding(start = 14.dp, end = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Text(label, style = PhoneType.subheadline.copy(fontWeight = if (on) FontWeight.Medium else FontWeight.Normal), color = if (on) p.canvas else p.ink, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                FoleviIcon(WebIcon.CHEVRON_DOWN, null, size = 14.dp, tint = if (on) p.canvas.copy(alpha = 0.7f) else p.inkMuted)
            }
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }, shape = MaterialTheme.shapes.large, containerColor = p.surfaceRaised, tonalElevation = 0.dp, shadowElevation = 8.dp) {
            options.forEachIndexed { i, (value, text) ->
                DropdownMenuItem(
                    text = { Text(text) },
                    trailingIcon = { if (value == selected) FoleviIcon(WebIcon.CHECK, "Selected", size = 18.dp, tint = p.heading) },
                    onClick = { open = false; pick(value) },
                )
                if (separatorAfterFirst && i == 0 && options.size > 1) HorizontalDivider(color = c.separator)
            }
        }
    }
}

@Composable
private fun ResultsHeading(text: String, first: Boolean = false) {
    Text(
        text.uppercase(),
        style = PhoneType.eyebrow,
        color = LocalPalette.current.inkMuted,
        modifier = Modifier.padding(start = 20.dp, end = 20.dp, top = if (first) 12.dp else 24.dp, bottom = 6.dp).semantics { heading() },
    )
}

@Composable
private fun Message(text: String) {
    Text(text, style = PhoneType.subheadline, color = LocalPalette.current.inkMuted, modifier = Modifier.padding(horizontal = 20.dp, vertical = 12.dp))
}

/** A note result (64 tall, file icon 22 in a 28 column, a hairline under the text). */
@Composable
private fun HitRow(title: AnnotatedString, detail: String, onClick: () -> Unit) {
    val p = LocalPalette.current
    val c = phoneColors()
    Row(Modifier.fillMaxWidth().heightIn(min = 64.dp).clickable(role = Role.Button, onClick = onClick).padding(start = 20.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.width(28.dp), contentAlignment = Alignment.Center) { FoleviIcon(WebIcon.FILE_TEXT, null, size = 22.dp, tint = p.inkMuted) }
        Spacer(Modifier.width(12.dp))
        Column(
            Modifier.weight(1f).heightIn(min = 64.dp).drawBehind { drawLine(c.separator, Offset(0f, size.height), Offset(size.width, size.height), 0.5.dp.toPx()) }.padding(end = 16.dp, top = 10.dp, bottom = 10.dp),
            verticalArrangement = Arrangement.Center,
        ) {
            Text(title, style = PhoneType.body, color = p.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(detail, style = PhoneType.subheadline, color = p.inkMuted, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
    }
}

@Composable
private fun ActionRow(a: SearchAction, onClick: () -> Unit) {
    val p = LocalPalette.current
    val c = phoneColors()
    Row(Modifier.fillMaxWidth().heightIn(min = 52.dp).clickable(role = Role.Button, onClick = onClick).padding(start = 20.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.width(28.dp), contentAlignment = Alignment.Center) { FoleviIcon(a.icon, null, size = 22.dp, tint = p.inkMuted) }
        Spacer(Modifier.width(12.dp))
        Box(
            Modifier.weight(1f).heightIn(min = 52.dp).drawBehind { drawLine(c.separator, Offset(0f, size.height), Offset(size.width, size.height), 0.5.dp.toPx()) }.padding(end = 16.dp),
            contentAlignment = Alignment.CenterStart,
        ) { Text(a.label, style = PhoneType.body, color = p.ink, maxLines = 1, overflow = TextOverflow.Ellipsis) }
    }
}
