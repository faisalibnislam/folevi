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
    lateinit var deviceKeys: com.folevi.android.e2ee.DeviceKeys
        private set
    /** Several places (Places.kt): the library and any number of accounts; the open one is the page's. */
    lateinit var places: Places
        private set
    private val accountKeys = HashMap<String, com.folevi.android.e2ee.DeviceKeys>()

    /** The open account's own encryption keys (e2ee/accounts/<user id>); the library and older builds use the phone's first pair. */
    @Synchronized
    fun currentKeys(): com.folevi.android.e2ee.DeviceKeys {
        val user = places.currentUserId ?: return deviceKeys
        return accountKeys.getOrPut(user) { com.folevi.android.e2ee.DeviceKeys(File(noBackupFilesDir, "e2ee/accounts/$user"), KeystoreCipher("folevi.e2ee.v1")) }
    }

    /** The keys this phone made before it held several accounts belonged to its one account: they become its. */
    fun adoptLegacyKeys(user: String) {
        val legacy = File(noBackupFilesDir, "e2ee")
        val target = File(legacy, "accounts/$user")
        if (target.exists() || !File(legacy, "device.bin").exists()) return
        target.mkdirs()
        for (f in listOf("device.bin", "device.json", "prefs.json")) File(legacy, f).takeIf { it.exists() }?.renameTo(File(target, f))
    }

    /** Signing out of an account: its keys go. */
    @Synchronized
    fun forgetKeys(user: String) {
        accountKeys.remove(user)?.let { runCatching { it.reset() } }
        File(noBackupFilesDir, "e2ee/accounts/$user").deleteRecursively()
    }

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
        deviceKeys = com.folevi.android.e2ee.DeviceKeys(File(noBackupFilesDir, "e2ee"), KeystoreCipher("folevi.e2ee.v1"))
        places = Places(Places.preferences(this)) { s ->
            // The mode older code reads (widgets, extras, the bridge's initialMode) follows the open place.
            settings.mode = places.modeOf(s.current)
        }
        places.migrate(settings.mode, library.configured)
        // Account mode with no account yet (the sign-in screen), or the session an older build kept.
        if (settings.mode == "account" && places.state.current == null) {
            places.state.accounts.firstOrNull()?.let { places.setCurrent(it.id) } ?: run { places.pendingAccount = true }
        }
        auth = AuthBridge(
            serviceUrl = BuildConfig.SERVICE_URL,
            redirectUri = BuildConfig.AUTH_REDIRECT_URI,
            http = Http.client,
            store = secrets,
            deviceName = { "Folevi for Android (${settings.deviceName})" },
            currentUser = { places.currentUserId },
        )
    }

    companion object {
        lateinit var instance: FoleviApp
            private set
    }
}
