import type { Metadata } from "next";
import { AppSocialSignIn } from "@/components/auth/AppSocialSignIn";
import { PROVIDER_NAMES, isSocialProvider } from "@/lib/auth/socialErrors";

export const dynamic = "force-dynamic";

type Params = { provider?: string; client_id?: string; redirect_uri?: string; code_challenge?: string; code_challenge_method?: string; state?: string; returned?: string; error?: string };

export async function generateMetadata({ searchParams }: { searchParams: Promise<Params> }): Promise<Metadata> {
  const p = await searchParams;
  return { title: `Sign in with ${PROVIDER_NAMES[isSocialProvider(p.provider) ? p.provider : "google"]}` };
}

/**
 * The browser half of signing in to the Mac or iOS app with Google or Apple (`provider`, Google when absent;
 * Google doesn't sign in inside an app's web view): the app opens this page in the browser, which signs in
 * with the provider and hands the app a one-time code (convex/lib/nativeAuth.ts, client "folevi-app"). The
 * Mac app only opens this path, so Apple uses it too.
 */
export default async function AppSignInPage({ searchParams }: { searchParams: Promise<Params> }) {
  const p = await searchParams;
  return (
    <AppSocialSignIn
      provider={isSocialProvider(p.provider) ? p.provider : "google"}
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
