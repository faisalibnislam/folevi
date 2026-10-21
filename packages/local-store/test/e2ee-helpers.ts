// Shared by the E2EE tests: fixed inputs and the function that computes every vector of
// fixtures/e2ee-vectors.json (docs/E2EE_DESIGN.md §4.10) on whichever backend is forced. No Node modules, so
// the edge-runtime test can run it too.
import { canonicalJson, type WireBlock } from "@folevi/editor-schema";
import { fromHex, toHex, utf8 } from "../src/bytes";
import {
  ARGON2ID_DEFAULTS,
  ARGON2ID_TEST,
  approvalCode,
  approvalCommit,
  blockPlaintext,
  ctx,
  deriveAccountKeys,
  deriveNoteKeys,
  deriveSpaceKeys,
  ed25519FromSeed,
  formatRecoveryKey,
  hkdf,
  hkdfSalted,
  importAead,
  linkWrapKey,
  macOf,
  memberSecurityCode,
  parseRecoveryKey,
  passphraseKdfBytes,
  passphraseWrapKey,
  prfWrapKey,
  recoveryWrapKey,
  sealFileStream,
  sealRecord,
  sealTo,
  sha256,
  signStatement,
  tagNameMac,
  x25519FromSeed,
  x25519Shared,
  type AeadKey,
} from "../src/crypto/e2ee";

export const range = (start: number, n: number) => Uint8Array.from({ length: n }, (_, i) => (start + i) & 255);

export const AMK = range(0x00, 32);
export const SK = range(0x20, 32);
export const NK = range(0x40, 32);
export const FK = range(0x60, 32);
export const RECOVERY = range(0x80, 20);
export const PRF = range(0xa0, 32);
export const LINK = range(0xc0, 32);
export const EPHEMERAL_SEED = range(0xe0, 32);
export const DEVICE_X_SEED = range(0x10, 32);
export const DEVICE_ED_SEED = range(0x30, 32);
export const APPROVER_ED_SEED = range(0x50, 32);
export const NONCE = fromHex("a0a1a2a3a4a5a6a7a8a9aaab");
export const PREFIX = fromHex("b0b1b2b3b4b5b6b7");
export const SALT = range(0x70, 16);
export const APPROVER_NONCE = range(0x90, 32);
export const NEW_NONCE = range(0xb0, 32);
export const PASSPHRASE = "correct horse battery staple";

export const PROFILE = "01JABCDEFGHJKMNPQRSTVWXYZ0";
export const DEVICE = "01JDEVICE0000000000000000A";
export const SCOPE = "workspace:01JWORKSPACE00000000000000";
export const DOC = "01JDOC000000000000000000AA";
export const BLOCK = "01JBLOCK0000000000000000BB";

/** Sample arguments for every context builder (§4.5). */
export const CONTEXT_SAMPLES: Record<keyof typeof ctx, string> = {
  amkDevice: ctx.amkDevice(PROFILE, DEVICE),
  amkRecovery: ctx.amkRecovery(PROFILE, "01JWRAPRECOVERY00000000000"),
  amkPasskey: ctx.amkPasskey(PROFILE, "Y3JlZGVudGlhbC1pZA"),
  amkPassphrase: ctx.amkPassphrase(PROFILE, "01JWRAPPASSPHRASE000000000"),
  spaceGrant: ctx.spaceGrant(SCOPE, 1, PROFILE),
  noteKeySpace: ctx.noteKeySpace(DOC, 1, SCOPE, 2),
  noteKeyGrant: ctx.noteKeyGrant(DOC, 1, PROFILE),
  noteKeyLink: ctx.noteKeyLink(DOC, 3, "01JLINK000000000000000000L"),
  docTitle: ctx.docTitle(DOC),
  docAppearance: ctx.docAppearance(DOC),
  docMeta: ctx.docMeta(DOC),
  block: ctx.block(DOC, BLOCK),
  comment: ctx.comment(DOC, "01JCOMMENT0000000000000000"),
  fileText: ctx.fileText(DOC, BLOCK),
  versionName: ctx.versionName(DOC, "01JSNAPSHOT000000000000000"),
  fileKey: ctx.fileKey(DOC, "01JFILE000000000000000000F"),
  fileMeta: ctx.fileMeta(DOC, "01JFILE000000000000000000F"),
  file: ctx.file("01JFILE000000000000000000F"),
  folder: ctx.folder(SCOPE, "01JFOLDER00000000000000000"),
  tag: ctx.tag(SCOPE, "01JTAG00000000000000000000"),
  spaceRecord: ctx.spaceRecord(SCOPE, "collection", "01JRECORD00000000000000000"),
  accountRecord: ctx.accountRecord(PROFILE, "aiChat", "01JRECORD00000000000000000"),
  inbox: ctx.inbox(SCOPE, "01JINBOX000000000000000000"),
};

export function pattern(length: number): Uint8Array {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = i % 251;
  return out;
}

/** Bytes that don't compress (a SHA-256 chain). */
export function noise(length: number, seed = 0): Uint8Array {
  const out = new Uint8Array(length);
  let block = sha256(new Uint8Array([seed]));
  for (let i = 0; i < length; i += 32) {
    out.set(block.subarray(0, Math.min(32, length - i)), i);
    block = sha256(block);
  }
  return out;
}

export const SAMPLE_BLOCK: WireBlock = {
  id: BLOCK,
  type: "paragraph",
  parentId: null,
  rank: "a0",
  schemaVersion: 1,
  text: [{ type: "text", text: "Hello, encrypted world" }],
  props: { collapsed: true, textColor: "blue" },
};

export const COMPRESSIBLE = utf8(
  canonicalJson({
    type: "paragraph",
    schemaVersion: 1,
    text: Array.from({ length: 60 }, (_, i) => ({ type: "text", text: `Line ${i} of a long note that repeats.` })),
    props: {},
  }),
);

const hex = toHex;

async function okm(ikm: Uint8Array, info: string) {
  return { ikmHex: hex(ikm), info, okmHex: hex(await hkdf(ikm, info)) };
}

export interface RecordVector {
  name: string;
  keyHex: string;
  keyVersion: number;
  context: string;
  nonceHex: string;
  plaintextHex: string;
  compress?: false;
  envelopeHex: string;
}

export interface StreamVector {
  length: number;
  keyHex: string;
  context: string;
  noncePrefixHex: string;
  chunkSize: number;
  envelopeSha256: string;
  envelopeHex?: string;
  ranges: { start: number; end: number; plaintextHex: string }[];
}

export interface BoxVector {
  name: string;
  recipientSeedHex: string;
  recipientPubHex: string;
  ephemeralSeedHex: string;
  ephemeralPubHex: string;
  context: string;
  nonceHex: string;
  sharedHex: string;
  boxKeyHex: string;
  plaintextHex: string;
  boxHex: string;
}

export async function computeVectors() {
  // ---- HKDF (§4.3) ----
  const argonProd = await passphraseKdfBytes(PASSPHRASE, { name: "argon2id", ...ARGON2ID_DEFAULTS, salt: SALT });
  const argonFast = await passphraseKdfBytes(PASSPHRASE, { name: "argon2id", ...ARGON2ID_TEST, salt: SALT });
  const hkdfRows = [
    await okm(AMK, "account/x25519"),
    await okm(AMK, "account/ed25519"),
    await okm(AMK, "account/records"),
    await okm(AMK, "account/check"),
    await okm(SK, "space/wrap"),
    await okm(SK, "space/meta"),
    await okm(SK, "space/mac"),
    await okm(SK, "space/x25519"),
    await okm(SK, "space/check"),
    await okm(NK, "note/content"),
    await okm(NK, "note/mac"),
    await okm(NK, "note/files"),
    await okm(RECOVERY, "recovery/wrap"),
    await okm(PRF, "passkey/wrap"),
    await okm(argonProd, "passphrase/wrap"),
    await okm(LINK, "link/wrap"),
  ];
  const account = await deriveAccountKeys(AMK.slice());
  const space = await deriveSpaceKeys(SK.slice());
  const note = await deriveNoteKeys(NK.slice());
  const keyOf = (info: string) => fromHex(hkdfRows.find((r) => r.info === info)!.okmHex);

  const derived = {
    accountX25519PubHex: hex(account.x25519.publicKey),
    accountEd25519PubHex: hex(account.ed25519.publicKey),
    amkCheckHex: hex(account.check),
    spaceInboxPubHex: hex(space.inbox.publicKey),
    skCheckHex: hex(space.check),
  };

  // ---- FLV1 0x03 records ----
  const records: RecordVector[] = [];
  async function record(
    name: string,
    keyBytes: Uint8Array,
    key: AeadKey,
    keyVersion: number,
    context: string,
    plaintext: Uint8Array,
    compress?: false,
  ) {
    const envelope = await sealRecord(key, keyVersion, context, plaintext, { nonce: NONCE, compress });
    records.push({
      name,
      keyHex: hex(keyBytes),
      keyVersion,
      context,
      nonceHex: hex(NONCE),
      plaintextHex: hex(plaintext),
      ...(compress === false ? { compress } : {}),
      envelopeHex: hex(envelope),
    });
  }
  const contentKey = keyOf("note/content");
  for (const [kind, context] of Object.entries(CONTEXT_SAMPLES)) {
    if (kind === "amkDevice" || kind === "spaceGrant" || kind === "noteKeyGrant" || kind === "inbox") continue; // FLS1
    await record(`context:${kind}`, contentKey, await importAead(contentKey.slice()), 1, context, utf8(`plain ${kind}`));
  }
  await record("block", contentKey, note.content, 2, CONTEXT_SAMPLES.block, blockPlaintext(SAMPLE_BLOCK));
  await record("compressed", contentKey, note.content, 1, CONTEXT_SAMPLES.block, COMPRESSIBLE);
  await record("compressible but compress:false", contentKey, note.content, 1, CONTEXT_SAMPLES.block, COMPRESSIBLE, false);
  await record("incompressible 2 KiB", contentKey, note.content, 1, CONTEXT_SAMPLES.block, noise(2048));
  await record("keyVersion 0, empty", contentKey, note.content, 0, CONTEXT_SAMPLES.docTitle, new Uint8Array(0));
  await record("keyVersion max", contentKey, note.content, 0xffffffff, CONTEXT_SAMPLES.docTitle, utf8("Trip"));
  // The four AMK wraps that use a symmetric key (the device wrap is FLS1 below).
  const recoveryKeyBytes = keyOf("recovery/wrap");
  await record("amk wrap: recovery key", recoveryKeyBytes, await recoveryWrapKey(RECOVERY), 1, CONTEXT_SAMPLES.amkRecovery, AMK);
  await record("amk wrap: passkey", keyOf("passkey/wrap"), await prfWrapKey(PRF.slice()), 1, CONTEXT_SAMPLES.amkPasskey, AMK);
  await record(
    "amk wrap: passphrase",
    keyOf("passphrase/wrap"),
    await passphraseWrapKey(PASSPHRASE, { name: "argon2id", ...ARGON2ID_DEFAULTS, salt: SALT }),
    1,
    CONTEXT_SAMPLES.amkPassphrase,
    AMK,
  );
  const spaceWrap = keyOf("space/wrap");
  await record("note key wrapped by the space", spaceWrap, space.wrap, 2, CONTEXT_SAMPLES.noteKeySpace, NK);
  await record("note key wrapped by a link", keyOf("link/wrap"), await linkWrapKey(LINK.slice()), 3, CONTEXT_SAMPLES.noteKeyLink, NK);
  await record("folder name", keyOf("space/meta"), space.meta, 1, CONTEXT_SAMPLES.folder, utf8(JSON.stringify("Recipes")));
  await record("file key", keyOf("note/files"), note.files, 1, CONTEXT_SAMPLES.fileKey, FK);
  await record("file meta", FK, await importAead(FK.slice()), 0, CONTEXT_SAMPLES.fileMeta, utf8(canonicalJson({ name: "trip.jpg", mime: "image/jpeg", width: 640, height: 480 })));
  await record("account record", keyOf("account/records"), account.records, 1, CONTEXT_SAMPLES.accountRecord, utf8("{}"));

  // ---- FLV1 0x04 keyed streams ----
  const fileKey = await importAead(FK.slice());
  const streams: StreamVector[] = [];
  for (const length of [0, 1, 65536, 65537]) {
    const plain = pattern(length);
    const env = await sealFileStream(fileKey, CONTEXT_SAMPLES.file, plain, { noncePrefix: PREFIX });
    const ranges =
      length === 65537
        ? [
            { start: 65530, end: 65537 },
            { start: 0, end: 10 },
          ]
        : length === 65536
          ? [{ start: 65535, end: 65536 }]
          : [{ start: 0, end: length }];
    streams.push({
      length,
      keyHex: hex(FK),
      context: CONTEXT_SAMPLES.file,
      noncePrefixHex: hex(PREFIX),
      chunkSize: 65536,
      envelopeSha256: hex(sha256(env)),
      ...(length <= 1 ? { envelopeHex: hex(env) } : {}),
      ranges: ranges.map((r) => ({ ...r, plaintextHex: hex(plain.slice(r.start, r.end)) })),
    });
  }
  const smallChunks = await sealFileStream(fileKey, CONTEXT_SAMPLES.file, pattern(40), { noncePrefix: PREFIX, chunkSize: 16 });

  // ---- FLS1 sealed boxes ----
  const ephemeral = await x25519FromSeed(EPHEMERAL_SEED.slice());
  const boxes: BoxVector[] = [];
  async function box(name: string, recipientSeed: Uint8Array, context: string, plaintext: Uint8Array) {
    const recipient = await x25519FromSeed(recipientSeed.slice());
    const shared = await x25519Shared(ephemeral.privateKey, recipient.publicKey);
    const salt = new Uint8Array(64);
    salt.set(ephemeral.publicKey);
    salt.set(recipient.publicKey, 32);
    const boxKey = await hkdfSalted(shared.slice(), salt, `seal/${context}`);
    const sealed = await sealTo(recipient.publicKey, context, plaintext, { ephemeral, nonce: NONCE });
    boxes.push({
      name,
      recipientSeedHex: hex(recipientSeed),
      recipientPubHex: hex(recipient.publicKey),
      ephemeralSeedHex: hex(EPHEMERAL_SEED),
      ephemeralPubHex: hex(ephemeral.publicKey),
      context,
      nonceHex: hex(NONCE),
      sharedHex: hex(shared),
      boxKeyHex: hex(boxKey),
      plaintextHex: hex(plaintext),
      boxHex: hex(sealed),
    });
  }
  await box("amk to a device", DEVICE_X_SEED, CONTEXT_SAMPLES.amkDevice, AMK);
  await box("space key to a member", keyOf("account/x25519"), CONTEXT_SAMPLES.spaceGrant, SK);
  await box("note key to a guest", keyOf("account/x25519"), CONTEXT_SAMPLES.noteKeyGrant, NK);
  await box("inbox item", keyOf("space/x25519"), CONTEXT_SAMPLES.inbox, utf8(canonicalJson({ subject: "Hi", text: "Body" })));

  // ---- FST1 statements ----
  const accountEd = account.ed25519;
  const pub = (b: Uint8Array) => toBase64UrlLocal(b);
  const device = await x25519FromSeed(DEVICE_X_SEED.slice());
  const deviceEd = await ed25519FromSeed(DEVICE_ED_SEED.slice());
  const bodies = {
    "account-key": { profileId: PROFILE, epoch: 1, x25519Pub: pub(account.x25519.publicKey), ed25519Pub: pub(accountEd.publicKey), createdAt: 1_760_000_000_000 },
    device: {
      profileId: PROFILE,
      deviceId: DEVICE,
      kind: "browser",
      x25519Pub: pub(device.publicKey),
      ed25519Pub: pub(deviceEd.publicKey),
      label: "Safari on Mac",
      approvedBy: "recovery",
      approvedAt: 1_760_000_000_001,
    },
    "space-grant": { scope: SCOPE, version: 1, profileId: PROFILE, granteeX25519Pub: pub(account.x25519.publicKey), grantedBy: PROFILE, at: 1_760_000_000_002 },
    "note-grant": { documentId: DOC, version: 1, profileId: PROFILE, granteeX25519Pub: pub(account.x25519.publicKey), grantedBy: PROFILE, at: 1_760_000_000_003 },
  } as const;
  const statements = [];
  for (const kind of ["account-key", "device", "space-grant", "note-grant"] as const) {
    statements.push({ signerPubHex: hex(accountEd.publicKey), ...(await signStatement(accountEd.privateKey, kind, bodies[kind])) });
  }

  // ---- MACs ----
  const macs = [
    { name: "block", keyHex: hex(keyOf("note/mac")), context: CONTEXT_SAMPLES.block, plaintextHex: hex(blockPlaintext(SAMPLE_BLOCK)), mac: await macOf(note.mac, CONTEXT_SAMPLES.block, blockPlaintext(SAMPLE_BLOCK)) },
    { name: "title", keyHex: hex(keyOf("note/mac")), context: CONTEXT_SAMPLES.docTitle, plaintextHex: hex(utf8(JSON.stringify("Trip"))), mac: await macOf(note.mac, CONTEXT_SAMPLES.docTitle, utf8(JSON.stringify("Trip"))) },
    { name: "empty", keyHex: hex(keyOf("note/mac")), context: CONTEXT_SAMPLES.block, plaintextHex: "", mac: await macOf(note.mac, CONTEXT_SAMPLES.block, new Uint8Array(0)) },
  ];
  const tagNames = [];
  for (const name of ["Ideas", "  ideas ", "Café Ideas", "Café   IDEAS"]) {
    tagNames.push({ keyHex: hex(keyOf("space/mac")), name, nameMac: await tagNameMac(space.mac, name) });
  }

  // ---- Recovery key text ----
  const ones = new Uint8Array(20);
  for (let i = 0; i < 20; i++) ones[i] = [0x08, 0x42, 0x10, 0x84, 0x21][i % 5]!;
  const recoveryKeys = [RECOVERY, new Uint8Array(20), new Uint8Array(20).fill(0xff), ones].map((b) => ({
    bytesHex: hex(b),
    text: formatRecoveryKey(b),
  }));
  const typed = recoveryKeys[3]!.text.replace(/1/g, (_, i: number) => (i % 2 ? "l" : "I"));
  const zeroTyped = recoveryKeys[1]!.text.replace(/0/g, "o").replace(/-/g, " ");
  const parse = [
    { input: recoveryKeys[0]!.text, bytesHex: hexOrNull(parseRecoveryKey(recoveryKeys[0]!.text)) },
    { input: recoveryKeys[0]!.text.toLowerCase().replace(/-/g, ""), bytesHex: hexOrNull(parseRecoveryKey(recoveryKeys[0]!.text.toLowerCase().replace(/-/g, ""))) },
    { input: typed, bytesHex: hexOrNull(parseRecoveryKey(typed)) },
    { input: zeroTyped, bytesHex: hexOrNull(parseRecoveryKey(zeroTyped)) },
    { input: flipChar(recoveryKeys[0]!.text, 2), bytesHex: hexOrNull(parseRecoveryKey(flipChar(recoveryKeys[0]!.text, 2))) },
    { input: flipChar(recoveryKeys[0]!.text, 43), bytesHex: hexOrNull(parseRecoveryKey(flipChar(recoveryKeys[0]!.text, 43))) },
    { input: recoveryKeys[0]!.text.slice(0, -1), bytesHex: hexOrNull(parseRecoveryKey(recoveryKeys[0]!.text.slice(0, -1))) },
    { input: recoveryKeys[0]!.text.replace(/^./, "U"), bytesHex: hexOrNull(parseRecoveryKey(recoveryKeys[0]!.text.replace(/^./, "U"))) },
  ];

  // ---- Argon2id ----
  const argon2id = [
    { passphrase: PASSPHRASE, saltHex: hex(SALT), ...ARGON2ID_DEFAULTS, dkLen: 32, outputHex: hex(argonProd) },
    { passphrase: PASSPHRASE, saltHex: hex(SALT), ...ARGON2ID_TEST, dkLen: 32, outputHex: hex(argonFast) },
    {
      passphrase: "Café passphrase 1",
      saltHex: hex(SALT),
      ...ARGON2ID_TEST,
      dkLen: 32,
      outputHex: hex(await passphraseKdfBytes("Café passphrase 1", { name: "argon2id", ...ARGON2ID_TEST, salt: SALT })),
    },
  ];

  // ---- Approval and member codes ----
  const approverEd = await ed25519FromSeed(APPROVER_ED_SEED.slice());
  const commit = await approvalCommit(NEW_NONCE, device.publicKey, deviceEd.publicKey);
  const code = await approvalCode({
    newX: device.publicKey,
    newEd: deviceEd.publicKey,
    approverEd: approverEd.publicKey,
    accountX: account.x25519.publicKey,
    accountEd: account.ed25519.publicKey,
    approverNonce: APPROVER_NONCE,
    newNonce: NEW_NONCE,
  });
  const approval = {
    newNonceHex: hex(NEW_NONCE),
    approverNonceHex: hex(APPROVER_NONCE),
    newXHex: hex(device.publicKey),
    newEdHex: hex(deviceEd.publicKey),
    approverEdHex: hex(approverEd.publicKey),
    accountXHex: hex(account.x25519.publicKey),
    accountEdHex: hex(account.ed25519.publicKey),
    commitHex: hex(commit),
    code,
  };
  const memberCodes = [
    { ed25519PubHex: hex(account.ed25519.publicKey), code: await memberSecurityCode(account.ed25519.publicKey) },
    { ed25519PubHex: hex(approverEd.publicKey), code: await memberSecurityCode(approverEd.publicKey) },
  ];

  return {
    hkdf: hkdfRows,
    derived,
    records,
    streams,
    smallChunkStream: { chunkSize: 16, length: 40, envelopeHex: hex(smallChunks) },
    boxes,
    statements,
    macs,
    tagNames,
    recoveryKeys,
    recoveryParse: parse,
    argon2id,
    approval,
    memberCodes,
  };
}

export type Vectors = Awaited<ReturnType<typeof computeVectors>> & { $description: string };

function hexOrNull(b: Uint8Array | null): string | null {
  return b ? toHex(b) : null;
}

/** Replaces the character at `i` with another alphabet character (never a dash). */
function flipChar(text: string, i: number): string {
  const ch = text[i]!;
  const next = ch === "Z" ? "Y" : ch === "9" ? "A" : ch === "H" ? "J" : String.fromCharCode(ch.charCodeAt(0) + 1);
  const fixed = next === "I" || next === "L" || next === "O" || next === "U" ? String.fromCharCode(next.charCodeAt(0) + 1) : next;
  return text.slice(0, i) + fixed + text.slice(i + 1);
}

function toBase64UrlLocal(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
