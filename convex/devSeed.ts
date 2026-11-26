// A generated test library for performance work (docs/perf/backend-results.md): 5,000 notes, 200 folders,
// 2,000 tasks and some long notes with images, in the Personal of a test account (an @example.com address).
// Internal functions only, and they refuse to run on production (FOLEVI_ENV=production) or for any other
// address, so nobody's real library is touched. On a development or local deployment:
//
//   1. sign in once as e.g. perf@example.com (creates the profile), then
//   2. npx convex run devSeed:seedLibrary '{"email":"perf@example.com"}'
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internalMutation } from "./lib/functions";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { rankSequence, ulid } from "@folevi/editor-schema";
import { createDocument } from "./lib/create";
import { nextSeq } from "./lib/seq";
import { insertScoped, personalScope } from "./lib/scope";
import { FAKE_LIBRARY, fakeFolder, fakeNote } from "./lib/fakeLibrary";
import { FOLDER_COLORS } from "./lib/folderColors";
import { isProductionDeployment } from "./lib/deployment";

/** Refuses production and anyone but a test address (the seed writes thousands of rows into their Personal). */
function guard(email: string) {
  if (isProductionDeployment()) throw new Error("devSeed is disabled in production.");
  if (!/^[^@\s]+@example\.com$/i.test(email.trim())) throw new Error("devSeed only fills test accounts (an @example.com address).");
}

async function profileOf(ctx: { db: import("./_generated/server").MutationCtx["db"] }, email: string) {
  const profile = await ctx.db
    .query("profiles")
    .withIndex("by_email", (q) => q.eq("email", email.trim().toLowerCase()))
    .unique();
  if (!profile) throw new Error("No profile with that email. Sign in once first.");
  return profile;
}

/** The library's folders and tags; returns their ids for seedNotes. */
export const seedFolders = internalMutation({
  args: { email: v.string() },
  handler: async (ctx, args): Promise<{ folderIds: Id<"folders">[]; tagIds: Id<"tags">[] }> => {
    guard(args.email);
    const profile = await profileOf(ctx, args.email);
    const scope = personalScope(profile._id);
    const now = Date.now();
    const ranks = rankSequence(FAKE_LIBRARY.folders);
    const folderIds: Id<"folders">[] = [];
    for (let i = 0; i < FAKE_LIBRARY.folders; i++) {
      const f = fakeFolder(i);
      folderIds.push(
        await insertScoped(ctx, "folders", scope, {
          publicId: ulid(),
          parentFolderId: f.parent === null ? undefined : folderIds[f.parent],
          name: f.name,
          color: FOLDER_COLORS[i % FOLDER_COLORS.length],
          rank: ranks[i]!,
          createdBy: profile._id,
          createdAt: now,
          updatedAt: now - (i + 1) * 3_600_000,
          seq: await nextSeq(ctx, scope),
        }),
      );
    }
    const tagIds: Id<"tags">[] = [];
    for (let i = 0; i < FAKE_LIBRARY.tags; i++) {
      const name = `tag-${i + 1}`;
      tagIds.push(await insertScoped(ctx, "tags", scope, { publicId: ulid(), name, normalizedName: name, color: "accent", createdAt: now, seq: await nextSeq(ctx, scope) }));
    }
    return { folderIds, tagIds };
  },
});

/** Notes `from` to `from + count - 1` of the library (createDocument, so derived text, tasks and counts are real). */
export const seedNotes = internalMutation({
  args: { email: v.string(), folderIds: v.array(v.id("folders")), tagIds: v.array(v.id("tags")), from: v.number(), count: v.number() },
  handler: async (ctx, args): Promise<{ done: boolean; next: number }> => {
    guard(args.email);
    const profile = await profileOf(ctx, args.email);
    const scope = personalScope(profile._id);
    const now = Date.now();
    const end = Math.min(args.from + args.count, FAKE_LIBRARY.notes);
    for (let i = args.from; i < end; i++) {
      const n = fakeNote(i);
      const doc = await createDocument(ctx, {
        scope,
        actor: profile,
        title: n.title,
        icon: "📝",
        folderId: n.folder === null ? undefined : args.folderIds[n.folder],
        blocks: n.blocks,
      });
      const at = now - n.ageMs;
      await ctx.db.patch(doc._id, { createdAt: at, updatedAt: at });
      if (args.tagIds.length && i % 7 === 0) await insertScoped(ctx, "documentTags", scope, { documentId: doc._id, tagId: args.tagIds[i % args.tagIds.length]! });
      if (i % Math.floor(FAKE_LIBRARY.notes / FAKE_LIBRARY.stars) === 5) await insertScoped(ctx, "stars", scope, { profileId: profile._id, documentId: doc._id, createdAt: at });
    }
    return { done: end >= FAKE_LIBRARY.notes, next: end };
  },
});

/** Fills a test account's Personal with the whole library, a batch at a time. */
export const seedLibrary = internalAction({
  args: { email: v.string(), batch: v.optional(v.number()) },
  handler: async (ctx, args): Promise<{ folders: number; notes: number }> => {
    guard(args.email);
    const { folderIds, tagIds }: { folderIds: Id<"folders">[]; tagIds: Id<"tags">[] } = await ctx.runMutation(internal.devSeed.seedFolders, { email: args.email });
    let from = 0;
    for (;;) {
      const r: { done: boolean; next: number } = await ctx.runMutation(internal.devSeed.seedNotes, { email: args.email, folderIds, tagIds, from, count: args.batch ?? 100 });
      if (r.done) break;
      from = r.next;
    }
    return { folders: folderIds.length, notes: FAKE_LIBRARY.notes };
  },
});
