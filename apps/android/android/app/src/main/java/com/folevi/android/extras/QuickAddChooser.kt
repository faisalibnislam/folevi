package com.folevi.android.extras

import android.content.Context
import android.content.Intent
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Bundle
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.core.content.ContextCompat
import com.folevi.android.MainActivity
import com.folevi.android.R

/**
 * Quick add from the Quick Settings tile and the home screen widgets when this phone holds several places
 * (docs/MULTI_ACCOUNT_PLAN.md §6): a small card asks which one ("Quick add to"), the place chosen last first and
 * ticked, and Folevi opens Quick add task there (switching to it first). With one place it opens Quick add at
 * once, as before. The task is then saved by that place's page, offline too.
 */
class QuickAddChooser : ComponentActivity() {
    private fun dp(v: Float) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, resources.displayMetrics).toInt()
    private val ink by lazy { ContextCompat.getColor(this, R.color.ink) }
    private val canvas by lazy { ContextCompat.getColor(this, R.color.canvas) }
    private val muted by lazy { (ink and 0x00FFFFFF) or 0x99000000.toInt() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (!SaveTargets.several()) {
            startActivity(openIntent(this, null))
            finish()
            return
        }
        setContentView(card())
    }

    private fun card(): View {
        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20f), dp(20f), dp(20f), dp(12f))
            background = GradientDrawable().apply {
                setColor(canvas)
                cornerRadius = dp(16f).toFloat()
            }
            elevation = dp(8f).toFloat()
        }
        column.addView(TextView(this).apply {
            text = "Quick add to"
            setTextColor(ink)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 22f)
            typeface = Typeface.create("serif", Typeface.NORMAL)
            setPadding(0, 0, 0, dp(8f))
        })
        val preferred = SaveTargets.preferred()?.id
        val list = SaveTargets.all().let { all -> all.filter { it.id == preferred } + all.filter { it.id != preferred } }
        for (t in list) {
            val chosen = t.id == preferred
            column.addView(LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                minimumHeight = dp(52f)
                gravity = Gravity.CENTER_VERTICAL
                isClickable = true
                contentDescription = t.name + if (chosen) ", chosen last" else ""
                addView(TextView(this@QuickAddChooser).apply {
                    text = (if (chosen) "✓  " else "     ") + t.name
                    setTextColor(ink)
                    setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
                })
                if (t.detail.isNotEmpty() && t.detail != t.name) addView(TextView(this@QuickAddChooser).apply {
                    text = "     " + t.detail
                    setTextColor(muted)
                    setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
                })
                setOnClickListener {
                    SaveTargets.remember(t.id)
                    startActivity(openIntent(this@QuickAddChooser, t.id))
                    finish()
                }
            })
        }
        column.addView(TextView(this).apply {
            text = "Cancel"
            gravity = Gravity.CENTER
            minHeight = dp(48f)
            setTextColor(ink)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
            isClickable = true
            setOnClickListener { finish() }
        })
        return LinearLayout(this).apply {
            gravity = Gravity.CENTER
            setPadding(dp(16f), dp(16f), dp(16f), dp(16f))
            addView(column, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { width = minOf(resources.displayMetrics.widthPixels - dp(32f), dp(400f)) })
            setOnClickListener { finish() }
        }
    }

    companion object {
        /** Folevi on Quick add task, in `place` when it's given (the app switches to it first). */
        fun openIntent(context: Context, place: String?): Intent {
            val link = "folevi://quick-add" + (place?.let { "?place=" + Uri.encode(it) } ?: "")
            return Intent(Intent.ACTION_VIEW, Uri.parse(link), context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        }

        /** What the tile and the widgets start: this card. */
        fun intent(context: Context): Intent = Intent(context, QuickAddChooser::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }
}
