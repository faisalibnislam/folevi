// The native screens before the app (Gates.kt), headless on Robolectric: they render from constructed gate.changed
// payloads, and their buttons send `gate.act` with the values the web expects (OnboardingGateInfo's comment).
package com.folevi.android.ui

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import com.folevi.android.design.FoleviTheme
import com.folevi.engine.generated.GateAction
import com.folevi.engine.generated.GateChangedEvent
import com.folevi.engine.generated.GateField
import com.folevi.engine.generated.OnboardingChoice
import com.folevi.engine.generated.OnboardingGateInfo
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

private fun gate(
    name: String,
    actions: List<GateAction> = emptyList(),
    fields: List<GateField> = emptyList(),
    onboarding: OnboardingGateInfo? = null,
    title: String = "",
    message: String = "",
) = GateChangedEvent(
    gate = name, title = title, message = message, busy = false, actions = actions, fields = fields, progress = null,
    migration = null, deviceLimit = null, e2ee = null, onboarding = onboarding, error = null,
)

private fun action(id: String, label: String, style: GateAction.Style = GateAction.Style.PRIMARY) = GateAction(id = id, label = label, style = style, enabled = true)

private fun onboarding(step: String, index: Long, useCases: List<String> = emptyList(), style: String = "plain", appearance: String = "system", ai: Boolean = true) = OnboardingGateInfo(
    step = step, index = index, total = 6, useCases = useCases,
    useCaseOptions = listOf(OnboardingChoice("notes", "Personal notes"), OnboardingChoice("work", "Work projects")),
    noteStyle = style, noteStyleOptions = listOf("plain", "art-03", "art-39"), appearance = appearance, aiEnabled = ai,
)

private val ONBOARDING_ACTIONS = listOf(
    action("continue", "Continue"),
    action("skip", "Skip", GateAction.Style.QUIET),
    action("skipAll", "Skip setup", GateAction.Style.QUIET),
    action("back", "Back", GateAction.Style.QUIET),
)

class GateRulesTest {
    @Test fun onboardingValuesAreTheWebsShape() {
        assertEquals(mapOf("useCases" to "notes,work"), GateRules.onboardingValues("uses", listOf("notes", "work"), "plain", "system", true))
        assertEquals(mapOf("useCases" to ""), GateRules.onboardingValues("uses", emptyList(), "plain", "system", true))
        assertEquals(mapOf("noteStyle" to "art-39"), GateRules.onboardingValues("style", emptyList(), "art-39", "system", true))
        assertEquals(mapOf("appearance" to "dark"), GateRules.onboardingValues("appearance", emptyList(), "plain", "dark", true))
        assertEquals(mapOf("aiEnabled" to "false"), GateRules.onboardingValues("ai", emptyList(), "plain", "system", false))
        assertNull(GateRules.onboardingValues("workspace", emptyList(), "plain", "system", true))
        // The web's older names for the steps.
        assertEquals(1, GateRules.stepIndex("useCases"))
        assertEquals(5, GateRules.stepIndex("done"))
        assertEquals(0, GateRules.stepIndex("intro"))
    }

    @Test fun wordsAndStarterPages() {
        assertEquals("Where should your notes live?", GateRules.title(gate("modeChoice")))
        assertEquals("Given", GateRules.title(gate("modeChoice", title = "Given")))
        assertEquals(listOf("Daily Page", "Brainstorm", "Project Brief", "Meeting Notes"), GateRules.starterPages(listOf("notes", "work")))
        // A page two uses share is added once.
        assertEquals(listOf("Project Brief", "Meeting Notes", "Retrospective"), GateRules.starterPages(listOf("work", "team")))
        assertEquals("a, b and c", GateRules.listOf(listOf("a", "b", "c")))
        assertEquals("Cypresses", GateRules.styleName("art-39"))
        assertEquals("Plain", GateRules.styleName(""))
    }

    @Test fun fieldsMethodsAndValues() {
        val pass = GateField("passphrase", GateField.Kind.SECRET, "Passphrase", "")
        val key = GateField("recoveryKey", GateField.Kind.RECOVERY_KEY, "Recovery key", "")
        val g = gate("e2eeLocked", actions = listOf(action("passphrase", "Unlock"), action("recovery", "Use recovery key"), action("cancel", "Cancel", GateAction.Style.QUIET)), fields = listOf(pass, key))
        assertEquals(listOf("passphrase", "recovery"), GateRules.methodActions(g).map { it.id })
        assertEquals(listOf("passphrase"), GateRules.visibleFields(g, "passphrase").map { it.id })
        assertEquals(listOf("recovery", "cancel"), GateRules.visibleActions(g, "recovery").map { it.id })
        assertEquals(GateAction.Style.PRIMARY, GateRules.visibleActions(g, "recovery").first().style)
        assertFalse(GateRules.isEnabled(g, g.actions[0], emptyMap(), null))
        assertTrue(GateRules.isEnabled(g, g.actions[0], mapOf("passphrase" to "x"), null))
        assertEquals(mapOf("recoveryKey" to "K7QM-2RTX-AB"), GateRules.valuesToSend(listOf(key), mapOf("recoveryKey" to "k7qm 2rtx ab")))
        assertNull(GateRules.valuesToSend(listOf(pass), emptyMap()))
    }
}

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [36], application = android.app.Application::class, qualifiers = "w411dp-h891dp")
class GatesTest {
    @get:Rule val compose = createComposeRule()
    private val sent = mutableListOf<Pair<String, Map<String, String>?>>()

    private fun show(g: GateChangedEvent) {
        compose.setContent { FoleviTheme(dark = false) { GateContent(g) { a, v -> sent += a to v } } }
    }

    @Test fun modeChoiceShowsBothChoicesAndPresses() {
        show(gate("modeChoice", actions = listOf(action("account", "Sign in to Folevi"), action("local", "Keep notes on my devices", GateAction.Style.SECONDARY))))
        compose.onNodeWithText("Where should your notes live?").assertIsDisplayed()
        compose.onNodeWithText("RECOMMENDED").assertIsDisplayed()
        compose.onNodeWithText("Sync and share your notes.").assertIsDisplayed()
        compose.onNodeWithText("Free forever. No account.").assertIsDisplayed()
        compose.onNodeWithTag("gate-choice-local").performClick()
        compose.waitForIdle()
        assertEquals(listOf("local" to null), sent)
    }

    @Test fun usesStepSendsThePicksJoined() {
        show(gate("onboarding", actions = ONBOARDING_ACTIONS, onboarding = onboarding("uses", 1)))
        compose.onNodeWithText("What will you use Folevi for?").assertIsDisplayed()
        compose.onNodeWithText("2 of 6 · Your pages").assertIsDisplayed()
        compose.onNodeWithText("Nothing picked yet. You can skip this and add templates any time.").performScrollTo().assertIsDisplayed()
        compose.onNodeWithTag("use-work").performScrollTo().performClick()
        compose.onNodeWithTag("use-notes").performScrollTo().performClick()
        compose.onNodeWithText("Adds 4 pages: Project Brief, Meeting Notes, Daily Page and Brainstorm.").performScrollTo().assertIsDisplayed()
        compose.onNodeWithTag("onboarding-continue").performClick()
        compose.waitForIdle()
        assertEquals(listOf("continue" to mapOf("useCases" to "work,notes")), sent)
    }

    @Test fun styleAndAppearanceSteps() {
        show(gate("onboarding", actions = ONBOARDING_ACTIONS, onboarding = onboarding("style", 2)))
        compose.onNodeWithText("Pick a theme for your first page").assertIsDisplayed()
        compose.onNodeWithTag("style-art-39").performScrollTo().performClick()
        compose.onNodeWithTag("onboarding-continue").performClick()
        compose.waitForIdle()
        assertEquals(listOf("continue" to mapOf("noteStyle" to "art-39")), sent)
    }

    @Test fun appearanceStepSendsTheChoice() {
        show(gate("onboarding", actions = ONBOARDING_ACTIONS, onboarding = onboarding("appearance", 3)))
        compose.onNodeWithText("Light or dark?").assertIsDisplayed()
        compose.onNodeWithTag("appearance-dark").performScrollTo().performClick()
        compose.onNodeWithTag("onboarding-continue").performClick()
        compose.waitForIdle()
        assertEquals(listOf("continue" to mapOf("appearance" to "dark")), sent)
    }

    @Test fun readySummaryListsWhatWasSetUpAndFinishes() {
        show(gate("onboarding", actions = listOf(action("finish", "Open Folevi"), action("back", "Back", GateAction.Style.QUIET)), onboarding = onboarding("welcome", 5, useCases = listOf("work"), style = "art-03", appearance = "dark", ai = false)))
        compose.onNodeWithText("Your Folevi is ready.").assertIsDisplayed()
        compose.onNodeWithText("2 starter pages").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Project Brief and Meeting Notes").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("In the Irises theme").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Dark").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Off. Turn it on in Settings any time.").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Open “Welcome to Folevi”").assertIsDisplayed()
        compose.onNodeWithTag("onboarding-continue").performClick()
        compose.waitForIdle()
        assertEquals(listOf("finish" to null), sent)
    }

    @Test fun messageCardForOtherGates() {
        show(gate("updateRequired", actions = listOf(action("retry", "Try again"))))
        compose.onNodeWithText("Update Folevi to keep syncing").assertIsDisplayed()
        compose.onNodeWithText("Try again").assertIsDisplayed().performClick()
        compose.waitForIdle()
        assertEquals(listOf("retry" to null), sent)
    }
}
