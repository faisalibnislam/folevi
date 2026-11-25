// The note's Insert tool, drawn natively as the iPhone's (apps/native-kit/Sources/FoleviDesign/Phone/
// PhoneInsertSheet.swift) and the web's phone layout (components/doc/InsertPanel.tsx): a search field, then the
// sections (Suggested, Text, Lists and tasks, Layout, Visuals, Media, Data and more) of picture tiles, four to a row,
// and a Quick table picker at the end. The catalogue is design/InsertCatalog.kt, generated from the web's own
// components. A tile inserts below the current line (`insert { kind }`).
package com.folevi.android.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.folevi.android.design.FoleviIcon
import com.folevi.android.design.InsertCatalog
import com.folevi.android.design.InsertPicture
import com.folevi.android.design.InsertSectionSpec
import com.folevi.android.design.InsertTileSpec
import com.folevi.android.design.LocalPalette
import com.folevi.android.design.PhoneRadius
import com.folevi.android.design.PhoneType
import com.folevi.android.design.WebIcon
import com.folevi.android.design.phoneColors

/** Words starting with what's typed ("tab" finds Table, not "database"); with a space, a phrase (the iPhone's). */
internal fun insertMatches(query: String, text: String): Boolean {
    val q = query.trim().lowercase()
    if (q.isEmpty()) return true
    val t = text.lowercase()
    if (q.contains(' ')) return t.contains(q)
    return t.split(Regex("[^\\p{L}\\p{N}]+")).any { it.startsWith(q) }
}

/** The quick table's words: it shows when they match too. */
private const val TABLE_WORDS = "table grid rows columns size"

/**
 * The sections for `query`: Media gains the scanner's tiles where the phone can scan, Unsplash only off local mode;
 * sections with nothing left go (Data and more stays while the quick table matches).
 */
internal fun insertSections(query: String, scanner: Boolean, stockPhotos: Boolean): List<InsertSectionSpec> =
    InsertCatalog.sections.map { s ->
        val extra = if (s.title == "Media" && scanner) InsertCatalog.scanTiles else emptyList()
        InsertSectionSpec(s.title, (s.tiles + extra).filter { insertMatches(query, it.keywords) && (stockPhotos || it.kind != "image-from-unsplash") })
    }.filter { it.tiles.isNotEmpty() || (it.title == "Data and more" && insertMatches(query, TABLE_WORDS)) }

/** The Insert sheet: `onInsert` gets the tile's kind (or "quick-table-RxC"), then the sheet closes. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun InsertSheet(onDismiss: () -> Unit, onInsert: (String) -> Unit, scanner: Boolean = false, stockPhotos: Boolean = true) {
    val c = phoneColors()
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = c.solid,
        shape = RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp),
        scrimColor = Color.Black.copy(alpha = 0.10f),
    ) {
        InsertSheetContent(scanner, stockPhotos) { kind -> onInsert(kind); onDismiss() }
    }
}

/** The sheet's content (its own composable so tests can draw it without the sheet's window). */
@Composable
internal fun InsertSheetContent(scanner: Boolean, stockPhotos: Boolean, insert: (String) -> Unit) {
    val p = LocalPalette.current
    val c = phoneColors()
    var query by remember { mutableStateOf("") }
    val sections = insertSections(query, scanner, stockPhotos)
    Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 24.dp)) {
        Text("Insert", style = PhoneType.headline, color = p.heading, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(bottom = 10.dp))
        // Search: 40 tall, radius 10, the ink at 7%.
        Row(
            Modifier.fillMaxWidth().padding(top = 2.dp, bottom = 8.dp).height(40.dp).clip(PhoneRadius.control).background(c.ink(0.07f)).padding(horizontal = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            FoleviIcon(WebIcon.SEARCH, null, size = 17.dp, tint = p.inkMuted)
            Box(Modifier.weight(1f)) {
                if (query.isEmpty()) Text("Search", style = PhoneType.body, color = p.inkFaint)
                BasicTextField(
                    query,
                    { query = it },
                    singleLine = true,
                    textStyle = PhoneType.body.copy(color = p.ink),
                    cursorBrush = SolidColor(p.accent),
                    modifier = Modifier.fillMaxWidth().testTag("insert-search").semantics { contentDescription = "Search blocks" },
                )
            }
        }
        sections.forEachIndexed { i, s -> InsertSection(s, first = i == 0, showTable = s.title == "Data and more" && insertMatches(query, TABLE_WORDS), insert = insert) }
        if (sections.isEmpty()) {
            Column(Modifier.fillMaxWidth().padding(top = 32.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text("No matches", style = PhoneType.subheadline.copy(fontWeight = FontWeight.Medium), color = p.ink)
                Text("Nothing called “${query.trim()}”. Try another word.", style = PhoneType.footnote, color = p.inkMuted, textAlign = TextAlign.Center)
            }
        }
    }
}

@Composable
private fun InsertSection(s: InsertSectionSpec, first: Boolean, showTable: Boolean, insert: (String) -> Unit) {
    val p = LocalPalette.current
    Column(Modifier.fillMaxWidth().padding(top = if (first) 0.dp else 24.dp)) {
        Text(s.title.uppercase(), style = PhoneType.eyebrow, color = p.inkMuted, modifier = Modifier.padding(start = 4.dp, end = 4.dp, bottom = 10.dp))
        // Four to a row: 8 across, 6 down (the label's two lines keep rows apart, 14 between pictures).
        s.tiles.chunked(4).forEach { row ->
            Row(Modifier.fillMaxWidth().padding(bottom = 6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                row.forEach { t -> InsertTile(t, Modifier.weight(1f)) { insert(t.kind) } }
                repeat(4 - row.size) { Spacer(Modifier.weight(1f)) }
            }
        }
        if (showTable) QuickTablePicker(Modifier.padding(top = if (s.tiles.isEmpty()) 0.dp else 16.dp)) { r, col -> insert("quick-table-${r}x$col") }
    }
}

/** A tile: the picture on the tile's grey (the ink at 4.5% over the raised surface, a 0.5 edge), two lines under it. */
@Composable
private fun InsertTile(t: InsertTileSpec, modifier: Modifier, onClick: () -> Unit) {
    val p = LocalPalette.current
    Column(
        modifier.clip(PhoneRadius.panel).clickable(role = Role.Button, onClickLabel = t.name ?: t.label, onClick = onClick)
            .semantics { contentDescription = t.name ?: t.label }.testTag("insert-${t.kind}"),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Box(
            Modifier.fillMaxWidth().height(56.dp).clip(PhoneRadius.panel).background(p.surfaceRaised).background(p.ink.copy(alpha = 0.045f))
                .border(0.5.dp, p.ink.copy(alpha = 0.08f), PhoneRadius.panel),
            contentAlignment = Alignment.Center,
        ) {
            val preview = t.preview
            if (preview != null) InsertPicture(preview) else DividerLine(t.kind.removePrefix("divider-"))
        }
        Text(
            t.label,
            style = PhoneType.footnote.copy(fontWeight = FontWeight.Medium, lineHeight = 16.sp),
            color = p.ink,
            textAlign = TextAlign.Center,
            maxLines = 2,
            minLines = 2,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.fillMaxWidth().padding(horizontal = 2.dp),
        )
    }
}

/** A divider style's line: dots, fine dots, a hairline or a strong rule. */
@Composable
private fun DividerLine(style: String) {
    val p = LocalPalette.current
    val m = Modifier.fillMaxWidth().padding(horizontal = 12.dp)
    when (style) {
        "extralight" -> Canvas(m.height(4.dp)) {
            var x = 5.dp.toPx()
            while (x < size.width) { drawCircle(p.inkFaint.copy(alpha = 0.8f), 1.1.dp.toPx(), Offset(x, size.height / 2)); x += 10.dp.toPx() }
        }
        "light" -> Canvas(m.height(2.dp)) {
            var x = 2.dp.toPx()
            while (x < size.width) { drawCircle(p.inkFaint, 0.7.dp.toPx(), Offset(x, size.height / 2)); x += 4.dp.toPx() }
        }
        "strong" -> Box(m.height(3.dp).clip(RoundedCornerShape(4.dp)).background(p.ink.copy(alpha = 0.4f)))
        else -> Box(m.height(1.dp).background(p.lineStrong))
    }
}

/**
 * Quick table: 5 rows of 8 cells. A tap adds a table of that size; a press held still, then slid, lights rows by
 * columns from the top left and adds that table when let go on the grid.
 */
@Composable
private fun QuickTablePicker(modifier: Modifier, pick: (Int, Int) -> Unit) {
    val p = LocalPalette.current
    var lit by remember { mutableStateOf<Pair<Int, Int>?>(null) }
    val density = LocalDensity.current
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text("Simple table", style = PhoneType.footnote.copy(fontWeight = FontWeight.Medium), color = p.ink, modifier = Modifier.padding(horizontal = 4.dp))
        Text("Rows and columns of plain text. Tap a size to add it, or hold and slide to pick one.", style = PhoneType.footnote, color = p.inkMuted, modifier = Modifier.padding(horizontal = 4.dp))
        BoxWithConstraints(Modifier.fillMaxWidth()) {
            val widthPx = with(density) { maxWidth.toPx() }
            val pad = with(density) { 10.dp.toPx() }
            val gap = with(density) { 4.dp.toPx() }
            val cw = (widthPx - 2 * pad - 7 * gap) / 8
            val ch = cw * 0.7f
            fun cellAt(o: Offset, slack: Float = 0f): Pair<Int, Int>? {
                val height = 2 * pad + 5 * ch + 4 * gap
                if (o.x < -slack || o.y < -slack || o.x > widthPx + slack || o.y > height + slack) return null
                val col = (((o.x - pad) / (cw + gap)).toInt() + 1).coerceIn(1, 8)
                val row = (((o.y - pad) / (ch + gap)).toInt() + 1).coerceIn(1, 5)
                return row to col
            }
            Column(
                Modifier.fillMaxWidth().clip(PhoneRadius.control).background(p.surfaceRaised).border(1.dp, p.line, PhoneRadius.control)
                    .pointerInput(cw) { detectTapGestures { o -> cellAt(o)?.let { (r, c) -> pick(r, c) } } }
                    .pointerInput(cw) {
                        val slack = 24.dp.toPx()
                        var last: Offset? = null
                        detectDragGesturesAfterLongPress(
                            onDragStart = { o -> last = o; lit = cellAt(o, slack) },
                            onDrag = { change, _ -> last = change.position; lit = cellAt(change.position, slack) },
                            onDragEnd = { last?.let { cellAt(it, slack) }?.let { (r, c) -> pick(r, c) }; lit = null },
                            onDragCancel = { lit = null },
                        )
                    }
                    .padding(10.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                for (r in 1..5) {
                    Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        for (col in 1..8) {
                            val on = lit?.let { r <= it.first && col <= it.second } == true
                            Box(
                                Modifier.size(with(density) { cw.toDp() }, with(density) { ch.toDp() }).clip(RoundedCornerShape(3.dp))
                                    .background(if (on) p.heading.copy(alpha = 0.85f) else p.ink.copy(alpha = 0.08f))
                                    .semantics { contentDescription = "$r × $col table" },
                            )
                        }
                    }
                }
            }
        }
        Text(lit?.let { "${it.first} × ${it.second}" } ?: " ", style = PhoneType.footnote.copy(fontWeight = FontWeight.Medium, fontFeatureSettings = "tnum"), color = p.inkMuted, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
    }
}
