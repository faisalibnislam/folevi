package com.folevi.android.extras

import android.app.Activity
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.util.Base64
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.documentscanner.GmsDocumentScannerOptions
import com.google.mlkit.vision.documentscanner.GmsDocumentScanning
import com.google.mlkit.vision.documentscanner.GmsDocumentScanningResult
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import kotlin.coroutines.resume

/**
 * "Scan document" and "Scan from photos" in a note (docs/ANDROID_PLAN.md "Native v1"): ML Kit's document scanner
 * (Google Play services' camera screen, with edges and cleanup) or pages picked from the photo library, each
 * page a JPEG of at most 2200 px on its long side, and the words read from every page with ML Kit's text
 * recognition, on the phone. The same answer as the iPhone app's scanDocument.
 */
object Scanner {
    fun available(context: Context): Boolean =
        GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(context) == ConnectionResult.SUCCESS

    /** The camera's scanner: the pages' images, or null when the person backed out. */
    suspend fun scan(activity: Activity, launch: suspend (android.content.IntentSender) -> android.content.Intent?): List<Uri>? {
        val options = GmsDocumentScannerOptions.Builder()
            .setGalleryImportAllowed(true)
            .setPageLimit(20)
            .setResultFormats(GmsDocumentScannerOptions.RESULT_FORMAT_JPEG)
            .setScannerMode(GmsDocumentScannerOptions.SCANNER_MODE_FULL)
            .build()
        val sender = GmsDocumentScanning.getClient(options).getStartScanIntent(activity).await()
        val data = launch(sender) ?: return null
        return GmsDocumentScanningResult.fromActivityResultIntent(data)?.pages?.map { it.imageUri }
    }

    /** The pages as the page takes them (JPEG, base64) and the words on them. */
    suspend fun answer(context: Context, pages: List<Uri>): JSObject = withContext(Dispatchers.IO) {
        val arr = JSArray()
        val words = StringBuilder()
        pages.forEachIndexed { i, uri ->
            val bitmap = decode(context, uri) ?: return@forEachIndexed
            val jpeg = ByteArrayOutputStream().also { bitmap.compress(Bitmap.CompressFormat.JPEG, 85, it) }.toByteArray()
            arr.put(JSObject().put("name", "Scan ${i + 1}.jpg").put("type", "image/jpeg").put("data", Base64.encodeToString(jpeg, Base64.NO_WRAP)))
            val text = runCatching { read(bitmap) }.getOrDefault("")
            if (text.isNotBlank()) {
                if (words.isNotEmpty()) words.append("\n\n")
                words.append(text.trim())
            }
            bitmap.recycle()
        }
        JSObject().put("pages", arr).put("text", words.toString())
    }

    /** An image, at most 2200 px on its long side. */
    fun decode(context: Context, uri: Uri): Bitmap? {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
        return decodeScaled(bounds.outWidth, bounds.outHeight) { o -> context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, o) } }
    }

    fun decodeBytes(bytes: ByteArray): Bitmap? {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        return decodeScaled(bounds.outWidth, bounds.outHeight) { o -> BitmapFactory.decodeByteArray(bytes, 0, bytes.size, o) }
    }

    private fun decodeScaled(w: Int, h: Int, decode: (BitmapFactory.Options) -> Bitmap?): Bitmap? {
        if (w <= 0 || h <= 0) return null
        var sample = 1
        while (maxOf(w, h) / (sample * 2) >= MAX_SIDE) sample *= 2
        val b = decode(BitmapFactory.Options().apply { inSampleSize = sample }) ?: return null
        val long = maxOf(b.width, b.height)
        if (long <= MAX_SIDE) return b
        val k = MAX_SIDE.toFloat() / long
        return Bitmap.createScaledBitmap(b, (b.width * k).toInt(), (b.height * k).toInt(), true).also { if (it !== b) b.recycle() }
    }

    /** The words in an image (search in files, the scanner), read on the phone. */
    suspend fun read(bitmap: Bitmap): String = suspendCancellableCoroutine { cont ->
        TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS).process(InputImage.fromBitmap(bitmap, 0))
            .addOnSuccessListener { cont.resume(it.text) }
            .addOnFailureListener { cont.resume("") }
    }

    const val MAX_SIDE = 2200
}
