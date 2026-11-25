// The phone's floating bar, as the web's phone layout draws it (apps/web/src/components/iphone/TabBar.tsx): Home,
// Tasks and Calendar (icons) in one glass capsule on the left, Foli AI and + in another on the right. + opens New
// note, New folder and Quick task. Folevi's glass and shadows (design/Glass.kt), Android's ripple; the lens slides
// on the theme's spatial spring.
package com.folevi.android.ui

import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.DpOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.draw.dropShadow
import androidx.compose.ui.graphics.shadow.Shadow
import androidx.compose.ui.semantics.selected
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.offset
import androidx.compose.animation.core.animateDpAsState
import com.folevi.android.design.AiMark
import com.folevi.android.design.FoleviPalette
import com.folevi.android.design.foleviGlass
import com.folevi.android.design.FoleviIcon
import com.folevi.android.design.LocalPalette
import com.folevi.android.design.WebIcon
import com.folevi.engine.generated.Commands
import kotlinx.coroutines.launch

/** The tabs in the left capsule; Foli AI has its own button in the right one. */
internal val PHONE_TABS = listOf(Tab.HOME, Tab.TASKS, Tab.CALENDAR)

@Composable
fun PhoneBar(tab: Tab, pick: (Tab) -> Unit, newNote: () -> Unit, modifier: Modifier = Modifier) {
    // The web's padding: 16 at the sides and 10 at the bottom; on Android the bar stays above the gesture area
    // (the web tucks it 10 into the home indicator's, which here would take touches from the system Back and Home).
    val nav = WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()
    Row(
        modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 8.dp, bottom = maxOf(10.dp, nav)),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.Bottom,
    ) {
        Capsule(Modifier.testTag("phone-tabs").semantics { contentDescription = "Tabs" }, gap = 2.dp) {
            Box {
                // The current tab sits in a lens that slides to the tab you pick (64 wide, 2 apart), on a spring.
                val index = PHONE_TABS.indexOf(tab)
                if (index >= 0) {
                    val x by animateDpAsState(66.dp * index, MaterialTheme.motionScheme.fastSpatialSpec(), label = "lens")
                    Lens(Modifier.offset(x = x))
                }
                Row(horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                    for (t in PHONE_TABS) TabButton(t, selected = t == tab, onClick = { pick(t) })
                }
            }
        }
        Capsule(Modifier.testTag("phone-create").semantics { contentDescription = "Create" }, gap = 4.dp) {
            GlassButton("Foli AI", onClick = { pick(Tab.AI) }) {
                if (tab == Tab.AI) Lens(Modifier.size(56.dp))
                AiMark(26.dp)
            }
            if (tab == Tab.TASKS) {
                // On Tasks, + is a quick task straight away (as on the web).
                var asking by remember { mutableStateOf(false) }
                GlassButton("Quick task", onClick = { asking = true }) { PlusDisc() }
                if (asking) QuickTaskDialog { asking = false }
            } else {
                CreateMenu(newNote)
            }
        }
    }
}

/** A glass capsule of the bar (the web's .ui-liquid .iphone-tab-pill: 64 tall, 4 inside). */
@Composable
private fun Capsule(modifier: Modifier = Modifier, gap: Dp, content: @Composable () -> Unit) {
    Row(
        modifier.height(64.dp).foleviGlass(CircleShape).padding(4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(gap),
    ) { content() }
}

/** The web's lens: a faint fill with a light top edge (--liquid-lens). */
@Composable
private fun Lens(modifier: Modifier = Modifier) {
    val dark = LocalPalette.current == FoleviPalette.Dark
    Box(
        modifier.size(width = 64.dp, height = 56.dp).clip(CircleShape)
            .background(if (dark) Color.White.copy(alpha = 0.1f) else Color.Black.copy(alpha = 0.06f))
            .border(0.5.dp, Color.White.copy(alpha = if (dark) 0.08f else 0.35f), CircleShape),
    )
}

@Composable
private fun TabButton(t: Tab, selected: Boolean, onClick: () -> Unit) {
    val p = LocalPalette.current
    val ink by animateColorAsState(if (selected) p.heading else p.inkMuted, MaterialTheme.motionScheme.fastEffectsSpec(), label = "ink")
    Box(
        Modifier.size(width = 64.dp, height = 56.dp).clip(CircleShape)
            .clickable(role = Role.Tab, onClickLabel = t.label, onClick = onClick)
            .semantics { contentDescription = t.label; this.selected = selected }.testTag("tab-${t.name.lowercase()}"),
        contentAlignment = Alignment.Center,
    ) {
        FoleviIcon(t.icon, null, size = if (t == Tab.HOME) 24.dp else 23.dp, tint = ink)
    }
}

/** A round 56 button in the bar, with Android's ripple. */
@Composable
private fun GlassButton(label: String, onClick: () -> Unit, content: @Composable () -> Unit) {
    Box(
        Modifier.size(56.dp).clip(CircleShape).clickable(role = Role.Button, onClick = onClick)
            .semantics { contentDescription = label }.testTag("button-$label"),
        contentAlignment = Alignment.Center,
    ) { content() }
}

/** The web's + : a 40 disc in the heading color with the page's color on it and a small shadow. */
@Composable
private fun PlusDisc() {
    val p = LocalPalette.current
    Box(
        Modifier.size(40.dp)
            .dropShadow(CircleShape, Shadow(radius = 6.dp, offset = DpOffset(0.dp, 2.dp), color = Color.Black.copy(alpha = 0.18f)))
            .background(p.heading, CircleShape),
        contentAlignment = Alignment.Center,
    ) { FoleviIcon(WebIcon.PLUS, null, size = 22.dp, tint = p.canvas) }
}

@Composable
private fun CreateMenu(newNote: () -> Unit) {
    var open by remember { mutableStateOf(false) }
    var folder by remember { mutableStateOf(false) }
    var task by remember { mutableStateOf(false) }
    Box {
        GlassButton("Create", onClick = { open = true }) { PlusDisc() }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }, shape = MaterialTheme.shapes.large, containerColor = LocalPalette.current.surfaceRaised, tonalElevation = 0.dp, shadowElevation = 8.dp) {
            DropdownMenuItem(text = { Text("New note") }, leadingIcon = { FoleviIcon(WebIcon.FILE_PLUS_CORNER, null) }, onClick = { open = false; newNote() })
            DropdownMenuItem(text = { Text("New folder") }, leadingIcon = { FoleviIcon(WebIcon.FOLDER_PLUS, null) }, onClick = { open = false; folder = true })
            DropdownMenuItem(text = { Text("Quick task") }, leadingIcon = { FoleviIcon(WebIcon.LIST_PLUS, null) }, onClick = { open = false; task = true })
        }
    }
    if (folder) NewFolderDialog(parentId = null) { folder = false }
    if (task) QuickTaskDialog { task = false }
}

@Composable
private fun QuickTaskDialog(onDone: () -> Unit) {
    NameDialog("Quick task", "What needs doing?", "Add", onDone = onDone) { session, text -> session.client.command(Commands.taskCreate(text = text)) }
}

/** A one-field dialog that runs [act] with the trimmed text, then closes. */
@Composable
private fun NameDialog(title: String, label: String, confirm: String, onDone: () -> Unit, act: suspend (com.folevi.android.engine.AppSession, String) -> Unit) {
    val session = LocalSession.current
    val scope = rememberCoroutineScope()
    var text by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDone,
        title = { Text(title) },
        text = { OutlinedTextField(text, { text = it }, label = { Text(label) }, singleLine = true) },
        confirmButton = {
            TextButton(enabled = text.isNotBlank(), onClick = {
                val value = text.trim()
                scope.launch { runCatching { act(session, value) } }
                onDone()
            }) { Text(confirm) }
        },
        dismissButton = { TextButton(onClick = onDone) { Text("Cancel") } },
    )
}

/** New folder (until the native New folder sheet lands): a name, created at the top level or in [parentId]. */
@Composable
fun NewFolderDialog(parentId: String?, onDone: () -> Unit) {
    NameDialog("New folder", "Folder name", "Create", onDone = onDone) { session, name ->
        session.client.command(Commands.folderCreate(name = name, parentId = parentId?.let { com.folevi.engine.protocol.Patch.Set(it) } ?: com.folevi.engine.protocol.Patch.Keep))
    }
}
