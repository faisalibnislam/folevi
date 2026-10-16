// One push, everywhere the person asked for it: their browsers (web push, pushSend.ts) and their iPhones
// and iPads (APNs, apnsSend.ts). Callers decide whether a push is wanted at all (the bell's choices);
// this only schedules the sends, and skips APNs when it isn't set up or the person has no device for it.
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { apnsConfig, type ApnsKind } from "./apns";
import { appUrl } from "./notify";

export interface Push {
  profileId: Id<"profiles">;
  kind: ApnsKind;
  title: string;
  body?: string;
  /** Inside the app: "/d/<note id>" with "#block-<id>" when it's about a block. */
  path: string;
  /** Replaces an earlier notification with the same tag ("reminder:<task id>"). */
  tag: string;
  /** The note's id: the iOS app groups a note's notifications. */
  noteId?: string;
  /** A reminder's task (its block id), for the iOS notification's Done and Snooze. */
  taskId?: string;
}

export async function schedulePush(ctx: MutationCtx, push: Push): Promise<void> {
  await ctx.scheduler.runAfter(0, internal.pushSend.sendToProfile, { profileId: push.profileId, title: push.title, body: push.body, url: `${appUrl()}${push.path}`, tag: push.tag });
  if (!apnsConfig()) return;
  const device = await ctx.db
    .query("apnsTokens")
    .withIndex("by_profile", (q) => q.eq("profileId", push.profileId))
    .first();
  if (!device) return;
  await ctx.scheduler.runAfter(0, internal.apnsSend.sendToProfile, {
    profileId: push.profileId,
    message: {
      kind: push.kind,
      title: push.title,
      ...(push.body ? { body: push.body } : {}),
      path: push.path,
      ...(push.noteId ? { threadId: push.noteId } : {}),
      ...(push.taskId ? { taskId: push.taskId } : {}),
      collapseId: push.tag.slice(0, 64),
    },
  });
}
