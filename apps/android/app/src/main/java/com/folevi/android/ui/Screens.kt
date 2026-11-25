// Search, drawn from the engine's live views (protocol.ts). Home and the note lists are in HomeScreens.kt.
package com.folevi.android.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
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
import androidx.compose.runtime.saveable.rememberSaveable
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

@OptIn(FlowPreview::class)
@Composable
fun SearchScreen(open: (Route) -> Unit, onBack: (() -> Unit)? = null) {
    val session = LocalSession.current
    var text by rememberSaveable { mutableStateOf("") }
    var result by remember { mutableStateOf<SearchValue?>(null) }
    LaunchedEffect(Unit) {
        snapshotFlow { text }.debounce(200).collect { q ->
            result = if (q.isBlank()) null else runCatching { session.client.query(Views.search(text = q)) }.getOrNull()
        }
    }
    Column(Modifier.fillMaxSize()) {
        if (onBack != null) BigTitle("Search", navigation = { BackButton(onBack) }) else ScreenTitle("Search")
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

