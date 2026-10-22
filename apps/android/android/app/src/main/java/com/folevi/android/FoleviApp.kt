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

    override fun onCreate() {
        super.onCreate()
        instance = this
        settings = ShellSettings(this)
        secrets = SecretStore(File(noBackupFilesDir, "secrets"), KeystoreCipher("folevi.secrets.v1"))
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
