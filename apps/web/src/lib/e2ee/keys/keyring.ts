// The key ring (docs/E2EE_DESIGN.md §4.1, §4.9, §6.1): space keys opened from this person's grants, and note
// keys opened from their wraps (by the space key, by a grant to this person, or by a link's secret). Opened
// keys are kept in memory only, as derived non-extractable keys (an LRU of 5,000 note keys); the wrapped rows
// they came from are kept too, so a raw key can be opened again for a moment when it has to be re-wrapped
// (sharing, rotation) and is zeroed right after. Nothing is persisted.
//
// Grants are checked before use: the statement must name this space, version, person and account key, and be
// signed by the granter's account key (this person's own key for their own grants: a mismatch is refused; a
// granter whose key changed since is accepted and reported in `unverified`, as member key changes don't block
// anything in v1, §8.6).
import {
  ctx,
  deriveNoteKeys,
  deriveSpaceKeys,
  linkWrapKey,
  openRecord,
  openSealed,
  openStatement,
  randomBytes,
  sealRecord,
  toBase64Url,
  verifyStatement,
  type NoteKeys,
  type SpaceKeys,
} from "@folevi/local-store/e2ee";
import type { WireScope } from "@folevi/editor-schema";
import { sessionImpl, type KeySessionImpl } from "./session";
import type { MySpace, NoteKeyRow } from "./server";
import { KeysError, bytes, scopeOfString, scopeString, wire } from "./util";

/** A note key wrap from e2ee.pull (WP3) or e2ee.grants.myNoteKeys. `scope`: the space it belongs to, when the caller knows. */
export interface PulledNoteKey extends NoteKeyRow {
  scope?: WireScope;
}

export interface KeyRing {
  spaceKeys(scope: WireScope, version?: number): Promise<SpaceKeys & { version: number }>;
  noteKeys(documentId: string, version?: number): Promise<NoteKeys & { version: number }>;
  newNoteKey(documentId: string, scope: WireScope): Promise<{ keys: NoteKeys; version: number; wrapped: Uint8Array; spaceVersion: number }>;
  /** From pull or myNoteKeys. */
  addNoteKeys(rows: PulledNoteKey[]): Promise<void>;
  /** An encrypted link's note key (§9.1): `linkPublicId` is part of the wrap's context, so it's needed too. */
  linkNoteKey(documentId: string, secret: Uint8Array, wrapped: Uint8Array, version: number, linkPublicId?: string): Promise<void>;
}

type Grant = MySpace["grants"][number];

const NOTE_CACHE = 5000;

export class KeyRingImpl implements KeyRing {
  private spaces = new Map<string, MySpace>();
  private spacesLoaded: Promise<void> | null = null;
  private spaceCache = new Map<string, SpaceKeys>();
  /** Grants this device just made for this person (a space set up or rotated here), before `spaces.mine` lists them. */
  private ownGrants = new Map<string, { version: number; epoch: number; wrapped: ArrayBuffer }>();
  private currentVersions = new Map<string, number>();
  private rows = new Map<string, PulledNoteKey[]>();
  private notes = new Map<string, NoteKeys>();
  private docScope = new Map<string, WireScope>();
  /** "<scope>#<version>" of grants whose granter's signature couldn't be checked against their current key. */
  readonly unverified = new Set<string>();

  constructor(private readonly session: KeySessionImpl) {
    session.onLock.push(() => this.clear());
  }

  clear(): void {
    this.spaces.clear();
    this.spacesLoaded = null;
    this.spaceCache.clear();
    this.ownGrants.clear();
    this.currentVersions.clear();
    this.rows.clear();
    this.notes.clear();
    this.docScope.clear();
    this.unverified.clear();
  }

  // ---------------------------------------------------------------- spaces

  private scopeId(scope: WireScope): string {
    return scopeString(scope, this.session.bound().profileId);
  }

  /** The spaces this person can open (`e2ee.spaces.mine`), loaded once per unlock and on demand. */
  async loadSpaces(refresh = false): Promise<MySpace[]> {
    if (refresh || !this.spacesLoaded) {
      this.spacesLoaded = (async () => {
        const list = await this.session.unlocked().server.spaces.mine({});
        this.spaces.clear();
        for (const s of list) {
          this.spaces.set(s.scopeId, s);
          this.currentVersions.set(s.scopeId, s.currentKeyVersion);
        }
      })();
      this.spacesLoaded.catch(() => {
        this.spacesLoaded = null;
      });
    }
    await this.spacesLoaded;
    return [...this.spaces.values()];
  }

  /** The current space key version (from the server, or from a key this device just made). */
  async currentVersion(scope: WireScope): Promise<number> {
    const id = this.scopeId(scope);
    if (!this.currentVersions.has(id)) await this.loadSpaces(true);
    if (!this.currentVersions.has(id)) {
      const row = await this.session.unlocked().server.spaces.get({ scope });
      if (row.currentKeyVersion > 0) this.currentVersions.set(id, row.currentKeyVersion);
    }
    const v = this.currentVersions.get(id);
    if (!v) throw new KeysError("e2ee_not_set_up", "This space has no encryption key yet.");
    return v;
  }

  /** The versions of a space's key this person holds a grant for. */
  async heldVersions(scope: WireScope): Promise<number[]> {
    const id = this.scopeId(scope);
    await this.loadSpaces(true).catch(() => undefined);
    const vs = new Set((this.spaces.get(id)?.grants ?? []).map((g) => g.version));
    for (const [key, g] of this.ownGrants) if (key.startsWith(`${id}#`)) vs.add(g.version);
    return [...vs].sort((a, b) => a - b);
  }

  private async grantFor(scope: WireScope, version: number): Promise<{ wrapped: ArrayBuffer; grant: Grant | null }> {
    const id = this.scopeId(scope);
    const own = this.ownGrants.get(`${id}#${version}`);
    if (own) return { wrapped: own.wrapped, grant: null };
    const u = this.session.unlocked();
    const find = () => this.spaces.get(id)?.grants.find((g) => g.version === version && g.epoch === u.epoch) ?? null;
    await this.loadSpaces();
    let grant = find();
    if (!grant) {
      await this.loadSpaces(true);
      grant = find();
    }
    if (!grant) throw new KeysError("e2ee_no_key", "You don't have the key to this space yet.");
    return { wrapped: grant.wrapped, grant };
  }

  /** Checks a grant's statement (§4.9): names this space, version, person and key, and is signed by the granter. */
  private async checkGrant(scope: WireScope, version: number, grant: Grant): Promise<void> {
    const u = this.session.unlocked();
    const id = this.scopeId(scope);
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(grant.statement.body) as Record<string, unknown>;
    } catch {
      throw new KeysError("e2ee_bad_grant", "A key grant isn't valid.");
    }
    if (
      grant.statement.kind !== "space-grant" ||
      body.scope !== id ||
      body.version !== version ||
      body.profileId !== u.profileId ||
      body.granteeX25519Pub !== toBase64Url(u.account.x25519.publicKey) ||
      body.grantedBy !== grant.grantedBy
    )
      throw new KeysError("e2ee_bad_grant", "A key grant doesn't match this space.");
    if (grant.grantedBy === u.profileId) {
      if (!(await verifyStatement(u.account.ed25519.publicKey, grant.statement))) throw new KeysError("e2ee_bad_grant", "A key grant isn't signed by you.");
      return;
    }
    const [granter] = await u.server.keys.accountKeysOf({ profileIds: [grant.grantedBy] }).catch(() => []);
    if (granter) {
      const ed = bytes(granter.ed25519Pub);
      const self = await openStatement(ed, granter.statement as { kind: "account-key"; body: string; sig: string });
      if (self && self.ed25519Pub === toBase64Url(ed) && (await verifyStatement(ed, grant.statement))) return;
    }
    this.unverified.add(`${id}#${version}`);
  }

  /** Runs `fn` with the raw space key of a version (zeroed after). */
  async withRawSpaceKey<T>(scope: WireScope, version: number, fn: (raw: Uint8Array) => Promise<T>): Promise<T> {
    const u = this.session.unlocked();
    const { wrapped, grant } = await this.grantFor(scope, version);
    if (grant) await this.checkGrant(scope, version, grant);
    const raw = await openSealed(u.account.x25519.privateKey, u.account.x25519.publicKey, ctx.spaceGrant(this.scopeId(scope), version, u.profileId), bytes(wrapped));
    try {
      return await fn(raw);
    } finally {
      raw.fill(0);
    }
  }

  async spaceKeys(scope: WireScope, version?: number): Promise<SpaceKeys & { version: number }> {
    const v = version ?? (await this.currentVersion(scope));
    const key = `${this.scopeId(scope)}#${v}`;
    let keys = this.spaceCache.get(key);
    if (!keys) {
      keys = await this.withRawSpaceKey(scope, v, (raw) => deriveSpaceKeys(raw));
      this.spaceCache.set(key, keys);
    }
    return { ...keys, version: v };
  }

  /** A space key this device just made (setup.ts): kept as derived keys, plus this person's own grant of it. */
  async rememberSpaceKey(scope: WireScope, version: number, raw: Uint8Array, ownGrant: { epoch: number; wrapped: Uint8Array }, current = true): Promise<void> {
    const id = this.scopeId(scope);
    this.spaceCache.set(`${id}#${version}`, await deriveSpaceKeys(raw));
    this.ownGrants.set(`${id}#${version}`, { version, epoch: ownGrant.epoch, wrapped: wire(ownGrant.wrapped) });
    if (current) this.currentVersions.set(id, version);
  }

  // ---------------------------------------------------------------- notes

  async addNoteKeys(rows: PulledNoteKey[]): Promise<void> {
    for (const r of rows) {
      const list = this.rows.get(r.documentId) ?? [];
      const same = (x: PulledNoteKey) => x.version === r.version && x.wrappedBy === r.wrappedBy && (x.spaceVersion ?? null) === (r.spaceVersion ?? null);
      const next = list.filter((x) => !same(x));
      next.push(r);
      this.rows.set(r.documentId, next);
      if (r.scope) this.docScope.set(r.documentId, r.scope);
    }
  }

  /** Tells the ring which space a note is in (the replica knows; a guest's notes are found by trying). */
  setDocumentScope(documentId: string, scope: WireScope): void {
    this.docScope.set(documentId, scope);
  }

  private async rowsOf(documentId: string): Promise<PulledNoteKey[]> {
    let rows = this.rows.get(documentId);
    if (!rows?.length) {
      const u = this.session.unlocked();
      const fetched = await u.server.grants.myNoteKeys({ documentIds: [documentId] });
      await this.addNoteKeys(fetched.map((r) => ({ documentId: r.documentId, version: r.version, wrappedBy: r.wrappedBy, spaceVersion: r.spaceVersion, wrapped: r.wrapped })));
      rows = this.rows.get(documentId);
    }
    if (!rows?.length) throw new KeysError("e2ee_no_key", "You don't have the key to this note.");
    return rows;
  }

  private async newestVersion(documentId: string): Promise<number> {
    return Math.max(...(await this.rowsOf(documentId)).map((r) => r.version));
  }

  /** The raw note key of a version, opened from whichever wrap this person can open. The caller zeroes it. */
  async openNoteRaw(documentId: string, version: number): Promise<Uint8Array> {
    const rows = (await this.rowsOf(documentId)).filter((r) => r.version === version);
    const u = this.session.unlocked();
    const order = { space: 0, grant: 1, link: 2 } as const;
    for (const r of [...rows].sort((a, b) => order[a.wrappedBy] - order[b.wrappedBy])) {
      const wrapped = bytes(r.wrapped);
      if (r.wrappedBy === "grant") {
        try {
          return await openSealed(u.account.x25519.privateKey, u.account.x25519.publicKey, ctx.noteKeyGrant(documentId, version, u.profileId), wrapped);
        } catch {
          continue;
        }
      }
      if (r.wrappedBy === "space" && r.spaceVersion) {
        const known = r.scope ?? this.docScope.get(documentId);
        const candidates: WireScope[] = known ? [known] : (await this.loadSpaces()).map((s) => scopeOfString(s.scopeId)!).filter(Boolean);
        for (const scope of candidates) {
          try {
            const sk = await this.spaceKeys(scope, r.spaceVersion);
            const raw = await openRecord(sk.wrap, ctx.noteKeySpace(documentId, version, this.scopeId(scope), r.spaceVersion), wrapped);
            this.docScope.set(documentId, scope);
            return raw;
          } catch {
            continue;
          }
        }
      }
    }
    throw new KeysError("e2ee_no_key", "You don't have the key to this note.");
  }

  async noteKeys(documentId: string, version?: number): Promise<NoteKeys & { version: number }> {
    if (version === undefined) {
      const cached = this.newestCached(documentId);
      if (cached) return { ...cached.keys, version: cached.version };
    }
    const v = version ?? (await this.newestVersion(documentId));
    const hit = this.notes.get(`${documentId}#${v}`);
    if (hit) return { ...this.touch(`${documentId}#${v}`, hit), version: v };
    const raw = await this.openNoteRaw(documentId, v);
    let keys: NoteKeys;
    try {
      keys = await deriveNoteKeys(raw);
    } finally {
      raw.fill(0);
    }
    this.put(`${documentId}#${v}`, keys);
    return { ...keys, version: v };
  }

  /** The newest cached version, only when no wrap of a newer version is known. */
  private newestCached(documentId: string): { keys: NoteKeys; version: number } | null {
    const rows = this.rows.get(documentId);
    const newest = rows?.length ? Math.max(...rows.map((r) => r.version)) : null;
    if (newest === null) {
      // A link's key: no rows, only the cache.
      let best: { keys: NoteKeys; version: number } | null = null;
      for (const [k, keys] of this.notes) {
        const [doc, v] = k.split("#");
        if (doc === documentId && (!best || Number(v) > best.version)) best = { keys, version: Number(v) };
      }
      return best;
    }
    const keys = this.notes.get(`${documentId}#${newest}`);
    return keys ? { keys: this.touch(`${documentId}#${newest}`, keys), version: newest } : null;
  }

  async newNoteKey(documentId: string, scope: WireScope): Promise<{ keys: NoteKeys; version: number; wrapped: Uint8Array; spaceVersion: number }> {
    const sk = await this.spaceKeys(scope);
    const nk = randomBytes(32);
    try {
      const wrapped = await sealRecord(sk.wrap, sk.version, ctx.noteKeySpace(documentId, 1, this.scopeId(scope), sk.version), nk);
      const keys = await deriveNoteKeys(nk);
      await this.addNoteKeys([{ documentId, version: 1, wrappedBy: "space", spaceVersion: sk.version, wrapped: wire(wrapped), scope }]);
      this.put(`${documentId}#1`, keys);
      return { keys, version: 1, wrapped, spaceVersion: sk.version };
    } finally {
      nk.fill(0);
    }
  }

  async linkNoteKey(documentId: string, secret: Uint8Array, wrapped: Uint8Array, version: number, linkPublicId?: string): Promise<void> {
    if (!linkPublicId) throw new KeysError("invalid_argument", "An encrypted link's key needs the link's id.");
    const key = await linkWrapKey(secret);
    const raw = await openRecord(key, ctx.noteKeyLink(documentId, version, linkPublicId), wrapped);
    try {
      this.put(`${documentId}#${version}`, await deriveNoteKeys(raw));
    } finally {
      raw.fill(0);
    }
  }

  /** Every note key wrap of a space this person can see (for a rotation): pulled from the server page by page. */
  async allNoteKeyRows(scope: WireScope): Promise<PulledNoteKey[]> {
    const u = this.session.unlocked();
    const out: PulledNoteKey[] = [];
    let cursor = 0;
    for (let page = 0; page < 10_000; page++) {
      const r = await u.server.pullNoteKeys({ scope, cursor, limit: 1000 });
      for (const row of r.noteKeys) out.push({ ...row, scope });
      if (!r.hasMore || r.nextCursor <= cursor) break;
      cursor = r.nextCursor;
    }
    await this.addNoteKeys(out);
    return out;
  }

  // ---------------------------------------------------------------- LRU

  private put(key: string, keys: NoteKeys): void {
    this.notes.delete(key);
    this.notes.set(key, keys);
    while (this.notes.size > NOTE_CACHE) this.notes.delete(this.notes.keys().next().value!);
  }
  private touch(key: string, keys: NoteKeys): NoteKeys {
    this.notes.delete(key);
    this.notes.set(key, keys);
    return keys;
  }
  /** Tests: how many note keys are held. */
  get cachedNotes(): number {
    return this.notes.size;
  }
}

let ring: KeyRingImpl | null = null;

export function keyRingImpl(): KeyRingImpl {
  ring ??= new KeyRingImpl(sessionImpl());
  return ring;
}

export function getKeyRing(): KeyRing {
  return keyRingImpl();
}

/** Tests only. */
export function resetKeyRingForTests(): void {
  ring?.clear();
  ring = null;
}
