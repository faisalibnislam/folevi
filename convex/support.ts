// Support requests: the support page and the app's "Contact support" (through the web server's
// /api/support route), email to support@folevi.com (Mailtrap Email Inbound → http.ts), the requester's own
// list in the app, and the admin console's Support inbox. See docs/SUPPORT.md.
//
// Privacy and safety:
// - The account is attached only from the signed-in session (never from an address someone typed, nor
//   from an email's From line, which anyone can forge).
// - Answers never reveal whether an address has an account.
// - Logs carry ticket numbers, counts and codes only, never addresses or message text.
// - Staff reads of a ticket are audited like other user-data views; replies, notes, status changes and
//   assignments write audit entries.
import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { environment } from "./email";
import { optionalProfile, requirePlatformRole, requireProfile, type PlatformRole } from "./lib/auth";
import { recordAudit } from "./lib/audit";
import { keyedHash, timingSafeEqualHex } from "./lib/crypto";
import { fail } from "./lib/errors";
import { appUrl } from "./lib/notify";
import { consume } from "./lib/rateLimit";
import {
  SECURITY_MAILBOX,
  SOURCE_LABELS,
  SUPPORT_DOMAIN,
  SUPPORT_LIMITS,
  SUPPORT_MAILBOX,
  cleanLine,
  cleanText,
  isEmail,
  nextTicketNumber,
  normalizeEmail,
  subjectFrom,
  topicLabel,
  validateRequest,
  type SupportTopic,
} from "./lib/support";

/** Support staff and above can see and answer tickets (docs/ADMIN.md). */
const STAFF: PlatformRole[] = ["super_admin", "ops_admin", "support_admin"];

const vMeta = { requestId: v.optional(v.string()), clientHash: v.optional(v.string()) };
const vStatus = v.union(v.literal("open"), v.literal("pending"), v.literal("closed"));

type Ticket = Doc<"supportTickets">;
type Activity = "new" | "reply";

/** The web server proves itself with FOLEVI_SERVER_SECRET (like sharing.openPublicLink). */
function checkServerSecret(given: string): void {
  const secret = process.env.FOLEVI_SERVER_SECRET;
  if (!secret || given.length !== secret.length || !timingSafeEqualHex(given, secret)) fail("forbidden", "Not allowed.");
}

async function ticketByNumber(ctx: { db: MutationCtx["db"] }, number: number): Promise<Ticket | null> {
  if (!Number.isSafeInteger(number) || number <= 0) return null;
  return await ctx.db
    .query("supportTickets")
    .withIndex("by_number", (q) => q.eq("number", number))
    .unique();
}

async function createTicket(
  ctx: MutationCtx,
  input: { email: string; name: string; topic: SupportTopic; subject: string; message: string; source: Ticket["source"]; profileId?: Id<"profiles">; emailMessageId?: string; inboundMessageId?: string },
): Promise<{ ticket: Ticket; messageId: Id<"supportMessages"> }> {
  const now = Date.now();
  const number = await nextTicketNumber(ctx);
  const ticketId = await ctx.db.insert("supportTickets", {
    number,
    requesterEmail: input.email,
    profileId: input.profileId,
    name: input.name,
    topic: input.topic,
    subject: input.subject,
    status: "open",
    source: input.source,
    createdAt: now,
    updatedAt: now,
    lastMessageAt: now,
    unreadForStaff: true,
  });
  const messageId = await ctx.db.insert("supportMessages", {
    ticketId,
    authorKind: "requester",
    body: input.message,
    createdAt: now,
    emailMessageId: input.emailMessageId,
    inboundMessageId: input.inboundMessageId,
  });
  return { ticket: (await ctx.db.get(ticketId))!, messageId };
}

/** A requester message on an existing ticket: reopens it and marks it unread for staff. */
async function appendRequesterMessage(
  ctx: MutationCtx,
  ticket: Ticket,
  input: { message: string; emailMessageId?: string; inboundMessageId?: string },
): Promise<Id<"supportMessages">> {
  const now = Date.now();
  const messageId = await ctx.db.insert("supportMessages", {
    ticketId: ticket._id,
    authorKind: "requester",
    body: input.message,
    createdAt: now,
    emailMessageId: input.emailMessageId,
    inboundMessageId: input.inboundMessageId,
  });
  await ctx.db.patch(ticket._id, { status: "open", closedAt: undefined, unreadForStaff: true, lastMessageAt: now, updatedAt: now });
  return messageId;
}

/** "We got your message": the ticket number and the person's own message, from Folevi Support, Reply-To support@folevi.com. */
async function sendConfirmation(ctx: MutationCtx, ticket: Ticket, message: string): Promise<void> {
  await ctx.scheduler.runAfter(0, internal.email.sendTemplate, {
    key: "support_ticket_received",
    to: ticket.requesterEmail,
    idempotencyKey: `support-received:${ticket._id}`,
    dataVariables: { ticketNumber: ticket.number, topicLabel: topicLabel(ticket.topic), quotedMessage: message.slice(0, SUPPORT_LIMITS.message) },
  });
  await captureInDevMailbox(ctx, ticket.requesterEmail, "support_ticket_received");
}

/**
 * Outside production, support mail is also written to the development mailbox (like identity mail), so
 * local runs and automated tests can see it went out. The link is where the person finds their requests.
 */
async function captureInDevMailbox(ctx: MutationCtx, to: string, key: string): Promise<void> {
  if (environment() === "production") return;
  await ctx.scheduler.runAfter(0, internal.authEmails.recordDevMail, { to, key, actionUrl: `${appUrl()}/help` });
}

/**
 * Tells platform staff about a new ticket or a requester's reply: an in-app notification for each staff
 * member (once per ticket until they read it), and an email to SUPPORT_NOTIFY_EMAIL when it is set (never
 * the support mailbox itself, nor the requester, so a notice can't loop back into a ticket).
 */
async function notifyStaff(ctx: MutationCtx, ticket: Ticket, activity: Activity, messageId: Id<"supportMessages">): Promise<void> {
  const title = activity === "new" ? `New support request #${ticket.number}` : `Support request #${ticket.number} has a new reply`;
  const body = `${topicLabel(ticket.topic)} · ${SOURCE_LABELS[ticket.source]}. Open the admin console's Support inbox to answer.`;
  const now = Date.now();
  for (const role of STAFF) {
    const staff = await ctx.db
      .query("profiles")
      .withIndex("by_platform_role", (q) => q.eq("platformRole", role))
      .take(100);
    for (const member of staff) {
      if (member.status !== "active") continue;
      const unread = await ctx.db
        .query("notifications")
        .withIndex("by_profile_unread", (q) => q.eq("profileId", member._id).eq("readAt", undefined))
        .order("desc")
        .take(100);
      if (unread.some((n) => n.kind === "system" && n.title.includes(`#${ticket.number}`))) continue;
      await ctx.db.insert("notifications", { profileId: member._id, kind: "system", title, body, createdAt: now });
    }
  }
  const notify = normalizeEmail(process.env.SUPPORT_NOTIFY_EMAIL ?? "");
  if (notify && notify !== "none" && isEmail(notify) && notify !== SUPPORT_MAILBOX && notify !== SECURITY_MAILBOX && notify !== ticket.requesterEmail) {
    await ctx.scheduler.runAfter(0, internal.email.sendTemplate, {
      key: "support_staff_notice",
      to: notify,
      idempotencyKey: `support-staff:${messageId}`,
      dataVariables: {
        ticketNumber: ticket.number,
        activity: activity === "new" ? "New request" : "The requester replied",
        topicLabel: topicLabel(ticket.topic),
        sourceLabel: SOURCE_LABELS[ticket.source],
        adminUrl: `${appUrl()}/admin/support/${ticket.number}`,
      },
    });
  }
}

// ---------------------------------------------------------------- the support page and the app

/**
 * Opens a support request. Called only by the web server's /api/support route, which proves itself with
 * FOLEVI_SERVER_SECRET, passes a client key (a hash of the visitor's IP) for rate limiting, and forwards
 * the visitor's session when they are signed in. Signed in, the request is filed under their account and
 * their account's address (whatever the form said); signed out, under the address they typed.
 *
 * The answer is the same whether or not an address has an account. `website` is a honeypot: a person
 * never sees or fills it, so a request that does is dropped (with an answer that looks the same).
 */
export const submit = mutation({
  args: {
    serverSecret: v.string(),
    clientKey: v.string(),
    name: v.string(),
    email: v.optional(v.string()),
    topic: v.string(),
    message: v.string(),
    website: v.optional(v.string()),
    source: v.optional(v.union(v.literal("web_form"), v.literal("in_app"))),
  },
  handler: async (ctx, args) => {
    checkServerSecret(args.serverSecret);
    const profile = await optionalProfile(ctx);
    if (args.website && args.website.trim()) {
      console.log(JSON.stringify({ event: "support.honeypot" }));
      return { status: "received" as const, number: null };
    }
    // Cheap size guard before any work (the fields are validated precisely below).
    if (args.name.length > 1000 || args.message.length > 50_000 || (args.email ?? "").length > 1000) fail("invalid_argument", "That request is too long.");
    const request = validateRequest({
      name: args.name || profile?.displayName || "",
      email: profile ? profile.email : (args.email ?? ""),
      topic: args.topic,
      message: args.message,
    });
    const client = await keyedHash(args.clientKey.slice(0, 200), "client");
    await consume(ctx, "supportSubmit", client);
    await consume(ctx, "supportSubmitEmail", request.email);
    const source = profile && args.source === "in_app" ? "in_app" : "web_form";
    const { ticket, messageId } = await createTicket(ctx, {
      email: request.email,
      name: request.name,
      topic: request.topic,
      subject: subjectFrom(request.message),
      message: request.message,
      source,
      profileId: profile?._id,
    });
    await sendConfirmation(ctx, ticket, request.message);
    await notifyStaff(ctx, ticket, "new", messageId);
    console.log(JSON.stringify({ event: "support.ticket_created", ticket: ticket.number, source, signedIn: Boolean(profile) }));
    return { status: "received" as const, number: ticket.number };
  },
});

/** The signed-in person's support requests (filed from their account), newest first, with replies. Notes are never included. */
export const myRequests = query({
  args: {},
  handler: async (ctx) => {
    const profile = await requireProfile(ctx);
    const tickets = await ctx.db
      .query("supportTickets")
      .withIndex("by_profile_last", (q) => q.eq("profileId", profile._id))
      .order("desc")
      .take(20);
    const out = [];
    for (const t of tickets) {
      const messages = await ctx.db
        .query("supportMessages")
        .withIndex("by_ticket", (q) => q.eq("ticketId", t._id))
        .take(200);
      out.push({
        number: t.number,
        subject: t.subject,
        topic: t.topic,
        topicLabel: topicLabel(t.topic),
        status: t.status,
        createdAt: t.createdAt,
        lastMessageAt: t.lastMessageAt,
        messages: messages
          .filter((m) => m.authorKind !== "note")
          .map((m) => ({ id: m._id as string, from: m.authorKind === "staff" ? ("support" as const) : ("you" as const), body: m.body, createdAt: m.createdAt })),
      });
    }
    return out;
  },
});

/** The requester answers one of their own requests from the app (it reopens it for staff). */
export const replyToMyRequest = mutation({
  args: { number: v.number(), message: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const ticket = await ticketByNumber(ctx, args.number);
    if (!ticket || ticket.profileId !== profile._id) fail("not_found", "Request not found.");
    if (args.message.length > 50_000) fail("invalid_argument", "That message is too long.");
    const message = cleanText(args.message, SUPPORT_LIMITS.message + 1);
    if (message.length < 2) fail("invalid_argument", "Write a reply first.", { field: "message" });
    if (message.length > SUPPORT_LIMITS.message) fail("invalid_argument", `Keep your reply under ${SUPPORT_LIMITS.message} characters.`, { field: "message" });
    await consume(ctx, "supportSubmitEmail", ticket.requesterEmail);
    const messageId = await appendRequesterMessage(ctx, ticket, { message });
    await notifyStaff(ctx, (await ctx.db.get(ticket._id))!, "reply", messageId);
    console.log(JSON.stringify({ event: "support.requester_reply", ticket: ticket.number, via: "app" }));
    return null;
  },
});

// ---------------------------------------------------------------- inbound email

/** Whether this Mailtrap inbound message was already handled (webhooks retry). */
export const inboundSeen = internalQuery({
  args: { inboundMessageId: v.string() },
  handler: async (ctx, args) => {
    const hit = await ctx.db
      .query("supportMessages")
      .withIndex("by_inbound_message", (q) => q.eq("inboundMessageId", args.inboundMessageId))
      .first();
    return hit !== null;
  },
});

/**
 * Files one inbound email (already signature-checked, fetched and parsed by http.ts):
 * - de-duplicated by Mailtrap's message id and by the RFC Message-ID;
 * - auto-replies and bounces, mail from Folevi's own domain and mail for other folevi.com mailboxes are ignored;
 * - "[Folevi #N]" in the subject, from that ticket's requester, adds to ticket N (reopening it); anything
 *   else (no tag, or a different sender) opens a new ticket with source "email";
 * - rate limited per sender; over the limit the message is dropped (Mailtrap keeps its copy).
 */
export const ingestInbound = internalMutation({
  args: {
    inboundMessageId: v.string(),
    fromAddress: v.string(),
    fromName: v.string(),
    to: v.array(v.string()),
    cc: v.array(v.string()),
    subject: v.string(),
    text: v.string(),
    rfcMessageId: v.union(v.string(), v.null()),
    automated: v.union(v.string(), v.null()),
    ticketNumber: v.union(v.number(), v.null()),
  },
  handler: async (ctx, args) => {
    const seen = await ctx.db
      .query("supportMessages")
      .withIndex("by_inbound_message", (q) => q.eq("inboundMessageId", args.inboundMessageId))
      .first();
    if (seen) return { outcome: "duplicate" as const, number: null };
    if (args.rfcMessageId) {
      const same = await ctx.db
        .query("supportMessages")
        .withIndex("by_email_message", (q) => q.eq("emailMessageId", args.rfcMessageId!))
        .first();
      if (same) return { outcome: "duplicate" as const, number: null };
    }
    if (args.automated) return { outcome: "ignored_automated" as const, number: null };
    const from = normalizeEmail(args.fromAddress);
    if (!isEmail(from)) return { outcome: "ignored_sender" as const, number: null };
    // Our own mail (support@, notices from the sending domain) never becomes a ticket: no loops.
    if (from.endsWith(`@${SUPPORT_DOMAIN}`) || from.endsWith(`.${SUPPORT_DOMAIN}`)) return { outcome: "ignored_own_domain" as const, number: null };
    // A catch-all inbox receives mail for every folevi.com address; only support@ and security@ are tickets.
    const recipients = [...args.to, ...args.cc].map(normalizeEmail);
    const ours = recipients.filter((r) => r.endsWith(`@${SUPPORT_DOMAIN}`));
    const toSupport = ours.includes(SUPPORT_MAILBOX);
    const toSecurity = ours.includes(SECURITY_MAILBOX);
    if (ours.length > 0 && !toSupport && !toSecurity) return { outcome: "ignored_mailbox" as const, number: null };
    try {
      await consume(ctx, "supportInbound", from);
    } catch {
      return { outcome: "rate_limited" as const, number: null };
    }
    const text = cleanText(args.text, 20_000) || "(This email had no text.)";
    const emailMessageId = args.rfcMessageId ?? undefined;
    if (args.ticketNumber !== null) {
      const existing = await ticketByNumber(ctx, args.ticketNumber);
      if (existing && existing.requesterEmail === from) {
        const messageId = await appendRequesterMessage(ctx, existing, { message: text, emailMessageId, inboundMessageId: args.inboundMessageId });
        await notifyStaff(ctx, (await ctx.db.get(existing._id))!, "reply", messageId);
        return { outcome: "appended" as const, number: existing.number };
      }
    }
    const subject = cleanLine(args.subject.replace(/^((re|fwd?|aw|sv)\s*:\s*)+/i, ""), SUPPORT_LIMITS.subject) || subjectFrom(text);
    const { ticket, messageId } = await createTicket(ctx, {
      email: from,
      name: cleanLine(args.fromName, SUPPORT_LIMITS.name) || from.split("@")[0]!,
      topic: toSecurity && !toSupport ? "security" : "other",
      subject,
      message: text,
      source: "email",
      emailMessageId,
      inboundMessageId: args.inboundMessageId,
    });
    await sendConfirmation(ctx, ticket, text);
    await notifyStaff(ctx, ticket, "new", messageId);
    return { outcome: "created" as const, number: ticket.number };
  },
});

// ---------------------------------------------------------------- admin console

async function audit(ctx: MutationCtx, admin: Doc<"profiles">, action: string, ticketNumber: number | string, extra: { before?: unknown; after?: unknown; requestId?: string; clientHash?: string } = {}) {
  await recordAudit(ctx, admin, { action, targetType: "support_ticket", targetId: String(ticketNumber), ...extra });
}

/** How many tickets have a requester message staff haven't opened (the Support nav count). Aggregate only. */
export const unreadCount = query({
  args: {},
  handler: async (ctx) => {
    await requirePlatformRole(ctx, STAFF);
    const rows = await ctx.db
      .query("supportTickets")
      .withIndex("by_unread", (q) => q.eq("unreadForStaff", true))
      .take(100);
    return rows.length;
  },
});

/**
 * The Support inbox: newest activity first, filtered by status, or one ticket by number ("1042", "#1042")
 * or all tickets from one exact address. Audited (it shows who wrote in); a search query is stored hashed.
 */
export const listTickets = mutation({
  args: {
    status: v.optional(vStatus),
    search: v.optional(v.string()),
    cursor: v.optional(v.union(v.string(), v.null())),
    ...vMeta,
  },
  handler: async (ctx, args) => {
    const admin = await requirePlatformRole(ctx, STAFF);
    const search = (args.search ?? "").trim().toLowerCase().slice(0, 254);
    await recordAudit(ctx, admin, {
      action: "support.list",
      targetType: "support_tickets",
      targetId: search ? await keyedHash(search, "admin-search") : (args.status ?? "all"),
      requestId: args.requestId,
      clientHash: args.clientHash,
    });
    let rows: Ticket[];
    let continueCursor: string | null = null;
    if (search) {
      const asNumber = /^#?\d{1,9}$/.test(search) ? Number(search.replace("#", "")) : null;
      if (asNumber !== null) {
        const t = await ticketByNumber(ctx, asNumber);
        rows = t ? [t] : [];
      } else if (search.includes("@")) {
        rows = await ctx.db
          .query("supportTickets")
          .withIndex("by_email_last", (q) => q.eq("requesterEmail", search))
          .order("desc")
          .take(100);
      } else {
        fail("invalid_argument", "Search by ticket number (1042) or an exact email address.", { field: "search" });
      }
      if (args.status) rows = rows.filter((t) => t.status === args.status);
    } else {
      const base = args.status
        ? ctx.db.query("supportTickets").withIndex("by_status_last", (q) => q.eq("status", args.status!))
        : ctx.db.query("supportTickets").withIndex("by_last_message");
      const page = await base.order("desc").paginate({ cursor: args.cursor ?? null, numItems: 50 });
      rows = page.page;
      continueCursor = page.isDone ? null : page.continueCursor;
    }
    const names = new Map<string, string>();
    const nameOf = async (id: Id<"profiles"> | undefined) => {
      if (!id) return null;
      if (!names.has(id)) names.set(id, (await ctx.db.get(id))?.displayName ?? "Staff");
      return names.get(id)!;
    };
    const tickets = [];
    for (const t of rows) {
      tickets.push({
        number: t.number,
        name: t.name,
        email: t.requesterEmail,
        topic: t.topic,
        topicLabel: topicLabel(t.topic),
        subject: t.subject,
        status: t.status,
        source: t.source,
        signedIn: Boolean(t.profileId),
        unread: t.unreadForStaff,
        assignee: await nameOf(t.assigneeId),
        assignedToMe: t.assigneeId === admin._id,
        createdAt: t.createdAt,
        lastMessageAt: t.lastMessageAt,
      });
    }
    return { tickets, continueCursor };
  },
});

/** One ticket with its whole thread (notes included). Audited as a view of user data; marks it read for staff. */
export const viewTicket = mutation({
  args: { number: v.number(), ...vMeta },
  handler: async (ctx, args) => {
    const admin = await requirePlatformRole(ctx, STAFF);
    const t = await ticketByNumber(ctx, args.number);
    if (!t) fail("not_found", "Ticket not found.");
    await audit(ctx, admin, "support.view", t.number, { requestId: args.requestId, clientHash: args.clientHash });
    if (t.unreadForStaff) await ctx.db.patch(t._id, { unreadForStaff: false });
    const messages = await ctx.db
      .query("supportMessages")
      .withIndex("by_ticket", (q) => q.eq("ticketId", t._id))
      .take(500);
    const staffNames = new Map<string, string>();
    for (const m of messages) {
      if (m.staffProfileId && !staffNames.has(m.staffProfileId)) staffNames.set(m.staffProfileId, (await ctx.db.get(m.staffProfileId))?.displayName ?? "Staff");
    }
    // An account filed it (signed in), or an account merely uses the same address (unverified: anyone can type an address).
    const account = t.profileId ? await ctx.db.get(t.profileId) : null;
    const sameAddress = account
      ? null
      : await ctx.db
          .query("profiles")
          .withIndex("by_email", (q) => q.eq("email", t.requesterEmail))
          .first();
    const assignee = t.assigneeId ? await ctx.db.get(t.assigneeId) : null;
    const history = await ctx.db
      .query("adminAuditLogs")
      .withIndex("by_target", (q) => q.eq("targetType", "support_ticket").eq("targetId", String(t.number)))
      .order("desc")
      .take(30);
    const actorNames = new Map<string, string>();
    for (const h of history) if (!actorNames.has(h.actorId)) actorNames.set(h.actorId, (await ctx.db.get(h.actorId))?.displayName ?? "Admin");
    return {
      number: t.number,
      name: t.name,
      email: t.requesterEmail,
      topic: t.topic,
      topicLabel: topicLabel(t.topic),
      subject: t.subject,
      status: t.status,
      source: t.source,
      sourceLabel: SOURCE_LABELS[t.source],
      createdAt: t.createdAt,
      lastMessageAt: t.lastMessageAt,
      assignee: assignee ? { id: assignee._id as string, name: assignee.displayName } : null,
      assignedToMe: t.assigneeId === admin._id,
      account: account ? { id: account._id as string, name: account.displayName, filedSignedIn: true } : sameAddress && sameAddress.status !== "deleted" ? { id: sameAddress._id as string, name: sameAddress.displayName, filedSignedIn: false } : null,
      messages: messages.map((m) => ({
        id: m._id as string,
        kind: m.authorKind,
        author: m.authorKind === "requester" ? t.name : (m.staffProfileId ? staffNames.get(m.staffProfileId) : null) ?? "Staff",
        body: m.body,
        createdAt: m.createdAt,
        viaEmail: Boolean(m.inboundMessageId),
      })),
      history: history.map((h) => ({ id: h._id as string, action: h.action, actor: actorNames.get(h.actorId) ?? "Admin", actorRole: h.actorRole, createdAt: h.createdAt, before: h.before ?? null, after: h.after ?? null })),
    };
  },
});

function staffText(value: string, what: string): string {
  if (value.length > 50_000) fail("invalid_argument", `That ${what} is too long.`);
  const text = cleanText(value, SUPPORT_LIMITS.reply + 1);
  if (text.length < 2) fail("invalid_argument", `Write the ${what} first.`, { field: "body" });
  if (text.length > SUPPORT_LIMITS.reply) fail("invalid_argument", `Keep the ${what} under ${SUPPORT_LIMITS.reply} characters.`, { field: "body" });
  return text;
}

/**
 * Answers the requester: emailed from Folevi Support (Reply-To support@folevi.com) with "[Folevi #N]" in the subject (threaded to
 * their last email when there is one), shown in their "Your support requests" list, and the ticket becomes
 * pending (waiting on them). Audited without the text (the thread keeps it).
 */
export const reply = mutation({
  args: { number: v.number(), body: v.string(), ...vMeta },
  handler: async (ctx, args) => {
    const admin = await requirePlatformRole(ctx, STAFF);
    const t = await ticketByNumber(ctx, args.number);
    if (!t) fail("not_found", "Ticket not found.");
    const text = staffText(args.body, "reply");
    const now = Date.now();
    const messageId = await ctx.db.insert("supportMessages", { ticketId: t._id, authorKind: "staff", staffProfileId: admin._id, body: text, createdAt: now });
    await ctx.db.patch(t._id, { status: "pending", closedAt: undefined, unreadForStaff: false, lastMessageAt: now, updatedAt: now, assigneeId: t.assigneeId ?? admin._id });
    await audit(ctx, admin, "support.reply", t.number, { before: { status: t.status }, after: { status: "pending", messageId, characters: text.length }, requestId: args.requestId, clientHash: args.clientHash });
    // Thread the email to the requester's latest email, when the conversation started or continued by email.
    const earlier = await ctx.db
      .query("supportMessages")
      .withIndex("by_ticket", (q) => q.eq("ticketId", t._id))
      .order("desc")
      .take(200);
    const emailed = earlier.filter((m) => m.authorKind === "requester" && m.emailMessageId).map((m) => m.emailMessageId!);
    await ctx.scheduler.runAfter(0, internal.email.sendTemplate, {
      key: "support_reply",
      to: t.requesterEmail,
      idempotencyKey: `support-reply:${messageId}`,
      dataVariables: { ticketNumber: t.number, replyText: text },
      ...(emailed.length ? { thread: { inReplyTo: emailed[0], references: emailed.slice(0, 10).reverse() } } : {}),
    });
    await captureInDevMailbox(ctx, t.requesterEmail, "support_reply");
    if (t.profileId) {
      await ctx.db.insert("notifications", {
        profileId: t.profileId,
        kind: "system",
        title: `Folevi support replied to request #${t.number}`,
        body: "Read it in Help, under Your support requests. We also sent it by email.",
        createdAt: now,
      });
    }
    console.log(JSON.stringify({ event: "support.reply", ticket: t.number }));
    return { messageId: messageId as string };
  },
});

/** An internal note on a ticket: visible to staff only, never emailed or shown to the requester. */
export const addNote = mutation({
  args: { number: v.number(), body: v.string(), ...vMeta },
  handler: async (ctx, args) => {
    const admin = await requirePlatformRole(ctx, STAFF);
    const t = await ticketByNumber(ctx, args.number);
    if (!t) fail("not_found", "Ticket not found.");
    const text = staffText(args.body, "note");
    const now = Date.now();
    const messageId = await ctx.db.insert("supportMessages", { ticketId: t._id, authorKind: "note", staffProfileId: admin._id, body: text, createdAt: now });
    await ctx.db.patch(t._id, { updatedAt: now });
    await audit(ctx, admin, "support.note", t.number, { after: { messageId, characters: text.length }, requestId: args.requestId, clientHash: args.clientHash });
    return { messageId: messageId as string };
  },
});

export const setStatus = mutation({
  args: { number: v.number(), status: vStatus, ...vMeta },
  handler: async (ctx, args) => {
    const admin = await requirePlatformRole(ctx, STAFF);
    const t = await ticketByNumber(ctx, args.number);
    if (!t) fail("not_found", "Ticket not found.");
    if (t.status === args.status) return null;
    const now = Date.now();
    await ctx.db.patch(t._id, { status: args.status, closedAt: args.status === "closed" ? now : undefined, updatedAt: now });
    await audit(ctx, admin, "support.set_status", t.number, { before: { status: t.status }, after: { status: args.status }, requestId: args.requestId, clientHash: args.clientHash });
    return null;
  },
});

/** Assign a ticket to yourself, or clear its assignee. */
export const assign = mutation({
  args: { number: v.number(), to: v.union(v.literal("me"), v.literal("nobody")), ...vMeta },
  handler: async (ctx, args) => {
    const admin = await requirePlatformRole(ctx, STAFF);
    const t = await ticketByNumber(ctx, args.number);
    if (!t) fail("not_found", "Ticket not found.");
    const next = args.to === "me" ? admin._id : undefined;
    if (t.assigneeId === next) return null;
    await ctx.db.patch(t._id, { assigneeId: next, updatedAt: Date.now() });
    await audit(ctx, admin, "support.assign", t.number, { before: { assigneeId: t.assigneeId ?? null }, after: { assigneeId: next ?? null }, requestId: args.requestId, clientHash: args.clientHash });
    return null;
  },
});
