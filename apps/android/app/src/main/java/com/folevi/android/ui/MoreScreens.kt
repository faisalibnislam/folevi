// Foli AI's chat, Settings, Tasks with quick add and filters, and the Calendar month: the rest of the first
// build's native screens (docs/ANDROID_NATIVE_PLAN.md section 4). Data and writes go through the engine, as on
// iPhone; pages the iPhone also shows from the web (security, privacy, data, connected apps, deleting the
// account) open in the note pane through `web.show`.
package com.folevi.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.IconButton
import androidx.compose.material3.LargeTopAppBar
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.folevi.android.design.FoleviIcon
import com.folevi.android.design.LocalPalette
import com.folevi.android.design.WebIcon
import com.folevi.android.design.shortDate
import com.folevi.engine.generated.AppearanceSettings
import com.folevi.engine.generated.ChatMessage
import com.folevi.engine.generated.Commands
import com.folevi.engine.generated.SettingsUpdateArgs
import com.folevi.engine.generated.TaskRow
import com.folevi.engine.generated.TaskViewName
import com.folevi.engine.generated.Views
import java.time.LocalDate
import java.time.YearMonth
import java.time.format.TextStyle
import java.util.Locale
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BigTitle(title: String, navigation: (@Composable () -> Unit)? = null, actions: @Composable () -> Unit = {}) {
    LargeTopAppBar(
        title = { Text(title, maxLines = 1, overflow = TextOverflow.Ellipsis) },
        navigationIcon = { navigation?.invoke() },
        actions = { actions() },
        colors = TopAppBarDefaults.topAppBarColors(containerColor = Color.Transparent),
    )
}

@Composable
fun BackButton(onBack: () -> Unit) {
    IconButton(onClick = onBack) { FoleviIcon(WebIcon.CHEVRON_LEFT, "Back", size = 24.dp) }
}

// ---------------------------------------------------------------- Foli AI

/** Foli AI: the conversations, then a chat. The tab's own back stack holds the open chat. */
@Composable
fun AiHome(open: (Route) -> Unit) {
    val convos by rememberView(Views.aiConversations())
    val p = LocalPalette.current
    Column(Modifier.fillMaxSize()) {
        BigTitle("Foli AI") {
            IconButton(onClick = { open(AiChatRoute(null)) }) { FoleviIcon(WebIcon.MESSAGE_SQUARE_TEXT, "New chat") }
        }
        val v = convos.value
        val rows = v?.pinned.orEmpty() + v?.recent.orEmpty()
        LazyColumn(Modifier.weight(1f), contentPadding = PaddingValues(bottom = 24.dp)) {
            if (rows.isEmpty()) item { EmptyBox(if (v == null) "Loading…" else "Ask Foli AI about your notes, or to draft something new.") }
            items(rows, key = { it.id }) { c ->
                ListItem(
                    headlineContent = { Text(c.title.ifEmpty { "New conversation" }, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                    supportingContent = { Text(shortDate(c.lastMessageAt), color = p.inkFaint) },
                    leadingContent = { FoleviIcon(if (c.pinned) WebIcon.PIN else WebIcon.MESSAGE_CIRCLE, null) },
                    colors = ListItemDefaults.colors(containerColor = Color.Transparent),
                    modifier = Modifier.clickable { open(AiChatRoute(c.id)) },
                )
                HorizontalDivider(color = p.line)
            }
        }
        Composer("Ask Foli AI") { text -> open(AiChatRoute(null, first = text)) }
    }
}

/** One chat. A new chat sends its first message when it opens; replies stream in through `ai.stream`. */
@Composable
fun AiChatScreen(route: AiChatRoute, onBack: (() -> Unit)?) {
    val session = LocalSession.current
    val scope = rememberCoroutineScope()
    var id by rememberSaveable(route) { mutableStateOf(route.id) }
    var error by remember { mutableStateOf<String?>(null) }
    val p = LocalPalette.current
    fun send(text: String) {
        scope.launch {
            runCatching { session.client.command(Commands.aiSend(conversationId = id, text = text)) }
                .onSuccess { id = it.conversationId; error = null }
                .onFailure { error = it.message }
        }
    }
    LaunchedEffect(route) { if (route.id == null && !route.first.isNullOrBlank()) send(route.first) }
    Column(Modifier.fillMaxSize().imePadding()) {
        BigTitle("Foli AI", navigation = onBack?.let { { BackButton(it) } })
        Box(Modifier.weight(1f)) {
            val cid = id
            if (cid == null) EmptyBox("Ask anything about your notes.") else ChatMessages(cid)
        }
        error?.let { Text(it, color = p.destructive, modifier = Modifier.padding(horizontal = 16.dp)) }
        Composer("Message Foli AI") { send(it) }
    }
}

@Composable
private fun ChatMessages(conversationId: String) {
    val chat by rememberView(Views.aiConversation(conversationId = conversationId), key = conversationId)
    val messages = chat.value?.messages.orEmpty()
    val list = rememberLazyListState()
    LaunchedEffect(messages.size) { if (messages.isNotEmpty()) list.animateScrollToItem(messages.lastIndex) }
    LazyColumn(Modifier.fillMaxSize(), state = list, contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        items(messages, key = { it.id }) { m -> Bubble(m) }
    }
}

@Composable
private fun Bubble(m: ChatMessage) {
    val p = LocalPalette.current
    val mine = m.role == ChatMessage.Role.USER
    // A reply still being written streams its text through `ai.stream`.
    val streamed = if (m.live && !mine) rememberView(Views.aiStream(messageId = m.id), key = m.id).value.value?.text else null
    val text = streamed ?: m.text
    Row(Modifier.fillMaxWidth(), horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start) {
        Box(
            Modifier
                .widthIn(max = 560.dp)
                .clip(RoundedCornerShape(18.dp))
                .background(if (mine) p.accentSoft else p.surface)
                .border(1.dp, if (mine) Color.Transparent else p.line, RoundedCornerShape(18.dp))
                .padding(horizontal = 14.dp, vertical = 10.dp),
        ) {
            Text(text.ifEmpty { "…" }, style = MaterialTheme.typography.bodyLarge, color = if (mine) p.accentSoftInk else p.ink)
        }
    }
    m.error?.let { Text(it.message, color = p.destructive, style = MaterialTheme.typography.bodySmall) }
}

@Composable
fun Composer(placeholder: String, onSend: (String) -> Unit) {
    var text by rememberSaveable { mutableStateOf("") }
    Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
        OutlinedTextField(
            value = text,
            onValueChange = { text = it },
            placeholder = { Text(placeholder) },
            modifier = Modifier.weight(1f),
            maxLines = 5,
            shape = RoundedCornerShape(24.dp),
        )
        Spacer(Modifier.size(8.dp))
        FilledIconButton(onClick = { val t = text.trim(); if (t.isNotEmpty()) { onSend(t); text = "" } }, enabled = text.isNotBlank()) {
            FoleviIcon(WebIcon.ARROW_UP, "Send")
        }
    }
}

// Settings: SettingsScreens.kt.

// ---------------------------------------------------------------- Shared with me, Changes

@Composable
fun SharedScreen(open: (Route) -> Unit, onBack: (() -> Unit)?) {
    val shared by rememberView(Views.sharedList())
    val p = LocalPalette.current
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 96.dp)) {
        item { BigTitle("Shared with Me", navigation = onBack?.let { { BackButton(it) } }) }
        val rows = shared.value?.rows
        if (rows.isNullOrEmpty()) item { EmptyBox(if (rows == null) "Loading…" else "Notes people share with you show up here.") }
        items(rows.orEmpty(), key = { it.id }) { r ->
            ListItem(
                headlineContent = { Text(r.title.ifEmpty { "Untitled" }, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                supportingContent = { Text(listOfNotNull(r.sharedBy.takeIf { it.isNotBlank() }, r.workspaceName, shortDate(r.sharedAt)).joinToString(" · "), color = p.inkFaint) },
                leadingContent = { val icon = r.icon; if (icon != null) Text(icon) else FoleviIcon(WebIcon.USERS, null) },
                colors = ListItemDefaults.colors(containerColor = Color.Transparent),
                modifier = Modifier.clickable { open(NoteRoute(r.id, r.title)) },
            )
        }
    }
}

@Composable
fun ChangesScreen(open: (Route) -> Unit, onBack: (() -> Unit)?) {
    val changes by rememberView(Views.changes())
    val p = LocalPalette.current
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 96.dp)) {
        item { BigTitle("Changes", navigation = onBack?.let { { BackButton(it) } }) }
        val v = changes.value
        if (v == null || (v.notes.isEmpty() && v.proposals.isEmpty())) item { EmptyBox(if (v == null) "Loading…" else "What others change in your notes shows up here.") }
        if (!v?.proposals.isNullOrEmpty()) item { SectionTitle("Suggested") }
        items(v?.proposals.orEmpty(), key = { "p" + it.id }) { r ->
            ListItem(
                headlineContent = { Text(r.title) },
                supportingContent = { Text("${r.sourceName} · ${r.summary}", color = p.inkFaint, maxLines = 2, overflow = TextOverflow.Ellipsis) },
                leadingContent = { FoleviIcon(WebIcon.GIT_MERGE, null) },
                colors = ListItemDefaults.colors(containerColor = Color.Transparent),
                modifier = Modifier.clickable { r.noteId?.let { open(NoteRoute(it, r.title)) } },
            )
        }
        if (!v?.notes.isNullOrEmpty()) item { SectionTitle("Edited") }
        items(v?.notes.orEmpty(), key = { "n" + it.id }) { r ->
            ListItem(
                headlineContent = { Text(r.title.ifEmpty { "Untitled" }) },
                supportingContent = { Text("${r.who} · ${r.counts} · ${shortDate(r.changedAt)}", color = p.inkFaint) },
                leadingContent = { val icon = r.icon; if (icon != null) Text(icon) else FoleviIcon(WebIcon.FILE_DIFF, null) },
                colors = ListItemDefaults.colors(containerColor = Color.Transparent),
                modifier = Modifier.clickable { open(NoteRoute(r.id, r.title)) },
            )
        }
    }
}
