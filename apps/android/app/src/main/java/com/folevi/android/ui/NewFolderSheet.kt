// "New folder" (iphone/NewFolderSheet.tsx): the name with a folder glyph in the chosen color, the web's 25
// colors (one picked at random and scrolled into view), where it goes ("Inside"), and Create, which opens it.
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
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
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
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.folevi.android.design.FoleviIcon
import com.folevi.android.design.LocalPalette
import com.folevi.android.design.PhoneRadius
import com.folevi.android.design.PhoneType
import com.folevi.android.design.WebIcon
import com.folevi.android.design.phoneColors
import com.folevi.engine.generated.Commands
import com.folevi.engine.generated.NotesListView
import com.folevi.engine.generated.Views
import com.folevi.engine.protocol.Patch
import kotlinx.coroutines.launch

/** The web's folder colors, in its order (NewFolderSheet.tsx). */
val FOLDER_SWATCHES: List<Pair<String, Long>> = listOf(
    "red" to 0xFFDF7777, "coral" to 0xFFE28D73, "orange" to 0xFFE4A772, "amber" to 0xFFE2BD73, "yellow" to 0xFFDFD177,
    "olive" to 0xFFC7CE88, "lime" to 0xFFB7D77F, "green" to 0xFF8BD185, "emerald" to 0xFF82D3A8, "teal" to 0xFF82D3C8,
    "cyan" to 0xFF7DCAD9, "sky" to 0xFF77B7DF, "blue" to 0xFF779DDF, "indigo" to 0xFF7D83D9, "violet" to 0xFF947DD9,
    "purple" to 0xFFAE81D5, "plum" to 0xFFC285D1, "magenta" to 0xFFD581CA, "pink" to 0xFFDF77AE, "rose" to 0xFFDD7892,
    "sand" to 0xFFC6B290, "clay" to 0xFFC1A195, "stone" to 0xFFB2ABA4, "sage" to 0xFFA6BA9C, "slate" to 0xFF9CA9BA,
)

/** The longest folder name the web takes. */
const val FOLDER_NAME_MAX = 80

/** A name the Create button may send: trimmed, not empty, at most [FOLDER_NAME_MAX]. */
fun folderNameOk(name: String): Boolean = name.trim().let { it.isNotEmpty() && it.length <= FOLDER_NAME_MAX }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NewFolderSheet(onDismiss: () -> Unit, open: (Route) -> Unit, parentId: String? = null) {
    val session = LocalSession.current
    val scope = rememberCoroutineScope()
    val p = LocalPalette.current
    val c = phoneColors()
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val tree by rememberView(Views.foldersTree())
    var name by rememberSaveable { mutableStateOf("") }
    var color by rememberSaveable { mutableStateOf(FOLDER_SWATCHES.random().first) }
    var inside by rememberSaveable { mutableStateOf(parentId) }
    var busy by remember { mutableStateOf(false) }
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
    val tint = Color(FOLDER_SWATCHES.first { it.first == color }.second)

    val create: () -> Unit = {
        if (folderNameOk(name) && !busy) {
            busy = true
            val title = name.trim()
            scope.launch {
                val made = runCatching { session.client.command(Commands.folderCreate(name = title, parentId = Patch.of(inside), color = Patch.Set(color))) }.getOrNull()
                busy = false
                if (made != null) {
                    onDismiss()
                    open(NotesRoute(NotesListView.FOLDER.value, title, folderId = made.id))
                }
            }
        }
    }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheet,
        containerColor = c.solid,
        shape = RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp),
        dragHandle = null,
    ) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).imePadding().padding(bottom = 16.dp)) {
            SheetTitle("New folder", onDismiss)
            Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Title", style = PhoneType.footnote, color = p.inkMuted)
                Row(
                    Modifier.fillMaxWidth().clip(PhoneRadius.panel).background(c.ink(0.06f)).padding(horizontal = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    FoleviIcon(WebIcon.FOLDER, null, size = 22.dp, tint = tint)
                    Box(Modifier.weight(1f).height(48.dp), contentAlignment = Alignment.CenterStart) {
                        if (name.isEmpty()) Text("Folder name", style = PhoneType.body, color = p.inkFaint)
                        BasicTextField(
                            name, { if (it.length <= FOLDER_NAME_MAX) name = it },
                            singleLine = true,
                            textStyle = PhoneType.body.copy(color = p.ink),
                            cursorBrush = SolidColor(p.accent),
                            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, imeAction = ImeAction.Done),
                            keyboardActions = KeyboardActions(onDone = { create() }),
                            modifier = Modifier.fillMaxWidth().focusRequester(focus).semantics { contentDescription = "Folder name" },
                        )
                    }
                }
                Spacer(Modifier.height(8.dp))
                Text("Color", style = PhoneType.footnote, color = p.inkMuted)
            }
            val row = rememberLazyListState()
            LaunchedEffect(Unit) {
                val i = FOLDER_SWATCHES.indexOfFirst { it.first == color }
                if (i > 2) row.scrollToItem((i - 3).coerceAtLeast(0))
            }
            LazyRow(state = row, contentPadding = PaddingValues(horizontal = 10.dp)) {
                itemsIndexed(FOLDER_SWATCHES, key = { _, s -> s.first }) { _, (id, hex) ->
                    val on = id == color
                    Box(
                        Modifier.size(44.dp).clip(CircleShape).clickable(role = Role.RadioButton, onClickLabel = id) { color = id }.semantics { contentDescription = id; selected = on },
                        contentAlignment = Alignment.Center,
                    ) {
                        Box(
                            Modifier.size(38.dp).then(if (on) Modifier.border(2.dp, p.heading, CircleShape) else Modifier),
                            contentAlignment = Alignment.Center,
                        ) {
                            Box(Modifier.size(if (on) 30.dp else 34.dp).clip(CircleShape).background(Color(hex)).border(0.5.dp, Color.Black.copy(alpha = 0.16f), CircleShape), contentAlignment = Alignment.Center) {
                                if (on) FoleviIcon(WebIcon.CHECK, null, size = 17.dp, tint = Color(0xFF17171A))
                            }
                        }
                    }
                }
            }
            val folders = tree.value?.folders.orEmpty()
            if (folders.isNotEmpty()) {
                Text("Inside", style = PhoneType.footnote, color = p.inkMuted, modifier = Modifier.padding(start = 16.dp, top = 16.dp, bottom = 8.dp))
                Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp).clip(PhoneRadius.container).background(c.ink(0.04f))) {
                    InsideRow("Top level", 0, inside == null) { inside = null }
                    folders.forEach { f -> InsideRow(f.name, f.depth.toInt() + 1, inside == f.id) { inside = f.id } }
                }
            }
            Spacer(Modifier.height(20.dp))
            val ok = folderNameOk(name) && !busy
            Box(
                Modifier.fillMaxWidth().padding(horizontal = 16.dp).heightIn(min = 48.dp).clip(PhoneRadius.panel)
                    .background(if (ok) p.heading else c.ink(0.08f)).clickable(enabled = ok, role = Role.Button, onClick = create),
                contentAlignment = Alignment.Center,
            ) {
                Text("Create", style = PhoneType.headline, color = if (ok) p.canvas else p.inkFaint)
            }
        }
    }
}

@Composable
private fun InsideRow(label: String, depth: Int, selected: Boolean, onClick: () -> Unit) {
    val p = LocalPalette.current
    Row(
        Modifier.fillMaxWidth().heightIn(min = 44.dp).clickable(role = Role.RadioButton, onClick = onClick).padding(start = (16 + (depth - 1).coerceAtLeast(0) * 16).dp, end = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        FoleviIcon(if (depth == 0) WebIcon.HOUSE else WebIcon.FOLDER, null, size = 18.dp, tint = p.inkMuted)
        Spacer(Modifier.width(10.dp))
        Text(label, style = PhoneType.body.copy(fontWeight = if (selected) FontWeight.Medium else FontWeight.Normal), color = p.ink, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
        if (selected) FoleviIcon(WebIcon.CHECK, "Selected", size = 18.dp, tint = p.heading)
    }
}
