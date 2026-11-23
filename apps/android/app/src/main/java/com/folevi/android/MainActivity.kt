// Folevi for Android, native (docs/ANDROID_NATIVE_PLAN.md). One activity per window: Compose draws everything
// except the note page, which is the window's Page View (a WebView running the web engine and editor) laid over
// the note pane's spot. Debug builds launched with `--ez demo true` use the demo engine (fixtures, no page).
package com.folevi.android

import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.platform.ComposeView
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.lifecycle.lifecycleScope
import com.folevi.android.design.FoleviTheme
import com.folevi.android.engine.AppSession
import com.folevi.android.engine.DemoEngine
import com.folevi.android.ui.AppShell
import com.folevi.android.ui.GateScreen
import com.folevi.android.ui.LocalSession
import com.folevi.engine.client.EngineClient
import kotlin.math.roundToInt

class MainActivity : ComponentActivity() {
    private lateinit var session: AppSession

    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        val demo = BuildConfig.DEBUG && intent.getBooleanExtra("demo", false) && DemoEngine.available(this)
        session = AppSession(this, lifecycleScope, demo)

        val root = FrameLayout(this)
        val compose = ComposeView(this)
        root.addView(compose, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        session.page?.webView?.let { web ->
            web.visibility = View.INVISIBLE
            root.addView(web, FrameLayout.LayoutParams(1, 1))
        }
        setContentView(root)

        compose.setContent {
            FoleviTheme {
                CompositionLocalProvider(LocalSession provides session) {
                    val gate by session.gate.collectAsState()
                    val state by session.client.state.collectAsState()
                    LaunchedEffect(Unit) { snapshotFlow { session.noteSlot.value }.collect { placePage(it) } }
                    Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background).safeDrawingPadding()) {
                        val g = gate
                        when {
                            g != null -> GateScreen(g)
                            state is EngineClient.State.Ready || session.isDemo -> AppShell()
                            else -> GateScreen(com.folevi.engine.generated.GateChangedEvent(gate = "loading", title = "", message = "", busy = true, actions = emptyList(), fields = emptyList(), progress = null, migration = null, deviceLimit = null, e2ee = null, onboarding = null, error = null))
                        }
                    }
                }
            }
        }
        session.start()
    }

    /** Lays the Page View over the note pane (or hides it, still running, when no note is on screen). */
    private fun placePage(slot: Rect?) {
        val web = session.page?.webView ?: return
        if (slot == null || slot.width < 1f || slot.height < 1f) {
            web.visibility = View.INVISIBLE
            return
        }
        val lp = web.layoutParams as FrameLayout.LayoutParams
        val w = slot.width.roundToInt()
        val h = slot.height.roundToInt()
        if (lp.width != w || lp.height != h) {
            lp.width = w
            lp.height = h
            web.layoutParams = lp
        }
        web.translationX = slot.left
        web.translationY = slot.top
        web.visibility = View.VISIBLE
    }

    override fun onDestroy() {
        session.stop()
        super.onDestroy()
    }
}
