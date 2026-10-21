// Outbound webhooks: Folevi POSTs a small signed JSON event to an https endpoint someone added in
// Settings → Connected apps when, in the places they chose, a note is created, updated or moved to Trash,
// a task is created or completed, or a comment is written.
//
// The places where those things happen call lib/webhooks.ts emitWebhook, which queues a webhookEvents row
// (only when someone there listens). `fanout` turns it into one delivery per endpoint whose owner can read
// the note, and `deliver` sends it, retrying with backoff for about a day. An endpoint whose deliveries keep
// failing is turned off, and its owner told in the notifications bell.
//
// Payloads are minimal on purpose: notes carry their title and link, never their content; tasks carry
// their text (that's what a task is); comments carry ids and the note's link, never the comment's words.
import { v } from "convex/values";
import { internalAction, internalMutation, mutation, query, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { ulid } from "@folevi/editor-schema";
import { accessAtLeast, assertWritable, documentAccess, requireProfile, resolveScope } from "./lib/auth";
import { fail } from "./lib/errors";
import { appUrl } from "./lib/notify";
import { consume } from "./lib/rateLimit";
import { openSecret, randomToken, sealSecret } from "./lib/crypto";
import { scopeOfRow } from "./lib/scope";
import { DISABLE_AFTER_FAILED_DELIVERIES, LOG_SIZE, MAX_WEBHOOKS, placeKey, postWebhook, retryDelay, sealedEventsAllowed, WEBHOOK_EVENTS, webhookUrlProblem } from "./lib/webhooks";
import { isSealed, readableFor } from "./lib/e2ee/state";

const SEAL = "webhook";

const noteLink = (publicId: string) => `${appUrl()}/d/${publicId}`;
const iso = (ms: number) => new Date(ms).toISOString();

// ---------------------------------------------------------------- Settings → Connected apps

export const list = query({
  args: {},
  handler: async (ctx) => {
    const profile = await requireProfile(ctx);
    const hooks = await ctx.db
      .query("webhooks")
      .withIndex("by_profile", (q) => q.eq("profileId", profile._id))
      .take(MAX_WEBHOOKS + 5);
    const out = [];
    for (const h of hooks) {
      const places: string[] = h.personal ? ["Personal"] : [];
      for (const id of h.workspaceIds) {
        const w = await ctx.db.get(id);
        if (w && w.status !== "deleting") places.push(w.name);
      }
      const attempts = await ctx.db
        .query("webhookAttempts")
        .withIndex("by_webhook", (q) => q.eq("webhookId", h._id))
        .order("desc")
        .take(LOG_SIZE);
      out.push({
        id: h._id as string,
        url: h.url,
        events: h.events,
        places,
        enabled: h.enabled,
        disabledAt: h.disabledAt ?? null,
        createdAt: h.createdAt,
        attempts: attempts.map((a) => ({ type: a.type, ok: a.ok, statusCode: a.statusCode ?? null, error: a.error ?? null, at: a.at, durationMs: a.durationMs })),
      });
    }
    return out.sort((a, b) => a.createdAt - b.createdAt);
  },
});

/** Adds an endpoint. Its signing secret is returned this once (Folevi keeps it sealed, to sign with). */
export const create = mutation({
  args: { url: v.string(), events: v.array(v.string()), personal: v.boolean(), workspaceIds: v.array(v.string()) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const url = args.url.trim();
    const problem = webhookUrlProblem(url);
    if (problem) fail("invalid_argument", problem);
    const events = WEBHOOK_EVENTS.filter((e) => args.events.includes(e));
    if (!events.length) fail("invalid_argument", "Choose at least one event.");
    const workspaceIds: Id<"workspaces">[] = [];
    for (const publicId of [...new Set(args.workspaceIds)].slice(0, 50)) {
      const { scope } = await resolveScope(ctx, profile, { kind: "workspace", workspaceId: publicId });
      if (scope.kind === "workspace") workspaceIds.push(scope.workspaceId);
    }
    if (!args.personal && !workspaceIds.length) fail("invalid_argument", "Choose at least one place.");
    const existing = await ctx.db
      .query("webhooks")
      .withIndex("by_profile", (q) => q.eq("profileId", profile._id))
      .take(MAX_WEBHOOKS + 1);
    if (existing.length >= MAX_WEBHOOKS) fail("limit_exceeded", `You can have up to ${MAX_WEBHOOKS} webhooks. Delete one first.`);
    const secret = `whsec_${randomToken(24)}`;
    const id = await ctx.db.insert("webhooks", {
      profileId: profile._id,
      url: new URL(url).href,
      events,
      personal: args.personal,
      workspaceIds,
      secretSealed: await sealSecret(secret, SEAL),
      enabled: true,
      failedInARow: 0,
      createdAt: Date.now(),
    });
    const places = [...(args.personal ? [placeKey({ kind: "personal", profileId: profile._id })] : []), ...workspaceIds.map((w) => placeKey({ kind: "workspace", workspaceId: w }))];
    for (const place of places) await ctx.db.insert("webhookPlaces", { webhookId: id, profileId: profile._id, place, events });
    return { id: id as string, secret };
  },
});

async function ownWebhook(ctx: MutationCtx, profile: Doc<"profiles">, webhookId: string): Promise<Doc<"webhooks">> {
  const id = ctx.db.normalizeId("webhooks", webhookId);
  const hook = id ? await ctx.db.get(id) : null;
  if (!hook || hook.profileId !== profile._id) fail("not_found", "That webhook isn't there.");
  return hook;
}

/** Turns an endpoint off or on again (on again starts its failure count afresh). */
export const setEnabled = mutation({
  args: { webhookId: v.string(), enabled: v.boolean() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const hook = await ownWebhook(ctx, profile, args.webhookId);
    await ctx.db.patch(hook._id, args.enabled ? { enabled: true, disabledAt: undefined, failedInARow: 0 } : { enabled: false });
    return null;
  },
});

/** Deletes an endpoint, what's waiting for it and its log. */
export const remove = mutation({
  args: { webhookId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const hook = await ownWebhook(ctx, profile, args.webhookId);
    for (const table of ["webhookPlaces", "webhookDeliveries", "webhookAttempts"] as const) {
      const rows = await ctx.db
        .query(table)
        .withIndex("by_webhook", (q) => q.eq("webhookId", hook._id))
        .take(1000);
      for (const r of rows) await ctx.db.delete(r._id);
    }
    await ctx.db.delete(hook._id);
    return null;
  },
});

/** Sends a test event now (one attempt, whatever the endpoint's state; it never turns it off). */
export const sendTest = mutation({
  args: { webhookId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const hook = await ownWebhook(ctx, profile, args.webhookId);
    await consume(ctx, "webhookTest", profile._id);
    const eventId = `evt_${ulid()}`;
    const now = Date.now();
    const payload = JSON.stringify({ id: eventId, type: "webhook.test", createdAt: iso(now), place: null, data: { message: "A test event from Folevi. Your endpoint is set up." } });
    const deliveryId = await ctx.db.insert("webhookDeliveries", { webhookId: hook._id, profileId: profile._id, eventId, type: "webhook.test", payload, status: "pending", attempts: 0, test: true, createdAt: now, updatedAt: now });
    await ctx.scheduler.runAfter(0, internal.webhooks.deliver, { deliveryId });
    return { eventId };
  },
});

// ---------------------------------------------------------------- fan-out and delivery

/** The event's data, as it is now; null when there's nothing to send any more (the note went, a task was removed). */
async function eventData(ctx: MutationCtx, event: Doc<"webhookEvents">, doc: Doc<"documents">): Promise<Record<string, unknown> | null> {
  // An encrypted note: what the space's readable copy for apps says, or nothing (the switch went off).
  if (isSealed(doc)) return await sealedEventData(ctx, event, doc);
  const note = { id: doc.publicId, title: doc.title || "Untitled", url: noteLink(doc.publicId) };
  switch (event.type) {
    case "note.created":
    case "note.updated":
      if (doc.inTrash || doc.deletedAt !== undefined) return null;
      return { ...note, createdAt: iso(doc.createdAt), updatedAt: iso(doc.updatedAt) };
    case "note.deleted":
      return { ...note, deletedAt: iso(doc.deletedAt ?? event.createdAt) };
    case "task.created":
    case "task.completed": {
      if (!event.taskBlockId) return null;
      const task = await ctx.db
        .query("tasks")
        .withIndex("by_block", (q) => q.eq("blockId", event.taskBlockId!))
        .unique();
      if (!task) return null;
      return {
        id: task.blockId,
        text: task.title,
        status: task.status,
        dueDate: task.dueDate ?? null,
        dueTime: task.dueTime ?? null,
        priority: task.priority,
        note,
        url: `${note.url}#block-${task.blockId}`,
      };
    }
    case "comment.created": {
      const comment = event.commentId ? await ctx.db.get(event.commentId) : null;
      if (!comment || comment.deletedAt !== undefined) return null;
      const thread = await ctx.db.get(comment.threadId);
      return { id: comment.publicId, threadId: thread?.publicId ?? null, note, url: note.url, createdAt: iso(comment.createdAt) };
    }
  }
  return null;
}

/** eventData for an encrypted note, from its readable copy for apps (docs/E2EE_DESIGN.md §7.4). */
async function sealedEventData(ctx: MutationCtx, event: Doc<"webhookEvents">, doc: Doc<"documents">): Promise<Record<string, unknown> | null> {
  if (!(await sealedEventsAllowed(ctx, doc))) return null;
  const copy = await readableFor(ctx, doc, "apps");
  if (!copy) return null;
  const note = { id: doc.publicId, title: copy.title || "Untitled", url: noteLink(doc.publicId) };
  switch (event.type) {
    case "note.created":
    case "note.updated":
      if (doc.inTrash || doc.deletedAt !== undefined) return null;
      return { ...note, createdAt: iso(doc.createdAt), updatedAt: iso(doc.updatedAt) };
    case "note.deleted":
      return { ...note, deletedAt: iso(doc.deletedAt ?? event.createdAt) };
    case "task.created":
    case "task.completed": {
      const task = copy.tasks?.find((t) => t.blockId === event.taskBlockId);
      if (!task) return null;
      return { id: task.blockId, text: task.text, status: task.done ? "done" : "open", dueDate: task.due ?? null, dueTime: task.dueTime ?? null, priority: "none", note, url: `${note.url}#block-${task.blockId}` };
    }
    case "comment.created": {
      const comment = event.commentId ? await ctx.db.get(event.commentId) : null;
      if (!comment || comment.deletedAt !== undefined) return null;
      const thread = await ctx.db.get(comment.threadId);
      return { id: comment.publicId, threadId: thread?.publicId ?? null, note, url: note.url, createdAt: iso(comment.createdAt) };
    }
  }
  return null;
}

/** An event to every endpoint listening in its place whose owner can read the note: one delivery each. */
export const fanout = internalMutation({
  args: { eventId: v.id("webhookEvents") },
  handler: async (ctx, args) => {
    const event = await ctx.db.get(args.eventId);
    if (!event) return 0;
    await ctx.db.delete(event._id);
    const doc = event.documentId ? await ctx.db.get(event.documentId) : null;
    if (!doc) return 0;
    const data = await eventData(ctx, event, doc);
    if (!data) return 0;
    const scope = scopeOfRow(doc);
    const workspace = scope.kind === "workspace" ? await ctx.db.get(scope.workspaceId) : null;
    const place = workspace ? { id: workspace.publicId, name: workspace.name } : { id: "personal", name: "Personal" };
    const listeners = await ctx.db
      .query("webhookPlaces")
      .withIndex("by_place", (q) => q.eq("place", event.place))
      .take(50);
    let sent = 0;
    const now = Date.now();
    for (const l of listeners) {
      if (!l.events.includes(event.type)) continue;
      const hook = await ctx.db.get(l.webhookId);
      if (!hook || !hook.enabled) continue;
      const owner = await ctx.db.get(hook.profileId);
      if (!owner || owner.status !== "active") continue;
      // Only what the endpoint's owner can read (a page restricted away from them sends nothing).
      if (!accessAtLeast(await documentAccess(ctx, owner, doc), "read")) continue;
      const eventId = `evt_${ulid()}`;
      const payload = JSON.stringify({ id: eventId, type: event.type, createdAt: iso(event.createdAt), place, data });
      const deliveryId = await ctx.db.insert("webhookDeliveries", { webhookId: hook._id, profileId: hook.profileId, eventId, type: event.type, payload, status: "pending", attempts: 0, createdAt: now, updatedAt: now });
      await ctx.scheduler.runAfter(0, internal.webhooks.deliver, { deliveryId });
      sent++;
    }
    return sent;
  },
});

/** What an attempt needs; a delivery for an endpoint that was deleted or turned off is given up instead. */
export const claim = internalMutation({
  args: { deliveryId: v.id("webhookDeliveries") },
  handler: async (ctx, args) => {
    const d = await ctx.db.get(args.deliveryId);
    if (!d || d.status !== "pending") return null;
    const hook = await ctx.db.get(d.webhookId);
    if (!hook || (!hook.enabled && !d.test)) {
      await ctx.db.patch(d._id, { status: "failed", payload: "", updatedAt: Date.now() });
      return null;
    }
    return { url: hook.url, secretSealed: hook.secretSealed, payload: d.payload, eventId: d.eventId, type: d.type };
  },
});

export const deliver = internalAction({
  args: { deliveryId: v.id("webhookDeliveries") },
  handler: async (ctx, args) => {
    const info = await ctx.runMutation(internal.webhooks.claim, { deliveryId: args.deliveryId });
    if (!info) return null;
    const started = Date.now();
    const result = await postWebhook(info.url, await openSecret(info.secretSealed, SEAL), info.payload, { eventId: info.eventId, type: info.type });
    console.log(JSON.stringify({ event: "webhook.attempt", type: info.type, ok: result.ok, status: result.statusCode ?? null, reason: result.error ?? null }));
    await ctx.runMutation(internal.webhooks.recordAttempt, { deliveryId: args.deliveryId, ok: result.ok, statusCode: result.statusCode, error: result.error, durationMs: Date.now() - started });
    return result;
  },
});

/** Logs an attempt, then: done, another try later, or given up (and the endpoint turned off when that keeps happening). */
export const recordAttempt = internalMutation({
  args: { deliveryId: v.id("webhookDeliveries"), ok: v.boolean(), statusCode: v.optional(v.number()), error: v.optional(v.string()), durationMs: v.number() },
  handler: async (ctx, args) => {
    const d = await ctx.db.get(args.deliveryId);
    if (!d || d.status !== "pending") return;
    const hook = await ctx.db.get(d.webhookId);
    const now = Date.now();
    if (!hook) {
      await ctx.db.delete(d._id);
      return;
    }
    await ctx.db.insert("webhookAttempts", {
      webhookId: hook._id,
      profileId: hook.profileId,
      type: d.type,
      eventId: d.eventId,
      ok: args.ok,
      ...(args.statusCode !== undefined ? { statusCode: args.statusCode } : {}),
      ...(args.error ? { error: args.error.slice(0, 80) } : {}),
      durationMs: args.durationMs,
      at: now,
    });
    const old = await ctx.db
      .query("webhookAttempts")
      .withIndex("by_webhook", (q) => q.eq("webhookId", hook._id))
      .order("desc")
      .take(LOG_SIZE + 10);
    for (const a of old.slice(LOG_SIZE)) await ctx.db.delete(a._id);

    const attempts = d.attempts + 1;
    if (args.ok) {
      await ctx.db.patch(d._id, { status: "delivered", payload: "", attempts, updatedAt: now });
      await ctx.db.patch(hook._id, { failedInARow: 0, lastAttemptAt: now });
      return;
    }
    const wait = d.test ? null : retryDelay(attempts);
    if (wait !== null && hook.enabled) {
      await ctx.db.patch(d._id, { attempts, updatedAt: now });
      await ctx.db.patch(hook._id, { lastAttemptAt: now });
      await ctx.scheduler.runAfter(wait, internal.webhooks.deliver, { deliveryId: d._id });
      return;
    }
    await ctx.db.patch(d._id, { status: "failed", payload: "", attempts, updatedAt: now });
    if (d.test) {
      await ctx.db.patch(hook._id, { lastAttemptAt: now });
      return;
    }
    const failedInARow = hook.failedInARow + 1;
    if (hook.enabled && failedInARow >= DISABLE_AFTER_FAILED_DELIVERIES) {
      await ctx.db.patch(hook._id, { enabled: false, disabledAt: now, failedInARow, lastAttemptAt: now });
      let host = hook.url;
      try {
        host = new URL(hook.url).host;
      } catch {
        // The stored address always parses; keep it whole otherwise.
      }
      await ctx.db.insert("notifications", {
        profileId: hook.profileId,
        kind: "system",
        title: "A webhook was turned off",
        body: `Deliveries to ${host} kept failing, so Folevi stopped sending them. Fix the endpoint, then turn it back on in Settings > Connected apps.`,
        createdAt: now,
      });
      console.warn(JSON.stringify({ event: "webhook.disabled", failedInARow }));
    } else {
      await ctx.db.patch(hook._id, { failedInARow, lastAttemptAt: now });
    }
  },
});

/** Drops finished deliveries after a week (daily). */
export const sweep = internalMutation({
  args: {},
  handler: async (ctx) => {
    const old = await ctx.db
      .query("webhookDeliveries")
      .withIndex("by_updated", (q) => q.lt("updatedAt", Date.now() - 7 * 24 * 60 * 60_000))
      .take(500);
    let n = 0;
    for (const d of old) {
      if (d.status === "pending") continue;
      await ctx.db.delete(d._id);
      n++;
    }
    return n;
  },
});
