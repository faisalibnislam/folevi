// The web's Lucide icons (WebIcons.kt, scripts/icons-codegen-kotlin.mjs) as Compose vectors, stroked the way
// lucide draws them: a 24 dp grid, round caps and joins, stroke width 2, in the current content color.
package com.folevi.android.design

import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalContentColor
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import java.util.EnumMap

private val cache = EnumMap<WebIcon, ImageVector>(WebIcon::class.java)

/** The icon as an ImageVector (tinted by Icon's color). */
val WebIcon.vector: ImageVector
    get() = synchronized(cache) {
        cache.getOrPut(this) {
            val b = ImageVector.Builder(name = lucide, defaultWidth = 24.dp, defaultHeight = 24.dp, viewportWidth = 24f, viewportHeight = 24f)
            for (d in paths) {
                b.addPath(
                    pathData = addPathNodes(d),
                    fill = null,
                    stroke = SolidColor(Color.Black),
                    strokeLineWidth = 2f,
                    strokeLineCap = StrokeCap.Round,
                    strokeLineJoin = StrokeJoin.Round,
                )
            }
            b.build()
        }
    }

@Composable
fun FoleviIcon(icon: WebIcon, contentDescription: String?, modifier: Modifier = Modifier, size: Dp = 20.dp, tint: Color = LocalContentColor.current) {
    Icon(icon.vector, contentDescription, modifier.size(size), tint = tint)
}
