package com.folevi.android

import com.folevi.android.e2ee.DeviceKeys
import com.folevi.android.secure.SealingCipher
import com.google.crypto.tink.subtle.Ed25519Verify
import org.json.JSONObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.file.Files

/** WP1's shared vectors (packages/local-store/fixtures/e2ee-vectors.json): the same boxes and signatures as the Mac. */
class DeviceKeysTest {
    private val vectors = JSONObject(Fixtures.text("packages/local-store/fixtures/e2ee-vectors.json"))
    private fun hex(s: String) = ByteArray(s.length / 2) { s.substring(it * 2, it * 2 + 2).toInt(16).toByte() }
    private fun ByteArray.hex() = joinToString("") { "%02x".format(it) }

    /** Stands in for the Keystore key: XOR, so a different "phone" can't open what another sealed. */
    private class FakeCipher(val k: Byte = 0x5a) : SealingCipher {
        override fun available() = true
        override fun seal(plain: ByteArray) = byteArrayOf(k) + plain.map { (it.toInt() xor k.toInt()).toByte() }
        override fun open(sealed: ByteArray): ByteArray {
            require(sealed[0] == k)
            return sealed.drop(1).map { (it.toInt() xor k.toInt()).toByte() }.toByteArray()
        }
    }

    private fun keys(generate: (() -> Pair<ByteArray, ByteArray>)? = null, cipher: SealingCipher = FakeCipher(), dir: java.io.File = Files.createTempDirectory("e2ee").toFile()) = DeviceKeys(dir, cipher, generate = generate)

    private fun refused(code: String, block: () -> Unit) {
        try {
            block()
            throw AssertionError("expected $code")
        } catch (e: DeviceKeys.Refused) {
            assertEquals(code, e.code)
        }
    }

    @Test
    fun opensTheVectorBoxes() {
        val boxes = vectors.getJSONArray("boxes")
        for (i in 0 until boxes.length()) {
            val v = boxes.getJSONObject(i)
            val k = keys({ hex(v.getString("recipientSeedHex")) to ByteArray(32) { 9 } })
            assertEquals(v.getString("recipientPubHex"), k.deviceKeys().x25519Pub.hex())
            assertEquals(v.getString("plaintextHex"), k.open(hex(v.getString("boxHex")), v.getString("context")).hex())
        }
    }

    @Test
    fun aMovedOrChangedBoxDoesntOpen() {
        val v = vectors.getJSONArray("boxes").getJSONObject(0)
        val k = keys({ hex(v.getString("recipientSeedHex")) to ByteArray(32) { 9 } })
        k.deviceKeys()
        refused("failed") { k.open(hex(v.getString("boxHex")), v.getString("context") + "x") }
        val bad = hex(v.getString("boxHex")).also { it[it.size - 1] = (it[it.size - 1].toInt() xor 1).toByte() }
        refused("failed") { k.open(bad, v.getString("context")) }
        refused("invalid_argument") { k.open(ByteArray(70), v.getString("context")) }
        refused("invalid_argument") { k.open(hex(v.getString("boxHex")), "amk/device") }
        refused("invalid_argument") { k.open(hex(v.getString("boxHex")), v.getString("context") + "\n") }
        val lowOrder = hex(v.getString("boxHex")).also { it.fill(0, 5, 37) }
        refused("failed") { k.open(lowOrder, v.getString("context")) }
    }

    @Test
    fun signsWhatTheMacSigns() {
        val k = keys()
        val pub = k.deviceKeys().ed25519Pub
        val body = JSONObject().put("deviceId", "d1").put("profileId", "p1").toString()
        val sig = DeviceKeys.b64d(k.sign("device", body))
        Ed25519Verify(pub).verify(sig, DeviceKeys.statementMessage("device", body))
        // The vectors' signatures verify over the same message bytes.
        val statements = vectors.getJSONArray("statements")
        for (i in 0 until statements.length()) {
            val s = statements.getJSONObject(i)
            Ed25519Verify(hex(s.getString("signerPubHex"))).verify(DeviceKeys.b64d(s.getString("sig")), DeviceKeys.statementMessage(s.getString("kind"), s.getString("body")))
        }
        refused("invalid_argument") { k.sign("anything", body) }
        refused("invalid_argument") { k.sign("device", "[1]") }
        refused("invalid_argument") { k.sign("device", "x".repeat(5000)) }
    }

    @Test
    fun keptAcrossRestartsReplacedWhenAnotherPhonesOrSwapped() {
        val dir = Files.createTempDirectory("e2ee").toFile()
        val first = keys(dir = dir).deviceKeys()
        assertTrue(first.deviceId.startsWith("android-"))
        assertArrayEquals(first.x25519Pub, keys(dir = dir).deviceKeys().x25519Pub)
        // Another phone's Keystore (a restored backup): new keys, never these.
        val other = keys(dir = dir, cipher = FakeCipher(0x11)).deviceKeys()
        assertNotEquals(first.deviceId, other.deviceId)
        // A device.json whose public keys aren't the private ones': replaced.
        val json = java.io.File(dir, "device.json")
        json.writeText(JSONObject(json.readText()).put("x25519Pub", DeviceKeys.b64(ByteArray(32))).toString())
        assertNotEquals(other.deviceId, keys(dir = dir, cipher = FakeCipher(0x11)).deviceKeys().deviceId)
    }

    @Test
    fun resetForgets() {
        val dir = Files.createTempDirectory("e2ee").toFile()
        val k = keys(dir = dir)
        val a = k.deviceKeys().deviceId
        k.reset()
        assertNotEquals(a, k.deviceKeys().deviceId)
    }
}
