// Folevi Server's public basics (docs/self-hosting/CONTRACT.md §6, §7): what a server is and offers
// (`info`, served by the web app as /.well-known/folevi.json), claiming it as its owner with the setup code
// (`claimOwner`), and the internal settings the rest of the backend reads (sign-up rules for Better Auth,
// email, Foli AI and push). On Folevi Cloud `info` describes the cloud and everything else answers not_found.
import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { requireProfile } from "./lib/auth";
import { recordAudit } from "./lib/audit";
import { appleSignInConfig } from "./lib/appleSignIn";
import { sha256Hex, timingSafeEqualHex } from "./lib/crypto";
import { editionKind, isServerEdition, MIN_APP_VERSION, SERVER_API_VERSION, serverVersion } from "./lib/edition";
import { fail } from "./lib/errors";
import { consume } from "./lib/rateLimit";
import { findInvite, inviteState, requireServerEdition, serverOwner } from "./lib/serverAccess";
import { aiConfigured, domainAllowed, emailConfigured, pushRelayOn, readServerSettings, roleFields, serverAiSettingsOf, writeServerSettings } from "./lib/serverSettings";

const googleKeys = () => Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

/** Folevi Cloud, described the way a server describes itself (the web app serves it for kind "folevi-cloud"). */
function cloudInfo() {
  return {
    kind: editionKind(),
    apiVersion: SERVER_API_VERSION,
    name: "Folevi Cloud",
    version: "cloud",
    minAppVersion: MIN_APP_VERSION,
    signIn: { password: true, passkey: true, folevi: false, google: googleKeys(), apple: appleSignInConfig() !== null, signUp: "open" as const },
    features: {
      ai: Boolean(process.env.GEMINI_API_KEY),
      email: Boolean(process.env.RESEND_API_KEY),
      push: Boolean(process.env.APNS_KEY || process.env.FCM_SERVICE_ACCOUNT || process.env.VAPID_PUBLIC_KEY),
      publicLinks: true,
    },
    connect: { serverId: null as string | null, hostnames: [] as string[] },
    needsSetup: false,
  };
}

/**
 * What this server is and offers: /.well-known/folevi.json without `urls` (the web server adds those). Also the
 * "configured" flags the apps use to hide what isn't set up: `features.ai` is false with no AI provider (Foli AI
 * is hidden everywhere then), `features.email` false with no email (sign-up needs no verification then).
 */
export const info = query({
  args: {},
  handler: async (ctx) => {
    if (!isServerEdition()) return cloudInfo();
    const s = await readServerSettings(ctx);
    const owner = await serverOwner(ctx, s);
    const serverId = (process.env.FOLEVI_CONNECT_SERVER_ID ?? "").trim() || null;
    const hostnames = (process.env.FOLEVI_CONNECT_HOSTNAMES ?? "")
      .split(",")
      .map((h) => h.trim())
      .filter(Boolean);
    return {
      kind: editionKind(),
      apiVersion: SERVER_API_VERSION,
      name: s.name,
      version: serverVersion(),
      minAppVersion: MIN_APP_VERSION,
      signIn: {
        password: s.signIn.password,
        passkey: s.signIn.passkey,
        folevi: s.signIn.folevi,
        // Google and Apple need their keys too (set by the server's environment for now).
        google: s.signIn.google && googleKeys(),
        apple: s.signIn.apple && appleSignInConfig() !== null,
        signUp: s.signUp,
      },
      features: { ai: aiConfigured(s), email: emailConfigured(s), push: pushRelayOn(s), publicLinks: s.publicLinks },
      connect: { serverId, hostnames },
      needsSetup: owner === null,
    };
  },
});

/** Whether `token` is the setup code folevid printed (its SHA-256 is FOLEVI_SETUP_TOKEN_HASH). */
async function isSetupToken(raw: string | undefined): Promise<boolean> {
  const expected = (process.env.FOLEVI_SETUP_TOKEN_HASH ?? "").trim().toLowerCase();
  const token = (raw ?? "").trim();
  if (!/^[0-9a-f]{64}$/.test(expected) || !token || token.length > 500) return false;
  return timingSafeEqualHex(await sha256Hex(token), expected);
}

/**
 * Makes the signed-in person the server's Owner, once: only while the server has none, and only with the setup
 * code folevid printed (its SHA-256 is FOLEVI_SETUP_TOKEN_HASH). Audited.
 */
export const claimOwner = mutation({
  args: { setupToken: v.string() },
  handler: async (ctx, args) => {
    requireServerEdition();
    const profile = await requireProfile(ctx);
    await consume(ctx, "bootstrap", `server-claim:${profile._id}`);
    const expected = (process.env.FOLEVI_SETUP_TOKEN_HASH ?? "").trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(expected)) fail("forbidden", "This server has no setup code. Restart Folevi Server to make one.");
    if (!(await isSetupToken(args.setupToken))) fail("forbidden", "That setup code isn't right.");
    const settings = await readServerSettings(ctx);
    const owner = await serverOwner(ctx, settings);
    if (owner) {
      if (owner._id === profile._id) return { ok: true };
      fail("forbidden", "This server already has an owner.");
    }
    const before = { platformRole: profile.platformRole ?? null };
    await ctx.db.patch(profile._id, roleFields("owner"));
    await writeServerSettings(ctx, { ...settings, ownerUserId: profile._id, updatedAt: Date.now(), updatedBy: profile._id });
    const actor = (await ctx.db.get(profile._id))!;
    await recordAudit(ctx, actor, { action: "server.claim_owner", targetType: "profile", targetId: profile._id, before, after: { role: "owner" } });
    return { ok: true };
  },
});

// ---------------------------------------------------------------------------------------------------
// Internal: read by Better Auth's hooks (convex/auth.ts) and by senders
// ---------------------------------------------------------------------------------------------------

/** Sign-in methods and whether email goes out (null outside the server edition). */
export const authSettings = internalQuery({
  args: {},
  handler: async (ctx) => {
    if (!isServerEdition()) return null;
    const s = await readServerSettings(ctx);
    return { password: s.signIn.password, passkey: s.signIn.passkey, emailOn: emailConfigured(s) };
  },
});

/**
 * Whether a new account for `email` may be created on this server (CONTRACT §8 sign-up modes), checked by
 * Better Auth's user-creation hook for every way of signing up. `emailOn` false means there is nothing to verify
 * the address with, so the account starts verified.
 */
export const signUpGate = internalQuery({
  args: { email: v.string(), inviteToken: v.optional(v.string()) },
  handler: async (ctx, args): Promise<{ allowed: boolean; code?: string; message?: string; emailOn: boolean; invite: boolean }> => {
    if (!isServerEdition()) return { allowed: true, emailOn: true, invite: false };
    const s = await readServerSettings(ctx);
    const emailOn = emailConfigured(s);
    // The first account is the owner's (the setup page creates it, then claims the server with the setup code).
    // Until then only someone holding the setup link may create an account (the page sends its code along
    // with the sign-up): a stranger who finds a new server first can't leave accounts on it.
    if (!(await serverOwner(ctx, s))) {
      if (await isSetupToken(args.inviteToken)) return { allowed: true, emailOn, invite: false };
      return { allowed: false, code: "SETUP_REQUIRED", message: "This server isn't set up yet. Open the setup link your server shows to create its first account.", emailOn, invite: false };
    }
    const email = args.email.trim().toLowerCase();
    if (args.inviteToken) {
      const invite = await findInvite(ctx, args.inviteToken);
      if (invite && inviteState(invite) === "pending") {
        if (invite.email && invite.email !== email) return { allowed: false, code: "INVITE_OTHER_EMAIL", message: "This invitation is for another email address.", emailOn, invite: false };
        return { allowed: true, emailOn, invite: true };
      }
      if (s.signUp === "invite") return { allowed: false, code: "INVITE_INVALID", message: "This invitation has expired or was already used. Ask for a new one.", emailOn, invite: false };
    }
    if (s.signUp === "open") return { allowed: true, emailOn, invite: false };
    if (s.signUp === "domains" && domainAllowed(email, s)) return { allowed: true, emailOn, invite: false };
    if (s.signUp === "domains") return { allowed: false, code: "SIGNUP_DOMAIN", message: "Sign-up on this server is only open to certain email addresses. Ask its owner for an invitation.", emailOn, invite: false };
    return { allowed: false, code: "SIGNUP_INVITE_ONLY", message: "This server is invite-only. Ask its owner for an invitation.", emailOn, invite: false };
  },
});

/** Marks an invite as spent by the sign-up that used it (the new account accepts it on its first visit). */
export const spendInviteAtSignUp = internalMutation({
  args: { inviteToken: v.string(), email: v.string() },
  handler: async (ctx, args) => {
    if (!isServerEdition()) return null;
    const invite = await findInvite(ctx, args.inviteToken);
    if (!invite || inviteState(invite) !== "pending") return null;
    await ctx.db.patch(invite._id, { usedByEmail: args.email.trim().toLowerCase(), usedAt: Date.now() });
    return null;
  },
});

/**
 * How email goes out on this server: Folevi Cloud's own provider (null), or the server's settings. Includes the
 * SMTP password: internal only, read by the senders (convex/email.ts, convex/smtpSend.ts), never returned to a client.
 */
export const emailTransport = internalQuery({
  args: {},
  handler: async (ctx) => {
    if (!isServerEdition()) return null;
    const s = await readServerSettings(ctx);
    return { mode: s.email.mode, configured: emailConfigured(s), serverName: s.name, smtp: s.email.smtp ?? null, ownerEmail: (await serverOwner(ctx, s))?.email ?? null };
  },
});

/** The server's Foli AI settings, keys included (internal only: lib/ai/provider.ts loadAiSettings). */
export const aiSettings = internalQuery({
  args: {},
  handler: async (ctx) => {
    if (!isServerEdition()) return null;
    return serverAiSettingsOf(await readServerSettings(ctx));
  },
});

/** Whether phone notifications go through Folevi's push relay (server edition with push.relay on). */
export const pushRelayEnabled = internalQuery({
  args: {},
  handler: async (ctx) => {
    if (!isServerEdition()) return false;
    return pushRelayOn(await readServerSettings(ctx));
  },
});
