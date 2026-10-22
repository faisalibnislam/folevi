package com.folevi.android.extras

import android.content.Intent
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Bundle
import android.provider.OpenableColumns
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import com.folevi.android.FoleviApp
import com.folevi.android.R
import com.folevi.android.web.Haptics
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * "Save to Folevi" in Android's share sheet (docs/ANDROID_PLAN.md "Native v1"): text, links, images, PDFs and other
 * files from any app. A small card in Folevi's neutral look: the title, what's being saved, where it goes (the
 * Inbox in Personal, or a workspace's), Cancel and Save. Text and links go straight to the Inbox through the REST
 * API when the phone is signed in and online; anything else (offline, signed out, local mode, files) is kept on
 * the phone and saved by the app the next time it opens (ShareQueue.kt, lib/share/save.ts). Up to ten files of
 * 20 MB, like the web's share page.
 */
class ShareActivity : ComponentActivity() {
    private data class Content(val title: String, val text: String, val url: String, val files: List<ShareQueue.SharedFile>, val skipped: Int)

    private var places: List<FoleviApi.Place> = emptyList()
    private var place: String? = null
    /** Several places on this phone (SaveTargets): the library and each account, the last one chosen first. */
    private val targets: List<SaveTargets.Target> by lazy { if (SaveTargets.several()) SaveTargets.all() else emptyList() }
    private var target: SaveTargets.Target? = null
    private lateinit var targetRows: LinearLayout
    private lateinit var placeRows: LinearLayout
    private lateinit var status: TextView

    private fun dp(v: Float) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, resources.displayMetrics).toInt()
    private val ink by lazy { ContextCompat.getColor(this, R.color.ink) }
    private val canvas by lazy { ContextCompat.getColor(this, R.color.canvas) }
    private val muted by lazy { (ink and 0x00FFFFFF) or 0x99000000.toInt() }
    private val line by lazy { (ink and 0x00FFFFFF) or 0x1F000000 }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val content = read(intent)
        if (content == null) {
            finish()
            return
        }
        place = getSharedPreferences("folevi-share", MODE_PRIVATE).getString("place", null)
        if (targets.isNotEmpty()) target = SaveTargets.preferred()
        setContentView(card(content))
        lifecycleScope.launch { loadPlaces() }
    }

    // ---------------------------------------------------------------- what was shared

    private fun read(intent: Intent?): Content? {
        intent ?: return null
        val subject = intent.getStringExtra(Intent.EXTRA_SUBJECT).orEmpty().trim()
        val shared = intent.getStringExtra(Intent.EXTRA_TEXT).orEmpty().trim()
        val uris = when (intent.action) {
            Intent.ACTION_SEND -> listOfNotNull(intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java))
            Intent.ACTION_SEND_MULTIPLE -> intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java).orEmpty()
            else -> emptyList()
        }
        val link = Regex("https?://\\S+").find(shared)?.value?.trimEnd('.', ',', ')') ?: ""
        val text = if (link.isNotEmpty() && shared == link) "" else shared
        val files = ArrayList<ShareQueue.SharedFile>()
        var skipped = 0
        for (uri in uris.take(MAX_FILES)) {
            val f = runCatching { file(uri) }.getOrNull()
            if (f == null) skipped++ else files.add(f)
        }
        skipped += (uris.size - MAX_FILES).coerceAtLeast(0)
        if (text.isEmpty() && link.isEmpty() && files.isEmpty()) return null
        val title = subject.ifEmpty { text.lineSequence().firstOrNull { it.isNotBlank() }?.take(120) ?: link.let { runCatching { Uri.parse(it).host }.getOrNull() } ?: files.firstOrNull()?.name ?: "Shared" }
        return Content(title.take(200), text, link, files, skipped)
    }

    private fun file(uri: Uri): ShareQueue.SharedFile? {
        val type = contentResolver.getType(uri) ?: "application/octet-stream"
        var name = "file"
        var size = -1L
        contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { c ->
            if (c.moveToFirst()) {
                name = c.getString(0) ?: name
                size = if (c.isNull(1)) -1 else c.getLong(1)
            }
        }
        if (size > MAX_FILE) return null
        val bytes = contentResolver.openInputStream(uri)?.use { s -> s.readNBytes(MAX_FILE + 1) } ?: return null
        if (bytes.size > MAX_FILE) return null
        return ShareQueue.SharedFile(name.take(200), type, bytes)
    }

    // ---------------------------------------------------------------- the card

    private fun text(s: String, sp: Float, color: Int, bold: Boolean = false, serif: Boolean = false) = TextView(this).apply {
        text = s
        setTextColor(color)
        setTextSize(TypedValue.COMPLEX_UNIT_SP, sp)
        typeface = Typeface.create(if (serif) "serif" else "sans-serif", if (bold) Typeface.BOLD else Typeface.NORMAL)
    }

    private fun button(label: String, primary: Boolean, onClick: () -> Unit) = TextView(this).apply {
        text = label
        gravity = Gravity.CENTER
        minHeight = dp(48f)
        setPadding(dp(20f), 0, dp(20f), 0)
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
        typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
        setTextColor(if (primary) canvas else ink)
        background = GradientDrawable().apply {
            cornerRadius = dp(10f).toFloat()
            if (primary) setColor(ink) else setStroke(dp(1f), line)
        }
        isClickable = true
        setOnClickListener { onClick() }
    }

    private fun card(c: Content): View {
        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20f), dp(20f), dp(20f), dp(16f))
            background = GradientDrawable().apply {
                setColor(canvas)
                cornerRadius = dp(16f).toFloat()
            }
            elevation = dp(8f).toFloat()
        }
        column.addView(text("Save to Folevi", 22f, ink, serif = true))
        column.addView(text(c.title, 15f, ink, bold = true).apply { maxLines = 2; setPadding(0, dp(12f), 0, 0) })
        val preview = buildString {
            // A link already in the text is shown once.
            if (c.url.isNotEmpty() && !c.text.contains(c.url)) appendLine(c.url)
            if (c.text.isNotEmpty() && c.text != c.title) appendLine(c.text.take(300))
            if (c.files.isNotEmpty()) appendLine(if (c.files.size == 1) c.files[0].name else "${c.files.size} files")
            if (c.skipped > 0) appendLine(if (c.skipped == 1) "1 file is too big to save (20 MB at most)." else "${c.skipped} files are too big to save (20 MB at most).")
        }.trim()
        if (preview.isNotEmpty()) column.addView(text(preview, 14f, muted).apply { maxLines = 5; setPadding(0, dp(4f), 0, 0) })
        column.addView(text("Save to", 13f, muted).apply { setPadding(0, dp(16f), 0, dp(4f)) })
        targetRows = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        column.addView(targetRows)
        placeRows = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        column.addView(placeRows)
        renderTargets()
        renderPlaces()
        status = text("", 13f, muted).apply { setPadding(0, dp(8f), 0, 0); visibility = View.GONE }
        column.addView(status)
        val buttons = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.END
            setPadding(0, dp(16f), 0, 0)
            addView(button("Cancel", false) { finish() })
            addView(View(this@ShareActivity), LinearLayout.LayoutParams(dp(8f), 1))
            addView(button("Save", true) { save(c) })
        }
        column.addView(buttons)
        val scroll = ScrollView(this).apply { addView(column) }
        return LinearLayout(this).apply {
            gravity = Gravity.CENTER
            setPadding(dp(16f), dp(16f), dp(16f), dp(16f))
            addView(scroll, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { width = minOf(resources.displayMetrics.widthPixels - dp(32f), dp(420f)) })
            setOnClickListener { finish() }
        }
    }

    private fun row(label: String, detail: String?, chosen: Boolean, onClick: () -> Unit) = TextView(this).apply {
        text = (if (chosen) "✓  " else "     ") + label + (detail?.takeIf { it.isNotEmpty() && it != label }?.let { "\n     $it" } ?: "")
        setTextColor(ink)
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
        minHeight = dp(44f)
        gravity = Gravity.CENTER_VERTICAL
        isClickable = true
        contentDescription = label + if (chosen) ", chosen" else ""
        setOnClickListener { onClick() }
    }

    /** The places on this phone, when there are several: choosing one shows its own Inboxes below. */
    private fun renderTargets() {
        targetRows.removeAllViews()
        for (t in targets) {
            targetRows.addView(row(t.name, t.detail, t.id == target?.id) {
                if (target?.id != t.id) {
                    target = t
                    places = emptyList()
                    renderTargets()
                    renderPlaces()
                    lifecycleScope.launch { loadPlaces() }
                }
            })
        }
        if (targets.isNotEmpty()) targetRows.addView(View(this), LinearLayout.LayoutParams(1, dp(8f)))
    }

    private fun renderPlaces() {
        placeRows.removeAllViews()
        // The library's notes go to its Inbox: there's nothing to choose.
        if (target?.isLibrary == true) return
        val options = listOf<Pair<String?, String>>(null to "Inbox in Personal") + places.filter { it.id != "personal" }.map { it.id to "Inbox in ${it.name}" }
        if (options.none { it.first == place }) place = null
        for ((id, label) in options) {
            val chosen = id == place
            placeRows.addView(TextView(this).apply {
                text = (if (chosen) "✓  " else "     ") + label
                setTextColor(ink)
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
                minHeight = dp(44f)
                gravity = Gravity.CENTER_VERTICAL
                isClickable = true
                contentDescription = label + if (chosen) ", chosen" else ""
                setOnClickListener {
                    place = id
                    renderPlaces()
                }
            })
        }
    }

    private suspend fun loadPlaces() {
        val chosen = target
        val api = (if (chosen != null) SaveTargets.api(this, chosen) else FoleviApi.forDevice(this)) ?: return
        val list = withContext(Dispatchers.IO) { runCatching { api.places() }.getOrNull() } ?: return
        if (chosen != target) return
        places = list
        renderPlaces()
    }

    // ---------------------------------------------------------------- saving

    private fun save(c: Content) {
        getSharedPreferences("folevi-share", MODE_PRIVATE).edit().putString("place", place).apply()
        status.visibility = View.VISIBLE
        status.text = "Saving…"
        val chosen = place
        target?.let { t ->
            SaveTargets.remember(t.id)
            return saveTo(t, c, if (t.isLibrary) null else chosen)
        }
        lifecycleScope.launch {
            val local = FoleviApp.instance.settings.mode != "account"
            val api = if (local) null else FoleviApi.forDevice(this@ShareActivity)
            val direct = c.files.isEmpty() && api != null && withContext(Dispatchers.IO) {
                val markdown = (if (c.text.contains(c.url)) listOf(c.text) else listOf(c.url, c.text)).filter { it.isNotEmpty() }.joinToString("\n\n")
                runCatching { api.createNote(c.title, markdown, chosen) }.isSuccess
            }
            if (!direct) withContext(Dispatchers.IO) { ShareQueue.get(this@ShareActivity).add(c.title, c.text, c.url, chosen, c.files) }
            Haptics.perform(window.decorView, "success")
            status.text = if (direct) "Saved to your Inbox" else "Saved. It goes to your Inbox when Folevi opens."
            window.decorView.postDelayed({ finish() }, 900)
        }
    }

    /** Several places: straight to an account with its own token, else kept (tagged) for that place's page. */
    private fun saveTo(t: SaveTargets.Target, c: Content, chosen: String?) {
        lifecycleScope.launch {
            val api = if (t.isLibrary) null else SaveTargets.api(this@ShareActivity, t)
            val direct = c.files.isEmpty() && api != null && withContext(Dispatchers.IO) {
                val markdown = (if (c.text.contains(c.url)) listOf(c.text) else listOf(c.url, c.text)).filter { it.isNotEmpty() }.joinToString("\n\n")
                runCatching { api.createNote(c.title, markdown, chosen) }.isSuccess
            }
            if (!direct) withContext(Dispatchers.IO) { ShareQueue.get(this@ShareActivity).add(c.title, c.text, c.url, chosen, c.files, target = t.id) }
            Haptics.perform(window.decorView, "success")
            status.text = when {
                direct -> "Saved to the Inbox in ${t.name}"
                t.isLibrary -> "Saved. It goes into the library when you next open it."
                else -> "Saved. It goes to ${t.name} when you next open it."
            }
            window.decorView.postDelayed({ finish() }, 900)
        }
    }

    companion object {
        const val MAX_FILES = 10
        const val MAX_FILE = 20 * 1024 * 1024
    }
}
