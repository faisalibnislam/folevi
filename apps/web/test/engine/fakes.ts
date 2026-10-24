// Fakes for the bridge host's tests: a client with live queries the test answers, a sync engine and an outbox
// that record what they're asked, and deps built from them.
import { getFunctionName, type FunctionReference } from "convex/server";
import { canonicalJson, sync, type SyncState, type WireScope } from "@folevi/editor-schema";
import type { EngineDeps, EngineSpace, EngineSpaceStatus } from "@/lib/engine/context";
import type { EngineClient, KeptAnswers } from "@/lib/engine/live";
import type { EngineBatch, UpdateMessage, EventMessage } from "@/lib/engine/protocol";

type Resolver = (args: Record<string, unknown>) => unknown;

export class FakeClient implements EngineClient {
  resolvers = new Map<string, Resolver>();
  watchers = new Set<{ name: string; args: Record<string, unknown>; cbs: Set<() => void> }>();
  mutations: { name: string; args: Record<string, unknown> }[] = [];
  actions: { name: string; args: Record<string, unknown> }[] = [];
  mutate: (name: string, args: Record<string, unknown>) => unknown = () => ({ done: [], skipped: 0 });
  act: (name: string, args: Record<string, unknown>) => unknown = () => null;

  /** Answers `name` (e.g. "documents:recentNotes") with `value` (a function of the args, or a value). */
  answer(name: string, value: unknown) {
    this.resolvers.set(name, typeof value === "function" ? (value as Resolver) : () => value);
    this.bump(name);
  }

  /** Tells the watchers of `name` their answer may have changed. */
  bump(name: string) {
    for (const w of this.watchers) if (w.name === name) for (const cb of [...w.cbs]) cb();
  }

  watchQuery(query: FunctionReference<"query">, args: Record<string, unknown>) {
    const name = getFunctionName(query);
    const w = { name, args, cbs: new Set<() => void>() };
    this.watchers.add(w);
    return {
      onUpdate: (cb: () => void) => {
        w.cbs.add(cb);
        return () => {
          w.cbs.delete(cb);
          if (!w.cbs.size) this.watchers.delete(w);
        };
      },
      localQueryResult: () => {
        const r = this.resolvers.get(name);
        const v = r ? r(args) : undefined;
        if (v instanceof Error) throw v;
        return v;
      },
    };
  }

  watching(name: string): number {
    return [...this.watchers].filter((w) => w.name === name).length;
  }

  async query(query: FunctionReference<"query">, args: Record<string, unknown>) {
    return this.resolvers.get(getFunctionName(query))?.(args);
  }

  async mutation(mutation: FunctionReference<"mutation">, args: Record<string, unknown>) {
    const name = getFunctionName(mutation);
    this.mutations.push({ name, args });
    return this.mutate(name, args);
  }

  async action(action: FunctionReference<"action">, args: Record<string, unknown>) {
    const name = getFunctionName(action);
    this.actions.push({ name, args });
    return this.act(name, args);
  }
}

export class FakeKept implements KeptAnswers {
  store = new Map<string, unknown>();
  writes: { name: string; args: unknown }[] = [];
  key = (name: string, args: unknown) => `${name}:${canonicalJson(args)}`;
  async read(name: string, args: unknown) {
    return this.store.get(this.key(name, args));
  }
  write(name: string, args: unknown, value: unknown) {
    this.writes.push({ name, args });
    this.store.set(this.key(name, args), value);
  }
}

export class FakeEngine {
  state: SyncState = sync.emptySyncState();
  listeners = new Set<() => void>();
  created: Record<string, unknown>[] = [];
  flushes = 0;
  subscribe(cb: () => void) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  status() {
    return this.state.pending.length ? ("saving" as const) : ("saved" as const);
  }
  createDocument(document: Record<string, unknown>) {
    this.created.push(document);
    this.state = { ...this.state, pending: [...this.state.pending, { opId: `op${this.created.length}`, kind: "document.create", document } as never] };
    for (const l of this.listeners) l();
    return String(document.id);
  }
  async persisted() {}
  scheduleFlush() {
    this.flushes++;
  }
  blocks = new Map<string, Record<string, unknown>[]>();
  upserts: { documentId: string; block: Record<string, unknown>; baseRevision: unknown }[] = [];
  documentBlocks(documentId: string) {
    return this.blocks.get(documentId) ?? [];
  }
  upsertBlock(documentId: string, block: Record<string, unknown>, _fields: string[], baseRevision?: unknown) {
    this.upserts.push({ documentId, block, baseRevision });
  }
  serverRevision() {
    return null;
  }
}

export class FakeOutbox {
  entries: { id: string; name: string; args: Record<string, unknown>; keys: string[]; label: string; createdAt: number; attempts: number; creates?: string[]; after?: unknown[] }[] = [];
  listeners = new Set<() => void>();
  authRequired = false;
  results: ((v: unknown) => void)[] = [];
  answer: (name: string, args: Record<string, unknown>) => unknown = () => ({ done: [], skipped: 0, previousFolders: {} });
  subscribe(cb: () => void) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  status() {
    return this.entries.length ? ("waiting" as const) : ("idle" as const);
  }
  enqueue(name: string, args: Record<string, unknown>, meta: { keys: string[]; label: string; creates?: string[]; after?: unknown[] }) {
    const entry = { id: `e${this.entries.length + 1}`, name, args, ...meta, createdAt: 1, attempts: 0 };
    this.entries = [...this.entries, entry];
    for (const l of this.listeners) l();
    return { id: entry.id, result: Promise.resolve(this.answer(name, args)) };
  }
  async persisted() {}
  scheduleFlush() {}
}

export const PERSONAL: EngineSpace = { id: "personal", kind: "personal", name: "Personal", role: "owner", canEdit: true, canManage: false, scope: { kind: "personal" } as WireScope };
export const STUDIO: EngineSpace = { id: "ws1", kind: "workspace", name: "Studio", role: "admin", canEdit: true, canManage: true, scope: { kind: "workspace", workspaceId: "ws1" } as WireScope };
export const VAULT: EngineSpace = { id: "ws_vault", kind: "workspace", name: "Vault", role: "owner", canEdit: true, canManage: true, scope: { kind: "workspace", workspaceId: "ws_vault" } as WireScope };

export interface Rig {
  client: FakeClient;
  kept: FakeKept;
  engine: FakeEngine;
  outbox: FakeOutbox;
  navigations: string[];
  spaceSwitches: string[];
  encrypted: Set<string>;
  locked: Set<string>;
  deps(over?: Partial<EngineDeps["app"]>): EngineDeps;
}

export function rig(place = "acct:user_1"): Rig {
  const client = new FakeClient();
  const kept = new FakeKept();
  const engine = new FakeEngine();
  const outbox = new FakeOutbox();
  const navigations: string[] = [];
  const spaceSwitches: string[] = [];
  const encrypted = new Set<string>();
  const locked = new Set<string>();
  const keyOf = (s: WireScope) => (s.kind === "personal" ? "personal" : s.workspaceId);
  const status = (s: WireScope): EngineSpaceStatus => ({ encrypted: encrypted.has(keyOf(s)), locked: locked.has(keyOf(s)), state: locked.has(keyOf(s)) ? "locked" : "ready", have: 0, total: null });
  const r: Rig = {
    client,
    kept,
    engine,
    outbox,
    navigations,
    spaceSwitches,
    encrypted,
    locked,
    deps: (over = {}) => ({
      client,
      kept,
      app: {
        place,
        mode: "account",
        accountKey: "prof_1",
        profile: { id: "prof_1", name: "Faisal", email: "f@example.com", avatarUrl: null },
        profileData: { id: "prof_1", displayName: "Faisal", email: "f@example.com", avatarUrl: null, appearance: "system", timeZone: "UTC", locale: "en", reviewAppEdits: false, aiEnabled: true, aiPrefs: { history: true, memory: false, suggestions: true, attachments: true, webResearch: true, digests: false, readImages: false, deviceText: true }, notificationPrefs: { mentions: true, comments: true, shares: true, invites: true, digest: "off", productEmail: false, inApp: { comments: false } }, entitlements: { planId: "personal_pro_month", plan: "pro", paid: true, trialing: false, trialEndsAt: null, ai: true, devices: 5 } },
        workspaceData: { ws1: { id: "ws1", name: "Studio", logoUrl: null, role: "admin", storageUsedBytes: 100, storageQuotaBytes: 1000 } },
        spaces: [PERSONAL, STUDIO, VAULT],
        space: "personal",
        online: true,
        today: "2026-10-24",
        timeZone: "UTC",
        appearance: "system",
        capabilities: { graph: true, sharing: true, changes: true, workspaces: true, ai: true, purchases: false },
        engine: engine as never,
        outbox: outbox as never,
        places: { current: place, places: [] },
        ...over,
      },
      persist: (s) => !encrypted.has(keyOf(s)),
      spaceStatus: status,
      e2eeSignal: { subscribe: () => () => undefined },
      navigate: (path) => navigations.push(path),
      setSpace: (space) => spaceSwitches.push(space),
    }),
  };
  return r;
}

/** Collects what the host posts, decoded. */
export class Posts {
  batches: EngineBatch[] = [];
  raw: string[] = [];
  post = (json: string) => {
    this.raw.push(json);
    const v = JSON.parse(json) as EngineBatch | { bodyId: string };
    if (Array.isArray(v)) this.batches.push(v);
  };
  all(): (UpdateMessage | EventMessage)[] {
    return this.batches.flat();
  }
  updates(sub: string): UpdateMessage[] {
    return this.all().filter((m): m is UpdateMessage => m.kind === "update" && m.sub === sub);
  }
  events(name: string): EventMessage[] {
    return this.all().filter((m): m is EventMessage => m.kind === "event" && m.name === name);
  }
  clear() {
    this.batches = [];
    this.raw = [];
  }
}

/** A documents.list / recentNotes summary. */
export function summary(i: number, over: Record<string, unknown> = {}) {
  return {
    id: `doc_${i}`,
    title: `Note ${i}`,
    icon: null,
    kind: "document",
    excerpt: `Text ${i}`,
    preview: [{ t: "paragraph", x: `Text ${i}` }],
    cover: { kind: "none" },
    style: { font: "modern", width: "normal", background: "paper", accent: "ember", card: "plain" },
    starred: false,
    createdAt: 1_700_000_000_000 + i,
    updatedAt: 1_700_000_100_000 - i,
    folderId: null,
    parentDocumentId: null,
    archivedAt: null,
    deletedAt: null,
    homeFolder: null,
    tags: [],
    ...over,
  };
}

/** documents.list over `docs`, paginated by offset the way the server pages its small views. */
export function pagedList(docs: () => ReturnType<typeof summary>[]) {
  return (args: Record<string, unknown>) => {
    const p = args.paginationOpts as { numItems: number; cursor: string | null };
    const start = p.cursor ? Number(p.cursor) : 0;
    const all = docs();
    const page = all.slice(start, start + p.numItems);
    return { page, isDone: start + page.length >= all.length, continueCursor: String(start + page.length) };
  };
}
