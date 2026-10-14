// Outbound webhooks (convex/webhooks.ts, lib/webhooks.ts): adding endpoints (https only, never private
// addresses), events from notes, tasks and comments (minimal payloads, only what the owner can read, edits
// folded into one note.updated a minute), signed deliveries, retries with backoff, turning a failing endpoint
// off, the delivery log and test events. The network is stubbed: DNS answers and the endpoint's replies.
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { retryDelay, RETRY_DELAYS_MS, signature } from "../../convex/lib/webhooks";
import { join, para, person, PERSONAL, setup, teamWorkspace, ulid, type T } from "./helpers";

type Person = Awaited<ReturnType<typeof person>>;

const NOW = Date.parse("2026-10-14T12:00:00Z");
const HOOK = "https://hooks.example.com/folevi";

interface Sent {
  url: string;
  at: number;
  headers: Headers;
  body: string;
}

/** A stubbed network: DNS answers from `dns`, and the endpoint answers with `reply` (a status, or a function of the attempt). */
function network(dns: Record<string, string>, reply: number | ((n: number) => number | Response) = 200) {
  const sent: Sent[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("https://dns.google/resolve")) {
        const u = new URL(url);
        const ip = dns[u.searchParams.get("name") ?? ""];
        const type = u.searchParams.get("type");
        const answer = ip && (type === "A") === !ip.includes(":") ? [{ type: type === "A" ? 1 : 28, data: ip }] : [];
        return new Response(JSON.stringify({ Status: 0, Answer: answer }), { status: 200 });
      }
      if (!url.startsWith("https://hooks.") && !url.startsWith("https://evil.")) return new Response("not found", { status: 404 });
      sent.push({ url, at: Date.now(), headers: new Headers(init?.headers), body: String(init?.body ?? "") });
      const r = typeof reply === "function" ? reply(sent.length) : reply;
      return r instanceof Response ? r : new Response("ok", { status: r });
    }),
  );
  return sent;
}

const PUBLIC_DNS = { "hooks.example.com": "93.184.216.34" };

async function settle(t: T) {
  await t.finishAllScheduledFunctions(vi.runAllTimers);
}

async function hook(who: Person, opts: { url?: string; events?: string[]; personal?: boolean; workspaceIds?: string[] } = {}) {
  return await who.as.mutation(api.webhooks.create, {
    url: opts.url ?? HOOK,
    events: opts.events ?? ["note.created", "note.updated", "note.deleted", "task.created", "task.completed", "comment.created"],
    personal: opts.personal ?? true,
    workspaceIds: opts.workspaceIds ?? [],
  });
}

async function note(who: Person, title: string, lines: string[], scope = PERSONAL as Person["scope"]) {
  const id = ulid();
  await who.as.mutation(api.sync.push, {
    scope,
    deviceId: "device-hooks",
    ops: [
      { opId: ulid(), kind: "document.create", document: { id, parentDocumentId: null, folderId: null, kind: "document", title, icon: null } },
      ...lines.map((text, i) => ({ opId: ulid(), kind: "block.upsert", documentId: id, block: para(ulid(), text, String.fromCharCode(80 + i)), baseRevision: null, fields: ["content", "position"] })),
    ] as never,
  });
  return id;
}

async function edit(who: Person, documentId: string, text: string) {
  await who.as.mutation(api.sync.push, {
    scope: PERSONAL,
    deviceId: "device-hooks",
    ops: [{ opId: ulid(), kind: "block.upsert", documentId, block: para(ulid(), text, "z"), baseRevision: null, fields: ["content", "position"] }] as never,
  });
}

const payloads = (sent: Sent[]) => sent.map((s) => JSON.parse(s.body) as { id: string; type: string; createdAt: string; place: { id: string; name: string } | null; data: Record<string, unknown> });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("adding endpoints", () => {
  test("https only, never a private or local address, up to five; the secret is shown once and kept sealed", async () => {
    const t = setup();
    const a = await person(t, "hooks-add@example.com");
    for (const url of ["http://hooks.example.com/x", "https://localhost/x", "https://127.0.0.1/x", "https://10.1.2.3/x", "https://169.254.169.254/latest", "https://[::1]/x", "https://printer.local/x", "https://user:pw@hooks.example.com/x", "https://hooks.example.com:8443/x", "not a url"]) {
      await expect(hook(a, { url }), url).rejects.toThrow();
    }
    await expect(hook(a, { events: [] })).rejects.toThrow(/at least one event/);
    await expect(hook(a, { events: ["note.exploded"] })).rejects.toThrow(/at least one event/);
    await expect(hook(a, { personal: false })).rejects.toThrow(/at least one place/);

    const { secret } = await hook(a);
    expect(secret).toMatch(/^whsec_[A-Za-z0-9_-]{32}$/);
    const rows = await t.run(async (ctx) => ctx.db.query("webhooks").collect());
    expect(JSON.stringify(rows)).not.toContain(secret.slice(6));
    const [listed] = await a.as.query(api.webhooks.list, {});
    expect(listed).toMatchObject({ url: HOOK, places: ["Personal"], enabled: true, attempts: [] });
    expect(JSON.stringify(listed)).not.toContain(secret.slice(6));
    for (let i = 0; i < 4; i++) await hook(a);
    await expect(hook(a)).rejects.toThrow(/up to 5 webhooks/);
    const b = await person(t, "hooks-other@example.com");
    await expect(b.as.mutation(api.webhooks.remove, { webhookId: listed!.id })).rejects.toThrow(/isn't there/);
  });

  test("with no webhooks, editing notes queues nothing", async () => {
    const t = setup();
    const a = await person(t, "hooks-none@example.com");
    network(PUBLIC_DNS);
    const id = await note(a, "Quiet", ["one"]);
    await edit(a, id, "two");
    expect(await t.run(async (ctx) => (await ctx.db.query("webhookEvents").collect()).length)).toBe(0);
  });
});

describe("deliveries", () => {
  test("a new note is delivered once, signed, with its title and link but none of its content", async () => {
    const t = setup();
    const a = await person(t, "hooks-note@example.com");
    const { secret } = await hook(a, { events: ["note.created", "note.updated"] });
    const sent = network(PUBLIC_DNS);
    const id = await note(a, "Launch plan", ["The secret launch date is 4 November."]);
    await edit(a, id, "More private words.");
    await settle(t);
    expect(sent).toHaveLength(1);
    const [p] = payloads(sent);
    expect(p).toMatchObject({ type: "note.created", place: { id: "personal", name: "Personal" }, data: { id, title: "Launch plan", url: expect.stringMatching(new RegExp(`/d/${id}$`)) } });
    expect(p!.id).toMatch(/^evt_/);
    expect(sent[0]!.body).not.toMatch(/secret launch|private words/);
    // The signature: HMAC-SHA256 of "<t>.<body>" with the secret, as the docs show.
    const header = sent[0]!.headers.get("folevi-signature")!;
    const [, ts, v1] = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(header)!;
    expect(createHmac("sha256", secret).update(`${ts}.${sent[0]!.body}`).digest("hex")).toBe(v1);
    expect(await signature(secret, sent[0]!.body, Number(ts))).toBe(header);
    expect(sent[0]!.headers.get("folevi-event-type")).toBe("note.created");
    expect(sent[0]!.headers.get("folevi-event-id")).toBe(p!.id);
    expect(sent[0]!.headers.get("content-type")).toBe("application/json");
    // The log shows the attempt: its code and time, never the body.
    const [listed] = await a.as.query(api.webhooks.list, {});
    expect(listed!.attempts).toEqual([{ type: "note.created", ok: true, statusCode: 200, error: null, at: expect.any(Number), durationMs: expect.any(Number) }]);
  });

  test("edits make at most one note.updated a minute, carrying the note as it is then", async () => {
    const t = setup();
    const a = await person(t, "hooks-debounce@example.com");
    const sent = network(PUBLIC_DNS);
    const id = await note(a, "Draft", ["start"]);
    await hook(a, { events: ["note.updated"] });
    for (let i = 0; i < 5; i++) await edit(a, id, `edit ${i}`);
    await a.as.mutation(api.sync.push, { scope: PERSONAL, deviceId: "device-hooks", ops: [{ opId: ulid(), kind: "document.update", documentId: id, patch: { title: "Final title" }, baseRevision: null }] as never });
    expect(await t.run(async (ctx) => (await ctx.db.query("webhookEvents").collect()).length)).toBe(1);
    await settle(t);
    expect(payloads(sent).map((p) => [p.type, p.data.title])).toEqual([["note.updated", "Final title"]]);
    // A minute later, a new edit is a new event.
    await edit(a, id, "after");
    await settle(t);
    expect(sent).toHaveLength(2);
  });

  test("tasks created and completed, comments written and notes moved to Trash", async () => {
    const t = setup();
    const a = await person(t, "hooks-events@example.com");
    const id = await note(a, "Errands", ["list"]);
    await hook(a, { events: ["task.created", "task.completed", "comment.created", "note.deleted"] });
    const sent = network(PUBLIC_DNS);
    const { blockId } = await a.as.mutation(api.tasks.quickAdd, { scope: PERSONAL, title: "Buy stamps", today: "2026-10-14", dueDate: "2026-10-16", documentId: id });
    await a.as.mutation(api.tasks.update, { blockId, checked: true });
    const { commentId } = await a.as.mutation(api.comments.create, { documentId: id, body: [{ type: "text", text: "Private remark" }] });
    await a.as.mutation(api.documents.moveToTrash, { documentId: id });
    await settle(t);
    const got = payloads(sent);
    expect(got.map((p) => p.type).sort()).toEqual(["comment.created", "note.deleted", "task.completed", "task.created"]);
    expect(got.find((p) => p.type === "task.created")!.data).toMatchObject({ id: blockId, text: "Buy stamps", dueDate: "2026-10-16", note: { id, title: "Errands" } });
    expect(got.find((p) => p.type === "task.completed")!.data).toMatchObject({ id: blockId, status: "done" });
    expect(got.find((p) => p.type === "comment.created")!.data).toMatchObject({ id: commentId, note: { id } });
    expect(JSON.stringify(got)).not.toContain("Private remark");
    expect(got.find((p) => p.type === "note.deleted")!.data).toMatchObject({ id, title: "Errands" });
  });

  test("only notes the endpoint's owner can read, only in the places chosen", async () => {
    const t = setup();
    const owner = await person(t, "hooks-owner@example.com");
    const member = await person(t, "hooks-member@example.com");
    const { workspaceId, scope } = await teamWorkspace(owner, "Board");
    await join(t, owner, member, "hooks-member@example.com", workspaceId, "editor");
    await hook(member, { personal: false, workspaceIds: [workspaceId], events: ["note.created"] });
    const sent = network(PUBLIC_DNS);
    const open = await note(owner, "Agenda", ["for everyone"], scope);
    const secret = await note(owner, "Salaries", ["board only"], scope);
    await owner.as.mutation(api.sharing.setAccessMode, { documentId: secret, mode: "restricted" });
    // Their own Personal wasn't chosen.
    await note(member, "My diary", ["mine"]);
    await settle(t);
    expect(payloads(sent).map((p) => [p.data.id, p.place])).toEqual([[open, { id: workspaceId, name: "Board" }]]);
  });

  test("a host that resolves to a private address is refused, and redirects are never followed", async () => {
    const t = setup();
    const a = await person(t, "hooks-ssrf@example.com");
    const sent = network({ "hooks.example.com": "93.184.216.34", "evil.example.com": "10.0.0.7" }, () => new Response(null, { status: 302, headers: { location: "http://169.254.169.254/" } }));
    await hook(a, { url: "https://evil.example.com/hook", events: ["note.created"] });
    await hook(a, { events: ["note.created"] });
    await note(a, "Probe", ["x"]);
    await settle(t);
    // Only the public endpoint was ever called (each retry too), and its redirect was never followed.
    expect(sent.length).toBeGreaterThan(0);
    expect(new Set(sent.map((s) => s.url))).toEqual(new Set([HOOK]));
    const list = await a.as.query(api.webhooks.list, {});
    expect(list.find((h) => h.url.includes("evil"))!.attempts[0]).toMatchObject({ ok: false, statusCode: null, error: "private address refused" });
    expect(list.find((h) => h.url === HOOK)!.attempts[0]).toMatchObject({ ok: false, statusCode: 302, error: "redirect not followed" });
  });

  test("failures retry with backoff over about a day; an endpoint failing delivery after delivery is turned off and its owner told", async () => {
    expect([1, 2, 3, 4, 5, 6].map(retryDelay)).toEqual([...RETRY_DELAYS_MS, null]);
    expect(RETRY_DELAYS_MS.reduce((a, b) => a + b, 0)).toBeGreaterThan(20 * 3_600_000);
    const t = setup();
    const a = await person(t, "hooks-retry@example.com");
    await hook(a, { events: ["task.created"] });
    const sent = network(PUBLIC_DNS, 503);
    const id = await note(a, "Jobs", ["x"]);
    await a.as.mutation(api.tasks.quickAdd, { scope: PERSONAL, title: "First", today: "2026-10-14", documentId: id });
    await settle(t);
    expect(sent).toHaveLength(6);
    // (Each gap is the planned wait, plus at most the 10 second timeout's own timer.)
    const gaps = sent.slice(1).map((s, i) => s.at - sent[i]!.at);
    gaps.forEach((g, i) => expect(g - RETRY_DELAYS_MS[i]!).toBeGreaterThanOrEqual(0));
    gaps.forEach((g, i) => expect(g - RETRY_DELAYS_MS[i]!).toBeLessThanOrEqual(30_000));
    const deliveries = await t.run(async (ctx) => ctx.db.query("webhookDeliveries").collect());
    expect(deliveries.map((d) => [d.status, d.attempts, d.payload])).toEqual([["failed", 6, ""]]);
    expect((await a.as.query(api.webhooks.list, {}))[0]!.enabled).toBe(true);

    // Two more deliveries that never get through: the endpoint is turned off, with a notice.
    for (const title of ["Second", "Third"]) await a.as.mutation(api.tasks.quickAdd, { scope: PERSONAL, title, today: "2026-10-14", documentId: id });
    await settle(t);
    const [after] = await a.as.query(api.webhooks.list, {});
    expect(after).toMatchObject({ enabled: false, disabledAt: expect.any(Number) });
    expect(after!.attempts).toHaveLength(18);
    const notices = await t.run(async (ctx) => (await ctx.db.query("notifications").collect()).filter((n) => n.title === "A webhook was turned off"));
    expect(notices).toHaveLength(1);
    expect(notices[0]!.body).toContain("hooks.example.com");
    // Turned off, it gets nothing; on again, it does.
    const before = sent.length;
    await a.as.mutation(api.tasks.quickAdd, { scope: PERSONAL, title: "Fourth", today: "2026-10-14", documentId: id });
    await settle(t);
    expect(sent.length).toBe(before);
    await a.as.mutation(api.webhooks.setEnabled, { webhookId: after!.id, enabled: true });
    expect((await a.as.query(api.webhooks.list, {}))[0]).toMatchObject({ enabled: true, disabledAt: null });
    await a.as.mutation(api.tasks.quickAdd, { scope: PERSONAL, title: "Fifth", today: "2026-10-14", documentId: id });
    await settle(t);
    expect(sent.length).toBe(before + 6);
    // The log keeps the last 20 attempts.
    expect((await a.as.query(api.webhooks.list, {}))[0]!.attempts).toHaveLength(20);
  });

  test("a success clears the failure count; a 10 second timeout counts as a failure", async () => {
    const t = setup();
    const a = await person(t, "hooks-recover@example.com");
    await hook(a, { events: ["task.created"] });
    network(PUBLIC_DNS, (n) => (n === 1 ? 500 : 200));
    const id = await note(a, "Jobs", ["x"]);
    await a.as.mutation(api.tasks.quickAdd, { scope: PERSONAL, title: "Once", today: "2026-10-14", documentId: id });
    await settle(t);
    const [h] = await t.run(async (ctx) => ctx.db.query("webhooks").collect());
    expect(h!.failedInARow).toBe(0);
    expect((await a.as.query(api.webhooks.list, {}))[0]!.attempts.map((x) => x.statusCode)).toEqual([200, 500]);
  });

  test("Send test event: one attempt, logged, and it never counts toward turning the endpoint off", async () => {
    const t = setup();
    const a = await person(t, "hooks-test@example.com");
    const { id, secret } = await hook(a);
    const sent = network(PUBLIC_DNS, 500);
    await a.as.mutation(api.webhooks.sendTest, { webhookId: id });
    await settle(t);
    expect(payloads(sent)).toMatchObject([{ type: "webhook.test", place: null }]);
    expect(createHmac("sha256", secret).update(`${/t=(\d+)/.exec(sent[0]!.headers.get("folevi-signature")!)![1]}.${sent[0]!.body}`).digest("hex")).toBe(/v1=(\w+)/.exec(sent[0]!.headers.get("folevi-signature")!)![1]);
    const [h] = await t.run(async (ctx) => ctx.db.query("webhooks").collect());
    expect(h!.failedInARow).toBe(0);
    // Deleting it removes its log and anything waiting.
    await a.as.mutation(api.webhooks.remove, { webhookId: id });
    expect(await t.run(async (ctx) => (await ctx.db.query("webhookAttempts").collect()).length)).toBe(0);
    expect(await t.run(async (ctx) => (await ctx.db.query("webhookPlaces").collect()).length)).toBe(0);
  });

  test("finished deliveries are swept after a week", async () => {
    const t = setup();
    const a = await person(t, "hooks-sweep@example.com");
    const { id } = await hook(a);
    network(PUBLIC_DNS);
    await a.as.mutation(api.webhooks.sendTest, { webhookId: id });
    await settle(t);
    vi.setSystemTime(NOW + 8 * 86_400_000);
    expect(await t.mutation(internal.webhooks.sweep, {})).toBe(1);
  });
});
