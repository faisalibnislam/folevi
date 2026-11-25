// The first build's Material title bar and Back button, still used by a few screens drawn before the phone kit
// (design/PhoneKit.kt). Foli AI is in AiScreens.kt, Shared with Me and Changes in SharedChangesScreens.kt,
// Settings in SettingsScreens.kt, Tasks and Calendar in TasksScreens.kt and CalendarScreens.kt.
package com.folevi.android.ui

import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.IconButton
import androidx.compose.material3.LargeTopAppBar
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.folevi.android.design.FoleviIcon
import com.folevi.android.design.WebIcon

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BigTitle(title: String, navigation: (@Composable () -> Unit)? = null, actions: @Composable () -> Unit = {}) {
    LargeTopAppBar(
        title = { Text(title, maxLines = 1, overflow = TextOverflow.Ellipsis) },
        navigationIcon = { navigation?.invoke() },
        actions = { actions() },
        colors = TopAppBarDefaults.topAppBarColors(containerColor = Color.Transparent),
    )
}

@Composable
fun BackButton(onBack: () -> Unit) {
    IconButton(onClick = onBack) { FoleviIcon(WebIcon.CHEVRON_LEFT, "Back", size = 24.dp) }
}
