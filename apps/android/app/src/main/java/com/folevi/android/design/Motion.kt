// The app's motion: Material's motion scheme (spatial specs settle with a little give, effects specs never
// overshoot), and none at all when the person turned animations off (Settings > Accessibility > Remove
// animations, which sets the animator duration scale to 0): then everything snaps.
package com.folevi.android.design

import android.provider.Settings
import androidx.compose.animation.core.FiniteAnimationSpec
import androidx.compose.animation.core.snap
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext

/** Animations are off when the animator duration scale is 0. */
fun reducedMotion(animatorScale: Float): Boolean = animatorScale == 0f

/** Whether the person turned animations off (read once per screen). */
@Composable
fun rememberReducedMotion(): Boolean {
    val context = LocalContext.current
    return remember(context) {
        reducedMotion(runCatching { Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) }.getOrDefault(1f))
    }
}

/** The motion scheme's specs, or a snap when animations are off. */
@OptIn(ExperimentalMaterial3ExpressiveApi::class)
object Motion {
    @Composable
    fun <T> fastSpatial(): FiniteAnimationSpec<T> = if (rememberReducedMotion()) snap() else MaterialTheme.motionScheme.fastSpatialSpec()

    @Composable
    fun <T> defaultSpatial(): FiniteAnimationSpec<T> = if (rememberReducedMotion()) snap() else MaterialTheme.motionScheme.defaultSpatialSpec()

    @Composable
    fun <T> fastEffects(): FiniteAnimationSpec<T> = if (rememberReducedMotion()) snap() else MaterialTheme.motionScheme.fastEffectsSpec()

    @Composable
    fun <T> defaultEffects(): FiniteAnimationSpec<T> = if (rememberReducedMotion()) snap() else MaterialTheme.motionScheme.defaultEffectsSpec()
}
