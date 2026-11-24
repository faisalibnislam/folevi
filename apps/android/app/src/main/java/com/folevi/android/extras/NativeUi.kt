package com.folevi.android.extras

import android.app.Activity
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Outline
import android.graphics.Rect
import android.os.Handler
import android.os.Looper
import android.text.InputType
import android.view.PixelCopy
import android.view.View
import android.view.ViewGroup
import android.view.ViewOutlineProvider
import android.view.animation.DecelerateInterpolator
import android.view.animation.OvershootInterpolator
import android.webkit.WebView
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageView
import androidx.appcompat.app.AlertDialog
import org.json.JSONArray

/**
 * The native UI layer's Android half (docs/IOS_POLISH_PLAN.md §3 "Android", §4; the page calls
 * apps/web/src/lib/native/ui.ts and lib/native/lift.ts, the same calls as on the iPhone): alerts and action
 * sheets as the system's dialogs, and the long press's lifted preview, a picture of what was held floating over
 * the page with a shadow. The menu itself stays the page's (the owner's decision D1). What isn't here (the date
 * and colour pickers, the share sheet, the keyboard's frames) runs Folevi's own version on the page.
 */
object NativeUi {
    data class Action(val id: String, val title: String, val style: String)

    /** The actions the page sent ([{ id, title, style }]), or null when unusable. */
    fun actions(raw: JSONArray?): List<Action>? {
        if (raw == null || raw.length() == 0 || raw.length() > 12) return null
        val out = mutableListOf<Action>()
        for (i in 0 until raw.length()) {
            val o = raw.optJSONObject(i) ?: return null
            val id = o.optString("id")
            val title = o.optString("title")
            if (id.isEmpty() || title.isEmpty()) return null
            val style = when (o.optString("style")) {
                "cancel" -> "cancel"
                "destructive" -> "destructive"
                else -> "default"
            }
            out.add(Action(id, title.take(80), style))
        }
        return out
    }

    private fun danger(activity: Activity) = if ((activity.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES) Color.rgb(255, 105, 97) else Color.rgb(215, 0, 21)

    /**
     * An alert: the cancel action as the negative button, the last other as the positive one, a third as the
     * neutral one; more than that become a list. `answer(id, text)`: id null when dismissed.
     */
    fun alert(activity: Activity, title: String, message: String?, actions: List<Action>, field: Pair<String, String>?, answer: (String?, String?) -> Unit) {
        var answered = false
        val done = { id: String?, text: String? -> if (!answered) { answered = true; answer(id, text) } }
        val input = field?.let { (value, placeholder) ->
            EditText(activity).apply {
                setText(value)
                hint = placeholder
                inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
                setSingleLine()
                setSelectAllOnFocus(true)
            }
        }
        val cancel = actions.firstOrNull { it.style == "cancel" }
        val rest = actions.filter { it !== cancel }
        val b = AlertDialog.Builder(activity).setTitle(title)
        if (!message.isNullOrEmpty() && (rest.size <= 2 || input != null)) b.setMessage(message)
        if (input != null) {
            val pad = (20 * activity.resources.displayMetrics.density).toInt()
            b.setView(FrameLayout(activity).apply { setPadding(pad, pad / 2, pad, 0); addView(input) })
        }
        if (rest.size <= 2) {
            rest.lastOrNull()?.let { a -> b.setPositiveButton(a.title) { _, _ -> done(a.id, input?.text?.toString()) } }
            if (rest.size == 2) rest.first().let { a -> b.setNeutralButton(a.title) { _, _ -> done(a.id, input?.text?.toString()) } }
        } else {
            b.setItems(rest.map { it.title }.toTypedArray()) { _, i -> done(rest[i].id, input?.text?.toString()) }
        }
        b.setNegativeButton(cancel?.title ?: "Cancel") { _, _ -> done(null, null) }
        b.setOnCancelListener { done(null, null) }
        val dialog = b.create()
        dialog.show()
        if (rest.size <= 2) {
            rest.lastOrNull()?.takeIf { it.style == "destructive" }?.let { dialog.getButton(AlertDialog.BUTTON_POSITIVE)?.setTextColor(danger(activity)) }
            rest.takeIf { it.size == 2 }?.first()?.takeIf { it.style == "destructive" }?.let { dialog.getButton(AlertDialog.BUTTON_NEUTRAL)?.setTextColor(danger(activity)) }
        }
        input?.requestFocus()
    }

    /** An action sheet: the actions as a list, Cancel below. `answer(id)`: null when dismissed. */
    fun actionSheet(activity: Activity, title: String?, message: String?, actions: List<Action>, answer: (String?) -> Unit) {
        var answered = false
        val done = { id: String? -> if (!answered) { answered = true; answer(id) } }
        val cancel = actions.firstOrNull { it.style == "cancel" }
        val rest = actions.filter { it !== cancel }
        val b = AlertDialog.Builder(activity)
        val heading = listOfNotNull(title?.takeIf { it.isNotEmpty() }, message?.takeIf { it.isNotEmpty() }).joinToString("\n")
        if (heading.isNotEmpty()) b.setTitle(heading)
        b.setItems(rest.map { it.title }.toTypedArray()) { _, i -> done(rest[i].id) }
        b.setNegativeButton(cancel?.title ?: "Cancel") { _, _ -> done(null) }
        b.setOnCancelListener { done(null) }
        b.show()
    }

    // ---------------------------------------------------------------------------------- the lifted preview

    private class Armed(val bounds: Rect, val radius: Float, val at: Long) {
        var bitmap: Bitmap? = null
        var taken = false
        val waiting = mutableListOf<(Bitmap?) -> Unit>()
    }

    private val armed = mutableMapOf<String, Armed>()
    private val shown = mutableMapOf<String, ImageView>()
    private val main = Handler(Looper.getMainLooper())

    /** The page's rectangle (CSS pixels of what's visible) in the window's pixels. */
    fun windowRect(webView: WebView, x: Double, y: Double, w: Double, h: Double, scale: Double): Rect? {
        if (!(w >= 4 && h >= 4 && w <= 4000 && h <= 4000 && x.isFinite() && y.isFinite() && scale > 0)) return null
        val at = IntArray(2)
        webView.getLocationInWindow(at)
        val r = Rect((at[0] + x * scale).toInt(), (at[1] + y * scale).toInt(), (at[0] + (x + w) * scale).toInt(), (at[1] + (y + h) * scale).toInt())
        val visible = Rect(at[0], at[1], at[0] + webView.width, at[1] + webView.height)
        return if (r.intersect(visible) && r.width() >= 4 && r.height() >= 4) r else null
    }

    /** 1: takes the picture of `bounds` now, as it's drawn at rest. */
    fun arm(activity: Activity, id: String, bounds: Rect, radius: Float) {
        // One press at a time: an older picture not lifted goes.
        armed.keys.filter { !shown.containsKey(it) }.forEach { armed.remove(it) }
        val entry = Armed(bounds, radius, System.currentTimeMillis())
        armed[id] = entry
        val bitmap = Bitmap.createBitmap(bounds.width(), bounds.height(), Bitmap.Config.ARGB_8888)
        PixelCopy.request(activity.window, bounds, bitmap, { result ->
            entry.bitmap = if (result == PixelCopy.SUCCESS) bitmap else null
            entry.taken = true
            entry.waiting.forEach { it(entry.bitmap) }
            entry.waiting.clear()
        }, main)
    }

    /** 2: the picture floats over the page, growing from `from` to 1.04 with a shadow. `done(false)`: no picture. */
    fun lift(activity: Activity, id: String, from: Float, done: (Boolean) -> Unit) {
        val entry = armed[id] ?: return done(false)
        if (shown.containsKey(id)) return done(true)
        val show = show@{ bitmap: Bitmap? ->
            val host = activity.findViewById<ViewGroup>(android.R.id.content)
            if (bitmap == null || host == null || armed[id] !== entry) return@show done(false)
            val at = IntArray(2)
            host.getLocationInWindow(at)
            val density = activity.resources.displayMetrics.density
            val view = ImageView(activity).apply {
                setImageBitmap(bitmap)
                scaleType = ImageView.ScaleType.FIT_XY
                importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
                isClickable = false
                isFocusable = false
                outlineProvider = object : ViewOutlineProvider() {
                    override fun getOutline(v: View, o: Outline) = o.setRoundRect(0, 0, v.width, v.height, entry.radius * density)
                }
                clipToOutline = true
                elevation = 18 * density
                translationX = (entry.bounds.left - at[0]).toFloat()
                translationY = (entry.bounds.top - at[1]).toFloat()
                scaleX = from
                scaleY = from
            }
            host.addView(view, FrameLayout.LayoutParams(entry.bounds.width(), entry.bounds.height()))
            shown[id] = view
            view.animate().scaleX(1.04f).scaleY(1.04f).setDuration(280).setInterpolator(OvershootInterpolator(1.6f)).start()
            done(true)
        }
        if (entry.taken) show(entry.bitmap)
        else {
            var settled = false
            val once = { b: Bitmap? -> if (!settled) { settled = true; show(b) } }
            entry.waiting.add(once)
            main.postDelayed({ once(null) }, 350)
        }
    }

    /** 3: settles back ("back") or fades ("fade"), then goes; `done` once it's back in place. */
    fun drop(id: String, to: String, done: () -> Unit) {
        armed.remove(id)
        val view = shown.remove(id) ?: return done()
        val remove = { (view.parent as? ViewGroup)?.removeView(view); Unit }
        if (to == "back") {
            view.animate().scaleX(1f).scaleY(1f).translationZ(-view.elevation).setDuration(220).setInterpolator(DecelerateInterpolator()).withEndAction {
                done()
                view.animate().alpha(0f).setStartDelay(60).setDuration(100).withEndAction(remove).start()
            }.start()
        } else {
            view.animate().alpha(0f).setDuration(180).withEndAction { remove(); done() }.start()
        }
    }
}
