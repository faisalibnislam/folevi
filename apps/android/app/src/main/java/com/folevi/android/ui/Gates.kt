// The screens before the app, native (owner 2026-11-25: "Make onboarding native too"), drawn as the web draws them on
// a phone, as the iPhone app does (apps/native-kit/Sources/FoleviScreens/Onboarding/WebGates.swift, GateScreen.swift,
// GateModel.swift; the web's components/app/ModeChoice.tsx, LibrarySetup.tsx, LockedLibrary.tsx, ShellSignIn.tsx,
// Onboarding.tsx and lib/app/state.tsx FullPageMessage):
//
//   loading        the mark and "Opening your folio…" with a quiet busy bar
//   modeChoice     the logo, "Where should your notes live?", the two choice cards
//   librarySetup   the places, then "Your library is ready" with the optional passphrase and Open Folevi
//   libraryLocked  the passphrase and Unlock
//   signedOut      the logo, the title and its line, the sign-in buttons, then "Your own server"
//   onboarding     the six steps (Welcome, Your pages, Note theme, Appearance, Foli AI, Ready) with the progress
//   everything else FullPageMessage: a card with the title, text, progress, devices, recovery key, fields, buttons
//
// Every button is `gate.act` on the page's own screen, so the web's handlers do the work and native never keeps a
// second copy of the logic.
package com.folevi.android.ui

import android.graphics.BitmapFactory
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshots.SnapshotStateMap
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.dropShadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.shadow.Shadow
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.DpOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.material3.Text
import com.folevi.android.design.AiMark
import com.folevi.android.design.FoleviIcon
import com.folevi.android.design.FoleviPalette
import com.folevi.android.design.LocalPalette
import com.folevi.android.design.PhoneRadius
import com.folevi.android.design.PhoneType
import com.folevi.android.design.Spectral
import com.folevi.android.design.WebIcon
import com.folevi.android.design.phoneColors
import com.folevi.engine.protocol.EngineFailure
import com.folevi.engine.generated.Commands
import com.folevi.engine.generated.GateAction
import com.folevi.engine.generated.GateChangedEvent
import com.folevi.engine.generated.GateField
import com.folevi.engine.generated.GateProgress
import com.folevi.engine.generated.OnboardingGateInfo
import kotlinx.coroutines.launch

// ---------------------------------------------------------------- rules (pure, tested)

/** The gate's words, choices and values, as GateModel.swift has them. */
object GateRules {
    /** Native words where the page left the heading empty. */
    fun title(gate: GateChangedEvent): String = gate.title.ifEmpty {
        when (gate.gate) {
            "loading" -> "Opening your folio…"
            "modeChoice" -> "Where should your notes live?"
            "signedOut" -> "Sign in to Folevi"
            "emailUnverified" -> "Check your inbox"
            "suspended" -> "This account is suspended"
            "setupFailed" -> "Folevi couldn't start"
            "offline" -> "You're offline"
            "error" -> "Something went wrong"
            "deviceLimit" -> "Too many devices"
            "onboarding" -> "Welcome to Folevi"
            "librarySetup" -> "Choose a folder for your notes"
            "libraryLocked" -> "Unlock your library"
            "updateRequired" -> "Update Folevi to keep syncing"
            "migration" -> "Move your notes to Folevi"
            "placeMove" -> "Moving notes"
            "e2eeLocked" -> "Unlock your encrypted notes"
            "e2eeSetup" -> "Set up encryption"
            "e2eeWaiting" -> "Waiting for your encryption key"
            "e2eeTrust" -> "Trust this device?"
            else -> "Folevi"
        }
    }

    fun message(gate: GateChangedEvent): String = gate.message.ifEmpty {
        when (gate.gate) {
            "updateRequired" -> "This version of Folevi is too old to sync with your account. Update it from Google Play, then open it again. Your notes on this device are safe."
            "offline" -> "Folevi needs a connection the first time it opens. Connect, and it carries on by itself."
            "emailUnverified" -> "Open the confirmation link we emailed you to continue. It expires in 24 hours and works once."
            else -> ""
        }
    }

    /** ModeChoice.tsx's lines under each choice. */
    fun modeDetail(id: String): String = when (id) {
        "account" -> "Sync and share your notes."
        "local" -> "Free forever. No account."
        else -> ""
    }

    /** LibrarySetup.tsx's placeOptions, in an Android phone's words. */
    fun placeDetail(kind: String): String = when (kind) {
        "dropbox" -> "Folevi uses only its own folder."
        "gdrive" -> "Folevi sees only the files it makes."
        "folder" -> "Any folder on this phone, or one Dropbox, Google Drive or OneDrive syncs."
        "device" -> "No sync. You can turn it on later."
        else -> ""
    }

    /** Whether a field goes with an action: the same id, the recovery key's with `recovery`, a secret with `unlock`. */
    fun fieldBelongsTo(f: GateField, action: String): Boolean =
        f.id == action || (action == "recovery" && f.id == "recoveryKey") || (action == "unlock" && f.kind == GateField.Kind.SECRET)

    /** Actions that pick a way in with a field of their own; with more than one they become choices. */
    fun methodActions(gate: GateChangedEvent): List<GateAction> {
        val bound = gate.actions.filter { a -> gate.fields.any { fieldBelongsTo(it, a.id) } }
        return if (bound.size > 1) bound else emptyList()
    }

    fun visibleFields(gate: GateChangedEvent, method: String?): List<GateField> {
        val methods = methodActions(gate)
        if (methods.isEmpty() || method == null) return gate.fields
        return gate.fields.filter { f ->
            val owner = methods.firstOrNull { fieldBelongsTo(f, it.id) }
            owner == null || owner.id == method
        }
    }

    /** The buttons, the picked method first as the primary one. */
    fun visibleActions(gate: GateChangedEvent, method: String?): List<GateAction> {
        val methods = methodActions(gate)
        if (methods.isEmpty()) return gate.actions
        val lead = methods.firstOrNull { it.id == method }?.copy(style = GateAction.Style.PRIMARY)
        return listOfNotNull(lead) + gate.actions.filter { a -> methods.none { it.id == a.id } }
    }

    /** Buttons that stay pressable while the screen is busy. */
    fun allowedWhileBusy(id: String): Boolean = id in setOf("stop", "cancel", "cancelApproval", "back")

    fun isEnabled(gate: GateChangedEvent, action: GateAction, values: Map<String, String>, pending: String?): Boolean {
        if (!action.enabled || pending != null) return false
        if (gate.busy && !allowedWhileBusy(action.id)) return false
        for (f in gate.fields) if (fieldBelongsTo(f, action.id) && values[f.id].isNullOrBlank()) return false
        if (action.id == "confirmRecovery" && gate.fields.any { it.kind == GateField.Kind.CODE && values[it.id].isNullOrEmpty() }) return false
        return true
    }

    /** "k7qm 2rtx…" as typed: upper case, groups of four joined by dashes. */
    fun normalizedRecoveryKey(text: String): String =
        text.uppercase().filter { it.isLetterOrDigit() }.chunked(4).joinToString("-")

    /** What a press sends: the visible fields' values, cleaned up per kind; null when there are none. */
    fun valuesToSend(fields: List<GateField>, values: Map<String, String>): Map<String, String>? {
        val out = LinkedHashMap<String, String>()
        for (f in fields) {
            val v = values[f.id].orEmpty()
            if (v.isEmpty()) continue
            out[f.id] = when (f.kind) {
                GateField.Kind.RECOVERY_KEY -> normalizedRecoveryKey(v)
                GateField.Kind.CODE -> v.uppercase().trim()
                else -> v
            }
        }
        return out.ifEmpty { null }
    }

    // Onboarding (Onboarding.tsx).

    /** The six steps: key and name. */
    val STEPS = listOf("workspace" to "Welcome", "uses" to "Your pages", "style" to "Note theme", "appearance" to "Appearance", "ai" to "Foli AI", "welcome" to "Ready")

    fun stepIndex(step: String): Int {
        val key = mapOf("intro" to "workspace", "useCases" to "uses", "done" to "welcome")[step] ?: step
        return STEPS.indexOfFirst { it.first == key }.coerceAtLeast(0)
    }

    /** A step's heading; the first greets the person by first name when the page sends it (revision 36), as the web does. */
    fun heading(step: Int, firstName: String?): String =
        if (step == 0 && !firstName.isNullOrBlank()) "Welcome, ${firstName.trim()}." else HEADINGS[step]

    val HEADINGS = listOf(
        "Welcome to Folevi",
        "What will you use Folevi for?",
        "Pick a theme for your first page",
        "Light or dark?",
        "Meet Foli AI",
        "Your Folevi is ready.",
    )

    val LEDES = listOf(
        "Folevi is a notes app for documents, tasks and linked pages. Let’s set up your Personal space. It takes about a minute.",
        "Pick any that fit. Each one adds two starter pages made from Folevi’s templates, next to the pages we already made for you.",
        "A note theme gives a page its cover, paper and text colours. This one is for “Welcome to Folevi”. New pages start Plain.",
        "The app around your notes stays white, or near-black in dark mode, so your notes carry the colour. You can change this in Settings.",
        "It answers questions from your notes and links the notes it used, so you can check the answer.",
        "Here’s what we set up. Your Welcome page has a short tour and a few things to try.",
    )

    /** convex/lib/onboarding.ts USE_CASES: the artwork and the two starter pages each adds. */
    val USE_CASES = mapOf(
        "notes" to ("art-05" to listOf("Daily Page", "Brainstorm")),
        "work" to ("art-16" to listOf("Project Brief", "Meeting Notes")),
        "study" to ("art-38" to listOf("Class Notes", "Research Notes")),
        "journal" to ("art-09" to listOf("Journal Entry", "Habit Tracker")),
        "travel" to ("art-30" to listOf("Travel Plan", "Event Plan")),
        "team" to ("art-06" to listOf("Meeting Notes", "Retrospective")),
        "writing" to ("art-46" to listOf("Writing Draft", "Reading Notes")),
        "home" to ("art-24" to listOf("Monthly Budget", "Recipe")),
    )

    /** The note themes' names (packages/design-tokens/covers/covers.json) for the ones onboarding offers. */
    val STYLE_NAMES = mapOf(
        "plain" to "Plain",
        "art-01" to "Poppy print",
        "art-03" to "Irises",
        "art-09" to "Blossoms",
        "art-30" to "Summer sky",
        "art-39" to "Cypresses",
        "art-40" to "Wood thrush",
        "art-49" to "Aurora",
        "art-57" to "Neon silk",
    )

    fun styleName(id: String?): String = if (id.isNullOrEmpty() || id == "plain") "Plain" else STYLE_NAMES[id] ?: "Plain"

    /** "a, b and c". */
    fun listOf(items: List<String>): String = when (items.size) {
        0 -> ""
        1 -> items[0]
        else -> items.dropLast(1).joinToString(", ") + " and " + items.last()
    }

    /** The starter pages the picked uses add (each page once). */
    fun starterPages(picks: List<String>): List<String> = picks.flatMap { USE_CASES[it]?.second.orEmpty() }.distinct()

    /**
     * What "continue" sends on each step (the comment on OnboardingGateInfo): `useCases` as ids joined by commas,
     * `noteStyle`, `appearance`, `aiEnabled` "true" or "false"; nothing on Welcome.
     */
    fun onboardingValues(step: String, picks: List<String>, noteStyle: String, appearance: String, aiEnabled: Boolean): Map<String, String>? =
        when (STEPS[stepIndex(step)].first) {
            "uses" -> mapOf("useCases" to picks.joinToString(","))
            "style" -> if (noteStyle.isNotEmpty()) mapOf("noteStyle" to noteStyle) else null
            "appearance" -> mapOf("appearance" to appearance)
            "ai" -> mapOf("aiEnabled" to aiEnabled.toString())
            else -> null
        }
}

// ---------------------------------------------------------------- state and pressing

/** What's typed and pressed on the screen on show (GateModel). */
private class GateUi(first: GateChangedEvent) {
    val gate: MutableState<GateChangedEvent> = mutableStateOf(first)
    val values: SnapshotStateMap<String, String> = mutableStateMapOf()
    val pending: MutableState<String?> = mutableStateOf(null)
    val actError: MutableState<String?> = mutableStateOf(null)
    val method: MutableState<String?> = mutableStateOf(GateRules.methodActions(first).firstOrNull()?.id)
    val errorMessage: String? get() = actError.value ?: gate.value.error?.message
}

@Composable
private fun rememberGateUi(gate: GateChangedEvent): GateUi {
    // Typed values survive while the same screen and fields stay; a new payload of it replaces the last one.
    val ui = remember(gate.gate, gate.fields.map { it.id }) { GateUi(gate) }
    if (ui.gate.value !== gate) {
        ui.gate.value = gate
        // A new error from the engine replaces the last press's; a wrong secret is cleared for another try.
        if (gate.error != null) ui.actError.value = null
        if (gate.error?.code == "wrong_secret") gate.fields.filter { it.kind == GateField.Kind.SECRET || it.kind == GateField.Kind.RECOVERY_KEY }.forEach { ui.values[it.id] = "" }
        val methods = GateRules.methodActions(gate)
        if (methods.none { it.id == ui.method.value }) ui.method.value = methods.firstOrNull()?.id
    }
    return ui
}

/** Presses a gate button with the given values (or those typed). */
private class GatePress(val ui: GateUi, val press: (action: String, values: Map<String, String>?) -> Unit)

@Composable
private fun rememberPress(ui: GateUi, send: suspend (action: String, values: Map<String, String>?) -> Unit): GatePress {
    val scope = rememberCoroutineScope()
    return remember(ui, send) {
        GatePress(ui) { action, values ->
            if (ui.pending.value == null) {
                ui.pending.value = action
                ui.actError.value = null
                scope.launch {
                    try {
                        send(action, values)
                    } catch (e: EngineFailure) {
                        ui.actError.value = e.message
                    } catch (e: Exception) {
                        ui.actError.value = "That didn't work. Try again."
                    } finally {
                        ui.pending.value = null
                    }
                }
            }
        }
    }
}

/** The dedicated native screen for this gate (GateScreen picks it for every gate the web knows): `gate.act`. */
@Composable
internal fun NativeGate(gate: GateChangedEvent) {
    val session = LocalSession.current
    val send: suspend (String, Map<String, String>?) -> Unit = remember(session) { { action, values -> session.client.command(Commands.gateAct(action = action, values = values)) } }
    GateContent(gate, send)
}

/** The screen for `gate`, pressing through `send` (the engine's `gate.act`; tests record it). */
@Composable
internal fun GateContent(gate: GateChangedEvent, send: suspend (action: String, values: Map<String, String>?) -> Unit) {
    val ui = rememberGateUi(gate)
    val press = rememberPress(ui, send)
    val actions = gate.actions
    when (gate.gate) {
        "loading", null -> LoadingGate()
        "modeChoice" -> ModeChoiceGate(gate, ui, press)
        "librarySetup" -> if (actions.any { it.id == "open" }) LibraryReadyGate(gate, ui, press) else LibraryPlacesGate(gate, ui, press)
        "libraryLocked" -> LockedLibraryGate(gate, ui, press)
        "signedOut" -> SignInGate(gate, ui, press)
        "onboarding" -> if (gate.onboarding != null) OnboardingGate(gate, gate.onboarding!!, ui, press) else MessageCardGate(gate, ui, press)
        else -> MessageCardGate(gate, ui, press)
    }
}

// ---------------------------------------------------------------- shared pieces

/** The column every screen stands in: centred, `width` wide at most, scrolling when taller than the screen. */
@Composable
private fun GateColumn(width: Dp = 440.dp, gap: Dp = 24.dp, center: Boolean = true, content: @Composable ColumnScope.() -> Unit) {
    val p = LocalPalette.current
    BoxWithConstraints(Modifier.fillMaxSize().background(p.canvas)) {
        val tall = maxHeight
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
            Column(
                Modifier.fillMaxWidth().heightIn(min = tall).padding(horizontal = 24.dp, vertical = 32.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = if (center) Arrangement.Center else Arrangement.Top,
            ) {
                Column(Modifier.widthIn(max = width).fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(gap), content = content)
            }
        }
    }
}

/** The F of Folevi's mark (FoleviMark.swift, the brand file's 512-unit square). */
private val MARK_F = "M340.693 101.605C346.183 99.1649 352.396 98.8284 357.106 102.557C366.189 109.747 378.216 123.222 385.593 132.218C388.899 136.25 390.65 141.298 390.914 146.506C392.366 175.071 392.886 181.05 359.65 192.879C353.568 195.048 345.3 198.687 339.153 201.164L248.08 237.879C236.601 242.521 165.863 266.139 180.172 287.728C203.823 289.572 278.655 227.755 278.329 281.246C278.182 303.448 278.264 327.191 278.036 349.471C277.237 352.437 275.573 356.698 273.176 358.343C258.647 368.295 180.526 414.431 170.075 413.849C166.667 401.504 167.49 379.362 167.526 366.172C167.723 312.918 166.944 259.51 167.952 206.284C168.123 197.253 171.886 179.825 179.917 175.079C198.928 163.841 220.504 155.067 240.694 146.061Z"

/** Folevi's mark: the F on a disc (a white F on black; inverted in dark mode). */
@Composable
fun FoleviMark(size: Dp, modifier: Modifier = Modifier) {
    val dark = LocalPalette.current == FoleviPalette.Dark
    val path = remember { PathParser().parsePathString(MARK_F).toPath() }
    Canvas(modifier.size(size).semantics { contentDescription = "Folevi" }) {
        drawCircle(if (dark) Color.White else Color.Black)
        val k = this.size.minDimension / 512f
        drawContext.transform.scale(k, k, Offset.Zero)
        drawPath(path, if (dark) Color.Black else Color.White)
        drawContext.transform.scale(1 / k, 1 / k, Offset.Zero)
    }
}

/** The logo: the mark and "Folevi" in Spectral. */
@Composable
private fun FoleviLogo(height: Dp = 26.dp) {
    val p = LocalPalette.current
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(height * 0.28f), modifier = Modifier.semantics(mergeDescendants = true) { contentDescription = "Folevi" }) {
        FoleviMark(height)
        Text("Folevi", style = PhoneType.largeTitle.copy(fontSize = (height.value * 1.02f).sp, lineHeight = (height.value * 1.2f).sp, letterSpacing = 0.sp), color = p.heading)
    }
}

/** The logo, the title (balanced, Spectral) and its line. */
@Composable
private fun GateHeader(title: String, message: (@Composable () -> Unit)? = null) {
    val p = LocalPalette.current
    Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(20.dp)) {
        FoleviLogo()
        Text(title, style = GateType.title, color = p.heading, textAlign = TextAlign.Center, modifier = Modifier.semantics { heading() })
        message?.invoke()
    }
}

@Composable
private fun GateText(text: String, modifier: Modifier = Modifier, center: Boolean = true) {
    Text(text, style = PhoneType.body.copy(lineHeight = 24.sp), color = LocalPalette.current.inkMuted, textAlign = if (center) TextAlign.Center else TextAlign.Start, modifier = modifier.fillMaxWidth())
}

private object GateType {
    val title = PhoneType.largeTitle.copy(fontSize = 30.sp, lineHeight = 34.sp)
    val onboardingTitle = PhoneType.largeTitle.copy(fontSize = 34.sp, lineHeight = 36.sp)
}

/** A full-width button (Open Folevi, Unlock, Continue): 48 tall, the panel radius. */
@Composable
private fun GateButton(label: String, onClick: () -> Unit, modifier: Modifier = Modifier, style: GateAction.Style = GateAction.Style.PRIMARY, enabled: Boolean = true, busy: Boolean = false, leading: (@Composable () -> Unit)? = null, trailing: WebIcon? = null, fillWidth: Boolean = true) {
    val p = LocalPalette.current
    val c = phoneColors()
    val (fill, ink, edge) = when (style) {
        GateAction.Style.PRIMARY -> Triple(p.heading, p.canvas, Color.Transparent)
        GateAction.Style.SECONDARY -> Triple(p.surface, p.ink, p.line)
        GateAction.Style.DESTRUCTIVE -> Triple(p.surface, p.destructive, p.line)
        GateAction.Style.QUIET -> Triple(Color.Transparent, p.inkMuted, Color.Transparent)
    }
    val shape = PhoneRadius.panel
    Row(
        modifier.then(if (fillWidth) Modifier.fillMaxWidth() else Modifier).heightIn(min = 48.dp).alpha(if (enabled) 1f else 0.4f).clip(shape).background(fill, shape).border(1.dp, edge, shape)
            .clickable(enabled = enabled && !busy, role = Role.Button, onClick = onClick).padding(horizontal = 16.dp).testTag("gate-action-$label"),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (busy) { Spinner(16.dp, ink); Spacer(Modifier.width(8.dp)) } else if (leading != null) { leading(); Spacer(Modifier.width(10.dp)) }
        Text(label, style = PhoneType.headline.copy(fontWeight = if (style == GateAction.Style.QUIET) FontWeight.Medium else FontWeight.SemiBold), color = ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
        if (trailing != null && !busy) { Spacer(Modifier.width(8.dp)); FoleviIcon(trailing, null, size = 16.dp, tint = ink) }
    }
}

/** A quiet text button sized to its label (Back, Skip). */
@Composable
private fun GateTextButton(label: String, onClick: () -> Unit, enabled: Boolean = true, icon: WebIcon? = null, modifier: Modifier = Modifier) {
    val p = LocalPalette.current
    Row(
        modifier.heightIn(min = 48.dp).alpha(if (enabled) 1f else 0.4f).clip(PhoneRadius.control).clickable(enabled = enabled, role = Role.Button, onClick = onClick).padding(horizontal = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        if (icon != null) FoleviIcon(icon, null, size = 16.dp, tint = p.inkMuted)
        Text(label, style = PhoneType.body.copy(fontWeight = FontWeight.Medium), color = p.inkMuted)
    }
}

@Composable
private fun Spinner(size: Dp, color: Color) {
    val t = rememberInfiniteTransition(label = "spin")
    val angle by t.animateFloat(0f, 360f, infiniteRepeatable(tween(1000, easing = LinearEasing)), label = "angle")
    Box(Modifier.size(size), contentAlignment = Alignment.Center) {
        FoleviIcon(WebIcon.LOADER_CIRCLE, null, size = size, tint = color, modifier = Modifier.graphicsLayer { rotationZ = angle })
    }
}

/** The card the web draws for choices (--iphone-row, the container radius, a hairline and a soft shadow). */
private val CardShape = RoundedCornerShape(18.dp)

@Composable
private fun Modifier.gateCard(shape: androidx.compose.ui.graphics.Shape = CardShape, selected: Boolean = false): Modifier {
    val p = LocalPalette.current
    return this
        .dropShadow(shape, Shadow(radius = if (selected) 22.dp else 2.dp, spread = if (selected) (-10).dp else 0.dp, offset = DpOffset(0.dp, if (selected) 8.dp else 1.dp), color = Color.Black.copy(alpha = if (selected) 0.25f else 0.04f)))
        .background(p.surface, shape)
        .border(if (selected) 1.5.dp else 1.dp, if (selected) p.heading else p.line, shape)
}

/** A choice card (ModeChoice.tsx ChoiceButton on the phone): the 40 tile, the title over its line, the chevron. */
@Composable
private fun ChoiceCard(title: String, detail: String, onClick: () -> Unit, recommended: Boolean = false, busy: Boolean = false, enabled: Boolean = true, tag: String = "", icon: @Composable () -> Unit) {
    val p = LocalPalette.current
    Row(
        Modifier.fillMaxWidth().heightIn(min = 72.dp).alpha(if (enabled) 1f else 0.6f).gateCard().clip(CardShape)
            .clickable(enabled = enabled && !busy, role = Role.Button, onClick = onClick).padding(horizontal = 14.dp, vertical = 12.dp).testTag(tag),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Box(Modifier.size(40.dp).clip(PhoneRadius.control).background(p.surfaceSunken), contentAlignment = Alignment.Center) { icon() }
        Column(Modifier.weight(1f)) {
            if (recommended) Text("RECOMMENDED", style = PhoneType.caption2.copy(fontWeight = FontWeight.SemiBold, letterSpacing = 0.6.sp), color = p.accent)
            Text(title, style = PhoneType.headline, color = p.heading)
            if (detail.isNotEmpty()) Text(detail, style = PhoneType.subheadline, color = p.inkMuted, modifier = Modifier.padding(top = 2.dp))
        }
        if (busy) Spinner(18.dp, p.inkFaint) else FoleviIcon(WebIcon.CHEVRON_RIGHT, null, size = 18.dp, tint = p.inkFaint)
    }
}

/** A soft red panel for a problem (PlaceList's). */
@Composable
private fun GateProblem(text: String) {
    val p = LocalPalette.current
    Text(text, style = PhoneType.body, color = p.ink, modifier = Modifier.fillMaxWidth().clip(PhoneRadius.control).background(p.destructive.copy(alpha = 0.09f)).padding(horizontal = 14.dp, vertical = 12.dp).testTag("gate-error"))
}

/** A field drawn as the web's input: 48 tall, the control radius, a hairline. */
@Composable
private fun GateInput(value: String, onChange: (String) -> Unit, label: String, placeholder: String = "", secret: Boolean = false, onDone: () -> Unit = {}, tag: String = "") {
    val p = LocalPalette.current
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        if (label.isNotEmpty()) Text(label, style = PhoneType.subheadline, color = p.inkMuted)
        Box(Modifier.fillMaxWidth().heightIn(min = 48.dp).clip(PhoneRadius.control).background(p.surface).border(1.dp, p.lineStrong, PhoneRadius.control).padding(horizontal = 14.dp), contentAlignment = Alignment.CenterStart) {
            if (value.isEmpty() && placeholder.isNotEmpty()) Text(placeholder, style = PhoneType.body, color = p.inkFaint)
            BasicTextField(
                value, onChange, singleLine = true, textStyle = PhoneType.body.copy(color = p.ink), cursorBrush = SolidColor(p.accent),
                visualTransformation = if (secret) PasswordVisualTransformation() else VisualTransformation.None,
                keyboardOptions = KeyboardOptions(keyboardType = if (secret) KeyboardType.Password else KeyboardType.Text, imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { onDone() }),
                modifier = Modifier.fillMaxWidth().semantics { contentDescription = label.ifEmpty { placeholder } }.testTag(tag),
            )
        }
    }
}

/** A Folevi switch: 40 by 24, the heading color when on. */
@Composable
private fun GateSwitch(on: Boolean, onChange: (Boolean) -> Unit, label: String) {
    val p = LocalPalette.current
    val c = phoneColors()
    Box(
        Modifier.size(width = 44.dp, height = 26.dp).clip(CircleShape).background(if (on) p.heading else c.ink(0.16f))
            .clickable(role = Role.Switch, onClickLabel = label) { onChange(!on) }.semantics { contentDescription = label; stateDescription = if (on) "On" else "Off" }.padding(3.dp),
        contentAlignment = if (on) Alignment.CenterEnd else Alignment.CenterStart,
    ) {
        Box(Modifier.size(20.dp).dropShadow(CircleShape, Shadow(radius = 2.dp, offset = DpOffset(0.dp, 1.dp), color = Color.Black.copy(alpha = 0.2f))).background(Color.White, CircleShape))
    }
}

/** A checkbox: 18 with a tick on the heading color. */
@Composable
private fun GateCheckbox(on: Boolean, onChange: (Boolean) -> Unit, label: String) {
    val p = LocalPalette.current
    Row(Modifier.fillMaxWidth().clickable(role = Role.Checkbox) { onChange(!on) }.semantics { stateDescription = if (on) "Checked" else "Not checked" }.padding(vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Box(Modifier.padding(top = 2.dp).size(18.dp).clip(RoundedCornerShape(4.dp)).background(if (on) p.heading else Color.Transparent).border(1.5.dp, if (on) Color.Transparent else p.inkMuted, RoundedCornerShape(4.dp)), contentAlignment = Alignment.Center) {
            if (on) FoleviIcon(WebIcon.CHECK, null, size = 13.dp, tint = p.canvas)
        }
        Text(label, style = PhoneType.subheadline, color = p.ink)
    }
}

@Composable
private fun BusyBar() {
    val p = LocalPalette.current
    val t = rememberInfiniteTransition(label = "busy")
    val x by t.animateFloat(-0.33f, 1f, infiniteRepeatable(tween(1200), RepeatMode.Restart), label = "x")
    BoxWithConstraints(Modifier.fillMaxWidth().height(4.dp).clip(RoundedCornerShape(2.dp)).background(p.ink.copy(alpha = 0.06f))) {
        Box(Modifier.width(maxWidth / 3).fillMaxHeight().offset(x = maxWidth * x).clip(RoundedCornerShape(2.dp)).background(p.ink.copy(alpha = 0.7f)))
    }
}

@Composable
private fun ProgressBar(progress: GateProgress) {
    val p = LocalPalette.current
    val total = progress.total
    val fraction = if (total != null && total > 0) (progress.done.toFloat() / total).coerceIn(0f, 1f) else 0f
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Box(Modifier.fillMaxWidth().height(4.dp).clip(RoundedCornerShape(2.dp)).background(p.ink.copy(alpha = 0.06f))) {
            Box(Modifier.fillMaxWidth(fraction).fillMaxHeight().background(p.heading))
        }
        if (progress.label.isNotEmpty()) Text(progress.label, style = PhoneType.subheadline, color = p.inkMuted)
    }
}

// ---------------------------------------------------------------- the screens

@Composable
private fun LoadingGate() {
    val p = LocalPalette.current
    Box(Modifier.fillMaxSize().background(p.canvas).testTag("gate-loading"), contentAlignment = Alignment.Center) {
        Column(Modifier.width(220.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(18.dp)) {
            FoleviMark(44.dp)
            Text("Opening your folio…", style = PhoneType.subheadline, color = p.inkMuted)
            BusyBar()
        }
    }
}

@Composable
private fun ModeChoiceGate(gate: GateChangedEvent, ui: GateUi, press: GatePress) {
    val p = LocalPalette.current
    GateColumn(gap = 28.dp) {
        GateHeader(GateRules.title(gate))
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            for (a in gate.actions) {
                val account = a.id == "account"
                ChoiceCard(
                    a.label, GateRules.modeDetail(a.id), onClick = { press.press(a.id, null) }, recommended = account,
                    busy = ui.pending.value == a.id, enabled = a.enabled && ui.pending.value == null, tag = "gate-choice-${a.id}",
                ) { if (account) FoleviMark(24.dp) else FoleviIcon(WebIcon.HARD_DRIVE, null, size = 20.dp, tint = p.heading) }
            }
        }
        val message = GateRules.message(gate)
        if (message.isNotEmpty()) Text(message, style = PhoneType.footnote, color = p.inkFaint, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
        ui.errorMessage?.let { Text(it, style = PhoneType.footnote, color = p.destructive, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth()) }
    }
}

/** The places' icons (LibrarySetup.tsx), Dropbox's and Google Drive's as the web's outline marks. */
@Composable
private fun PlaceIcon(kind: String) {
    val p = LocalPalette.current
    when (kind) {
        "folder" -> FoleviIcon(WebIcon.FOLDER, null, size = 20.dp, tint = p.heading)
        "dropbox" -> OutlineGlyph("M7 3.5 2.5 6.5 7 9.5l5-3zM17 3.5l-5 3 5 3 4.5-3zM2.5 12.5 7 15.5l5-3-5-3zM17 9.5l-5 3 5 3 4.5-3zM7 17l5 3.5 5-3.5-5-3z")
        "gdrive" -> OutlineGlyph("M8.5 3.5h7l6 10.5-3.5 6h-12L2.5 14zM8.5 3.5l6 10.5H2.5M15.5 3.5 9.5 14l-3.5 6M21.5 14h-7l3.5 6")
        "icloud" -> FoleviIcon(WebIcon.CLOUD, null, size = 20.dp, tint = p.heading)
        else -> FoleviIcon(WebIcon.HARD_DRIVE, null, size = 20.dp, tint = p.heading)
    }
}

@Composable
private fun OutlineGlyph(d: String) {
    val p = LocalPalette.current
    val path = remember(d) { PathParser().parsePathString(d).toPath() }
    Canvas(Modifier.size(20.dp)) {
        val k = size.minDimension / 24f
        drawContext.transform.scale(k, k, Offset.Zero)
        drawPath(path, p.heading, style = androidx.compose.ui.graphics.drawscope.Stroke(width = 1.8f, join = androidx.compose.ui.graphics.StrokeJoin.Round))
        drawContext.transform.scale(1 / k, 1 / k, Offset.Zero)
    }
}

@Composable
private fun LibraryPlacesGate(gate: GateChangedEvent, ui: GateUi, press: GatePress) {
    GateColumn(gap = 24.dp) {
        GateHeader(GateRules.title(gate)) { GateText("If your library is already there, Folevi opens it.") }
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            for (a in gate.actions.filter { it.id.startsWith("place:") }) {
                val kind = a.id.removePrefix("place:")
                ChoiceCard(a.label, GateRules.placeDetail(kind), onClick = { press.press(a.id, null) }, busy = ui.pending.value == a.id, enabled = a.enabled && ui.pending.value == null, tag = "place-$kind") { PlaceIcon(kind) }
            }
            ui.errorMessage?.let { GateProblem(it) }
        }
        gate.actions.firstOrNull { it.id == "back" }?.let { back ->
            Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) { GateTextButton(back.label, { press.press("back", null) }, enabled = ui.pending.value == null, icon = WebIcon.ARROW_LEFT) }
        }
    }
}

/** "Your library is ready": the optional passphrase card, Open Folevi, Choose another place (NewLibrary). */
@Composable
private fun LibraryReadyGate(gate: GateChangedEvent, ui: GateUi, press: GatePress) {
    val p = LocalPalette.current
    var encrypt by remember { mutableStateOf(false) }
    var confirm by remember { mutableStateOf("") }
    var understood by remember { mutableStateOf(false) }
    var problem by remember { mutableStateOf<String?>(null) }
    val message = GateRules.message(gate)
    val path = message.removePrefix("Folevi keeps your notes as files in ").trimEnd('.')
    val hasPassphrase = gate.fields.any { it.id == "passphrase" }
    val open = {
        if (encrypt) {
            val pass = ui.values["passphrase"].orEmpty()
            problem = when {
                pass.length < 8 -> "Use at least 8 characters."
                pass != confirm -> "The two passphrases don't match."
                !understood -> "Tick the box to say you understand a lost passphrase can't be recovered."
                else -> null
            }
            if (problem == null) press.press("open", mapOf("passphrase" to pass))
        } else press.press("open", null)
    }
    GateColumn(gap = 24.dp) {
        GateHeader(GateRules.title(gate)) {
            if (message.startsWith("Folevi keeps your notes as files in ")) {
                Text(
                    buildAnnotatedString {
                        append("Folevi keeps your notes as files in ")
                        withStyle(SpanStyle(fontWeight = FontWeight.Medium, color = p.heading)) { append(path) }
                        append(".")
                    },
                    style = PhoneType.body.copy(lineHeight = 24.sp), color = p.inkMuted, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth(),
                )
            } else if (message.isNotEmpty()) GateText(message)
        }
        if (hasPassphrase) {
            Column(Modifier.fillMaxWidth().gateCard().padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Box(Modifier.size(36.dp).clip(PhoneRadius.control).background(p.surfaceSunken), contentAlignment = Alignment.Center) { FoleviIcon(WebIcon.LOCK, null, size = 18.dp, tint = p.heading) }
                    Column(Modifier.weight(1f)) {
                        Text("Encrypt with a passphrase", style = PhoneType.headline, color = p.heading)
                        Text(if (message.endsWith("only.") || message.contains("this phone")) "Optional. No one can read the files without it." else "Optional. No one can read the synced copy without it.", style = PhoneType.subheadline, color = p.inkMuted)
                    }
                    GateSwitch(encrypt, { encrypt = it; problem = null; if (!it) ui.values["passphrase"] = "" }, "Encrypt with a passphrase")
                }
                if (encrypt) {
                    Row(Modifier.fillMaxWidth().clip(PhoneRadius.control).background(p.destructive.copy(alpha = 0.09f)).padding(horizontal = 14.dp, vertical = 12.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        FoleviIcon(WebIcon.SHIELD_ALERT, null, size = 18.dp, tint = p.destructive)
                        Text(buildAnnotatedString {
                            withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) { append("If you lose this passphrase, nobody can open the synced copy of your notes.") }
                            append(" Folevi can't reset it or recover it. Write it down and keep it somewhere safe.")
                        }, style = PhoneType.subheadline, color = p.ink)
                    }
                    GateInput(ui.values["passphrase"].orEmpty(), { ui.values["passphrase"] = it; problem = null }, "Passphrase", secret = true, tag = "gate-field-passphrase")
                    GateInput(confirm, { confirm = it; problem = null }, "Type it again", secret = true)
                    Text("Use at least 8 characters. A few unrelated words are easy to remember and hard to guess.", style = PhoneType.footnote, color = p.inkMuted)
                    GateCheckbox(understood, { understood = it; problem = null }, "I understand Folevi can't recover a lost passphrase")
                    problem?.let { Text(it, style = PhoneType.subheadline, color = p.destructive) }
                }
            }
        }
        ui.errorMessage?.let { Text(it, style = PhoneType.subheadline, color = p.destructive, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth()) }
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            GateButton(if (ui.pending.value == "open" && encrypt) "Encrypting…" else "Open Folevi", open, busy = ui.pending.value == "open", enabled = ui.pending.value == null)
            if (gate.actions.any { it.id == "elsewhere" }) GateButton("Choose another place", { press.press("elsewhere", null) }, style = GateAction.Style.SECONDARY, enabled = ui.pending.value == null)
        }
    }
}

@Composable
private fun LockedLibraryGate(gate: GateChangedEvent, ui: GateUi, press: GatePress) {
    val p = LocalPalette.current
    var help by remember { mutableStateOf(false) }
    val where = GateRules.message(gate)
    val tail = " is encrypted. Folevi needs the passphrase once on this phone to read it."
    val unlock = { if (ui.values["passphrase"].orEmpty().isNotEmpty()) press.press("unlock", GateRules.valuesToSend(gate.fields, ui.values)) }
    GateColumn(gap = 24.dp) {
        Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(20.dp)) {
            FoleviLogo()
            Box(Modifier.size(48.dp).clip(RoundedCornerShape(12.dp)).background(p.surfaceSunken), contentAlignment = Alignment.Center) { FoleviIcon(WebIcon.LOCK, null, size = 22.dp, tint = p.heading) }
            Text("Enter your library's passphrase", style = GateType.title, color = p.heading, textAlign = TextAlign.Center, modifier = Modifier.semantics { heading() })
            Text(
                buildAnnotatedString {
                    if (where.isEmpty()) append("This library$tail") else {
                        append("This library in ")
                        withStyle(SpanStyle(fontWeight = FontWeight.Medium, color = p.heading)) { append(where) }
                        append(tail)
                    }
                },
                style = PhoneType.body.copy(lineHeight = 24.sp), color = p.inkMuted, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth(),
            )
        }
        GateInput(ui.values["passphrase"].orEmpty(), { ui.values["passphrase"] = it }, "Passphrase", secret = true, onDone = unlock, tag = "gate-field-passphrase")
        ui.errorMessage?.let { Text(it, style = PhoneType.subheadline, color = p.destructive, modifier = Modifier.testTag("gate-error")) }
        GateButton("Unlock", unlock, busy = ui.pending.value == "unlock", enabled = ui.pending.value == null)
        Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
            GateTextButton("Forgot the passphrase?", { help = !help })
            if (help) GateText("Nobody can reset it, Folevi included. If another device still opens this library, change the passphrase there in Settings, under Library. Without any device that opens it, the synced copy can't be read.")
        }
    }
}

/** Google's G (GoogleMark in SocialSignIn.tsx), in its four colours, on a 48-unit square. */
@Composable
private fun GoogleMark(size: Dp = 18.dp) {
    val parts = remember {
        listOf(
            "M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" to Color(0xFFEA4335),
            "M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" to Color(0xFF4285F4),
            "M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" to Color(0xFFFBBC05),
            "M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" to Color(0xFF34A853),
        ).map { (d, c) -> PathParser().parsePathString(d).toPath() to c }
    }
    Canvas(Modifier.size(size)) {
        val k = this.size.minDimension / 48f
        drawContext.transform.scale(k, k, Offset.Zero)
        for ((path, color) in parts) drawPath(path, color)
        drawContext.transform.scale(1 / k, 1 / k, Offset.Zero)
    }
}

private const val APPLE_MARK = "M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701"

@Composable
private fun AppleMark(color: Color) {
    val path = remember { PathParser().parsePathString(APPLE_MARK).toPath() }
    Canvas(Modifier.size(17.dp)) {
        val k = size.minDimension / 24f
        drawContext.transform.scale(k, k, Offset.Zero)
        drawPath(path, color)
        drawContext.transform.scale(1 / k, 1 / k, Offset.Zero)
    }
}

/** ShellSignIn on a phone: the logo, the title and its line, the buttons, then "Your own server". */
@Composable
private fun SignInGate(gate: GateChangedEvent, ui: GateUi, press: GatePress) {
    val p = LocalPalette.current
    val dark = p == FoleviPalette.Dark
    GateColumn(gap = 24.dp) {
        GateHeader(GateRules.title(gate)) { val m = GateRules.message(gate); if (m.isNotEmpty()) GateText(m) }
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            for (a in gate.actions) {
                val enabled = ui.pending.value == null && (a.enabled || a.id == "apple")
                when (a.id) {
                    "apple" -> {
                        // Apple's own button: black (white in dark), the system font.
                        val fill = if (dark) Color.White else Color.Black
                        val ink = if (dark) Color.Black else Color.White
                        Row(
                            Modifier.fillMaxWidth().heightIn(min = 48.dp).clip(PhoneRadius.panel).background(fill).clickable(enabled = enabled, role = Role.Button) { press.press(a.id, null) }.testTag("gate-action-apple"),
                            horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically,
                        ) {
                            if (!a.enabled) Spinner(16.dp, ink) else AppleMark(ink)
                            Spacer(Modifier.width(8.dp))
                            Text(a.label, style = PhoneType.headline.copy(fontFamily = FontFamily.Default, fontWeight = FontWeight.Medium), color = ink)
                        }
                    }
                    "google" -> GateButton(a.label, { press.press(a.id, null) }, style = GateAction.Style.SECONDARY, enabled = enabled, leading = { GoogleMark() })
                    "local" -> GateButton(a.label, { press.press(a.id, null) }, style = GateAction.Style.QUIET, enabled = enabled)
                    "waiting" -> GateButton(a.label, {}, style = GateAction.Style.SECONDARY, enabled = false)
                    else -> GateButton(a.label, { press.press(a.id, null) }, style = if (a.style == GateAction.Style.PRIMARY) GateAction.Style.PRIMARY else GateAction.Style.SECONDARY, enabled = enabled, busy = ui.pending.value == a.id)
                }
            }
            ui.errorMessage?.let { Text(it, style = PhoneType.subheadline, color = p.inkMuted, modifier = Modifier.testTag("gate-error")) }
        }
        // "Your own server" under Folevi Cloud's sign-in, as on the web (OwnServer.kt); not on a server's own screen.
        if (runCatching { com.folevi.android.FoleviApp.instance.places.actingServer == null }.getOrDefault(false)) OwnServerSignIn()
    }
}

/** lib/app/state.tsx FullPageMessage: a card with the title, the text and what the gate offers. */
@Composable
private fun MessageCardGate(gate: GateChangedEvent, ui: GateUi, press: GatePress) {
    val p = LocalPalette.current
    val method = ui.method.value
    val fields = GateRules.visibleFields(gate, method)
    val actions = GateRules.visibleActions(gate, method).filterNot { it.id.startsWith("signOut:") }
    val others = GateRules.methodActions(gate).filter { it.id != method }
    val send = { id: String -> press.press(id, GateRules.valuesToSend(fields, ui.values)) }
    val pressPrimary = { actions.firstOrNull { it.style == GateAction.Style.PRIMARY && GateRules.isEnabled(gate, it, ui.values, ui.pending.value) }?.let { send(it.id) } }
    GateColumn(width = 400.dp, gap = 0.dp) {
        Column(Modifier.fillMaxWidth().gateCard().padding(24.dp).testTag("gate-card-${gate.gate}"), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(GateRules.title(gate), style = GateType.title.copy(fontSize = 26.sp, lineHeight = 30.sp), color = p.heading, modifier = Modifier.semantics { heading() })
            GateRules.message(gate).takeIf { it.isNotEmpty() }?.let { Text(it, style = PhoneType.body.copy(lineHeight = 24.sp), color = p.inkMuted) }
            if (gate.busy && gate.progress == null && gate.actions.isEmpty()) Box(Modifier.padding(top = 12.dp)) { BusyBar() }
            gate.progress?.let { Box(Modifier.padding(top = 12.dp)) { ProgressBar(it) } }
            gate.migration?.let { m ->
                Text(
                    GateRules.listOf(listOfNotNull(
                        "${m.notes} ${if (m.notes == 1L) "note" else "notes"}",
                        m.folders.takeIf { it > 0 }?.let { "$it ${if (it == 1L) "folder" else "folders"}" },
                        m.tags.takeIf { it > 0 }?.let { "$it ${if (it == 1L) "tag" else "tags"}" },
                        m.files.takeIf { it > 0 }?.let { "$it ${if (it == 1L) "file" else "files"}" },
                    )),
                    style = PhoneType.subheadline, color = p.ink, modifier = Modifier.fillMaxWidth().clip(PhoneRadius.control).background(p.surfaceSunken).padding(12.dp),
                )
            }
            gate.deviceLimit?.let { d ->
                for (device in d.devices) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(device.label, style = PhoneType.body.copy(fontWeight = FontWeight.SemiBold), color = p.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text("Last seen ${relativeAgeAt(device.lastSeenAt, System.currentTimeMillis()).replaceFirstChar { it.lowercase() }}", style = PhoneType.subheadline, color = p.inkMuted)
                        }
                        GateTextButton("Sign out", { press.press("signOut:${device.id}", null) }, enabled = ui.pending.value == null)
                    }
                }
            }
            gate.e2ee?.recoveryKey?.let { key ->
                Text(key, style = PhoneType.body.copy(fontFamily = FontFamily.Monospace), color = p.ink, modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(p.ink.copy(alpha = 0.05f)).padding(12.dp))
            }
            for (f in fields) {
                GateInput(ui.values[f.id].orEmpty(), { ui.values[f.id] = it }, f.label, f.placeholder, secret = f.kind == GateField.Kind.SECRET, onDone = { pressPrimary() }, tag = "gate-field-${f.id}")
            }
            if (actions.isNotEmpty()) {
                Column(Modifier.padding(top = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    for (a in actions) GateButton(a.label, { send(a.id) }, style = a.style, enabled = GateRules.isEnabled(gate, a, ui.values, ui.pending.value), busy = ui.pending.value == a.id)
                }
            }
            for (m in others) GateTextButton(if (m.id == "passphrase") "Use passphrase instead" else m.label, { ui.method.value = m.id; ui.actError.value = null })
            ui.errorMessage?.let { Text(it, style = PhoneType.subheadline, color = p.destructive, modifier = Modifier.testTag("gate-error")) }
        }
    }
}

// ---------------------------------------------------------------- onboarding

/** A cover's thumbnail from the app's own copy of the web (assets/public/covers/<id>-thumb.webp). */
@Composable
private fun rememberCover(id: String?): ImageBitmap? {
    val context = LocalContext.current
    return remember(id) {
        if (id.isNullOrEmpty() || id == "plain") null
        else runCatching { context.assets.open("public/covers/$id-thumb.webp").use { BitmapFactory.decodeStream(it)?.asImageBitmap() } }.getOrNull()
    }
}

@Composable
private fun Cover(id: String?, modifier: Modifier) {
    val p = LocalPalette.current
    val image = rememberCover(id)
    if (image != null) Image(image, null, modifier, contentScale = ContentScale.Crop)
    else Box(modifier.background(if (id.isNullOrEmpty() || id == "plain") p.surface else p.accentSoft))
}

@Composable
private fun OnboardingGate(gate: GateChangedEvent, info: OnboardingGateInfo, ui: GateUi, press: GatePress) {
    val p = LocalPalette.current
    val c = phoneColors()
    val step = GateRules.stepIndex(info.step)
    val last = GateRules.STEPS.lastIndex
    val picks = remember(info.step) { mutableStateListOf<String>().apply { addAll(info.useCases) } }
    var style by remember(info.step) { mutableStateOf(info.noteStyle.ifEmpty { "plain" }) }
    var look by remember(info.step) { mutableStateOf(info.appearance.ifEmpty { "system" }) }
    var ai by remember(info.step) { mutableStateOf(info.aiEnabled) }
    val busy = gate.busy || ui.pending.value != null
    val has = { id: String -> gate.actions.any { it.id == id } }
    val cont = {
        if (has("finish")) press.press("finish", null)
        else press.press("continue", GateRules.onboardingValues(info.step, picks.toList(), style, look, ai))
    }
    Column(Modifier.fillMaxSize().background(p.canvas).testTag("gate-onboarding-${GateRules.STEPS[step].first}")) {
        // The step's content, centred and 440 wide at most (a tablet, a phone on its side).
        Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()), horizontalAlignment = Alignment.CenterHorizontally) {
        Column(Modifier.widthIn(max = 440.dp).fillMaxWidth().padding(horizontal = 20.dp)) {
            // The logo and Skip setup.
            Row(Modifier.fillMaxWidth().padding(top = 12.dp).heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically) {
                FoleviLogo()
                Spacer(Modifier.weight(1f))
                if (step < last && has("skipAll")) GateTextButton("Skip setup", { press.press("skipAll", null) }, enabled = !busy)
            }
            // The progress: six segments, the done ones filled, the current one half.
            Row(Modifier.fillMaxWidth().padding(top = 20.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                GateRules.STEPS.forEachIndexed { i, _ ->
                    Box(Modifier.weight(1f).height(3.dp).clip(RoundedCornerShape(2.dp)).background(p.heading.copy(alpha = 0.12f))) {
                        if (i <= step) Box(Modifier.fillMaxSize().background(p.heading.copy(alpha = if (i == step) 0.45f else 1f)))
                    }
                }
            }
            Text(
                buildAnnotatedString {
                    withStyle(SpanStyle(color = p.heading)) { append("${step + 1}") }
                    append(" of ${GateRules.STEPS.size} · ${GateRules.STEPS[step].second}")
                },
                style = PhoneType.subheadline.copy(fontWeight = FontWeight.Medium), color = p.inkMuted, modifier = Modifier.padding(top = 12.dp).semantics { contentDescription = "Step ${step + 1} of ${GateRules.STEPS.size}: ${GateRules.STEPS[step].second}" },
            )
            Spacer(Modifier.height(28.dp))
            if (step == 4) {
                Box(Modifier.padding(bottom = 20.dp).size(56.dp).gateCard(RoundedCornerShape(18.dp)), contentAlignment = Alignment.Center) { AiMark(30.dp) }
            }
            Text(GateRules.heading(step, info.firstName), style = GateType.onboardingTitle, color = p.heading, modifier = Modifier.semantics { heading() })
            Text(GateRules.LEDES[step], style = PhoneType.body.copy(lineHeight = 26.sp), color = p.inkMuted, modifier = Modifier.padding(top = 14.dp))
            Spacer(Modifier.height(28.dp))
            when (step) {
                0 -> FactList(listOf(
                    Fact(WebIcon.WIFI_OFF, "Works offline", "Your writing is saved on this device first, and syncs when you reconnect."),
                    Fact(WebIcon.LINK_2, "Pages that link up", "Type [[ to link one page to another. The page you link to shows a backlink."),
                    Fact(WebIcon.USERS, "Yours, and easy to share", "Personal is your own space. Share single pages with anyone, or start a workspace for a team any time."),
                ))
                1 -> UseCases(info, picks)
                2 -> Styles(info, style) { style = it }
                3 -> {
                    Appearances(look, style.takeIf { it != "plain" }) { look = it }
                    Text("Match system follows your device, so Folevi turns dark when your device does.", style = PhoneType.subheadline, color = p.inkMuted, modifier = Modifier.padding(top = 16.dp))
                }
                4 -> AiChoice(ai) { ai = it }
                else -> Summary(info)
            }
            ui.errorMessage?.let { Text(it, style = PhoneType.subheadline, color = p.destructive, modifier = Modifier.padding(top = 20.dp).testTag("gate-error")) }
            Spacer(Modifier.height(32.dp))
        }
        }
        // The footer: Back, Skip, and Continue (Get started on the first step, Open "Welcome to Folevi" on the last).
        Box(Modifier.fillMaxWidth().height(0.5.dp).background(p.line))
        Row(Modifier.fillMaxWidth().background(p.canvas.copy(alpha = 0.9f)).padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (step > 0 && has("back")) GateTextButton("Back", { press.press("back", null) }, enabled = !busy, icon = WebIcon.ARROW_LEFT)
            Spacer(Modifier.weight(1f))
            if (step in 1 until last && has("skip")) GateTextButton("Skip", { press.press("skip", null) }, enabled = !busy)
            GateButton(
                when (step) { 0 -> "Get started"; last -> "Open “Welcome to Folevi”"; else -> "Continue" },
                cont, modifier = Modifier.widthIn(min = 112.dp).testTag("onboarding-continue"),
                enabled = !busy, busy = ui.pending.value == "continue" || ui.pending.value == "finish", trailing = WebIcon.ARROW_RIGHT, fillWidth = false,
            )
        }
    }
}

private data class Fact(val icon: WebIcon?, val title: String, val body: String)

@Composable
private fun FactList(items: List<Fact>) {
    val p = LocalPalette.current
    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        for (f in items) {
            Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                Box(Modifier.size(36.dp).gateCard(PhoneRadius.control), contentAlignment = Alignment.Center) {
                    if (f.icon != null) FoleviIcon(f.icon, null, size = 17.dp, tint = p.heading) else AiMark(17.dp)
                }
                Column(Modifier.weight(1f).padding(top = 2.dp)) {
                    Text(f.title, style = PhoneType.headline, color = p.heading)
                    Text(f.body, style = PhoneType.body.copy(lineHeight = 24.sp), color = p.inkMuted, modifier = Modifier.padding(top = 2.dp))
                }
            }
        }
    }
}

/** A check in a choice: 18, filled with the heading color and a tick when on. */
@Composable
private fun ChoiceCheck(on: Boolean) {
    val p = LocalPalette.current
    Box(
        Modifier.size(18.dp).clip(RoundedCornerShape(4.dp)).background(if (on) p.heading else Color.Transparent).border(1.dp, if (on) Color.Transparent else p.lineStrong, RoundedCornerShape(4.dp)),
        contentAlignment = Alignment.Center,
    ) { if (on) FoleviIcon(WebIcon.CHECK, null, size = 12.dp, tint = p.canvas) }
}

@Composable
private fun UseCases(info: OnboardingGateInfo, picks: MutableList<String>) {
    val p = LocalPalette.current
    val applied = info.useCases
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        for (u in info.useCaseOptions) {
            val on = u.id in picks
            val added = false
            val (art, pages) = GateRules.USE_CASES[u.id] ?: (null to emptyList())
            Row(
                Modifier.fillMaxWidth().gateCard(PhoneRadius.control, selected = on).clip(PhoneRadius.control)
                    .clickable(role = Role.Checkbox, enabled = !added) { if (on) picks.remove(u.id) else picks.add(u.id) }
                    .semantics { selected = on; stateDescription = if (on) "Picked" else "Not picked" }.padding(start = 8.dp, top = 8.dp, bottom = 8.dp, end = 12.dp).testTag("use-${u.id}"),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Cover(art, Modifier.size(48.dp).clip(PhoneRadius.control))
                Column(Modifier.weight(1f)) {
                    Text(u.label, style = PhoneType.headline, color = p.heading)
                    if (pages.isNotEmpty()) Text(GateRules.listOf(pages), style = PhoneType.subheadline, color = p.inkMuted, modifier = Modifier.padding(top = 2.dp))
                }
                ChoiceCheck(on)
            }
        }
    }
    val pages = GateRules.starterPages(picks)
    Text(
        when {
            pages.isNotEmpty() -> "Adds ${pages.size} ${if (pages.size == 1) "page" else "pages"}: ${GateRules.listOf(pages)}."
            applied.isNotEmpty() -> "Those pages are in your Personal."
            else -> "Nothing picked yet. You can skip this and add templates any time."
        },
        style = PhoneType.subheadline, color = p.inkMuted, modifier = Modifier.padding(top = 16.dp),
    )
}

@Composable
private fun Styles(info: OnboardingGateInfo, value: String, onPick: (String) -> Unit) {
    val p = LocalPalette.current
    val ids = info.noteStyleOptions.ifEmpty { listOf("plain") }.let { if ("plain" in it) it else listOf("plain") + it }
    Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
        ids.chunked(3).forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                for (id in row) {
                    val on = id == value
                    Column(Modifier.weight(1f).clickable(role = Role.RadioButton) { onPick(id) }.semantics { selected = on }.testTag("style-$id")) {
                        Box(
                            Modifier.fillMaxWidth().aspectRatio(4f / 3f)
                                .then(if (on) Modifier.border(2.dp, p.canvas, PhoneRadius.control).padding(2.dp).border(2.dp, p.heading, PhoneRadius.control) else Modifier)
                                .clip(PhoneRadius.control).border(1.dp, Color.Black.copy(alpha = 0.08f), PhoneRadius.control),
                        ) {
                            if (id == "plain") Box(Modifier.fillMaxSize().background(p.surface).border(1.dp, p.line, PhoneRadius.control), contentAlignment = Alignment.Center) {
                                Text("Aa", style = PhoneType.title2Serif.copy(fontSize = 28.sp), color = p.heading)
                            } else Cover(id, Modifier.fillMaxSize())
                            if (on) Box(Modifier.align(Alignment.TopEnd).padding(7.dp).size(22.dp).background(p.heading, CircleShape), contentAlignment = Alignment.Center) {
                                FoleviIcon(WebIcon.CHECK, null, size = 13.dp, tint = p.canvas)
                            }
                        }
                        Text(GateRules.styleName(id), style = PhoneType.subheadline.copy(fontWeight = FontWeight.Medium), color = p.ink, maxLines = 1, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(top = 6.dp))
                    }
                }
                repeat(3 - row.size) { Spacer(Modifier.weight(1f)) }
            }
        }
    }
    Text("Change any page’s theme from Style in the page tools.", style = PhoneType.subheadline, color = p.inkMuted, modifier = Modifier.padding(top = 16.dp))
}

/** A tiny window in fixed light or dark colours, with the Welcome page in its chosen theme. */
@Composable
private fun MiniWindow(dark: Boolean, styleId: String?, modifier: Modifier) {
    val bg = if (dark) Color(0xFF15110F) else Color(0xFFFAF6F3)
    val muted = if (dark) Color(0x33FFFFFF) else Color(0x1F000000)
    val ink = if (dark) Color(0xFFF6F0EC) else Color(0xFF1D1814)
    val paper = if (dark) Color(0xFF1C1C1E) else Color.White
    Row(modifier.background(bg).padding(8.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Column(Modifier.weight(0.3f).padding(top = 4.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
            for (w in listOf(0.75f, 1f, 0.66f, 0.85f)) Box(Modifier.fillMaxWidth(w).height(4.dp).clip(RoundedCornerShape(2.dp)).background(muted))
        }
        Column(Modifier.weight(0.7f).fillMaxHeight().clip(RoundedCornerShape(4.dp)).background(paper)) {
            if (!styleId.isNullOrEmpty()) Cover(styleId, Modifier.fillMaxWidth().weight(0.34f))
            Column(Modifier.padding(6.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Box(Modifier.fillMaxWidth(0.66f).height(7.dp).clip(RoundedCornerShape(2.dp)).background(ink.copy(alpha = 0.85f)))
                Box(Modifier.fillMaxWidth().height(3.dp).clip(RoundedCornerShape(2.dp)).background(ink.copy(alpha = 0.25f)))
                Box(Modifier.fillMaxWidth(0.83f).height(3.dp).clip(RoundedCornerShape(2.dp)).background(ink.copy(alpha = 0.25f)))
            }
        }
    }
}

@Composable
private fun Appearances(value: String, styleId: String?, onPick: (String) -> Unit) {
    val p = LocalPalette.current
    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        for ((id, label) in listOf("light" to "Light", "dark" to "Dark", "system" to "Match system")) {
            val on = id == value
            Column(
                Modifier.weight(1f).gateCard(PhoneRadius.control, selected = on).clip(PhoneRadius.control).clickable(role = Role.RadioButton) { onPick(id) }
                    .semantics { selected = on }.padding(8.dp).testTag("appearance-$id"),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Box(Modifier.fillMaxWidth().aspectRatio(4f / 3f).clip(RoundedCornerShape(6.dp))) {
                    if (id == "system") {
                        MiniWindow(false, styleId, Modifier.fillMaxSize())
                        Box(Modifier.fillMaxSize().clip(DiagonalHalf)) { MiniWindow(true, styleId, Modifier.fillMaxSize()) }
                    } else MiniWindow(id == "dark", styleId, Modifier.fillMaxSize())
                }
                Text(label, style = PhoneType.headline.copy(lineHeight = 20.sp), color = p.heading, modifier = Modifier.padding(horizontal = 4.dp))
            }
        }
    }
}

/** The right side of a slanted cut (the web's `clip-path: polygon(62% 0, 100% 0, 100% 100%, 38% 100%)`). */
private val DiagonalHalf = androidx.compose.foundation.shape.GenericShape { size, _ ->
    moveTo(size.width * 0.62f, 0f)
    lineTo(size.width, 0f)
    lineTo(size.width, size.height)
    lineTo(size.width * 0.38f, size.height)
    close()
}

@Composable
private fun AiChoice(on: Boolean, onChange: (Boolean) -> Unit) {
    val p = LocalPalette.current
    FactList(listOf(
        Fact(WebIcon.MESSAGE_SQUARE_TEXT, "Ask Foli AI", "Ask a question about your notes and get an answer with links to its sources."),
        Fact(null, "Catch me up", "On Home, a short brief of your week: recent notes and what’s due."),
        Fact(WebIcon.PEN_LINE, "Writing help", "Rewrite, shorten, fix or summarize the text you select."),
    ))
    Row(Modifier.padding(top = 24.dp).fillMaxWidth().gateCard(PhoneRadius.panel).padding(16.dp), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
        Column(Modifier.weight(1f)) {
            Text("Foli AI ${if (on) "on" else "off"}", style = PhoneType.headline, color = p.heading)
            Text("When you use it, your request and the notes it needs are sent to Google. Nothing is sent while it’s off, and Foli AI's buttons are hidden.", style = PhoneType.subheadline, color = p.inkMuted, modifier = Modifier.padding(top = 4.dp))
        }
        GateSwitch(on, onChange, "Foli AI")
    }
}

@Composable
private fun Summary(info: OnboardingGateInfo) {
    val p = LocalPalette.current
    val pages = GateRules.starterPages(info.useCases)
    val style = GateRules.styleName(info.noteStyle)
    val rows = listOf(
        Fact(WebIcon.FILES, if (pages.isNotEmpty()) "${pages.size} starter ${if (pages.size == 1) "page" else "pages"}" else "Starter pages", if (pages.isNotEmpty()) GateRules.listOf(pages) else "None this time. You’ll find templates in the sidebar."),
        Fact(WebIcon.PAINTBRUSH, "Welcome to Folevi", if (style == "Plain") "Plain, like every new page" else "In the $style theme"),
        Fact(WebIcon.SUN_MOON, "Appearance", when (info.appearance) { "system" -> "Matches your system"; "dark" -> "Dark"; else -> "Light" }),
        Fact(null, "Foli AI", if (info.aiEnabled) "On. Ask it from any note." else "Off. Turn it on in Settings any time."),
    )
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        for (r in rows) {
            Row(Modifier.fillMaxWidth().gateCard(PhoneRadius.panel).padding(start = 12.dp, top = 12.dp, bottom = 12.dp, end = 16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                Box(Modifier.size(36.dp).gateCard(PhoneRadius.control), contentAlignment = Alignment.Center) {
                    if (r.icon != null) FoleviIcon(r.icon, null, size = 17.dp, tint = p.heading) else AiMark(17.dp)
                }
                Column(Modifier.weight(1f)) {
                    Text(r.title, style = PhoneType.headline, color = p.heading)
                    Text(r.body, style = PhoneType.subheadline, color = p.inkMuted, modifier = Modifier.padding(top = 2.dp))
                }
                Box(Modifier.size(24.dp).clip(PhoneRadius.chip).background(p.heading), contentAlignment = Alignment.Center) { FoleviIcon(WebIcon.CHECK, null, size = 12.dp, tint = p.canvas) }
            }
        }
    }
}
