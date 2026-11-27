// The note pane. The note page is the window's one Page View (the WebView that is also the engine): the pane asks
// the engine to show the note (`note.show`) and reports where it sits, and the activity lays the WebView there
// (MainActivity.placePage). The chrome is native and floats over the page as the web's phone layout draws it
// (apps/web/src/components/iphone/NoteChrome.tsx, NoteBars.tsx): a glass top bar with Back, the place chip,
// Share and the note's menu; two glass capsules at the bottom (Comments, Style, Format | Foli AI, Insert); the
// keyboard bar while writing; Format as a native sheet. Owner 2026-11-25: only the writing area is the web's.
package com.folevi.android.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
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
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.dropShadow
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.shadow.Shadow
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.DpOffset
import androidx.compose.ui.unit.dp
import com.folevi.android.design.AiMark
import com.folevi.android.design.FoleviIcon
import com.folevi.android.design.GlassCircle
import com.folevi.android.design.GlassPill
import com.folevi.android.design.GlassTextButton
import com.folevi.android.design.LocalPalette
import com.folevi.android.design.PhoneRadius
import com.folevi.android.design.PhoneType
import com.folevi.android.design.PillButton
import com.folevi.android.design.WebIcon
import com.folevi.android.design.foleviGlass
import com.folevi.android.design.phoneColors
import com.folevi.engine.generated.AiArgs
import com.folevi.engine.generated.BlockAlign
import com.folevi.engine.generated.Commands
import com.folevi.engine.generated.EditorBlock
import com.folevi.engine.generated.EditorCommands
import com.folevi.engine.generated.EditorMark
import com.folevi.engine.generated.EditorPanel
import com.folevi.engine.generated.EditorStateEvent
import com.folevi.engine.generated.EngineEvent
import com.folevi.engine.generated.NoteMenuAction
import com.folevi.engine.generated.NoteMeta
import com.folevi.engine.generated.TextStyleName
import com.folevi.engine.protocol.Patch
import kotlinx.coroutines.launch

/** What the chrome knows of the open note, live from the engine's events. */
class NoteChromeState(val id: String) {
    val meta: MutableState<NoteMeta?> = mutableStateOf(null)
    val editor: MutableState<EditorStateEvent?> = mutableStateOf(null)
    val panel: MutableState<EditorPanel?> = mutableStateOf(null)
}

@Composable
fun NoteScreen(route: NoteRoute, onBack: (() -> Unit)? = null) {
    val session = LocalSession.current
    val state = remember(route.id) { NoteChromeState(route.id) }
    LaunchedEffect(route.id) {
        runCatching { session.client.editor(EditorCommands.noteShow(id = route.id)) }
        runCatching { session.client.editor(EditorCommands.state()) }.getOrNull()?.let { if (it.noteId == null || it.noteId == route.id) state.editor.value = it }
    }
    LaunchedEffect(route.id) {
        session.client.events.collect { e ->
            when (e) {
                is EngineEvent.NoteMeta -> if (e.data.id == route.id) state.meta.value = e.data
                is EngineEvent.EditorState -> if (e.data.noteId == null || e.data.noteId == route.id) state.editor.value = e.data
                is EngineEvent.EditorPanel -> state.panel.value = e.data.panel
                else -> Unit
            }
        }
    }
    // The page's scroll (the bridge script reports it): past 96 the place chip gives way to the note's title.
    DisposableEffect(route.id) {
        session.pageScroll.value = 0
        onDispose { session.pageScroll.value = 0 }
    }
    // The page runs under the bars: it pads itself by what they cover (--native-inset-top/bottom).
    val writing = state.editor.value?.focused == true
    LaunchedEffect(writing) { runCatching { session.client.editor(EditorCommands.insets(top = 60.0, bottom = if (writing) 64.0 else 80.0)) } }
    val title = state.meta.value?.title?.takeIf { it.isNotBlank() } ?: route.title.ifEmpty { "Untitled" }
    PagePane(route.id) { NoteChrome(state, title, onBack) }
}

/** A web page the app doesn't draw natively yet, in the note pane. */
@Composable
fun WebPageScreen(route: PageRoute, onBack: (() -> Unit)? = null) {
    val session = LocalSession.current
    LaunchedEffect(route.route) { session.openRoute(route.route) }
    PagePane(route.route) { PageChrome(route.title, onBack) }
}

/** One of the web's own pages (`web.show`), in the note pane. */
@Composable
fun WebShowScreen(route: WebShowRoute, onBack: (() -> Unit)? = null) {
    val session = LocalSession.current
    LaunchedEffect(route.page) {
        com.folevi.engine.generated.WebPage.of(route.page)?.let { page -> runCatching { session.client.editor(EditorCommands.webShow(page = page)) } }
        runCatching { session.client.editor(EditorCommands.insets(top = 60.0, bottom = 0.0)) }
    }
    PagePane(route.page) { PageChrome(route.title, onBack) }
}

/** The note pane: reports its spot for the Page View and hands the chrome to the layer above the page. */
@Composable
private fun PagePane(key: String, chrome: @Composable () -> Unit) {
    val session = LocalSession.current
    val p = LocalPalette.current
    val latest = androidx.compose.runtime.rememberUpdatedState(chrome)
    DisposableEffect(key) {
        session.noteOverlay.value = { latest.value() }
        onDispose {
            session.noteSlot.value = null
            session.noteOverlay.value = null
        }
    }
    Box(
        Modifier.fillMaxSize().background(p.surface).onGloballyPositioned { session.noteSlot.value = it.boundsInRoot() },
        contentAlignment = Alignment.Center,
    ) {
        if (session.isDemo) {
            Text("The note editor runs in the page.\nDemo mode has no page.", color = p.inkMuted, style = PhoneType.body, textAlign = TextAlign.Center, modifier = Modifier.padding(32.dp))
        }
    }
}

/** A web page's chrome: Back and its title. */
@Composable
private fun PageChrome(title: String, onBack: (() -> Unit)?) {
    val p = LocalPalette.current
    Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 8.dp).height(44.dp), verticalAlignment = Alignment.CenterVertically) {
        if (onBack != null) GlassCircle(WebIcon.CHEVRON_LEFT, "Back", onBack) else Spacer(Modifier.size(44.dp))
        Text(title, style = PhoneType.headline, color = p.heading, maxLines = 1, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center, modifier = Modifier.weight(1f))
        Spacer(Modifier.size(44.dp))
    }
}

// ---------------------------------------------------------------- the note's chrome

@Composable
private fun NoteChrome(state: NoteChromeState, title: String, onBack: (() -> Unit)?) {
    val session = LocalSession.current
    val scope = rememberCoroutineScope()
    val editor = state.editor.value
    val meta = state.meta.value
    val panel = state.panel.value
    val writing = editor?.focused == true && editor.canEdit
    val canEdit = meta?.canEdit ?: editor?.canEdit ?: true
    val ai = rememberView(com.folevi.engine.generated.Views.session()).value.value?.capabilities?.ai == true
    var formatOpen by remember { mutableStateOf(false) }
    var linkOpen by remember { mutableStateOf(false) }
    // Insert is the native sheet (InsertSheet.kt), as on iPhone.
    var insertOpen by remember { mutableStateOf(false) }
    val run: (suspend () -> Unit) -> Unit = { block -> scope.launch { runCatching { block() } } }
    val togglePanel: (EditorPanel) -> Unit = { which -> run { if (panel == which) session.client.editor(EditorCommands.panelClose()) else session.client.editor(EditorCommands.panelOpen(panel = which)) } }
    Box(Modifier.fillMaxSize()) {
        // The bar's fade once the page has scrolled under it (the web's .iphone-bar on a page): the page's color,
        // solid to the bar's middle, then clear.
        val fade by androidx.compose.animation.core.animateFloatAsState(if (session.pageScroll.value > 0) 1f else 0f, com.folevi.android.design.Motion.fastEffects(), label = "bar-fade")
        if (fade > 0f) {
            val page = LocalPalette.current.surface
            Box(Modifier.fillMaxWidth().height(96.dp).alpha(fade).background(androidx.compose.ui.graphics.Brush.verticalGradient(0f to page.copy(alpha = 0.92f), 0.46f to page.copy(alpha = 0.92f), 1f to page.copy(alpha = 0f))))
        }
        // Top bar: Back, the place chip, Share and the menu (Done while writing).
        Row(
            Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 8.dp).height(44.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            if (onBack != null) GlassCircle(WebIcon.CHEVRON_LEFT, "Back", onBack)
            Box(Modifier.weight(1f), contentAlignment = Alignment.Center) {
                val collapsed = session.pageScroll.value == 2
                val chip by androidx.compose.animation.core.animateFloatAsState(if (collapsed) 0f else 1f, com.folevi.android.design.Motion.fastEffects(), label = "chip")
                if (chip > 0f) Box(Modifier.alpha(chip).graphicsLayer { translationY = (1f - chip) * -4.dp.toPx() }) { PlaceChip(meta, title) }
                if (chip < 1f) Text(title, style = PhoneType.headline, color = LocalPalette.current.heading, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.alpha(1f - chip))
            }
            if (writing) GlassTextButton("Done", onClick = { run { session.client.editor(EditorCommands.dismissKeyboard()) } })
            else NoteMenuPill(state, run)
        }
        // Bottom: the tools (not writing) or the keyboard bar (writing, no tool open).
        AnimatedVisibility(
            visible = !writing && editor?.focus != true,
            enter = fadeIn(com.folevi.android.design.Motion.fastEffects()),
            exit = fadeOut(com.folevi.android.design.Motion.fastEffects()),
            modifier = Modifier.align(Alignment.BottomCenter),
        ) {
            Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, bottom = 10.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                ToolCapsule {
                    ToolButton(WebIcon.MESSAGE_CIRCLE, "Comments", selected = panel == EditorPanel.COMMENTS) { togglePanel(EditorPanel.COMMENTS) }
                    if (canEdit) {
                        ToolButton(WebIcon.PAINTBRUSH, "Style", selected = panel == EditorPanel.STYLE) { togglePanel(EditorPanel.STYLE) }
                        ToolButton(WebIcon.TYPE, "Format", selected = formatOpen, iconSize = 24.dp) { formatOpen = true }
                    }
                }
                ToolCapsule {
                    if (ai) ToolButton(null, "Foli AI", selected = panel == EditorPanel.AI, content = { AiMark(26.dp) }) { run { session.client.editor(EditorCommands.ai(action = AiArgs.Action.OPEN)) } }
                    if (canEdit) ToolButton(null, "Insert", selected = insertOpen, content = { InsertDisc() }) { insertOpen = true }
                }
            }
        }
        AnimatedVisibility(
            visible = writing && panel == null && !formatOpen,
            enter = slideInVertically(com.folevi.android.design.Motion.defaultSpatial()) { it } + fadeIn(com.folevi.android.design.Motion.fastEffects()),
            exit = slideOutVertically(com.folevi.android.design.Motion.fastSpatial()) { it } + fadeOut(com.folevi.android.design.Motion.fastEffects()),
            modifier = Modifier.align(Alignment.BottomCenter),
        ) {
          Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.BottomCenter) {
            KeyboardBar(editor, ai, run, onFormat = { formatOpen = true }, onLink = { linkOpen = true }, onInsert = { insertOpen = true })
          }
        }
    }
    if (formatOpen) FormatSheet(editor, run, onLink = { linkOpen = true }) { formatOpen = false }
    if (insertOpen) InsertSheet(
        onDismiss = { insertOpen = false },
        onInsert = { kind -> run { session.client.editor(EditorCommands.insert(kind = kind)) } },
        scanner = androidx.compose.ui.platform.LocalContext.current.packageManager.hasSystemFeature(android.content.pm.PackageManager.FEATURE_CAMERA_ANY),
        stockPhotos = rememberView(com.folevi.engine.generated.Views.session()).value.value?.mode?.value != "local",
    )
    if (linkOpen) LinkDialog(editing = editor?.link == true, onDismiss = { linkOpen = false }) { href -> linkOpen = false; run { session.client.editor(EditorCommands.link(href = href)) } }
}

/** The place chip: the nearest parent page, or the folder (Drafts with neither), in a 32 glass capsule. */
@Composable
private fun PlaceChip(meta: NoteMeta?, title: String) {
    val p = LocalPalette.current
    val parent = meta?.breadcrumbs?.lastOrNull()
    val label = parent?.title?.ifBlank { "Untitled" } ?: meta?.folder?.name ?: if (meta != null) "Drafts" else title
    val icon = when {
        parent != null -> WebIcon.FILE_TEXT
        meta?.folder != null -> WebIcon.FOLDER
        else -> WebIcon.INBOX
    }
    Row(
        Modifier.widthIn(max = 220.dp).heightIn(min = 32.dp).foleviGlass(CircleShape).padding(start = 10.dp, end = 8.dp).semantics { contentDescription = "In $label" },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        FoleviIcon(icon, null, size = 15.dp, tint = meta?.folder?.let { com.folevi.android.design.folderColor(it.color) } ?: p.inkMuted)
        Text(label, style = PhoneType.footnote.copy(fontWeight = FontWeight.Medium), color = p.ink, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
        FoleviIcon(WebIcon.CHEVRON_RIGHT, null, size = 13.dp, tint = p.inkFaint)
    }
}

/** Share and the note's "…" menu, offering only what the engine says this note takes. */
@Composable
private fun NoteMenuPill(state: NoteChromeState, run: (suspend () -> Unit) -> Unit) {
    val session = LocalSession.current
    val p = LocalPalette.current
    val menuState = state.editor.value?.menu
    val meta = state.meta.value
    val offered = menuState?.actions.orEmpty().toSet()
    var open by remember { mutableStateOf(false) }
    val menu: (NoteMenuAction) -> Unit = { a -> open = false; run { session.client.editor(EditorCommands.noteMenu(action = a)) } }
    GlassPill {
        if (NoteMenuAction.SHARE in offered) PillButton("Share", onClick = { menu(NoteMenuAction.SHARE) }) { FoleviIcon(WebIcon.SHARE, null, size = 20.dp, tint = p.ink) }
        Box {
            PillButton("More", onClick = { open = true }) { FoleviIcon(WebIcon.ELLIPSIS, null, size = 24.dp, tint = p.ink) }
            PhoneMenu(open, { open = false }) {
                val id = state.id
                if (meta?.inTrash == true) {
                    MenuItem("Restore", WebIcon.ROTATE_CCW) { open = false; run { session.client.command(Commands.noteRestore(ids = listOf(id))) } }
                    MenuItem("Delete permanently…", WebIcon.TRASH, destructive = true) { open = false; run { session.client.command(Commands.noteDeleteForever(ids = listOf(id))) } }
                    return@PhoneMenu
                }
                val starred = meta?.starred == true
                MenuItem(if (starred) "Remove bookmark" else "Bookmark", if (starred) WebIcon.BOOKMARK_OFF else WebIcon.BOOKMARK) { open = false; run { session.client.command(Commands.noteStar(ids = listOf(id), starred = !starred)) } }
                MenuItem("Comments", WebIcon.MESSAGE_CIRCLE) { open = false; run { session.client.editor(EditorCommands.panelOpen(panel = EditorPanel.COMMENTS)) } }
                MenuItem("Info", WebIcon.INFO) { open = false; run { session.client.editor(EditorCommands.panelOpen(panel = EditorPanel.INFO)) } }
                if (NoteMenuAction.FIND in offered) MenuItem("Find in note…", WebIcon.SEARCH) { menu(NoteMenuAction.FIND) }
                if (NoteMenuAction.READ_IMAGES in offered && (menuState?.readImages ?: 0) > 0) MenuItem("Make text in images searchable", WebIcon.IMAGE, enabled = menuState?.readingImages != true) { menu(NoteMenuAction.READ_IMAGES) }
                if (menuState?.related == true) MenuItem("Related notes", WebIcon.WAYPOINTS) { open = false; run { session.client.editor(EditorCommands.panelOpen(panel = EditorPanel.RELATED)) } }
                HorizontalDivider(color = phoneColors().separator)
                if (NoteMenuAction.HISTORY in offered) MenuItem("Version history…", WebIcon.ROTATE_CCW) { menu(NoteMenuAction.HISTORY) }
                if (NoteMenuAction.SHOW_EDITORS in offered) MenuItem(if (menuState?.showingEditors == true) "Hide editors" else "Show editors", WebIcon.USERS) { menu(NoteMenuAction.SHOW_EDITORS) }
                if (NoteMenuAction.MOVE in offered) MenuItem("Move…", WebIcon.FOLDER_INPUT) { menu(NoteMenuAction.MOVE) }
                if (NoteMenuAction.COPY_TO in offered) MenuItem("Copy to…", WebIcon.COPY) { menu(NoteMenuAction.COPY_TO) }
                if (NoteMenuAction.DUPLICATE in offered) MenuItem("Duplicate", WebIcon.COPY) { menu(NoteMenuAction.DUPLICATE) }
                if (NoteMenuAction.MOVE_TO_VAULT in offered) MenuItem("Move to the Vault…", WebIcon.LOCK_KEYHOLE) { menu(NoteMenuAction.MOVE_TO_VAULT) }
                if (NoteMenuAction.EXPORT in offered) MenuItem("Export…", WebIcon.DOWNLOAD) { menu(NoteMenuAction.EXPORT) }
                if (NoteMenuAction.PRESENT in offered) MenuItem("Present", WebIcon.PRESENTATION) { menu(NoteMenuAction.PRESENT) }
                if (NoteMenuAction.PRINT in offered) MenuItem("Print", WebIcon.PRINTER) { menu(NoteMenuAction.PRINT) }
                if (NoteMenuAction.SAVE_AS_TEMPLATE in offered) MenuItem("Save as template", WebIcon.LAYOUT_TEMPLATE) { menu(NoteMenuAction.SAVE_AS_TEMPLATE) }
                if (state.editor.value?.canLock == true) MenuItem("Always fully encrypted", WebIcon.LOCK, checked = state.editor.value?.locked == true) { open = false; run { session.client.editor(EditorCommands.noteLock()) } }
                HorizontalDivider(color = phoneColors().separator)
                val archived = meta?.archived == true
                MenuItem(if (archived) "Unarchive" else "Archive", if (archived) WebIcon.ARCHIVE_RESTORE else WebIcon.ARCHIVE) { open = false; run { session.client.command(Commands.noteArchive(ids = listOf(id), archived = !archived)) } }
                MenuItem("Move to Trash", WebIcon.TRASH, destructive = true) {
                    if (NoteMenuAction.DELETE in offered) menu(NoteMenuAction.DELETE) else { open = false; run { session.client.command(Commands.noteTrash(ids = listOf(id))) } }
                }
            }
        }
    }
}

/** A bottom tool capsule: 60 tall, 4 inside, 2 between buttons. */
@Composable
private fun ToolCapsule(content: @Composable RowScope.() -> Unit) {
    Row(Modifier.height(60.dp).foleviGlass(CircleShape).padding(4.dp), horizontalArrangement = Arrangement.spacedBy(2.dp), verticalAlignment = Alignment.CenterVertically, content = content)
}

@Composable
private fun ToolButton(icon: WebIcon?, label: String, selected: Boolean, iconSize: androidx.compose.ui.unit.Dp = 23.dp, content: (@Composable () -> Unit)? = null, onClick: () -> Unit) {
    val p = LocalPalette.current
    val c = phoneColors()
    Box(
        Modifier.size(52.dp).clip(CircleShape).background(if (selected) c.active else Color.Transparent).clickable(role = Role.Button, onClickLabel = label, onClick = onClick).semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) { if (content != null) content() else FoleviIcon(icon!!, null, size = iconSize, tint = p.ink) }
}

/** Insert's + : a 38 disc in the heading color. */
@Composable
private fun InsertDisc() {
    val p = LocalPalette.current
    Box(
        Modifier.size(38.dp).dropShadow(CircleShape, Shadow(radius = 6.dp, offset = DpOffset(0.dp, 2.dp), color = Color.Black.copy(alpha = 0.18f))).background(p.heading, CircleShape),
        contentAlignment = Alignment.Center,
    ) { FoleviIcon(WebIcon.PLUS, null, size = 22.dp, tint = p.canvas) }
}

/** The keyboard bar: one glass capsule of 44 keys above the keyboard, scrolling sideways, then Hide keyboard. */
@Composable
private fun KeyboardBar(editor: EditorStateEvent?, ai: Boolean, run: (suspend () -> Unit) -> Unit, onFormat: () -> Unit, onLink: () -> Unit, onInsert: () -> Unit) {
    val session = LocalSession.current
    val p = LocalPalette.current
    val e = { spec: com.folevi.engine.generated.EditorSpec<*, *> -> run { session.client.editor(spec) } }
    Row(
        Modifier.padding(start = 8.dp, end = 8.dp, bottom = 8.dp).widthIn(max = 480.dp).fillMaxWidth().height(48.dp).foleviGlass(CircleShape).padding(2.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Row(Modifier.weight(1f).horizontalScroll(rememberScrollState()), verticalAlignment = Alignment.CenterVertically) {
            Key(WebIcon.PLUS, "Insert", onClick = onInsert)
            Key(null, "Format", text = "Aa", onClick = onFormat)
            if (ai) Key(null, "Foli AI", content = { AiMark(22.dp) }) { e(EditorCommands.ai(action = AiArgs.Action.OPEN)) }
            val todo = editor?.block == "todo"
            Key(WebIcon.SQUARE_CHECK, "To-do", selected = todo) { e(EditorCommands.format(block = if (todo) EditorBlock.PARAGRAPH else EditorBlock.TODO)) }
            Key(WebIcon.LIST_INDENT_INCREASE, "Indent") { e(EditorCommands.indent()) }
            Key(WebIcon.LIST_INDENT_DECREASE, "Outdent") { e(EditorCommands.outdent()) }
            Key(WebIcon.LINK_2, if (editor?.link == true) "Edit link" else "Link", selected = editor?.link == true, onClick = onLink)
            Key(WebIcon.AT_SIGN, "Mention") { e(EditorCommands.insert(kind = "mention")) }
            Key(WebIcon.IMAGE, "Image") { e(EditorCommands.insert(kind = "image")) }
            Key(WebIcon.UNDO_2, "Undo", enabled = editor?.undo != false) { e(EditorCommands.undo()) }
            Key(WebIcon.REDO_2, "Redo", enabled = editor?.redo != false) { e(EditorCommands.redo()) }
        }
        Box(Modifier.width(1.dp).height(24.dp).background(phoneColors().separator))
        Key(WebIcon.CHEVRON_DOWN, "Hide keyboard", iconSize = 24.dp) { e(EditorCommands.dismissKeyboard()) }
    }
}

@Composable
private fun Key(icon: WebIcon?, label: String, text: String? = null, selected: Boolean = false, enabled: Boolean = true, iconSize: androidx.compose.ui.unit.Dp = 22.dp, content: (@Composable () -> Unit)? = null, onClick: () -> Unit) {
    val p = LocalPalette.current
    val ink = if (selected) p.canvas else p.ink
    Box(
        Modifier.size(44.dp).alpha(if (enabled) 1f else 0.3f).clip(CircleShape).background(if (selected) p.heading else Color.Transparent)
            .clickable(enabled = enabled, role = Role.Button, onClickLabel = label, onClick = onClick).semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) {
        when {
            content != null -> content()
            text != null -> Text(text, style = PhoneType.headline, color = ink)
            else -> FoleviIcon(icon!!, null, size = iconSize, tint = ink)
        }
    }
}

@Composable
private fun LinkDialog(editing: Boolean, onDismiss: () -> Unit, onDone: (String?) -> Unit) {
    val p = LocalPalette.current
    var href by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (editing) "Edit link" else "Add link") },
        text = { OutlinedTextField(href, { href = it }, label = { Text("Address") }, placeholder = { Text("https://") }, singleLine = true) },
        confirmButton = { TextButton(enabled = href.isNotBlank(), onClick = { onDone(href.trim()) }) { Text(if (editing) "Update" else "Link", color = p.ink) } },
        dismissButton = {
            Row {
                if (editing) TextButton(onClick = { onDone(null) }) { Text("Remove link", color = p.destructive) }
                TextButton(onClick = onDismiss) { Text("Cancel", color = p.ink) }
            }
        },
    )
}

// ---------------------------------------------------------------- Format

/** The text colors and highlights the web offers (FormatPanel.tsx). */
private val TEXT_COLORS = listOf(null to "Default", "muted" to "Muted", "accent" to "Accent", "moss" to "Moss", "marigold" to "Marigold", "plum" to "Plum", "coral" to "Coral")
private val HIGHLIGHTS = listOf(null to "None", "yellow" to "Yellow", "green" to "Green", "blue" to "Blue", "pink" to "Pink")

/** Format as a native sheet (the web's FormatPanel): text styles, marks, lists, indent, alignment, colors, rows. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun FormatSheet(editor: EditorStateEvent?, run: (suspend () -> Unit) -> Unit, onLink: () -> Unit, onDismiss: () -> Unit) {
    val session = LocalSession.current
    val p = LocalPalette.current
    val c = phoneColors()
    val f = editor?.format
    val e = { spec: com.folevi.engine.generated.EditorSpec<*, *> -> run { session.client.editor(spec) } }
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = c.solid,
        shape = androidx.compose.foundation.shape.RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp),
        scrimColor = Color.Black.copy(alpha = 0.10f),
    ) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(start = 16.dp, end = 16.dp, bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("Format", style = PhoneType.headline, color = p.heading, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
            // Text styles.
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                for ((style, label) in listOf(TextStyleName.TITLE to "Title", TextStyleName.SUBTITLE to "Subtitle", TextStyleName.HEADING to "Heading", TextStyleName.STRONG to "Strong", TextStyleName.BODY to "Body", TextStyleName.CAPTION to "Caption")) {
                    val on = f?.textStyle == style
                    Box(
                        Modifier.widthIn(min = 72.dp).heightIn(min = 56.dp).clip(PhoneRadius.panel).background(if (on) p.heading else c.ink(0.055f))
                            .clickable(role = Role.Button, onClickLabel = label) { e(EditorCommands.formatSet(textStyle = style)) }.padding(horizontal = 12.dp),
                        contentAlignment = Alignment.Center,
                    ) { Text(label, style = styleSample(style), color = if (on) p.canvas else p.ink) }
                }
            }
            // Marks and lists, indent and alignment.
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Group(Modifier.weight(1f)) {
                    for ((mark, icon) in listOf(EditorMark.BOLD to WebIcon.BOLD, EditorMark.ITALIC to WebIcon.ITALIC, EditorMark.UNDERLINE to WebIcon.UNDERLINE, EditorMark.STRIKE to WebIcon.STRIKETHROUGH, EditorMark.CODE to WebIcon.CODE_XML)) {
                        GroupKey(icon, mark.value, selected = editor?.marks?.contains(mark) == true) { e(EditorCommands.format(mark = mark)) }
                    }
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Group(Modifier.weight(1.3f)) {
                    for ((block, icon) in listOf(EditorBlock.TODO to WebIcon.LIST_TODO, EditorBlock.TOGGLE to WebIcon.CHEVRONS_DOWN_UP, EditorBlock.BULLETED to WebIcon.LIST, EditorBlock.NUMBERED to WebIcon.LIST_ORDERED)) {
                        val on = editor?.block == block.value
                        GroupKey(icon, block.value, selected = on) { e(EditorCommands.format(block = if (on) EditorBlock.PARAGRAPH else block)) }
                    }
                }
                Group(Modifier.weight(0.7f)) {
                    GroupKey(WebIcon.LIST_INDENT_DECREASE, "Outdent") { e(EditorCommands.outdent()) }
                    GroupKey(WebIcon.LIST_INDENT_INCREASE, "Indent") { e(EditorCommands.indent()) }
                }
            }
            if (f?.blockTools != false) Group(Modifier.fillMaxWidth()) {
                for ((align, icon) in listOf(BlockAlign.LEFT to WebIcon.TEXT_ALIGN_START, BlockAlign.CENTER to WebIcon.TEXT_ALIGN_CENTER, BlockAlign.RIGHT to WebIcon.TEXT_ALIGN_END, BlockAlign.JUSTIFY to WebIcon.TEXT_ALIGN_JUSTIFY)) {
                    GroupKey(icon, "Align ${align.value}", selected = f?.align == align) { e(EditorCommands.formatSet(align = align)) }
                }
            }
            // Text color and highlight.
            Group(Modifier.fillMaxWidth()) {
                for ((key, label) in TEXT_COLORS) {
                    GroupKey(null, "Text color $label", selected = f?.textColor == key, content = { Text("A", style = PhoneType.headline, color = textColor(key)) }) {
                        e(EditorCommands.formatSet(textColor = key?.let { Patch.Set(it) } ?: Patch.Clear))
                    }
                }
            }
            Group(Modifier.fillMaxWidth()) {
                for ((key, label) in HIGHLIGHTS) {
                    GroupKey(null, "Highlight $label", selected = f?.highlight == key, content = {
                        Box(Modifier.size(18.dp).clip(CircleShape).background(highlightColor(key) ?: Color.Transparent).border(1.dp, c.separator, CircleShape))
                    }) { e(EditorCommands.formatSet(highlight = key?.let { Patch.Set(it) } ?: Patch.Clear)) }
                }
            }
            // Rows.
            Column(Modifier.fillMaxWidth().clip(PhoneRadius.container).background(c.ink(0.05f))) {
                FormatRow(WebIcon.QUOTE, "Quote", editor?.block == "quote") { e(EditorCommands.format(block = if (editor?.block == "quote") EditorBlock.PARAGRAPH else EditorBlock.QUOTE)) }
                FormatRow(WebIcon.INFO, "Callout", editor?.block == "callout") { e(EditorCommands.format(block = if (editor?.block == "callout") EditorBlock.PARAGRAPH else EditorBlock.CALLOUT)) }
                FormatRow(WebIcon.CODE_XML, "Code block", editor?.block == "code") { e(EditorCommands.format(block = if (editor?.block == "code") EditorBlock.PARAGRAPH else EditorBlock.CODE)) }
                FormatRow(WebIcon.LINK_2, if (editor?.link == true) "Edit link" else "Link", false) { onDismiss(); onLink() }
                if (editor?.link == true) FormatRow(WebIcon.UNLINK, "Remove link", false) { e(EditorCommands.link(href = null)) }
                FormatRow(WebIcon.ERASER, "Clear formatting", false) { e(EditorCommands.formatSet(clear = true)) }
            }
        }
    }
}

@Composable
private fun Group(modifier: Modifier, content: @Composable RowScope.() -> Unit) {
    Row(modifier.clip(CircleShape).background(phoneColors().ink(0.055f)).padding(2.dp), horizontalArrangement = Arrangement.spacedBy(2.dp), content = content)
}

@Composable
private fun RowScope.GroupKey(icon: WebIcon?, label: String, selected: Boolean = false, content: (@Composable () -> Unit)? = null, onClick: () -> Unit) {
    val p = LocalPalette.current
    Box(
        Modifier.weight(1f).height(44.dp).clip(CircleShape).then(if (selected) Modifier.dropShadow(CircleShape, Shadow(radius = 3.dp, offset = DpOffset(0.dp, 1.dp), color = Color.Black.copy(alpha = 0.14f))).background(p.surfaceRaised, CircleShape) else Modifier)
            .clickable(role = Role.Button, onClickLabel = label, onClick = onClick).semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) { if (content != null) content() else FoleviIcon(icon!!, null, size = 20.dp, tint = p.ink) }
}

@Composable
private fun FormatRow(icon: WebIcon, label: String, on: Boolean, onClick: () -> Unit) {
    val p = LocalPalette.current
    Row(Modifier.fillMaxWidth().heightIn(min = 52.dp).clickable(role = Role.Button, onClick = onClick).padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.width(28.dp)) { FoleviIcon(icon, null, size = 20.dp, tint = p.inkMuted) }
        Spacer(Modifier.width(12.dp))
        Text(label, style = PhoneType.body, color = p.ink, modifier = Modifier.weight(1f))
        if (on) FoleviIcon(WebIcon.CHECK, "On", size = 18.dp, tint = p.heading)
    }
}

@Composable
private fun styleSample(style: TextStyleName) = when (style) {
    TextStyleName.TITLE -> PhoneType.title3.copy(fontFamily = com.folevi.android.design.Spectral, fontWeight = FontWeight.SemiBold)
    TextStyleName.SUBTITLE -> PhoneType.headline.copy(fontFamily = com.folevi.android.design.Spectral)
    TextStyleName.HEADING -> PhoneType.headline
    TextStyleName.STRONG -> PhoneType.subheadline.copy(fontWeight = FontWeight.SemiBold)
    TextStyleName.BODY -> PhoneType.subheadline
    TextStyleName.CAPTION -> PhoneType.footnote
}

@Composable
private fun textColor(key: String?): Color {
    val p = LocalPalette.current
    return when (key) {
        "muted" -> p.inkMuted
        "accent" -> p.accent
        "moss" -> p.moss
        "marigold" -> p.marigold
        "plum" -> p.plum
        "coral" -> p.coral
        else -> p.ink
    }
}

private fun highlightColor(key: String?): Color? = when (key) {
    "yellow" -> Color(0xFFFCE9A2)
    "green" -> Color(0xFFCDEBC9)
    "blue" -> Color(0xFFCFE1F7)
    "pink" -> Color(0xFFF6D2DE)
    else -> null
}
