// Notifications, digest, email log matching, feature flags and storage cleanup. These exercise the
// backend libraries directly (profiles are inserted, not signed in) so they don't depend on the
// identity provider.
import { describe, expect, test } from "vitest";
import { internal } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import type { MutationCtx } from "../../convex/_generated/server";
import { isFeatureEnabled, KNOWN_FLAGS } from "../../convex/lib/flags";
import { notify, notifyAccessChange, notifyAccessLostOnRestrict } from "../../convex/lib/notify";
import { createDocument } from "../../convex/lib/create";
import { hashRecipient } from "@folevi/email";
import { setup, type T } from "./helpers";

type Prefs = Doc<"profiles">["notificationPrefs"];
const DEFAULT_PREFS: Prefs = { mentions: true, comments: true, shares: true, invites: true, digest: "off", productEmail: false };

async function insertProfile(ctx: MutationCtx, email: string, prefs: Partial<Prefs> = {}): Promise<Id<"profiles">> {
  const now = Date.now();
  return await ctx.db.insert("profiles", {
    tokenIdentifier: `test|${email}`,
    authSubject: `test|${email}`,
    authIssuer: "https://test.folevi.local",
    email,
    emailVerified: true,
    mfaVerified: true,
    displayName: email.split("@")[0]!,
    appearance: "system",
    locale: "en",
    timeZone: "UTC",
    onboardingStep: "done",
    status: "active",
    notificationPrefs: { ...DEFAULT_PREFS, ...prefs },
    createdAt: now,
    lastActiveAt: now,
  });
}

async function insertWorkspace(ctx: MutationCtx, owner: Id<"profiles">, members: [Id<"profiles">, Doc<"workspaceMembers">["role"]][] = []) {
  const now = Date.now();
  const workspaceId = await ctx.db.insert("workspaces", {
    publicId: `ws-${now}-${Math.random().toString(36).slice(2)}`,
    name: "Field Notes",
    kind: "team",
    ownerId: owner,
    changeSeq: 0,
    status: "active",
    storageUsedBytes: 0,
    storageQuotaBytes: 1e9,
    memberLimit: 50,
    documentCount: 0,
    createdAt: now,
    updatedAt: now,
  });
  await ctx.db.insert("workspaceMembers", { workspaceId, profileId: owner, role: "owner", joinedAt: now });
  for (const [profileId, role] of members) await ctx.db.insert("workspaceMembers", { workspaceId, profileId, role, joinedAt: now });
  return workspaceId;
}

/** Owner + editor member + outside guest, and one document in the owner's workspace. */
async function world(t: T, prefs: { member?: Partial<Prefs>; guest?: Partial<Prefs> } = {}) {
  return await t.run(async (ctx) => {
    const owner = await insertProfile(ctx, "owner@example.com");
    const member = await insertProfile(ctx, "member@example.com", prefs.member);
    const guest = await insertProfile(ctx, "guest@example.com", prefs.guest);
    const workspaceId = await insertWorkspace(ctx, owner, [[member, "editor"]]);
    const actor = (await ctx.db.get(owner))!;
    const doc = await createDocument(ctx, { scope: { kind: "workspace", workspaceId }, actor, title: "Spring planting plan" });
    return { owner, member, guest, workspaceId, docId: doc._id };
  });
}

async function scheduledEmails(t: T) {
  return await t.run(async (ctx) => {
    const rows = await ctx.db.system.query("_scheduled_functions").collect();
    return rows
      .filter((r) => r.name.includes("sendTemplate"))
      .map((r) => r.args[0] as { key: string; profileId?: string; dataVariables: Record<string, string | number> });
  });
}

describe("feature flags", () => {
  test("defaults apply until an admin flips a flag; unknown keys fail closed", async () => {
    const t = setup();
    await t.run(async (ctx) => {
      for (const f of KNOWN_FLAGS) expect(await isFeatureEnabled(ctx, f.key)).toBe(f.default);
      expect(await isFeatureEnabled(ctx, "not_a_flag")).toBe(false);
      await ctx.db.insert("featureFlags", { key: "workspace_invites", enabled: false, description: "x", updatedAt: Date.now() });
      await ctx.db.insert("featureFlags", { key: "new_signups", enabled: false, description: "x", updatedAt: Date.now() });
      expect(await isFeatureEnabled(ctx, "workspace_invites")).toBe(false);
      expect(await isFeatureEnabled(ctx, "new_signups")).toBe(false);
      expect(await isFeatureEnabled(ctx, "public_links")).toBe(true);
    });
  });
});

describe("notification emails", () => {
  test("mention and comment emails never carry note or comment text; in-app keeps the excerpt", async () => {
    const t = setup();
    const w = await world(t);
    await t.run(async (ctx) => {
      const actor = (await ctx.db.get(w.owner))!;
      const doc = (await ctx.db.get(w.docId))!;
      await notify(ctx, { recipientId: w.member, actor, kind: "mention", doc, title: "owner mentioned you", excerpt: "the secret soil notes", email: { key: "mention_notification" } });
      await notify(ctx, { recipientId: w.member, actor, kind: "comment", doc, title: "owner commented", excerpt: "private comment words", email: { key: "comment_notification" } });
    });
    const emails = await scheduledEmails(t);
    expect(emails.map((e) => e.key).sort()).toEqual(["comment_notification", "mention_notification"]);
    for (const e of emails) {
      expect(e.dataVariables).not.toHaveProperty("excerpt");
      expect(JSON.stringify(e.dataVariables)).not.toMatch(/secret soil|private comment/);
    }
    const inApp = await t.run(async (ctx) => await ctx.db.query("notifications").collect());
    expect(inApp.map((n) => n.body).sort()).toEqual(["private comment words", "the secret soil notes"]);
    // Emailed notifications are marked so the digest can never repeat them.
    expect(inApp.every((n) => n.emailedAt !== undefined)).toBe(true);
  });

  test("people who can't read the document get nothing", async () => {
    const t = setup();
    const w = await world(t);
    await t.run(async (ctx) => {
      const actor = (await ctx.db.get(w.owner))!;
      const doc = (await ctx.db.get(w.docId))!;
      await notify(ctx, { recipientId: w.guest, actor, kind: "mention", doc, title: "x", email: { key: "mention_notification" } });
    });
    expect(await scheduledEmails(t)).toEqual([]);
    expect(await t.run(async (ctx) => (await ctx.db.query("notifications").collect()).length)).toBe(0);
  });
});

describe("daily digest", () => {
  test("digest subscribers get one digest instead of per-event emails, and nothing is sent twice", async () => {
    const t = setup();
    const w = await world(t, { member: { digest: "daily" } });
    const now = Date.now();
    await t.run(async (ctx) => {
      const actor = (await ctx.db.get(w.owner))!;
      const doc = (await ctx.db.get(w.docId))!;
      await notify(ctx, { recipientId: w.member, actor, kind: "comment", doc, title: "owner commented on Spring planting plan", excerpt: "hidden", email: { key: "comment_notification" } });
      await notify(ctx, { recipientId: w.member, actor, kind: "mention", doc, title: "owner mentioned you in Spring planting plan", excerpt: "hidden", email: { key: "mention_notification" } });
    });
    expect(await scheduledEmails(t)).toEqual([]);

    const first = await t.mutation(internal.digest.sendDailyDigests, { now: now + 1000 });
    expect(first.sent).toBe(1);
    const digests = (await scheduledEmails(t)).filter((e) => e.key === "comment_digest");
    expect(digests).toHaveLength(1);
    expect(digests[0]!.dataVariables.count).toBe(2);
    expect(String(digests[0]!.dataVariables.summary)).toMatch(/Spring planting plan/);
    expect(String(digests[0]!.dataVariables.summary)).not.toMatch(/hidden/);

    const second = await t.mutation(internal.digest.sendDailyDigests, { now: now + 2000 });
    expect(second.sent).toBe(0);
  });

  test("the digest honors per-kind preferences and skips people who emailed immediately", async () => {
    const t = setup();
    const w = await world(t, { member: { digest: "daily", mentions: false } });
    await t.run(async (ctx) => {
      const actor = (await ctx.db.get(w.owner))!;
      const doc = (await ctx.db.get(w.docId))!;
      await notify(ctx, { recipientId: w.member, actor, kind: "mention", doc, title: "mentioned", email: { key: "mention_notification" } });
      // Owner has the digest off: gets an immediate email, so never a digest.
      const member = (await ctx.db.get(w.member))!;
      await notify(ctx, { recipientId: w.owner, actor: member, kind: "comment", doc, title: "commented", email: { key: "comment_notification" } });
    });
    const result = await t.mutation(internal.digest.sendDailyDigests, { now: Date.now() + 1000 });
    expect(result.sent).toBe(0);
    expect((await scheduledEmails(t)).map((e) => e.key)).toEqual(["comment_notification"]);
  });
});

describe("access change notifications", () => {
  test("role change keeps a link; revocation names the page but never links to it", async () => {
    const t = setup();
    const w = await world(t);
    await t.run(async (ctx) => {
      const actor = (await ctx.db.get(w.owner))!;
      const doc = (await ctx.db.get(w.docId))!;
      await ctx.db.insert("documentPermissions", { documentId: doc._id, workspaceId: doc.workspaceId, profileId: w.guest, role: "viewer", grantedBy: w.owner, createdAt: Date.now() });
      await notifyAccessChange(ctx, { recipientId: w.guest, actor, change: { type: "document_role", doc, role: "commenter" } });
      const grant = await ctx.db
        .query("documentPermissions")
        .withIndex("by_document_profile", (q) => q.eq("documentId", doc._id).eq("profileId", w.guest))
        .unique();
      await ctx.db.delete(grant!._id);
      await notifyAccessChange(ctx, { recipientId: w.guest, actor, change: { type: "document_revoked", doc } });
    });
    const rows = await t.run(async (ctx) => await ctx.db.query("notifications").collect());
    expect(rows.map((r) => r.title)).toEqual([
      "owner changed your access to “Spring planting plan” to Can comment.",
      "owner removed your access to “Spring planting plan”.",
    ]);
    expect(rows[0]!.documentId).toBe(w.docId);
    expect(rows[1]!.documentId).toBeUndefined();
    const emails = await scheduledEmails(t);
    expect(emails.map((e) => e.key)).toEqual(["access_changed", "access_changed"]);
    expect(emails[1]!.dataVariables.actionUrl).toMatch(/\/documents$/);
  });

  test("restricting a page tells exactly the members who lost access", async () => {
    const t = setup();
    const w = await world(t, { member: { shares: false } });
    const notified = await t.run(async (ctx) => {
      const actor = (await ctx.db.get(w.owner))!;
      const before = (await ctx.db.get(w.docId))!;
      await ctx.db.patch(before._id, { accessMode: "restricted" });
      return await notifyAccessLostOnRestrict(ctx, actor, before);
    });
    expect(notified).toBe(1);
    const rows = await t.run(async (ctx) => await ctx.db.query("notifications").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]!.profileId).toBe(w.member);
    expect(rows[0]!.documentId).toBeUndefined();
    // In-app always; the member turned share emails off.
    expect(await scheduledEmails(t)).toEqual([]);
  });

  test("workspace role changes and removals", async () => {
    const t = setup();
    const w = await world(t);
    await t.run(async (ctx) => {
      const actor = (await ctx.db.get(w.owner))!;
      const workspace = (await ctx.db.get(w.workspaceId))!;
      await notifyAccessChange(ctx, { recipientId: w.member, actor, change: { type: "workspace_role", workspace, role: "viewer" } });
      await notifyAccessChange(ctx, { recipientId: w.member, actor, change: { type: "workspace_removed", workspace } });
      // Never to yourself.
      await notifyAccessChange(ctx, { recipientId: w.owner, actor, change: { type: "workspace_removed", workspace } });
    });
    const rows = await t.run(async (ctx) => await ctx.db.query("notifications").collect());
    expect(rows.map((r) => r.title)).toEqual(["owner changed your role in “Field Notes” to Viewer.", "owner removed you from “Field Notes”."]);
    expect(rows[1]!.workspaceId).toBeUndefined();
  });
});

describe("email log", () => {
  async function attempt(t: T, fields: { to: string; transactionalId?: string; providerMessageId?: string; createdAt: number }) {
    const recipientHash = await hashRecipient(fields.to, "test-salt");
    return await t.run(async (ctx) =>
      ctx.db.insert("emailSendAttempts", {
        templateKey: "mention_notification",
        category: "product",
        recipientHash,
        recipientHint: "r***@example.com",
        idempotencyKey: `k-${Math.random()}`,
        status: "accepted",
        attempts: 1,
        environment: "test",
        requestId: "req",
        createdAt: fields.createdAt,
        updatedAt: fields.createdAt,
        transactionalId: fields.transactionalId,
        providerMessageId: fields.providerMessageId,
      }),
    );
  }

  test("webhook events link to their send by provider id, else by recipient + template + time", async () => {
    const t = setup();
    const now = Date.now();
    const byId = await attempt(t, { to: "a@example.com", transactionalId: "tpl_mention", providerMessageId: "em_1", createdAt: now - 60_000 });
    const older = await attempt(t, { to: "b@example.com", transactionalId: "tpl_mention", createdAt: now - 120_000 });
    const other = await attempt(t, { to: "b@example.com", transactionalId: "tpl_comment", createdAt: now - 30_000 });
    const seconds = Math.floor(now / 1000);
    const r1 = await t.mutation(internal.email.recordProviderEvent, { webhookId: "w1", eventName: "email.delivered", eventTime: seconds, providerEmailId: "em_1", recipient: "someone-else@example.com" });
    const r2 = await t.mutation(internal.email.recordProviderEvent, { webhookId: "w2", eventName: "email.hardBounced", eventTime: seconds, transactionalId: "tpl_mention", recipient: "b@example.com" });
    const dup = await t.mutation(internal.email.recordProviderEvent, { webhookId: "w2", eventName: "email.hardBounced", eventTime: seconds, transactionalId: "tpl_mention", recipient: "b@example.com" });
    const r3 = await t.mutation(internal.email.recordProviderEvent, { webhookId: "w3", eventName: "email.delivered", eventTime: seconds, transactionalId: "tpl_unknown", recipient: "nobody@example.com" });
    expect([r1.matched, r2.matched, dup.duplicate, r3.matched]).toEqual([true, true, true, false]);
    const events = await t.run(async (ctx) => await ctx.db.query("emailProviderEvents").collect());
    const byWebhook = Object.fromEntries(events.map((e) => [e.webhookId, e]));
    expect(byWebhook.w1!.attemptId).toBe(byId);
    // The comment email to b@ was more recent, but the event names the mention template.
    expect(byWebhook.w2!.attemptId).toBe(older);
    expect(byWebhook.w2!.attemptId).not.toBe(other);
    expect(byWebhook.w3!.attemptId).toBeUndefined();
    // Stored in milliseconds.
    expect(byWebhook.w1!.eventTime).toBe(seconds * 1000);
  });
});

describe("storage cleanup", () => {
  test("unreferenced blobs past the grace period are swept; referenced and fresh ones stay", async () => {
    const t = setup();
    const w = await world(t);
    const ids = await t.run(async (ctx) => {
      const orphan = await ctx.storage.store(new Blob(["abandoned upload"]));
      const kept = await ctx.storage.store(new Blob(["real image"]));
      await ctx.db.insert("files", {
        publicId: "01HZZZZZZZZZZZZZZZZZZZZZZZ",
        storageId: kept,
        workspaceId: w.workspaceId,
        documentId: w.docId,
        uploadedBy: w.owner,
        filename: "a.png",
        mimeType: "image/png",
        size: 10,
        sha256: "",
        kind: "image",
        status: "ready",
        createdAt: Date.now(),
      });
      return { orphan, kept };
    });
    // Nothing is old enough yet.
    expect((await t.mutation(internal.files.sweepOrphanedStorage, {})).deleted).toBe(0);
    const later = Date.now() + 2 * 24 * 60 * 60 * 1000;
    expect((await t.mutation(internal.files.sweepOrphanedStorage, { now: later })).deleted).toBe(1);
    await t.run(async (ctx) => {
      expect(await ctx.storage.get(ids.orphan)).toBeNull();
      expect(await ctx.storage.get(ids.kept)).not.toBeNull();
    });
  });

  test("export ZIPs are removed after their retention window", async () => {
    const t = setup();
    const w = await world(t);
    await t.run(async (ctx) => {
      const storageId = await ctx.storage.store(new Blob(["zip"]));
      await ctx.db.insert("files", {
        publicId: "01HYYYYYYYYYYYYYYYYYYYYYYY",
        storageId,
        workspaceId: w.workspaceId,
        uploadedBy: w.owner,
        filename: "export.zip",
        mimeType: "application/zip",
        size: 3,
        sha256: "",
        kind: "export",
        status: "ready",
        createdAt: Date.now(),
      });
    });
    expect(await t.mutation(internal.files.purgeExpiredExports, {})).toBe(0);
    expect(await t.mutation(internal.files.purgeExpiredExports, { now: Date.now() + 2 * 24 * 60 * 60 * 1000 })).toBe(1);
    expect(await t.run(async (ctx) => (await ctx.db.query("files").collect()).length)).toBe(0);
  });
});
