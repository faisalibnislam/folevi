// Folevi's own pieces that stay Folevi's on Android (owner decision 2026-11-23): page cards for notes, frosted
// folders and note colors. Everything around them is Material.
package com.folevi.android.design

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.folevi.engine.generated.FolderCard
import com.folevi.engine.generated.NoteRow
import java.text.DateFormat
import java.util.Date

/** A folder's or tag's named color (the web's folder palette), or the accent. */
@Composable
fun folderColor(name: String?): Color {
    val p = LocalPalette.current
    return when (name) {
        "moss", "green" -> p.moss
        "marigold", "yellow", "orange" -> p.marigold
        "plum", "purple" -> p.plum
        "coral", "red", "pink" -> p.coral
        "ember" -> p.ember
        "blue", "sky" -> Color(0xFF5B8DEF)
        else -> p.accent
    }
}

private val CardShape = RoundedCornerShape(18.dp)

/** A note as a page card: title in the display face, a few lines of its text, its folder. */
@Composable
fun NoteCard(row: NoteRow, onClick: (() -> Unit)?, modifier: Modifier = Modifier, width: Dp? = null) {
    val p = LocalPalette.current
    Column(
        modifier
            .then(if (width != null) Modifier.width(width) else Modifier.fillMaxWidth())
            .shadow(2.dp, CardShape, ambientColor = p.ink.copy(alpha = 0.08f), spotColor = p.ink.copy(alpha = 0.08f))
            .clip(CardShape)
            .background(p.surface)
            .border(1.dp, p.line, CardShape)
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            row.icon?.let { Text(it, modifier = Modifier.padding(end = 6.dp)) }
            Text(row.title.ifEmpty { "Untitled" }, style = CardTitle, color = p.heading, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
            if (row.starred) FoleviIcon(WebIcon.BOOKMARK, "Starred", size = 14.dp, tint = p.ember)
        }
        val text = row.preview?.joinToString("\n") { it.x }?.takeIf { it.isNotBlank() } ?: row.excerpt
        if (text.isNotBlank()) Text(text, style = MaterialTheme.typography.bodyMedium, color = p.inkMuted, maxLines = 4, overflow = TextOverflow.Ellipsis)
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            row.folder?.let {
                FoleviIcon(WebIcon.FOLDER, null, size = 12.dp, tint = folderColor(it.color))
                Text(it.name, style = MaterialTheme.typography.labelSmall, color = p.inkFaint, maxLines = 1)
            }
            Spacer(Modifier.weight(1f))
            Text(shortDate(row.updatedAt), style = MaterialTheme.typography.labelSmall, color = p.inkFaint)
        }
    }
}

/** A frosted folder: a tinted folder with its name and how many notes it holds. */
@Composable
fun FrostedFolder(folder: FolderCard, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val p = LocalPalette.current
    val tint = folderColor(folder.color)
    Column(modifier.clip(CardShape).clickable(onClick = onClick).padding(8.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Box(
            Modifier
                .size(width = 96.dp, height = 74.dp)
                .clip(RoundedCornerShape(14.dp))
                .background(Brush.verticalGradient(listOf(tint.copy(alpha = 0.30f), tint.copy(alpha = 0.16f))))
                .border(1.dp, tint.copy(alpha = 0.35f), RoundedCornerShape(14.dp)),
            contentAlignment = Alignment.Center,
        ) {
            FoleviIcon(if (folder.locked) WebIcon.FOLDER_LOCK else WebIcon.FOLDER, null, size = 28.dp, tint = tint)
        }
        Spacer(Modifier.height(6.dp))
        Text(folder.name, style = MaterialTheme.typography.labelLarge, color = p.ink, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.width(104.dp))
        Text(if (folder.noteCount == 1L) "1 note" else "${folder.noteCount} notes", style = MaterialTheme.typography.labelSmall, color = p.inkFaint)
    }
}

/** One formatter for every card (a new DateFormat per card cost an allocation each time a card drew). */
private val mediumDate = java.time.format.DateTimeFormatter.ofLocalizedDate(java.time.format.FormatStyle.MEDIUM)

fun shortDate(ms: Double): String = if (ms <= 0) "" else mediumDate.withZone(java.time.ZoneId.systemDefault()).format(java.time.Instant.ofEpochMilli(ms.toLong()))
