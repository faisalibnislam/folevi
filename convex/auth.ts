// Folevi identity: email + password, verified email, an optional authenticator-app second factor (required for platform admins)
// and passkeys, built on Better Auth (docs/AUTH_DECISION.md). Better Auth owns every piece of credential cryptography
// (password hashing, TOTP secrets, backup codes, session tokens); this file only configures it.
//
// Requests reach Better Auth through Convex HTTP routes (`authComponent.registerRoutes` in http.ts),
// proxied by the Next.js route `/api/auth/[...all]` so cookies stay first-party on the app host.
// The Convex plugin issues short-lived RS256 JWTs that `auth.config.ts` trusts; the claims below are
// what `convex/lib/auth.ts` enforces on every backend call.
import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import { betterAuth, type BetterAuthOptions } from "better-auth/minimal";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { twoFactor } from "better-auth/plugins/two-factor";
import { bearer } from "better-auth/plugins/bearer";
import { multiSession } from "better-auth/plugins/multi-session";
import { oauthProvider } from "@better-auth/oauth-provider";
import { passkey, type PasskeyOptions } from "@better-auth/passkey";
import { components, internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import authConfig from "./auth.config";
import authSchema from "./betterAuth/schema";
import { CLAIM_EMAIL_VERIFIED, CLAIM_MFA } from "./lib/claims";
import { CLIENT_IP_HEADER } from "./lib/clientIp";
import { nativeAuth } from "./lib/nativeAuth";
import { breachedPasswords } from "./lib/breachedPasswords";
import { appleClientSecret, appleRevocationFor, appleSignInConfig, type AppleSignInConfig, type StoredAppleAccount } from "./lib/appleSignIn";
import { appleNative } from "./lib/appleNative";
import { guardRefreshTokenRevoke } from "./lib/authAdapter";
import { ACCESS_TOKEN_PREFIX, mcpResourceUrl, OAUTH_SCOPES, REFRESH_TOKEN_PREFIX } from "./lib/mcp/config";

export const authComponent = createClient<DataModel, typeof authSchema>(components.betterAuth, {
  local: { schema: authSchema },
});

/** The app origin (e.g. https://app.folevi.com). Links in identity emails point here. */
export function siteUrl(): string {
  return (process.env.SITE_URL ?? process.env.FOLEVI_APP_URL ?? "http://app.localhost:3000").replace(/\/$/, "");
}

function isProduction(): boolean {
  return process.env.FOLEVI_ENV === "production";
}

/**
 * Pages that may use passkeys: the app origin. Outside production, a second local dev server on another
 * port (apps/web/src/lib/auth/server.ts, FOLEVI_DEV_AUTH_ORIGIN) presents the trusted origin to Better Auth,
 * but the browser signs the page's real one, so the same host on the usual dev ports counts too.
 */
export function passkeyOrigins(): string[] {
  const site = siteUrl();
  if (isProduction()) return [site];
  const { protocol, hostname } = new URL(site);
  const local = Array.from({ length: 10 }, (_, i) => `${protocol}//${hostname}:${3000 + i}`);
  return [site, ...local.filter((o) => o !== site)];
}

/**
 * Passkey sign-in skips Better Auth's two-step check (that only guards password sign-in), so Folevi decides
 * here, after the passkey's signature checks out and before a session exists:
 * - platform admins keep signing in with a password and an authenticator code, since the admin console
 *   requires that second step;
 * - anyone else with two-step verification on needs a passkey that checked it's them (fingerprint, face or
 *   PIN). That is what lets it stand in for the code.
 */
type PasskeyEndpointCtx = Parameters<NonNullable<NonNullable<PasskeyOptions["authentication"]>["afterVerification"]>>[0]["ctx"];

async function checkPasskeySignIn(ctx: GenericCtx<DataModel>, authCtx: PasskeyEndpointCtx, credentialId: string, userVerified: boolean) {
  const stored = (await authCtx.context.adapter.findOne({ model: "passkey", where: [{ field: "credentialID", value: credentialId }] })) as { id: string; userId: string } | null;
  if (!stored) return;
  const runQuery = (ctx as { runQuery?: (fn: never, args: never) => Promise<unknown> }).runQuery;
  const admin = runQuery ? await runQuery(internal.authEmails.hasPlatformRole as never, { authSubject: stored.userId } as never) : false;
  if (admin === true) {
    throw new APIError("FORBIDDEN", { message: "Admin accounts sign in with a password and an authenticator code.", code: "PASSKEY_ADMIN_NEEDS_CODE" });
  }
  const user = (await authCtx.context.internalAdapter.findUserById(stored.userId)) as { twoFactorEnabled?: boolean | null } | null;
  if (user?.twoFactorEnabled === true && !userVerified) {
    throw new APIError("FORBIDDEN", { message: "This passkey didn't check it's you, so it can't replace your authenticator code.", code: "PASSKEY_NOT_VERIFIED" });
  }
  // Allowed: remembered as the passkey's last use (Settings > Security; Better Auth doesn't keep one).
  const runMutation = (ctx as { runMutation?: (fn: never, args: never) => Promise<unknown> }).runMutation;
  if (runMutation) await runMutation(internal.passkeyUsage.record as never, { passkeyId: stored.id, authSubject: stored.userId } as never);
}

/**
 * Rate limits (per client IP, stored in the database so they hold across Convex instances).
 * Development/test deployments scale them up so automated tests that create many accounts from one
 * machine keep working; production uses them as written.
 */
function rateLimitRules() {
  const scale = isProduction() ? 1 : Number(process.env.FOLEVI_AUTH_RATE_LIMIT_SCALE ?? 200);
  const rule = (window: number, max: number) => ({ window, max: Math.max(1, Math.round(max * scale)) });
  return {
    "/sign-up/email": rule(60 * 60, 5),
    "/sign-in/email": rule(60, 5),
    "/two-factor/verify-totp": rule(60, 5),
    "/two-factor/verify-backup-code": rule(60, 5),
    "/two-factor/enable": rule(60, 5),
    "/request-password-reset": rule(15 * 60, 3),
    "/reset-password": rule(60 * 60, 5),
    "/send-verification-email": rule(5 * 60, 3),
    "/change-password": rule(60 * 60, 5),
    "/native/authorize": rule(60, 10),
    "/native/token": rule(60, 10),
    "/native/redeem": rule(60, 10),
    "/apple/native-code": rule(60, 10),
    // Connected apps (MCP): registering, and trading codes and refresh tokens.
    "/oauth2/register": rule(60 * 60, 20),
    "/oauth2/token": rule(60, 30),
    "/passkey/generate-authenticate-options": rule(60, 20),
    "/passkey/verify-authentication": rule(60, 10),
    "/passkey/verify-registration": rule(60, 10),
  };
}

/**
 * Sign in with Google, when both its keys are set (Google Cloud project "folevi", OAuth client "Folevi web";
 * its redirect URI is ${SITE_URL}/api/auth/callback/google). Without them there's no Google button.
 */
export function googleSignIn(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/**
 * Sign in with Apple, when APPLE_SIGNIN_CLIENT_ID (the Services ID, com.folevi.signin), APPLE_SIGNIN_TEAM_ID,
 * APPLE_SIGNIN_KEY_ID and APPLE_SIGNIN_KEY (the .p8 key) are all set (docs/DEPLOYMENT.md). Its return URL is
 * ${SITE_URL}/api/auth/callback/apple, which Apple posts to (apps/web lib/auth/appleCallback.ts). Without them
 * there's no Apple button.
 */
export function appleSignIn(): AppleSignInConfig | null {
  return appleSignInConfig();
}

/**
 * Better Auth's Apple provider: the web flow with the Services ID and a client secret made from the key
 * (lib/appleSignIn.ts, kept and renewed by itself), and id tokens from the iPhone and iPad app's own sign-in
 * sheet, whose audience is the bundle ID. Switched off when it isn't set up, or when the key can't be read, so
 * a bad key never takes the other ways of signing in down with it.
 */
async function appleProvider() {
  const off = { enabled: false, clientId: "", clientSecret: "" };
  const config = appleSignIn();
  if (!config) return off;
  let clientSecret: string;
  try {
    clientSecret = await appleClientSecret(config);
  } catch (error) {
    console.error("Sign in with Apple is off: APPLE_SIGNIN_KEY can't be used", error instanceof Error ? error.message : "");
    return off;
  }
  return {
    clientId: config.clientId,
    clientSecret,
    appBundleIdentifier: config.bundleId,
    audience: [config.clientId, config.bundleId],
  };
}

/** How many accounts one browser keeps signed in at once (the multi-session cookie jar; the apps keep any number). */
export const MAX_BROWSER_ACCOUNTS = 10;

/** What a sign-in with Google or Apple can't do, as the error code the sign-in page shows a message for. */
export const SOCIAL_REFUSED = {
  /** The account has two-step verification on: its code is needed, which only the password sign-in asks for. */
  twoFactor: "two_factor_required",
  /** New sign-ups are paused (Admin → Feature flags → new_signups). */
  signupsPaused: "signups_paused",
} as const;

/**
 * Whether a Better Auth call signs someone in with Google or Apple: the return from the provider's page
 * (/callback/…), or an id token from the iPhone and iPad app's own Apple sheet (/sign-in/social; the browser
 * flow's first step there creates nobody and no session, so it never reaches the hooks below).
 */
const fromSocialSignIn = (hookCtx: unknown) => {
  const path = (hookCtx as { path?: string } | null | undefined)?.path ?? "";
  return path.startsWith("/callback/") || path === "/sign-in/social";
};

type Scheduler = { runAfter: (delay: number, fn: never, args: never) => Promise<unknown> };

/** Identity email goes through Folevi's own email pipeline (internal.email.sendTemplate → Resend), never Better Auth's sender. */
async function queueIdentityEmail(
  ctx: GenericCtx<DataModel>,
  args: { key: "auth_verify_email" | "auth_password_reset"; to: string; actionUrl: string; expiresInHours: number; idempotencyKey: string },
) {
  const scheduler = (ctx as { scheduler?: Scheduler }).scheduler;
  if (!scheduler) throw new Error("identity email requested outside a mutation/action context");
  await scheduler.runAfter(0, internal.authEmails.send as never, args as never);
}

/** Better Auth options (split out so the local component's adapter can derive its schema from them). */
export function createAuthOptions(ctx: GenericCtx<DataModel>) {
  return {
    appName: "Folevi",
    baseURL: siteUrl(),
    secret: process.env.BETTER_AUTH_SECRET,
    trustedOrigins: [siteUrl()],
    // Refresh token rotation needs one fix on Convex (lib/authAdapter.ts).
    database: guardRefreshTokenRevoke(ctx, authComponent.adapter(ctx)),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      autoSignIn: false,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      resetPasswordTokenExpiresIn: 60 * 60,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url, token }) => {
        await queueIdentityEmail(ctx, {
          key: "auth_password_reset",
          to: user.email,
          actionUrl: url,
          expiresInHours: 1,
          idempotencyKey: `auth-reset:${token.slice(0, 24)}`,
        });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: true,
      expiresIn: 60 * 60 * 24,
      sendVerificationEmail: async ({ user, url, token }) => {
        await queueIdentityEmail(ctx, {
          key: "auth_verify_email",
          to: user.email,
          actionUrl: url,
          expiresInHours: 24,
          idempotencyKey: `auth-verify:${token.slice(-24)}`,
        });
      },
    },
    session: {
      // Rolling 14-day sessions, refreshed at most daily; sensitive actions need a fresh (10-minute) one.
      expiresIn: 60 * 60 * 24 * 14,
      updateAge: 60 * 60 * 24,
      freshAge: 60 * 10,
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: isProduction() ? 100 : 5000,
      customRules: rateLimitRules(),
    },
    user: { deleteUser: { enabled: false } },
    // Google and Apple: an account there with the same email (verified by Google or Apple) signs in to the
    // existing Folevi account, once that account's own address is confirmed (Better Auth's
    // requireLocalEmailVerified), so nobody can claim an address first and wait for its owner to arrive.
    socialProviders: {
      ...(googleSignIn() ? { google: { ...googleSignIn()!, prompt: "select_account" as const } } : {}),
      ...(appleSignIn() ? { apple: appleProvider } : {}),
    },
    account: {
      accountLinking: {
        enabled: true,
        trustedProviders: ["google", "apple"],
        // Linking from Settings > Security (signed in, on purpose) may use another address: Apple's "Hide My
        // Email" always does. Signing in still only links by the same address (above).
        allowDifferentEmails: true,
      },
    },
    databaseHooks: {
      account: {
        delete: {
          // Apple removed in Settings > Security: Apple is told to revoke its token (convex/appleRevoke.ts,
          // App Store guideline 5.1.1(v)). In the background, so removing never waits for Apple or fails for it.
          after: async (account: StoredAppleAccount & Record<string, unknown>) => {
            const item = appleRevocationFor(account);
            const runMutation = (ctx as { runMutation?: (fn: never, args: never) => Promise<unknown> }).runMutation;
            if (!item || !runMutation) return;
            try {
              await runMutation(internal.appleRevoke.queue as never, { items: [item] } as never);
            } catch (error) {
              console.error(JSON.stringify({ event: "apple.revoke.queue_failed", where: "unlink", message: error instanceof Error ? error.name : "unknown" }));
            }
          },
        },
      },
      user: {
        create: {
          // A first sign-in with Google or Apple is a sign-up, so it follows the same switch as email sign-ups.
          before: async (user: Record<string, unknown>, hookCtx: unknown) => {
            if (!fromSocialSignIn(hookCtx)) return { data: user };
            const runQuery = (ctx as { runQuery?: (fn: never, args: never) => Promise<unknown> }).runQuery;
            const open = runQuery ? await runQuery(internal.authEmails.signupsOpen as never, {} as never) : true;
            if (open === false) throw new APIError("FORBIDDEN", { message: SOCIAL_REFUSED.signupsPaused });
            return { data: user };
          },
        },
      },
      session: {
        create: {
          // Google and Apple never ask for Folevi's authenticator code, so an account with two-step verification on
          // signs in with its password and code instead (the sign-in page says so).
          before: async (session: { userId: string } & Record<string, unknown>, hookCtx: unknown) => {
            if (!fromSocialSignIn(hookCtx)) return { data: session };
            const adapter = (hookCtx as { context: { internalAdapter: { findUserById: (id: string) => Promise<unknown> } } }).context.internalAdapter;
            const user = (await adapter.findUserById(session.userId)) as { twoFactorEnabled?: boolean | null } | null;
            if (user?.twoFactorEnabled === true) throw new APIError("FORBIDDEN", { message: "This account uses two-step verification.", code: SOCIAL_REFUSED.twoFactor });
            return { data: session };
          },
        },
      },
    },
    advanced: {
      cookiePrefix: "folevi",
      // Only the IP signed by the web server counts (see lib/clientIp.ts and the /api/auth route in http.ts).
      ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
    },
    hooks: {
      before: createAuthMiddleware(async (hookCtx) => {
        // Admins can pause new sign-ups (Admin → Configuration → Feature flags → new_signups).
        if (hookCtx.path === "/sign-up/email") {
          const runQuery = (ctx as { runQuery?: (fn: never, args: never) => Promise<unknown> }).runQuery;
          const open = runQuery ? await runQuery(internal.authEmails.signupsOpen as never, {} as never) : true;
          if (open === false) {
            throw new APIError("FORBIDDEN", { message: "New sign-ups are paused right now. Please try again later.", code: "SIGNUPS_PAUSED" });
          }
        }
      }),
      after: createAuthMiddleware(async (hookCtx) => {
        // A removed passkey's "last used" goes with it (convex/passkeyUsage.ts; kept if it's still there).
        if (hookCtx.path === "/passkey/delete-passkey") {
          const id = (hookCtx.body as { id?: unknown } | undefined)?.id;
          const runMutation = (ctx as { runMutation?: (fn: never, args: never) => Promise<unknown> }).runMutation;
          if (typeof id === "string" && runMutation) await runMutation(internal.passkeyUsage.forget as never, { passkeyId: id } as never);
        }
      }),
    },
    plugins: [
      // New passwords found in Have I Been Pwned's list are refused (sign-up, change, reset).
      breachedPasswords(),
      twoFactor({
        issuer: "Folevi",
        totpOptions: { digits: 6, period: 30 },
        backupCodeOptions: { amount: 10, length: 10 },
        trustDeviceMaxAge: 60 * 60 * 24 * 30,
      }),
      // Connected apps (Claude, ChatGPT, Cursor, …) reaching notes through the MCP server: OAuth 2.1 with
      // PKCE, apps registering themselves (RFC 7591), opaque access tokens checked by convex/mcp/http.ts.
      // Sign-in and consent both happen on /oauth/consent, where the person also picks which places the app
      // may use (convex/mcp/grants.ts).
      oauthProvider({
        loginPage: "/oauth/consent",
        consentPage: "/oauth/consent",
        scopes: [...OAUTH_SCOPES],
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
        disableJwtPlugin: true,
        validAudiences: [mcpResourceUrl()],
        accessTokenExpiresIn: 60 * 60,
        refreshTokenExpiresIn: 60 * 60 * 24 * 30,
        prefix: { opaqueAccessToken: ACCESS_TOKEN_PREFIX, refreshToken: REFRESH_TOKEN_PREFIX },
        silenceWarnings: { oauthAuthServerConfig: true },
      }),
      // Passkeys (Settings > Security; "Sign in with a passkey"). Adding one needs a fresh session; signing
      // in with one is checked by checkPasskeySignIn above.
      passkey({
        rpID: new URL(siteUrl()).hostname,
        rpName: "Folevi",
        origin: passkeyOrigins(),
        // Discoverable credentials, so signing in needs no email and the browser can offer passkeys in autofill.
        authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
        authentication: {
          afterVerification: async ({ ctx: authCtx, verification, clientData }) =>
            await checkPasskeySignIn(ctx, authCtx, clientData.id, verification.authenticationInfo.userVerified),
        },
      }),
      // The native apps' sign-in (lib/nativeAuth.ts) and their `Authorization: Bearer <session token>`.
      nativeAuth(),
      // The iOS app's own Apple sheet hands over its authorization code, so its token can be revoked later.
      appleNative(),
      bearer(),
      // Several accounts in one browser (docs/MULTI_ACCOUNT_PLAN.md §2.1): each session also gets a signed
      // multi-session cookie. Ten fit in a Cookie header comfortably. The web's /api/auth proxy picks the tab's
      // own account from them, and refuses the plugin's endpoints from browsers (they take raw session tokens);
      // Folevi's /api/places routes call them server to server.
      multiSession({ maximumSessions: MAX_BROWSER_ACCOUNTS }),
      convex({
        authConfig,
        jwt: {
          expirationSeconds: 60 * 15,
          // Only what the backend needs to authorize a request; `sessionId` is added by the plugin.
          definePayload: ({ user }) => ({
            email: user.email,
            name: user.name,
            email_verified: user.emailVerified === true,
            [CLAIM_EMAIL_VERIFIED]: user.emailVerified === true,
            [CLAIM_MFA]: user.twoFactorEnabled === true,
          }),
        },
      }),
    ],
  } satisfies BetterAuthOptions;
}

export function createAuth(ctx: GenericCtx<DataModel>) {
  return betterAuth(createAuthOptions(ctx));
}

export type Auth = ReturnType<typeof createAuth>;
