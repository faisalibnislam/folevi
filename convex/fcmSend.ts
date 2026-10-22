"use node";
// Sends a notification to every Android phone and tablet a person turned notifications on for (push.ts,
// fcmTokens), through Firebase Cloud Messaging's HTTP v1 API with the Firebase service account (lib/fcmAuth.ts).
// What it carries is in lib/fcm.ts. Tokens Google says are gone are removed; a busy FCM is tried again a couple of
// times. Disabled until the owner sets FCM_SERVICE_ACCOUNT. Never logs a token or what a notification says.
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { deliverFcm, fcmBody, fcmConfig, fcmErrorCode, vFcmMessage, type FcmMessage } from "./lib/fcm";
import { fcmAccessToken } from "./lib/fcmAuth";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export const sendToProfile = internalAction({
  args: { profileId: v.id("profiles"), message: vFcmMessage },
  handler: async (ctx, args) => {
    const config = fcmConfig();
    if (!config) return { sent: 0 };
    const { tokens, badge, place } = await ctx.runQuery(internal.push.fcmTargets, { profileId: args.profileId });
    if (!tokens.length) return { sent: 0 };
    const message: FcmMessage = args.message;
    const url = `https://fcm.googleapis.com/v1/projects/${config.projectId}/messages:send`;
    const gone: Id<"fcmTokens">[] = [];
    const sent: Id<"fcmTokens">[] = [];
    let failed = 0;
    const reasons: Record<string, number> = {};
    for (const t of tokens) {
      const result = await deliverFcm(async (fresh) => {
        const access = await fcmAccessToken(config, fetch, Date.now(), fresh);
        const res = await fetch(url, { method: "POST", headers: { authorization: `Bearer ${access}`, "content-type": "application/json" }, body: JSON.stringify(fcmBody(t.token, message, badge, t.label ? { label: t.label, place } : {})) });
        return res.ok ? { status: 200 } : { status: res.status, code: fcmErrorCode(await res.text()) };
      }, sleep);
      if (result.outcome === "sent") sent.push(t.id);
      else if (result.outcome === "gone") gone.push(t.id);
      else failed++;
      if (result.outcome !== "sent") {
        const why = (result.last.code ?? `status ${result.last.status}`).replace(/[^\w ]/g, "").slice(0, 40);
        reasons[why] = (reasons[why] ?? 0) + 1;
      }
    }
    await ctx.runMutation(internal.push.afterFcmSend, { gone, sent });
    console.log(JSON.stringify({ event: "fcm.send", kind: message.kind, devices: tokens.length, sent: sent.length, gone: gone.length, failed, reasons }));
    return { sent: sent.length };
  },
});
