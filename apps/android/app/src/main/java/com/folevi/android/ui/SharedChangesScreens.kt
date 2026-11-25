// Shared with Me and Changes as the web's phone layout draws its lists (apps/web/src/components/iphone/Rows.tsx,
// Screen.tsx): a large title that scrolls away, plain rows with a 22 glyph, a body title and a muted second line,
// hairlines under the text, and the web's empty states.
package com.folevi.android.ui

import androidx.compose.ui.semantics.semantics

import androidx.compose.ui.semantics.heading

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.folevi.android.design.FoleviIcon
import com.folevi.android.design.GlassCircle
import com.folevi.android.design.LocalPalette
import com.folevi.android.design.PhoneScreen
import com.folevi.android.design.PhoneType
import com.folevi.android.design.Placeholder
import com.folevi.android.design.ScreenEmpty
import com.folevi.android.design.WebIcon
import com.folevi.android.design.phoneColors
import com.folevi.android.design.shortDate
import com.folevi.engine.generated.Views

/** "{who} · {where} · {when}", leaving out what's blank. */
internal fun metaLine(vararg parts: String?): String = parts.filterNot { it.isNullOrBlank() }.joinToString(" · ")

@Composable
fun SharedScreen(open: (Route) -> Unit, onBack: (() -> Unit)?) {
    val shared by rememberView(Views.sharedList())
    PhoneScreen(title = "Shared with Me", leading = onBack?.let { back -> { GlassCircle(WebIcon.CHEVRON_LEFT, "Back", back) } }) {
        val rows = shared.value?.rows
        when {
            rows == null -> item { Loading() }
            rows.isEmpty() -> item { ScreenEmpty(WebIcon.USERS, "Nothing shared with you yet", "Notes people share with you show up here.") }
            else -> rows.forEach { r ->
                item(key = r.id) {
                    PlainRow(
                        icon = r.icon,
                        glyph = WebIcon.USERS,
                        title = r.title.ifEmpty { "Untitled" },
                        meta = metaLine(r.sharedBy, r.workspaceName, shortDate(r.sharedAt)),
                    ) { open(NoteRoute(r.id, r.title)) }
                }
            }
        }
    }
}

@Composable
fun ChangesScreen(open: (Route) -> Unit, onBack: (() -> Unit)?) {
    val changes by rememberView(Views.changes())
    PhoneScreen(title = "Changes", leading = onBack?.let { back -> { GlassCircle(WebIcon.CHEVRON_LEFT, "Back", back) } }) {
        val v = changes.value
        when {
            v == null -> item { Loading() }
            v.notes.isEmpty() && v.proposals.isEmpty() -> item { ScreenEmpty(WebIcon.FILE_DIFF, "No changes to review", "What others change in your notes shows up here.") }
            else -> {
                if (v.proposals.isNotEmpty()) {
                    item(key = "p-h") { Caps("Suggested") }
                    v.proposals.forEach { r ->
                        item(key = "p" + r.id) {
                            PlainRow(icon = null, glyph = WebIcon.GIT_MERGE, title = r.title, meta = metaLine(r.sourceName, r.summary), lines = 2) {
                                r.noteId?.let { open(NoteRoute(it, r.title)) }
                            }
                        }
                    }
                }
                if (v.notes.isNotEmpty()) {
                    item(key = "n-h") { Caps("Edited") }
                    v.notes.forEach { r ->
                        item(key = "n" + r.id) {
                            PlainRow(icon = r.icon, glyph = WebIcon.FILE_DIFF, title = r.title.ifEmpty { "Untitled" }, meta = metaLine(r.who, r.counts, shortDate(r.changedAt))) { open(NoteRoute(r.id, r.title)) }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun Caps(text: String) {
    Text(text.uppercase(), style = PhoneType.eyebrow, color = LocalPalette.current.inkMuted, modifier = Modifier.padding(start = 20.dp, top = 24.dp, bottom = 6.dp).semantics { heading() })
}

@Composable
private fun Loading() {
    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) { repeat(4) { Placeholder(64.dp) } }
}

/** A plain list row (Rows.tsx outside a group): 20 in, the glyph (or the note's emoji), title, a muted line. */
@Composable
private fun PlainRow(icon: String?, glyph: WebIcon, title: String, meta: String, lines: Int = 1, onClick: () -> Unit) {
    val p = LocalPalette.current
    val c = phoneColors()
    Row(
        Modifier.fillMaxWidth().clickable(role = Role.Button, onClick = onClick).padding(start = 20.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.width(28.dp), contentAlignment = Alignment.Center) {
            if (icon != null) Text(icon, style = PhoneType.title3) else FoleviIcon(glyph, null, size = 22.dp, tint = p.inkMuted)
        }
        Column(
            Modifier.weight(1f).padding(start = 12.dp).heightIn(min = 64.dp)
                .drawBehind { drawLine(c.separator, Offset(0f, size.height), Offset(size.width, size.height), 0.5.dp.toPx()) }
                .padding(end = 16.dp, top = 10.dp, bottom = 10.dp),
            verticalArrangement = Arrangement.Center,
        ) {
            Text(title, style = PhoneType.body, color = p.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (meta.isNotBlank()) Text(meta, style = PhoneType.subheadline, color = p.inkMuted, maxLines = lines, overflow = TextOverflow.Ellipsis)
        }
    }
}
