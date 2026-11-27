// The account sheet (iphone/AccountSheet.tsx), opened from the avatar: the places on this phone (accounts with
// their workspaces, the library), Settings, signing in to another account, Help, and signing out. Switching a
// place loads the page again in that place (as PlacesPlugin.switchTo); switching a workspace is the engine's.
package com.folevi.android.ui

import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.folevi.android.BuildConfig
import com.folevi.android.FoleviApp
import com.folevi.android.MainActivity
import com.folevi.android.design.FoleviIcon
import com.folevi.android.design.LocalPalette
import com.folevi.android.design.PhoneType
import com.folevi.android.design.WebIcon
import com.folevi.android.design.phoneColors
import com.folevi.engine.generated.Commands
import com.folevi.engine.generated.PlaceRow
import com.folevi.engine.generated.SessionValue
import com.folevi.engine.generated.SpaceInfo
import com.folevi.engine.generated.Views
import kotlinx.coroutines.launch

/** An email cut in the middle so "@domain" stays in view (the web's middleEllipsis). */
fun middleEllipsis(email: String, max: Int = 30): String {
    if (email.length <= max) return email
    val at = email.lastIndexOf('@')
    if (at <= 0) return email.take(max - 1) + "…"
    val domain = email.substring(at)
    val keep = (max - domain.length - 1).coerceAtLeast(3)
    return email.take(keep) + "…" + domain
}

/** An account's unread badge: the count, or "99+". */
fun unreadBadge(n: Long): String = if (n > 99) "99+" else "$n"

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AccountSheet(onDismiss: () -> Unit, open: (Route) -> Unit) {
    val session = LocalSession.current
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val activity = context as? MainActivity
    val p = LocalPalette.current
    val (bg, _) = groupedColors()
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = false)
    val places by rememberView(Views.placesList())
    val sess by rememberView(Views.session())
    val sync by rememberView(Views.syncStatus())
    val s = sess.value
    val list = places.value
    val local = s?.mode == SessionValue.Mode.LOCAL
    var creating by remember { mutableStateOf(false) }
    var signingOut by remember { mutableStateOf(false) }

    val switchPlace: (String) -> Unit = { id ->
        val app = FoleviApp.instance
        if (app.places.has(id) && id != app.places.state.current) {
            app.places.setCurrent(id)
            activity?.reloadForMode()
        }
        onDismiss()
    }
    val signInAnother: () -> Unit = {
        if (activity != null) scope.launch {
            val app = FoleviApp.instance
            val (url, finish) = app.auth.beginAccount()
            activity.openSignIn(url)
            val user = runCatching { finish() }.getOrNull() ?: return@launch
            val first = app.places.state.accounts.isEmpty()
            val added = app.places.addAccount(user.userId, user.name, user.email, user.avatarUrl) ?: return@launch
            if (first) app.adoptLegacyKeys(user.userId)
            app.places.setCurrent(added.id)
            activity.reloadForMode()
        }
        onDismiss()
    }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheet,
        containerColor = bg,
        shape = RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp),
        dragHandle = null,
    ) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(bottom = 24.dp)) {
            SheetTitle("Account", onDismiss)
            if (list != null && s != null) {
                GroupHeader("Places", first = true)
                GroupCard {
                    val ordered = list.places.sortedBy { if (it.id == list.current) 0 else 1 }
                    ordered.forEachIndexed { i, place ->
                        val current = place.id == list.current
                        PlaceRowView(place, current, last = false) { switchPlace(place.id) }
                        if (current && place.kind == PlaceRow.Kind.ACCOUNT) {
                            // The open account's spaces: Personal and its workspaces, with a check on the open one.
                            s.spaces.forEach { sp ->
                                SubRow(
                                    sp.name.ifEmpty { if (sp.kind == SpaceInfo.Kind.PERSONAL) "Personal" else "Workspace" },
                                    detail = place.workspaces.firstOrNull { it.id == sp.id }?.planName,
                                    checked = sp.id == s.space,
                                ) {
                                    scope.launch { runCatching { session.client.command(Commands.spaceSwitch(space = sp.id)) } }
                                    onDismiss()
                                }
                            }
                            if (s.capabilities.workspaces) SubRow("New workspace…", icon = WebIcon.PLUS) { creating = true }
                        } else if (!current) {
                            place.workspaces.forEach { w -> SubRow(w.name, detail = w.planName, checked = false) { switchPlace(place.id) } }
                        }
                        if (i == ordered.lastIndex) Spacer(Modifier.height(0.dp))
                    }
                }
                GroupHeader("")
                GroupCard {
                    SettingRow("Settings", icon = WebIcon.SETTINGS, onClick = { onDismiss(); open(SettingsRoute) })
                    if (!local || list.places.size > 1) SettingRow("Sign in to another account…", icon = WebIcon.USER_PLUS, onClick = signInAnother)
                    SettingRow("Help", icon = WebIcon.LIFE_BUOY, last = true, onClick = {
                        activity?.openBrowser(Uri.parse(BuildConfig.SERVICE_URL.trimEnd('/') + "/help"))
                        onDismiss()
                    })
                }
                Spacer(Modifier.height(24.dp))
                GroupCard {
                    SettingRow(
                        if (local) "Sign out" else "Sign out of ${s.profile.name.ifEmpty { s.profile.email }}",
                        icon = WebIcon.LOG_OUT,
                        destructive = true,
                        chevron = false,
                        last = true,
                        onClick = { signingOut = true },
                    )
                }
            }
        }
    }
    if (creating) {
        TextPrompt("New workspace", "Workspace name", "Create", onDismiss = { creating = false }) { name ->
            scope.launch {
                runCatching { session.client.command(Commands.workspaceCreate(name = name)) }
                    .onSuccess { r -> runCatching { session.client.command(Commands.spaceSwitch(space = r.space)) } }
            }
            onDismiss()
        }
    }
    if (signingOut) {
        val waiting = sync.value?.pending ?: 0
        AlertDialog(
            onDismissRequest = { signingOut = false },
            title = { Text("Sign out?") },
            text = {
                Text(
                    if (waiting > 0) "$waiting ${if (waiting == 1L) "change hasn't" else "changes haven't"} synced yet. Signing out now leaves them behind on this phone."
                    else "Your notes stay in your account. You can sign in again any time.",
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    signingOut = false
                    scope.launch { runCatching { session.client.command(Commands.accountSignOut()) } }
                    onDismiss()
                }) { Text("Sign out", color = p.destructive) }
            },
            dismissButton = { TextButton(onClick = { signingOut = false }) { Text("Cancel") } },
        )
    }
}

/** A sheet's header (56 tall, the title centered, a 32 close circle). */
@Composable
internal fun SheetTitle(title: String, onClose: () -> Unit) {
    val p = LocalPalette.current
    val c = phoneColors()
    Box(Modifier.fillMaxWidth().height(56.dp).padding(6.dp)) {
        // The grabber.
        Box(Modifier.align(Alignment.TopCenter).padding(top = 0.dp).size(36.dp, 5.dp).clip(CircleShape).background(c.ink(0.22f)))
        Text(title, style = PhoneType.headline, color = p.heading, modifier = Modifier.align(Alignment.Center))
        Box(
            Modifier.align(Alignment.CenterEnd).size(44.dp).clip(CircleShape).clickable(role = Role.Button, onClickLabel = "Close", onClick = onClose).semantics { contentDescription = "Close" },
            contentAlignment = Alignment.Center,
        ) {
            Box(Modifier.size(32.dp).clip(CircleShape).background(c.ink(0.09f)), contentAlignment = Alignment.Center) { FoleviIcon(WebIcon.X, null, size = 17.dp, tint = p.inkMuted) }
        }
    }
}

/** A place (at least 60): a 36 avatar or library tile, the name, the email or where it syncs, a badge, a check. */
@Composable
private fun PlaceRowView(place: PlaceRow, current: Boolean, last: Boolean, onClick: () -> Unit) {
    val p = LocalPalette.current
    val c = phoneColors()
    Row(Modifier.fillMaxWidth().heightIn(min = 60.dp).clickable(role = Role.Button, onClick = onClick).padding(start = 16.dp), verticalAlignment = Alignment.CenterVertically) {
        if (place.kind == PlaceRow.Kind.LIBRARY) {
            Box(Modifier.size(36.dp).clip(RoundedCornerShape(8.dp)).background(c.ink(0.07f)), contentAlignment = Alignment.Center) { FoleviIcon(WebIcon.SMARTPHONE, null, size = 19.dp, tint = p.heading) }
        } else {
            Box(Modifier.size(36.dp).clip(CircleShape).background(p.accentSoft).border(0.5.dp, phoneColors().separator, CircleShape), contentAlignment = Alignment.Center) {
                Text(place.name.trim().firstOrNull()?.uppercase() ?: "F", style = PhoneType.subheadline.copy(fontWeight = FontWeight.SemiBold), color = p.accentSoftInk)
            }
        }
        Spacer(Modifier.width(12.dp))
        Row(
            Modifier.weight(1f).heightIn(min = 60.dp)
                .then(if (!last) Modifier.drawBehind { drawLine(c.separator, Offset(0f, size.height), Offset(size.width, size.height), 0.5.dp.toPx()) } else Modifier)
                .padding(end = 16.dp, top = 8.dp, bottom = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text(
                    if (place.kind == PlaceRow.Kind.LIBRARY) "On this phone" else place.name.ifEmpty { place.email ?: "Account" },
                    style = PhoneType.body.copy(fontWeight = FontWeight.Medium), color = p.heading, maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
                val sub = if (place.kind == PlaceRow.Kind.LIBRARY) place.syncs else place.email?.let { middleEllipsis(it) }
                if (!sub.isNullOrBlank()) Text(sub, style = PhoneType.subheadline, color = p.inkMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            if (!current && place.unread > 0) {
                Box(Modifier.heightIn(min = 20.dp).clip(CircleShape).background(p.coral).padding(horizontal = 6.dp), contentAlignment = Alignment.Center) {
                    Text(unreadBadge(place.unread), style = PhoneType.footnote.copy(fontWeight = FontWeight.SemiBold), color = Color.White)
                }
            } else if (!current && place.reminders > 0) {
                Box(Modifier.size(8.dp).clip(CircleShape).background(p.coral))
            }
            Box(Modifier.width(28.dp), contentAlignment = Alignment.CenterEnd) {
                if (current) FoleviIcon(WebIcon.CHECK, "Open", size = 20.dp, tint = p.heading)
            }
        }
    }
}

/** A workspace under its account (44, indented 64), or an action there. */
@Composable
private fun SubRow(label: String, detail: String? = null, checked: Boolean = false, icon: WebIcon? = null, onClick: () -> Unit) {
    val p = LocalPalette.current
    val c = phoneColors()
    Row(Modifier.fillMaxWidth().heightIn(min = 44.dp).clickable(role = Role.Button, onClick = onClick).padding(start = 64.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(24.dp).clip(RoundedCornerShape(6.dp)).background(c.ink(0.07f)), contentAlignment = Alignment.Center) {
            if (icon != null) FoleviIcon(icon, null, size = 15.dp, tint = p.heading)
            else Text(label.trim().firstOrNull()?.uppercase() ?: "W", style = PhoneType.footnote.copy(fontWeight = FontWeight.SemiBold), color = p.heading)
        }
        Spacer(Modifier.width(12.dp))
        Row(
            Modifier.weight(1f).heightIn(min = 44.dp).drawBehind { drawLine(c.separator, Offset(0f, size.height), Offset(size.width, size.height), 0.5.dp.toPx()) }.padding(end = 16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(label, style = PhoneType.body, color = p.ink, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
            if (detail != null) Text(detail, style = PhoneType.subheadline, color = p.inkMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Box(Modifier.width(28.dp), contentAlignment = Alignment.CenterEnd) { if (checked) FoleviIcon(WebIcon.CHECK, "Open", size = 20.dp, tint = p.heading) }
        }
    }
}
