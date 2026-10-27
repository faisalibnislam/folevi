// The Vault's password items on the device (docs/VAULT_PLAN.md §4): each kind's fields, and sealing an item into
// its two records (a summary lists can show, and its secrets) under its own item key, which the vault key wraps.
// The server's half is convex/vaultItems.ts.
import { ulid } from "@folevi/editor-schema";
import { importAead, openRecord, randomBytes, sealRecord, vaultCtx, vaultPasswordMac, type VaultKeys } from "@folevi/local-store/e2ee";
import { bytes, wire } from "@/lib/e2ee/keys/util";

export type ItemKind = "login" | "apiKey" | "card" | "bankAccount" | "secureNote" | "sshKey" | "wifi" | "licence" | "identity";

/** How a field shows: text, a hidden secret, a link, a date, several lines, a 2FA secret. */
export type FieldType = "text" | "secret" | "url" | "date" | "multiline" | "totp";

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  /** Shown in lists (sealed in the summary); everything else is a secret. */
  summary?: boolean;
}

/** The fields of each kind, in the order the item page shows them. The title is every item's first, in its summary. */
export const ITEM_KINDS: Record<ItemKind, { label: string; fields: FieldDef[] }> = {
  login: {
    label: "Login",
    fields: [
      { key: "username", label: "Username", type: "text", summary: true },
      { key: "password", label: "Password", type: "secret" },
      { key: "website", label: "Website", type: "url", summary: true },
      { key: "totp", label: "2FA secret", type: "totp" },
    ],
  },
  apiKey: {
    label: "API key",
    fields: [
      { key: "service", label: "Service", type: "text", summary: true },
      { key: "key", label: "Key", type: "secret" },
      { key: "secret", label: "Secret", type: "secret" },
      { key: "environment", label: "Environment", type: "text", summary: true },
      { key: "expires", label: "Expires", type: "date", summary: true },
    ],
  },
  card: {
    label: "Card",
    fields: [
      { key: "holder", label: "Name on card", type: "text" },
      { key: "number", label: "Number", type: "secret" },
      { key: "expiry", label: "Expiry (MM/YY)", type: "text" },
      { key: "cvc", label: "Security code", type: "secret" },
      { key: "pin", label: "PIN", type: "secret" },
      { key: "brand", label: "Brand", type: "text", summary: true },
    ],
  },
  bankAccount: {
    label: "Bank account",
    fields: [
      { key: "bank", label: "Bank", type: "text", summary: true },
      { key: "holder", label: "Account holder", type: "text" },
      { key: "accountNumber", label: "Account number", type: "secret" },
      { key: "routing", label: "Sort code or routing number", type: "secret" },
      { key: "iban", label: "IBAN", type: "secret" },
      { key: "swift", label: "SWIFT / BIC", type: "text" },
    ],
  },
  secureNote: { label: "Secure note", fields: [{ key: "text", label: "Note", type: "multiline" }] },
  sshKey: {
    label: "SSH key",
    fields: [
      { key: "host", label: "Host", type: "text", summary: true },
      { key: "privateKey", label: "Private key", type: "multiline" },
      { key: "publicKey", label: "Public key", type: "multiline" },
      { key: "passphrase", label: "Passphrase", type: "secret" },
    ],
  },
  wifi: {
    label: "Wi-Fi",
    fields: [
      { key: "network", label: "Network name", type: "text", summary: true },
      { key: "password", label: "Password", type: "secret" },
      { key: "security", label: "Security", type: "text" },
    ],
  },
  licence: {
    label: "Software licence",
    fields: [
      { key: "product", label: "Product", type: "text", summary: true },
      { key: "licenceKey", label: "Licence key", type: "secret" },
      { key: "email", label: "Registered email", type: "text" },
      { key: "expires", label: "Expires", type: "date", summary: true },
    ],
  },
  identity: {
    label: "Identity",
    fields: [
      { key: "fullName", label: "Full name", type: "text", summary: true },
      { key: "dateOfBirth", label: "Date of birth", type: "date" },
      { key: "documentNumber", label: "Passport or ID number", type: "secret" },
      { key: "address", label: "Address", type: "multiline" },
      { key: "phone", label: "Phone", type: "text" },
    ],
  },
};

/** A custom field someone added to an item. */
export interface CustomField {
  label: string;
  type: "text" | "secret" | "url" | "date";
  value: string;
}

/** What the list shows. */
export interface ItemSummary {
  title: string;
  /** The kind's summary fields (username, website, service…). */
  fields: Record<string, string>;
  tags: string[];
  /**
   * The password's health, worked out on the device when it was saved (sealed with the summary, so Health needs no
   * item opened): its strength score (0 to 4), whether Pwned Passwords knows it, and when that was checked.
   */
  health?: ItemHealth;
}

export interface ItemHealth {
  strength: number;
  breached: "breached" | "ok" | "unknown";
  checkedAt: number;
}

/** The rest: secrets, notes, custom fields. */
export interface ItemSecrets {
  fields: Record<string, string>;
  notes: string;
  custom: CustomField[];
}

export interface ItemContent {
  kind: ItemKind;
  summary: ItemSummary;
  secrets: ItemSecrets;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

/** Splits an item's values into its summary and its secrets by the kind's field definitions. */
export function splitItem(kind: ItemKind, title: string, values: Record<string, string>, notes = "", custom: CustomField[] = [], tags: string[] = []): ItemContent {
  const summary: Record<string, string> = {};
  const secrets: Record<string, string> = {};
  for (const f of ITEM_KINDS[kind].fields) {
    const v = values[f.key];
    if (v === undefined || v === "") continue;
    (f.summary ? summary : secrets)[f.key] = v;
  }
  return { kind, summary: { title: title.trim() || ITEM_KINDS[kind].label, fields: summary, tags }, secrets: { fields: secrets, notes, custom } };
}

/** The password reuse checks compare (the login's or Wi-Fi's password), or null. */
export function mainPassword(c: ItemContent): string | null {
  return c.secrets.fields.password || null;
}

/**
 * Seals an item's two records under a fresh item key, which VK "vault/wrap" of the current version wraps: a summary
 * (what lists show) and its secrets. Shared by password items, notes and files.
 */
export async function sealParts(vaultId: string, itemId: string, keyVersion: number, keys: VaultKeys, summary: unknown, secrets: unknown, passwordMac?: string) {
  const raw = randomBytes(32);
  try {
    // A copy: a fallback backend keeps the bytes it's given as the key, and `raw` is zeroed below.
    const itemKey = await importAead(raw.slice());
    const wrappedKey = await sealRecord(keys.wrap, keyVersion, vaultCtx.itemKey(vaultId, itemId, keyVersion), raw);
    const sealedSummary = await sealRecord(itemKey, 1, vaultCtx.itemSummary(vaultId, itemId), enc.encode(JSON.stringify(summary)));
    const sealed = await sealRecord(itemKey, 1, vaultCtx.item(vaultId, itemId), enc.encode(JSON.stringify(secrets)));
    return { sealedSummary: wire(sealedSummary), sealed: wire(sealed), wrappedKey: wire(wrappedKey), keyVersion, ...(passwordMac ? { passwordMac } : {}) };
  } finally {
    raw.fill(0);
  }
}

/**
 * Seals a password item for the server under the Vault's current key, with a blind index of its password so the
 * server can count reuse without reading it.
 */
export async function sealItem(vaultId: string, itemId: string, keyVersion: number, keys: VaultKeys, c: ItemContent) {
  const password = mainPassword(c);
  return await sealParts(vaultId, itemId, keyVersion, keys, { kind: c.kind, ...c.summary }, c.secrets, password ? await vaultPasswordMac(keys.mac, password) : undefined);
}

/** An item key's raw bytes from its wrap (to seal it to someone it's shared with, or to a link). Zero them after. */
export async function rawItemKey(vaultId: string, itemId: string, keyVersion: number, keys: VaultKeys, wrappedKey: ArrayBuffer): Promise<Uint8Array> {
  return await openRecord(keys.wrap, vaultCtx.itemKey(vaultId, itemId, keyVersion), bytes(wrappedKey));
}

/** Opens a row's two records with an item key already in hand (a share's or a link's). */
export async function openWithItemKey<S, T>(vaultId: string, itemId: string, raw: Uint8Array, row: { sealedSummary: ArrayBuffer; sealed?: ArrayBuffer }): Promise<{ summary: S; secrets: T | null }> {
  const key = await importAead(raw.slice());
  const summary = JSON.parse(dec.decode(await openRecord(key, vaultCtx.itemSummary(vaultId, itemId), bytes(row.sealedSummary)))) as S;
  const secrets = row.sealed ? (JSON.parse(dec.decode(await openRecord(key, vaultCtx.item(vaultId, itemId), bytes(row.sealed)))) as T) : null;
  return { summary, secrets };
}

/** An item's key from its wrap (the vault key of the item's version opens it). */
async function itemKeyOf(vaultId: string, itemId: string, keyVersion: number, keys: VaultKeys, wrappedKey: ArrayBuffer) {
  const raw = await openRecord(keys.wrap, vaultCtx.itemKey(vaultId, itemId, keyVersion), bytes(wrappedKey));
  try {
    return await importAead(raw.slice());
  } finally {
    raw.fill(0);
  }
}

/** Opens a row's summary as whatever it holds (a note's or a file's summary). */
export async function openSummaryAs<T>(vaultId: string, row: { id: string; keyVersion: number; wrappedKey: ArrayBuffer; sealedSummary: ArrayBuffer }, keysOf: (version: number) => VaultKeys): Promise<T> {
  const key = await itemKeyOf(vaultId, row.id, row.keyVersion, keysOf(row.keyVersion), row.wrappedKey);
  return JSON.parse(dec.decode(await openRecord(key, vaultCtx.itemSummary(vaultId, row.id), bytes(row.sealedSummary)))) as T;
}

/** Opens a row's secrets as whatever they hold (a note's content, a file's key). */
export async function openSecretsAs<T>(vaultId: string, row: { id: string; keyVersion: number; wrappedKey: ArrayBuffer; sealed: ArrayBuffer }, keysOf: (version: number) => VaultKeys): Promise<T> {
  const key = await itemKeyOf(vaultId, row.id, row.keyVersion, keysOf(row.keyVersion), row.wrappedKey);
  return JSON.parse(dec.decode(await openRecord(key, vaultCtx.item(vaultId, row.id), bytes(row.sealed)))) as T;
}

/** Opens what a list row carries. */
export async function openSummary(vaultId: string, row: { id: string; keyVersion: number; wrappedKey: ArrayBuffer; sealedSummary: ArrayBuffer }, keysOf: (version: number) => VaultKeys): Promise<ItemSummary & { kind: ItemKind }> {
  const key = await itemKeyOf(vaultId, row.id, row.keyVersion, keysOf(row.keyVersion), row.wrappedKey);
  return JSON.parse(dec.decode(await openRecord(key, vaultCtx.itemSummary(vaultId, row.id), bytes(row.sealedSummary))));
}

/** Opens an item's secrets (from vaultItems.open, or a version from its history). */
export async function openSecrets(vaultId: string, row: { id: string; keyVersion: number; wrappedKey: ArrayBuffer; sealed: ArrayBuffer }, keysOf: (version: number) => VaultKeys): Promise<ItemSecrets> {
  const key = await itemKeyOf(vaultId, row.id, row.keyVersion, keysOf(row.keyVersion), row.wrappedKey);
  return JSON.parse(dec.decode(await openRecord(key, vaultCtx.item(vaultId, row.id), bytes(row.sealed))));
}

/** The field names that differ between two versions of an item (for the log: names only, never values). */
export function changedFields(before: ItemContent, after: ItemContent): string[] {
  const out = new Set<string>();
  if (before.summary.title !== after.summary.title) out.add("title");
  const keys = new Set([...Object.keys(before.summary.fields), ...Object.keys(after.summary.fields), ...Object.keys(before.secrets.fields), ...Object.keys(after.secrets.fields)]);
  for (const k of keys) {
    const a = before.summary.fields[k] ?? before.secrets.fields[k] ?? "";
    const b = after.summary.fields[k] ?? after.secrets.fields[k] ?? "";
    if (a !== b) out.add(k);
  }
  if (before.secrets.notes !== after.secrets.notes) out.add("notes");
  if (JSON.stringify(before.secrets.custom) !== JSON.stringify(after.secrets.custom)) out.add("custom fields");
  if (JSON.stringify(before.summary.tags) !== JSON.stringify(after.summary.tags)) out.add("tags");
  return [...out].sort();
}

export const newItemId = () => ulid();
