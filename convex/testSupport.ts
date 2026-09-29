// Test/development support. Internal functions only, callable with deployment credentials through the
// Convex CLI (`npx convex run testSupport:…`), never from browsers. They also refuse to run on a
// production deployment.
import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { SCHEMA_VERSION, normalizeForSearch, randomNoteCover, rankBetween, ulid, type WireBlock } from "@folevi/editor-schema";
import { createDocument } from "./lib/create";
import { nextSeq } from "./lib/seq";
import { insertScoped, personalScope } from "./lib/scope";
import { FOLDER_COLORS } from "./lib/folderColors";

function assertNotProduction() {
  if (process.env.FOLEVI_ENV === "production") throw new Error("testSupport functions are disabled in production.");
}

/** Ends someone's Pro trial now (e2e plan and device-limit tests). */
export const endTrial = internalMutation({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    assertNotProduction();
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_email", (q) => q.eq("email", args.email.trim().toLowerCase()))
      .unique();
    if (!profile) throw new Error("No profile with that email. Sign in once first.");
    const sub = await ctx.db
      .query("subscriptions")
      .withIndex("by_profile", (q) => q.eq("profileId", profile._id))
      .unique();
    if (sub) await ctx.db.patch(sub._id, { trialEndsAt: Date.now() - 1, updatedAt: Date.now() });
    return null;
  },
});

/** Sets (or clears, with null) someone's device limit, for trying the device-limit screen locally. */
export const setDeviceLimit = internalMutation({
  args: { email: v.string(), devices: v.union(v.number(), v.literal("unlimited"), v.null()) },
  handler: async (ctx, args) => {
    assertNotProduction();
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_email", (q) => q.eq("email", args.email.trim().toLowerCase()))
      .unique();
    if (!profile) throw new Error("No profile with that email. Sign in once first.");
    const sub = await ctx.db
      .query("subscriptions")
      .withIndex("by_profile", (q) => q.eq("profileId", profile._id))
      .unique();
    if (!sub) throw new Error("No billing record yet.");
    await ctx.db.patch(sub._id, { deviceLimitOverride: args.devices ?? undefined, updatedAt: Date.now() });
    return null;
  },
});

/**
 * Adds another signed-in "device" (an auth session) for someone, dated before their other sessions, so the
 * browser they're using becomes the newest device, e.g. to see the device-limit screen locally.
 */
export const addDemoDevice = internalMutation({
  args: { email: v.string(), userAgent: v.optional(v.string()) },
  handler: async (ctx, args) => {
    assertNotProduction();
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_email", (q) => q.eq("email", args.email.trim().toLowerCase()))
      .unique();
    if (!profile) throw new Error("No profile with that email. Sign in once first.");
    const now = Date.now();
    const created = now - 60 * 86_400_000;
    await ctx.runMutation(components.betterAuth.adapter.create, {
      input: {
        model: "session",
        data: {
          userId: profile.authSubject,
          token: `demo-${ulid()}`,
          expiresAt: now + 7 * 86_400_000,
          createdAt: created,
          updatedAt: created,
          userAgent: args.userAgent ?? "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
        },
      },
    });
    return null;
  },
});

/** Grants a platform role to an existing profile (e2e admin tests). Audited like any role change. */
export const grantPlatformRole = internalMutation({
  args: { email: v.string(), role: v.union(v.literal("super_admin"), v.literal("support_admin"), v.literal("ops_admin")) },
  handler: async (ctx, args) => {
    assertNotProduction();
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_email", (q) => q.eq("email", args.email.trim().toLowerCase()))
      .unique();
    if (!profile) throw new Error("No profile with that email. Sign in once first.");
    await ctx.db.patch(profile._id, { platformRole: args.role });
    await ctx.db.insert("adminAuditLogs", {
      actorId: profile._id,
      actorRole: args.role,
      action: "test.grant_platform_role",
      targetType: "profile",
      targetId: profile._id,
      reason: "Granted by the test-support CLI on a non-production deployment",
      requestId: ulid(),
      createdAt: Date.now(),
    });
    return profile._id;
  },
});

// ---------------------------------------------------------------------------------------------------
// Demo content for trying Folevi at scale (local/preview only): folders, tags and realistic notes.
//   npx convex run testSupport:seedDemoContent '{"email":"you@example.com"}'
// Runs in batches (it reschedules itself) so each transaction stays small.
// ---------------------------------------------------------------------------------------------------

const TOPICS = [
  "Garden", "Kitchen", "Reading", "Travel", "Studio", "Fitness", "Budget", "Research", "Podcast", "Design", "Product", "Hiring",
  "Writing", "Music", "Photography", "Home", "Learning", "Health", "Family", "Weekend", "Client", "Launch", "Roadmap", "Journal",
  "Recipes", "Meetings", "Ideas", "Workshop", "Planning", "Archive notes", "Coffee", "Cycling", "Language", "Film", "Architecture",
  "Ceramics", "Hiking", "Newsletter", "Volunteering", "Taxes", "Moving", "Wedding", "Renovation", "Onboarding", "Retreat",
  "Conference", "Side project", "Book club", "Interviews", "Operations", "Marketing", "Sales", "Support", "Community", "Events",
];
const TAG_WORDS = [
  "draft", "idea", "todo", "urgent", "later", "reference", "reading", "travel", "recipe", "meeting", "decision", "question", "insight",
  "quote", "book", "article", "podcast", "video", "design", "research", "client", "personal", "work", "health", "money", "family",
  "home", "garden", "learning", "writing", "music", "photo", "film", "weekly", "monthly", "q1", "q2", "q3", "q4", "2026", "archive",
  "review", "planning", "retro", "howto", "checklist", "template", "snippet", "bug", "feature", "roadmap", "launch", "hiring", "team",
  "sales", "support", "ops", "legal", "finance", "events",
];
const TAG_SUFFIX = ["", "-notes", "-ideas", "-2026", "-list"];
const NOTE_KINDS = ["Plan", "Notes", "Checklist", "Ideas", "Review", "Draft", "Log", "Brief", "Outline", "Summary", "Guide", "Recap"];
const ICONS = ["📝", "📓", "📚", "🌿", "☕️", "🧭", "🎯", "💡", "🗺", "📷", "🎨", "🧪", "🏡", "✈️", "🚀", "💼", "🧠", "🌻", "🍋", "🎵", null, null, null];
const SENTENCES = [
  "Start small and keep the first version honest.",
  "The quiet mornings are the best time to write this down.",
  "We agreed to revisit the decision after two weeks of real use.",
  "Everything here is provisional until the numbers come back.",
  "Keep the list short enough to finish in one sitting.",
  "Most of the work is deciding what not to do.",
  "Bring the notebook, a pencil and a spare battery.",
  "The first draft is for finding out what the piece is about.",
  "Ask for feedback early, when changes are still cheap.",
  "Measure twice, write the summary once, then share it.",
  "A good checklist fits on one screen and survives a busy day.",
  "Follow up with everyone who replied before Friday.",
  "The budget has a little room for one more experiment.",
  "Leave a note for future me about why this was chosen.",
  "Light through the kitchen window made the whole room feel slower.",
];
const TODOS = ["Book the tickets", "Reply to the thread", "Draft the outline", "Water the tomatoes", "Send the invoice", "Order the prints", "Review the pull request", "Call the landlord", "Update the budget sheet", "Pick up the parcel", "Schedule the retro", "Back up the photos"];
const CODE = ["const total = items.reduce((sum, i) => sum + i.price, 0);", "SELECT title, updated_at FROM notes ORDER BY updated_at DESC LIMIT 10;", "git switch -c feature/new-idea"];

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function demoProfile(ctx: { db: import("./_generated/server").MutationCtx["db"] }, email: string) {
  const profile = await ctx.db
    .query("profiles")
    .withIndex("by_email", (q) => q.eq("email", email.trim().toLowerCase()))
    .unique();
  if (!profile) throw new Error("No profile for that email. Sign in and finish onboarding first.");
  // Demo content goes into the person's Personal.
  return { profile, scope: personalScope(profile._id) };
}

export const seedDemoContent = internalMutation({
  args: { email: v.string(), notes: v.optional(v.number()), folders: v.optional(v.number()), tags: v.optional(v.number()), seed: v.optional(v.number()) },
  handler: async (ctx, args) => {
    assertNotProduction();
    const { profile, scope } = await demoProfile(ctx, args.email);
    const rand = rng(args.seed ?? 20260926);
    const now = Date.now();

    // Folders: mostly top level, some nested one level (the product allows one level).
    const existingFolders = await ctx.db
      .query("folders")
      .withIndex("by_owner", (q) => q.eq("ownerProfileId", scope.profileId))
      .collect();
    const folderNames = new Set(existingFolders.map((f) => f.name.toLowerCase()));
    let lastRank = existingFolders.map((f) => f.rank).sort().pop() ?? null;
    const folderTarget = args.folders ?? 50;
    const roots: Id<"folders">[] = [];
    let made = 0;
    for (let i = 0; made < folderTarget && i < TOPICS.length * 3; i++) {
      const base = TOPICS[i % TOPICS.length]!;
      const name = i < TOPICS.length ? base : `${base} ${2024 + Math.floor(i / TOPICS.length)}`;
      if (folderNames.has(name.toLowerCase())) continue;
      folderNames.add(name.toLowerCase());
      const nested = made >= Math.round(folderTarget * 0.8) && roots.length > 0;
      lastRank = rankBetween(lastRank, null);
      const id = await insertScoped(ctx, "folders", scope, {
        publicId: ulid(),
        parentFolderId: nested ? roots[Math.floor(rand() * roots.length)] : undefined,
        name,
        color: FOLDER_COLORS[Math.floor(rand() * FOLDER_COLORS.length)],
        rank: lastRank,
        createdBy: profile._id,
        createdAt: now - Math.floor(rand() * 200) * 86_400_000,
        updatedAt: now - Math.floor(rand() * 60) * 86_400_000,
        seq: await nextSeq(ctx, scope),
      });
      if (!nested) roots.push(id);
      made++;
    }

    // Tags.
    const existingTags = await ctx.db
      .query("tags")
      .withIndex("by_owner", (q) => q.eq("ownerProfileId", scope.profileId))
      .collect();
    const tagNames = new Set(existingTags.map((t) => t.normalizedName));
    const colors = ["accent", "moss", "marigold", "plum", "coral", "muted"];
    const tagTarget = args.tags ?? 200;
    let tagsMade = 0;
    for (const suffix of TAG_SUFFIX) {
      for (const word of TAG_WORDS) {
        if (tagsMade >= tagTarget) break;
        const name = `${word}${suffix}`;
        const normalized = normalizeForSearch(name);
        if (tagNames.has(normalized)) continue;
        tagNames.add(normalized);
        await insertScoped(ctx, "tags", scope, { publicId: ulid(), name, normalizedName: normalized, color: colors[tagsMade % colors.length]!, createdAt: now - tagsMade * 3_600_000, seq: await nextSeq(ctx, scope) });
        tagsMade++;
      }
    }

    await ctx.scheduler.runAfter(0, internal.testSupport.seedDemoNotes, { email: args.email, remaining: args.notes ?? 200, seed: (args.seed ?? 20260926) + 1 });
    return { folders: made, tags: tagsMade, notesScheduled: args.notes ?? 200 };
  },
});

function demoBlocks(rand: () => number, dayMs: number): WireBlock[] {
  const out: WireBlock[] = [];
  let rank: string | null = null;
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)]!;
  const text = (t: string) => [{ type: "text" as const, text: t }];
  const add = (type: string, props: Record<string, unknown>, t: string | null) => {
    rank = rankBetween(rank, null);
    out.push({ id: ulid(), type, parentId: null, rank, schemaVersion: SCHEMA_VERSION, text: t === null ? [] : text(t), props });
  };
  add("paragraph", {}, `${pick(SENTENCES)} ${pick(SENTENCES)}`);
  const sections = 1 + Math.floor(rand() * 3);
  for (let s = 0; s < sections; s++) {
    add("heading", { level: 2 }, pick(["Before we start", "What we know", "Next steps", "Open questions", "Notes", "Plan", "Ideas", "Summary", "Details"]));
    const kind = rand();
    if (kind < 0.3) {
      const n = 2 + Math.floor(rand() * 4);
      for (let i = 0; i < n; i++) {
        const due = rand() < 0.4 ? new Date(dayMs + Math.floor(rand() * 30 - 5) * 86_400_000).toISOString().slice(0, 10) : undefined;
        add("todo", { checked: rand() < 0.35, ...(due ? { dueDate: due } : {}) }, pick(TODOS));
      }
    } else if (kind < 0.55) {
      const n = 2 + Math.floor(rand() * 4);
      for (let i = 0; i < n; i++) add(rand() < 0.5 ? "bulleted" : "numbered", {}, pick(SENTENCES));
    } else if (kind < 0.7) {
      add("quote", {}, pick(SENTENCES));
      add("paragraph", {}, pick(SENTENCES));
    } else if (kind < 0.8) {
      add("callout", { tone: pick(["note", "info", "success", "warning"]) }, pick(SENTENCES));
    } else if (kind < 0.9) {
      const rows = [["Item", "Owner", "Status"], ["Outline", "Ada", "Done"], ["Draft", "Sam", "In progress"], ["Review", "Lee", "Next"]].map((r) => r.map((c) => text(c)));
      add("table", { rows, headerRow: true }, null);
    } else {
      add("code", { language: "typescript", code: pick(CODE) }, null);
    }
    if (rand() < 0.3) add("paragraph", {}, pick(SENTENCES));
  }
  if (rand() < 0.3) add("divider", {}, null);
  return out;
}

export const seedDemoNotes = internalMutation({
  args: { email: v.string(), remaining: v.number(), seed: v.number() },
  handler: async (ctx, args) => {
    assertNotProduction();
    const { profile, scope } = await demoProfile(ctx, args.email);
    const rand = rng(args.seed);
    const folders = (
      await ctx.db
        .query("folders")
        .withIndex("by_owner", (q) => q.eq("ownerProfileId", scope.profileId))
        .collect()
    ).filter((f) => !f.deletedAt);
    const tags = await ctx.db
      .query("tags")
      .withIndex("by_owner", (q) => q.eq("ownerProfileId", scope.profileId))
      .collect();
    const recent = await ctx.db
      .query("documents")
      .withIndex("by_owner_updated", (q) => q.eq("ownerProfileId", scope.profileId))
      .order("desc")
      .take(40);
    const parents = recent.filter((d) => d.kind === "document" && !d.parentDocumentId && !d.inTrash);
    const batch = Math.min(25, args.remaining);
    const now = Date.now();
    for (let i = 0; i < batch; i++) {
      const topic = TOPICS[Math.floor(rand() * TOPICS.length)]!;
      const title = `${topic} ${NOTE_KINDS[Math.floor(rand() * NOTE_KINDS.length)]!.toLowerCase()}${rand() < 0.4 ? ` (${["spring", "week 12", "v2", "draft", "October", "Q3", "kickoff"][Math.floor(rand() * 7)]})` : ""}`;
      const daysAgo = Math.floor(rand() * 120);
      const updatedAt = now - daysAgo * 86_400_000 - Math.floor(rand() * 86_400_000);
      const nested = rand() < 0.08 && parents.length > 0;
      const cover = randomNoteCover(rand);
      const doc = await createDocument(ctx, {
        scope,
        actor: profile,
        title,
        icon: ICONS[Math.floor(rand() * ICONS.length)] ?? null,
        parentDocumentId: nested ? parents[Math.floor(rand() * parents.length)]!._id : undefined,
        folderId: !nested && rand() < 0.75 && folders.length ? folders[Math.floor(rand() * folders.length)]!._id : undefined,
        cover,
        style: {
          font: (["sans", "sans", "serif", "serif", "mono", "rounded"] as const)[Math.floor(rand() * 6)]!,
          width: "wide",
          background: "paper",
          accent: (["accent", "moss", "marigold", "plum", "coral"] as const)[Math.floor(rand() * 5)]!,
          card: "folio",
        },
        blocks: demoBlocks(rand, updatedAt),
      });
      await ctx.db.patch(doc._id, { createdAt: updatedAt - Math.floor(rand() * 30) * 86_400_000, updatedAt });
      const tagCount = Math.floor(rand() * 5);
      const chosen = new Set<Id<"tags">>();
      for (let t = 0; t < tagCount && tags.length; t++) chosen.add(tags[Math.floor(rand() * tags.length)]!._id);
      for (const tagId of chosen) await insertScoped(ctx, "documentTags", scope, { documentId: doc._id, tagId });
      if (rand() < 0.1) await insertScoped(ctx, "stars", scope, { profileId: profile._id, documentId: doc._id, createdAt: updatedAt });
      if (!nested) parents.push(doc);
    }
    const remaining = args.remaining - batch;
    if (remaining > 0) await ctx.scheduler.runAfter(0, internal.testSupport.seedDemoNotes, { email: args.email, remaining, seed: args.seed + 1 });
    return { created: batch, remaining };
  },
});
