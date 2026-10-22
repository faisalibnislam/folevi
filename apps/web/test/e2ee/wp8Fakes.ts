// Test helpers for WP8 (docs/E2EE_DESIGN.md §11.1): the migration, features and links run against the real
// server functions in convex-test (tests/convex/helpers.ts sets a person and a space up with WP1's real keys),
// with a key ring that holds the space key the helper made (WP6's KeyRing does the same from grants).
import { ctx as aad, deriveNoteKeys, deriveSpaceKeys, openRecord, randomBytes, sealRecord, toWireBytes, type NoteKeys, type SpaceKeys } from "@folevi/local-store/e2ee";
import type { WireScope } from "@folevi/editor-schema";
import type { KeyRingLike, PulledNoteKey } from "@/lib/e2ee/router/deps";
import type { InnerClient } from "@/lib/e2ee/router/types";

/** A key ring for one space whose raw key the test holds. */
export class TestKeyRing implements KeyRingLike {
  private sk = new Map<number, SpaceKeys>();
  private notes = new Map<string, { raw: Uint8Array; keys: NoteKeys }>();
  private rows = new Map<string, PulledNoteKey[]>();

  constructor(
    private readonly raw: Map<number, Uint8Array>,
    private readonly scopeId: string,
    private readonly current = 1,
  ) {}

  /** Another device of the same person: the same space key, no note keys yet. */
  sibling(): TestKeyRing {
    return new TestKeyRing(this.raw, this.scopeId, this.current);
  }

  async spaceKeys(_scope: WireScope, version = this.current): Promise<SpaceKeys & { version: number }> {
    void _scope;
    let k = this.sk.get(version);
    if (!k) {
      const raw = this.raw.get(version);
      if (!raw) throw new Error(`No space key v${version}.`);
      k = await deriveSpaceKeys(raw.slice());
      this.sk.set(version, k);
    }
    return { ...k, version };
  }

  private async open(documentId: string, version: number): Promise<{ raw: Uint8Array; keys: NoteKeys } | null> {
    const hit = this.notes.get(`${documentId}#${version}`);
    if (hit) return hit;
    const row = (this.rows.get(documentId) ?? []).find((r) => r.version === version && r.wrappedBy === "space");
    if (!row) return null;
    const sk = await this.spaceKeys({ kind: "personal" }, row.spaceVersion ?? 1);
    const raw = await openRecord(sk.wrap, aad.noteKeySpace(documentId, version, this.scopeId, row.spaceVersion ?? 1), new Uint8Array(row.wrapped));
    const opened = { raw: raw.slice(), keys: await deriveNoteKeys(raw) };
    this.notes.set(`${documentId}#${version}`, opened);
    return opened;
  }

  private newest(documentId: string): number {
    const fromRows = (this.rows.get(documentId) ?? []).map((r) => r.version);
    const fromKeys = [...this.notes.keys()].filter((k) => k.startsWith(`${documentId}#`)).map((k) => Number(k.split("#")[1]));
    return Math.max(0, ...fromRows, ...fromKeys);
  }

  async noteKeys(documentId: string, version?: number): Promise<NoteKeys & { version: number }> {
    const v = version ?? this.newest(documentId);
    const o = await this.open(documentId, v);
    if (!o) throw Object.assign(new Error("You don't have the key to this note."), { data: { code: "e2ee_no_key" } });
    return { ...o.keys, version: v };
  }

  async openNoteRaw(documentId: string, version: number): Promise<Uint8Array> {
    const o = await this.open(documentId, version);
    if (!o) throw new Error("no key");
    return o.raw.slice();
  }

  async newNoteKey(documentId: string, scope: WireScope) {
    const sk = await this.spaceKeys(scope);
    const raw = randomBytes(32);
    const wrapped = await sealRecord(sk.wrap, sk.version, aad.noteKeySpace(documentId, 1, this.scopeId, sk.version), raw, { compress: false });
    const keys = await deriveNoteKeys(raw.slice());
    this.notes.set(`${documentId}#1`, { raw, keys });
    return { keys, version: 1, wrapped, spaceVersion: sk.version };
  }

  async addNoteKeys(rows: PulledNoteKey[]): Promise<void> {
    for (const r of rows) {
      const list = (this.rows.get(r.documentId) ?? []).filter((x) => !(x.version === r.version && x.wrappedBy === r.wrappedBy));
      list.push(r);
      this.rows.set(r.documentId, list);
    }
  }

  async linkNoteKey(): Promise<void> {}

  /** What the server stored for a note (tests compare). */
  wraps(documentId: string): PulledNoteKey[] {
    return this.rows.get(documentId) ?? [];
  }
}

type As = { query(ref: unknown, args: unknown): Promise<unknown>; mutation(ref: unknown, args: unknown): Promise<unknown>; action(ref: unknown, args: unknown): Promise<unknown> };

/** convex-test's `withIdentity` client as the plain Convex client the migration calls. */
export function innerOf(as: unknown, hooks: { beforeMutation?(name: string, args: Record<string, unknown>): Promise<void> | void } = {}): InnerClient {
  const c = as as As;
  return {
    query: (ref, args) => c.query(ref, args ?? {}),
    mutation: async (ref, args) => {
      const { getFunctionName } = await import("convex/server");
      await hooks.beforeMutation?.(getFunctionName(ref), args ?? {});
      return await c.mutation(ref, args ?? {});
    },
    action: (ref, args) => c.action(ref, args ?? {}),
  };
}

export const bytes = (b: ArrayBuffer | Uint8Array) => toWireBytes(b instanceof Uint8Array ? b : new Uint8Array(b));
