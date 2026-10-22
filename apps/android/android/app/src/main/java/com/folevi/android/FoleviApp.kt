package com.folevi.android

import android.app.Application
import com.folevi.android.auth.AuthBridge
import com.folevi.android.net.Http
import com.folevi.android.secure.KeystoreCipher
import com.folevi.android.secure.SecretStore
import java.io.File

/** The app's long-lived parts, made once per process and shared by the activity, plugins, widgets and services. */
class FoleviApp : Application() {
    lateinit var settings: ShellSettings
        private set
    lateinit var secrets: SecretStore
        private set
    lateinit var auth: AuthBridge
        private set
    lateinit var library: com.folevi.android.library.LibraryService
        private set
    lateinit var cloud: com.folevi.android.cloud.CloudAuth
        private set
    lateinit var ai: com.folevi.android.ai.AiService
        private set

    /** Shows a system screen that answers with a result (Google's consent screen): set by the activity on screen. */
    @Volatile var showForResult: (suspend (android.app.PendingIntent) -> android.content.Intent?)? = null

    override fun onCreate() {
        super.onCreate()
        instance = this
        settings = ShellSettings(this)
        com.folevi.android.host.Reminders.channels(this)
        com.folevi.android.extras.Widgets.schedule(this)
        com.folevi.android.push.Push.start(this)
        secrets = SecretStore(File(noBackupFilesDir, "secrets"), KeystoreCipher("folevi.secrets.v1"))
        library = com.folevi.android.library.LibraryService(noBackupFilesDir, this)
        val cloudPrefs = getSharedPreferences("folevi-cloud", MODE_PRIVATE)
        cloud = com.folevi.android.cloud.CloudAuth(
            store = secrets,
            http = Http.client,
            dropboxAppKey = BuildConfig.DROPBOX_APP_KEY,
            driveEnabled = BuildConfig.GOOGLE_ANDROID_CLIENT_ID.isNotEmpty(),
            drive = com.folevi.android.cloud.GoogleDriveAuthorizer(this, Http.client) { pi -> showForResult?.invoke(pi) },
            prefs = object : com.folevi.android.cloud.CloudAuth.Prefs {
                override fun get(key: String) = cloudPrefs.getString(key, null)
                override fun set(key: String, value: String?) {
                    cloudPrefs.edit().apply { if (value == null) remove(key) else putString(key, value) }.apply()
                }
            },
        )
        ai = com.folevi.android.ai.AiService(secrets, Http.client)
        auth = AuthBridge(
            serviceUrl = BuildConfig.SERVICE_URL,
            redirectUri = BuildConfig.AUTH_REDIRECT_URI,
            http = Http.client,
            store = secrets,
            deviceName = { "Folevi for Android (${settings.deviceName})" },
        )
    }

    companion object {
        lateinit var instance: FoleviApp
            private set
    }
}
