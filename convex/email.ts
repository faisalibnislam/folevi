import { v } from "convex/values";
import { internalAction, internalQuery, type MutationCtx } from "./_generated/server";
import { internalMutation } from "./lib/functions";
import { internal } from "./_generated/api";
import { emailManifest, hashRecipient, isPlausibleEmail, postToFoleviMail, redactEmail, selectProvider, sendEmail, type ProviderSelection, type SendOutcome, type SmtpMessage, type TemplateKey } from "@folevi/email";
import { ulid } from "@folevi/editor-schema";
import type { Doc, Id } from "./_generated/dataModel";
import { bump, type MetricKey } from "./lib/metrics";
import { secretOrDevFallback } from "./lib/crypto";
import { connectToken, connectUrl, isServerEdition } from "./lib/edition";
import { fromAddress } from "./lib/serverSettings";
import { deployment } from "./lib/deployment";

type Environment = "production" | "preview" | "development" | "test";

export function environment(): Environment {
  return deployment();
}

const vTemplateKey = v.string();

/** Notices whose variables contain no one-time links or user-written content may be replayed by admins. */
const RESENDABLE = new Set(["security_new_device", "account_deletion_scheduled"]);

/** Templates that the daily digest replaces for people who chose it (never both). */
const DIGESTED = new Set<string>(["mention_notification", "comment_notification"]);

/**
 * Finer preferences a template may be sent under instead of its manifest `preferenceKey`, with the key
 * they fall back to while unset (a reply uses the comment email but has its own switch). Anything not
 * listed here is ignored, so a caller can never pick a looser preference.
 */
const REFINED_PREFERENCES: Record<string, Record<string, string>> = {
  comment_notification: { replies: "comments" },
  access_changed: { access: "shares" },
};

/**
 * Folevi-side preference check for product email. Mirrors lib/notify.ts#wantsImmediateEmail and is
 * enforced here again so no caller can bypass it.
 */
export function productEmailAllowed(key: string, preferenceKey: string, prefs: Record<string, unknown>, refined?: string): boolean {
  if (preferenceKey === "digest") return prefs.digest === "daily";
  const fallback = refined ? REFINED_PREFERENCES[key]?.[refined] : undefined;
  const choice = fallback ? (prefs[refined!] ?? prefs[fallback]) : prefs[preferenceKey];
  if (choice === false) return false;
  if (DIGESTED.has(key) && prefs.digest === "daily") return false;
  return true;
}

/**
 * Sends one transactional email through Resend. Records every attempt locally; a 2xx from the provider is
 * recorded as "accepted" (accepted by provider), never as "delivered". Delivery state only comes from
 * signed webhooks.
 *
 * The attempt row is the guard against a second send for the same notification: `beginAttempt` refuses
 * to start one for an idempotency key that was already accepted or is still in flight. Within one attempt,
 * Resend's Idempotency-Key (the attempt id) makes retried requests safe.
 */
export const sendTemplate = internalAction({
  args: {
    key: vTemplateKey,
    profileId: v.optional(v.id("profiles")),
    to: v.optional(v.string()),
    dataVariables: v.record(v.string(), v.union(v.string(), v.number())),
    idempotencyKey: v.string(),
    resendOf: v.optional(v.id("emailSendAttempts")),
    /** A finer preference for this send (see REFINED_PREFERENCES), e.g. "replies" for a reply's comment email. */
    preference: v.optional(v.string()),
    /** Threading headers for a support reply (message ids only; validated again by @folevi/email). */
    thread: v.optional(v.object({ inReplyTo: v.optional(v.string()), references: v.optional(v.array(v.string())) })),
  },
  handler: async (ctx, args) => {
    const key = args.key as TemplateKey;
    const def = emailManifest[key];
    if (!def) throw new Error(`unknown template ${args.key}`);
    let to = args.to ?? null;
    let profileId = args.profileId;
    if (!profileId && to) {
      // Mail addressed by email (identity mail, invitations) is linked to the account when one exists,
      // so it shows on the admin user page and product mail still honors that person's preferences.
      const linked = await ctx.runQuery(internal.email.profileByEmail, { email: to });
      if (linked) {
        profileId = linked.profileId;
        if (def.category === "product" && def.preferenceKey && !productEmailAllowed(key, def.preferenceKey, linked.prefs, args.preference)) return { status: "skipped" as const };
      }
    }
    if (args.profileId) {
      const recipient = await ctx.runQuery(internal.users.getForEmail, { profileId: args.profileId });
      if (!recipient || recipient.status === "deleted") return { status: "skipped" as const };
      to = recipient.email;
      // Product notifications honor Folevi-side preferences; security/identity mail is never suppressible.
      if (def.category === "product" && def.preferenceKey) {
        if (!productEmailAllowed(key, def.preferenceKey, recipient.prefs as Record<string, unknown>, args.preference)) return { status: "skipped" as const };
      }
    }
    if (!to) throw new Error("no recipient");
    const salt = secretOrDevFallback(["FOLEVI_HASH_SALT"], "folevi-development-salt");
    const recipientHash = await hashRecipient(to, salt);
    const requestId = ulid();
    let env = process.env as Record<string, string | undefined>;
    // Folevi Server picks its provider from its settings (null on Folevi Cloud, which uses Resend as always).
    const server = isServerEdition() ? await ctx.runQuery(internal.server.emailTransport, {}) : null;
    const provider = server ? serverProvider(server) : selectProvider(env, environment());
    // Folevi Mail sends from no-reply@folevi.app; replies go to the server's owner.
    if (server && provider.kind === "folevi" && server.ownerEmail) env = { ...env, EMAIL_REPLY_TO: server.ownerEmail };
    const attempt = await ctx.runMutation(internal.email.beginAttempt, {
      templateKey: key,
      category: def.category,
      recipientHash,
      recipientHint: redactEmail(to),
      profileId,
      idempotencyKey: args.idempotencyKey,
      environment: environment(),
      requestId,
      resendOf: args.resendOf,
      resendPayload: RESENDABLE.has(key) ? args.dataVariables : undefined,
      provider: provider.kind === "none" ? undefined : provider.kind,
    });
    if (attempt.alreadyAccepted) return { status: "accepted" as const, duplicate: true };
    if (attempt.inFlight) return { status: "queued" as const, duplicate: true };
    if (attempt.suppressed) {
      console.log(JSON.stringify({ event: "email.suppressed", template: key, requestId }));
      return { status: "skipped" as const };
    }

    if (provider.kind === "none" && server) {
      // A server with email off: nothing to send with, by the owner's choice. Not a failure.
      await ctx.runMutation(internal.email.finishAttempt, { attemptId: attempt.attemptId, status: "skipped", attempts: 0, errorCode: "email_off" });
      return { status: "skipped" as const };
    }
    if (provider.kind === "none") {
      await ctx.runMutation(internal.email.finishAttempt, { attemptId: attempt.attemptId, status: "failed", attempts: 0, errorCode: "provider_not_configured" });
      console.warn(JSON.stringify({ event: "email.not_configured", template: key, requestId }));
      return { status: "failed" as const };
    }
    const outcome = await sendEmail(
      { key, to, dataVariables: args.dataVariables, attemptId: attempt.attemptId, ...(args.thread ? { thread: args.thread } : {}) },
      {
        env,
        ...(server ? { provider, smtp: (message: SmtpMessage) => ctx.runAction(internal.smtpSend.deliver, { message }) as Promise<SendOutcome> } : {}),
        policy: {
          environment: environment(),
          allowlist: (process.env.FOLEVI_EMAIL_ALLOWLIST ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
        },
      },
    );
    await ctx.runMutation(internal.email.finishAttempt, {
      attemptId: attempt.attemptId,
      status: outcome.status,
      attempts: outcome.attempts,
      httpStatus: outcome.httpStatus,
      errorCode: outcome.errorCode,
      providerMessageId: outcome.providerMessageId,
      providerError: outcome.providerError,
    });
    console.log(
      JSON.stringify({ event: "email.send", provider: outcome.provider, template: key, status: outcome.status, attempts: outcome.attempts, code: outcome.errorCode, reason: outcome.providerError, requestId }),
    );
    return { status: outcome.status };
  },
});

type ServerTransport = { mode: "off" | "folevi" | "smtp"; configured: boolean; serverName: string; smtp: { from: string } | null };

/** Folevi Server's provider, from its settings (convex/server.ts emailTransport). */
export function serverProvider(t: ServerTransport): ProviderSelection {
  if (!t.configured) return { kind: "none" };
  if (t.mode === "folevi") {
    const token = connectToken();
    return token ? { kind: "folevi", baseUrl: connectUrl(), token } : { kind: "none" };
  }
  if (t.mode === "smtp" && t.smtp) {
    const email = fromAddress(t.smtp.from);
    if (!email) return { kind: "none" };
    const name = /^(.*?)\s*<[^<>]+>\s*$/.exec(t.smtp.from)?.[1]?.replace(/^"|"$/g, "").trim();
    return { kind: "smtp", from: { email, name: name || t.serverName } };
  }
  return { kind: "none" };
}

/**
 * Folevi Server's "Send test email" (serverAdmin.testEmail): one short plain message through the server's
 * settings, answering whether the provider took it. Never a template, never stored as a send attempt.
 */
export const sendServerTest = internalAction({
  args: { to: v.string() },
  handler: async (ctx, args): Promise<{ ok: boolean; error?: string }> => {
    const to = args.to.trim();
    if (!isPlausibleEmail(to)) return { ok: false, error: "Enter a valid email address." };
    const server = await ctx.runQuery(internal.server.emailTransport, {});
    if (!server) return { ok: false, error: "Not available." };
    const provider = serverProvider(server);
    const subject = `Test email from ${server.serverName}`;
    const text = `This is a test email from Folevi Server "${server.serverName}". If you can read it, email works.`;
    const html = `<p>${text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!)}</p>`;
    let outcome: SendOutcome;
    if (provider.kind === "folevi") {
      outcome = await postToFoleviMail({ to, subject, text, html, tag: "server_test" }, { baseUrl: provider.baseUrl, token: provider.token, idempotencyKey: `folevi-test-${Date.now()}`, maxAttempts: 1 });
    } else if (provider.kind === "smtp") {
      const message: SmtpMessage = { from: { email: provider.from.email, name: provider.from.name ?? server.serverName }, to, subject, text, html };
      outcome = (await ctx.runAction(internal.smtpSend.deliver, { message })) as SendOutcome;
    } else {
      return { ok: false, error: server.mode === "folevi" ? "Folevi Mail needs this server to be linked to Folevi Connect." : "Email is off on this server." };
    }
    console.log(JSON.stringify({ event: "email.server_test", provider: provider.kind, status: outcome.status, code: outcome.errorCode }));
    if (outcome.status === "accepted") return { ok: true };
    return { ok: false, error: describeFailure(outcome) };
  },
});

function describeFailure(o: SendOutcome): string {
  const reason = o.providerError ? ` (${o.providerError})` : "";
  switch (o.errorCode) {
    case "unauthorized":
      return `The mail server refused the user name or password${reason}.`;
    case "timeout":
      return "The mail server didn't answer in time.";
    case "network_error":
      return "The mail server couldn't be reached. Check its host name and port.";
    case "tls_unavailable":
      return "The mail server doesn't offer STARTTLS. Choose TLS or no encryption instead.";
    default:
      return `The email wasn't accepted${reason}.`;
  }
}

export const beginAttempt = internalMutation({
  args: {
    templateKey: v.string(),
    category: v.string(),
    recipientHash: v.string(),
    recipientHint: v.string(),
    profileId: v.optional(v.id("profiles")),
    idempotencyKey: v.string(),
    environment: v.string(),
    requestId: v.string(),
    resendOf: v.optional(v.id("emailSendAttempts")),
    resendPayload: v.optional(v.record(v.string(), v.union(v.string(), v.number()))),
    provider: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    if (!args.resendOf) {
      const previous = await ctx.db
        .query("emailSendAttempts")
        .withIndex("by_idempotency", (q) => q.eq("idempotencyKey", args.idempotencyKey))
        .take(20);
      // This row is what stops a retried or duplicated action from sending twice (each attempt gets its own
      // provider idempotency key). Accepted → never again; queued and recent → another run is sending it now.
      const accepted = previous.find((p) => p.status === "accepted");
      if (accepted) return { attemptId: accepted._id, alreadyAccepted: true, inFlight: false, suppressed: false };
      const running = previous.find((p) => p.status === "queued" && now - p.updatedAt < IN_FLIGHT_MS);
      if (running) return { attemptId: running._id, alreadyAccepted: false, inFlight: true, suppressed: false };
      // A queued row older than that belongs to a run that died before recording an outcome.
      for (const p of previous) {
        if (p.status === "queued") await ctx.db.patch(p._id, { status: "failed", errorCode: "abandoned", updatedAt: now });
      }
    }
    // Product email is never sent to an address that hard-bounced, complained or unsubscribed at the
    // provider. Identity and security email still goes: people must always be able to confirm an
    // address, reset a password or hear about a sign-in.
    const suppressed = args.category === "product" && (await isSuppressed(ctx, args.recipientHash));
    const attemptId = await ctx.db.insert("emailSendAttempts", {
      templateKey: args.templateKey,
      category: args.category,
      recipientHash: args.recipientHash,
      recipientHint: args.recipientHint,
      profileId: args.profileId,
      idempotencyKey: args.idempotencyKey,
      status: "queued",
      attempts: 0,
      environment: args.environment,
      requestId: args.requestId,
      createdAt: now,
      updatedAt: now,
      resendOf: args.resendOf,
      resendPayload: args.resendPayload,
      provider: args.provider,
      ...(suppressed ? { status: "skipped" as const, errorCode: "recipient_suppressed" } : {}),
    });
    return { attemptId, alreadyAccepted: false, inFlight: false, suppressed };
  },
});

/** How long a "queued" attempt blocks another send with the same idempotency key (a send takes seconds). */
const IN_FLIGHT_MS = 10 * 60 * 1000;

async function isSuppressed(ctx: MutationCtx, recipientHash: string): Promise<boolean> {
  const row = await ctx.db
    .query("emailSuppressions")
    .withIndex("by_recipient", (q) => q.eq("recipientHash", recipientHash))
    .first();
  return row !== null;
}

type SuppressionReason = Doc<"emailSuppressions">["reason"];

/** Records (or refreshes) a suppression for a hashed address. */
async function suppress(
  ctx: MutationCtx,
  input: { recipientHash: string; reason: SuppressionReason; provider: string; eventId?: string; attemptId?: Id<"emailSendAttempts"> },
): Promise<void> {
  const now = Date.now();
  const existing = await ctx.db
    .query("emailSuppressions")
    .withIndex("by_recipient", (q) => q.eq("recipientHash", input.recipientHash))
    .first();
  if (existing) {
    // A complaint outranks a bounce, which outranks an unsubscribe; keep the strongest reason.
    const rank: Record<SuppressionReason, number> = { unsubscribe: 0, hard_bounce: 1, spam_complaint: 2 };
    if (rank[input.reason] > rank[existing.reason]) await ctx.db.patch(existing._id, { reason: input.reason, eventId: input.eventId, updatedAt: now });
    return;
  }
  await ctx.db.insert("emailSuppressions", { ...input, createdAt: now, updatedAt: now });
  await bump(ctx, "email_suppressed");
}

export const finishAttempt = internalMutation({
  args: {
    attemptId: v.id("emailSendAttempts"),
    status: v.union(v.literal("accepted"), v.literal("failed"), v.literal("skipped")),
    attempts: v.number(),
    httpStatus: v.optional(v.number()),
    errorCode: v.optional(v.string()),
    providerMessageId: v.optional(v.string()),
    providerError: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.attemptId, {
      providerError: args.providerError?.slice(0, 200),
      status: args.status,
      attempts: args.attempts,
      httpStatus: args.httpStatus,
      errorCode: args.errorCode,
      providerMessageId: args.providerMessageId,
      updatedAt: Date.now(),
    });
    if (args.status === "failed") await bump(ctx, "email_failed");
    if (args.status === "accepted") await bump(ctx, "email_accepted");
  },
});

/** The active account for an address, if any (only its id and notification preferences). */
export const profileByEmail = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const p = await ctx.db
      .query("profiles")
      .withIndex("by_email", (q) => q.eq("email", args.email.trim().toLowerCase()))
      .first();
    if (!p || p.status === "deleted") return null;
    return { profileId: p._id, prefs: p.notificationPrefs as Record<string, unknown> };
  },
});

// ---------------------------------------------------------------- provider webhooks

/**
 * How much each delivery state says about a send: a later, weaker event never hides a stronger one
 * (a complaint after delivery stays a complaint; a delivery after a soft bounce shows as delivered).
 */
const DELIVERY_RANK: Record<string, number> = {
  soft_bounced: 1,
  delivered: 2,
  suspended: 3,
  suppressed: 3,
  rejected: 3,
  bounced: 3,
  spam_complaint: 4,
};

const SUPPRESSING: Record<string, SuppressionReason> = {
  bounced: "hard_bounce",
  // Resend refused to send because the address is on its suppression list (an earlier bounce or complaint).
  suppressed: "hard_bounce",
  spam_complaint: "spam_complaint",
  unsubscribed: "unsubscribe",
};

const DELIVERY_METRICS: Record<string, MetricKey> = {
  bounced: "email_bounced",
  spam_complaint: "email_spam_complaint",
  rejected: "email_rejected",
  suppressed: "email_rejected",
};

const vProviderEvent = v.object({
  eventId: v.string(),
  eventName: v.string(),
  eventTime: v.number(),
  messageId: v.optional(v.string()),
  recipient: v.optional(v.string()),
  category: v.optional(v.string()),
  attemptId: v.optional(v.string()),
  bounceCategory: v.optional(v.string()),
  responseCode: v.optional(v.number()),
});

/**
 * Stores a batch of signature-verified Resend events (http.ts → /webhooks/resend).
 *
 * - Deduplicated on the event id (svix-id; Resend retries failed deliveries with the same one).
 * - Matched to exactly one send: by the provider message id first, then by our attempt id (sent as the
 *   `attempt` tag), which must agree with the event's hashed recipient and template.
 * - The attempt's delivery state is updated; hard bounces, spam complaints and unsubscribes suppress
 *   further product email to that (hashed) address.
 * - Addresses are hashed before storage; nothing else from the event is kept.
 */
export const recordProviderEvents = internalMutation({
  args: { events: v.array(vProviderEvent) },
  handler: async (ctx, { events }) => {
    if (events.length > 200) throw new Error("too many events in one batch");
    const salt = secretOrDevFallback(["FOLEVI_HASH_SALT"], "folevi-development-salt");
    let stored = 0;
    let duplicates = 0;
    let matched = 0;
    for (const e of events) {
      const webhookId = `resend:${e.eventId}`.slice(0, 200);
      const dup = await ctx.db
        .query("emailProviderEvents")
        .withIndex("by_webhook_id", (q) => q.eq("webhookId", webhookId))
        .unique();
      if (dup) {
        duplicates++;
        continue;
      }
      const recipientHash = e.recipient ? await hashRecipient(e.recipient, salt) : undefined;
      let attempt: Doc<"emailSendAttempts"> | null = null;
      if (e.messageId) {
        attempt = await ctx.db
          .query("emailSendAttempts")
          .withIndex("by_provider_message", (q) => q.eq("providerMessageId", e.messageId))
          .first();
      }
      if (!attempt && e.attemptId) {
        const id = ctx.db.normalizeId("emailSendAttempts", e.attemptId);
        const candidate = id ? await ctx.db.get(id) : null;
        // The tag only links an event whose recipient and template agree with the send.
        if (
          candidate &&
          (!recipientHash || candidate.recipientHash === recipientHash) &&
          (!e.category || candidate.templateKey === e.category)
        ) {
          attempt = candidate;
        }
      }
      await ctx.db.insert("emailProviderEvents", {
        webhookId,
        eventName: e.eventName,
        eventTime: e.eventTime,
        providerEmailId: e.messageId,
        recipientHash,
        receivedAt: Date.now(),
        attemptId: attempt?._id,
        provider: "resend",
        category: e.category,
        bounceCategory: e.bounceCategory,
        responseCode: e.responseCode,
      });
      stored++;
      if (attempt) {
        matched++;
        const rank = DELIVERY_RANK[e.eventName];
        const current = attempt.deliveryStatus ? (DELIVERY_RANK[attempt.deliveryStatus] ?? 0) : 0;
        if (rank !== undefined && (rank > current || (rank === current && e.eventTime >= (attempt.deliveryUpdatedAt ?? 0)))) {
          await ctx.db.patch(attempt._id, { deliveryStatus: e.eventName, deliveryUpdatedAt: e.eventTime });
        }
      }
      const reason = SUPPRESSING[e.eventName];
      const hash = recipientHash ?? attempt?.recipientHash;
      if (reason && hash) await suppress(ctx, { recipientHash: hash, reason, provider: "resend", eventId: e.eventId, attemptId: attempt?._id });
      const metric = DELIVERY_METRICS[e.eventName];
      if (metric) await bump(ctx, metric);
    }
    return { stored, duplicates, matched };
  },
});
