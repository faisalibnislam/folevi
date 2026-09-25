// Account-recovery helpers that must work before a person can sign in (e.g. an unverified address).
// Called only by the Next.js server (FOLEVI_SERVER_SECRET); responses never reveal whether an account exists.
import { v } from "convex/values";
import { internalAction, mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { consume } from "./lib/rateLimit";
import { keyedHash, timingSafeEqualHex } from "./lib/crypto";
import { fail } from "./lib/errors";
import { requireProfile } from "./lib/auth";

function checkServer(secret: string) {
  const expected = process.env.FOLEVI_SERVER_SECRET;
  if (!expected || secret.length !== expected.length || !timingSafeEqualHex(secret, expected)) fail("forbidden", "Not allowed.");
}

export const requestVerificationEmail = mutation({
  args: { email: v.string(), serverSecret: v.string(), clientKey: v.string() },
  handler: async (ctx, args) => {
    checkServer(args.serverSecret);
    const email = args.email.trim().toLowerCase();
    await consume(ctx, "emailResend", await keyedHash(args.clientKey, "client"));
    await consume(ctx, "emailResend", await keyedHash(email, "email"));
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      await ctx.scheduler.runAfter(0, internal.authSupport.sendVerificationForEmail, { email });
    }
    return { ok: true };
  },
});

export const sendVerificationForEmail = internalAction({
  args: { email: v.string() },
  handler: async (_ctx, args) => {
    const domain = process.env.AUTH0_MGMT_DOMAIN;
    const clientId = process.env.AUTH0_MGMT_CLIENT_ID;
    const clientSecret = process.env.AUTH0_MGMT_CLIENT_SECRET;
    if (!domain || !clientId || !clientSecret) {
      console.warn(JSON.stringify({ event: "auth.resend_verification", result: "not_configured" }));
      return;
    }
    const tokenRes = await fetch(`https://${domain}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret, audience: `https://${domain}/api/v2/` }),
    });
    if (!tokenRes.ok) return;
    const { access_token } = (await tokenRes.json()) as { access_token: string };
    const users = await fetch(`https://${domain}/api/v2/users-by-email?email=${encodeURIComponent(args.email)}`, { headers: { authorization: `Bearer ${access_token}` } });
    if (!users.ok) return;
    const list = (await users.json()) as { user_id: string; email_verified: boolean }[];
    const user = list.find((u) => !u.email_verified);
    if (!user) return;
    const res = await fetch(`https://${domain}/api/v2/jobs/verification-email`, {
      method: "POST",
      headers: { authorization: `Bearer ${access_token}`, "content-type": "application/json" },
      body: JSON.stringify({ user_id: user.user_id, ...(process.env.AUTH0_WEB_CLIENT_ID ? { client_id: process.env.AUTH0_WEB_CLIENT_ID } : {}) }),
    });
    console.log(JSON.stringify({ event: "auth.resend_verification", status: res.status }));
  },
});

/** Signed-in password change: Auth0 emails a reset link (through the custom provider → Loops). */
export const requestPasswordReset = mutation({
  args: {},
  handler: async (ctx) => {
    const profile = await requireProfile(ctx);
    await consume(ctx, "passwordReset", profile._id);
    await ctx.scheduler.runAfter(0, internal.identity.startPasswordReset, { profileId: profile._id });
    return { ok: true, configured: Boolean(process.env.AUTH0_DOMAIN && process.env.AUTH0_DOMAIN !== "none") };
  },
});
