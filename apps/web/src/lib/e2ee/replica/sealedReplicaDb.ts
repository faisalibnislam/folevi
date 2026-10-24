// An encrypted space's replica, encrypted at rest (docs/NATIVE_APP_PLAN.md §11.6, the owner's rule of
// 2026-10-24: end-to-end encrypted spaces stay encrypted on the device and are opened only in memory). It wraps
// the replica's database (`folevi-e2ee-<scope>`, store.ts): every row, note and bookkeeping value is sealed with
// AES-256-GCM under a per-device local storage key before it's written, and opened when the replica loads into
// memory (SpaceReplicaStore keeps it there; nothing readable is written back).
//
// The key is a non-extractable CryptoKey made on this device and kept in the same database (IndexedDB stores the
// key object, never its bytes in a form scripts can read). That protects the copy from anything that reads the
// database's files or its values (another tool, a backup, a script dumping IndexedDB); it can't protect against
// code running inside the app itself, which can use the key, as the plan accepts. Rows a build before this wrote
// readable are sealed on the first load. A public computer's replica is in memory only and isn't wrapped.
import type { NoteLike } from "@folevi/local-store";
import type { ReplicaBatch, ReplicaDb, ReplicaSnapshot } from "@/lib/local/store/replicaDb";

/** Where the key is kept, in the replica's own `state` store. */
export const LOCAL_KEY_STATE = "\u0000localStorageKey";

interface Envelope {
  $sealed: 1;
  iv: Uint8Array;
  c: ArrayBuffer;
}

// Tags, not instanceof: values can come from another realm (a worker, a test's IndexedDB).
const tag = (v: unknown) => Object.prototype.toString.call(v);
const isBuffer = (v: unknown): v is ArrayBuffer => tag(v) === "[object ArrayBuffer]";
const isBytes = (v: unknown): v is Uint8Array => tag(v) === "[object Uint8Array]";
const isEnvelope = (v: unknown): v is Envelope => typeof v === "object" && v !== null && (v as { $sealed?: unknown }).$sealed === 1 && isBuffer((v as { c?: unknown }).c);

function b64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function unb64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** JSON that keeps binary values (sealed fields, hashes): ArrayBuffers and Uint8Arrays round-trip; Blobs are dropped. */
export function encodeValue(value: unknown): string {
  return JSON.stringify(value, function (this: Record<string, unknown>, key: string, v: unknown) {
    const raw = key === "" ? v : this[key];
    if (isBuffer(raw)) return { $ab: b64(new Uint8Array(raw)) };
    if (isBytes(raw)) return { $u8: b64(raw) };
    if (tag(raw) === "[object Blob]" || tag(raw) === "[object File]") return null;
    return v;
  });
}

export function decodeValue(json: string): unknown {
  return JSON.parse(json, (_k, v: unknown) => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const o = v as { $ab?: unknown; $u8?: unknown };
      if (typeof o.$ab === "string" && Object.keys(o).length === 1) return unb64(o.$ab).buffer;
      if (typeof o.$u8 === "string" && Object.keys(o).length === 1) return unb64(o.$u8);
    }
    return v;
  });
}

const enc = new TextEncoder();
const dec = new TextDecoder();

async function seal(key: CryptoKey, value: unknown): Promise<Envelope> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const c = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(encodeValue(value)));
  return { $sealed: 1, iv, c };
}

async function open(key: CryptoKey, env: Envelope): Promise<unknown> {
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: env.iv as Uint8Array<ArrayBuffer> }, key, env.c);
  return decodeValue(dec.decode(plain));
}

export class SealedReplicaDb implements ReplicaDb {
  private key: Promise<CryptoKey> | null = null;

  constructor(private readonly inner: ReplicaDb) {}

  /** The device's key for this replica: the one kept in it, or a new one (made once, even if asked twice at once). */
  private ensureKey(state: Map<string, unknown> | null): Promise<CryptoKey> {
    this.key ??= (async () => {
      const known = state ?? (await this.inner.load()).state;
      const kept = known.get(LOCAL_KEY_STATE);
      if (kept && typeof kept === "object" && (kept as CryptoKey).type === "secret") return kept as CryptoKey;
      const made = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
      await this.inner.write({ state: [[LOCAL_KEY_STATE, made]] });
      return made;
    })();
    return this.key;
  }

  async load(): Promise<ReplicaSnapshot> {
    const snap = await this.inner.load();
    const key = await this.ensureKey(snap.state);
    const legacy: ReplicaBatch = { rows: [], notes: [], state: [] };
    const openAll = async <T>(from: Map<string, unknown>, into: [string, T][] | undefined, skip?: string): Promise<Map<string, T>> => {
      const out = new Map<string, T>();
      await Promise.all(
        [...from].map(async ([k, v]) => {
          if (k === skip) return;
          if (isEnvelope(v)) {
            try {
              out.set(k, (await open(key, v)) as T);
            } catch {
              // Sealed under a key this device no longer has: the pull fills it again.
            }
          } else {
            out.set(k, v as T);
            into?.push([k, v as T]);
          }
        }),
      );
      return out;
    };
    const rows = await openAll<unknown>(snap.rows, legacy.rows);
    const notes = await openAll<NoteLike>(snap.notes, legacy.notes as [string, NoteLike][]);
    const state = await openAll<unknown>(snap.state, legacy.state, LOCAL_KEY_STATE);
    // Written readable by a build before this: sealed now.
    if (legacy.rows!.length || legacy.notes!.length || legacy.state!.length) await this.write(legacy);
    return { rows, notes, state };
  }

  async write(batch: ReplicaBatch): Promise<void> {
    const key = await this.ensureKey(null);
    const sealAll = async <T>(entries: [string, T | null][] | undefined) =>
      entries ? await Promise.all(entries.map(async ([k, v]) => [k, v === null ? null : await seal(key, v)] as [string, unknown])) : undefined;
    await this.inner.write({ rows: await sealAll(batch.rows), notes: (await sealAll(batch.notes)) as [string, NoteLike | null][] | undefined, state: await sealAll(batch.state) });
  }

  async close(): Promise<void> {
    await this.inner.close();
  }
}
