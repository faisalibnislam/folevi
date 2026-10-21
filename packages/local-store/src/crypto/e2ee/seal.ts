// Sealed box, FLS1 (docs/E2EE_DESIGN.md §4.4): anything sealed to an X25519 public key (the AMK to a device,
// a space key to a member, a note key to a guest, inbound email to a space).
//
//   0   4   "FLS1"
//   4   1   0x01 (version)
//   5   32  ephemeral X25519 public key E
//   37  12  nonce (random)
//   49  ... AES-256-GCM(k, nonce, plaintext, AAD = bytes[0..49) ‖ utf8(context))
//   where s = X25519(e_private, R)                       (R = recipient public key)
//         k = HKDF-SHA256(ikm = s, salt = E ‖ R, info = "seal/" ‖ context)
//
// An all-zero s is refused. A sealed box is anonymous: who made it is proven by a signed statement.
import { concatBytes, utf8 } from "../../bytes";
import {
  E2eeError,
  NONCE_BYTES,
  TAG_BYTES,
  aeadDecrypt,
  aeadEncrypt,
  checkContext,
  hkdfSalted,
  importAead,
  isBytes,
  randomBytes,
  x25519Shared,
  generateX25519,
  type X25519KeyPair,
} from "./primitives";

export const SEALED_MAGIC = utf8("FLS1");
export const SEALED_VERSION = 0x01;
export const SEALED_HEADER = 49;

export function isSealedBox(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 5 &&
    bytes[0] === SEALED_MAGIC[0] &&
    bytes[1] === SEALED_MAGIC[1] &&
    bytes[2] === SEALED_MAGIC[2] &&
    bytes[3] === SEALED_MAGIC[3]
  );
}

async function boxKey(shared: Uint8Array, eph: Uint8Array, recipient: Uint8Array, context: string) {
  try {
    return await importAead(await hkdfSalted(shared, concatBytes(eph, recipient), `seal/${context}`, 32));
  } finally {
    shared.fill(0);
  }
}

export interface SealToOptions {
  /** Test vectors only; otherwise a fresh key pair per box. */
  ephemeral?: X25519KeyPair;
  /** Test vectors only. */
  nonce?: Uint8Array;
}

export async function sealTo(
  recipientPub: Uint8Array,
  context: string,
  plaintext: Uint8Array,
  o: SealToOptions = {},
): Promise<Uint8Array> {
  checkContext(context);
  if (!isBytes(recipientPub) || recipientPub.length !== 32)
    throw new E2eeError("The recipient public key must be 32 bytes.");
  const eph = o.ephemeral ?? (await generateX25519());
  const nonce = o.nonce ?? randomBytes(NONCE_BYTES);
  if (nonce.length !== NONCE_BYTES) throw new E2eeError("The nonce must be 12 bytes.");
  const key = await boxKey(await x25519Shared(eph.privateKey, recipientPub), eph.publicKey, recipientPub, context);
  const header = concatBytes(SEALED_MAGIC, new Uint8Array([SEALED_VERSION]), eph.publicKey, nonce);
  return concatBytes(header, await aeadEncrypt(key, nonce, plaintext, concatBytes(header, utf8(context))));
}

/** Opens a sealed box with the recipient's private key; throws E2eeError for anything wrong. */
export async function openSealed(
  recipient: X25519KeyPair["privateKey"],
  recipientPub: Uint8Array,
  context: string,
  box: Uint8Array,
): Promise<Uint8Array> {
  checkContext(context);
  if (!isSealedBox(box) || box[4] !== SEALED_VERSION) throw new E2eeError("Not a sealed Folevi box.");
  if (box.length < SEALED_HEADER + TAG_BYTES) throw new E2eeError("The sealed box is incomplete.");
  if (!isBytes(recipientPub) || recipientPub.length !== 32)
    throw new E2eeError("The recipient public key must be 32 bytes.");
  const header = box.subarray(0, SEALED_HEADER);
  const eph = box.slice(5, 37);
  const nonce = box.slice(37, 49);
  const key = await boxKey(await x25519Shared(recipient, eph), eph, recipientPub, context);
  return aeadDecrypt(key, nonce, box.subarray(SEALED_HEADER), concatBytes(header, utf8(context)));
}
