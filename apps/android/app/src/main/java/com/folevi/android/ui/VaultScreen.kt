// The Vault (docs/E2EE_DESIGN.md, the engine's vault.* views and commands): set it up with a passcode (the
// recovery key shows once, to save), unlock it, then passwords, files and trash, an item's fields, and Lock.
// Secret values are shown hidden until tapped, and copying one is recorded as the web and iPhone do.
package com.folevi.android.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.os.PersistableBundle
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.unit.dp
import com.folevi.android.design.FoleviIcon
import com.folevi.android.design.LocalPalette
import com.folevi.android.design.WebIcon
import com.folevi.android.design.shortDate
import com.folevi.engine.generated.Commands
import com.folevi.engine.generated.VaultItemValue
import com.folevi.engine.generated.VaultItemsArgs
import com.folevi.engine.generated.VaultState
import com.folevi.engine.generated.Views
import kotlinx.coroutines.launch

@Composable
fun VaultScreen(onBack: (() -> Unit)?) {
    val summary by rememberView(Views.vaultSummary())
    val v = summary.value
    Column(Modifier.fillMaxSize()) {
        BigTitle("Vault", navigation = onBack?.let { { BackButton(it) } }) {
            val id = v?.vaultId
            if (v?.state == VaultState.OPEN && id != null) {
                val session = LocalSession.current
                val scope = rememberCoroutineScope()
                IconButton(onClick = { scope.launch { runCatching { session.client.command(Commands.vaultLock(vaultId = id)) } } }) { FoleviIcon(WebIcon.LOCK, "Lock the Vault") }
            }
        }
        when {
            v == null -> EmptyBox("Loading…")
            v.state == VaultState.NONE || v.state == VaultState.SET_UP -> VaultSetUp()
            v.state == VaultState.LOCKED || v.state == VaultState.NEEDS_PASSCODE -> v.vaultId?.let { VaultUnlock(it, finish = v.state == VaultState.NEEDS_PASSCODE) }
            v.state == VaultState.OPEN -> v.vaultId?.let { VaultItems(it, v.recoveryToSave) }
            else -> EmptyBox("Unlock encryption on this device first. Folevi asks for it when you open an encrypted note.")
        }
    }
}

@Composable
private fun PasscodeForm(label: String, action: String, minLength: Int, error: String?, onSubmit: (String) -> Unit) {
    var passcode by rememberSaveable { mutableStateOf("") }
    val p = LocalPalette.current
    Column(Modifier.padding(20.dp).widthIn(max = 440.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        OutlinedTextField(
            value = passcode,
            onValueChange = { passcode = it },
            label = { Text(label) },
            singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
            modifier = Modifier.fillMaxWidth(),
        )
        error?.let { Text(it, color = p.destructive) }
        Button(onClick = { onSubmit(passcode); passcode = "" }, enabled = passcode.length >= minLength, modifier = Modifier.fillMaxWidth()) { Text(action) }
    }
}

@Composable
private fun VaultSetUp() {
    val session = LocalSession.current
    val scope = rememberCoroutineScope()
    var recovery by rememberSaveable { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    Text(
        "The Vault keeps passwords and files encrypted with a passcode only you know. Folevi can't open it.",
        color = LocalPalette.current.inkMuted,
        modifier = Modifier.padding(horizontal = 20.dp),
    )
    PasscodeForm("Choose a passcode", "Set up the Vault", 6, error) { code ->
        scope.launch {
            runCatching { session.client.command(Commands.vaultSetUp(passcode = code)) }
                .onSuccess { recovery = it.recoveryKey; error = null }
                .onFailure { error = it.message }
        }
    }
    recovery?.let { key -> RecoveryKeyDialog(key) { recovery = null } }
}

@Composable
private fun RecoveryKeyDialog(key: String, done: () -> Unit) {
    AlertDialog(
        onDismissRequest = {},
        title = { Text("Save your recovery key") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("If you forget the passcode, this key is the only way back in. Keep it somewhere safe, away from this device.")
                SelectionContainer { Text(key, style = MaterialTheme.typography.titleMedium) }
            }
        },
        confirmButton = { TextButton(onClick = done) { Text("I saved it") } },
    )
}

@Composable
private fun VaultUnlock(vaultId: String, finish: Boolean) {
    val session = LocalSession.current
    val scope = rememberCoroutineScope()
    var error by remember { mutableStateOf<String?>(null) }
    PasscodeForm(if (finish) "Choose the Vault's passcode" else "Passcode", if (finish) "Finish" else "Unlock", 4, error) { code ->
        scope.launch {
            runCatching { session.client.command(if (finish) Commands.vaultFinishPasscode(vaultId = vaultId, passcode = code) else Commands.vaultUnlock(vaultId = vaultId, passcode = code)) }
                .onSuccess { r -> error = if (r.status == "ok" || r.status == "open") null else r.message ?: "That passcode didn't open the Vault." }
                .onFailure { error = it.message }
        }
    }
}

private val SECTIONS = listOf(VaultItemsArgs.Section.PASSWORDS to "Passwords", VaultItemsArgs.Section.FILES to "Files", VaultItemsArgs.Section.TRASH to "Trash")

@Composable
private fun VaultItems(vaultId: String, recoveryToSave: String?) {
    var section by rememberSaveable { mutableStateOf(VaultItemsArgs.Section.PASSWORDS) }
    val items by rememberView(Views.vaultItems(vaultId = vaultId, section = section), key = vaultId + section)
    var open by remember { mutableStateOf<VaultItemValue?>(null) }
    val session = LocalSession.current
    val scope = rememberCoroutineScope()
    val p = LocalPalette.current
    recoveryToSave?.let { key -> RecoveryKeyDialog(key) { scope.launch { runCatching { session.client.command(Commands.vaultRecoverySaved(vaultId = vaultId)) } } } }
    SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth().padding(horizontal = 16.dp)) {
        SECTIONS.forEachIndexed { i, (s, label) ->
            SegmentedButton(selected = section == s, onClick = { section = s }, shape = SegmentedButtonDefaults.itemShape(i, SECTIONS.size)) { Text(label) }
        }
    }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 96.dp)) {
        val rows = items.value?.items
        if (rows.isNullOrEmpty()) item { EmptyBox(if (rows == null) "Loading…" else "Nothing here yet.") }
        items(rows.orEmpty(), key = { it.id }) { r ->
            ListItem(
                headlineContent = { Text(r.title.ifEmpty { r.kindLabel }) },
                supportingContent = { Text(listOf(r.kindLabel, r.detail, shortDate(r.updatedAt)).filter { it.isNotBlank() }.joinToString(" · "), color = p.inkFaint) },
                leadingContent = { FoleviIcon(if (section == VaultItemsArgs.Section.FILES) WebIcon.FILE_KEY else WebIcon.KEY_ROUND, null) },
                colors = ListItemDefaults.colors(containerColor = Color.Transparent),
                modifier = Modifier.clickable {
                    scope.launch { runCatching { session.client.command(Commands.vaultItemOpen(vaultId = vaultId, itemId = r.id)) }.onSuccess { open = it } }
                },
            )
        }
    }
    open?.let { item -> VaultItemDialog(vaultId, item) { open = null } }
}

@Composable
private fun VaultItemDialog(vaultId: String, item: VaultItemValue, close: () -> Unit) {
    val session = LocalSession.current
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    AlertDialog(
        onDismissRequest = close,
        title = { Text(item.title.ifEmpty { item.kindLabel }) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                for (f in item.fields) {
                    var shown by remember(f.key) { mutableStateOf(f.type != "secret" && f.type != "password") }
                    ListItem(
                        overlineContent = { Text(f.label) },
                        headlineContent = { Text(if (shown) f.value else "••••••••") },
                        trailingContent = {
                            IconButton(onClick = {
                                copySecret(context, f.label, f.value, secret = !shown || f.type == "secret" || f.type == "password")
                                scope.launch { runCatching { session.client.command(Commands.vaultRecord(vaultId = vaultId, event = "copy", itemId = item.id, field = f.key)) } }
                            }) { FoleviIcon(WebIcon.COPY, "Copy ${f.label}") }
                        },
                        colors = ListItemDefaults.colors(containerColor = Color.Transparent),
                        modifier = Modifier.clickable { shown = !shown },
                    )
                }
                if (item.notes.isNotBlank()) Text(item.notes)
            }
        },
        confirmButton = { TextButton(onClick = close) { Text("Done") } },
    )
}

/** Copies a value; a secret is marked sensitive so Android doesn't preview it on screen. */
private fun copySecret(context: Context, label: String, value: String, secret: Boolean) {
    val clip = ClipData.newPlainText(label, value)
    if (secret) clip.description.extras = PersistableBundle().apply { putBoolean("android.content.extra.IS_SENSITIVE", true) }
    (context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(clip)
}
