// Foli AI as the web's phone layout draws it (apps/web/src/components/ai/chat/ChatThread.tsx, ChatMessage.tsx and
// ConversationList.tsx in the iPhone branch): the tab is the composer, the suggestions and the conversations
// (Pinned, Recent); a chat shows your words in a soft bubble on the right and Foli AI's as plain text at 17/24,
// with the composer card at the bottom. Engine: ai.conversations, ai.conversation, ai.stream, ai.send and friends.
package com.folevi.android.ui

import androidx.compose.foundation.background
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
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.dropShadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.shadow.Shadow
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.DpOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.folevi.android.design.AiMark
import com.folevi.android.design.EmptyNote
import com.folevi.android.design.FoleviIcon
import com.folevi.android.design.FoleviPalette
import com.folevi.android.design.GlassCircle
import com.folevi.android.design.GlassPill
import com.folevi.android.design.ListRow
import com.folevi.android.design.LocalPalette
import com.folevi.android.design.PhoneRadius
import com.folevi.android.design.PhoneScreen
import com.folevi.android.design.PhoneType
import com.folevi.android.design.PillButton
import com.folevi.android.design.Placeholder
import com.folevi.android.design.RowGroup
import com.folevi.android.design.WebIcon
import com.folevi.android.design.phoneColors
import com.folevi.engine.generated.ChatConversationRow
import com.folevi.engine.generated.ChatMessage
import com.folevi.engine.generated.Commands
import com.folevi.engine.generated.Views
import kotlinx.coroutines.launch

/** The web phone's starters (ChatThread.tsx, "Suggestions"). */
internal val AI_SUGGESTIONS = listOf(
    "What did I write about this week?",
    "Summarize my notes on a topic",
    "Find my open to-dos",
    "Draft a note from my ideas",
)

/** A conversation's age as the web's list shows it ("now", "5m", "3h", "2d", or the date). */
internal fun ageText(ms: Double, now: Long = System.currentTimeMillis()): String {
    if (ms <= 0) return ""
    val mins = ((now - ms) / 60_000).toLong()
    return when {
        mins < 1 -> "now"
        mins < 60 -> "${mins}m"
        mins < 60 * 24 -> "${mins / 60}h"
        mins < 60 * 24 * 7 -> "${mins / (60 * 24)}d"
        else -> com.folevi.android.design.shortDate(ms)
    }
}

/** The Foli AI tab: the composer card, suggestions, then Pinned and Recent conversations. */
@Composable
fun AiHome(open: (Route) -> Unit) {
    val convos by rememberView(Views.aiConversations())
    val caps by rememberView(Views.aiCapabilities())
    val p = LocalPalette.current
    val v = convos.value
    val unavailable = caps.value?.unavailable
    PhoneScreen(
        title = "Foli AI",
        trailing = { GlassCircle(WebIcon.PEN_LINE, "New chat", { open(AiChatRoute(null)) }, iconSize = 21.dp) },
        header = {
            Column(Modifier.padding(start = 16.dp, end = 16.dp, top = 8.dp)) {
                ComposerCard(placeholder = "Ask Foli AI anything…", enabled = unavailable == null) { text -> open(AiChatRoute(null, first = text)) }
                Disclaimer()
            }
        },
    ) {
        if (unavailable != null) item(key = "unavailable") { EmptyNote(unavailableText(unavailable), Modifier.padding(top = 16.dp)) }
        val rows = v?.pinned.orEmpty() + v?.recent.orEmpty()
        if (v != null && rows.isEmpty() && unavailable == null) {
            item(key = "suggestions") { Suggestions { open(AiChatRoute(null, first = it)) } }
        }
        if (v == null) item(key = "loading") { Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) { repeat(3) { Placeholder(48.dp) } } }
        if (!v?.pinned.isNullOrEmpty()) {
            item(key = "pinned-h") { Caps("Pinned") }
            item(key = "pinned") { RowGroup { v!!.pinned.forEach { c -> ConversationRow(c) { open(AiChatRoute(c.id)) } } } }
        }
        if (!v?.recent.isNullOrEmpty()) {
            item(key = "recent-h") { Caps("Recent") }
            item(key = "recent") { RowGroup { v!!.recent.forEach { c -> ConversationRow(c) { open(AiChatRoute(c.id)) } } } }
        }
        if (v?.more == true) item(key = "more") {
            Text("Older conversations are on the web.", style = PhoneType.footnote, color = p.inkFaint, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(16.dp))
        }
    }
}

internal fun unavailableText(code: String): String = when (code) {
    "off" -> "Foli AI is turned off. Turn it on in Settings > Foli AI."
    "setup" -> "Foli AI needs a model on this device first. Set one up in Settings > Foli AI."
    "workspacePlan" -> "Foli AI isn't on this workspace's plan."
    else -> "Foli AI isn't on your plan."
}

@Composable
private fun Caps(text: String) {
    Text(text.uppercase(), style = PhoneType.eyebrow, color = LocalPalette.current.inkMuted, modifier = Modifier.padding(start = 20.dp, top = 24.dp, bottom = 6.dp))
}

@Composable
private fun ConversationRow(c: ChatConversationRow, onClick: () -> Unit) {
    ListRow(
        c.title.ifEmpty { "New conversation" },
        onClick = onClick,
        icon = if (c.pinned) WebIcon.PIN else WebIcon.MESSAGE_CIRCLE,
        detail = ageText(c.lastMessageAt),
    )
}

/** "Suggestions": rows with a message bubble at 18, callout text. */
@Composable
private fun Suggestions(send: (String) -> Unit) {
    val p = LocalPalette.current
    Column(Modifier.padding(start = 20.dp, end = 20.dp, top = 20.dp)) {
        Text("Suggestions", style = PhoneType.headline, color = p.heading)
        Spacer(Modifier.height(4.dp))
        AI_SUGGESTIONS.forEach { s ->
            Row(
                Modifier.fillMaxWidth().heightIn(min = 44.dp).clip(PhoneRadius.control).clickable(role = Role.Button) { send(s) }.padding(vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                FoleviIcon(WebIcon.MESSAGE_CIRCLE, null, size = 18.dp, tint = p.inkMuted)
                Text(s, style = PhoneType.callout, color = p.ink)
            }
        }
        Spacer(Modifier.height(16.dp))
        Text(
            "Answers link to the notes they come from. Foli AI shows you any change before it makes it, and each request uses AI credits.",
            style = PhoneType.subheadline,
            color = p.inkMuted,
        )
    }
}

/** The composer (the web's .iphone-composer): a 28-cornered card on the surface with its soft shadow. */
@Composable
private fun ComposerCard(placeholder: String, enabled: Boolean = true, working: Boolean = false, onStop: (() -> Unit)? = null, onSend: (String) -> Unit) {
    val p = LocalPalette.current
    val dark = p == FoleviPalette.Dark
    var text by rememberSaveable { mutableStateOf("") }
    val shape = RoundedCornerShape(28.dp)
    Column(
        Modifier.fillMaxWidth()
            .dropShadow(shape, Shadow(radius = 24.dp, spread = (-10).dp, offset = DpOffset(0.dp, 8.dp), color = Color.Black.copy(alpha = if (dark) 0.6f else 0.25f)))
            .clip(shape).background(if (dark) p.surfaceRaised else p.surface),
    ) {
        Box(Modifier.fillMaxWidth().heightIn(min = 48.dp).padding(start = 16.dp, end = 16.dp, top = 10.dp, bottom = 4.dp)) {
            if (text.isEmpty()) Text(placeholder, style = PhoneType.body.copy(lineHeight = 24.sp), color = p.inkFaint)
            BasicTextField(
                text,
                { if (it.length <= 4000) text = it },
                enabled = enabled,
                textStyle = PhoneType.body.copy(lineHeight = 24.sp, color = p.ink),
                cursorBrush = SolidColor(p.accent),
                maxLines = 6,
                modifier = Modifier.fillMaxWidth().semantics { contentDescription = "Ask about your notes, or ask Foli AI to change them" },
            )
        }
        Row(Modifier.fillMaxWidth().padding(start = 10.dp, end = 10.dp, bottom = 10.dp), horizontalArrangement = Arrangement.End) {
            if (working && onStop != null) SendButton(WebIcon.SQUARE, "Stop", enabled = true, onClick = onStop)
            else SendButton(WebIcon.ARROW_UP, "Ask", enabled = enabled && text.isNotBlank()) { val t = text.trim(); text = ""; onSend(t) }
        }
    }
}

/** The web's SendButton: a 34 circle in the heading color with the page's color on it, in a 44 target. */
@Composable
private fun SendButton(icon: WebIcon, label: String, enabled: Boolean, onClick: () -> Unit) {
    val p = LocalPalette.current
    Box(
        Modifier.size(44.dp).clip(CircleShape).clickable(enabled = enabled, role = Role.Button, onClickLabel = label, onClick = onClick).semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) {
        Box(Modifier.size(34.dp).alpha(if (enabled) 1f else 0.3f).clip(CircleShape).background(p.heading), contentAlignment = Alignment.Center) {
            FoleviIcon(icon, null, size = if (icon == WebIcon.SQUARE) 14.dp else 19.dp, tint = p.canvas)
        }
    }
}

@Composable
private fun Disclaimer() {
    Text(
        "Foli AI can make mistakes.",
        style = PhoneType.footnote,
        color = LocalPalette.current.inkFaint,
        textAlign = TextAlign.Center,
        modifier = Modifier.fillMaxWidth().padding(top = 8.dp, start = 16.dp, end = 16.dp),
    )
}

// ---------------------------------------------------------------- a chat

/** One chat. A new chat sends its first message when it opens; replies stream in through `ai.stream`. */
@Composable
fun AiChatScreen(route: AiChatRoute, onBack: (() -> Unit)?) {
    val session = LocalSession.current
    val scope = rememberCoroutineScope()
    val p = LocalPalette.current
    var id by rememberSaveable(route) { mutableStateOf(route.id) }
    var error by remember { mutableStateOf<String?>(null) }
    var menu by remember { mutableStateOf(false) }
    var renaming by remember { mutableStateOf(false) }
    var deleting by remember { mutableStateOf(false) }
    val run: (suspend () -> Unit) -> Unit = { block -> scope.launch { runCatching { block() }.onFailure { error = it.message } } }
    fun send(text: String) {
        scope.launch {
            runCatching { session.client.command(Commands.aiSend(conversationId = id, text = text)) }
                .onSuccess { id = it.conversationId; error = null }
                .onFailure { error = it.message }
        }
    }
    LaunchedEffect(route) { if (route.id == null && !route.first.isNullOrBlank()) send(route.first) }
    val cid = id
    val chat = if (cid != null) rememberView(Views.aiConversation(conversationId = cid), key = cid).value.value else null
    val messages = chat?.messages.orEmpty()
    val live = messages.lastOrNull()?.takeIf { it.live }
    val title = chat?.conversation?.title?.takeIf { it.isNotBlank() } ?: "Foli AI"
    Column(Modifier.fillMaxSize().background(p.canvas).imePadding()) {
        // The bar: Back, the title, the conversation's menu.
        Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 8.dp).height(44.dp), verticalAlignment = Alignment.CenterVertically) {
            if (onBack != null) GlassCircle(WebIcon.CHEVRON_LEFT, "Back", onBack) else Spacer(Modifier.size(44.dp))
            Text(title, style = PhoneType.headline, color = p.heading, maxLines = 1, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center, modifier = Modifier.weight(1f).padding(horizontal = 8.dp))
            if (cid != null && chat?.found == true) {
                Box {
                    GlassPill { PillButton("Conversation actions", onClick = { menu = true }) { FoleviIcon(WebIcon.ELLIPSIS, null, size = 24.dp, tint = p.ink) } }
                    PhoneMenu(menu, { menu = false }) {
                        val pinned = chat.conversation?.pinned == true
                        MenuItem(if (pinned) "Unpin" else "Pin", if (pinned) WebIcon.PIN_OFF else WebIcon.PIN) { menu = false; run { session.client.command(Commands.aiPin(conversationId = cid, pinned = !pinned)) } }
                        MenuItem("Rename…", WebIcon.PENCIL) { menu = false; renaming = true }
                        MenuItem("Save as note", WebIcon.FILE_TEXT) { menu = false; run { session.client.command(Commands.aiSaveAsNote(conversationId = cid)) } }
                        HorizontalDivider(color = phoneColors().separator)
                        MenuItem("Delete", WebIcon.TRASH, destructive = true) { menu = false; deleting = true }
                    }
                }
            } else Spacer(Modifier.size(44.dp))
        }
        Box(Modifier.weight(1f)) {
            if (cid == null) {
                Column(Modifier.fillMaxSize().padding(top = 40.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    AiMark(36.dp)
                    Text("Ask anything about your notes.", style = PhoneType.body, color = p.inkMuted)
                }
            } else {
                Messages(messages, onRegenerate = { run { session.client.command(Commands.aiRegenerate(conversationId = cid)) } }, onSuggestion = ::send)
            }
        }
        error?.let { Text(it, style = PhoneType.footnote, color = p.destructive, modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp)) }
        Column(Modifier.padding(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 12.dp)) {
            ComposerCard(
                placeholder = if (messages.isEmpty()) "Ask Foli AI anything…" else "Ask a follow-up…",
                working = live != null,
                onStop = live?.let { m -> { run { session.client.command(Commands.aiStop(messageId = m.id)) } } },
            ) { send(it) }
            Disclaimer()
        }
    }
    if (renaming && cid != null) RenameDialog(title, onDismiss = { renaming = false }) { t -> renaming = false; run { session.client.command(Commands.aiRename(conversationId = cid, title = t)) } }
    if (deleting && cid != null) AlertDialog(
        onDismissRequest = { deleting = false },
        title = { Text("Delete this conversation?") },
        text = { Text("It's removed for good.") },
        confirmButton = { TextButton(onClick = { deleting = false; run { session.client.command(Commands.aiRemove(conversationId = cid)) }; onBack?.invoke() }) { Text("Delete", color = p.destructive) } },
        dismissButton = { TextButton(onClick = { deleting = false }) { Text("Cancel", color = p.ink) } },
    )
}

@Composable
private fun Messages(messages: List<ChatMessage>, onRegenerate: () -> Unit, onSuggestion: (String) -> Unit) {
    val list = rememberLazyListState()
    LaunchedEffect(messages.size) { if (messages.isNotEmpty()) list.animateScrollToItem(messages.lastIndex) }
    LazyColumn(Modifier.fillMaxSize(), state = list, contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        items(messages, key = { it.id }) { m ->
            if (m.role == ChatMessage.Role.USER) UserMessage(m.text)
            else Answer(m, last = m == messages.last(), onRegenerate = onRegenerate, onSuggestion = onSuggestion)
        }
    }
}

/** Your words: right, ink 7%, radius 18, body at 17/24 (ChatMessage.tsx's iPhone branch). */
@Composable
private fun UserMessage(text: String) {
    val p = LocalPalette.current
    androidx.compose.foundation.layout.BoxWithConstraints(Modifier.fillMaxWidth(), contentAlignment = Alignment.CenterEnd) {
        Text(
            text,
            style = PhoneType.body.copy(lineHeight = 24.sp),
            color = p.ink,
            modifier = Modifier.widthIn(max = maxWidth * 0.85f).clip(PhoneRadius.container).background(phoneColors().ink(0.07f)).padding(horizontal = 16.dp, vertical = 10.dp),
        )
    }
}

/** Foli AI's answer: plain text at 17/24, what it's doing while it streams, the sources, then Copy and Retry. */
@Composable
private fun Answer(m: ChatMessage, last: Boolean, onRegenerate: () -> Unit, onSuggestion: (String) -> Unit) {
    val p = LocalPalette.current
    val c = phoneColors()
    val streamed = if (m.live) rememberView(Views.aiStream(messageId = m.id), key = m.id).value.value?.text else null
    val text = streamed ?: m.text
    val clipboard = LocalClipboardManager.current
    Column(Modifier.fillMaxWidth().padding(horizontal = 4.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (m.live && text.isBlank()) {
            Row(Modifier.heightIn(min = 44.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                AiMark(16.dp)
                Text(m.phase ?: "Thinking…", style = PhoneType.subheadline, color = p.inkMuted)
            }
        } else {
            Text(simpleMarkdown(text), style = PhoneType.body.copy(lineHeight = 24.sp), color = p.ink)
        }
        m.error?.let { Text(it.message, style = PhoneType.subheadline, color = p.destructive) }
        if (m.citations.isNotEmpty()) {
            Column(Modifier.padding(top = 4.dp)) {
                HorizontalDivider(color = c.separator)
                Text("SOURCES", style = PhoneType.eyebrow, color = p.inkMuted, modifier = Modifier.padding(top = 10.dp, bottom = 6.dp))
                m.citations.forEach { cite ->
                    Row(
                        Modifier.padding(bottom = 6.dp).clip(PhoneRadius.chip).background(c.ink(0.05f)).padding(horizontal = 10.dp, vertical = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Text("${cite.n}", style = PhoneType.subheadline.copy(fontWeight = FontWeight.SemiBold), color = p.inkMuted)
                        FoleviIcon(WebIcon.FILE_TEXT, null, size = 12.dp, tint = p.inkMuted)
                        Text(cite.title.ifEmpty { "Untitled" }, style = PhoneType.subheadline, color = p.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
            }
        }
        if (!m.live && text.isNotBlank()) {
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                RowButton(WebIcon.COPY, "Copy") { clipboard.setText(AnnotatedString(text)) }
                if (last) RowButton(WebIcon.ROTATE_CW, "Retry", onClick = onRegenerate)
            }
        }
        if (last && !m.live && m.suggestions.isNotEmpty()) {
            Column {
                m.suggestions.forEach { s ->
                    Row(
                        Modifier.fillMaxWidth().heightIn(min = 44.dp).clip(PhoneRadius.control).clickable(role = Role.Button) { onSuggestion(s) },
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        FoleviIcon(WebIcon.MESSAGE_CIRCLE, null, size = 18.dp, tint = p.inkMuted)
                        Text(s, style = PhoneType.callout, color = p.ink)
                    }
                }
            }
        }
    }
}

/** A row button under an answer (the web's ai-row-btn): icon and footnote, muted. */
@Composable
private fun RowButton(icon: WebIcon, label: String, onClick: () -> Unit) {
    val p = LocalPalette.current
    Row(
        Modifier.heightIn(min = 36.dp).clip(PhoneRadius.chip).clickable(role = Role.Button, onClick = onClick).padding(horizontal = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        FoleviIcon(icon, null, size = 14.dp, tint = p.inkMuted)
        Text(label, style = PhoneType.footnote, color = p.inkMuted)
    }
}

@Composable
private fun RenameDialog(current: String, onDismiss: () -> Unit, onDone: (String) -> Unit) {
    val p = LocalPalette.current
    var text by remember { mutableStateOf(current) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Rename conversation") },
        text = { OutlinedTextField(text, { text = it.take(120) }, singleLine = true) },
        confirmButton = { TextButton(enabled = text.isNotBlank(), onClick = { onDone(text.trim()) }) { Text("Rename", color = p.ink) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel", color = p.ink) } },
    )
}
