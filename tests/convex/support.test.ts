// Support requests: the public submit (validation, honeypot, rate limits, ticket numbers), the requester's
// own list, the admin inbox (permissions, audited views, replies, notes, status), and inbound email.
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { identity, person, setup, type T } from "./helpers";

const SERVER = "a".repeat(64);
const INBOUND_SECRET = "inbound-signing-secret-0123456789"; // gitleaks:allow (fake test value)
const ENV = ["MAILTRAP_API_TOKEN", "MAILTRAP_INBOUND_WEBHOOK_SECRET", "MAILTRAP_INBOUND_API_TOKEN", "SUPPORT_NOTIFY_EMAIL", "EMAIL_REPLY_TO"] as const;

type Person = Awaited<ReturnType<typeof person>>;

let saved: Record<string, string | undefined> = {};
let fetchMock: ReturnType<typeof vi.fn>;
/** Inbound messages the fake Messages API serves, by Mailtrap message id. */
let inbox: Record<string, Record<string, unknown>> = {};

beforeEach(() => {
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  for (const k of ENV) delete process.env[k];
  process.env.MAILTRAP_API_TOKEN = "mt-send-token"; // gitleaks:allow (fake test value)
  process.env.MAILTRAP_INBOUND_WEBHOOK_SECRET = INBOUND_SECRET;
  process.env.MAILTRAP_INBOUND_API_TOKEN = "mt-inbound-token"; // gitleaks:allow (fake test value)
  inbox = {};
  fetchMock = vi.fn(async (url: string) => {
    const m = /\/api\/inbound\/inboxes\/\d+\/messages\/(\w+)$/.exec(String(url));
    if (m) {
      const message = inbox[m[1]!];
      return message ? new Response(JSON.stringify(message), { status: 200 }) : new Response("{}", { status: 404 });
    }
    return new Response(JSON.stringify({ success: true, message_ids: [`msg-${Math.random().toString(36).slice(2)}`] }), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const form = (o: Record<string, unknown> = {}) => ({
  serverSecret: SERVER,
  clientKey: "client-1",
  name: "Jane Reader",
  email: "jane@example.com",
  topic: "sync",
  message: "My notes didn't sync after I came back online.",
  ...o,
});

async function codeOf(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
    return undefined;
  } catch (e) {
    return (e as { data?: { code?: string } }).data?.code ?? String(e);
  }
}

async function tickets(t: T) {
  return await t.run(async (ctx) => await ctx.db.query("supportTickets").collect());
}

async function messages(t: T) {
  return await t.run(async (ctx) => await ctx.db.query("supportMessages").collect());
}

async function attempts(t: T) {
  return await t.run(async (ctx) => await ctx.db.query("emailSendAttempts").collect());
}

async function runScheduled(t: T) {
  vi.useFakeTimers();
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  vi.useRealTimers();
}

async function withRole(t: T, p: Person, role: "super_admin" | "ops_admin" | "support_admin") {
  await t.run(async (ctx) => ctx.db.patch(p.profileId as Id<"profiles">, { platformRole: role }));
}

describe("submitting a request", () => {
  test("validates every field and refuses callers without the server secret", async () => {
    const t = setup();
    expect(await codeOf(t.mutation(api.support.submit, form({ serverSecret: "b".repeat(64) })))).toBe("forbidden");
    expect(await codeOf(t.mutation(api.support.submit, form({ email: "not-an-address" })))).toBe("invalid_argument");
    expect(await codeOf(t.mutation(api.support.submit, form({ name: "  " })))).toBe("invalid_argument");
    expect(await codeOf(t.mutation(api.support.submit, form({ topic: "security" })))).toBe("invalid_argument");
    expect(await codeOf(t.mutation(api.support.submit, form({ message: "hi" })))).toBe("invalid_argument");
    expect(await codeOf(t.mutation(api.support.submit, form({ message: "x".repeat(5001) })))).toBe("invalid_argument");
    expect(await tickets(t)).toHaveLength(0);
  });

  test("numbers tickets in order, stores the address normalised, and emails a confirmation from support@", async () => {
    const t = setup();
    const a = await t.mutation(api.support.submit, form({ email: "  Jane@Example.COM " }));
    const b = await t.mutation(api.support.submit, form({ email: "sam@example.com", clientKey: "client-2" }));
    expect(a).toEqual({ status: "received", number: 1001 });
    expect(b).toEqual({ status: "received", number: 1002 });
    const [first] = (await tickets(t)).sort((x, y) => x.number - y.number);
    expect(first).toMatchObject({ requesterEmail: "jane@example.com", status: "open", source: "web_form", unreadForStaff: true, topic: "sync" });
    expect(first!.profileId).toBeUndefined();
    expect(first!.subject).toBe("My notes didn't sync after I came back online.");
    await runScheduled(t);
    const sent = (await attempts(t)).filter((r) => r.templateKey === "support_ticket_received");
    expect(sent).toHaveLength(2);
    const bodies = fetchMock.mock.calls.map((c) => JSON.parse(String((c[1] as RequestInit).body)));
    const confirmation = bodies.find((b) => b.subject === "[Folevi #1001] We got your message");
    expect(confirmation.from).toEqual({ email: "support@mail.folevi.com", name: "Folevi Support" });
    expect(confirmation.reply_to).toEqual({ email: "support@folevi.com" });
    expect(confirmation.text).toContain("My notes didn't sync");
  });

  test("the honeypot drops the request with an answer that looks the same", async () => {
    const t = setup();
    expect(await t.mutation(api.support.submit, form({ website: "http://spam.example" }))).toEqual({ status: "received", number: null });
    expect(await tickets(t)).toHaveLength(0);
    await runScheduled(t);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("rate limits per client and per address", async () => {
    const t = setup();
    for (let i = 0; i < 5; i++) await t.mutation(api.support.submit, form({ clientKey: `c-${i}` }));
    // Same address, new client: the per-address limit (5 an hour).
    expect(await codeOf(t.mutation(api.support.submit, form({ clientKey: "c-new" })))).toBe("rate_limited");
    // Same client, new addresses: the per-client limit (10 an hour).
    const t2 = setup();
    for (let i = 0; i < 10; i++) await t2.mutation(api.support.submit, form({ email: `p${i}@example.com` }));
    expect(await codeOf(t2.mutation(api.support.submit, form({ email: "p99@example.com" })))).toBe("rate_limited");
  });

  test("signed in, the request is filed under the account and its address, whatever the form says", async () => {
    const t = setup();
    const me = await person(t, "member@example.com");
    const res = await me.as.mutation(api.support.submit, form({ email: "someone-else@example.com", source: "in_app", name: "" }));
    expect(res.number).toBe(1001);
    const [ticket] = await tickets(t);
    expect(ticket).toMatchObject({ requesterEmail: "member@example.com", profileId: me.profileId, source: "in_app", name: "member" });
    // Signed out, "in_app" can't be claimed.
    await t.mutation(api.support.submit, form({ source: "in_app", clientKey: "c-2" }));
    expect((await tickets(t)).find((x) => x.number === 1002)!.source).toBe("web_form");
  });

  test("deleting the account deletes its requests and their messages, including ones sent signed out", async () => {
    const t = setup();
    const me = await person(t, "leaving@example.com");
    const staff = await person(t, "staff@example.com");
    await withRole(t, staff, "support_admin");
    await me.as.mutation(api.support.submit, form({ source: "in_app" }));
    await t.mutation(api.support.submit, form({ email: "Leaving@Example.com", clientKey: "c-2" }));
    await t.mutation(api.support.submit, form({ email: "someone@example.com", clientKey: "c-3" }));
    await staff.as.mutation(api.support.reply, { number: 1001, body: "Thanks, looking now." });
    await staff.as.mutation(api.support.addNote, { number: 1002, body: "Same person as #1001." });
    await me.as.mutation(api.users.requestAccountDeletion, { confirmEmail: "leaving@example.com" });
    await t.run(async (ctx) => {
      for (const j of await ctx.db.query("deletionJobs").collect()) await ctx.db.patch(j._id, { scheduledFor: Date.now() - 1 });
    });
    const status = async () => (await t.run(async (ctx) => ctx.db.query("deletionJobs").collect()))[0]!.status;
    for (let i = 0; i < 40 && (await status()) !== "completed"; i++) await t.mutation(internal.maintenance.runDeletionJobs, {});
    expect(await status()).toBe("completed");
    const left = await tickets(t);
    expect(left.map((x) => x.number)).toEqual([1003]);
    expect((await messages(t)).every((m) => m.ticketId === left[0]!._id)).toBe(true);
  });

  test("the requester sees their own requests and staff replies, never notes; they can answer from the app", async () => {
    const t = setup();
    const me = await person(t, "member@example.com");
    const other = await person(t, "other@example.com");
    const staff = await person(t, "staff@example.com");
    await withRole(t, staff, "support_admin");
    await me.as.mutation(api.support.submit, form({ source: "in_app" }));
    await staff.as.mutation(api.support.reply, { number: 1001, body: "Open the page once while online." });
    await staff.as.mutation(api.support.addNote, { number: 1001, body: "Internal: checked the sync log." });
    const mine = await me.as.query(api.support.myRequests, {});
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ number: 1001, status: "pending" });
    expect(mine[0]!.messages.map((m) => [m.from, m.body])).toEqual([
      ["you", "My notes didn't sync after I came back online."],
      ["support", "Open the page once while online."],
    ]);
    expect(await other.as.query(api.support.myRequests, {})).toEqual([]);
    expect(await codeOf(other.as.mutation(api.support.replyToMyRequest, { number: 1001, message: "Not mine" }))).toBe("not_found");
    await me.as.mutation(api.support.replyToMyRequest, { number: 1001, message: "That fixed it, thanks." });
    const [ticket] = await tickets(t);
    expect(ticket).toMatchObject({ status: "open", unreadForStaff: true });
  });
});

describe("the admin Support inbox", () => {
  test("only platform staff can use it; everyone else gets not_found", async () => {
    const t = setup();
    const outsider = await person(t, "outsider@example.com");
    await t.mutation(api.support.submit, form());
    for (const call of [
      outsider.as.query(api.support.unreadCount, {}),
      outsider.as.mutation(api.support.listTickets, {}),
      outsider.as.mutation(api.support.viewTicket, { number: 1001 }),
      outsider.as.mutation(api.support.reply, { number: 1001, body: "Hello there" }),
      outsider.as.mutation(api.support.addNote, { number: 1001, body: "Hello there" }),
      outsider.as.mutation(api.support.setStatus, { number: 1001, status: "closed" }),
      outsider.as.mutation(api.support.assign, { number: 1001, to: "me" }),
    ]) {
      expect(await codeOf(call)).toBe("not_found");
    }
    for (const role of ["support_admin", "ops_admin", "super_admin"] as const) {
      const staff = await person(t, `${role}@example.com`);
      await withRole(t, staff, role);
      expect(await staff.as.query(api.support.unreadCount, {})).toBeGreaterThanOrEqual(0);
      const list = await staff.as.mutation(api.support.listTickets, {});
      expect(list.tickets.map((x) => x.number)).toEqual([1001]);
      const view = await staff.as.mutation(api.support.viewTicket, { number: 1001 });
      expect(view.email).toBe("jane@example.com");
    }
  });

  test("staff need two-step verification", async () => {
    const t = setup();
    const staff = await person(t, "staff@example.com");
    await withRole(t, staff, "support_admin");
    const noMfa = t.withIdentity(identity("staff@example.com", { subject: staff.userId, tokenIdentifier: `https://test.folevi.local|${staff.userId}`, sessionId: staff.sessionId, "https://folevi.com/mfa": false }));
    expect(await codeOf(noMfa.mutation(api.support.listTickets, {}))).toBe("mfa_required");
  });

  test("searches by number or exact address, filters by status, and audits the list with the query hashed", async () => {
    const t = setup();
    const staff = await person(t, "staff@example.com");
    await withRole(t, staff, "support_admin");
    await t.mutation(api.support.submit, form());
    await t.mutation(api.support.submit, form({ email: "sam@example.com", clientKey: "c2" }));
    expect((await staff.as.mutation(api.support.listTickets, { search: "#1002" })).tickets.map((x) => x.number)).toEqual([1002]);
    expect((await staff.as.mutation(api.support.listTickets, { search: "JANE@example.com" })).tickets.map((x) => x.number)).toEqual([1001]);
    expect((await staff.as.mutation(api.support.listTickets, { status: "closed" })).tickets).toEqual([]);
    expect(await codeOf(staff.as.mutation(api.support.listTickets, { search: "jane" }))).toBe("invalid_argument");
    const logs = await t.run(async (ctx) => ctx.db.query("adminAuditLogs").collect());
    const lists = logs.filter((l) => l.action === "support.list");
    expect(lists.length).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify(lists)).not.toContain("jane@example.com");
  });

  test("viewing is audited and marks it read; a reply emails the requester, sets pending and is audited", async () => {
    const t = setup();
    const staff = await person(t, "staff@example.com");
    await withRole(t, staff, "support_admin");
    await t.mutation(api.support.submit, form());
    expect(await staff.as.query(api.support.unreadCount, {})).toBe(1);
    await staff.as.mutation(api.support.viewTicket, { number: 1001, requestId: "req-view" });
    expect(await staff.as.query(api.support.unreadCount, {})).toBe(0);
    await staff.as.mutation(api.support.reply, { number: 1001, body: "Try opening the page while online.", requestId: "req-reply" });
    const [ticket] = await tickets(t);
    expect(ticket).toMatchObject({ status: "pending", assigneeId: staff.profileId });
    const logs = await t.run(async (ctx) => ctx.db.query("adminAuditLogs").withIndex("by_target", (q) => q.eq("targetType", "support_ticket").eq("targetId", "1001")).collect());
    expect(logs.map((l) => l.action)).toEqual(["support.view", "support.reply"]);
    expect(logs[1]).toMatchObject({ requestId: "req-reply", actorRole: "support_admin", before: { status: "open" } });
    expect(JSON.stringify(logs)).not.toContain("Try opening");
    await runScheduled(t);
    const reply = (await attempts(t)).find((a) => a.templateKey === "support_reply");
    expect(reply).toMatchObject({ status: "accepted", category: "support" });
    const body = fetchMock.mock.calls.map((c) => JSON.parse(String((c[1] as RequestInit).body))).find((b) => b.category === "support_reply");
    expect(body.subject).toBe("[Folevi #1001] Reply from Folevi support");
    expect(body.from.email).toBe("support@mail.folevi.com");
    expect(body.text).toContain("Try opening the page while online.");
  });

  test("notes are never emailed; status and assignment changes are audited", async () => {
    const t = setup();
    const staff = await person(t, "staff@example.com");
    await withRole(t, staff, "ops_admin");
    await t.mutation(api.support.submit, form());
    await runScheduled(t);
    fetchMock.mockClear();
    await staff.as.mutation(api.support.addNote, { number: 1001, body: "Looks like a stale service worker." });
    await staff.as.mutation(api.support.setStatus, { number: 1001, status: "closed" });
    await staff.as.mutation(api.support.assign, { number: 1001, to: "me" });
    await runScheduled(t);
    expect(fetchMock).not.toHaveBeenCalled();
    const [ticket] = await tickets(t);
    expect(ticket).toMatchObject({ status: "closed", assigneeId: staff.profileId });
    const actions = (await t.run(async (ctx) => ctx.db.query("adminAuditLogs").collect())).map((l) => l.action);
    expect(actions).toEqual(expect.arrayContaining(["support.note", "support.set_status", "support.assign"]));
  });

  test("staff get an in-app notice per ticket; SUPPORT_NOTIFY_EMAIL gets an email, never the support mailbox", async () => {
    const t = setup();
    const staff = await person(t, "staff@example.com");
    await withRole(t, staff, "support_admin");
    process.env.SUPPORT_NOTIFY_EMAIL = "team@example.com";
    await t.mutation(api.support.submit, form());
    const notes = await t.run(async (ctx) => ctx.db.query("notifications").withIndex("by_profile_created", (q) => q.eq("profileId", staff.profileId as Id<"profiles">)).collect());
    expect(notes.filter((n) => n.kind === "system").map((n) => n.title)).toEqual(["New support request #1001"]);
    await runScheduled(t);
    expect((await attempts(t)).filter((a) => a.templateKey === "support_staff_notice")).toHaveLength(1);
    process.env.SUPPORT_NOTIFY_EMAIL = "support@folevi.com";
    await t.mutation(api.support.submit, form({ email: "sam@example.com", clientKey: "c2" }));
    await runScheduled(t);
    expect((await attempts(t)).filter((a) => a.templateKey === "support_staff_notice")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------- inbound email

const sign = (body: string, secret = INBOUND_SECRET) => createHmac("sha256", secret).update(body).digest("hex");

function received(messageId: string, eventId = `evt_${messageId}`) {
  return JSON.stringify({ events: [{ event: "inbound.message_received", event_id: eventId, timestamp: 1790000000, inbox_id: 15, message_id: messageId, sender: "Jane" }] });
}

function mail(id: string, o: Record<string, unknown> = {}) {
  inbox[id] = {
    id,
    inbox_id: 15,
    from: "Jane Reader <jane@example.com>",
    to: ["support@folevi.com"],
    cc: [],
    subject: "Can't sign in",
    rfc_message_id: `<${id}@mail.example.com>`,
    in_reply_to: null,
    references: [],
    headers: {},
    text_body: "I can't sign in since yesterday.",
    html_body: null,
    ...o,
  };
}

async function deliver(t: T, body: string, signature: string | null = sign(body)) {
  return await t.fetch("/webhooks/mailtrap-inbound", {
    method: "POST",
    body,
    headers: { "content-type": "application/json", ...(signature !== null ? { "mailtrap-signature": signature } : {}) },
  });
}

describe("POST /webhooks/mailtrap-inbound", () => {
  test("refuses a missing, wrong or unconfigured signature, and a malformed body", async () => {
    const t = setup();
    mail("m1");
    const body = received("m1");
    expect((await deliver(t, body, null)).status).toBe(401);
    expect((await deliver(t, body, sign(body, "wrong-secret"))).status).toBe(401);
    expect((await deliver(t, body.replace("m1", "m2"), sign(body))).status).toBe(401);
    process.env.MAILTRAP_INBOUND_WEBHOOK_SECRET = "";
    expect((await deliver(t, body, sign(body, ""))).status).toBe(401);
    process.env.MAILTRAP_INBOUND_WEBHOOK_SECRET = INBOUND_SECRET;
    expect((await deliver(t, "{nope")).status).toBe(400);
    expect(await tickets(t)).toHaveLength(0);
  });

  test("a new email opens a ticket with source email and gets a confirmation; retries are de-duplicated", async () => {
    const t = setup();
    mail("m1");
    const body = received("m1");
    expect((await deliver(t, body)).status).toBe(200);
    expect((await deliver(t, body)).status).toBe(200);
    // The same email delivered again under another Mailtrap id (same Message-ID) is also a duplicate.
    mail("m1b", { rfc_message_id: "<m1@mail.example.com>" });
    expect((await deliver(t, received("m1b"))).status).toBe(200);
    const all = await tickets(t);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ number: 1001, source: "email", requesterEmail: "jane@example.com", name: "Jane Reader", subject: "Can't sign in", topic: "other" });
    expect(all[0]!.profileId).toBeUndefined();
    expect(await messages(t)).toHaveLength(1);
    const inboundCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes("/api/inbound/"));
    expect(inboundCalls).toHaveLength(2);
    expect((inboundCalls[0]![1] as RequestInit).headers).toMatchObject({ Authorization: "Bearer mt-inbound-token" });
  });

  test("a reply tagged [Folevi #N] from the requester joins ticket N (reopening it), quotes stripped", async () => {
    const t = setup();
    const staff = await person(t, "staff@example.com");
    await withRole(t, staff, "support_admin");
    mail("m1");
    await deliver(t, received("m1"));
    await staff.as.mutation(api.support.reply, { number: 1001, body: "Try resetting your password." });
    await staff.as.mutation(api.support.setStatus, { number: 1001, status: "closed" });
    mail("m2", {
      from: "JANE@example.com",
      subject: "Re: [Folevi #1001] Reply from Folevi support",
      text_body: "That worked, thank you.\n\nOn Mon, 1 Sep 2026, Folevi Support <support@folevi.com> wrote:\n> Try resetting your password.",
      in_reply_to: "<x@folevi.com>",
    });
    expect((await deliver(t, received("m2"))).status).toBe(200);
    const all = await tickets(t);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ status: "open", unreadForStaff: true });
    const thread = (await messages(t)).sort((a, b) => a.createdAt - b.createdAt).map((m) => [m.authorKind, m.body]);
    expect(thread.at(-1)).toEqual(["requester", "That worked, thank you."]);
    // The staff reply is threaded to the requester's email.
    await runScheduled(t);
    const replyBody = fetchMock.mock.calls.map((c) => (c[1] ? String((c[1] as RequestInit).body ?? "") : "")).find((b) => b.includes('"support_reply"'));
    expect(JSON.parse(replyBody!).headers).toEqual({ "In-Reply-To": "<m1@mail.example.com>", References: "<m1@mail.example.com>" });
  });

  test("a tagged email from a different sender opens a new ticket instead", async () => {
    const t = setup();
    mail("m1");
    await deliver(t, received("m1"));
    mail("m2", { from: "mallory@example.com", subject: "Re: [Folevi #1001] We got your message", text_body: "Let me in to Jane's ticket." });
    await deliver(t, received("m2"));
    const all = (await tickets(t)).sort((a, b) => a.number - b.number);
    expect(all.map((x) => [x.number, x.requesterEmail])).toEqual([
      [1001, "jane@example.com"],
      [1002, "mallory@example.com"],
    ]);
    expect((await messages(t)).filter((m) => m.ticketId === all[0]!._id)).toHaveLength(1);
  });

  test("auto-replies, bounces, our own mail and other mailboxes are ignored", async () => {
    const t = setup();
    mail("a1", { headers: { "auto-submitted": "auto-replied" }, subject: "Re: [Folevi #1001] We got your message" });
    mail("a2", { from: "MAILER-DAEMON@mx.example.com", subject: "Undeliverable: hello" });
    mail("a3", { subject: "Out of Office: back Monday" });
    mail("a4", { from: "support@folevi.com" });
    mail("a5", { to: ["dmarc-reports@folevi.com"] });
    for (const id of ["a1", "a2", "a3", "a4", "a5"]) expect((await deliver(t, received(id))).status).toBe(200);
    expect(await tickets(t)).toHaveLength(0);
    // Mail to security@ is kept, filed as a security ticket.
    mail("s1", { to: ["security@folevi.com"], subject: "Vulnerability report" });
    await deliver(t, received("s1"));
    expect((await tickets(t))[0]).toMatchObject({ topic: "security", source: "email" });
  });

  test("without the API token it asks Mailtrap to retry later, and nothing is filed", async () => {
    const t = setup();
    delete process.env.MAILTRAP_INBOUND_API_TOKEN;
    mail("m1");
    expect((await deliver(t, received("m1"))).status).toBe(503);
    expect(await tickets(t)).toHaveLength(0);
  });
});
