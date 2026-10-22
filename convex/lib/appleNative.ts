// The iPhone and iPad app's own Sign in with Apple sheet (docs/IOS.md, "Sign in with Apple"). Signing in with
// its id token (Better Auth's /sign-in/social) leaves Folevi holding no Apple token, and without one Apple's
// tokens can't be revoked when the person deletes their account (App Store guideline 5.1.1(v)). Right after
// signing in, the app sends the sheet's one-time authorization code here; Folevi trades it at Apple as the app
// (client id = the bundle ID, with a client secret made for it) and keeps the refresh token on the person's
// Apple account row, where revoking finds it (convex/appleRevoke.ts).
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint, sessionMiddleware } from "better-auth/api";
import { APPLE_TOKEN_URL, appleClientSecret, appleSignInConfig, asAppleClient } from "./appleSignIn";

const CODE_RE = /^[A-Za-z0-9._-]{8,1024}$/;

function subjectOf(idToken: unknown): string | null {
  const part = typeof idToken === "string" ? idToken.split(".")[1] : undefined;
  if (!part) return null;
  try {
    const sub = (JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((part.length + 3) % 4))) as { sub?: unknown }).sub;
    return typeof sub === "string" ? sub : null;
  } catch {
    return null;
  }
}

type TokenAnswer = { refresh_token?: unknown; access_token?: unknown; id_token?: unknown };

/** Apple's answer to the code exchange, or null with the HTTP status (0: Apple couldn't be reached). */
async function exchange(body: URLSearchParams): Promise<{ data: TokenAnswer | null; status: number }> {
  try {
    const res = await fetch(APPLE_TOKEN_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body: body.toString() });
    return { data: res.ok ? ((await res.json()) as TokenAnswer) : null, status: res.status };
  } catch {
    return { data: null, status: 0 };
  }
}

const refuse = (code: string, message: string) => new APIError("BAD_REQUEST", { code, message });

export function appleNative() {
  return {
    id: "folevi-apple-native",
    endpoints: {
      appleNativeCode: createAuthEndpoint("/apple/native-code", { method: "POST", use: [sessionMiddleware] }, async (ctx) => {
        const code = (ctx.body as { authorization_code?: unknown } | undefined)?.authorization_code;
        if (typeof code !== "string" || !CODE_RE.test(code)) throw refuse("INVALID_CODE", "That sign-in code isn't valid.");
        const config = appleSignInConfig();
        if (!config) throw new APIError("NOT_FOUND", { code: "PROVIDER_NOT_FOUND", message: "Sign in with Apple isn't set up." });
        const accounts = (await ctx.context.internalAdapter.findAccounts(ctx.context.session.user.id)) as { id: string; providerId: string; accountId: string }[];
        const apple = accounts.find((a) => a.providerId === "apple");
        if (!apple) throw refuse("ACCOUNT_NOT_FOUND", "Apple isn't linked to this account.");

        const client = asAppleClient(config, config.bundleId);
        const body = new URLSearchParams({ grant_type: "authorization_code", code, client_id: client.clientId, client_secret: await appleClientSecret(client) });
        const { data, status } = await exchange(body);
        if (!data) {
          console.warn(JSON.stringify({ event: "apple.native_code.rejected", status }));
          throw refuse("APPLE_CODE_REJECTED", "Apple didn't accept that sign-in code. Sign in with Apple again.");
        }
        // The code must be for the Apple ID already linked here.
        if (subjectOf(data.id_token) !== apple.accountId) throw refuse("APPLE_ACCOUNT_MISMATCH", "That code is for another Apple ID.");
        await ctx.context.internalAdapter.updateAccount(apple.id, {
          ...(typeof data.refresh_token === "string" ? { refreshToken: data.refresh_token } : {}),
          ...(typeof data.access_token === "string" ? { accessToken: data.access_token } : {}),
          idToken: data.id_token as string,
        });
        return ctx.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
      }),
    },
  } satisfies BetterAuthPlugin;
}
