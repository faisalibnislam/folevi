// @vitest-environment edge-runtime
// The feature switches on the device (docs/E2EE_DESIGN.md §7, §9.1, §11.1 WP8) against the real server in
// convex-test, with a real replica (WP7's ingest over e2ee.pull): readable copies made and dropped per switch
// and never for locked notes; reminder rows kept in step; inbox items applied once; Foli AI's per-request
// rules (off, locked, consent, the notes sent); an encrypted link opened with the key from its fragment.
import { describe, expect, test, vi } from "vitest";
import { SCHEMA_VERSION, canonicalJson, type SyncOp, type WireBlock } from "@folevi/editor-schema";
import { ctx as aad, sealTo } from "@folevi/local-store/e2ee";
import { api, internal } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { Sealer } from "@/lib/e2ee/seal";
import { runJob } from "@/lib/e2ee/migrate/runner";
import { ReplicaIngest } from "@/lib/e2ee/replica/ingest";
import { openReplicaDb, SpaceReplicaStore } from "@/lib/e2ee/replica/store";
import type { E2eeSpace, Switches } from "@/lib/e2ee/router/deps";
import type { RouterEnv } from "@/lib/e2ee/router/types";
import type { LocalProfile } from "@/lib/local/functions/shared";
import { LockIndex } from "@/lib/e2ee/features/locks";
import { syncMirrors } from "@/lib/e2ee/features/mirror";
import { syncReminders } from "@/lib/e2ee/features/reminders";
import { applyInbox, ensureInbox } from "@/lib/e2ee/features/inbox";
import { aiRoute, answerConsent, pendingConsent } from "@/lib/e2ee/features/ai";
import { createEncryptedLinkWith, openShare, publishPlainCopyWith } from "@/lib/e2ee/links";
import { carryStudy } from "@/lib/e2ee/features/study";
import { sharePayload } from "@/lib/e2ee/sharePayload";
import { convexHelpers, innerOf, TestKeyRing, type Person, type T } from "./wp8Fakes";

const { helpers, fixtures } = await convexHelpers();
const { e2eePerson, e2eeRecoveryMethods, e2eeSpace, para, PERSONAL, setup, ulid } = helpers;
const { push } = fixtures;

// The first call loads the whole backend into convex-test: slow on a busy machine.
vi.setConfig({ testTimeout: 60_000 });

const OFF: Switches = { foliAi: "off", backgroundAi: false, searchEverywhere: false, apps: false, emailToNote: false, webClipper: false, notificationPreviews: false };

async function plainNote(p: Person, title: string, blocks: WireBlock[]) {
  const id = ulid();
  await push(p, [{ opId: ulid(), kind: "document.create", document: { id, parentDocumentId: null, folderId: null, kind: "document", title, icon: null } }]);
  await push(p, blocks.map((b) => ({ opId: ulid(), kind: "block.upsert" as const, documentId: id, block: b, baseRevision: null, fields: ["content" as const, "position" as const] })));
  return id;
}

/** An encrypted Personal at "features you pick" with its notes sealed, and this device's replica of it. */
async function world(t: T, email: string, switches: Partial<Switches>, seed: (p: Person) => Promise<Record<string, string>>) {
  const p = await e2eePerson(t, email);
  await e2eeRecoveryMethods(p);
  const s = await e2eeSpace(p, PERSONAL);
  const keyring = new TestKeyRing(new Map([[1, s.sk]]), s.scopeId);
  const ids = await seed(p);
  const sw = { ...OFF, foliAi: "ask" as const, ...switches };
  const { migrationId } = await p.as.mutation(api.e2ee.spaces.enable, { scope: PERSONAL, level: "selected", switches: sw });
  const sealer = new Sealer(keyring);
  const server = innerOf(p.as);
  expect(await runJob({ server, sealer, keyring, deviceId: "device-wp8-feat-01", space: { scope: PERSONAL, scopeId: s.scopeId } }, { id: migrationId!, direction: "seal", scopeOf: "space", rootId: null })).toBe("done");
  const me = (await p.as.query(api.users.me, {})) as { profile: LocalProfile & { avatarUrl?: unknown; entitlements?: unknown } };
  const { avatarUrl: _a, entitlements: _e, ...profile } = me.profile;
  void _a;
  void _e;
  const store = new SpaceReplicaStore(await openReplicaDb(s.scopeId, false));
  await store.load();
  const ingest = new ReplicaIngest({ store, sealer, keyring, scope: PERSONAL, scopeId: s.scopeId, profile: profile as LocalProfile });
  await ingest.ensureProfile();
  let cursor = 0;
  const pull = async () => {
    for (let i = 0; i < 50; i++) {
      const page = (await p.as.query(api.e2ee.pull.pull, { scope: PERSONAL, cursor, limit: 500 })) as never as Parameters<ReplicaIngest["page"]>[0];
      await ingest.page(page);
      cursor = page.nextCursor;
      if (!page.hasMore) break;
    }
  };
  await pull();
  const spaceRow = async (): Promise<E2eeSpace> => {
    const mine = (await p.as.query(api.e2ee.spaces.mine, {})) as { scope: E2eeSpace["scope"]; scopeId: string; level: E2eeSpace["level"]; state: E2eeSpace["state"]; switches: Switches; currentKeyVersion: number; lockedCount: number }[];
    const r = mine.find((m) => m.scope.kind === "personal")!;
    return { scope: PERSONAL, scopeId: r.scopeId, level: r.level, state: r.state, switches: r.switches, currentKeyVersion: r.currentKeyVersion, lockedCount: r.lockedCount };
  };
  /** Sends sync ops the way the router's transport does (§6.6), sealed. */
  const send = async (ops: SyncOp[]) => {
    const wire: SyncOp[] = [];
    for (const op of ops) {
      if (op.kind === "block.upsert") wire.push({ ...op, block: (await sealer.sealBlock(op.documentId, op.block)) as never });
      else if (op.kind === "document.create") {
        const d = op.document;
        const nk = await keyring.newNoteKey(d.id, PERSONAL);
        const title = await sealer.sealTitle(d.id, d.title ?? "");
        const appearance = await sealer.sealAppearance(d.id, { icon: d.icon ?? null });
        wire.push({ ...op, document: { ...d, title: "", icon: null, sealed: { title: title.c, titleMac: title.mac, appearance, noteKey: { v: 1, spaceVersion: nk.spaceVersion, wrapped: nk.wrapped.buffer.slice(0) } } } as never });
      } else wire.push(op);
    }
    const results = (await p.as.mutation(api.sync.push, { scope: PERSONAL, deviceId: "device-wp8-feat-01", ops: wire as never })) as { status: string; error?: { code: string } }[];
    for (const r of results) if (r.status !== "applied" && r.status !== "duplicate") throw Object.assign(new Error("refused"), { data: { code: r.error?.code ?? r.status } });
    await pull();
  };
  return { p, s, keyring, sealer, server, store, ids, pull, spaceRow, send, profileId: p.profileId };
}

const CARD = ulid();

/**
 * One space for the whole file (setting a person up and sealing their starter notes is the slow part): every
 * test adds what it needs and looks only at its own notes.
 */
let sharedWorld: Promise<{ t: T; w: Awaited<ReturnType<typeof world>> }> | null = null;
function shared() {
  sharedWorld ??= (async () => {
    const t: T = setup();
    const w = await world(t, "wp8-features@example.com", { searchEverywhere: true, apps: true, emailToNote: true }, async (p) => ({
      open: await plainNote(p, "ZQXJ-TITLE-open", [para(ulid(), "ZQXJ-BODY-open"), todo("ZQXJ-TASK-open", { dueDate: "2026-11-02" })]),
      locked: await plainNote(p, "ZQXJ-TITLE-locked", [para(ulid(), "ZQXJ-BODY-locked")]),
      ai: await plainNote(p, "ZQXJ-TITLE-ai", [para(ulid(), "ZQXJ-BODY-ai")]),
      link: await plainNote(p, "ZQXJ-TITLE-link", [para(ulid(), "ZQXJ-BODY-link")]),
      pub: await plainNote(p, "ZQXJ-TITLE-pub", [para(ulid(), "ZQXJ-BODY-pub")]),
      cards: await plainNote(p, "Cards", [{ id: CARD, type: "toggle", parentId: null, rank: "V", schemaVersion: SCHEMA_VERSION, text: [{ type: "text", text: "Q" }], props: { collapsed: false, study: "card" } }]),
    }));
    return { t, w };
  })();
  return sharedWorld;
}

const todo = (text: string, props: Record<string, unknown> = {}): WireBlock => ({ id: ulid(), type: "todo", parentId: null, rank: "W", schemaVersion: SCHEMA_VERSION, text: [{ type: "text", text }], props: { checked: false, ...props } });

async function mirrorRows(t: T) {
  return await t.run(async (ctx) => await ctx.db.query("e2eeMirrors").collect());
}

describe("readable copies (features/mirror.ts)", () => {
  test("made for each switch that's on, never for a locked note, only uploaded when changed, gone when the switch goes off", async () => {
    const { t, w } = await shared();
    await w.p.as.mutation(api.e2ee.content.setDocumentLocked, { documentId: w.ids.locked!, locked: true });
    let space = await w.spaceRow();
    expect(space.lockedCount).toBe(1);
    const locks = new LockIndex(w.server, () => space);
    const deps = () => ({ server: w.server, space, store: w.store, locks, isSealed: () => true });

    const search = await syncMirrors(deps(), "search");
    const apps = await syncMirrors(deps(), "apps");
    expect(await syncMirrors(deps(), "ai")).toEqual({ put: 0, removed: 0 }); // Background Foli AI is off
    expect(search.put).toBeGreaterThanOrEqual(1);
    expect(apps.put).toBe(search.put);
    const rows = await mirrorRows(t);
    const lockedRow = await t.run(async (ctx) => (await ctx.db.query("documents").withIndex("by_public_id", (q) => q.eq("publicId", w.ids.locked!)).unique())!);
    expect(rows.some((r) => r.documentId === lockedRow._id)).toBe(false);
    expect(JSON.stringify(rows)).not.toContain("ZQXJ-BODY-locked");
    const openSearch = rows.find((r) => r.purpose === "search" && r.title === "ZQXJ-TITLE-open")!;
    expect(openSearch.text).toContain("ZQXJ-BODY-open");
    const openApps = rows.find((r) => r.purpose === "apps" && r.title === "ZQXJ-TITLE-open")!;
    expect(openApps.tasks).toEqual([expect.objectContaining({ text: "ZQXJ-TASK-open", done: false, due: "2026-11-02" })]);

    // Nothing changed: nothing uploaded.
    expect(await syncMirrors(deps(), "search")).toEqual({ put: 0, removed: 0 });

    // The switch goes off: the device stops, the server's purge deletes the copies.
    await w.p.as.mutation(api.e2ee.spaces.setSwitches, { scope: PERSONAL, switches: { ...space.switches, searchEverywhere: false } });
    space = await w.spaceRow();
    expect(await syncMirrors(deps(), "search")).toEqual({ put: 0, removed: 0 });
    await t.mutation(internal.e2ee.mirrors.purge, { scope: { kind: "personal", profileId: w.profileId as Id<"profiles"> }, purpose: "search" });
    const left = await mirrorRows(t);
    expect(left.filter((r) => r.purpose === "search")).toHaveLength(0);
    expect(left.filter((r) => r.purpose === "apps").length).toBeGreaterThanOrEqual(1);
  });
});

describe("reminders (features/reminders.ts)", () => {
  test("an open to-do with a reminder gets its row; checking it off removes the row", async () => {
    const { t, w } = await shared();
    const at = Date.now() + 3_600_000;
    const space = await w.spaceRow();
    const locks = new LockIndex(w.server, () => space);
    const docId = ulid();
    const task = todo("Call the bank", { reminderAt: at });
    await w.send([{ opId: ulid(), kind: "document.create", document: { id: docId, parentDocumentId: null, folderId: null, kind: "document", title: "Errands", icon: null, scope: PERSONAL } }, { opId: ulid(), kind: "block.upsert", documentId: docId, block: task, baseRevision: null, fields: ["content", "position"] }]);
    const sent = new Map<string, string>();
    const deps = { server: w.server, space, store: w.store, locks, profileId: w.profileId, isSealed: () => true, sent };
    expect((await syncReminders(deps)).put).toBe(1);
    let rows = await t.run(async (ctx) => await ctx.db.query("e2eeReminders").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]!.remindAt).toBe(at);
    expect(rows[0]!.preview).toBeUndefined(); // previews are off
    expect((await syncReminders(deps)).put).toBe(0);
    const revision = (await w.store.get("blocks", task.id, docId))!.revision;
    await w.send([{ opId: ulid(), kind: "block.upsert", documentId: docId, block: { ...task, props: { ...task.props, checked: true } }, baseRevision: revision, fields: ["content"] }]);
    expect((await syncReminders(deps)).removed).toBe(1);
    rows = await t.run(async (ctx) => await ctx.db.query("e2eeReminders").collect());
    expect(rows).toHaveLength(0);
  });
});

describe("the inbox (features/inbox.ts)", () => {
  test("an email sealed to the space is opened, made into a sealed note under the Inbox, and applied once", async () => {
    const { t, w } = await shared();
    const space = await w.spaceRow();
    const noteId = ulid();
    const itemId = `email-${ulid()}`;
    const payload = { kind: "email", subject: "ZQXJ-SUBJECT", from: { address: "a@example.com", name: "A" }, receivedAt: Date.now(), blocks: [para(ulid(), "ZQXJ-MAIL-BODY")], attachments: [], documentId: noteId };
    await t.run(async (ctx) => {
      const sk = await ctx.db.query("e2eeSpaceKeys").first();
      const sealed = await sealTo(new Uint8Array(sk!.inboxPub), aad.inbox(w.s.scopeId, itemId), new TextEncoder().encode(canonicalJson(payload)));
      await ctx.db.insert("e2eeInbox", { ownerProfileId: w.profileId as Id<"profiles">, publicId: itemId, scopeKey: `p:${w.profileId}`, keyVersion: 1, kind: "email", sealed: sealed.buffer.slice(sealed.byteOffset, sealed.byteOffset + sealed.byteLength) as ArrayBuffer, size: sealed.byteLength, targetDocumentId: noteId, status: "waiting", appliedBy: w.profileId as Id<"profiles">, receivedAt: Date.now(), expiresAt: Date.now() + 86_400_000 } as never);
    });
    const deps = { server: w.server, keyring: w.keyring, space, store: w.store, profileId: w.profileId, send: (ops: SyncOp[]) => w.send(ops) };
    expect(await applyInbox(deps)).toBe(1);
    expect(await applyInbox(deps)).toBe(0);
    const item = await t.run(async (ctx) => (await ctx.db.query("e2eeInbox").withIndex("by_public_id", (q) => q.eq("publicId", itemId)).unique())!);
    expect(item.status).toBe("applied");
    const doc = (await w.store.get("documents", noteId))!;
    expect(doc.title).toBe("ZQXJ-SUBJECT");
    const inboxId = await ensureInbox(deps);
    expect(doc.parentDocumentId).toBe(inboxId);
    const spaceRow = await t.run(async (ctx) => (await ctx.db.query("e2eeSpaces").first())!);
    expect(spaceRow.inboxDocumentId).toBeDefined();
    // Nothing readable reached the server.
    const docs = await t.run(async (ctx) => await ctx.db.query("documents").collect());
    expect(JSON.stringify(docs)).not.toContain("ZQXJ-SUBJECT");
  });
});

describe("Foli AI per request (features/ai.ts)", () => {
  async function aiWorld(foliAi: Switches["foliAi"]) {
    const { w } = await shared();
    const row = await w.spaceRow();
    const space: E2eeSpace = { ...row, switches: { ...row.switches, foliAi } };
    const sent: { name: string; args: Record<string, unknown> }[] = [];
    const env = {
      inner: {
        query: w.server.query,
        mutation: w.server.mutation,
        action: async (ref: unknown, args: Record<string, unknown>) => {
          const { getFunctionName } = await import("convex/server");
          sent.push({ name: getFunctionName(ref as never), args });
          return { text: "ok" };
        },
      },
      replicas: { hostedStore: () => w.store, get: () => null, status: () => ({ state: "ready", have: 1, total: 1 }) },
      spaces: { get: () => space, label: () => ({ title: "ZQXJ-TITLE-ai", icon: null }) },
      call: async () => undefined,
    } as unknown as RouterEnv;
    const call = (name: string, args: Record<string, unknown>, sealed = true) => ({ name, kind: "action" as const, args, res: { active: true, space, sealed, documentId: (args.documentId as string) ?? null } as never });
    return { w, space, env, sent, call };
  }

  test("asks first, sends the note's Markdown with consent, and sends nothing on Don't send", async () => {
    const { w, env, sent, call } = await aiWorld("ask");
    const forward = async () => {
      throw new Error("never forwarded plain");
    };
    const write = aiRoute(call("ai:write", { scope: PERSONAL, task: "summarize", documentId: w.ids.ai }), env, forward);
    await new Promise((r) => setTimeout(r, 50));
    expect(pendingConsent()?.notes.map((n) => n.title)).toEqual(["ZQXJ-TITLE-ai"]);
    answerConsent(true);
    await write;
    expect(sent).toHaveLength(1);
    const provided = sent[0]!.args.provided as { notes: { id: string; markdown: string }[]; consent: string; ephemeral: boolean };
    expect(provided.consent).toBe("asked");
    expect(provided.ephemeral).toBe(true);
    expect(provided.notes[0]!.markdown).toContain("ZQXJ-BODY-ai");

    const declined = aiRoute(call("ai:write", { scope: PERSONAL, task: "summarize", documentId: w.ids.ai }), env, forward);
    await new Promise((r) => setTimeout(r, 50));
    answerConsent(false);
    await expect(declined).rejects.toMatchObject({ data: { code: "e2ee_consent_declined" } });
    expect(sent).toHaveLength(1);
  });

  test("automatic: no question; off: refused before anything is gathered; a locked note in a Standard space: refused", async () => {
    const auto = await aiWorld("auto");
    await aiRoute(auto.call("ai:ask", { scope: PERSONAL, question: "ZQXJ-BODY-ai", documentId: auto.w.ids.ai }), auto.env, async () => null);
    expect((auto.sent[0]!.args.provided as { consent: string }).consent).toBe("auto");
    const offSpace: E2eeSpace = { ...auto.space, switches: { ...auto.space.switches, foliAi: "off" } };
    await expect(aiRoute({ ...auto.call("ai:write", { scope: PERSONAL }), res: { active: true, space: offSpace, sealed: true, documentId: null } as never }, auto.env, async () => null)).rejects.toMatchObject({ data: { code: "e2ee_switch_off" } });
    const standard: E2eeSpace = { ...auto.space, level: "standard", lockedCount: 1 };
    await expect(aiRoute({ ...auto.call("ai:write", { scope: PERSONAL, documentId: auto.w.ids.ai }), res: { active: true, space: standard, sealed: true, documentId: auto.w.ids.ai } as never }, auto.env, async () => null)).rejects.toMatchObject({ data: { code: "e2ee_locked" } });
    // Stored chats aren't for encrypted spaces: told why, nothing sent.
    await expect(aiRoute(auto.call("aiChat:send", { scope: PERSONAL, conversationId: "x", text: "hi" }), auto.env, async () => null)).rejects.toMatchObject({ data: { code: "e2ee_unavailable" } });
    expect(auto.sent).toHaveLength(1);
  });
});

describe("encrypted links (links.ts)", () => {
  test("a link opens the note with the key in its fragment; without it, or with a wrong one, it doesn't", async () => {
    const { t, w } = await shared();
    const space = await w.spaceRow();
    const router = {
      env: { inner: w.server, keyring: w.keyring, sealer: w.sealer },
      spaces: { document: () => ({ scope: "personal", sealed: true }), get: () => space },
      replicas: { hostedStore: () => w.store },
    } as never;
    await w.keyring.noteKeys(w.ids.link!).catch(async () => {
      const rows = (await w.p.as.query(api.e2ee.grants.myNoteKeys, { documentIds: [w.ids.link!] })) as never[];
      await w.keyring.addNoteKeys((rows as { documentId: string; version: number; wrappedBy: "space"; spaceVersion: number; wrapped: ArrayBuffer }[]).map((r) => ({ ...r, scope: PERSONAL })));
    });
    const { url } = await createEncryptedLinkWith(router, w.ids.link!);
    const token = url.split("/s/")[1]!.split("#")[0]!;
    const hash = `#${url.split("#")[1]}`;
    const opened = (await t.mutation(api.sharing.openPublicLink, { token, serverSecret: "a".repeat(64), clientKey: "test" } as never)) as { status: string; e2ee?: unknown; document: { title: string } };
    expect(opened.status).toBe("ok");
    expect(opened.document.title).toBe("");
    expect(JSON.stringify(opened)).not.toContain("ZQXJ-BODY-link");
    const payload = sharePayload(opened.e2ee);
    const r = await openShare(payload, hash, { createUrl: () => "blob:test" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.share.title).toBe("ZQXJ-TITLE-link");
      expect(r.share.blocks.map((b) => (b.text as { text?: string }[]).map((n) => n.text).join(""))).toContain("ZQXJ-BODY-link");
    }
    expect(await openShare(payload, "")).toEqual({ ok: false, reason: "missing_key" });
    expect(await openShare(payload, `#k=${"A".repeat(43)}`)).toEqual({ ok: false, reason: "wrong_key" });
  });
});

describe("published copies (links.ts)", () => {
  test("a copy keeps its images as plain files of its own; the note's own files stay sealed", async () => {
    const { t, w } = await shared();
    const space = await w.spaceRow();
    const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
    const sealedId = ulid();
    const image: WireBlock = { id: ulid(), type: "image", parentId: null, rank: "Y", schemaVersion: SCHEMA_VERSION, text: [], props: { fileId: sealedId, alt: "", caption: "" } };
    await w.send([{ opId: ulid(), kind: "block.upsert", documentId: w.ids.pub!, block: image, baseRevision: null, fields: ["content", "position"] }]);
    const router = {
      env: {
        inner: { ...w.server, query: async (ref: unknown, args: Record<string, unknown>) => ((await import("convex/server")).getFunctionName(ref as never) === "files:urls" ? { [sealedId]: { url: "https://files.test/x", sealed: { key: new ArrayBuffer(0), meta: new ArrayBuffer(0), k: 1, plainSize: png.length } } } : w.server.query(ref as never, args)) },
        keyring: w.keyring,
        sealer: w.sealer,
        files: { bytes: async () => ({ bytes: png.slice(), meta: { name: "dot.png", mime: "image/png", width: 1, height: 1, sha256: "" } }) },
      },
      spaces: { document: () => ({ scope: "personal", sealed: true }), get: () => space },
      replicas: { hostedStore: () => w.store },
    } as never;
    const uploads: number[] = [];
    const fetcher = (async (_url: string, init?: { body?: Uint8Array }) => {
      const body = init!.body!;
      uploads.push(body.length);
      const storageId = await t.run(async (ctx) => await ctx.storage.store(new Blob([body as Uint8Array<ArrayBuffer>], { type: "image/png" })));
      return new Response(JSON.stringify({ storageId }), { status: 200 });
    }) as unknown as typeof fetch;
    const { linkId } = await publishPlainCopyWith(router, w.ids.pub!, { fetch: fetcher });
    expect(uploads).toEqual([png.length]);
    const copy = await t.run(async (ctx) => {
      const link = (await ctx.db.query("publicLinks").withIndex("by_public_id", (q) => q.eq("publicId", linkId)).unique())!;
      const row = (await ctx.db.query("e2eePublishedCopies").withIndex("by_link", (q) => q.eq("linkId", link._id)).unique())!;
      const chunks = await ctx.db.query("e2eePublishedChunks").withIndex("by_copy", (q) => q.eq("copyId", row._id)).collect();
      return { row, body: JSON.parse(chunks.map((c) => c.data).join("")) as { blocks: WireBlock[]; fileIds: string[] } };
    });
    expect(copy.row.title).toBe("ZQXJ-TITLE-pub");
    expect(copy.body.fileIds).toHaveLength(1);
    const shown = copy.body.blocks.find((b) => b.type === "image")!;
    expect((shown.props as { fileId: string }).fileId).toBe(copy.body.fileIds[0]);
    expect((shown.props as { fileId: string }).fileId).not.toBe(sealedId);
    const plainFile = await t.run(async (ctx) => (await ctx.db.query("files").withIndex("by_public_id", (q) => q.eq("publicId", copy.body.fileIds[0]!)).unique())!);
    expect(plainFile.sealed).toBeUndefined();
    expect(plainFile.publishedCopy).toBe(true);
  });
});

describe("study schedules (features/study.ts)", () => {
  test("a reader's schedules left on the server for a sealed note move into their own sealed record", async () => {
    const { t, w } = await shared();
    const cardId = CARD;
    const space = await w.spaceRow();
    await t.run(async (ctx) => {
      const doc = (await ctx.db.query("documents").withIndex("by_public_id", (q) => q.eq("publicId", w.ids.cards!)).unique())!;
      await ctx.db.insert("studyReviews", { profileId: w.profileId as Id<"profiles">, documentId: doc._id, blockId: cardId, due: Date.now(), stability: 1, difficulty: 5, elapsedDays: 0, scheduledDays: 1, learningSteps: 0, reps: 1, lapses: 0, state: 1, firstReview: Date.now() } as never);
    });
    const done = new Set<string>();
    expect(await carryStudy({ server: w.server, sealer: w.sealer, space, store: w.store, isSealed: () => true, done })).toBe(1);
    const left = await t.run(async (ctx) => ({ rows: await ctx.db.query("studyReviews").collect(), records: (await ctx.db.query("e2eeRecords").collect()).filter((r) => r.kind === "studyReview") }));
    expect(left.rows).toHaveLength(0);
    expect(left.records).toHaveLength(1);
    expect(left.records[0]!.recordId).toBe(cardId);
    // Nothing more to carry this session.
    expect(await carryStudy({ server: w.server, sealer: w.sealer, space, store: w.store, isSealed: () => true, done })).toBe(0);
  });
});

describe("startFeatureWorkers", () => {
  test("hands the router WP8's Foli AI route, and takes it back when stopped", async () => {
    const { setActiveRouter } = await import("@/lib/e2ee/router/active");
    const { startFeatureWorkers } = await import("@/lib/e2ee/features");
    const set: unknown[] = [];
    const router = {
      setAiRouter: (r: unknown) => set.push(r),
      onRoutesChanged: () => () => undefined,
      env: { session: { subscribe: () => () => undefined, state: () => "unlocked" } },
      spaces: { list: () => [] },
    };
    setActiveRouter(router as never);
    const stop = startFeatureWorkers();
    expect(set).toEqual([aiRoute]);
    stop();
    expect(set).toEqual([aiRoute, null]);
    setActiveRouter(null);
  });
});
