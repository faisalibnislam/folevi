package com.folevi.android.extras

import android.app.PendingIntent
import android.content.Intent
import android.net.Uri
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import com.folevi.android.MainActivity

/** "Quick add" in Quick Settings: opens Folevi on Quick add task (folevi://quick-add), as the iPhone's control does. */
class QuickAddTile : TileService() {
    override fun onStartListening() {
        qsTile?.apply {
            state = Tile.STATE_INACTIVE
            label = "Quick add"
            subtitle = "Folevi"
            updateTile()
        }
    }

    override fun onClick() {
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse("folevi://quick-add"), this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        startActivityAndCollapse(PendingIntent.getActivity(this, 7, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
    }
}
