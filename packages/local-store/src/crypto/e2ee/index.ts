/**
 * `@folevi/local-store/e2ee`: the end-to-end encryption crypto core (docs/E2EE_DESIGN.md §4, WP1), used by
 * the web app, the Mac app and Convex (which only seals: tests/convex/static/invariants.test.ts).
 *
 * - Primitives and backends (WebCrypto, @noble fallback): primitives.ts.
 * - AAD contexts, one builder per row of §4.5: contexts.ts (`ctx`).
 * - Keyed record FLV1 0x03: record.ts. Keyed stream FLV1 0x04: keyedStream.ts. Sealed box FLS1: seal.ts.
 * - Signed statements FST1: statements.ts.
 * - Key derivation and wrap keys: keys.ts. Recovery key text: recovery.ts. Approval and member codes: sas.ts.
 * - Wire shapes (§4.6) and block plaintext (de)serializers: wire.ts.
 *
 * Vectors: fixtures/e2ee-vectors.json, reproduced on both backends by test/e2ee-vectors.test.ts.
 */
import { MAGIC, MODE_SINGLE, MODE_STREAM } from "../envelope";
import { MODE_KEYED_STREAM } from "./keyedStream";
import { MODE_RECORD } from "./record";
import { SEALED_VERSION, isSealedBox } from "./seal";

export {
  CONTEXT_PREFIX,
  E2eeError,
  HKDF_SALT,
  aeadDecrypt,
  aeadEncrypt,
  constantTimeEqual,
  constantTimeEqualString,
  cryptoBackend,
  ed25519FromSeed,
  ed25519Sign,
  ed25519Verify,
  forceBackend,
  fromBase64Url,
  generateEd25519,
  generateX25519,
  hkdf,
  hkdfSalted,
  hmacSha256,
  importAead,
  importMac,
  macEquals,
  macOf,
  randomBytes,
  sha256,
  toBase64Url,
  x25519FromSeed,
  x25519Shared,
  type AeadKey,
  type BackendName,
  type CryptoBackend,
  type Ed25519KeyPair,
  type MacKey,
  type X25519KeyPair,
} from "./primitives";
export { ctx, type ContextKind } from "./contexts";
export {
  COMPRESS_MIN,
  MAX_INFLATED,
  MODE_RECORD,
  RECORD_HEADER,
  openRecord,
  recordHeader,
  recordKeyVersion,
  sealRecord,
  type RecordHeader,
  type SealRecordOptions,
} from "./record";
export {
  KEYED_STREAM_HEADER,
  MODE_KEYED_STREAM,
  fileStreamPlainLength,
  openFileStream,
  openFileStreamRange,
  sealFileStream,
  type SealFileStreamOptions,
} from "./keyedStream";
export { SEALED_HEADER, SEALED_MAGIC, isSealedBox, openSealed, sealTo, type SealToOptions } from "./seal";
export { STATEMENT_KINDS, openStatement, signStatement, verifyStatement } from "./statements";
export {
  ARGON2ID_DEFAULTS,
  ARGON2ID_TEST,
  PBKDF2_MIN_ITERATIONS,
  deriveAccountKeys,
  deriveNoteKeys,
  deriveSpaceKeys,
  linkWrapKey,
  newPassphraseKdf,
  passphraseKdfBytes,
  passphraseWrapKey,
  prfWrapKey,
  recoveryWrapKey,
  tagNameMac,
  type AccountKeys,
  type Argon2idParams,
  type NoteKeys,
  type PassphraseKdf,
  type Pbkdf2Params,
  type SpaceKeys,
} from "./keys";
export {
  RECOVERY_ALPHABET,
  RECOVERY_KEY_BYTES,
  formatRecoveryKey,
  newRecoveryKey,
  parseRecoveryKey,
  recoveryKeyGroup,
} from "./recovery";
export {
  approvalCode,
  approvalCommit,
  checkApprovalCommit,
  formatCode,
  memberSecurityCode,
  type ApprovalCodeInput,
} from "./sas";
export * from "./wire";
export {
  LIBRARY_VAULT_PERSON,
  VAULT_PASSCODE_LENGTHS,
  checkVaultPasscode,
  deriveVaultKeys,
  innerOfGrant,
  newVaultKey,
  openLibraryVaultKey,
  openVaultGrant,
  sealVaultKeyTo,
  vaultCtx,
  wrapWithPasscode,
  wrapLibraryVaultKey,
  wrapWithRecovery,
  type VaultGrantFor,
  vaultPasscodeKey,
  vaultPasswordMac,
  vaultRecoveryKey,
  type VaultKeys,
} from "./vault";

export type EnvelopeKind = "file" | "stream" | "record" | "keyedStream" | "sealedBox";

/** Which Folevi format some bytes are (by magic and mode byte), or null. One dispatcher for every format. */
export function envelopeKind(bytes: Uint8Array): EnvelopeKind | null {
  if (bytes.length < 5) return null;
  if (isSealedBox(bytes)) return bytes[4] === SEALED_VERSION ? "sealedBox" : null;
  if (bytes[0] !== MAGIC[0] || bytes[1] !== MAGIC[1] || bytes[2] !== MAGIC[2] || bytes[3] !== MAGIC[3]) return null;
  switch (bytes[4]) {
    case MODE_SINGLE:
      return "file";
    case MODE_STREAM:
      return "stream";
    case MODE_RECORD:
      return "record";
    case MODE_KEYED_STREAM:
      return "keyedStream";
    default:
      return null;
  }
}
