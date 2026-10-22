// End-to-end encryption for the parity harness (docs/E2EE_DESIGN.md §11.3, WP7): the router client over
// convex-test, signed in as a fresh person whose Personal is Fully encrypted, with an unlocked key session and
// a replica. Every scenario runs through it and must normalize to the same results as plain Convex: the
// router seals what goes out, opens what comes back, and answers lists, searches and tasks from the replica.
//
// The space is set up as WP3's tests do (tests/convex/e2ee-fixtures.ts encryptedSpace: the space row and
// space key version 1); the key ring here holds that space key and the note keys it makes or pulls.
import { getFunctionName, type FunctionReference } from "convex/server";
import { ctx as aad, deriveNoteKeys, openRecord, randomBytes, sealRecord, type NoteKeys, type SpaceKeys } from "@folevi/local-store/e2ee";
import type { WireScope } from "@folevi/editor-schema";
import { person, setup, type T } from "../../convex/helpers";
import { encryptedSpace } from "../../convex/e2ee-fixtures";
import { api } from "../../../convex/_generated/api";
import { E2eeRouterClient } from "../../../apps/web/src/lib/e2ee/router/client";
import { uploadSealedWith } from "../../../apps/web/src/lib/e2ee/files";
import type { KeyRingLike, KeySessionLike, LockState, PulledNoteKey } from "../../../apps/web/src/lib/e2ee/router/deps";
import type { ParityBackend, UploadInput } from "../types";
import { PARITY_DEVICE, PARITY_EMAIL } from "./convexDriver";

type Caller = Awaited<ReturnType<typeof person>>["as"];
type AnyRef = FunctionReference<"query" | "mutation" | "action">;
const PERSONAL: WireScope = { kind: "personal" };

/** The person's key ring: the Personal space key, and note keys made here or pulled. */
class ParityKeyRing implements KeyRingLike {
  private notes = new Map<string, NoteKeys & { version: number }>();
  private rows = new Map<string, PulledNoteKey[]>();
  constructor(
    private readonly space: SpaceKeys,
    private readonly scopeId: string,
  ) {}
  async spaceKeys(): Promise<SpaceKeys & { version: number }> {
    return { ...this.space, version: 1 };
  }
  async noteKeys(documentId: string, version?: number): Promise<NoteKeys & { version: number }> {
    const rows = this.rows.get(documentId) ?? [];
    const v = version ?? Math.max(0, ...rows.map((r) => r.version));
    const hit = this.notes.get(`${documentId}#${v}`);
    if (hit) return hit;
    const row = rows.find((r) => r.version === v && r.wrappedBy === "space");
    if (!row) throw new Error("You don't have the key to this note.");
    const raw = await openRecord(this.space.wrap, aad.noteKeySpace(documentId, v, this.scopeId, row.spaceVersion ?? 1), new Uint8Array(row.wrapped));
    const keys = { ...(await deriveNoteKeys(raw)), version: v };
    this.notes.set(`${documentId}#${v}`, keys);
    return keys;
  }
  async newNoteKey(documentId: string) {
    const nk = randomBytes(32);
    const wrapped = await sealRecord(this.space.wrap, 1, aad.noteKeySpace(documentId, 1, this.scopeId, 1), nk);
    const keys = await deriveNoteKeys(nk.slice());
    nk.fill(0);
    this.notes.set(`${documentId}#1`, { ...keys, version: 1 });
    this.rows.set(documentId, [{ documentId, version: 1, wrappedBy: "space", spaceVersion: 1, wrapped: wrapped.slice().buffer as ArrayBuffer }]);
    return { keys, version: 1, wrapped, spaceVersion: 1 };
  }
  async addNoteKeys(rows: PulledNoteKey[]): Promise<void> {
    for (const r of rows) this.rows.set(r.documentId, [...(this.rows.get(r.documentId) ?? []).filter((x) => x.version !== r.version || x.wrappedBy !== r.wrappedBy), r]);
  }
  async linkNoteKey(): Promise<void> {}
}

class UnlockedSession implements KeySessionLike {
  state(): LockState {
    return "unlocked";
  }
  subscribe(): () => void {
    return () => {};
  }
  accountKeys(): never {
    throw new Error("not needed by the data side");
  }
  deviceId(): string {
    return PARITY_DEVICE;
  }
}

interface Watched {
  ref: FunctionReference<"query">;
  args: Record<string, unknown>;
  value?: unknown;
  error?: unknown;
  cbs: Set<() => void>;
}

/** convex-test's caller as the ConvexReactClient the router wraps: watches re-run after every write. */
class TestInner {
  private watched = new Map<string, Watched>();
  constructor(private readonly as: Caller) {}

  private async refresh(w: Watched) {
    try {
      w.value = await (this.as.query as (r: unknown, a: unknown) => Promise<unknown>)(w.ref, w.args);
      w.error = undefined;
    } catch (e) {
      w.error = e;
    }
    for (const cb of [...w.cbs]) cb();
  }

  async refreshAll() {
    await Promise.all([...this.watched.values()].filter((w) => w.cbs.size).map((w) => this.refresh(w)));
  }

  watchQuery = (ref: FunctionReference<"query">, args: Record<string, unknown> = {}) => {
    const key = `${getFunctionName(ref)}|${JSON.stringify(args)}`;
    let w = this.watched.get(key);
    if (!w) this.watched.set(key, (w = { ref, args, cbs: new Set() }));
    const entry = w;
    return {
      onUpdate: (cb: () => void) => {
        entry.cbs.add(cb);
        if (entry.cbs.size === 1) void this.refresh(entry);
        return () => entry.cbs.delete(cb);
      },
      localQueryResult: () => {
        if (entry.error) throw entry.error;
        return entry.value;
      },
      journal: () => undefined,
      localQueryLogs: () => undefined,
    };
  };
  query = async (ref: FunctionReference<"query">, args: Record<string, unknown> = {}) => await (this.as.query as (r: unknown, a: unknown) => Promise<unknown>)(ref, args);
  mutation = async (ref: FunctionReference<"mutation">, args: Record<string, unknown> = {}) => {
    const r = await (this.as.mutation as (r: unknown, a: unknown) => Promise<unknown>)(ref, args);
    await this.refreshAll();
    return r;
  };
  action = async (ref: FunctionReference<"action">, args: Record<string, unknown> = {}) => {
    const r = await (this.as.action as (r: unknown, a: unknown) => Promise<unknown>)(ref, args);
    await this.refreshAll();
    return r;
  };
  connectionState = () => ({ isWebSocketConnected: true });
  subscribeToConnectionState = () => () => {};
  setAuth = () => {};
  clearAuth = () => {};
  close = async () => {};
  logger = console;
}

export class E2eeDriver implements ParityBackend {
  readonly kind = "convex" as const;
  readonly scope = { kind: "personal" } as const;
  readonly deviceId = PARITY_DEVICE;
  readonly known = new Map<string, string>();
  readonly calls = new Set<string>();

  private constructor(
    readonly t: T,
    private readonly inner: TestInner,
    readonly router: E2eeRouterClient,
    readonly profileId: string,
  ) {
    this.known.set(profileId, "<profile>");
    this.known.set(PARITY_DEVICE, "<device>");
  }

  static async open(): Promise<E2eeDriver> {
    const t = setup();
    const p = await person(t, PARITY_EMAIL);
    const space = await encryptedSpace(t, p as never, { level: "full" });
    const inner = new TestInner(p.as);
    // Signed file links (/files/<id>?exp&sig) are fetched from convex-test's HTTP routes.
    const fetchFiles = (async (input: string | URL | Request) => {
      const url = String(input instanceof Request ? input.url : input);
      const at = url.indexOf("/files/");
      return at >= 0 ? await t.fetch(url.slice(at)) : await fetch(input);
    }) as typeof fetch;
    const router = new E2eeRouterClient(inner as never, { session: new UnlockedSession(), keyring: new ParityKeyRing(space.keys, space.scope), persist: () => false, locks: null, fetch: fetchFiles });
    await router.ready();
    await router.replicas.open(PERSONAL);
    await router.replicas.get(PERSONAL)!.whenSynced();
    return new E2eeDriver(t, inner, router, p.profileId);
  }

  private note(ref: AnyRef) {
    this.calls.add(getFunctionName(ref));
  }

  /** The replica caught up with the server (writes that weren't the router's own reach it by the pull). */
  private async caughtUp() {
    await this.inner.refreshAll();
    await this.router.replicas.get(PERSONAL)?.catchUp?.();
  }

  async query<R extends FunctionReference<"query", "public">>(ref: R, args: R["_args"]): Promise<R["_returnType"]> {
    this.note(ref);
    await this.caughtUp();
    return (await this.router.query(ref, args)) as R["_returnType"];
  }

  async mutation<R extends FunctionReference<"mutation", "public">>(ref: R, args: R["_args"]): Promise<R["_returnType"]> {
    this.note(ref);
    const r = (await this.router.mutation(ref, args)) as R["_returnType"];
    await this.caughtUp();
    return r;
  }

  async action<R extends FunctionReference<"action", "public">>(ref: R, args: R["_args"]): Promise<R["_returnType"]> {
    this.note(ref);
    await this.caughtUp();
    const r = (await this.router.action(ref, args)) as R["_returnType"];
    await this.caughtUp();
    return r;
  }

  async settle() {
    await this.t.finishAllScheduledFunctions(() => undefined);
    await this.caughtUp();
    await this.router.pruneDeleted();
  }

  /** A sealed note's file goes up encrypted (e2ee.files); the POST to the upload address stores the bytes directly. */
  async upload(input: UploadInput): Promise<string> {
    const blob = new Blob([input.bytes as Uint8Array<ArrayBuffer>], { type: input.mimeType });
    if (!input.documentId || !this.router.spaces.isSealed(input.documentId)) {
      const { intentId } = (await this.inner.mutation(api.files.generateUploadUrl, { scope: this.scope, documentId: input.documentId, filename: input.filename, size: input.bytes.length, mimeType: input.mimeType, kind: input.kind })) as { intentId: string };
      const storageId = await this.t.run(async (ctx) => await ctx.storage.store(blob));
      const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", input.bytes as Uint8Array<ArrayBuffer>));
      const sha256 = [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
      return ((await this.inner.action(api.files.finalize, { intentId: intentId as never, storageId, sha256 })) as { fileId: string }).fileId;
    }
    const t = this.t;
    const fetchStub = (async (_url: string, init: { body: Uint8Array }) => {
      const storageId = await t.run(async (ctx) => await ctx.storage.store(new Blob([init.body as Uint8Array<ArrayBuffer>])));
      return new Response(JSON.stringify({ storageId }), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await uploadSealedWith({ inner: this.inner as never, sealer: this.router.sealer, fetch: fetchStub, spaces: this.router.spaces }, { documentId: input.documentId, filename: input.filename, mimeType: input.mimeType, kind: input.kind as "image" | "file" | "audio", blob });
    await this.caughtUp();
    return r.fileId;
  }

  async download(url: string): Promise<Uint8Array> {
    if (url.startsWith("blob:")) {
      const { resolveObjectURL } = await import("node:buffer");
      const blob = resolveObjectURL(url);
      if (!blob) throw new Error("not a live object url");
      return new Uint8Array(await blob.arrayBuffer());
    }
    const at = url.indexOf("/files/");
    if (at < 0) throw new Error(`not a file link: ${url}`);
    const res = await this.t.fetch(url.slice(at));
    if (!res.ok) throw new Error(`the file link answered ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }

  async close() {
    await this.router.dispose();
  }
}
