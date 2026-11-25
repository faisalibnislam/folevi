// Admin > Foli AI (docs/AI_ASSISTANT.md, "Provider layer"): the providers' keys, each provider's three
// models, and which provider each feature uses (lib/ai/config.ts). Every change needs a reason and is
// audited.
//
// Keys: saved by the super admin, sealed with AES-GCM under the server's secret (lib/crypto.ts sealSecret)
// before they're stored, opened only inside an action that is about to call the provider, and never
// returned by any query or logged: the panel sees only whether a key is set and its last four characters.
// A key in the environment (GEMINI_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY) still works when none is saved.
import { v } from "convex/values";
import { action, internalMutation, internalQuery, mutation, query, type ActionCtx, type MutationCtx, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { ALL_ADMIN_ROLES, requirePlatformRole, type PlatformRole } from "./lib/auth";
import { recordAudit } from "./lib/audit";
import { openSecret, sealSecret } from "./lib/crypto";
import { fail } from "./lib/errors";
import {
  AI_PROVIDERS,
  AI_SETTINGS_KEY,
  KEY_ENV,
  MODEL_ID,
  MODEL_SLOTS,
  MODEL_SUGGESTIONS,
  PROVIDER_LABELS,
  ROUTED_FEATURE_LABELS,
  ROUTED_FEATURES,
  defaultModels,
  keyHint,
  normalizeSettings,
  routeOf,
  routedFeatureOf,
  vAiProvider,
  vModelSet,
  vRoutedFeature,
  type AiProviderId,
  type AiRoute,
  type AiSettings,
  type StoredAiSettings,
} from "./lib/ai/config";
import { capabilitiesOf } from "./lib/ai/capabilities";

const ADMIN: PlatformRole[] = ["super_admin", "ops_admin"];
/** Keys are secrets: only the super admin saves or removes them. */
const OWNER: PlatformRole[] = ["super_admin"];
const SEAL = "ai-provider-key";
const vRequest = { reason: v.string(), requestId: v.optional(v.string()), clientHash: v.optional(v.string()) };

function requireReason(reason: string): string {
  const r = reason.trim();
  if (r.length < 8) fail("invalid_argument", "Give a reason of at least a few words. It is kept in the audit log.");
  return r.slice(0, 500);
}

/** The admins' settings with the defaults filled in (lib/ai/config.ts). */
export async function readAiSettings(ctx: QueryCtx | MutationCtx): Promise<AiSettings> {
  return normalizeSettings(await storedSettings(ctx));
}

async function storedRow(ctx: QueryCtx | MutationCtx) {
  return await ctx.db
    .query("systemSettings")
    .withIndex("by_key", (q) => q.eq("key", AI_SETTINGS_KEY))
    .unique();
}

async function storedSettings(ctx: QueryCtx | MutationCtx): Promise<StoredAiSettings> {
  return ((await storedRow(ctx))?.value as StoredAiSettings | undefined) ?? {};
}

async function saveSettings(ctx: MutationCtx, admin: Doc<"profiles">, value: StoredAiSettings) {
  const row = await storedRow(ctx);
  if (row) await ctx.db.patch(row._id, { value, updatedBy: admin._id, updatedAt: Date.now() });
  else await ctx.db.insert("systemSettings", { key: AI_SETTINGS_KEY, value, updatedBy: admin._id, updatedAt: Date.now() });
}

async function keyRow(ctx: QueryCtx | MutationCtx, provider: AiProviderId) {
  return await ctx.db
    .query("aiProviderKeys")
    .withIndex("by_provider", (q) => q.eq("provider", provider))
    .unique();
}

/** Whether a provider has a key, and where it comes from (never the key itself). */
async function keyStatus(ctx: QueryCtx, provider: AiProviderId) {
  const row = await keyRow(ctx, provider);
  if (row) return { source: "saved" as const, last4: row.last4, updatedAt: row.updatedAt };
  if (process.env[KEY_ENV[provider]]) return { source: "environment" as const, last4: null, updatedAt: null };
  return { source: null, last4: null, updatedAt: null };
}

/** Everything the panel shows. */
export const overview = query({
  args: {},
  handler: async (ctx) => {
    const me = await requirePlatformRole(ctx, ALL_ADMIN_ROLES);
    const settings = await readAiSettings(ctx);
    const providers = [];
    for (const id of AI_PROVIDERS) {
      providers.push({
        id,
        label: PROVIDER_LABELS[id],
        envVar: KEY_ENV[id],
        key: await keyStatus(ctx, id),
        models: settings.models[id],
        defaults: defaultModels(id),
        suggestions: MODEL_SUGGESTIONS[id],
        // What each slot's model can do and costs, so the panel can warn (Heavy without web search, say).
        modelInfo: Object.fromEntries(
          MODEL_SLOTS.map((slot) => {
            const c = capabilitiesOf(settings.models[id][slot]);
            return [slot, { provider: c.provider, searchGrounding: c.searchGrounding, vision: c.vision, inputPerMillion: c.prices.inputNanoPerToken / 1_000, outputPerMillion: c.prices.outputNanoPerToken / 1_000 }];
          }),
        ),
      });
    }
    return {
      canEditKeys: OWNER.includes(me.platformRole!),
      canEdit: ADMIN.includes(me.platformRole!),
      providers,
      features: ROUTED_FEATURES.map((f) => ({ feature: f, ...ROUTED_FEATURE_LABELS[f], provider: settings.routes[f] })),
    };
  },
});

/** A key as providers issue them: one line, no spaces, a sensible length. Checked, never echoed. */
function checkKey(key: string): string {
  const k = key.trim();
  if (k.length < 20 || k.length > 512 || /\s/.test(k)) fail("invalid_argument", "That doesn't look like an API key. Paste the whole key, without spaces.");
  return k;
}

/** Fails unless the caller may save keys (checked before anything is sealed). */
export const assertKeyEditor = internalQuery({
  args: {},
  handler: async (ctx) => {
    await requirePlatformRole(ctx, OWNER);
    return null;
  },
});

/** Saves a provider's key (sealed in the action, so only the sealed form reaches a mutation or the database). */
export const setKey = action({
  args: { provider: vAiProvider, key: v.string(), ...vRequest },
  handler: async (ctx, args): Promise<{ last4: string }> => {
    await ctx.runQuery(internal.aiConfig.assertKeyEditor, {});
    const key = checkKey(args.key);
    const reason = requireReason(args.reason);
    const sealed = await sealSecret(key, SEAL);
    const last4 = keyHint(key);
    await ctx.runMutation(internal.aiConfig.storeKey, { provider: args.provider, sealed, last4, reason, ...(args.requestId ? { requestId: args.requestId } : {}), ...(args.clientHash ? { clientHash: args.clientHash } : {}) });
    return { last4 };
  },
});

export const storeKey = internalMutation({
  args: { provider: vAiProvider, sealed: v.string(), last4: v.string(), reason: v.string(), requestId: v.optional(v.string()), clientHash: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const admin = await requirePlatformRole(ctx, OWNER);
    const row = await keyRow(ctx, args.provider);
    const value = { sealed: args.sealed, last4: args.last4, updatedBy: admin._id, updatedAt: Date.now() };
    if (row) await ctx.db.patch(row._id, value);
    else await ctx.db.insert("aiProviderKeys", { provider: args.provider, ...value });
    // The audit log keeps only the last four characters, before and after.
    await recordAudit(ctx, admin, { action: "ai.key.set", targetType: "ai_provider", targetId: args.provider, reason: args.reason, before: row ? { last4: row.last4 } : null, after: { last4: args.last4 }, requestId: args.requestId, clientHash: args.clientHash });
    return null;
  },
});

export const removeKey = mutation({
  args: { provider: vAiProvider, ...vRequest },
  handler: async (ctx, args) => {
    const admin = await requirePlatformRole(ctx, OWNER);
    const reason = requireReason(args.reason);
    const row = await keyRow(ctx, args.provider);
    if (!row) return null;
    await ctx.db.delete(row._id);
    await recordAudit(ctx, admin, { action: "ai.key.remove", targetType: "ai_provider", targetId: args.provider, reason, before: { last4: row.last4 }, after: null, requestId: args.requestId, clientHash: args.clientHash });
    return null;
  },
});

/** Which provider a feature uses. */
export const setRoute = mutation({
  args: { feature: vRoutedFeature, provider: vAiProvider, ...vRequest },
  handler: async (ctx, args) => {
    const admin = await requirePlatformRole(ctx, ADMIN);
    const reason = requireReason(args.reason);
    const stored = await storedSettings(ctx);
    const before = normalizeSettings(stored).routes[args.feature];
    await saveSettings(ctx, admin, { ...stored, routes: { ...(stored.routes ?? {}), [args.feature]: args.provider } });
    await recordAudit(ctx, admin, { action: "ai.route.set", targetType: "ai_feature", targetId: args.feature, reason, before: { provider: before }, after: { provider: args.provider }, requestId: args.requestId, clientHash: args.clientHash });
    return null;
  },
});

/** A provider's fast, main and heavy models (any id the provider accepts; checked for shape only). */
export const setModels = mutation({
  args: { provider: vAiProvider, models: vModelSet, ...vRequest },
  handler: async (ctx, args) => {
    const admin = await requirePlatformRole(ctx, ADMIN);
    const reason = requireReason(args.reason);
    const models = { fast: args.models.fast.trim(), main: args.models.main.trim(), heavy: args.models.heavy.trim() };
    for (const slot of MODEL_SLOTS) {
      if (!MODEL_ID.test(models[slot])) fail("invalid_argument", `The ${slot} model id isn't valid.`);
      // A model of another provider would be sent to this provider's API and refused there.
      if (capabilitiesOf(models[slot]).provider !== args.provider) fail("invalid_argument", `${models[slot]} isn't a ${PROVIDER_LABELS[args.provider]} model.`);
    }
    const stored = await storedSettings(ctx);
    const before = normalizeSettings(stored).models[args.provider];
    await saveSettings(ctx, admin, { ...stored, models: { ...(stored.models ?? {}), [args.provider]: models } });
    await recordAudit(ctx, admin, { action: "ai.models.set", targetType: "ai_provider", targetId: args.provider, reason, before, after: models, requestId: args.requestId, clientHash: args.clientHash });
    return null;
  },
});

// ---------------------------------------------------------------------------------------------------
// Routes for requests (internal: the sealed key only ever goes to an action, which opens it in memory)
// ---------------------------------------------------------------------------------------------------

const vRouteFeature = v.union(vRoutedFeature, v.literal("transcription"), v.literal("embeddings"));

type RouteRead = { route: AiRoute; sealed: string | null };

async function routeWithSealedKey(ctx: QueryCtx, feature: AiRoute["feature"]): Promise<RouteRead> {
  const route = routeOf(await readAiSettings(ctx), feature);
  const row = await keyRow(ctx, route.provider);
  return { route, sealed: row?.sealed ?? null };
}

/** A feature's route and its provider's sealed key. */
export const routeForFeature = internalQuery({
  args: { feature: vRouteFeature },
  handler: async (ctx, args): Promise<RouteRead> => await routeWithSealedKey(ctx, args.feature),
});

/** The route for a credit hold's feature (`metered`, convex/ai.ts). */
export const routeForHold = internalQuery({
  args: { holdId: v.id("aiCreditHolds") },
  handler: async (ctx, args): Promise<RouteRead> => {
    const hold = await ctx.db.get(args.holdId);
    return await routeWithSealedKey(ctx, routedFeatureOf(hold?.feature));
  },
});

/** The route with its key opened (in this action's memory only). A key that won't open is treated as missing. */
async function opened(read: RouteRead): Promise<AiRoute> {
  if (!read.sealed) return read.route;
  try {
    return { ...read.route, apiKey: await openSecret(read.sealed, SEAL) };
  } catch {
    console.warn(JSON.stringify({ event: "ai.key_unreadable", provider: read.route.provider }));
    return read.route;
  }
}

/** A feature's route, key opened, for an action making calls outside a credit hold (the knowledge graph, embeddings). */
export async function loadRoute(ctx: Pick<ActionCtx, "runQuery">, feature: AiRoute["feature"]): Promise<AiRoute> {
  const read: RouteRead = await ctx.runQuery(internal.aiConfig.routeForFeature, { feature });
  return await opened(read);
}

/** The route for a credit hold, key opened. */
export async function loadHoldRoute(ctx: Pick<ActionCtx, "runQuery">, holdId: Id<"aiCreditHolds">): Promise<AiRoute> {
  const read: RouteRead = await ctx.runQuery(internal.aiConfig.routeForHold, { holdId });
  return await opened(read);
}

/** Whether a feature's provider has a key anywhere (a saved one or its environment variable). */
export async function hasKey(ctx: QueryCtx, feature: AiRoute["feature"]): Promise<boolean> {
  const route = routeOf(await readAiSettings(ctx), feature);
  return Boolean((await keyRow(ctx, route.provider)) || process.env[KEY_ENV[route.provider]]);
}

/** A feature's route without its key (for estimates and capability checks in queries and mutations). */
export async function routeIn(ctx: QueryCtx | MutationCtx, feature: AiRoute["feature"]): Promise<AiRoute> {
  return routeOf(await readAiSettings(ctx), feature);
}

/** A feature's route without its key, from an action. */
export const publicRoute = internalQuery({
  args: { feature: vRouteFeature },
  handler: async (ctx, args): Promise<AiRoute> => routeOf(await readAiSettings(ctx), args.feature),
});
