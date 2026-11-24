// Material 3 Expressive with Folevi's colors and typefaces (owner decision 2026-11-23, docs/ANDROID_NATIVE_PLAN.md):
// Material draws the bars, navigation, buttons, menus and sheets; the scheme comes from Folevi's tokens, text is
// Instrument Sans and titles are Spectral, as on the web, iPhone and Mac.
package com.folevi.android.design

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.MaterialExpressiveTheme
import androidx.compose.material3.MotionScheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.folevi.android.R

val InstrumentSans = FontFamily(
    Font(R.font.instrument_sans, FontWeight.Normal),
    Font(R.font.instrument_sans, FontWeight.Medium),
    Font(R.font.instrument_sans, FontWeight.SemiBold),
    Font(R.font.instrument_sans, FontWeight.Bold),
)

val Spectral = FontFamily(
    Font(R.font.spectral_regular, FontWeight.Normal),
    Font(R.font.spectral_medium, FontWeight.Medium),
    Font(R.font.spectral_semibold, FontWeight.SemiBold),
    Font(R.font.spectral_bold, FontWeight.Bold),
)

/** Folevi's palette for the pieces Material doesn't name (note colors, card backdrops, faint ink). */
val LocalPalette = staticCompositionLocalOf { FoleviPalette.Light }

private fun scheme(p: FoleviPalette, dark: Boolean): ColorScheme {
    val base = if (dark) darkColorScheme() else lightColorScheme()
    return base.copy(
        primary = p.accent,
        onPrimary = p.accentInk,
        primaryContainer = p.accentSoft,
        onPrimaryContainer = p.accentSoftInk,
        secondary = p.ember,
        onSecondary = p.accentInk,
        secondaryContainer = p.emberSoft,
        onSecondaryContainer = p.emberInk,
        tertiary = p.moss,
        tertiaryContainer = p.mossSoft,
        onTertiaryContainer = p.mossInk,
        background = p.canvas,
        onBackground = p.ink,
        surface = p.canvas,
        onSurface = p.ink,
        surfaceVariant = p.surfaceSunken,
        onSurfaceVariant = p.inkMuted,
        surfaceContainerLowest = p.surface,
        surfaceContainerLow = p.sidebar,
        surfaceContainer = p.sidebar,
        surfaceContainerHigh = p.surfaceSunken,
        surfaceContainerHighest = p.line,
        surfaceBright = p.surfaceRaised,
        surfaceDim = p.surfaceSunken,
        outline = p.lineStrong,
        outlineVariant = p.line,
        error = p.destructive,
        errorContainer = p.destructiveSoft,
        scrim = p.ink,
    )
}

private fun typography(): Typography {
    val t = Typography()
    fun TextStyle.sans() = copy(fontFamily = InstrumentSans)
    fun TextStyle.serif(weight: FontWeight = FontWeight.Medium) = copy(fontFamily = Spectral, fontWeight = weight)
    return Typography(
        displayLarge = t.displayLarge.serif(),
        displayMedium = t.displayMedium.serif(),
        displaySmall = t.displaySmall.serif(),
        headlineLarge = t.headlineLarge.serif(),
        headlineMedium = t.headlineMedium.serif(),
        headlineSmall = t.headlineSmall.serif(),
        titleLarge = t.titleLarge.serif(FontWeight.SemiBold),
        titleMedium = t.titleMedium.sans().copy(fontWeight = FontWeight.SemiBold),
        titleSmall = t.titleSmall.sans().copy(fontWeight = FontWeight.SemiBold),
        bodyLarge = t.bodyLarge.sans(),
        bodyMedium = t.bodyMedium.sans(),
        bodySmall = t.bodySmall.sans(),
        labelLarge = t.labelLarge.sans(),
        labelMedium = t.labelMedium.sans(),
        labelSmall = t.labelSmall.sans(),
    )
}

/** The token radii (tokens.json radius): small 8, control 10, panel 14, container 18, sheet 28. */
private val FoleviShapes = Shapes(
    extraSmall = RoundedCornerShape(6.dp),
    small = RoundedCornerShape(10.dp),
    medium = RoundedCornerShape(14.dp),
    large = RoundedCornerShape(18.dp),
    extraLarge = RoundedCornerShape(28.dp),
)

/** A note card's title, in the display face. */
val CardTitle = TextStyle(fontFamily = Spectral, fontWeight = FontWeight.SemiBold, fontSize = 17.sp, lineHeight = 22.sp)

@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun FoleviTheme(dark: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    val palette = if (dark) FoleviPalette.Dark else FoleviPalette.Light
    CompositionLocalProvider(LocalPalette provides palette) {
        MaterialExpressiveTheme(
            colorScheme = scheme(palette, dark),
            motionScheme = MotionScheme.expressive(),
            shapes = FoleviShapes,
            typography = typography(),
            content = content,
        )
    }
}
