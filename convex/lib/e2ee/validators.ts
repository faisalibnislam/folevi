// Convex validators for end-to-end encryption (docs/E2EE_DESIGN.md §4.6, §5.1, §5.2, §5.3).
//
// The wire shapes mirror `packages/local-store/src/crypto/e2ee/wire.ts` (WP1); tests/convex/e2ee-wire.test.ts
// asserts the two agree. Sealed content is opaque to the server: it checks sizes, placeholders and key
// versions, never what is inside. `v.bytes()` is an ArrayBuffer on the wire.
//
// This file must not import convex/lib/validators.ts (that file may import these for the sync ops).
import { v, type Infer } from "convex/values";

// ---------------------------------------------------------------- levels, states, switches (§7.1)

export const vE2eeLevel = v.union(v.literal("standard"), v.literal("selected"), v.literal("full"));
export type E2eeLevel = Infer<typeof vE2eeLevel>;

/** The levels `e2ee.spaces.enable` accepts. */
export const vE2eeEnabledLevel = v.union(v.literal("selected"), v.literal("full"));

export const vE2eeState = v.union(v.literal("off"), v.literal("enabling"), v.literal("on"), v.literal("disabling"));
export type E2eeState = Infer<typeof vE2eeState>;

export const vFoliAiSwitch = v.union(v.literal("off"), v.literal("ask"), v.literal("auto"));

export const vE2eeSwitches = v.object({
  foliAi: vFoliAiSwitch,
  backgroundAi: v.boolean(),
  searchEverywhere: v.boolean(),
  apps: v.boolean(),
  emailToNote: v.boolean(),
  webClipper: v.boolean(),
  notificationPreviews: v.boolean(),
});
export type Switches = Infer<typeof vE2eeSwitches>;
export type SwitchName = keyof Switches;

/** A Standard space: every feature works as it always has (`switchesOf(null)`). */
export const STANDARD_SWITCHES: Switches = Object.freeze({
  foliAi: "auto",
  backgroundAi: true,
  searchEverywhere: true,
  apps: true,
  emailToNote: true,
  webClipper: true,
  notificationPreviews: true,
});

/** "Encrypted, with the features you pick" before anything is picked. */
export const DEFAULT_SELECTED_SWITCHES: Switches = Object.freeze({
  foliAi: "ask",
  backgroundAi: false,
  searchEverywhere: false,
  apps: false,
  emailToNote: false,
  webClipper: false,
  notificationPreviews: false,
});

/** "Fully encrypted", and what locked folders and notes follow at every level. */
export const FULL_SWITCHES: Switches = Object.freeze({
  foliAi: "off",
  backgroundAi: false,
  searchEverywhere: false,
  apps: false,
  emailToNote: false,
  webClipper: false,
  notificationPreviews: false,
});

// ---------------------------------------------------------------- signed statements (§4.4 FST1)

export const vStatementKind = v.union(v.literal("device"), v.literal("space-grant"), v.literal("note-grant"), v.literal("account-key"));

/** `body` is canonicalJson of the statement body; `sig` is the base64url Ed25519 signature. */
export const vAccountKeyStatement = v.object({ kind: v.literal("account-key"), body: v.string(), sig: v.string() });
export const vDeviceStatement = v.object({ kind: v.literal("device"), body: v.string(), sig: v.string() });
export const vSpaceGrantStatement = v.object({ kind: v.literal("space-grant"), body: v.string(), sig: v.string() });
export const vNoteGrantStatement = v.object({ kind: v.literal("note-grant"), body: v.string(), sig: v.string() });
export const vSignedStatement = v.object({ kind: vStatementKind, body: v.string(), sig: v.string() });

// ---------------------------------------------------------------- accounts, wraps, devices (§4.7, §4.8)

export const vWrapKind = v.union(v.literal("device"), v.literal("recoveryKey"), v.literal("passkey"), v.literal("passphrase"));
export type WrapKind = Infer<typeof vWrapKind>;

/** How a passphrase wrap's key was stretched on the device (never run on the server). */
export const vKdf = v.object({ name: v.literal("argon2id"), m: v.number(), t: v.number(), p: v.number(), salt: v.bytes() });

export const vDeviceKind = v.union(v.literal("app"), v.literal("browser"), v.literal("session"));
export type DeviceKind = Infer<typeof vDeviceKind>;
export const vDeviceStatus = v.union(v.literal("pending"), v.literal("trusted"), v.literal("revoked"));

export const vApprovalStatus = v.union(
  v.literal("waiting"),
  v.literal("answered"),
  v.literal("revealed"),
  v.literal("done"),
  v.literal("cancelled"),
  v.literal("expired"),
);

/** A device or browser registering its public keys. */
export const vDeviceRegistration = v.object({
  deviceId: v.string(),
  kind: vDeviceKind,
  label: v.string(),
  platform: v.string(),
  x25519Pub: v.bytes(),
  ed25519Pub: v.bytes(),
  /** Signed by the account key once the device holds the AMK (absent while it waits for approval). */
  statement: v.optional(vDeviceStatement),
});
export type DeviceRegistration = Infer<typeof vDeviceRegistration>;

/** A new account epoch: the public halves of the keys derived from a fresh AMK. */
export const vAccountRegistration = v.object({
  epoch: v.number(),
  x25519Pub: v.bytes(),
  ed25519Pub: v.bytes(),
  amkCheck: v.bytes(),
  statement: vAccountKeyStatement,
});
export type AccountRegistration = Infer<typeof vAccountRegistration>;

/** One wrap of the AMK, as a device uploads it. */
export const vWrapInput = v.object({
  kind: vWrapKind,
  wrapped: v.bytes(),
  deviceId: v.optional(v.string()),
  credentialId: v.optional(v.string()),
  prfSalt: v.optional(v.bytes()),
  kdf: v.optional(vKdf),
  label: v.optional(v.string()),
});
export type WrapInput = Infer<typeof vWrapInput>;

// ---------------------------------------------------------------- spaces, grants, note keys (§4.9)

/** A new space key version: only its public inbox key and check value reach the server. */
export const vSpaceKeyInput = v.object({ version: v.number(), inboxPub: v.bytes(), skCheck: v.bytes() });
export type SpaceKeyInput = Infer<typeof vSpaceKeyInput>;

/** A space key version sealed to one member's account key. `profileId` is the member's public profile id. */
export const vSpaceGrantInput = v.object({
  profileId: v.string(),
  version: v.number(),
  /** The grantee's account epoch the key was sealed to. */
  epoch: v.number(),
  wrapped: v.bytes(),
  statement: vSpaceGrantStatement,
});
export type SpaceGrantInput = Infer<typeof vSpaceGrantInput>;

export const vNoteKeyWrappedBy = v.union(v.literal("space"), v.literal("grant"), v.literal("link"));

/** A note key version wrapped one way (by a space key version, to a guest, or for a link). */
export const vNoteKeyWrapInput = v.object({
  documentId: v.string(),
  version: v.number(),
  wrappedBy: vNoteKeyWrappedBy,
  /** wrappedBy "space". */
  spaceVersion: v.optional(v.number()),
  /** wrappedBy "grant": the guest's public profile id. */
  profileId: v.optional(v.string()),
  /** wrappedBy "link": the link's public id. */
  linkId: v.optional(v.string()),
  wrapped: v.bytes(),
  /** wrappedBy "grant": the granter's signed `note-grant` statement. */
  statement: v.optional(vNoteGrantStatement),
});
export type NoteKeyWrapInput = Infer<typeof vNoteKeyWrapInput>;

export const vPendingGrantReason = v.union(v.literal("joined"), v.literal("reset"), v.literal("rotation"), v.literal("page"));

export const vRecordKind = v.union(
  v.literal("collection"),
  v.literal("fileText"),
  v.literal("studyReview"),
  v.literal("aiChat"),
  v.literal("aiMemory"),
  v.literal("prefs"),
);
export type RecordKind = Infer<typeof vRecordKind>;

export const vMirrorPurpose = v.union(v.literal("search"), v.literal("ai"), v.literal("apps"));
export type MirrorPurpose = Infer<typeof vMirrorPurpose>;

export const vMirrorTask = v.object({
  blockId: v.string(),
  text: v.string(),
  done: v.boolean(),
  due: v.optional(v.string()),
  dueTime: v.optional(v.string()),
});
export type MirrorTask = Infer<typeof vMirrorTask>;

export const vInboxKind = v.union(v.literal("email"), v.literal("clip"), v.literal("app"));
export const vInboxStatus = v.union(v.literal("waiting"), v.literal("applied"), v.literal("failed"));

export const vMigrationDirection = v.union(v.literal("seal"), v.literal("unseal"), v.literal("reseal"));
export const vMigrationScopeOf = v.union(v.literal("space"), v.literal("folder"), v.literal("document"));
export const vMigrationPhase = v.union(v.literal("documents"), v.literal("history"), v.literal("files"), v.literal("cleanup"), v.literal("done"));

// ---------------------------------------------------------------- stored sealed fields (§5.2)

/** A sealed field as stored on a row and returned to clients: FLV1 0x03 bytes and the key version. */
export const vSealedField = v.object({ c: v.bytes(), k: v.number() });
export type SealedFieldRow = Infer<typeof vSealedField>;

/** A sealed title: also carries its keyed MAC so title conflicts are detected blind. */
export const vSealedTitleField = v.object({ c: v.bytes(), k: v.number(), mac: v.string() });

/** `blocks.sealed`: the block's content, its keyed MAC and the note key version. */
export const vSealedBlockRow = v.object({ c: v.bytes(), mac: v.string(), k: v.number() });

/** `documents.sealing`: a device is converting this note until `until`. */
export const vDocumentSealing = v.object({ by: v.string(), until: v.number() });

/** `files.sealed`: the file key wrapped by the note key, the sealed metadata, the note key version, the plaintext size. */
export const vSealedFileRow = v.object({ key: v.bytes(), meta: v.bytes(), k: v.number(), plainSize: v.number() });

/** `publicLinks.e2ee`: the note key wrapped by the link key (the secret travels only in the URL fragment). */
export const vPublicLinkE2ee = v.object({ noteVersion: v.number(), wrapped: v.bytes() });

export const vAiStreamKind = v.union(v.literal("answer"), v.literal("context"));

// ---------------------------------------------------------------- wire shapes (§4.6, wire.ts)

/** `SealedBlockFields`: what a sealed block carries next to its placeholders. */
export const vSealedBlockFields = v.object({
  c: v.bytes(),
  mac: v.string(),
  k: v.number(),
  collapsed: v.optional(v.literal(true)),
  syncedSource: v.optional(v.string()),
  mentions: v.optional(v.array(v.string())),
  mentionPreview: v.optional(v.object({ title: v.string(), line: v.string() })),
});
export type SealedBlockFieldsInput = Infer<typeof vSealedBlockFields>;

/** `SealedWireBlock`: a vWireBlock whose plaintext fields hold the fixed placeholders. */
export const vSealedWireBlock = v.object({
  id: v.string(),
  type: v.literal("sealed"),
  parentId: v.union(v.string(), v.null()),
  rank: v.string(),
  schemaVersion: v.literal(0),
  text: v.array(v.any()),
  props: v.any(),
  revision: v.optional(v.number()),
  sealed: vSealedBlockFields,
});

/** `SealedDocumentCreate["sealed"]`: the sealed part of a document.create op. */
export const vSealedDocumentCreateFields = v.object({
  title: v.bytes(),
  titleMac: v.string(),
  appearance: v.bytes(),
  meta: v.optional(v.bytes()),
  noteKey: v.object({ v: v.literal(1), spaceVersion: v.number(), wrapped: v.bytes() }),
  lockedOwn: v.optional(v.literal(true)),
  fileIds: v.optional(v.array(v.string())),
});

/** `SealedDocumentPatch`: the sealed fields a document.update op may carry. */
export const vSealedDocumentPatchFields = {
  sealedTitle: v.optional(v.object({ c: v.bytes(), mac: v.string() })),
  sealedAppearance: v.optional(v.bytes()),
  sealedMeta: v.optional(v.bytes()),
};
export const vSealedDocumentPatch = v.object(vSealedDocumentPatchFields);

/** `SealedField` in results. */
export const vSealedFieldResult = vSealedField;

// ---------------------------------------------------------------- limits (§5.5, §5.8)

export const E2EE_LIMITS = {
  /** A sealed block's ciphertext. */
  blockBytes: 600 * 1024,
  /** A sealed title, appearance or meta field. */
  fieldBytes: 64 * 1024,
  /** A sealed record. */
  recordBytes: 900 * 1024,
  recordsPerKind: 20_000,
  mentionsPerBlock: 50,
  mirrorTextBytes: 1024 * 1024,
  inboxBytesPerSpace: 25 * 1024 * 1024,
  publishedCopyBytes: 5 * 1024 * 1024,
  /** A public key (X25519 or Ed25519). */
  publicKeyBytes: 32,
  /** amkCheck / skCheck. */
  checkBytes: 16,
  /** An AMK wrap (sealed box or keyed record). */
  wrapBytes: 1024,
  /** A space key or note key wrap. */
  keyWrapBytes: 1024,
  /** A statement's canonical JSON body. */
  statementBytes: 4096,
  labelChars: 80,
  /** Grants, wraps or note keys in one call. */
  batch: 200,
} as const;
