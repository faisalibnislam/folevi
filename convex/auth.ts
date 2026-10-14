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
import { oauthProvider } from "@better-auth/oauth-provider";
import { passkey, type PasskeyOptions } from "@better-auth/passkey";
import { components, internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import authConfig from "./auth.config";
import authSchema from "./betterAuth/schema";
import { CLAIM_EMAIL_VERIFIED, CLAIM_MFA } from "./lib/claims";
import { CLIENT_IP_HEADER } from "./lib/clientIp";
import { nativeAuth } from "./lib/nativeAuth";
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
  const stored = (await authCtx.context.adapter.findOne({ model: "passkey", where: [{ field: "credentialID", value: credentialId }] })) as { userId: string } | null;
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
    // Connected apps (MCP): registering, and trading codes and refresh tokens.
    "/oauth2/register": rule(60 * 60, 20),
    "/oauth2/token": rule(60, 30),
    "/passkey/generate-authenticate-options": rule(60, 20),
    "/passkey/verify-authentication": rule(60, 10),
    "/passkey/verify-registration": rule(60, 10),
  };
}

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
    database: authComponent.adapter(ctx),
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
    },
    plugins: [
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
      bearer(),
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
