// users.* in local mode (convex/users.ts). The library has one profile, made by setup.ts on first launch and
// kept with the library's settings. Sessions, devices, sign-in and account deletion belong to an account and
// are hidden (registry.ts LOCAL_HIDDEN, capability "account").
import { WELCOME_TITLE, specsToWireBlocks, BUILT_IN_TEMPLATES } from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";
import { PLAIN_STYLE, USE_CASE_IDS, isOnboardingNoteStyle, laterStep, starterPagesFor, stepAfter } from "@/lib/onboarding";
import { PLAN_CATALOG } from "@/lib/plans";
import { shell } from "@/lib/shell";
import { applyThemeDefaults } from "@/lib/themes";
import { fail } from "../errors";
import { defineLocal, type LocalMutationCtx, type LocalReader } from "../registry";
import type { LocalDocument, LocalFile } from "../store";
import { PROFILE_KEY, getProfile, insertDocument, requireProfile, type LocalProfile } from "./shared";
import { builtInTemplateEnabled, effectiveTheme } from "./themes";

/** The profile picture's file id (in the library's files). */
const AVATAR_KEY = "avatarFileId";

const TOP = PLAN_CATALOG.personal_pro_ai_yearly;

/**
 * What the profile's plan gives in local mode: everything, in the shape of the most capable Personal plan.
 * There is no plan to pay for on a device; the interface hides every plan, trial and upgrade by mode
 * (lib/mode.ts canPurchaseHere), never by reading these. Storage is the disk's and every device is the
 * person's own, so neither has a limit, and nothing is for sale (no credit packs).
 */
export const LOCAL_ENTITLEMENTS: LocalProfile["entitlements"] = {
  scope: "personal",
  planId: TOP.id as "personal_pro_ai_yearly",
  paidPlanId: TOP.id as "personal_pro_ai_yearly",
  plan: "pro_ai",
  paidPlan: "pro_ai",
  paid: true,
  trialing: false,
  trialEndsAt: null,
  ai: TOP.entitlements.aiAssistant,
  aiSource: "plan",
  aiFairUse: TOP.entitlements.aiFairUse,
  monthlyCredits: TOP.entitlements.monthlyCredits,
  creditPacks: false,
  storageBytes: Number.MAX_SAFE_INTEGER,
  storageRule: "per_person",
  devices: null,
};

const objectUrls = new Map<string, string>();

/**
 * Where the page reads a library file: the shell's file URL (app://folevi/_files/<sha> on the Mac), or, in
 * a plain browser (development), an object URL for its bytes, made once per file.
 */
function libraryFileUrl(file: LocalFile): string | null {
  const bridge = shell();
  if (bridge?.library) return bridge.library.fileUrl(file.sha256, file.mimeType);
  let url = objectUrls.get(file.id);
  if (!url && typeof URL.createObjectURL === "function") {
    try {
      url = URL.createObjectURL(file.blob);
      objectUrls.set(file.id, url);
    } catch {
      return null;
    }
  }
  return url ?? null;
}

/** A deleted file's object URL goes with it. */
function forgetFileUrl(fileId: string) {
  const url = objectUrls.get(fileId);
  if (!url) return;
  objectUrls.delete(fileId);
  URL.revokeObjectURL(url);
}

async function avatarUrl(db: LocalReader): Promise<string | null> {
  const id = (await db.get("meta", AVATAR_KEY)) as string | undefined;
  if (!id) return null;
  const file = await db.get("files", id);
  return file ? libraryFileUrl(file) : null;
}

/** The library's profile; "needs_bootstrap" until LocalGate has set the library up. */
defineLocal(api.users.me, "query", async (ctx) => {
  const profile = await getProfile(ctx.db);
  if (!profile) return { state: "needs_bootstrap" as const };
  return { state: "ready" as const, profile: { ...profile, avatarUrl: await avatarUrl(ctx.db), entitlements: LOCAL_ENTITLEMENTS } };
});

function sanitizeName(name: string): string {
  return name.replace(/[\u0000-\u001F\u007F<>]/g, "").trim().slice(0, 80);
}

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const saveProfile = (ctx: LocalMutationCtx, profile: LocalProfile) => ctx.db.put("meta", PROFILE_KEY, profile);

defineLocal(api.users.updateProfile, "mutation", async (ctx, args) => {
  const profile = { ...(await requireProfile(ctx)) };
  if (args.reviewAppEdits !== undefined) profile.reviewAppEdits = args.reviewAppEdits;
  if (args.displayName !== undefined) {
    const name = sanitizeName(args.displayName);
    if (!name) fail("invalid_argument", "Name can't be empty.");
    profile.displayName = name;
  }
  if (args.appearance) profile.appearance = args.appearance;
  if (args.aiEnabled !== undefined) profile.aiEnabled = args.aiEnabled;
  if (args.aiPrefs) {
    const prefs = { ...profile.aiPrefs };
    for (const [key, value] of Object.entries(args.aiPrefs)) if (typeof value === "boolean" && key in prefs) prefs[key as keyof typeof prefs] = value;
    profile.aiPrefs = prefs;
  }
  if (args.timeZone) {
    if (!isValidTimeZone(args.timeZone)) fail("invalid_argument", "Unknown time zone.");
    profile.timeZone = args.timeZone;
  }
  if (args.notificationPrefs) profile.notificationPrefs = args.notificationPrefs;
  saveProfile(ctx, profile);
  return null;
});

/**
 * Onboarding (convex/users.ts completeOnboardingStep): each step's choice, checked the same way.
 *   uses:       `useCases` adds each one's starter pages from the built-in templates, once
 *   style:      `noteStyle` ("plain" or an ONBOARDING_NOTE_STYLES art id) gives the Welcome note that theme
 *   appearance: `appearance`
 *   ai:         `aiEnabled` turns Foli AI on or off
 * Onboarding only moves forward.
 */
defineLocal(api.users.completeOnboardingStep, "mutation", async (ctx, args) => {
  const profile = { ...(await requireProfile(ctx)) };
  if (args.useCases !== undefined && args.step !== "uses") fail("invalid_argument", "Use cases belong to the uses step.");
  if (args.noteStyle !== undefined && args.step !== "style") fail("invalid_argument", "A note theme belongs to the style step.");
  if (args.aiEnabled !== undefined && args.step !== "ai") fail("invalid_argument", "The AI setting belongs to the ai step.");
  if (args.appearance !== undefined && args.step !== "appearance") fail("invalid_argument", "Appearance belongs to the appearance step.");

  if (args.step === "uses" && args.useCases !== undefined) {
    const ids = args.useCases;
    if (ids.length > USE_CASE_IDS.length) fail("invalid_argument", "Too many use cases.");
    for (const id of ids) if (!USE_CASE_IDS.includes(id)) fail("invalid_argument", "Unknown use case.");
    const applied = profile.onboardingUseCases ?? [];
    const fresh = [...new Set(ids)].filter((id) => !applied.includes(id));
    if (fresh.length) {
      await addStarterPages(ctx, applied, fresh);
      profile.onboardingUseCases = [...applied, ...fresh];
    }
  }
  if (args.step === "style" && args.noteStyle !== undefined) {
    if (!isOnboardingNoteStyle(args.noteStyle)) fail("invalid_argument", "Unknown note theme.");
    await styleWelcomeNote(ctx, args.noteStyle);
  }
  if (args.appearance) profile.appearance = args.appearance;
  if (args.aiEnabled !== undefined) profile.aiEnabled = args.aiEnabled;
  profile.onboardingStep = laterStep(profile.onboardingStep, stepAfter(args.step));
  saveProfile(ctx, profile);
  return null;
});

/**
 * The starter notes of `fresh` use cases: one per built-in template, skipping templates an earlier choice
 * (`applied`) already added and templates switched off. New notes start Plain, like every new note.
 */
async function addStarterPages(ctx: LocalMutationCtx, applied: string[], fresh: string[]) {
  const done = new Set(starterPagesFor(applied).map((p) => p.template));
  for (const page of starterPagesFor(fresh)) {
    if (done.has(page.template)) continue;
    done.add(page.template);
    const template = BUILT_IN_TEMPLATES.find((t) => t.key === page.template);
    if (!template || !(await builtInTemplateEnabled(template.key))) continue;
    await insertDocument(ctx, { title: template.name, templateKey: `builtin:${template.key}`, blocks: specsToWireBlocks(template.blocks()) });
  }
}

/** Gives the library's "Welcome to Folevi" note (from the welcome notes) a note theme, if it's still there. */
async function styleWelcomeNote(ctx: LocalMutationCtx, noteStyle: string) {
  const doc = (await ctx.db.list("documents"))
    .filter((d) => d.kind === "document" && !d.inTrash && d.deletedAt === null && d.title === WELCOME_TITLE)
    .sort((a, b) => a.createdAt - b.createdAt || a.ordinal - b.ordinal)[0];
  if (!doc) return;
  const cover: LocalDocument["cover"] = noteStyle === PLAIN_STYLE ? { kind: "none" } : { kind: "art", value: noteStyle };
  if (doc.cover.kind === cover.kind && doc.cover.value === cover.value) return;
  // The backdrop follows the theme, and the note takes the theme's colours, separator and font type.
  const theme = cover.kind === "art" ? await effectiveTheme(cover.value!) : null;
  const style = theme ? applyThemeDefaults({ ...doc.style }, theme.defaults) : { ...doc.style };
  delete style.backdrop;
  ctx.db.put("documents", doc.id, { ...doc, cover, style, revision: doc.revision + 1, seq: await ctx.nextSeq(), updatedAt: ctx.now() });
}

/**
 * Sets the profile picture to an image just added to the library (`client.local.putFile`, kind "avatar").
 * The previous picture is deleted.
 */
defineLocal(api.users.setAvatar, "mutation", async (ctx, args) => {
  await requireProfile(ctx);
  const file = await ctx.db.get("files", args.fileId);
  if (!file || file.kind !== "avatar" || file.documentId) fail("not_found", "That image wasn't found. Upload it again.");
  const previous = (await ctx.db.get("meta", AVATAR_KEY)) as string | undefined;
  ctx.db.put("meta", AVATAR_KEY, file.id);
  if (previous && previous !== file.id) {
    ctx.db.remove("files", previous);
    forgetFileUrl(previous);
  }
  return null;
});

defineLocal(api.users.removeAvatar, "mutation", async (ctx) => {
  await requireProfile(ctx);
  const previous = (await ctx.db.get("meta", AVATAR_KEY)) as string | undefined;
  if (!previous) return null;
  ctx.db.remove("meta", AVATAR_KEY);
  ctx.db.remove("files", previous);
  forgetFileUrl(previous);
  return null;
});
