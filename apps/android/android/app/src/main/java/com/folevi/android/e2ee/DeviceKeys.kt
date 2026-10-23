package com.folevi.android.e2ee

import com.folevi.android.secure.SealingCipher
import com.google.crypto.tink.subtle.Ed25519Sign
import com.google.crypto.tink.subtle.Hkdf
import com.google.crypto.tink.subtle.X25519
import org.json.JSONObject
import java.io.File
import java.security.SecureRandom
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * End-to-end encryption on Android (docs/E2EE_DESIGN.md §4.8, §6.2, the Electron Mac app's e2ee.ts): this
 * phone's device keys. An X25519 key pair (the account master key is sealed to it as an FLS1 box) and an Ed25519
 * key pair (it signs as this device), made on the page's first ask. Their private halves never reach the page:
 * they're sealed with an AES key in the Android Keystore (StrongBox where the phone has one, never exportable)
 * in `e2ee/device.bin`; the device id (`android-<ulid>`) and the public halves are in `e2ee/device.json`. Keys
 * another phone's Keystore can't open (a restored backup), or a `device.json` whose public keys don't match, are
 * replaced, never trusted: the page then asks to approve this phone again.
 *
 * The page can only ask for the public keys, open a box sealed to this phone, sign a statement, or forget the keys.
 * The one secret that crosses is what `open` unseals (the account master key), which the page imports as
 * non-extractable keys and zeroes. With "Ask for your fingerprint or face to unlock encrypted notes" on, `open`
 * asks first (the `confirm` hook). Nothing here logs a key, a box or what a box holds.
 */
class DeviceKeys(private val dir: File, private val cipher: SealingCipher, private val now: () -> Long = System::currentTimeMillis, private val generate: (() -> Pair<ByteArray, ByteArray>)? = null) {
    class Refused(val code: String, message: String) : Exception(message)

    data class Public(val deviceId: String, val x25519Pub: ByteArray, val ed25519Pub: ByteArray)

    private var xPriv: ByteArray? = null
    private var edSeed: ByteArray? = null
    private var pub: Public? = null
    private val lock = Any()

    private val jsonFile get() = File(dir, "device.json")
    private val binFile get() = File(dir, "device.bin")
    private val prefsFile get() = File(dir, "prefs.json")

    private fun available() {
        if (!cipher.available()) throw Refused("unavailable", "This phone can't keep encryption keys safely right now.")
    }

    private fun load(): Boolean {
        if (xPriv != null && pub != null) return true
        val meta = runCatching { JSONObject(jsonFile.readText()) }.getOrNull() ?: return false
        if (meta.optInt("version") != 1) return false
        val deviceId = meta.optString("deviceId").takeIf { it.isNotEmpty() } ?: return false
        val inner = runCatching { JSONObject(String(cipher.open(binFile.readBytes()))) }.getOrNull() ?: return false
        val x = runCatching { b64d(inner.getString("x")) }.getOrNull() ?: return false
        val ed = runCatching { b64d(inner.getString("ed")) }.getOrNull() ?: return false
        if (x.size != 32 || ed.size != 32) return false
        val p = runCatching { Public(deviceId, X25519.publicFromPrivate(x), Ed25519Sign.KeyPair.newKeyPairFromSeed(ed).publicKey) }.getOrNull() ?: return false
        // The public halves on disk must be the private halves' (a swapped file is refused, not trusted).
        if (b64(p.x25519Pub) != meta.optString("x25519Pub") || b64(p.ed25519Pub) != meta.optString("ed25519Pub")) return false
        xPriv = x
        edSeed = ed
        pub = p
        return true
    }

    private fun create() {
        available()
        val (x, ed) = generate?.invoke() ?: (X25519.generatePrivateKey() to ByteArray(32).also { SecureRandom().nextBytes(it) })
        val p = Public("android-${ulid(now())}", X25519.publicFromPrivate(x), Ed25519Sign.KeyPair.newKeyPairFromSeed(ed).publicKey)
        dir.mkdirs()
        write(binFile, cipher.seal(JSONObject().put("x", b64(x)).put("ed", b64(ed)).toString().toByteArray()))
        write(jsonFile, JSONObject().put("version", 1).put("deviceId", p.deviceId).put("x25519Pub", b64(p.x25519Pub)).put("ed25519Pub", b64(p.ed25519Pub)).put("createdAt", now()).toString().toByteArray())
        xPriv = x
        edSeed = ed
        pub = p
    }

    private fun write(target: File, bytes: ByteArray) {
        val tmp = File(dir, "${target.name}.${System.nanoTime()}.tmp")
        tmp.outputStream().use { it.write(bytes); it.fd.sync() }
        if (!tmp.renameTo(target)) {
            tmp.delete()
            throw Refused("failed", "Folevi couldn't keep this phone's encryption keys.")
        }
    }

    /** This phone's device id and public keys; made (and kept) on the first call. */
    fun deviceKeys(): Public = synchronized(lock) {
        if (!load()) create()
        val p = pub!!
        Public(p.deviceId, p.x25519Pub.copyOf(), p.ed25519Pub.copyOf())
    }

    /** Opens an FLS1 box sealed to this phone's X25519 key (§4.4). */
    fun open(box: ByteArray, context: String): ByteArray {
        if (box.size < HEADER + TAG || box.size > MAX_BOX) throw Refused("invalid_argument", "Not a sealed Folevi box.")
        if (!box.copyOfRange(0, 4).contentEquals(MAGIC) || box[4] != VERSION) throw Refused("invalid_argument", "Not a sealed Folevi box.")
        checkContext(context)
        available()
        val (x, p) = synchronized(lock) {
            if (!load()) throw Refused("unavailable", "This phone has no encryption keys yet.")
            xPriv!! to pub!!
        }
        return openSealedBox(x, p.x25519Pub, context, box)
    }

    /** An FST1 signature (base64url) by this phone's Ed25519 key over a statement's canonical JSON body. */
    fun sign(kind: String, body: String): String {
        if (kind !in KINDS) throw Refused("invalid_argument", "Unknown statement kind.")
        if (body.length > MAX_STATEMENT) throw Refused("invalid_argument", "Not a statement.")
        val parsed = runCatching { JSONObject(body) }.getOrNull()
        if (parsed == null || !body.trimStart().startsWith("{")) throw Refused("invalid_argument", "Not a statement.")
        available()
        val seed = synchronized(lock) {
            if (!load()) throw Refused("unavailable", "This phone has no encryption keys yet.")
            edSeed!!
        }
        return b64(Ed25519Sign(seed).sign(statementMessage(kind, body)))
    }

    /** Forgets the device keys (signed out for good, or the phone was removed). The next call makes new ones. */
    fun reset() = synchronized(lock) {
        xPriv?.fill(0)
        edSeed?.fill(0)
        xPriv = null
        edSeed = null
        pub = null
        binFile.delete()
        jsonFile.delete()
        Unit
    }

    /** "Ask for your fingerprint or face to unlock encrypted notes", kept on this phone. */
    var askBeforeOpening: Boolean
        get() = runCatching { JSONObject(prefsFile.readText()).optBoolean("touchId", false) }.getOrDefault(false)
        set(v) {
            dir.mkdirs()
            write(prefsFile, JSONObject().put("touchId", v).toString().toByteArray())
        }

    companion object {
        const val CONTEXT_PREFIX = "folevi/e2ee/v1/"
        val MAGIC = "FLS1".toByteArray()
        const val VERSION: Byte = 0x01
        const val HEADER = 49
        const val TAG = 16
        const val MAX_BOX = 64 * 1024
        const val MAX_CONTEXT = 512
        const val MAX_STATEMENT = 4096
        val KINDS = setOf("device", "space-grant", "note-grant", "account-key")
        private const val CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

        fun b64(b: ByteArray): String = Base64.getUrlEncoder().withoutPadding().encodeToString(b)
        fun b64d(s: String): ByteArray = Base64.getUrlDecoder().decode(s)

        fun ulid(now: Long): String {
            var t = now
            val time = StringBuilder()
            repeat(10) { time.insert(0, CROCKFORD[(t % 32).toInt()]); t /= 32 }
            val r = ByteArray(16).also { SecureRandom().nextBytes(it) }
            return time.toString() + r.joinToString("") { CROCKFORD[(it.toInt() and 0xff) % 32].toString() }
        }

        fun checkContext(context: String) {
            if (!context.startsWith(CONTEXT_PREFIX) || context.length <= CONTEXT_PREFIX.length || context.length > MAX_CONTEXT || context.any { it.code < 0x20 })
                throw Refused("invalid_argument", "Not an encryption context.")
        }

        /** The bytes an FST1 signature covers (docs/E2EE_DESIGN.md §4.4). */
        fun statementMessage(kind: String, body: String): ByteArray = "folevi/e2ee/v1/statement\n$kind\n".toByteArray() + body.toByteArray()

        /**
         * FLS1 open (§4.4): s = X25519(d, E); k = HKDF-SHA256(s, salt E ‖ R, info "seal/" ‖ context);
         * plaintext = AES-256-GCM-open(k, nonce, body, AAD = header ‖ utf8(context)). Refuses an all-zero s.
         */
        fun openSealedBox(privateKey: ByteArray, recipientPub: ByteArray, context: String, box: ByteArray): ByteArray {
            val header = box.copyOfRange(0, HEADER)
            val eph = box.copyOfRange(5, 37)
            val nonce = box.copyOfRange(37, HEADER)
            val shared = try {
                X25519.computeSharedSecret(privateKey, eph)
            } catch (e: Exception) {
                throw Refused("failed", "The key agreement failed.")
            }
            try {
                if (shared.all { it.toInt() == 0 }) throw Refused("failed", "The key agreement failed.")
                val key = Hkdf.computeHkdf("HMACSHA256", shared, eph + recipientPub, "seal/$context".toByteArray(), 32)
                try {
                    val c = Cipher.getInstance("AES/GCM/NoPadding")
                    c.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(TAG * 8, nonce))
                    c.updateAAD(header + context.toByteArray())
                    return try {
                        c.doFinal(box, HEADER, box.size - HEADER)
                    } catch (e: Exception) {
                        throw Refused("failed", "The sealed box failed its integrity check.")
                    }
                } finally {
                    key.fill(0)
                }
            } finally {
                shared.fill(0)
            }
        }
    }
}
