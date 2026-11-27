// The Vault (docs/E2EE_DESIGN.md, the engine's vault.* views and commands): set it up with a passcode (the
// recovery key shows once, to save), unlock it, then passwords, files and trash, an item's fields, and Lock.
// Secret values are shown hidden until tapped, and copying one is recorded as the web and iPhone do. Drawn with
// the web phone layout's parts (design/PhoneKit.kt): glass bar controls, the large title, view chips, plain rows.
package com.folevi.android.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.os.PersistableBundle
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.folevi.android.design.FoleviIcon
import com.folevi.android.design.GlassCircle
import com.folevi.android.design.LocalPalette
import com.folevi.android.design.PhoneRadius
import com.folevi.android.design.PhoneType
import com.folevi.android.design.Placeholder
import com.folevi.android.design.ScreenEmpty
import com.folevi.android.design.ViewChip
import com.folevi.android.design.WebIcon
import com.folevi.android.design.phoneColors
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
    val p = LocalPalette.current
    val session = LocalSession.current
    val scope = rememberCoroutineScope()
    Column(Modifier.fillMaxSize().background(p.canvas)) {
        // The bar: Back, and Lock while the Vault is open.
        Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 8.dp).height(44.dp), verticalAlignment = Alignment.CenterVertically) {
            if (onBack != null) GlassCircle(WebIcon.CHEVRON_LEFT, "Back", onBack)
            Spacer(Modifier.weight(1f))
            val id = v?.vaultId
            if (v?.state == VaultState.OPEN && id != null) {
                GlassCircle(WebIcon.LOCK, "Lock the Vault", { scope.launch { runCatching { session.client.command(Commands.vaultLock(vaultId = id)) } } }, iconSize = 20.dp)
            }
        }
        Text("Vault", style = PhoneType.largeTitle, color = p.heading, modifier = Modifier.padding(start = 20.dp, end = 20.dp, top = 12.dp, bottom = 6.dp).semantics { heading() })
        when {
            v == null -> Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) { repeat(3) { Placeholder(52.dp) } }
            v.state == VaultState.NONE || v.state == VaultState.SET_UP -> VaultSetUp()
            v.state == VaultState.LOCKED || v.state == VaultState.NEEDS_PASSCODE -> v.vaultId?.let { VaultUnlock(it, finish = v.state == VaultState.NEEDS_PASSCODE) }
            v.state == VaultState.OPEN -> v.vaultId?.let { VaultItems(it, v.recoveryToSave) }
            else -> ScreenEmpty(WebIcon.LOCK, "Encryption is locked", "Unlock encryption on this device first. Folevi asks for it when you open an encrypted note.")
        }
    }
}

/** A passcode field in the web's filled style (ink 6%, radius 14) and the strong 48 button (heading fill). */
@Composable
private fun PasscodeForm(label: String, action: String, minLength: Int, error: String?, onSubmit: (String) -> Unit) {
    var passcode by rememberSaveable { mutableStateOf("") }
    val p = LocalPalette.current
    val c = phoneColors()
    val ready = passcode.length >= minLength
    Column(Modifier.padding(horizontal = 16.dp, vertical = 12.dp).widthIn(max = 440.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(label, style = PhoneType.footnote, color = p.inkMuted, modifier = Modifier.padding(start = 4.dp))
        Box(Modifier.fillMaxWidth().heightIn(min = 48.dp).clip(PhoneRadius.panel).background(c.ink(0.06f)).padding(horizontal = 14.dp), contentAlignment = Alignment.CenterStart) {
            BasicTextField(
                passcode,
                { passcode = it.filter(Char::isDigit).take(12) },
                singleLine = true,
                textStyle = PhoneType.body.copy(color = p.ink),
                cursorBrush = SolidColor(p.accent),
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                modifier = Modifier.fillMaxWidth().semantics { contentDescription = label },
            )
        }
        error?.let { Text(it, style = PhoneType.subheadline, color = p.destructive) }
        Box(
            Modifier.fillMaxWidth().heightIn(min = 48.dp).clip(PhoneRadius.panel).background(if (ready) p.heading else c.ink(0.08f))
                .clickable(enabled = ready, role = Role.Button) { onSubmit(passcode); passcode = "" },
            contentAlignment = Alignment.Center,
        ) { Text(action, style = PhoneType.headline, color = if (ready) p.canvas else p.inkFaint) }
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
        style = PhoneType.subheadline,
        color = LocalPalette.current.inkMuted,
        modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp),
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
                SelectionContainer { Text(key, style = PhoneType.headline) }
            }
        },
        confirmButton = { TextButton(onClick = done) { Text("I saved it", color = LocalPalette.current.ink) } },
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

private val SECTIONS = listOf(
    Triple(VaultItemsArgs.Section.PASSWORDS, "Passwords", WebIcon.KEY_ROUND),
    Triple(VaultItemsArgs.Section.FILES, "Files", WebIcon.FILE_KEY),
    Triple(VaultItemsArgs.Section.TRASH, "Trash", WebIcon.TRASH),
)

/** An item's second line: kind, detail, date, leaving out what's blank. */
internal fun vaultMeta(kindLabel: String, detail: String, date: String): String = listOf(kindLabel, detail, date).filter { it.isNotBlank() }.joinToString(" · ")

@Composable
private fun VaultItems(vaultId: String, recoveryToSave: String?) {
    var section by rememberSaveable { mutableStateOf(VaultItemsArgs.Section.PASSWORDS) }
    val items by rememberView(Views.vaultItems(vaultId = vaultId, section = section), key = vaultId + section)
    var open by remember { mutableStateOf<VaultItemValue?>(null) }
    val session = LocalSession.current
    val scope = rememberCoroutineScope()
    val p = LocalPalette.current
    val c = phoneColors()
    recoveryToSave?.let { key -> RecoveryKeyDialog(key) { scope.launch { runCatching { session.client.command(Commands.vaultRecoverySaved(vaultId = vaultId)) } } } }
    Row(Modifier.horizontalScroll(rememberScrollState()).padding(start = 16.dp, end = 16.dp, top = 6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        SECTIONS.forEach { (s, label, icon) -> ViewChip(label, selected = section == s, onClick = { section = s }, icon = icon) }
    }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(top = 8.dp, bottom = 24.dp)) {
        val rows = items.value?.items
        when {
            rows == null -> item { Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) { repeat(3) { Placeholder(64.dp) } } }
            rows.isEmpty() -> item {
                when (section) {
                    VaultItemsArgs.Section.FILES -> ScreenEmpty(WebIcon.FILE_KEY, "No files yet", "Files you keep in the Vault are encrypted on this device first.")
                    VaultItemsArgs.Section.TRASH -> ScreenEmpty(WebIcon.TRASH, "Trash is empty")
                    else -> ScreenEmpty(WebIcon.KEY_ROUND, "No passwords yet", "Passwords you keep in the Vault are encrypted with your passcode.")
                }
            }
            else -> items(rows, key = { it.id }) { r ->
                Row(
                    Modifier.fillMaxWidth().clickable(role = Role.Button) {
                        scope.launch { runCatching { session.client.command(Commands.vaultItemOpen(vaultId = vaultId, itemId = r.id)) }.onSuccess { open = it } }
                    }.padding(start = 20.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(Modifier.width(28.dp), contentAlignment = Alignment.Center) {
                        FoleviIcon(if (section == VaultItemsArgs.Section.FILES) WebIcon.FILE_KEY else WebIcon.KEY_ROUND, null, size = 22.dp, tint = p.inkMuted)
                    }
                    Column(
                        Modifier.weight(1f).padding(start = 12.dp).heightIn(min = 64.dp)
                            .drawBehind { drawLine(c.separator, Offset(0f, size.height), Offset(size.width, size.height), 0.5.dp.toPx()) }
                            .padding(end = 16.dp, top = 10.dp, bottom = 10.dp),
                        verticalArrangement = Arrangement.Center,
                    ) {
                        Text(r.title.ifEmpty { r.kindLabel }, style = PhoneType.body, color = p.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(vaultMeta(r.kindLabel, r.detail, shortDate(r.updatedAt)), style = PhoneType.subheadline, color = p.inkMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
            }
        }
    }
    open?.let { item -> VaultItemDialog(vaultId, item) { open = null } }
}

@Composable
private fun VaultItemDialog(vaultId: String, item: VaultItemValue, close: () -> Unit) {
    val session = LocalSession.current
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val p = LocalPalette.current
    val c = phoneColors()
    AlertDialog(
        onDismissRequest = close,
        containerColor = c.solid,
        title = { Text(item.title.ifEmpty { item.kindLabel }, style = PhoneType.headline, color = p.heading) },
        text = {
            Column(Modifier.clip(PhoneRadius.container).background(c.ink(0.05f))) {
                for (f in item.fields) {
                    var shown by remember(f.key) { mutableStateOf(f.type != "secret" && f.type != "password") }
                    Row(
                        Modifier.fillMaxWidth().heightIn(min = 56.dp).clickable(role = Role.Button, onClickLabel = if (shown) "Hide" else "Show") { shown = !shown }.padding(start = 16.dp, end = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(Modifier.weight(1f).padding(vertical = 8.dp)) {
                            Text(f.label, style = PhoneType.footnote, color = p.inkMuted)
                            Text(if (shown) f.value else "••••••••", style = PhoneType.body, color = p.ink)
                        }
                        Box(
                            Modifier.size(44.dp).clip(androidx.compose.foundation.shape.CircleShape).clickable(role = Role.Button, onClickLabel = "Copy ${f.label}") {
                                copySecret(context, f.label, f.value, secret = !shown || f.type == "secret" || f.type == "password")
                                scope.launch { runCatching { session.client.command(Commands.vaultRecord(vaultId = vaultId, event = "copy", itemId = item.id, field = f.key)) } }
                            },
                            contentAlignment = Alignment.Center,
                        ) { FoleviIcon(WebIcon.COPY, "Copy ${f.label}", size = 18.dp, tint = p.inkMuted) }
                    }
                }
                if (item.notes.isNotBlank()) Text(item.notes, style = PhoneType.subheadline, color = p.ink, modifier = Modifier.padding(16.dp))
            }
        },
        confirmButton = { TextButton(onClick = close) { Text("Done", style = PhoneType.headline.copy(fontWeight = FontWeight.SemiBold), color = p.ink) } },
    )
}

/** Copies a value; a secret is marked sensitive so Android doesn't preview it on screen. */
private fun copySecret(context: Context, label: String, value: String, secret: Boolean) {
    val clip = ClipData.newPlainText(label, value)
    if (secret) clip.description.extras = PersistableBundle().apply { putBoolean("android.content.extra.IS_SENSITIVE", true) }
    (context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(clip)
}
