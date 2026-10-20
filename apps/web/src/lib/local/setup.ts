// First launch of a local library: its one profile, and the notes it starts with. The welcome content is the
// server's own (packages/editor-schema seed.ts, shared since WP7-pre), so both modes start the same way.
import {
  READING_SHELF,
  WELCOME_TITLE,
  atlasBriefBlocks,
  atlasQuestionsBlocks,
  fieldNotesBlocks,
  localDate,
  rankSequence,
  specsToWireBlocks,
  tripSketchBlocks,
  ulid,
  weeklyResetBlocks,
  welcomeBlocks,
} from "@folevi/editor-schema";
import { FOLDER_COLORS } from "@/lib/folderColors";
import type { LocalSetup } from "./client";
import type { LocalMutationCtx } from "./registry";
import type { LocalFolder, LocalTag } from "./store";
import { PROFILE_KEY, getProfile, insertDocument, type LocalProfile } from "./functions/shared";
import { nextFolderOrdinal, nextTagOrdinal } from "./functions/organization";

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * The library's profile. There's no plan in local mode: the plan fields say Free and every limit is open
 * (storage is the disk's, devices are the person's own). The interface hides plans and upgrades by mode
 * (lib/mode.ts canPurchaseHere), never by reading these. Foli AI stays off until local AI exists (L4).
 */
export function localProfile(input: LocalSetup, now: number): LocalProfile {
  return {
    id: ulid(),
    email: "",
    displayName: (input.displayName ?? "").replace(/[\u0000-\u001F\u007F<>]/g, "").trim().slice(0, 80) || "You",
    appearance: "system",
    aiEnabled: false,
    aiPrefs: { history: true, memory: true, suggestions: true, attachments: true, webResearch: true, digests: false, readImages: false, deviceText: true },
    reviewAppEdits: false,
    locale: /^[a-z]{2}(-[A-Z]{2})?$/.test(input.locale) ? input.locale : "en",
    timeZone: isValidTimeZone(input.timeZone) ? input.timeZone : "UTC",
    onboardingStep: "done",
    onboardingUseCases: [],
    platformRole: null,
    status: "active",
    notificationPrefs: { mentions: false, comments: false, shares: false, invites: false, digest: "off", productEmail: false },
    deletionScheduledFor: null,
    createdAt: now,
    avatarUrl: null,
    entitlements: {
      scope: "personal",
      planId: "personal_free",
      paidPlanId: "personal_free",
      plan: "free",
      paidPlan: "free",
      paid: false,
      trialing: false,
      trialEndsAt: null,
      ai: false,
      aiSource: null,
      aiFairUse: "standard",
      monthlyCredits: 0,
      creditPacks: false,
      storageBytes: Number.MAX_SAFE_INTEGER,
      storageRule: "per_person",
      devices: null,
    },
  };
}

/** Creates the profile and, unless asked not to, the welcome note and two folders. Idempotent. */
export async function setupLibrary(ctx: LocalMutationCtx, input: LocalSetup): Promise<{ created: boolean }> {
  if (await getProfile(ctx.db)) return { created: false };
  const now = ctx.now();
  const profile = localProfile(input, now);
  ctx.db.put("meta", PROFILE_KEY, profile);
  if (input.seed !== false) await seedLibrary(ctx, input.today ?? localDate(now, profile.timeZone));
  return { created: true };
}

/**
 * The notes a new library starts with: convex/seed.ts seedPersonal, note for note, so both modes start the
 * same (and the parity harness compares them). The Reading Shelf's collection (its properties, views and
 * values) comes with the collections port (L2); its book notes are made already.
 */
async function seedLibrary(ctx: LocalMutationCtx, today: string): Promise<void> {
  const now = ctx.now();
  const [projectsRank, personalRank] = rankSequence(2);
  // Folders show a colour, never an emoji.
  const color = () => FOLDER_COLORS[Math.floor(Math.random() * FOLDER_COLORS.length)]!.id;
  const folder = async (name: string, rank: string): Promise<LocalFolder> => ({ id: ulid(), name, color: color(), parentFolderId: null, rank, createdAt: now, ordinal: await nextFolderOrdinal(ctx), updatedAt: now, deletedAt: null });
  const projects = await folder("Projects", projectsRank!);
  const personal = await folder("Personal", personalRank!);
  for (const f of [projects, personal]) ctx.db.put("folders", f.id, f);
  const tag = async (name: string, tagColor: string): Promise<LocalTag> => ({ id: ulid(), name, normalizedName: name, color: tagColor, createdAt: now, ordinal: await nextTagOrdinal(ctx) });
  const travel = await tag("travel", "coral");
  const reading = await tag("reading", "plum");
  for (const t of [travel, reading]) ctx.db.put("tags", t.id, t);

  await insertDocument(ctx, {
    title: "Field Notes: A Quiet Morning",
    icon: "☕️",
    folderId: personal.id,
    style: { font: "serif", width: "wide", background: "paper", accent: "moss", card: "folio" },
    blocks: specsToWireBlocks(fieldNotesBlocks()),
  });
  const atlas = await insertDocument(ctx, {
    title: "Project Atlas Brief",
    icon: "🧭",
    folderId: projects.id,
    style: { font: "sans", width: "wide", background: "paper", accent: "accent", card: "folio" },
    blocks: specsToWireBlocks(atlasBriefBlocks(today)),
  });
  const questions = await insertDocument(ctx, { title: "Atlas: Open Questions", icon: "❓", parentDocumentId: atlas.id, blocks: specsToWireBlocks(atlasQuestionsBlocks()) });
  // Page card for the nested page at the end of the brief.
  const atlasBlocks = await ctx.db.list("blocks", atlas.id);
  const lastRank = atlasBlocks.filter((b) => b.parentId === null).map((b) => b.rank).sort().pop() ?? "V";
  const card = ulid();
  ctx.db.put(
    "blocks",
    card,
    {
      id: card,
      documentId: atlas.id,
      parentId: null,
      rank: `${lastRank}V`,
      type: "page",
      schemaVersion: 1,
      text: [],
      props: { documentId: questions.id, display: "card", titleCache: questions.title, iconCache: questions.icon },
      revision: 1,
      contentRev: 1,
      positionRev: 1,
      seq: atlas.seq,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    },
    atlas.id,
  );
  await insertDocument(ctx, {
    title: "Trip Sketch: Coastal Weekend",
    icon: "⛴",
    folderId: personal.id,
    style: { font: "sans", width: "wide", background: "paper", accent: "coral", card: "tinted" },
    blocks: specsToWireBlocks(tripSketchBlocks(today)),
    tagIds: [travel.id],
  });
  const shelf = await insertDocument(ctx, {
    title: READING_SHELF.title,
    icon: "📚",
    folderId: personal.id,
    style: { font: "serif", width: "wide", background: "paper", accent: "plum", card: "folio" },
    blocks: specsToWireBlocks([{ type: "paragraph", md: READING_SHELF.intro }]),
    tagIds: [reading.id],
  });
  for (const row of READING_SHELF.rows) {
    await insertDocument(ctx, {
      title: row.title,
      icon: "📖",
      kind: "collectionRow",
      parentDocumentId: shelf.id,
      blocks: specsToWireBlocks([{ type: "paragraph", md: `Notes on _${row.title}_ by ${row.author}.` }]),
    });
  }
  await insertDocument(ctx, {
    title: "Weekly Reset",
    icon: "🔁",
    kind: "template",
    style: { font: "sans", width: "wide", background: "paper", accent: "marigold", card: "folio" },
    blocks: specsToWireBlocks(weeklyResetBlocks()),
  });
  // Made last so it sorts first by recency.
  await insertDocument(ctx, {
    title: WELCOME_TITLE,
    icon: "🌿",
    style: { font: "serif", width: "wide", background: "paper", accent: "accent", card: "folio" },
    blocks: specsToWireBlocks(welcomeBlocks(today)),
  });
}
