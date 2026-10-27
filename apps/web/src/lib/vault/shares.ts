// Sharing vault items on the device (docs/VAULT_PLAN.md §6): an item's key sealed to one person's account key, or
// wrapped by a one-time link's key that lives only in the link's fragment (#k=…, never sent to a server). The
// server's half is convex/vaultShares.ts.
import { linkWrapKey, openRecord, openSealed, openStatement, randomBytes, sealRecord, sealTo, toBase64Url, fromBase64Url, vaultCtx, type VaultKeys, type X25519KeyPair } from "@folevi/local-store/e2ee";
import { bytes, wire } from "@/lib/e2ee/keys/util";
import { openWithItemKey, rawItemKey } from "./items";

/**
 * Someone's account keys as vaultShares.findPerson returned them, if their signed statement vouches for them (the
 * server can't swap in a key of its own); else null.
 */
export async function checkedRecipient(r: { profileId: string; epoch: number; x25519Pub: ArrayBuffer; ed25519Pub: ArrayBuffer; statement: unknown }) {
  const x = bytes(r.x25519Pub);
  const ed = bytes(r.ed25519Pub);
  const body = await openStatement(ed, r.statement as { kind: "account-key"; body: string; sig: string });
  if (!body || body.profileId !== r.profileId || body.epoch !== r.epoch || body.x25519Pub !== toBase64Url(x) || body.ed25519Pub !== toBase64Url(ed)) return null;
  return { profileId: r.profileId, epoch: r.epoch, x25519Pub: x };
}

/** An item's key sealed to someone's account key, for vaultShares.share. */
export async function sealItemTo(vaultId: string, row: { id: string; keyVersion: number; wrappedKey: ArrayBuffer }, keys: VaultKeys, recipient: { profileId: string; x25519Pub: Uint8Array }) {
  const raw = await rawItemKey(vaultId, row.id, row.keyVersion, keys, row.wrappedKey);
  try {
    return wire(await sealTo(recipient.x25519Pub, vaultCtx.shareKey(vaultId, row.id, recipient.profileId), raw));
  } finally {
    raw.fill(0);
  }
}

/** Opens an item shared with this person (vaultShares.openShared's answer) with their account key. */
export async function openShared<S, T>(r: { vaultId: string; id: string; wrappedKey: ArrayBuffer; sealedSummary: ArrayBuffer; sealed?: ArrayBuffer }, me: { profileId: string; account: X25519KeyPair }) {
  const raw = await openSealed(me.account.privateKey, me.account.publicKey, vaultCtx.shareKey(r.vaultId, r.id, me.profileId), bytes(r.wrappedKey));
  try {
    return await openWithItemKey<S, T>(r.vaultId, r.id, raw, r);
  } finally {
    raw.fill(0);
  }
}

/**
 * A one-time link to an item: a random link id and secret; the item key wrapped by the secret's key. The URL carries
 * the secret after "#", which browsers never send to a server.
 */
export async function makeLink(vaultId: string, row: { id: string; keyVersion: number; wrappedKey: ArrayBuffer }, keys: VaultKeys, origin: string) {
  const linkId = toBase64Url(randomBytes(18));
  const secret = randomBytes(32);
  const raw = await rawItemKey(vaultId, row.id, row.keyVersion, keys, row.wrappedKey);
  try {
    const wrappedKey = wire(await sealRecord(await linkWrapKey(secret.slice()), 1, vaultCtx.linkKey(vaultId, row.id, linkId), raw));
    return { linkId, wrappedKey, url: `${origin.replace(/\/$/, "")}/vault-link/${linkId}#k=${toBase64Url(secret)}` };
  } finally {
    raw.fill(0);
    secret.fill(0);
  }
}

/** The secret from a link's fragment ("#k=…"), or null. */
export function linkSecret(hash: string): Uint8Array | null {
  const m = /[#&]k=([A-Za-z0-9_-]{43})/.exec(hash);
  if (!m) return null;
  try {
    return fromBase64Url(m[1]!);
  } catch {
    return null;
  }
}

/** Opens what a link's page got back (vaultShares.openLink's "ok" answer) with the fragment's secret. */
export async function openLinkItem<S, T>(r: { vaultId: string; itemId: string; wrappedKey: ArrayBuffer; sealedSummary: ArrayBuffer; sealed: ArrayBuffer }, linkId: string, secret: Uint8Array) {
  const raw = await openRecord(await linkWrapKey(secret.slice()), vaultCtx.linkKey(r.vaultId, r.itemId, linkId), bytes(r.wrappedKey));
  try {
    return await openWithItemKey<S, T>(r.vaultId, r.itemId, raw, r);
  } finally {
    raw.fill(0);
  }
}
