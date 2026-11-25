// "Your own server" under the sign-in screen (owner 2026-11-25: like the web). The same steps and words as the
// web's OwnServerSignIn (apps/web/src/components/server/OwnServerSignIn.tsx): "Sign in to your own server", then
// the address with Continue and Scan QR code, then the server's card with "Sign in to <name>". Servers found on
// the home network (DNS-SD) are listed under the field, one tap each. The app checks everything itself
// (server/ServerSignIn.kt), then the page loads again on that server's sign-in.
package com.folevi.android.ui

import android.app.Activity
import androidx.compose.animation.AnimatedContent
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.folevi.android.MainActivity
import com.folevi.android.design.FoleviIcon
import com.folevi.android.design.LocalPalette
import com.folevi.android.design.WebIcon
import com.folevi.android.server.LocalServers
import com.folevi.android.server.ServerSignIn
import com.folevi.android.server.ShellServer
import kotlinx.coroutines.launch

@Composable
fun OwnServerSignIn(modifier: Modifier = Modifier) {
    val p = LocalPalette.current
    var open by rememberSaveable { mutableStateOf(false) }
    Column(modifier.fillMaxWidth().testTag("own-server")) {
        HorizontalDivider(color = p.line)
        Spacer(Modifier.height(20.dp))
        if (open) {
            Text("Your own server", style = MaterialTheme.typography.bodyLarge.copy(fontWeight = FontWeight.SemiBold), color = p.heading)
            Spacer(Modifier.height(12.dp))
            AddressForm()
        } else {
            TextButton(onClick = { open = true }, modifier = Modifier.fillMaxWidth().height(44.dp)) {
                FoleviIcon(WebIcon.SERVER, null, size = 16.dp)
                Spacer(Modifier.width(8.dp))
                Text("Sign in to your own server")
            }
        }
    }
}

@Composable
private fun AddressForm() {
    val p = LocalPalette.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var address by rememberSaveable { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var found by remember { mutableStateOf<ShellServer?>(null) }
    var nearby by remember { mutableStateOf<List<Pair<String, String>>>(emptyList()) }
    LaunchedEffect(Unit) {
        // { name, origin, serverId, version } each (LocalServers.entry).
        nearby = runCatching { LocalServers(context).list() }.getOrDefault(emptyList())
            .mapNotNull { o -> o.optString("origin").takeIf { it.isNotEmpty() }?.let { (o.optString("name").ifEmpty { it }) to it } }
    }
    val go: (String) -> Unit = { value ->
        if (!busy) {
            error = null
            busy = true
            scope.launch {
                when (val r = ServerSignIn.lookUp(value)) {
                    is ShellServer.Result.Ok -> found = r.server
                    is ShellServer.Result.Refused -> error = r.problem.message
                }
                busy = false
            }
        }
    }
    AnimatedContent(found, label = "own-server") { server ->
        if (server != null) {
            Found(server, onBack = { found = null }, onOpen = {
                ServerSignIn.open(server)
                (context as? MainActivity)?.reloadForMode()
            })
        } else {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedTextField(
                    value = address,
                    onValueChange = { address = it; error = null },
                    label = { Text("Server address") },
                    placeholder = { Text("notes.example.com") },
                    singleLine = true,
                    isError = error != null,
                    supportingText = { Text(error ?: "The address the person who runs it gave you, or the one on your NAS's Folevi page.") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, capitalization = KeyboardCapitalization.None, autoCorrectEnabled = false, imeAction = ImeAction.Go),
                    keyboardActions = KeyboardActions(onGo = { go(address) }),
                    modifier = Modifier.fillMaxWidth().testTag("server-address"),
                )
                FilledTonalButton(onClick = { go(address) }, enabled = !busy, modifier = Modifier.fillMaxWidth().height(44.dp)) {
                    if (busy) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp) else FoleviIcon(WebIcon.ARROW_RIGHT, null, size = 16.dp)
                    Spacer(Modifier.width(8.dp))
                    Text("Continue")
                }
                if (hasCamera(context)) {
                    TextButton(
                        enabled = !busy,
                        modifier = Modifier.fillMaxWidth().height(44.dp),
                        onClick = {
                            val activity = context as? Activity ?: return@TextButton
                            scope.launch {
                                // A refusal says why; the address field stays for typing.
                                val text = try {
                                    ServerSignIn.scan(activity)
                                } catch (e: ServerSignIn.ScanUnavailable) {
                                    error = "Folevi couldn't scan here. Type the server's address instead."
                                    null
                                } ?: return@launch
                                val value = ServerSignIn.addressFromCode(text)
                                address = value
                                go(value)
                            }
                        },
                    ) {
                        FoleviIcon(WebIcon.QR_CODE, null, size = 16.dp)
                        Spacer(Modifier.width(8.dp))
                        Text("Scan QR code")
                    }
                }
                if (nearby.isNotEmpty()) {
                    Text("On your network", style = MaterialTheme.typography.labelLarge, color = p.inkMuted, modifier = Modifier.padding(top = 4.dp))
                    for ((name, origin) in nearby) {
                        ServerRow(name, origin.replace(Regex("^https?://"), ""), enabled = !busy) {
                            address = origin
                            go(origin)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun Found(server: ShellServer, onBack: () -> Unit, onOpen: () -> Unit) {
    var busy by remember { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        ServerRow(server.name, server.origin.replace(Regex("^https?://"), ""), enabled = false, onClick = {})
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            TextButton(onClick = onBack, modifier = Modifier.height(44.dp)) { Text("Back") }
            Button(
                onClick = { busy = true; onOpen() },
                enabled = !busy,
                modifier = Modifier.weight(1f).height(44.dp).testTag("server-sign-in"),
            ) {
                if (busy) {
                    CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                    Spacer(Modifier.width(8.dp))
                }
                Text("Sign in to ${server.name}", maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}

/** The web's server card: an icon tile, the name, the address. */
@Composable
private fun ServerRow(name: String, address: String, enabled: Boolean, onClick: () -> Unit) {
    val p = LocalPalette.current
    val shape = RoundedCornerShape(12.dp)
    Row(
        Modifier.fillMaxWidth().clip(shape).background(p.surfaceSunken)
            .then(if (enabled) Modifier.clickable(onClick = onClick) else Modifier).padding(12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(Modifier.size(36.dp).clip(RoundedCornerShape(8.dp)).background(p.surface), contentAlignment = Alignment.Center) {
            FoleviIcon(WebIcon.SERVER, null, size = 17.dp, tint = p.heading)
        }
        Column(Modifier.weight(1f)) {
            Text(name, style = MaterialTheme.typography.bodyLarge.copy(fontWeight = FontWeight.SemiBold), color = p.heading, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(address, style = MaterialTheme.typography.bodySmall, color = p.inkMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

private fun hasCamera(context: android.content.Context): Boolean =
    context.packageManager.hasSystemFeature(android.content.pm.PackageManager.FEATURE_CAMERA_ANY)
