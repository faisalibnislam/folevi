package com.folevi.android.server

import android.app.Activity
import com.folevi.android.BuildConfig
import com.folevi.android.FoleviApp
import com.folevi.android.net.Http
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

/**
 * "Your own server" (CONTRACT §6.1), shared by the page's bridge (PlacesPlugin.addServer, scanCode) and the native
 * sign-in screen (ui/OwnServer.kt): look an address up, open that server's sign-in, scan an invite's QR code.
 */
object ServerSignIn {
    /** The address checked and the server's folevi.json fetched here (never what a page read), versions included. */
    suspend fun lookUp(raw: String): ShellServer.Result = withContext(Dispatchers.IO) {
        ShellServer.lookUp(ShellServer.client(Http.client), raw, BuildConfig.VERSION_NAME)
    }

    /**
     * The sign-in screen becomes that server's: the account that signs in there becomes a place on it. The caller
     * loads the page again. Sign-in is account mode's, as ShellPlugin.setMode (leaving local mode clears its extras).
     */
    fun open(server: ShellServer) {
        val app = FoleviApp.instance
        app.places.setCurrent(null, pending = true, server = server)
        val settings = app.settings
        if (settings.mode != "account") {
            if (settings.mode == "local") {
                com.folevi.android.extras.LocalActions.get(app).clear()
                com.folevi.android.extras.Widgets.clear(app)
            }
            settings.mode = "account"
        }
    }

    /** The scanner can't run on this phone (as opposed to the person closing it). */
    class ScanUnavailable : Exception("Folevi couldn't open the camera to scan a code.")

    /**
     * Google's code scanner reads a QR code on its own camera screen (the app asks for no camera permission): its
     * text, or null when the person closed it. Throws [ScanUnavailable] when it can't run here.
     */
    suspend fun scan(activity: Activity): String? {
        val options = com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions.Builder()
            .setBarcodeFormats(com.google.mlkit.vision.barcode.common.Barcode.FORMAT_QR_CODE)
            .build()
        val scanner = com.google.mlkit.vision.codescanner.GmsBarcodeScanning.getClient(activity, options)
        // The scanner is a Play services module, fetched on first use: wait for it rather than fail.
        val ready = runCatching {
            val request = com.google.android.gms.common.moduleinstall.ModuleInstallRequest.newBuilder().addApi(scanner).build()
            com.google.android.gms.common.moduleinstall.ModuleInstall.getClient(activity).installModules(request).await()
        }
        if (ready.isFailure) {
            android.util.Log.w("FoleviServer", "scan: module install failed", ready.exceptionOrNull())
            throw ScanUnavailable()
        }
        return try {
            scanner.startScan().await().rawValue?.take(2_000)
        } catch (e: Exception) {
            // Closing the scanner (Back, or its X) is "no code": Play services reports it as cancelled, or on some
            // versions as an internal error (13, seen on the Android 37 emulator).
            val code = (e as? com.google.mlkit.common.MlKitException)?.errorCode
            android.util.Log.i("FoleviServer", "scan ended: ${e.javaClass.simpleName} $code")
            if (code != null && code in UNUSABLE) throw ScanUnavailable() else null
        }
    }

    /** An invite link's server, or the text itself (the web's addressFromCode). */
    fun addressFromCode(text: String): String {
        val raw = text.trim()
        if (!raw.startsWith("http://", ignoreCase = true) && !raw.startsWith("https://", ignoreCase = true)) return raw
        val url = raw.toHttpUrlOrNull() ?: return raw
        return url.newBuilder().encodedPath("/").query(null).fragment(null).build().toString().removeSuffix("/")
    }

    /** MlKitException codes that mean the scanner can't run here (not that the person closed it). */
    private val UNUSABLE = setOf(
        com.google.mlkit.common.MlKitException.UNAVAILABLE,
        com.google.mlkit.common.MlKitException.CODE_SCANNER_UNAVAILABLE,
        com.google.mlkit.common.MlKitException.CODE_SCANNER_CAMERA_PERMISSION_NOT_GRANTED,
        com.google.mlkit.common.MlKitException.CODE_SCANNER_APP_NAME_UNAVAILABLE,
        com.google.mlkit.common.MlKitException.CODE_SCANNER_PIPELINE_INITIALIZATION_ERROR,
        com.google.mlkit.common.MlKitException.CODE_SCANNER_PIPELINE_INFERENCE_ERROR,
        com.google.mlkit.common.MlKitException.CODE_SCANNER_GOOGLE_PLAY_SERVICES_VERSION_TOO_OLD,
    )
}
