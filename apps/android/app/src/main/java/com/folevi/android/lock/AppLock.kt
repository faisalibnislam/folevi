package com.folevi.android.lock

import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Typeface
import android.os.SystemClock
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_STRONG
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_WEAK
import androidx.biometric.BiometricManager.Authenticators.DEVICE_CREDENTIAL
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import com.folevi.android.MainActivity
import com.folevi.android.R
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume

/**
 * The optional lock (docs/ANDROID_PLAN.md "Native v1": a fingerprint or face lock): off until turned on in
 * Settings, kept on this phone only. While it's on, the app is left out of Recents' screenshots, and coming back
 * after the chosen time (immediately, or after 1, 5 or 15 minutes away) covers it until the person unlocks with
 * their fingerprint or face (or the phone's screen lock). Cancelling leaves the cover and its button. A phone with
 * no screen lock can't turn it on; if the screen lock is removed later, the lock steps aside.
 */
class AppLock(private val context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("folevi-lock", Context.MODE_PRIVATE)

    var enabled: Boolean
        get() = prefs.getBoolean("lock", false)
        private set(v) = prefs.edit().putBoolean("lock", v).apply()

    var lockAfter: Int
        get() = prefs.getInt("lockAfter", 0)
        private set(v) = prefs.edit().putInt("lockAfter", v).apply()

    private var leftAt = 0L
    /** Folevi itself opened something over it (a Custom Tab, Google's consent, "Save to"): coming back doesn't lock. */
    @Volatile private var ownScreen = false

    fun openingOwnScreen() {
        ownScreen = true
    }
    private var cover: View? = null
    private var asking = false

    /** How this phone unlocks: "biometric" (a fingerprint or face), "screenLock" (PIN, pattern, password) or "none". */
    fun method(): String {
        val bm = BiometricManager.from(context)
        return when {
            bm.canAuthenticate(BIOMETRIC_STRONG) == BiometricManager.BIOMETRIC_SUCCESS || bm.canAuthenticate(BIOMETRIC_WEAK) == BiometricManager.BIOMETRIC_SUCCESS -> "biometric"
            bm.canAuthenticate(DEVICE_CREDENTIAL) == BiometricManager.BIOMETRIC_SUCCESS -> "screenLock"
            else -> "none"
        }
    }

    fun settings(): Map<String, Any> = mapOf("lock" to (enabled && method() != "none"), "lockAfter" to lockAfter, "method" to method())

    /** Turning the lock on (or off) asks to unlock once, so it's never on for someone who can't get back in. */
    suspend fun set(activity: FragmentActivity, lock: Boolean?, after: Int?) {
        if (after != null) {
            require(after in setOf(0, 60, 300, 900)) { "Not a time Folevi offers." }
            lockAfter = after
        }
        if (lock != null && lock != enabled) {
            if (lock && method() == "none") throw IllegalStateException("Set a screen lock for this phone in the Settings app first.")
            if (!authenticate(activity, if (lock) "Turn on the lock" else "Turn off the lock")) throw LockCancelled()
            enabled = lock
        }
        (activity as? MainActivity)?.runOnUiThread { activity.setRecentsScreenshotEnabled(!enabled) }
    }

    class LockCancelled : Exception("cancelled")

    suspend fun authenticate(activity: FragmentActivity, title: String): Boolean = suspendCancellableCoroutine { cont ->
        val prompt = BiometricPrompt(activity, ContextCompat.getMainExecutor(activity), object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                if (cont.isActive) cont.resume(true)
            }

            override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                if (cont.isActive) cont.resume(false)
            }
        })
        val info = BiometricPrompt.PromptInfo.Builder()
            .setTitle(title)
            .setSubtitle("Folevi")
            .setAllowedAuthenticators(BIOMETRIC_STRONG or BIOMETRIC_WEAK or DEVICE_CREDENTIAL)
            .build()
        activity.runOnUiThread { prompt.authenticate(info) }
    }

    // ---------------------------------------------------------------- following the activity

    fun onStop() {
        leftAt = SystemClock.elapsedRealtime()
    }

    /** Back on screen: cover and ask, when the lock is on and the chosen time has passed (or at launch). */
    fun onStart(activity: MainActivity, launch: Boolean) {
        activity.setRecentsScreenshotEnabled(!enabled)
        if (!enabled || method() == "none") return hide()
        val away = SystemClock.elapsedRealtime() - leftAt
        val own = ownScreen
        ownScreen = false
        if (!launch && cover == null && (own || away < lockAfter * 1000L)) return
        show(activity)
        ask(activity)
    }

    private fun ask(activity: MainActivity) {
        if (asking) return
        asking = true
        activity.lifecycleScope.launch {
            val ok = runCatching { authenticate(activity, "Unlock Folevi") }.getOrDefault(false)
            asking = false
            if (ok) hide()
        }
    }

    private fun hide() {
        val c = cover ?: return
        (c.parent as? ViewGroup)?.removeView(c)
        cover = null
    }

    /** The cover: the canvas colour, the F, "Folevi is locked" and Unlock. */
    private fun show(activity: MainActivity) {
        if (cover != null) return
        val dp = { v: Float -> TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, activity.resources.displayMetrics).toInt() }
        val ink = ContextCompat.getColor(activity, R.color.ink)
        val column = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            addView(ImageView(activity).apply { setImageResource(R.mipmap.ic_launcher) }, LinearLayout.LayoutParams(dp(72f), dp(72f)))
            addView(TextView(activity).apply {
                text = "Folevi is locked"
                setTextColor(ink)
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 20f)
                typeface = Typeface.create("serif", Typeface.NORMAL)
                gravity = Gravity.CENTER
            }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(20f) })
            addView(TextView(activity).apply {
                text = "Unlock"
                setTextColor(ContextCompat.getColor(activity, R.color.canvas))
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
                gravity = Gravity.CENTER
                minHeight = dp(48f)
                minWidth = dp(160f)
                setPadding(dp(24f), 0, dp(24f), 0)
                background = android.graphics.drawable.GradientDrawable().apply {
                    setColor(ink)
                    cornerRadius = dp(12f).toFloat()
                }
                isClickable = true
                contentDescription = "Unlock Folevi"
                setOnClickListener { ask(activity) }
            }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(28f) })
        }
        val frame = FrameLayout(activity).apply {
            setBackgroundColor(ContextCompat.getColor(activity, R.color.canvas))
            isClickable = true
            isFocusable = true
            addView(column, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        }
        (activity.window.decorView as ViewGroup).addView(frame, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        cover = frame
    }

    fun locked(): Boolean = cover != null

    companion object {
        fun hasFingerprint(context: Context) = context.packageManager.hasSystemFeature(PackageManager.FEATURE_FINGERPRINT)
    }
}
