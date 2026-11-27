// One window's connection to Folevi: its EngineClient over the Page View (or the demo engine in debug builds), the
// gate the engine reports, and where the note page should sit on screen.
package com.folevi.android.engine

import android.content.Context
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.geometry.Rect
import com.folevi.android.BuildConfig
import com.folevi.engine.client.EngineClient
import com.folevi.engine.generated.EngineEvent
import com.folevi.engine.generated.GateChangedEvent
import com.folevi.engine.protocol.AppIdentity
import com.folevi.engine.transport.EngineTransport
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

class AppSession(context: Context, private val scope: CoroutineScope, demo: Boolean, private val host: PageView.Host?) {
    /** Null in demo mode: there is no page, and the note pane says so. */
    val page: PageView? = if (demo || host == null) null else PageView(context as androidx.activity.ComponentActivity, host)
    val isDemo: Boolean get() = page == null

    private val transport: EngineTransport = page?.transport ?: DemoEngine.transport(context, scope)

    // The place is the Page View's own (`acct:<id>` or `library`): the one the page reports in hello, which
    // follows the host's open place (Places.kt) across reloads.
    val client = EngineClient(transport, place = if (demo) "acct:demo" else "", AppIdentity("android", BuildConfig.VERSION_NAME, BuildConfig.VERSION_CODE.toString()), scope)

    private val _gate = MutableStateFlow<GateChangedEvent?>(null)
    /** The screen the engine wants instead of the app; null once the app itself is on screen. */
    val gate: StateFlow<GateChangedEvent?> = _gate.asStateFlow()

    /** The app's keyboard shortcuts (set by AppShell while the app is on screen). */
    var shortcuts: com.folevi.android.ui.Shortcuts? = null

    /** A note this window opens at (a new window from "Open in new window"). */
    var initialNote: Pair<String, String>? = null

    /** Where the note page sits in the window (set by the note pane while it is on screen). */
    val noteSlot = mutableStateOf<Rect?>(null)

    /**
     * The note page's native chrome (NoteScreen): drawn on a layer above the Page View, over the note pane, so its
     * glass bars float over the page as on the web. Touches that miss the chrome reach the page.
     */
    val noteOverlay = mutableStateOf<(@androidx.compose.runtime.Composable () -> Unit)?>(null)

    /** The app frame (AppShell) is taking the page's navigation requests itself. */
    @Volatile var shellListening = false

    /** A navigation request that came while no frame was listening (taken by AppShell when it starts). */
    @Volatile var pendingNavigate: com.folevi.engine.generated.NavigateRequestEvent? = null

    /** The page's scroll as the bridge script reports it: 0 at the top, 1 scrolled, 2 past 96. */
    val pageScroll = mutableStateOf(0)

    /** The app's appearance (the overlay layer's theme follows the main one). */
    val dark = mutableStateOf(false)

    /** Routes the page itself to one of its own routes (`/drafts`), for screens the web draws in the note pane. */
    fun openRoute(route: String) {
        if (page == null) return
        host?.deliverLink("folevi:/" + (if (route.startsWith("/")) route else "/$route"))
    }

    fun start() {
        scope.launch { client.hello.collect { h -> if (h != null) _gate.value = h.gate.takeIf { it.gate != null } } }
        scope.launch {
            client.events.collect { e ->
                if (e is EngineEvent.GateChanged) _gate.value = e.data.takeIf { it.gate != null }
                // A page the web opens as a gate closes (onboarding's "Open Welcome to Folevi") arrives before the app
                // frame is listening: it waits here for the frame (AppShell) to take it.
                if (e is EngineEvent.NavigateRequest && !shellListening) pendingNavigate = e.data
            }
        }
        client.start()
        page?.load()
    }

    fun stop() {
        client.stop()
        page?.destroy()
    }
}
