// The screen before the app (`gate.changed`, protocol.ts GateChangedEvent): the first-launch choice, sign-in,
// library setup, onboarding, a migration, the E2EE unlock, a device limit. The engine sends the words, fields
// and buttons; native draws them and sends `gate.act`. Every gate the web knows has a dedicated native screen
// (Gates.kt); a gate this build doesn't know yet falls back to the generic one below.
package com.folevi.android.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.LinearWavyProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.heightIn
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import com.folevi.android.design.FoleviIcon
import com.folevi.android.design.GlassTextButton
import com.folevi.android.design.LocalPalette
import com.folevi.android.design.PhoneRadius
import com.folevi.android.design.PhoneType
import com.folevi.android.design.WebIcon
import com.folevi.engine.generated.Commands
import com.folevi.engine.generated.GateAction
import com.folevi.engine.generated.GateChangedEvent
import com.folevi.engine.generated.GateField
import kotlinx.coroutines.launch

/** The gates Gates.kt draws (GateModel.swift's kinds). */
internal val KNOWN_GATES = setOf(
    "loading", "modeChoice", "signedOut", "emailUnverified", "suspended", "setupFailed", "offline", "error", "deviceLimit",
    "onboarding", "librarySetup", "libraryLocked", "updateRequired", "migration", "placeMove", "e2eeLocked", "e2eeSetup",
    "e2eeWaiting", "e2eeTrust",
)

@Composable
fun GateScreen(gate: GateChangedEvent) {
    if (gate.gate == null || gate.gate in KNOWN_GATES) NativeGate(gate) else GenericGate(gate)
}

@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
private fun GenericGate(gate: GateChangedEvent) {
    val session = LocalSession.current
    val scope = rememberCoroutineScope()
    val values = remember(gate.gate) { mutableStateMapOf<String, String>() }
    val p = LocalPalette.current
    Box(Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) {
        Column(
            Modifier.widthIn(max = 440.dp).fillMaxWidth().verticalScroll(rememberScrollState()),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            FoleviIcon(WebIcon.NOTEBOOK_TEXT, null, size = 40.dp, tint = p.accent)
            Text(gate.title.ifEmpty { defaultTitle(gate.gate) }, style = MaterialTheme.typography.headlineMedium, textAlign = TextAlign.Center, color = p.heading, modifier = Modifier.semantics { heading() })
            if (gate.message.isNotEmpty()) Text(gate.message, style = MaterialTheme.typography.bodyLarge, textAlign = TextAlign.Center, color = p.inkMuted)
            if (gate.busy || gate.progress != null) LinearWavyProgressIndicator(Modifier.fillMaxWidth())
            gate.progress?.label?.let { Text(it, color = p.inkFaint) }
            for (f in gate.fields) GateInput(f, values[f.id] ?: "") { values[f.id] = it }
            gate.error?.let { Text(it.message, color = p.destructive, textAlign = TextAlign.Center) }
            for (a in gate.actions) {
                GateButton(a) { scope.launch { runCatching { session.client.command(Commands.gateAct(action = a.id, values = values.toMap())) } } }
            }
            // "Your own server" under Folevi Cloud's sign-in, as on the web (OwnServer.kt). Not on a server's own
            // sign-in screen (that place is already a server).
            if (gate.gate == "signedOut" && com.folevi.android.FoleviApp.instance.places.actingServer == null) OwnServerSignIn(Modifier.padding(top = 8.dp))
        }
    }
}

private fun defaultTitle(gate: String?): String = when (gate) {
    "loading" -> "Opening your folio…"
    "signedOut" -> "Sign in to Folevi"
    else -> ""
}

@Composable
private fun GateInput(f: GateField, value: String, onChange: (String) -> Unit) {
    val secret = f.kind == GateField.Kind.SECRET
    OutlinedTextField(
        value = value,
        onValueChange = onChange,
        label = { Text(f.label) },
        placeholder = { Text(f.placeholder) },
        singleLine = true,
        visualTransformation = if (secret) PasswordVisualTransformation() else androidx.compose.ui.text.input.VisualTransformation.None,
        modifier = Modifier.fillMaxWidth(),
    )
}

/** Folevi's buttons: the strong glass one for the primary action, glass for the rest, the danger color for a destructive one. */
@Composable
private fun GateButton(a: GateAction, onClick: () -> Unit) {
    val p = LocalPalette.current
    val m = Modifier.fillMaxWidth().heightIn(min = 48.dp)
    when (a.style) {
        GateAction.Style.PRIMARY -> GlassTextButton(a.label, onClick, m, strong = true, enabled = a.enabled)
        GateAction.Style.DESTRUCTIVE -> Box(
            m.clip(PhoneRadius.panel).background(p.destructive.copy(alpha = 0.09f)).clickable(enabled = a.enabled, role = Role.Button, onClick = onClick).padding(horizontal = 16.dp, vertical = 12.dp),
            contentAlignment = Alignment.Center,
        ) { Text(a.label, style = PhoneType.headline, color = p.destructive, maxLines = 1, overflow = TextOverflow.Ellipsis) }
        else -> GlassTextButton(a.label, onClick, m, enabled = a.enabled)
    }
}
