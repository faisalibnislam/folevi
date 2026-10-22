package com.folevi.android.web

import android.view.HapticFeedbackConstants
import android.view.View

/** The page's taps in the hand (lib/nativeApp.ts haptic()) as Android's own feedback constants. */
object Haptics {
    fun constant(kind: String): Int = when (kind) {
        "light" -> HapticFeedbackConstants.CLOCK_TICK
        "medium" -> HapticFeedbackConstants.CONTEXT_CLICK
        "heavy" -> HapticFeedbackConstants.LONG_PRESS
        "success" -> HapticFeedbackConstants.CONFIRM
        "warning", "error" -> HapticFeedbackConstants.REJECT
        else -> HapticFeedbackConstants.CLOCK_TICK
    }

    fun perform(view: View, kind: String) {
        view.performHapticFeedback(constant(kind))
    }
}
