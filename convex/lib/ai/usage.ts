// AI usage by feature (docs/AI_ASSISTANT.md, "Credits and limits"): the usage card in Settings > AI.
//
// Every request names its feature when it holds credits (ai.begin, holdFor); the hold keeps it, and when
// the request settles its credits are added to the credit account's period row (aiCreditPeriods): per
// feature, and per day (UTC). Counts only: never a prompt, a note or an answer. A request without a
// feature (older callers) counts as "other".
import { v, type Infer } from "convex/values";
import type { Doc } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";

/** What credits were spent on, in the order the usage card lists them. */
export const AI_FEATURES = ["chat", "agent", "writing", "research", "attachments", "transcription", "digests", "other"] as const;
export const vAiFeature = v.union(
  v.literal("chat"),
  v.literal("agent"),
  v.literal("writing"),
  v.literal("research"),
  v.literal("attachments"),
  v.literal("transcription"),
  v.literal("digests"),
  v.literal("other"),
);
export type AiFeature = Infer<typeof vAiFeature>;

/** The usage card's names for them. */
export const FEATURE_LABELS: Record<AiFeature, string> = {
  chat: "Chat",
  agent: "Agent",
  writing: "Writing",
  research: "Research",
  attachments: "Attachments",
  transcription: "Transcription",
  digests: "Digests",
  other: "Other",
};

/** A UTC day key ("2026-10-10"). */
export const dayKey = (t: number) => new Date(t).toISOString().slice(0, 10);

/** The most days a period can list (a long trial or a month). */
const MAX_DAYS = 62;

/** Adds a settled request's credits to its period row, by feature and by day. */
export async function recordFeatureUse(ctx: MutationCtx, row: Doc<"aiCreditPeriods">, feature: AiFeature, credits: number, now: number): Promise<void> {
  if (credits <= 0) return;
  const features = { ...(row.features ?? {}) };
  features[feature] = (features[feature] ?? 0) + credits;
  const days = { ...(row.days ?? {}) };
  const day = dayKey(now);
  days[day] = (days[day] ?? 0) + credits;
  await ctx.db.patch(row._id, { features, days });
}

export type UsageBreakdown = {
  /** Credits per feature this period (every feature, zero included). */
  features: { feature: AiFeature; label: string; credits: number }[];
  /** Credits per day from the period's start to today (or its end). */
  days: { day: string; credits: number }[];
  /** All credits charged this period (monthly and extra). */
  total: number;
  /** Credits used this period that aren't in the day chart (charged before days were recorded). */
  untrackedDays: number;
};

/** A period row's credits by feature and by day, every day of the period so far listed. */
export function usageBreakdown(row: Pick<Doc<"aiCreditPeriods">, "features" | "days"> | null, period: { start: number; end: number }, now: number, used = 0): UsageBreakdown {
  const byFeature = { ...(row?.features ?? {}) };
  const byDay = row?.days ?? {};
  // Credits charged before features were recorded still count, so the rows add up to what was used.
  const tracked = Object.values(byFeature).reduce((n, c) => n + (c ?? 0), 0);
  if (used > tracked) byFeature.other = (byFeature.other ?? 0) + (used - tracked);
  const features = AI_FEATURES.map((f) => ({ feature: f, label: f === "other" && used > tracked ? "Other or earlier" : FEATURE_LABELS[f], credits: byFeature[f] ?? 0 })).filter((f) => f.feature !== "other" || f.credits > 0);
  const days: { day: string; credits: number }[] = [];
  const last = dayKey(Math.min(now, period.end - 1));
  for (let t = Date.parse(`${dayKey(period.start)}T00:00:00Z`), i = 0; i < MAX_DAYS; t += 86_400_000, i++) {
    const day = dayKey(t);
    days.push({ day, credits: byDay[day] ?? 0 });
    if (day >= last) break;
  }
  const inDays = days.reduce((n, d) => n + d.credits, 0);
  return { features, days, total: features.reduce((n, f) => n + f.credits, 0), untrackedDays: Math.max(0, used - inDays) };
}
