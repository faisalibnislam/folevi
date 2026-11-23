// The note pane. The note page itself is the window's one Page View (the WebView that is also the engine): the
// pane asks the engine to show the note (`note.show`) and reports where it sits, and the activity lays the
// WebView over that spot (MainActivity.placePage). Native draws the bar above it, as the iPhone app does.
package com.folevi.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.folevi.android.design.LocalPalette
import com.folevi.engine.generated.EditorCommands

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NoteScreen(route: NoteRoute) {
    val session = LocalSession.current
    val p = LocalPalette.current
    LaunchedEffect(route.id) { runCatching { session.client.editor(EditorCommands.noteShow(id = route.id)) } }
    DisposableEffect(route.id) { onDispose { session.noteSlot.value = null } }
    Column(Modifier.fillMaxSize().background(p.surface)) {
        TopAppBar(
            title = { Text(route.title.ifEmpty { "Untitled" }, maxLines = 1, overflow = TextOverflow.Ellipsis) },
            colors = TopAppBarDefaults.topAppBarColors(containerColor = p.surface),
        )
        Box(
            Modifier
                .fillMaxWidth()
                .weight(1f)
                .onGloballyPositioned { session.noteSlot.value = it.boundsInRoot() },
            contentAlignment = Alignment.Center,
        ) {
            if (session.isDemo) {
                Text(
                    "The note editor runs in the page.\nDemo mode has no page.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(32.dp),
                    style = MaterialTheme.typography.bodyLarge,
                )
            } else {
                Box(Modifier.fillMaxSize().background(Color.Transparent))
            }
        }
    }
}
