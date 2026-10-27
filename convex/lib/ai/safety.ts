// Foli AI's refusals (docs/AI_GUARDRAILS.md): counted per person per day by kind, never their text, and a
// pause on Foli AI for an account that keeps asking for harmful things. The rules the model follows and
// the marker it writes live in @folevi/ai-prompts/safety; the server reads the marker in lib/ai/gemini.ts.
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { fail } from "../errors";
import type { RefusalKind } from "@folevi/ai-prompts/safety";
import type { CallUsage } from "../credits";
import type { AiFeature } from "./usage";

export { REFUSAL_KINDS, type RefusalKind } from "@folevi/ai-prompts/safety";

/** Harmful or filtered refusals within this window that pause Foli AI... */
export const PAUSE_AFTER = 5;
export const PAUSE_WINDOW_MS = 60 * 60_000;
/** ...for this long. */
export const PAUSE_MS = 24 * 60 * 60_000;
/** Refusal counts are kept this long (maintenance.sweepAiSafetyCounts). */
export const COUNTS_KEPT_DAYS = 90;

/** Work Foli AI does on its own for someone (a morning brief): its refusals are counted, never toward a pause. */
const BACKGROUND: ReadonlySet<AiFeature> = new Set(["digests", "routines"]);

/** Which kind of refusal a request was, the most serious first; null when nothing declined. */
const RANK: RefusalKind[] = ["harmful", "crisis", "filtered", "other"];
export function refusalIn(calls: CallUsage[]): { kind: RefusalKind; free: boolean } | null {
  const refused = calls.flatMap((c) => (c.refused ? [c.refused] : []));
  if (!refused.length) return null;
  const kind = RANK.find((k) => refused.some((r) => r.kind === k)) ?? "other";
  return { kind, free: refused.every((r) => r.free) };
}

/** The pause message: when Foli AI is back. */
export function pausedMessage(until: number): string {
  const when = new Date(until).toLocaleString("en-US", { month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" });
  return `Foli AI is paused on your account until ${when}, after several requests it can't help with.`;
}

const stateOf = (ctx: QueryCtx | MutationCtx, profileId: Id<"profiles">) =>
  ctx.db
    .query("aiSafetyState")
    .withIndex("by_profile", (q) => q.eq("profileId", profileId))
    .unique();

/** When Foli AI is paused for this person until, or null. */
export async function aiPausedUntil(ctx: QueryCtx | MutationCtx, profileId: Id<"profiles">, now = Date.now()): Promise<number | null> {
  const s = await stateOf(ctx, profileId);
  return s?.pausedUntil && s.pausedUntil > now ? s.pausedUntil : null;
}

/** Refuses a request from someone whose Foli AI is paused (ai.begin). */
export async function assertAiNotPaused(ctx: QueryCtx | MutationCtx, profileId: Id<"profiles">, now = Date.now()): Promise<void> {
  const until = await aiPausedUntil(ctx, profileId, now);
  if (until) fail("forbidden", pausedMessage(until), { reason: "ai_paused", pausedUntil: until });
}

/**
 * Counts a refusal (its kind, never its text) and, for a harmful or filtered one the person asked for
 * themselves, pauses Foli AI when it's the PAUSE_AFTER-th within PAUSE_WINDOW_MS. A crisis never counts.
 */
export async function recordRefusal(ctx: MutationCtx, profileId: Id<"profiles">, kind: RefusalKind, feature: AiFeature | undefined, now = Date.now()): Promise<void> {
  const day = new Date(now).toISOString().slice(0, 10);
  const row = await ctx.db
    .query("aiSafetyCounts")
    .withIndex("by_profile_day", (q) => q.eq("profileId", profileId).eq("day", day))
    .collect()
    .then((rows) => rows.find((r) => r.kind === kind));
  if (row) await ctx.db.patch(row._id, { count: row.count + 1 });
  else await ctx.db.insert("aiSafetyCounts", { profileId, day, kind, count: 1 });
  // The worst questions are often blocked by Gemini's own filter before the model can decline them, so those count too.
  if ((kind !== "harmful" && kind !== "filtered") || (feature && BACKGROUND.has(feature))) return;
  const state = await stateOf(ctx, profileId);
  const recent = [...(state?.recentHarmful ?? []).filter((t) => t > now - PAUSE_WINDOW_MS), now].slice(-PAUSE_AFTER);
  const pause = recent.length >= PAUSE_AFTER && !(state?.pausedUntil && state.pausedUntil > now);
  const patch: Partial<Doc<"aiSafetyState">> = { recentHarmful: pause ? [] : recent, ...(pause ? { pausedUntil: now + PAUSE_MS, pausedAt: now } : {}) };
  if (state) await ctx.db.patch(state._id, patch);
  else await ctx.db.insert("aiSafetyState", { profileId, recentHarmful: patch.recentHarmful!, ...(pause ? { pausedUntil: now + PAUSE_MS, pausedAt: now } : {}) });
  if (pause) console.warn(JSON.stringify({ event: "ai.safety_pause", profileId, until: now + PAUSE_MS }));
}

/** Ends a pause now (an admin lifting it). Returns when it would have ended, or null if there was none. */
export async function liftPause(ctx: MutationCtx, profileId: Id<"profiles">, now = Date.now()): Promise<number | null> {
  const state = await stateOf(ctx, profileId);
  if (!state?.pausedUntil || state.pausedUntil <= now) return null;
  await ctx.db.patch(state._id, { pausedUntil: undefined, recentHarmful: [] });
  return state.pausedUntil;
}

/** A person's refusals over the last `days` days, by kind (for Admin). */
export async function refusalCounts(ctx: QueryCtx | MutationCtx, profileId: Id<"profiles">, days = 30, now = Date.now()): Promise<Record<RefusalKind, number>> {
  const since = new Date(now - days * 86_400_000).toISOString().slice(0, 10);
  const rows = await ctx.db
    .query("aiSafetyCounts")
    .withIndex("by_profile_day", (q) => q.eq("profileId", profileId).gte("day", since))
    .collect();
  const out: Record<RefusalKind, number> = { harmful: 0, crisis: 0, other: 0, filtered: 0 };
  for (const r of rows) out[r.kind] += r.count;
  return out;
}

/** Hourly (ai.sweepStreams): drops refusal counts older than COUNTS_KEPT_DAYS. */
export async function sweepRefusalCounts(ctx: MutationCtx, now = Date.now()): Promise<number> {
  const cutoff = new Date(now - COUNTS_KEPT_DAYS * 86_400_000).toISOString().slice(0, 10);
  const old = await ctx.db
    .query("aiSafetyCounts")
    .withIndex("by_day", (q) => q.lt("day", cutoff))
    .take(500);
  for (const r of old) await ctx.db.delete(r._id);
  return old.length;
}
