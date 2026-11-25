// The phone's floating bar, as the web's phone layout draws it (apps/web/src/components/iphone/TabBar.tsx): Home,
// Tasks and Calendar in one capsule on the left, Foli AI and + in another on the right. + opens New note, New
// folder and Quick task. Built from Material 3 parts: the selected tab's lens moves on the theme's spatial spring.
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
import androidx.compose.ui.unit.dp
import com.folevi.android.design.FoleviIcon
import com.folevi.android.design.LocalPalette
import com.folevi.android.design.WebIcon
import com.folevi.engine.generated.Commands
import kotlinx.coroutines.launch

/** The tabs in the left capsule; Foli AI has its own button in the right one. */
internal val PHONE_TABS = listOf(Tab.HOME, Tab.TASKS, Tab.CALENDAR)

@Composable
fun PhoneBar(tab: Tab, pick: (Tab) -> Unit, newNote: () -> Unit, modifier: Modifier = Modifier) {
    Row(
        modifier.fillMaxWidth().windowInsetsPadding(WindowInsets.navigationBars).padding(horizontal = 16.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Capsule(Modifier.testTag("phone-tabs").semantics { contentDescription = "Tabs" }) {
            for (t in PHONE_TABS) TabButton(t, selected = t == tab, onClick = { pick(t) })
        }
        Capsule(Modifier.testTag("phone-create").semantics { contentDescription = "Create" }) {
            RoundButton(WebIcon.SPARKLES, "Foli AI", selected = tab == Tab.AI, onClick = { pick(Tab.AI) })
            if (tab == Tab.TASKS) {
                // On Tasks, + is a quick task straight away (as on the web).
                var asking by remember { mutableStateOf(false) }
                RoundButton(WebIcon.PLUS, "Quick task", selected = false, onClick = { asking = true })
                if (asking) QuickTaskDialog { asking = false }
            } else {
                CreateMenu(newNote)
            }
        }
    }
}

@Composable
private fun Capsule(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    Surface(
        modifier = modifier.height(64.dp),
        shape = CircleShape,
        color = MaterialTheme.colorScheme.surfaceContainer,
        tonalElevation = 3.dp,
        shadowElevation = 6.dp,
    ) {
        Row(Modifier.padding(4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(2.dp)) { content() }
    }
}

@Composable
private fun TabButton(t: Tab, selected: Boolean, onClick: () -> Unit) {
    val p = LocalPalette.current
    val lens by animateColorAsState(if (selected) p.accentSoft else Color.Transparent, MaterialTheme.motionScheme.fastEffectsSpec(), label = "lens")
    val ink by animateColorAsState(if (selected) p.accentStrong else MaterialTheme.colorScheme.onSurfaceVariant, MaterialTheme.motionScheme.fastEffectsSpec(), label = "ink")
    Column(
        Modifier.clip(CircleShape).background(lens).clickable(role = Role.Tab, onClickLabel = t.label, onClick = onClick)
            .height(56.dp).width(72.dp).semantics { contentDescription = t.label }.testTag("tab-${t.name.lowercase()}"),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        FoleviIcon(t.icon, null, size = 23.dp, tint = ink)
        Text(t.label, style = MaterialTheme.typography.labelSmall, color = ink)
    }
}

@Composable
private fun RoundButton(icon: WebIcon, label: String, selected: Boolean, onClick: () -> Unit) {
    val p = LocalPalette.current
    val lens by animateColorAsState(if (selected) p.accentSoft else Color.Transparent, MaterialTheme.motionScheme.fastEffectsSpec(), label = "lens")
    Box(
        Modifier.size(56.dp).clip(CircleShape).background(lens).clickable(role = Role.Button, onClick = onClick)
            .semantics { contentDescription = label }.testTag("button-$label"),
        contentAlignment = Alignment.Center,
    ) {
        FoleviIcon(icon, null, size = 24.dp, tint = if (selected) p.accentStrong else MaterialTheme.colorScheme.onSurface)
    }
}

@Composable
private fun CreateMenu(newNote: () -> Unit) {
    var open by remember { mutableStateOf(false) }
    var folder by remember { mutableStateOf(false) }
    var task by remember { mutableStateOf(false) }
    Box {
        RoundButton(WebIcon.PLUS, "New", selected = open, onClick = { open = true })
        DropdownMenu(expanded = open, onDismissRequest = { open = false }, shape = MaterialTheme.shapes.large) {
            DropdownMenuItem(text = { Text("New note") }, leadingIcon = { FoleviIcon(WebIcon.FILE_PLUS_CORNER, null) }, onClick = { open = false; newNote() })
            DropdownMenuItem(text = { Text("New folder") }, leadingIcon = { FoleviIcon(WebIcon.FOLDER_PLUS, null) }, onClick = { open = false; folder = true })
            DropdownMenuItem(text = { Text("Quick task") }, leadingIcon = { FoleviIcon(WebIcon.LIST_PLUS, null) }, onClick = { open = false; task = true })
        }
    }
    if (folder) NameDialog("New folder", "Folder name", "Create", onDone = { folder = false }) { session, name -> session.client.command(Commands.folderCreate(name = name)) }
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
