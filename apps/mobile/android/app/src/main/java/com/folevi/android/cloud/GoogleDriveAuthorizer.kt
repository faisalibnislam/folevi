package com.folevi.android.cloud

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import com.google.android.gms.auth.api.identity.AuthorizationRequest
import com.google.android.gms.auth.api.identity.AuthorizationResult
import com.google.android.gms.auth.api.identity.Identity
import com.google.android.gms.common.api.Scope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import okhttp3.FormBody
import okhttp3.OkHttpClient
import okhttp3.Request
import kotlin.coroutines.resume

/**
 * Google Drive's sign-in on Android: Google Identity Services' authorization for `drive.file` (only the files
 * Folevi made). Google knows the app by its package name and signing key's SHA-1 (an Android OAuth client in
 * the Folevi Google Cloud project), so the build carries no secret and there's no redirect. The consent screen
 * shows the first time (and after access was revoked); later tokens come without a screen.
 */
class GoogleDriveAuthorizer(
    private val context: Context,
    private val http: OkHttpClient,
    /** Shows Google's consent screen (MainActivity's activity-result launcher); the result's data, or null. */
    private val resolve: suspend (PendingIntent) -> Intent?,
) : CloudAuth.DriveAuthorizer {

    private val request = AuthorizationRequest.builder().setRequestedScopes(listOf(Scope(DRIVE_FILE))).build()

    override suspend fun authorize(interactive: Boolean): CloudAuth.DriveToken? {
        val client = Identity.getAuthorizationClient(context)
        val result: AuthorizationResult = suspendCancellableCoroutine<AuthorizationResult?> { cont ->
            client.authorize(request)
                .addOnSuccessListener { cont.resume(it) }
                .addOnFailureListener { cont.resume(null) }
        } ?: return null
        result.accessToken?.let { return CloudAuth.DriveToken(it, result.toGoogleSignInAccount()?.email) }
        val pending = result.pendingIntent ?: return null
        if (!interactive) return null
        val data = withContext(Dispatchers.Main) { resolve(pending) } ?: return null
        val after = runCatching { client.getAuthorizationResultFromIntent(data) }.getOrNull() ?: return null
        return after.accessToken?.let { CloudAuth.DriveToken(it, after.toGoogleSignInAccount()?.email) }
    }

    override suspend fun revoke(token: String) {
        withContext(Dispatchers.IO) {
            runCatching { http.newCall(Request.Builder().url("https://oauth2.googleapis.com/revoke").post(FormBody.Builder().add("token", token).build()).build()).execute().close() }
        }
    }

    companion object {
        const val DRIVE_FILE = "https://www.googleapis.com/auth/drive.file"
    }
}
