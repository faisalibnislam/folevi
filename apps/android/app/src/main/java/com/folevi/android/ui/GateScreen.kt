// The screen before the app (`gate.changed`, protocol.ts GateChangedEvent): the first-launch choice, sign-in,
// library setup, onboarding, a migration, the E2EE unlock, a device limit. The engine sends the words, fields
// and buttons; native draws them and sends `gate.act`. Dedicated screens (sign-in with Google and passkeys,
// onboarding) replace this generic one in plan phase 1, as on iPhone.
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
import com.folevi.android.design.FoleviIcon
import com.folevi.android.design.LocalPalette
import com.folevi.android.design.WebIcon
import com.folevi.engine.generated.Commands
import com.folevi.engine.generated.GateAction
import com.folevi.engine.generated.GateChangedEvent
import com.folevi.engine.generated.GateField
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun GateScreen(gate: GateChangedEvent) {
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
            Text(gate.title.ifEmpty { defaultTitle(gate.gate) }, style = MaterialTheme.typography.headlineMedium, textAlign = TextAlign.Center, color = p.heading)
            if (gate.message.isNotEmpty()) Text(gate.message, style = MaterialTheme.typography.bodyLarge, textAlign = TextAlign.Center, color = p.inkMuted)
            if (gate.busy || gate.progress != null) LinearWavyProgressIndicator(Modifier.fillMaxWidth())
            gate.progress?.label?.let { Text(it, color = p.inkFaint) }
            for (f in gate.fields) GateInput(f, values[f.id] ?: "") { values[f.id] = it }
            gate.error?.let { Text(it.message, color = MaterialTheme.colorScheme.error, textAlign = TextAlign.Center) }
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

@Composable
private fun GateButton(a: GateAction, onClick: () -> Unit) {
    val m = Modifier.fillMaxWidth()
    when (a.style) {
        GateAction.Style.PRIMARY -> Button(onClick, m, enabled = a.enabled) { Text(a.label) }
        GateAction.Style.SECONDARY -> FilledTonalButton(onClick, m, enabled = a.enabled) { Text(a.label) }
        GateAction.Style.DESTRUCTIVE -> OutlinedButton(onClick, m, enabled = a.enabled) { Text(a.label, color = MaterialTheme.colorScheme.error) }
        GateAction.Style.QUIET -> TextButton(onClick, m, enabled = a.enabled) { Text(a.label) }
    }
}
