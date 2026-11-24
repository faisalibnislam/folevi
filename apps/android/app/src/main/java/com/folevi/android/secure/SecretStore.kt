package com.folevi.android.secure

import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.security.keystore.StrongBoxUnavailableException
import java.io.File
import java.security.KeyStore
import java.security.MessageDigest
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Seals and opens bytes with a key the app can't read out (the Android Keystore in the app; a fake in tests). */
interface SealingCipher {
    /** False when the device can't keep a key safely right now: the app then refuses to store secrets. */
    fun available(): Boolean
    fun seal(plain: ByteArray): ByteArray
    /** Throws when the bytes weren't sealed by this key on this device (restored from another phone, damaged). */
    fun open(sealed: ByteArray): ByteArray
}

/**
 * AES-256-GCM with a key made in the Android Keystore (in StrongBox where the phone has one), never exportable.
 * A sealed value is the 12-byte IV followed by the ciphertext and its tag. The key is made on first use.
 */
class KeystoreCipher(private val alias: String) : SealingCipher {
    private val lock = Any()

    private fun keyStore(): KeyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

    private fun key(): SecretKey = synchronized(lock) {
        val ks = keyStore()
        (ks.getKey(alias, null) as SecretKey?)?.let { return it }
        fun spec(strongBox: Boolean) = KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .setRandomizedEncryptionRequired(true)
            .apply { if (strongBox) setIsStrongBoxBacked(true) }
            .build()
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        try {
            gen.init(spec(strongBox = Build.VERSION.SDK_INT >= 28))
            gen.generateKey()
        } catch (_: StrongBoxUnavailableException) {
            gen.init(spec(strongBox = false))
            gen.generateKey()
        } catch (_: java.security.ProviderException) {
            // Some phones report StrongBox and then can't use it for this key: the TEE keeps it instead.
            gen.init(spec(strongBox = false))
            gen.generateKey()
        }
    }

    override fun available(): Boolean = runCatching { key() }.isSuccess

    override fun seal(plain: ByteArray): ByteArray {
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.ENCRYPT_MODE, key())
        val iv = c.iv
        require(iv.size == 12)
        return iv + c.doFinal(plain)
    }

    override fun open(sealed: ByteArray): ByteArray {
        require(sealed.size > 12 + 16) { "Not a sealed value." }
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, sealed, 0, 12))
        return c.doFinal(sealed, 12, sealed.size - 12)
    }

    /** Forgets the key (and so every value sealed with it). */
    fun destroy() = synchronized(lock) { runCatching { keyStore().deleteEntry(alias) } }
}

/**
 * Small secrets the page may store but never read back, and the app's own (the account session, provider
 * tokens, device keys): one sealed file each in the app's no-backup storage, written atomically. A file that
 * can't be opened (another phone's key after a restore, damage) counts as absent.
 */
/** The text secrets the auth and cloud code keep (SecretStore here, a map in tests). */
interface Secrets {
    fun get(name: String): String?
    fun set(name: String, value: String)
    fun delete(name: String)
}

class SecretStore(private val dir: File, private val cipher: SealingCipher) : Secrets {
    private val lock = Any()

    fun available(): Boolean = cipher.available()

    private fun fileFor(name: String): File {
        val digest = MessageDigest.getInstance("SHA-256").digest(name.toByteArray())
        return File(dir, digest.joinToString("") { "%02x".format(it) } + ".bin")
    }

    fun getBytes(name: String): ByteArray? = synchronized(lock) {
        val f = fileFor(name)
        if (!f.isFile) return null
        runCatching { cipher.open(f.readBytes()) }.getOrNull()
    }

    override fun get(name: String): String? = getBytes(name)?.toString(Charsets.UTF_8)

    fun has(name: String): Boolean = getBytes(name) != null

    fun setBytes(name: String, value: ByteArray) = synchronized(lock) {
        if (!cipher.available()) throw IllegalStateException("This device can't keep secrets safely right now.")
        dir.mkdirs()
        val sealed = cipher.seal(value)
        val target = fileFor(name)
        val tmp = File(dir, "${target.name}.${System.nanoTime()}.tmp")
        tmp.outputStream().use { out ->
            out.write(sealed)
            out.fd.sync()
        }
        if (!tmp.renameTo(target)) {
            tmp.delete()
            throw IllegalStateException("Folevi couldn't keep that.")
        }
    }

    override fun set(name: String, value: String) = setBytes(name, value.toByteArray(Charsets.UTF_8))

    override fun delete(name: String) {
        synchronized(lock) { fileFor(name).delete() }
    }
}
