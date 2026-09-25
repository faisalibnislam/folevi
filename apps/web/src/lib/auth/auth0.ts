import "server-only";
import { Auth0Client } from "@auth0/nextjs-auth0/server";
import { NextResponse } from "next/server";
import { isAuth0Configured } from "@/lib/env";

/**
 * Auth0 Regular Web Application client. Email/password + verified email + TOTP are enforced by the
 * tenant (Universal Login + Post-Login Action, see infra/auth0). Sessions are encrypted, HTTP-only,
 * SameSite=Lax cookies with rolling expiry.
 */
export const auth0: Auth0Client | null = isAuth0Configured()
  ? new Auth0Client({
      authorizationParameters: { scope: "openid profile email offline_access" },
      session: {
        rolling: true,
        inactivityDuration: 60 * 60 * 24 * 3,
        absoluteDuration: 60 * 60 * 24 * 14,
        cookie: { sameSite: "lax", secure: process.env.NODE_ENV === "production" },
      },
      signInReturnToPath: "/documents",
      async onCallback(error, ctx, session) {
        const base = ctx.appBaseUrl ?? process.env.APP_BASE_URL ?? "http://app.localhost:3000";
        if (error) {
          // The Post-Login Action denies unverified addresses with a stable reason.
          const reason = `${error.code ?? ""} ${error.message ?? ""}`;
          const target = /email[_ ]?(not[_ ]?)?verif/i.test(reason) ? "/verify-email" : `/signin?error=${encodeURIComponent(error.code ?? "signin_failed")}`;
          return NextResponse.redirect(new URL(target, base));
        }
        const returnTo = ctx.returnTo && ctx.returnTo.startsWith("/") && !ctx.returnTo.startsWith("//") ? ctx.returnTo : "/documents";
        void session;
        return NextResponse.redirect(new URL(returnTo, base));
      },
    })
  : null;
