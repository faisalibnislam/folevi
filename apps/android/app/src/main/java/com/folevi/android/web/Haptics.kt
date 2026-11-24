package com.folevi.android.web

import android.os.Build
import android.view.HapticFeedbackConstants
import android.view.View

/** The page's taps in the hand (lib/nativeApp.ts haptic()) as Android's own feedback constants. */
object Haptics {
    fun constant(kind: String): Int = when (kind) {
        "light" -> HapticFeedbackConstants.CLOCK_TICK
        "medium" -> HapticFeedbackConstants.CONTEXT_CLICK
        "heavy" -> HapticFeedbackConstants.LONG_PRESS
        // A swipe past its full-swipe point, a drag landing, a choice moving (lib/native/ui.ts feel()).
        "rigid" -> if (Build.VERSION.SDK_INT >= 34) HapticFeedbackConstants.GESTURE_THRESHOLD_ACTIVATE else HapticFeedbackConstants.CONTEXT_CLICK
        "soft" -> HapticFeedbackConstants.GESTURE_END
        "selection" -> if (Build.VERSION.SDK_INT >= 34) HapticFeedbackConstants.SEGMENT_TICK else HapticFeedbackConstants.CLOCK_TICK
        "success" -> HapticFeedbackConstants.CONFIRM
        "warning", "error" -> HapticFeedbackConstants.REJECT
        else -> HapticFeedbackConstants.CLOCK_TICK
    }

    fun perform(view: View, kind: String) {
        view.performHapticFeedback(constant(kind))
    }
}
