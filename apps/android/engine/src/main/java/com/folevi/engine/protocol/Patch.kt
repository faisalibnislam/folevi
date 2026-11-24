package com.folevi.engine.protocol

import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.nullable
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder

/**
 * A field that may be left out (unchanged), sent as null (cleared) or sent with a value: protocol.ts's
 * `x?: T | null`. Generated classes default such fields to [Keep], which the client's Json leaves out
 * (`encodeDefaults = false`).
 */
@Serializable(with = PatchSerializer::class)
sealed interface Patch<out T> {
    data object Keep : Patch<Nothing>
    data object Clear : Patch<Nothing>
    data class Set<T>(val value: T) : Patch<T>

    /** The value when it's set. */
    val valueOrNull: T? get() = (this as? Set<T>)?.value

    companion object {
        /** null: left out; a value: sent. */
        fun <T> of(value: T?): Patch<T> = if (value == null) Keep else Set(value)
    }
}

class PatchSerializer<T>(inner: KSerializer<T>) : KSerializer<Patch<T>> {
    @Suppress("UNCHECKED_CAST")
    private val nullable: KSerializer<T?> = (inner as KSerializer<Any>).nullable as KSerializer<T?>
    override val descriptor: SerialDescriptor = nullable.descriptor

    override fun serialize(encoder: Encoder, value: Patch<T>) {
        when (value) {
            // (Never reached through a generated class: Keep is the default, so it isn't encoded at all.)
            Patch.Keep, Patch.Clear -> nullable.serialize(encoder, null)
            is Patch.Set -> nullable.serialize(encoder, value.value)
        }
    }

    override fun deserialize(decoder: Decoder): Patch<T> {
        val v = nullable.deserialize(decoder)
        return if (v == null) Patch.Clear else Patch.Set(v)
    }
}
