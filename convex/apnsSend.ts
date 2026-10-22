"use node";
// Sends a notification to every iPhone and iPad a person turned notifications on for (convex/push.ts,
// apnsTokens), through Apple's push service with token-based auth (lib/apnsJwt.ts) over HTTP/2
// (lib/apnsHttp2.ts). What it carries is in lib/apns.ts. Tokens Apple says are gone are removed; a busy
// Apple is tried again a couple of times. Never logs a token or what a notification says.
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { apnsConfig, apnsHeaders, apnsHost, apnsPayload, deliverWithRetry, vApnsMessage, type ApnsMessage } from "./lib/apns";
import { apnsJwt } from "./lib/apnsJwt";
import { createApnsClient } from "./lib/apnsHttp2";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export const sendToProfile = internalAction({
  args: { profileId: v.id("profiles"), message: vApnsMessage },
  handler: async (ctx, args) => {
    const config = apnsConfig();
    if (!config) return { sent: 0 };
    const { tokens, badge, place } = await ctx.runQuery(internal.push.apnsTargets, { profileId: args.profileId });
    // Only tokens for this app (a token from another bundle id would be refused as not for this topic).
    const targets = tokens.filter((t) => t.bundleId === config.bundleId);
    if (!targets.length) return { sent: 0 };
    try {
      apnsJwt(config);
    } catch {
      // A key that doesn't read as a P-256 private key: nothing can be sent until APNS_KEY is fixed.
      console.error(JSON.stringify({ event: "apns.key_invalid" }));
      return { sent: 0 };
    }
    const message: ApnsMessage = args.message;
    const body = JSON.stringify(apnsPayload(message, badge));
    const headers = apnsHeaders(config, message);
    const client = createApnsClient();
    const gone: Id<"apnsTokens">[] = [];
    const sent: Id<"apnsTokens">[] = [];
    let failed = 0;
    // Apple's reasons for what didn't go ("InvalidProviderToken", "TooManyRequests"), counted: never the token.
    const reasons: Record<string, number> = {};
    try {
      for (const t of targets) {
        const host = apnsHost(t.environment);
        // A device with several accounts gets the account's name with it (its own label), and which account it is.
        // (Only a device that said it holds several accounts gets these: the label marks it.)
        const own = t.label ? JSON.stringify(apnsPayload(message, badge, { label: t.label, place })) : body;
        const result = await deliverWithRetry(
          (fresh) => client.send({ host, token: t.token, headers: { ...headers, authorization: `bearer ${apnsJwt(config, Date.now(), fresh)}` }, body: own }),
          sleep,
        );
        if (result.outcome === "sent") sent.push(t.id);
        else if (result.outcome === "gone") gone.push(t.id);
        else failed++;
        if (result.outcome !== "sent") {
          const why = (result.last.reason ?? `status ${result.last.status}`).replace(/[^\w ]/g, "").slice(0, 40);
          reasons[why] = (reasons[why] ?? 0) + 1;
        }
      }
    } finally {
      client.close();
    }
    await ctx.runMutation(internal.push.afterApnsSend, { gone, sent });
    console.log(JSON.stringify({ event: "apns.send", kind: message.kind, devices: targets.length, sent: sent.length, gone: gone.length, failed, reasons }));
    return { sent: sent.length };
  },
});
