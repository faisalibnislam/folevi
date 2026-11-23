// The first native screens: Home, a notes list, search, Tasks, Calendar and Foli AI, each drawn from the engine's
// live views (protocol.ts) like the iPhone's, in Material 3 Expressive with Folevi's cards and folders.
package com.folevi.android.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.text.input.rememberTextFieldState
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.LargeTopAppBar
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.folevi.android.design.FoleviIcon
import com.folevi.android.design.FrostedFolder
import com.folevi.android.design.LocalPalette
import com.folevi.android.design.NoteCard
import com.folevi.android.design.WebIcon
import com.folevi.android.design.shortDate
import com.folevi.engine.generated.Commands
import com.folevi.engine.generated.HomeRow
import com.folevi.engine.generated.ListViews
import com.folevi.engine.generated.NotesListView
import com.folevi.engine.generated.SearchValue
import com.folevi.engine.generated.TaskViewName
import com.folevi.engine.generated.Views
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ScreenTitle(title: String, action: (@Composable () -> Unit)? = null) {
    LargeTopAppBar(
        title = { Text(title, maxLines = 1, overflow = TextOverflow.Ellipsis) },
        actions = { action?.invoke() },
        colors = TopAppBarDefaults.topAppBarColors(containerColor = Color.Transparent),
    )
}

@Composable
fun HomeScreen(open: (Route) -> Unit) {
    val home by rememberView(Views.home())
    val v = home.value
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 96.dp)) {
        item {
            ScreenTitle(v?.spaceName?.takeIf { it.isNotBlank() } ?: "Home") {
                androidx.compose.material3.IconButton(onClick = { open(SearchRoute) }) { FoleviIcon(WebIcon.SEARCH, "Search") }
            }
        }
        if (v == null) {
            item { EmptyBox(if (home.error != null) home.error!!.message else "Opening your folio…") }
            return@LazyColumn
        }
        if (v.recents.isNotEmpty()) {
            item { SectionTitle("Recent") }
            item {
                LazyRow(contentPadding = PaddingValues(horizontal = 20.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    items(v.recents, key = { it.id }) { r -> NoteCard(r, onClick = { open(NoteRoute(r.id, r.title)) }, width = 220.dp) }
                }
            }
        }
        item { Spacer(Modifier.height(8.dp)) }
        items(v.rows, key = { it.id.value }) { r ->
            ListItem(
                headlineContent = { Text(r.title) },
                leadingContent = { FoleviIcon(rowIcon(r.id), null) },
                trailingContent = { r.count?.let { Text("$it", color = MaterialTheme.colorScheme.onSurfaceVariant) } },
                colors = ListItemDefaults.colors(containerColor = Color.Transparent),
                modifier = Modifier.clickable {
                    when (r.id) {
                        HomeRow.Id.NOTES -> open(NotesRoute(NotesListView.ALL.value, r.title))
                        else -> open(NotesRoute(NotesListView.ALL.value, r.title))
                    }
                },
            )
        }
        if (v.starred.rows.isNotEmpty()) {
            item { SectionTitle("Starred") }
            items(v.starred.rows, key = { "s" + it.id }) { r -> NoteCard(r, onClick = { open(NoteRoute(r.id, r.title)) }, modifier = Modifier.padding(horizontal = 20.dp, vertical = 6.dp)) }
        }
        if (v.folders.isNotEmpty()) {
            item { SectionTitle("Folders") }
            item {
                LazyRow(contentPadding = PaddingValues(horizontal = 12.dp)) {
                    items(v.folders, key = { it.id }) { f -> FrostedFolder(f, onClick = { open(NotesRoute(NotesListView.FOLDER.value, f.name, folderId = f.id)) }) }
                }
            }
        }
    }
}

private fun rowIcon(id: HomeRow.Id): WebIcon = when (id) {
    HomeRow.Id.NOTES -> WebIcon.FILE_TEXT
    HomeRow.Id.DRAFTS -> WebIcon.PEN_LINE
    HomeRow.Id.SHARED -> WebIcon.USERS
    HomeRow.Id.CHANGES -> WebIcon.ACTIVITY
    HomeRow.Id.REVIEWS -> WebIcon.MESSAGE_SQUARE_TEXT
}

/** A windowed notes list (`notes.list`): the store moves its window as rows scroll into view. */
@Composable
fun NotesScreen(route: NotesRoute, open: (Route) -> Unit) {
    val view = NotesListView.of(route.view) ?: NotesListView.ALL
    val (store, state) = rememberList(ListViews.notesList(view = view, folderId = route.folderId, tagId = route.tagId), key = route)
    val list = state.value.list
    val grid = rememberLazyGridState()
    LaunchedEffect(store) {
        snapshotFlow { grid.layoutInfo.visibleItemsInfo.let { it.firstOrNull()?.index to it.lastOrNull()?.index } }.collect { (first, last) ->
            if (first != null && last != null) store.visibleRows(first..last)
        }
    }
    Column(Modifier.fillMaxSize()) {
        ScreenTitle(route.title)
        if (list.total == 0) {
            EmptyBox(if (state.value.status == com.folevi.engine.client.StoreStatus.LOADING) "Loading…" else "No notes here yet.")
            return
        }
        LazyVerticalGrid(
            columns = GridCells.Adaptive(minSize = 260.dp),
            state = grid,
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 96.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            items(count = list.total, key = { i -> list.order.getOrNull(i - list.start) ?: "slot$i" }) { i ->
                val row = list.rowAt(i)
                if (row != null) NoteCard(row, onClick = { open(NoteRoute(row.id, row.title)) })
                else Spacer(Modifier.height(120.dp))
            }
        }
    }
}

@OptIn(FlowPreview::class)
@Composable
fun SearchScreen(open: (Route) -> Unit) {
    val session = LocalSession.current
    var text by remember { mutableStateOf("") }
    var result by remember { mutableStateOf<SearchValue?>(null) }
    LaunchedEffect(Unit) {
        snapshotFlow { text }.debounce(200).collect { q ->
            result = if (q.isBlank()) null else runCatching { session.client.query(Views.search(text = q)) }.getOrNull()
        }
    }
    Column(Modifier.fillMaxSize()) {
        ScreenTitle("Search")
        OutlinedTextField(
            value = text,
            onValueChange = { text = it },
            placeholder = { Text("Search notes") },
            leadingIcon = { FoleviIcon(WebIcon.SEARCH, null) },
            singleLine = true,
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
        )
        LazyColumn(contentPadding = PaddingValues(bottom = 96.dp)) {
            items(result?.hits.orEmpty(), key = { it.id + (it.blockId ?: "") }) { h ->
                ListItem(
                    headlineContent = { Text(h.title.ifEmpty { "Untitled" }) },
                    supportingContent = { Text(h.snippet, maxLines = 2, overflow = TextOverflow.Ellipsis) },
                    leadingContent = { FoleviIcon(WebIcon.FILE_TEXT, null) },
                    colors = ListItemDefaults.colors(containerColor = Color.Transparent),
                    modifier = Modifier.clickable { open(NoteRoute(h.id, h.title)) },
                )
            }
        }
    }
}

@Composable
fun TasksScreen(open: (Route) -> Unit) {
    TaskList("Tasks", TaskViewName.TODAY, open)
}

@Composable
fun CalendarScreen(open: (Route) -> Unit) {
    TaskList("Calendar", TaskViewName.UPCOMING, open)
}

@Composable
private fun TaskList(title: String, view: TaskViewName, open: (Route) -> Unit) {
    val tasks by rememberView(Views.tasksList(view = view))
    val session = LocalSession.current
    val scope = rememberCoroutineScope()
    val p = LocalPalette.current
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 96.dp)) {
        item { ScreenTitle(title) }
        val v = tasks.value
        if (v == null || v.total == 0L) {
            item { EmptyBox(if (v == null) "Loading…" else "Nothing due.") }
        } else {
            for (g in v.groups) {
                item(key = "g" + g.id) { SectionTitle(g.title) }
                items(g.tasks, key = { it.id }) { t ->
                    ListItem(
                        headlineContent = { Text(t.title) },
                        supportingContent = { Text(listOfNotNull(t.noteTitle.takeIf { it.isNotBlank() }, t.dueDate, t.dueTime).joinToString(" · "), color = if (t.overdue) p.destructive else p.inkFaint) },
                        leadingContent = {
                            Checkbox(checked = t.status == "done", onCheckedChange = { on -> scope.launch { runCatching { session.client.command(Commands.taskUpdate(id = t.id, checked = on)) } } })
                        },
                        colors = ListItemDefaults.colors(containerColor = Color.Transparent),
                        modifier = Modifier.clickable { open(NoteRoute(t.noteId, t.noteTitle)) },
                    )
                }
            }
        }
    }
}

@Composable
fun AiScreen() {
    val convos by rememberView(Views.aiConversations())
    val p = LocalPalette.current
    Column(Modifier.fillMaxSize()) {
        ScreenTitle("Foli AI")
        val v = convos.value
        LazyColumn(Modifier.weight(1f), contentPadding = PaddingValues(bottom = 24.dp)) {
            val rows = v?.pinned.orEmpty() + v?.recent.orEmpty()
            if (rows.isEmpty()) item { EmptyBox("Ask Foli AI about your notes.") }
            items(rows, key = { it.id }) { c ->
                ListItem(
                    headlineContent = { Text(c.title.ifEmpty { "New conversation" }) },
                    supportingContent = { Text(shortDate(c.lastMessageAt), color = p.inkFaint) },
                    leadingContent = { FoleviIcon(if (c.pinned) WebIcon.PIN else WebIcon.MESSAGE_CIRCLE, null) },
                    colors = ListItemDefaults.colors(containerColor = Color.Transparent),
                )
                HorizontalDivider(color = p.line)
            }
        }
        val draft = rememberTextFieldState()
        Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            androidx.compose.material3.OutlinedTextField(state = draft, placeholder = { Text("Ask Foli AI") }, modifier = Modifier.weight(1f), lineLimits = androidx.compose.foundation.text.input.TextFieldLineLimits.SingleLine)
        }
    }
}
