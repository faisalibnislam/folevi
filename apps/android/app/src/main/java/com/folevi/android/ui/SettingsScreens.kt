// Settings on the phone, as the web draws them (views/SettingsView.tsx with SettingsKit): a grouped list on the
// grouped background ("You", the workspace, Support), each section its own pushed screen. Native wherever the
// engine has a typed view or command; the technical sections open the web's own page in the app (owner,
// 2026-11-25): Webhooks, API tokens and Connected apps (one web page), Foli AI export, workspace Data. A few more
// go to the web because the engine has no typed view for them yet (see `webOnly` below).
package com.folevi.android.ui

import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.folevi.android.BuildConfig
import com.folevi.android.MainActivity
import com.folevi.android.design.FoleviIcon
import com.folevi.android.design.FoleviPalette
import com.folevi.android.design.GlassCircle
import com.folevi.android.design.LocalPalette
import com.folevi.android.design.PhoneType
import com.folevi.android.design.WebIcon
import com.folevi.android.design.phoneColors
import com.folevi.engine.generated.AiPrefKey
import com.folevi.engine.generated.AppearanceSettings
import com.folevi.engine.generated.Commands
import com.folevi.engine.generated.E2eeLockState
import com.folevi.engine.generated.NotificationEmailsArgs
import com.folevi.engine.generated.SessionValue
import com.folevi.engine.generated.SettingsUpdateArgs
import com.folevi.engine.generated.SpaceInfo
import com.folevi.engine.generated.Views
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable

/** A Settings section's own screen (`page`: one of [SettingsPages]). */
@Serializable
data class SettingsPageRoute(val page: String, val title: String) : Route

/** The section ids for [SettingsPageRoute]. */
object SettingsPages {
    const val ACCOUNT = "account"
    const val AI = "ai"
    const val PLAN = "plan"
    const val SECURITY = "security"
    const val PRIVACY = "privacy"
    const val DEVICES = "devices"
    const val APPEARANCE = "appearance"
    const val NOTIFICATIONS = "notifications"
    const val SYNC = "sync"
    const val DEVICE = "device"
    const val WORKSPACE = "workspace"
    const val MEMBERS = "members"
    const val ABOUT = "about"
}

// ---------------------------------------------------------------- the list (pure, so tests can read it)

/** Where a Settings row goes: a native screen, the web's page in the app, a link out, or an action here. */
sealed interface SettingsTarget {
    data class Native(val page: String) : SettingsTarget
    data class Web(val page: String) : SettingsTarget
    data class Link(val url: String) : SettingsTarget
    data object CreateWorkspace : SettingsTarget
}

data class SettingsEntry(val id: String, val title: String, val icon: WebIcon, val target: SettingsTarget)

data class SettingsGroup(val header: String?, val entries: List<SettingsEntry>, val footer: String? = null)

/**
 * The phone's Settings list (SettingsView.tsx). `local`: the library on this phone (no account sections);
 * `workspace`: the open workspace (null in Personal); `canManage`: the person manages it.
 */
fun settingsGroups(local: Boolean, workspace: String?, canManage: Boolean, serviceUrl: String = BuildConfig.SERVICE_URL): List<SettingsGroup> {
    fun native(id: String, title: String, icon: WebIcon) = SettingsEntry(id, title, icon, SettingsTarget.Native(id))
    fun web(id: String, title: String, icon: WebIcon, page: String) = SettingsEntry(id, title, icon, SettingsTarget.Web(page))
    val you = if (local) listOf(
        // The library's own settings are the web's (the engine runs them through settings.run, not a typed view).
        web("library", "Library", WebIcon.HARD_DRIVE, "settings.data"),
        native(SettingsPages.AI, "Foli AI", WebIcon.SPARKLES),
        native(SettingsPages.APPEARANCE, "Appearance", WebIcon.PALETTE),
        native(SettingsPages.SYNC, "Offline & sync", WebIcon.CLOUD),
        web("data", "Import & export", WebIcon.ARROW_DOWN_UP, "settings.data"),
        native(SettingsPages.DEVICE, "This device", WebIcon.SMARTPHONE),
    ) else listOf(
        native(SettingsPages.ACCOUNT, "Account", WebIcon.USER_ROUND),
        native(SettingsPages.AI, "Foli AI", WebIcon.SPARKLES),
        native(SettingsPages.PLAN, "Plan & billing", WebIcon.CREDIT_CARD),
        native(SettingsPages.SECURITY, "Security", WebIcon.SHIELD),
        native(SettingsPages.PRIVACY, "Privacy", WebIcon.LOCK),
        native(SettingsPages.DEVICES, "Devices", WebIcon.MONITOR_SMARTPHONE),
        // Owner rule: Connected apps, API tokens and Webhooks are the web's page.
        web("connected", "Connected apps", WebIcon.PLUG, "settings.connectedApps"),
        native(SettingsPages.APPEARANCE, "Appearance", WebIcon.PALETTE),
        native(SettingsPages.NOTIFICATIONS, "Notifications", WebIcon.BELL),
        native(SettingsPages.SYNC, "Offline & sync", WebIcon.CLOUD),
        web("data", "Import & export", WebIcon.ARROW_DOWN_UP, "settings.data"),
        native(SettingsPages.DEVICE, "This device", WebIcon.SMARTPHONE),
    )
    val groups = mutableListOf(SettingsGroup("You", you))
    if (!local) {
        if (workspace != null) {
            val ws = mutableListOf(
                native(SettingsPages.WORKSPACE, "General", WebIcon.BUILDING_COMPLEX),
                native(SettingsPages.MEMBERS, "Members", WebIcon.USERS),
            )
            if (canManage) {
                ws += web("guests", "Guests", WebIcon.USER_ROUND_PLUS, "settings.workspace")
                ws += web("wsplan", "Plan & billing", WebIcon.CREDIT_CARD, "settings.workspace")
            }
            // Owner rule: workspace Data is the web's page.
            ws += web("wsdata", "Import & export", WebIcon.ARROW_DOWN_UP, "settings.workspaceData")
            groups += SettingsGroup(workspace, ws)
        } else {
            groups += SettingsGroup(
                "Workspace",
                listOf(SettingsEntry("create", "Create a workspace", WebIcon.PLUS, SettingsTarget.CreateWorkspace)),
                footer = "Work with a team: shared notes, folders and tasks, with its own plan and members.",
            )
        }
    }
    groups += SettingsGroup(
        "Support",
        listOf(
            SettingsEntry("help", "Help", WebIcon.LIFE_BUOY, SettingsTarget.Link(serviceUrl.trimEnd('/') + "/help")),
            SettingsEntry("contact", "Contact support", WebIcon.MAIL, SettingsTarget.Link("mailto:support@folevi.com")),
            native(SettingsPages.ABOUT, "About", WebIcon.INFO),
        ),
    )
    return groups
}

/** Theme choices with the web's words. */
val THEME_CHOICES = listOf(
    Triple(AppearanceSettings.Appearance.SYSTEM, "System", "Follows your phone's light or dark setting."),
    Triple(AppearanceSettings.Appearance.LIGHT, "Light", null),
    Triple(AppearanceSettings.Appearance.DARK, "Dark", null),
)

/** "110%", with "(default)" for 100%. */
fun zoomLabel(zoom: Double): String = "${Math.round(zoom * 100)}%" + if (Math.abs(zoom - 1.0) < 0.001) " (default)" else ""

/** The lock's choices for "Lock after" (AppLock: immediately, 1, 5 or 15 minutes). */
val LOCK_AFTER = listOf(0 to "Immediately", 1 to "After 1 minute", 5 to "After 5 minutes", 15 to "After 15 minutes")

fun bytesLabel(bytes: Long?): String {
    if (bytes == null) return "Unknown"
    val units = listOf("bytes", "KB", "MB", "GB", "TB")
    var v = bytes.toDouble()
    var i = 0
    while (v >= 1024 && i < units.lastIndex) { v /= 1024; i++ }
    return if (i == 0) "$bytes bytes" else String.format(java.util.Locale.US, if (v >= 10) "%.0f %s" else "%.1f %s", v, units[i])
}

// ---------------------------------------------------------------- the grouped look

/** The grouped background (--iphone-grouped) and the row cards on it (--iphone-row). */
@Composable
internal fun groupedColors(): Pair<Color, Color> {
    val dark = LocalPalette.current == FoleviPalette.Dark
    return if (dark) Color(0xFF000000) to Color(0xFF1C1C1E) else Color(0xFFF2F2F4) to Color(0xFFFFFFFF)
}

/** A grouped screen: back circle, large title that scrolls away, small title, the grouped background. */
@Composable
internal fun GroupedScreen(title: String, onBack: (() -> Unit)?, content: LazyListScope.() -> Unit) {
    val p = LocalPalette.current
    val (bg, _) = groupedColors()
    val state = rememberLazyListState()
    val top = WindowInsets.statusBars.asPaddingValues().calculateTopPadding()
    val nav = WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()
    val gone by remember { derivedStateOf { state.firstVisibleItemIndex > 0 || state.firstVisibleItemScrollOffset > 120 } }
    Box(Modifier.fillMaxSize().background(bg)) {
        LazyColumn(state = state, modifier = Modifier.fillMaxSize(), contentPadding = PaddingValues(top = top + 60.dp, bottom = nav + 40.dp)) {
            item(key = "_title") {
                Text(title, style = PhoneType.largeTitle, color = p.heading, modifier = Modifier.padding(start = 20.dp, end = 20.dp, top = 4.dp, bottom = 6.dp).semantics { heading() })
            }
            content()
        }
        Box(Modifier.fillMaxWidth().height(top + 60.dp).alpha(if (gone) 1f else 0f).background(bg))
        Row(Modifier.fillMaxWidth().padding(top = top + 8.dp, start = 16.dp, end = 16.dp).height(44.dp), verticalAlignment = Alignment.CenterVertically) {
            if (onBack != null) GlassCircle(WebIcon.CHEVRON_LEFT, "Back", onBack) else Spacer(Modifier.size(44.dp))
            Box(Modifier.weight(1f), contentAlignment = Alignment.Center) {
                Text(title, style = PhoneType.headline, color = p.heading, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.alpha(if (gone) 1f else 0f))
            }
            Spacer(Modifier.size(44.dp))
        }
    }
}

/** A section header (footnote caps, muted), 28 above. */
@Composable
internal fun GroupHeader(text: String, first: Boolean = false) {
    Text(
        text.uppercase(),
        style = PhoneType.eyebrow.copy(fontWeight = FontWeight.Normal),
        color = LocalPalette.current.inkMuted,
        modifier = Modifier.padding(start = 32.dp, end = 32.dp, top = if (first) 12.dp else 28.dp, bottom = 6.dp).semantics { heading() },
    )
}

@Composable
internal fun GroupFooter(text: String) {
    Text(text, style = PhoneType.footnote, color = LocalPalette.current.inkMuted, modifier = Modifier.padding(start = 32.dp, end = 32.dp, top = 6.dp))
}

/** A card of rows (radius 18, the row fill, hairlines between rows inset to the text). */
@Composable
internal fun GroupCard(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    val (_, row) = groupedColors()
    Column(modifier.fillMaxWidth().padding(horizontal = 16.dp).clip(RoundedCornerShape(18.dp)).background(row), content = content)
}

/** The 30 icon tile (RowIcon: ink 7%, radius 8, glyph 17 in the heading color, or a color of its own). */
@Composable
internal fun IconTile(icon: WebIcon, tint: Color? = null) {
    val p = LocalPalette.current
    val c = phoneColors()
    Box(Modifier.size(30.dp).clip(RoundedCornerShape(8.dp)).background(tint?.copy(alpha = 0.14f) ?: c.ink(0.07f)), contentAlignment = Alignment.Center) {
        FoleviIcon(icon, null, size = 17.dp, tint = tint ?: p.heading)
    }
}

/** A grouped row: at least 52, 16 inside; hairline under the text unless it's the last. */
@Composable
internal fun SettingRow(
    label: String,
    onClick: (() -> Unit)?,
    icon: WebIcon? = null,
    iconTint: Color? = null,
    detail: String? = null,
    hint: String? = null,
    chevron: Boolean = onClick != null,
    destructive: Boolean = false,
    last: Boolean = false,
    trailing: (@Composable () -> Unit)? = null,
) {
    val p = LocalPalette.current
    val c = phoneColors()
    Row(
        Modifier.fillMaxWidth().heightIn(min = 52.dp).then(if (onClick != null) Modifier.clickable(role = Role.Button, onClick = onClick) else Modifier).padding(start = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) {
            IconTile(icon, if (destructive) p.destructive else iconTint)
            Spacer(Modifier.width(12.dp))
        }
        Row(
            Modifier.weight(1f).heightIn(min = 52.dp)
                .then(if (!last) Modifier.drawBehind { drawLine(c.separator, Offset(0f, size.height), Offset(size.width, size.height), 0.5.dp.toPx()) } else Modifier)
                .padding(end = 16.dp, top = 8.dp, bottom = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text(label, style = PhoneType.body, color = if (destructive) p.destructive else p.ink)
                if (hint != null) Text(hint, style = PhoneType.footnote, color = p.inkMuted)
            }
            if (detail != null) Text(detail, style = PhoneType.body, color = p.inkMuted, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(start = 8.dp))
            trailing?.invoke()
            if (chevron) FoleviIcon(WebIcon.CHEVRON_RIGHT, null, size = 18.dp, tint = p.inkFaint, modifier = Modifier.padding(start = 6.dp))
        }
    }
}

@Composable
internal fun SwitchRow(label: String, checked: Boolean, onChange: (Boolean) -> Unit, hint: String? = null, last: Boolean = false, enabled: Boolean = true) {
    val p = LocalPalette.current
    SettingRow(label, onClick = if (enabled) ({ onChange(!checked) }) else null, hint = hint, chevron = false, last = last) {
        Switch(
            checked = checked,
            onCheckedChange = if (enabled) onChange else null,
            colors = SwitchDefaults.colors(checkedTrackColor = p.moss, checkedThumbColor = Color.White, uncheckedTrackColor = phoneColors().ink(0.12f), uncheckedBorderColor = Color.Transparent, uncheckedThumbColor = Color.White),
        )
    }
}

@Composable
internal fun ChoiceRow(label: String, selected: Boolean, onClick: () -> Unit, hint: String? = null, last: Boolean = false) {
    val p = LocalPalette.current
    SettingRow(label, onClick = onClick, hint = hint, chevron = false, last = last) {
        if (selected) FoleviIcon(WebIcon.CHECK, "Selected", size = 20.dp, tint = p.heading)
    }
}

// ---------------------------------------------------------------- Settings

@Composable
fun SettingsScreen(open: (Route) -> Unit, onBack: (() -> Unit)?) {
    val session = LocalSession.current
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val sess by rememberView(Views.session())
    val s = sess.value
    val local = s?.mode == SessionValue.Mode.LOCAL
    val space = s?.spaces?.firstOrNull { it.id == s.space }
    val workspace = space?.takeIf { it.kind == SpaceInfo.Kind.WORKSPACE }
    var creating by remember { mutableStateOf(false) }
    GroupedScreen("Settings", onBack) {
        if (s == null) return@GroupedScreen
        val groups = settingsGroups(local, workspace?.name, workspace?.canManage == true)
        groups.forEachIndexed { gi, g ->
            item(key = "h$gi") { g.header?.let { GroupHeader(it, first = gi == 0) } }
            item(key = "g$gi") {
                GroupCard {
                    g.entries.forEachIndexed { i, e ->
                        SettingRow(e.title, icon = e.icon, last = i == g.entries.lastIndex, onClick = {
                            when (val t = e.target) {
                                is SettingsTarget.Native -> open(SettingsPageRoute(t.page, e.title))
                                is SettingsTarget.Web -> open(WebShowRoute(t.page, e.title))
                                is SettingsTarget.Link -> (context as? MainActivity)?.openBrowser(Uri.parse(t.url))
                                SettingsTarget.CreateWorkspace -> creating = true
                            }
                        })
                    }
                }
            }
            g.footer?.let { f -> item(key = "f$gi") { GroupFooter(f) } }
        }
        item(key = "version") {
            Text("Folevi ${BuildConfig.VERSION_NAME}", style = PhoneType.footnote, color = LocalPalette.current.inkFaint, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(24.dp))
        }
    }
    if (creating) {
        TextPrompt("New workspace", "Workspace name", "Create", onDismiss = { creating = false }) { name ->
            scope.launch {
                runCatching { session.client.command(Commands.workspaceCreate(name = name)) }
                    .onSuccess { r -> runCatching { session.client.command(Commands.spaceSwitch(space = r.space)) } }
            }
        }
    }
}

/** A one-field dialog. */
@Composable
internal fun TextPrompt(title: String, label: String, confirm: String, initial: String = "", onDismiss: () -> Unit, onDone: (String) -> Unit) {
    var text by remember { mutableStateOf(initial) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = { OutlinedTextField(text, { text = it }, label = { Text(label) }, singleLine = true) },
        confirmButton = { TextButton(enabled = text.isNotBlank(), onClick = { onDone(text.trim()); onDismiss() }) { Text(confirm) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

// ---------------------------------------------------------------- the sections

@Composable
fun SettingsPageScreen(route: SettingsPageRoute, open: (Route) -> Unit, onBack: (() -> Unit)?) {
    GroupedScreen(route.title, onBack) {
        when (route.page) {
            SettingsPages.ACCOUNT -> item { AccountSection(open) }
            SettingsPages.AI -> item { AiSection(open) }
            SettingsPages.PLAN -> item { PlanSection(open) }
            SettingsPages.SECURITY -> item { SecuritySection(open) }
            SettingsPages.PRIVACY -> item { PrivacySection(open) }
            SettingsPages.DEVICES -> item { DevicesSection() }
            SettingsPages.APPEARANCE -> item { AppearanceSection() }
            SettingsPages.NOTIFICATIONS -> item { NotificationsSection() }
            SettingsPages.SYNC -> item { SyncSection() }
            SettingsPages.DEVICE -> item { DeviceSection() }
            SettingsPages.WORKSPACE -> item { WorkspaceSection(open) }
            SettingsPages.MEMBERS -> item { MembersSection(open) }
            SettingsPages.ABOUT -> item { AboutSection() }
        }
    }
}

/** Runs a command and ignores a refusal (the view shows the real state). */
@Composable
private fun runner(): (suspend () -> Unit) -> Unit {
    val scope = rememberCoroutineScope()
    return { block -> scope.launch { runCatching { block() } } }
}

@Composable
private fun AccountSection(open: (Route) -> Unit) {
    val session = LocalSession.current
    val run = runner()
    val account by rememberView(Views.settingsAccount())
    val ai by rememberView(Views.settingsAi())
    val a = account.value ?: return
    var naming by remember { mutableStateOf(false) }
    Column {
        GroupHeader("Profile", first = true)
        GroupCard {
            SettingRow("Name", onClick = { naming = true }, detail = a.name.ifEmpty { "Add your name" })
            SettingRow("Email", onClick = null, detail = a.email, chevron = false)
            if (a.avatarUrl != null) SettingRow("Remove photo", onClick = { run { session.client.command(Commands.settingsRemoveAvatar()) } }, chevron = false, destructive = true, last = true)
            else SettingRow("Photo", onClick = null, detail = "None", chevron = false, last = true)
        }
        GroupHeader("Time zone")
        GroupCard {
            SettingRow("Time zone", onClick = null, detail = a.timeZone, chevron = false)
            val here = java.time.ZoneId.systemDefault().id
            if (here != a.timeZone) SettingRow("Use this phone's ($here)", onClick = { run { session.client.command(Commands.settingsUpdate(timeZone = here)) } }, chevron = false, last = true)
            else SettingRow("Matches this phone", onClick = null, chevron = false, last = true)
        }
        ai.value?.let { v ->
            if (v.included) {
                GroupHeader("Foli AI")
                GroupCard { SwitchRow("Foli AI", v.enabled, { on -> run { session.client.command(Commands.settingsUpdate(aiEnabled = on)) } }, last = true) }
            }
        }
        GroupHeader("Account")
        GroupCard { SettingRow("Delete account", onClick = { open(WebShowRoute("settings.deleteAccount", "Delete account")) }, destructive = true, last = true) }
    }
    if (naming) TextPrompt("Your name", "Name", "Save", initial = a.name, onDismiss = { naming = false }) { name -> run { session.client.command(Commands.settingsUpdate(name = name)) } }
}

@Composable
private fun AiSection(open: (Route) -> Unit) {
    val session = LocalSession.current
    val run = runner()
    val ai by rememberView(Views.settingsAi())
    val v = ai.value ?: return
    Column {
        if (!v.included) {
            GroupHeader("Foli AI", first = true)
            GroupCard { SettingRow("Foli AI isn't part of this plan.", onClick = null, chevron = false, last = true) }
        } else {
            GroupHeader("Foli AI", first = true)
            GroupCard { SwitchRow("Use Foli AI", v.enabled, { on -> run { session.client.command(Commands.settingsUpdate(aiEnabled = on)) } }, last = true) }
            val prefs = listOf(
                Triple(AiPrefKey.HISTORY, "Keep chat history", v.history),
                Triple(AiPrefKey.MEMORY, "Memory", v.memory),
                Triple(AiPrefKey.SUGGESTIONS, "Suggestions while you write", v.suggestions),
                Triple(AiPrefKey.ATTACHMENTS, "Read attachments", v.attachments),
                Triple(AiPrefKey.WEB_RESEARCH, "Search the web", v.webResearch),
                Triple(AiPrefKey.DIGESTS, "Digests", v.digests),
                Triple(AiPrefKey.READ_IMAGES, "Read text in images", v.readImages),
                Triple(AiPrefKey.DEVICE_TEXT, "Use text on this device", v.deviceText),
            )
            GroupHeader("How it works")
            GroupCard {
                prefs.forEachIndexed { i, (key, label, on) ->
                    SwitchRow(label, on, { next -> run { session.client.command(Commands.settingsSetAiPref(key = key, on = next)) } }, last = i == prefs.lastIndex, enabled = v.enabled)
                }
            }
        }
        GroupHeader("Your data")
        // Owner rule: Foli AI export is the web's page.
        GroupCard { SettingRow("Foli AI export", onClick = { open(WebShowRoute("settings.aiExport", "Foli AI export")) }, icon = WebIcon.DOWNLOAD, last = true) }
    }
}

@Composable
private fun PlanSection(open: (Route) -> Unit) {
    val details by rememberView(Views.accountDetails())
    val d = details.value ?: return
    Column {
        GroupHeader("Plan", first = true)
        GroupCard {
            val plan = d.plan
            SettingRow("Plan", onClick = null, detail = plan?.tier?.replaceFirstChar { it.uppercase() } ?: "Free", chevron = false)
            if (plan?.trialing == true) SettingRow("Trial", onClick = null, detail = plan.trialEndsAt?.let { "Ends " + com.folevi.android.design.shortDate(it) } ?: "On", chevron = false)
            SettingRow("Foli AI", onClick = null, detail = if (plan?.ai == true) "Included" else "Not included", chevron = false)
            d.storage?.let { st -> SettingRow("Storage", onClick = null, detail = bytesLabel(st.usedBytes) + (st.limitBytes?.let { " of " + bytesLabel(it) } ?: ""), chevron = false) }
            SettingRow("Devices", onClick = null, detail = listOfNotNull(d.devicesActive?.toString(), d.deviceLimit?.let { "of $it" }).joinToString(" ").ifEmpty { "None" }, chevron = false, last = true)
        }
        // Buying and changing plans happen on the website (no prices or upgrade links in the app).
        GroupFooter("Change your plan on folevi.com.")
    }
}

@Composable
private fun SecuritySection(open: (Route) -> Unit) {
    val sec by rememberView(Views.settingsSecurity())
    val v = sec.value ?: return
    Column {
        GroupHeader("Signing in", first = true)
        GroupCard {
            SettingRow("Two-step verification", onClick = null, detail = when (v.twoFactor) { true -> "On"; false -> "Off"; null -> "Not available" }, chevron = false)
            SettingRow("Passkeys", onClick = null, detail = if (v.passkeys.isEmpty()) "None" else "${v.passkeys.size}", chevron = false)
            SettingRow("Sign-in methods", onClick = null, detail = v.methods.joinToString(", ").ifEmpty { "None" }, chevron = false, last = true)
        }
        if (v.passkeys.isNotEmpty()) {
            GroupHeader("Passkeys")
            GroupCard { v.passkeys.forEachIndexed { i, k -> SettingRow(k.name, onClick = null, detail = k.lastUsedAt?.let { "Used " + com.folevi.android.design.shortDate(it) }, chevron = false, last = i == v.passkeys.lastIndex) } }
        }
        GroupHeader("Change")
        // Setting up two-step verification and passkeys, and changing the password, are the web's for now.
        GroupCard {
            SettingRow("Manage sign-in", onClick = { open(WebShowRoute("settings.security", "Security")) }, icon = WebIcon.SHIELD)
            SettingRow("Delete account", onClick = { open(WebShowRoute("settings.deleteAccount", "Delete account")) }, icon = WebIcon.TRASH, destructive = true, last = true)
        }
    }
}

@Composable
private fun PrivacySection(open: (Route) -> Unit) {
    val e2ee by rememberView(Views.e2eeState())
    val v = e2ee.value
    Column {
        GroupHeader("Encryption", first = true)
        GroupCard {
            SettingRow(
                "End-to-end encryption",
                onClick = null,
                chevron = false,
                detail = when (v?.state) {
                    E2eeLockState.NONE, null -> "Off"
                    E2eeLockState.LOCKED -> "Locked on this device"
                    E2eeLockState.UNLOCKING -> "Unlocking…"
                    E2eeLockState.UNLOCKED -> "On"
                    else -> "On"
                },
            )
            SettingRow("Manage encryption", onClick = { open(WebShowRoute("settings.privacy", "Privacy")) }, last = true)
        }
    }
}

@Composable
private fun DevicesSection() {
    val session = LocalSession.current
    val run = runner()
    val sec by rememberView(Views.settingsSecurity())
    val rows = sec.value?.sessions ?: return
    Column {
        GroupHeader("Signed in", first = true)
        GroupCard {
            rows.forEachIndexed { i, r ->
                SettingRow(
                    r.label.ifEmpty { r.client },
                    onClick = null,
                    icon = WebIcon.MONITOR_SMARTPHONE,
                    hint = if (r.current) "This device" else "Last active " + com.folevi.android.design.shortDate(r.lastSeenAt),
                    chevron = false,
                    last = i == rows.lastIndex,
                ) {
                    if (!r.current) TextButton(onClick = { run { session.client.command(Commands.sessionRevoke(id = r.id)) } }) { Text("Sign out", color = LocalPalette.current.destructive) }
                }
            }
        }
    }
}

@Composable
private fun AppearanceSection() {
    val session = LocalSession.current
    val run = runner()
    val appearance by rememberView(Views.settingsAppearance())
    val v = appearance.value ?: return
    Column {
        GroupHeader("Theme", first = true)
        GroupCard {
            THEME_CHOICES.forEachIndexed { i, (value, label, hint) ->
                ChoiceRow(label, v.appearance == value, { run { session.client.command(Commands.settingsUpdate(appearance = SettingsUpdateArgs.Appearance.of(value.value))) } }, hint = hint, last = i == THEME_CHOICES.lastIndex)
            }
        }
        if (v.editorZooms.isNotEmpty()) {
            GroupHeader("Text size in notes")
            GroupCard {
                v.editorZooms.forEachIndexed { i, z ->
                    ChoiceRow(zoomLabel(z), Math.abs(v.editorZoom - z) < 0.001, { run { session.client.command(Commands.settingsUpdate(editorZoom = z)) } }, last = i == v.editorZooms.lastIndex)
                }
            }
        }
    }
}

@Composable
private fun NotificationsSection() {
    val session = LocalSession.current
    val run = runner()
    val n by rememberView(Views.settingsNotifications())
    val v = n.value ?: return
    Column {
        v.topics.forEachIndexed { ti, t ->
            GroupHeader(t.label, first = ti == 0)
            GroupCard {
                SwitchRow("In the app", t.inApp, { on -> run { session.client.command(Commands.settingsSetNotificationTopic(topic = t.id, inApp = on)) } })
                SwitchRow("By email", t.email, { on -> run { session.client.command(Commands.settingsSetNotificationTopic(topic = t.id, email = on)) } }, last = true)
            }
            if (t.hint.isNotBlank()) GroupFooter(t.hint)
        }
        GroupHeader("Email")
        GroupCard {
            SwitchRow("Daily digest", v.digest == "daily", { on -> run { session.client.command(Commands.settingsSetNotificationEmails(digest = if (on) NotificationEmailsArgs.Digest.DAILY else NotificationEmailsArgs.Digest.OFF)) } })
            SwitchRow("News about Folevi", v.productEmail, { on -> run { session.client.command(Commands.settingsSetNotificationEmails(productEmail = on)) } }, last = true)
        }
    }
}

@Composable
private fun SyncSection() {
    val session = LocalSession.current
    val run = runner()
    val sync by rememberView(Views.syncStatus())
    val storage by rememberView(Views.deviceStorage())
    Column {
        sync.value?.let { s ->
            GroupHeader("Connection", first = true)
            GroupCard {
                SettingRow("Status", onClick = null, detail = s.label, chevron = false)
                SettingRow("Online", onClick = null, detail = if (s.online) "Yes" else "No", chevron = false)
                SettingRow("Changes waiting", onClick = null, detail = "${s.pending}", chevron = false)
                SettingRow("Conflicts", onClick = null, detail = "${s.conflicts}", chevron = false, last = true)
            }
        }
        storage.value?.takeIf { it.available }?.let { d ->
            GroupHeader("On this device")
            GroupCard {
                SwitchRow("Keep every note on this device", d.keepAll, { on -> run { session.client.command(Commands.deviceKeepAll(on = on)) } })
                d.notesKept?.let { SettingRow("Notes kept", onClick = null, detail = "$it", chevron = false) }
                d.attachmentsKept?.let { SettingRow("Attachments kept", onClick = null, detail = "$it", chevron = false) }
                SettingRow("Space used", onClick = null, detail = bytesLabel(d.usedBytes), chevron = false)
                SettingRow("Uploads waiting", onClick = null, detail = "${d.waiting}", chevron = false, last = true)
            }
        }
    }
}

@Composable
private fun DeviceSection() {
    val context = LocalContext.current
    val activity = context as? MainActivity
    val scope = rememberCoroutineScope()
    val lock = activity?.lock
    var on by remember { mutableStateOf(lock?.let { it.enabled && it.method() != "none" } ?: false) }
    var after by remember { mutableStateOf(lock?.lockAfter ?: 0) }
    val method = lock?.method() ?: "none"
    Column {
        GroupHeader("Lock", first = true)
        GroupCard {
            SwitchRow(
                if (method == "biometric") "Lock with fingerprint or face" else "Lock with screen lock",
                on,
                { next -> if (activity != null && lock != null) scope.launch { runCatching { lock.set(activity, next, null) }; on = lock.enabled } },
                hint = if (method == "none") "Set a screen lock on this phone first." else null,
                enabled = method != "none",
                last = true,
            )
        }
        if (on) {
            GroupHeader("Lock after")
            GroupCard {
                LOCK_AFTER.forEachIndexed { i, (minutes, label) ->
                    ChoiceRow(label, after == minutes, { if (activity != null && lock != null) scope.launch { runCatching { lock.set(activity, null, minutes) }; after = lock.lockAfter } }, last = i == LOCK_AFTER.lastIndex)
                }
            }
        }
    }
}

@Composable
private fun WorkspaceSection(open: (Route) -> Unit) {
    val sess by rememberView(Views.session())
    val details by rememberView(Views.accountDetails())
    val s = sess.value ?: return
    val space = s.spaces.firstOrNull { it.id == s.space } ?: return
    val plan = details.value?.spaces?.firstOrNull { it.id == space.id }?.planName
    Column {
        GroupHeader("General", first = true)
        GroupCard {
            SettingRow("Name", onClick = null, detail = space.name, chevron = false)
            SettingRow("Your role", onClick = null, detail = space.role.replaceFirstChar { it.uppercase() }, chevron = false)
            SettingRow("Plan", onClick = null, detail = plan ?: "Unknown", chevron = false, last = !space.canManage)
            if (space.canManage) SettingRow("Manage workspace", onClick = { open(WebShowRoute("settings.workspace", space.name)) }, last = true)
        }
    }
}

@Composable
private fun MembersSection(open: (Route) -> Unit) {
    val sess by rememberView(Views.session())
    val members by rememberView(Views.members())
    val rows = members.value?.members ?: return
    val canManage = sess.value?.let { s -> s.spaces.firstOrNull { it.id == s.space }?.canManage } == true
    Column {
        GroupHeader("${rows.size} ${if (rows.size == 1) "member" else "members"}", first = true)
        GroupCard {
            rows.forEachIndexed { i, m ->
                SettingRow(m.name.ifEmpty { m.email } + if (m.isYou) " (you)" else "", onClick = null, hint = m.email, detail = m.role.replaceFirstChar { it.uppercase() }, chevron = false, last = i == rows.lastIndex && !canManage)
            }
            if (canManage) SettingRow("Invite and manage", onClick = { open(WebShowRoute("settings.workspace", "Members")) }, last = true)
        }
    }
}

@Composable
private fun AboutSection() {
    Column {
        GroupHeader("Folevi", first = true)
        GroupCard {
            SettingRow("Version", onClick = null, detail = BuildConfig.VERSION_NAME, chevron = false, last = true)
        }
    }
}
