import type { Metadata } from "next";
import { AppGoogleSignIn } from "@/components/auth/AppGoogleSignIn";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign in with Google" };

type Params = { client_id?: string; redirect_uri?: string; code_challenge?: string; code_challenge_method?: string; state?: string; returned?: string; error?: string };

/**
 * The browser half of signing in to the Mac or iOS app with Google (Google doesn't sign in inside an app's web
 * view): the app opens this page in the browser, which signs in with Google and hands the app a one-time code
 * (convex/lib/nativeAuth.ts, client "folevi-app").
 */
export default async function AppGooglePage({ searchParams }: { searchParams: Promise<Params> }) {
  const p = await searchParams;
  return (
    <AppGoogleSignIn
      clientId={p.client_id ?? ""}
      redirectUri={p.redirect_uri ?? ""}
      codeChallenge={p.code_challenge ?? ""}
      codeChallengeMethod={p.code_challenge_method ?? ""}
      state={p.state ?? ""}
      returned={p.returned === "1"}
      error={p.error}
    />
  );
}
