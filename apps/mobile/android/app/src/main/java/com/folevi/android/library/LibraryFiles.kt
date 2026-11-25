package com.folevi.android.library

import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import com.folevi.android.web.LocalFiles
import java.io.ByteArrayInputStream
import java.io.File

/**
 * A local library's attachments for the page, at https://localhost/_files/<sha256>?type=<mime> (what
 * `library.fileUrl` hands out): read from the library's folder on this phone (or a cloud library's copy here),
 * with Range support for audio and video, `nosniff`, and HTML and SVG sent as plain bytes.
 */
class LibraryFiles(private val folder: () -> File?) : LocalFiles {
    override fun serve(request: WebResourceRequest): WebResourceResponse? {
        val sha = request.url.lastPathSegment?.lowercase() ?: return null
        if (!Regex("^[0-9a-f]{64}$").matches(sha)) return null
        val root = folder() ?: return null
        val file = File(root, "files/${sha.substring(0, 2)}/$sha")
        if (!file.isFile) return null
        val type = request.url.getQueryParameter("type")?.takeIf { Regex("^[a-z0-9.+-]+/[a-z0-9.+-]+$").matches(it) && it !in UNSAFE } ?: "application/octet-stream"
        val size = file.length()
        val headers = mutableMapOf("x-content-type-options" to "nosniff", "accept-ranges" to "bytes", "cache-control" to "private, max-age=31536000, immutable")
        val range = request.requestHeaders.entries.firstOrNull { it.key.equals("range", true) }?.value
        val m = range?.let { Regex("^bytes=(\\d*)-(\\d*)$").find(it.trim()) }
        if (m != null && size > 0) {
            val (a, b) = m.destructured
            val start = if (a.isEmpty()) (size - (b.toLongOrNull() ?: 0)).coerceAtLeast(0) else a.toLong()
            val end = if (a.isEmpty() || b.isEmpty()) size - 1 else minOf(b.toLong(), size - 1)
            if (start > end || start >= size) {
                headers["content-range"] = "bytes */$size"
                return WebResourceResponse(type, null, 416, "Range Not Satisfiable", headers, ByteArrayInputStream(ByteArray(0)))
            }
            val len = (end - start + 1).toInt()
            val bytes = ByteArray(len)
            java.io.RandomAccessFile(file, "r").use { it.seek(start); it.readFully(bytes) }
            headers["content-range"] = "bytes $start-$end/$size"
            headers["content-length"] = len.toString()
            return WebResourceResponse(type, null, 206, "Partial Content", headers, ByteArrayInputStream(bytes))
        }
        headers["content-length"] = size.toString()
        return WebResourceResponse(type, null, 200, "OK", headers, file.inputStream())
    }

    companion object {
        /** Types a page could run as a document: served as bytes instead. */
        val UNSAFE = setOf("text/html", "image/svg+xml", "application/xhtml+xml", "text/xml", "application/xml", "text/javascript", "application/javascript")
    }
}
