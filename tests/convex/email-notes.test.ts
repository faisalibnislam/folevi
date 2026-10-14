// Email to note: the address in Settings (create, rotate, turn off, place, senders) and mail to it through
// the signed Resend webhook (only the account's own, verified address makes a note; one note per message;
// a daily limit), next to support@ mail, which still becomes tickets.
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { emailNoteBlocks, newNoteToken, noteTokenOf } from "../../convex/lib/emailNotes";
import { join, person, setup, teamWorkspace, type T } from "./helpers";

const KEY = Buffer.from("email-note-signing-secret-0123456789").toString("base64");
const SECRET = `whsec_${KEY}`; // gitleaks:allow (fake test value)
const ENV = ["RESEND_API_KEY", "RESEND_WEBHOOK_SECRET", "SUPPORT_NOTIFY_EMAIL", "EMAIL_REPLY_TO"] as const;

type Person = Awaited<ReturnType<typeof person>>;

let saved: Record<string, string | undefined> = {};
let fetchMock: ReturnType<typeof vi.fn>;
/** Received emails the fake Received emails API serves, by Resend email id. */
let inbox: Record<string, Record<string, unknown>> = {};

beforeEach(() => {
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  for (const k of ENV) delete process.env[k];
  process.env.RESEND_API_KEY = "re-test-key"; // gitleaks:allow (fake test value)
  process.env.RESEND_WEBHOOK_SECRET = SECRET;
  inbox = {};
  fetchMock = vi.fn(async (url: string) => {
    const m = /\/emails\/receiving\/([\w-]+)$/.exec(String(url));
    if (m) {
      const message = inbox[m[1]!];
      return message ? new Response(JSON.stringify(message), { status: 200 }) : new Response("{}", { status: 404 });
    }
    return new Response(JSON.stringify({ id: `msg-${Math.random().toString(36).slice(2)}` }), { status: 200 });
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

function sign(id: string, timestamp: string, body: string) {
  return `v1,${createHmac("sha256", Buffer.from(KEY, "base64")).update(`${id}.${timestamp}.${body}`).digest("base64")}`;
}

/** An email.received webhook for a Resend email id, addressed to `to`. */
function received(emailId: string, to: string[]) {
  return JSON.stringify({ type: "email.received", created_at: "2026-10-14T09:12:00.000Z", data: { email_id: emailId, from: "someone@example.com", to, subject: "Hello" } });
}

/** A message the Received emails API serves (verified by DMARC unless said otherwise). */
function mail(id: string, o: Record<string, unknown> = {}) {
  inbox[id] = {
    object: "email",
    id,
    created_at: "2026-10-14T09:12:00.000Z",
    from: "Ada Reader <ada@example.com>",
    to: ["someone@folevi.com"],
    cc: [],
    subject: "Trip ideas",
    message_id: `<${id}@mail.example.com>`,
    headers: {},
    text: "Lisbon in spring.\n\n- Tram 28\n- https://example.com/guide",
    html: null,
    attachments: [],
    authentication: { spf: "pass", dkim: "pass", dmarc: "pass" },
    ...o,
  };
}

async function deliver(t: T, body: string) {
  const id = `msg_${/"email_id":"([\w-]+)"/.exec(body)?.[1] ?? "x"}`;
  const ts = String(Math.floor(Date.now() / 1000));
  return await t.fetch("/webhooks/resend", {
    method: "POST",
    body,
    headers: { "content-type": "application/json", "svix-id": id, "svix-timestamp": ts, "svix-signature": sign(id, ts, body) },
  });
}

/** Notes filed under someone's Inbox pages (made from email). */
async function emailNotes(t: T, p: Person) {
  return await t.run(async (ctx) => {
    const docs = await ctx.db.query("documents").collect();
    const inboxes = new Set(docs.filter((d) => d.publicId.startsWith("inbox-") && d.createdBy === p.profileId).map((d) => d._id));
    return docs.filter((d) => d.parentDocumentId !== undefined && inboxes.has(d.parentDocumentId) && d.createdBy === p.profileId);
  });
}

async function blockTexts(t: T, doc: Doc<"documents">) {
  return await t.run(async (ctx) => {
    const rows = await ctx.db
      .query("blocks")
      .withIndex("by_document", (q) => q.eq("documentId", doc._id))
      .collect();
    return rows
      .filter((b) => !b.deletedAt)
      .sort((a, b) => (a.rank < b.rank ? -1 : 1))
      .map((b) => ({ type: b.type, text: (b.text as { text?: string }[]).map((n) => n.text ?? "").join(""), marks: b.text }));
  });
}

async function notificationsOf(t: T, p: Person) {
  return await t.run(async (ctx) =>
    ctx.db
      .query("notifications")
      .withIndex("by_profile_created", (q) => q.eq("profileId", p.profileId))
      .collect(),
  );
}

async function tickets(t: T) {
  return await t.run(async (ctx) => await ctx.db.query("supportTickets").collect());
}

const receivingCalls = () => fetchMock.mock.calls.filter((c) => String(c[0]).includes("/emails/receiving/"));

/** Ada with an address; returns her address. */
async function ada(t: T) {
  const p = await person(t, "ada@example.com");
  const { address } = await p.as.mutation(api.emailNotes.create, {});
  return { p, address };
}

describe("the address", () => {
  test("tokens are long, random and lowercase; only n-<token>@folevi.com is routed", () => {
    const a = newNoteToken();
    expect(a).toMatch(/^[a-z2-9]{24}$/);
    expect(newNoteToken()).not.toBe(a);
    expect(noteTokenOf(`N-${a.toUpperCase()}@Folevi.com`)).toBe(a);
    expect(noteTokenOf("support@folevi.com")).toBeNull();
    expect(noteTokenOf(`n-${a}@other.app`)).toBeNull();
    expect(noteTokenOf("n-short@folevi.com")).toBeNull();
  });

  test("create, status, rotate and turn off; creating twice keeps the address", async () => {
    const t = setup();
    const p = await person(t, "owner@example.com");
    expect(await p.as.query(api.emailNotes.status, {})).toBeNull();
    const { address } = await p.as.mutation(api.emailNotes.create, {});
    expect(address).toMatch(/^n-[a-z2-9]{24}@folevi\.com$/);
    expect((await p.as.mutation(api.emailNotes.create, {})).address).toBe(address);
    expect(await p.as.query(api.emailNotes.status, {})).toMatchObject({ address, place: { kind: "personal" }, ownAddress: "owner@example.com", extraSenders: [], count: 0, lastReceivedAt: null });
    const { address: next } = await p.as.mutation(api.emailNotes.rotate, {});
    expect(next).not.toBe(address);
    expect((await p.as.query(api.emailNotes.status, {}))!.address).toBe(next);
    await p.as.mutation(api.emailNotes.remove, {});
    expect(await p.as.query(api.emailNotes.status, {})).toBeNull();
  });

  test("other senders: valid addresses only, up to five, the account's own can't be removed", async () => {
    const t = setup();
    const p = await person(t, "senders@example.com");
    await p.as.mutation(api.emailNotes.create, {});
    await p.as.mutation(api.emailNotes.addSender, { email: " Work@Example.org " });
    await p.as.mutation(api.emailNotes.addSender, { email: "work@example.org" });
    await p.as.mutation(api.emailNotes.addSender, { email: "senders@example.com" });
    expect((await p.as.query(api.emailNotes.status, {}))!.extraSenders).toEqual(["work@example.org"]);
    await expect(p.as.mutation(api.emailNotes.addSender, { email: "not an address" })).rejects.toThrow(/Enter an email address/);
    for (let i = 2; i <= 5; i++) await p.as.mutation(api.emailNotes.addSender, { email: `other${i}@example.org` });
    await expect(p.as.mutation(api.emailNotes.addSender, { email: "sixth@example.org" })).rejects.toThrow(/up to 5/);
    await expect(p.as.mutation(api.emailNotes.removeSender, { email: "senders@example.com" })).rejects.toThrow(/always send/);
    await p.as.mutation(api.emailNotes.removeSender, { email: "WORK@example.org" });
    expect((await p.as.query(api.emailNotes.status, {}))!.extraSenders).toHaveLength(4);
  });

  test("a workspace place needs edit access there", async () => {
    const t = setup();
    const owner = await person(t, "place-owner@example.com");
    const viewer = await person(t, "place-viewer@example.com");
    const { workspaceId, scope } = await teamWorkspace(owner, "Studio");
    await join(t, owner, viewer, "place-viewer@example.com", workspaceId, "viewer");
    await viewer.as.mutation(api.emailNotes.create, {});
    await expect(viewer.as.mutation(api.emailNotes.setPlace, { scope })).rejects.toThrow();
    await expect(viewer.as.mutation(api.emailNotes.create, { scope })).resolves.toBeTruthy(); // already has one: unchanged
    expect((await viewer.as.query(api.emailNotes.status, {}))!.place).toEqual({ kind: "personal" });
    await owner.as.mutation(api.emailNotes.create, { scope });
    expect((await owner.as.query(api.emailNotes.status, {}))!.place).toEqual({ kind: "workspace", workspaceId, name: "Studio" });
  });
});

describe("POST /webhooks/resend (mail to an n- address)", () => {
  test("mail from the account's own address becomes one Inbox note; a repeated delivery adds nothing", async () => {
    const t = setup();
    const { p, address } = await ada(t);
    mail("e1", { to: [address], attachments: [{ id: "a1", filename: "itinerary.pdf", content_type: "application/pdf", size: 1200 }, { id: "a2", filename: "logo.png", content_disposition: "inline", content_id: "logo" }] });
    expect((await deliver(t, received("e1", [address]))).status).toBe(200);
    expect((await deliver(t, received("e1", [address]))).status).toBe(200);
    // The same message again under another Resend id (same Message-ID) is a duplicate too.
    mail("e1b", { to: [address], message_id: "<e1@mail.example.com>" });
    expect((await deliver(t, received("e1b", [address]))).status).toBe(200);

    const notes = await emailNotes(t, p);
    expect(notes).toHaveLength(1);
    expect(notes[0]!.title).toBe("Trip ideas");
    const blocks = await blockTexts(t, notes[0]!);
    expect(blocks[0]!.text).toBe("From Ada Reader (ada@example.com), 14 Oct 2026, 09:12");
    expect(blocks.map((b) => b.text)).toContain("Lisbon in spring.");
    expect(blocks.filter((b) => b.type === "bulleted").map((b) => b.text)).toEqual(["Tram 28", "https://example.com/guide"]);
    expect(blocks.at(-1)!.text).toBe("Attachments not imported: itinerary.pdf");
    expect(JSON.stringify(blocks)).toContain("https://example.com/guide");
    const status = (await p.as.query(api.emailNotes.status, {}))!;
    expect(status).toMatchObject({ count: 1, lastReceivedAt: expect.any(Number), rejectedCount: 0 });
    const bell = await notificationsOf(t, p);
    expect(bell.filter((n) => n.documentId === notes[0]!._id)).toHaveLength(1);
    // The webhook is the only thing fetched (twice: the third delivery was a new Resend id).
    expect(receivingCalls()).toHaveLength(2);
    expect(await tickets(t)).toHaveLength(0);
  });

  test("an HTML-only email keeps its links; an empty subject is named after the sender", async () => {
    const t = setup();
    const { p, address } = await ada(t);
    mail("h1", { to: [address], subject: "", text: null, html: '<html><head><style>p{}</style></head><body><p>See <a href="https://example.com/a?x=1&amp;y=2">the plan</a>.</p><img src="https://tracker.example/p.gif"></body></html>' });
    await deliver(t, received("h1", [address]));
    const [note] = await emailNotes(t, p);
    expect(note!.title).toBe("Email from ada@example.com");
    const blocks = await blockTexts(t, note!);
    expect(blocks.map((b) => b.text)).toContain("See the plan.");
    expect(JSON.stringify(blocks)).toContain("https://example.com/a?x=1&y=2");
    expect(JSON.stringify(blocks)).not.toContain("tracker.example");
  });

  test("another sender is ignored: no note, counted, told once a day", async () => {
    const t = setup();
    const { p, address } = await ada(t);
    mail("x1", { to: [address], from: "Mallory <mallory@example.net>" });
    mail("x2", { to: [address], from: "mallory@example.net" });
    expect((await deliver(t, received("x1", [address]))).status).toBe(200);
    expect((await deliver(t, received("x2", [address]))).status).toBe(200);
    expect(await emailNotes(t, p)).toHaveLength(0);
    expect((await p.as.query(api.emailNotes.status, {}))!).toMatchObject({ count: 0, rejectedCount: 2 });
    const told = (await notificationsOf(t, p)).filter((n) => /ignored an email/.test(n.title));
    expect(told).toHaveLength(1);
    expect(told[0]!.title).toBe("We ignored an email to your Folevi address from mallory@example.net. Only your own address can add notes.");
  });

  test("the own address without a DMARC pass is ignored as unverified; an added sender is accepted", async () => {
    const t = setup();
    const { p, address } = await ada(t);
    mail("s1", { to: [address], authentication: { spf: "pass", dkim: "fail", dmarc: "fail" } });
    mail("s2", { to: [address], authentication: null });
    await deliver(t, received("s1", [address]));
    await deliver(t, received("s2", [address]));
    expect(await emailNotes(t, p)).toHaveLength(0);
    expect((await notificationsOf(t, p)).find((n) => /couldn't confirm/.test(n.title))).toBeTruthy();
    await p.as.mutation(api.emailNotes.addSender, { email: "ada.work@example.org" });
    mail("s3", { to: [address], from: "ada.work@example.org" });
    await deliver(t, received("s3", [address]));
    expect(await emailNotes(t, p)).toHaveLength(1);
  });

  test("an unknown address is ignored without reading the message", async () => {
    const t = setup();
    await ada(t);
    const stranger = `n-${newNoteToken()}@folevi.com`;
    mail("u1", { to: [stranger] });
    expect((await deliver(t, received("u1", [stranger]))).status).toBe(200);
    expect(receivingCalls()).toHaveLength(0);
    expect(await tickets(t)).toHaveLength(0);
    expect(await t.run(async (ctx) => (await ctx.db.query("emailNoteReceipts").collect()).length)).toBe(0);
  });

  test("a rotated address stops working; the new one works", async () => {
    const t = setup();
    const { p, address } = await ada(t);
    const { address: next } = await p.as.mutation(api.emailNotes.rotate, {});
    mail("r1", { to: [address] });
    await deliver(t, received("r1", [address]));
    expect(await emailNotes(t, p)).toHaveLength(0);
    mail("r2", { to: [next] });
    await deliver(t, received("r2", [next]));
    expect(await emailNotes(t, p)).toHaveLength(1);
    await p.as.mutation(api.emailNotes.remove, {});
    mail("r3", { to: [next], message_id: "<r3@mail.example.com>" });
    await deliver(t, received("r3", [next]));
    expect(await emailNotes(t, p)).toHaveLength(1);
  });

  test("a Bcc'd address (only in received_for) is routed to the note, not to support", async () => {
    const t = setup();
    const { p, address } = await ada(t);
    mail("b1", { to: ["friend@example.org"] });
    const body = JSON.stringify({ type: "email.received", data: { email_id: "b1", from: "ada@example.com", to: ["friend@example.org"], received_for: [address], subject: "Hi" } });
    expect((await deliver(t, body)).status).toBe(200);
    expect(await emailNotes(t, p)).toHaveLength(1);
    expect(await tickets(t)).toHaveLength(0);
  });

  test("support@ still becomes a ticket, and mail to both is filed in both places with one fetch", async () => {
    const t = setup();
    const { p, address } = await ada(t);
    mail("t1", { to: ["support@folevi.com"], subject: "Can't sign in", text: "Help please." });
    await deliver(t, received("t1", ["support@folevi.com"]));
    expect(await tickets(t)).toHaveLength(1);
    expect(await emailNotes(t, p)).toHaveLength(0);
    mail("t2", { to: ["support@folevi.com", address], subject: "Both", text: "Copy for me." });
    await deliver(t, received("t2", ["support@folevi.com", address]));
    expect(await tickets(t)).toHaveLength(2);
    expect(await emailNotes(t, p)).toHaveLength(1);
    expect(receivingCalls().filter((c) => String(c[0]).endsWith("/t2"))).toHaveLength(1);
  });

  test("without the API key Resend is asked to retry and nothing is saved", async () => {
    const t = setup();
    const { p, address } = await ada(t);
    delete process.env.RESEND_API_KEY;
    mail("k1", { to: [address] });
    expect((await deliver(t, received("k1", [address]))).status).toBe(503);
    expect(await emailNotes(t, p)).toHaveLength(0);
  });

  test("50 notes a day per address; past that mail is dropped and the person is told once", async () => {
    const t = setup();
    const { p, address } = await ada(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("systemSettings", { key: "rate_limits", value: { emailNote: { limit: 2, windowMs: 24 * 60 * 60_000 } }, updatedAt: Date.now() });
    });
    for (const id of ["l1", "l2", "l3", "l4"]) {
      mail(id, { to: [address] });
      await deliver(t, received(id, [address]));
    }
    expect(await emailNotes(t, p)).toHaveLength(2);
    expect((await notificationsOf(t, p)).filter((n) => /daily limit/.test(n.title))).toHaveLength(1);
  });

  test("notes go to the chosen workspace's Inbox, privately; back to Personal when the person can't add pages there", async () => {
    const t = setup();
    const owner = await person(t, "ws-owner@example.com");
    const member = await person(t, "ws-member@example.com");
    const { workspaceId, scope } = await teamWorkspace(owner, "Studio");
    await join(t, owner, member, "ws-member@example.com", workspaceId, "editor");
    const { address } = await member.as.mutation(api.emailNotes.create, { scope });
    mail("w1", { to: [address], from: "ws-member@example.com" });
    await deliver(t, received("w1", [address]));
    const [first] = await emailNotes(t, member);
    expect(first!.workspaceId).toBeDefined();
    expect(first!.accessMode).toBe("restricted");

    await t.run(async (ctx) => {
      const ws = (await ctx.db.query("workspaces").withIndex("by_public_id", (q) => q.eq("publicId", workspaceId)).unique())!;
      const m = (await ctx.db
        .query("workspaceMembers")
        .withIndex("by_workspace_profile", (q) => q.eq("workspaceId", ws._id).eq("profileId", member.profileId as Id<"profiles">))
        .unique())!;
      await ctx.db.patch(m._id, { role: "member", memberAccess: "view" });
    });
    mail("w2", { to: [address], from: "ws-member@example.com" });
    await deliver(t, received("w2", [address]));
    const all = await emailNotes(t, member);
    expect(all).toHaveLength(2);
    expect(all.find((d) => d._id !== first!._id)!.workspaceId).toBeUndefined();
  });
});

describe("the note's blocks", () => {
  test("cut at 1,000 blocks with a line saying so", () => {
    const text = Array.from({ length: 1200 }, (_, i) => `Line ${i}`).join("\n\n");
    const blocks = emailNoteBlocks({ fromAddress: "a@example.com", fromName: "", receivedAt: Date.UTC(2026, 9, 14, 9, 12), timeZone: "UTC", text, truncated: false, attachments: [] });
    expect(blocks.length).toBe(1002);
    expect(blocks[0]!.text).toEqual([{ type: "text", text: "From a@example.com, 14 Oct 2026, 09:12" }]);
    expect(blocks.at(-1)!.text).toEqual([{ type: "text", text: "This email was too long to save in full." }]);
    const ranks = blocks.map((b) => b.rank);
    expect([...ranks].sort()).toEqual(ranks);
  });
});
