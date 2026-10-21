// IndexedDB "folevi-e2ee" (docs/E2EE_DESIGN.md §6.1, §6.2): a trusted browser's device keys, as
// non-extractable CryptoKeys (X25519 deriveBits, Ed25519 sign) that this origin can use but never read, and
// the device's wrap of the account master key (an FLS1 box only those keys open), so the browser unlocks
// with no prompt and offline. One record per signed-in person. Nothing here is a raw key.
//
// Public computers keep nothing here (publicMode.ts); the Mac keeps its device keys in the app (macBridge.ts).
import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { generateEd25519, generateX25519, openSealed, type Ed25519KeyPair, type X25519KeyPair } from "@folevi/local-store/e2ee";
import { copyBytes } from "./util";

export const KEYSTORE_DB = "folevi-e2ee";

export type DeviceKind = "app" | "browser" | "session";

/** A device as the session uses it: its public keys, and opening a box sealed to it. */
export interface DeviceIdentity {
  kind: DeviceKind;
  deviceId: string;
  x25519Pub: Uint8Array;
  ed25519Pub: Uint8Array;
  /** FLS1 open with the device's X25519 key. */
  open(box: Uint8Array, context: string): Promise<Uint8Array>;
}

export interface BrowserDeviceRecord {
  profileId: string;
  deviceId: string;
  x25519: X25519KeyPair;
  ed25519: Ed25519KeyPair;
  /** True once the server holds this device's wrap (unlocked here with a method, or approved). */
  trusted: boolean;
  createdAt: number;
}

/** The device's wrap and the account it opens, kept so the browser unlocks offline. */
export interface CachedWrap {
  profileId: string;
  deviceId: string;
  epoch: number;
  wrapped: Uint8Array;
  account: { x25519Pub: Uint8Array; ed25519Pub: Uint8Array; amkCheck: Uint8Array };
}

export interface KeyStore {
  getDevice(profileId: string): Promise<BrowserDeviceRecord | null>;
  putDevice(rec: BrowserDeviceRecord): Promise<void>;
  deleteDevice(profileId: string): Promise<void>;
  getWrap(profileId: string): Promise<CachedWrap | null>;
  putWrap(rec: CachedWrap): Promise<void>;
  deleteWrap(profileId: string): Promise<void>;
}

interface E2eeDb extends DBSchema {
  device: { key: string; value: BrowserDeviceRecord };
  wraps: { key: string; value: CachedWrap };
}

let dbPromise: Promise<IDBPDatabase<E2eeDb>> | null = null;
function db(): Promise<IDBPDatabase<E2eeDb>> {
  dbPromise ??= openDB<E2eeDb>(KEYSTORE_DB, 1, {
    upgrade(d) {
      d.createObjectStore("device", { keyPath: "profileId" });
      d.createObjectStore("wraps", { keyPath: "profileId" });
    },
    blocking() {
      // Another tab deletes the database ("Forget this browser"): let it.
      void dbPromise?.then((x) => x.close());
      dbPromise = null;
    },
  });
  return dbPromise;
}

/** The browser's store. */
export const idbKeyStore: KeyStore = {
  async getDevice(profileId) {
    return (await (await db()).get("device", profileId)) ?? null;
  },
  async putDevice(rec) {
    await (await db()).put("device", rec);
  },
  async deleteDevice(profileId) {
    await (await db()).delete("device", profileId);
  },
  async getWrap(profileId) {
    return (await (await db()).get("wraps", profileId)) ?? null;
  },
  async putWrap(rec) {
    await (await db()).put("wraps", rec);
  },
  async deleteWrap(profileId) {
    await (await db()).delete("wraps", profileId);
  },
};

/** Closes the connection (before deleting the database). */
export async function closeKeyStore(): Promise<void> {
  const p = dbPromise;
  dbPromise = null;
  if (p) (await p).close();
}

/** In memory only: tests, and anywhere IndexedDB is missing. */
export function memoryKeyStore(): KeyStore {
  const devices = new Map<string, BrowserDeviceRecord>();
  const wraps = new Map<string, CachedWrap>();
  return {
    getDevice: async (p) => devices.get(p) ?? null,
    putDevice: async (r) => void devices.set(r.profileId, r),
    deleteDevice: async (p) => void devices.delete(p),
    getWrap: async (p) => wraps.get(p) ?? null,
    putWrap: async (r) => void wraps.set(r.profileId, r),
    deleteWrap: async (p) => void wraps.delete(p),
  };
}

/** New device keys, non-extractable. */
export async function newBrowserDevice(profileId: string, deviceId: string): Promise<BrowserDeviceRecord> {
  const [x25519, ed25519] = await Promise.all([generateX25519({ extractable: false }), generateEd25519({ extractable: false })]);
  return { profileId, deviceId, x25519, ed25519, trusted: false, createdAt: Date.now() };
}

/** Whether the keys can be kept in IndexedDB as keys this page can't read (WebCrypto, not raw bytes). */
export function persistable(rec: BrowserDeviceRecord): boolean {
  return typeof CryptoKey !== "undefined" && rec.x25519.privateKey instanceof CryptoKey && rec.ed25519.privateKey instanceof CryptoKey;
}

export function browserIdentity(rec: BrowserDeviceRecord, kind: DeviceKind = "browser"): DeviceIdentity {
  return {
    kind,
    deviceId: rec.deviceId,
    x25519Pub: copyBytes(rec.x25519.publicKey),
    ed25519Pub: copyBytes(rec.ed25519.publicKey),
    open: (box, context) => openSealed(rec.x25519.privateKey, rec.x25519.publicKey, context, box),
  };
}
