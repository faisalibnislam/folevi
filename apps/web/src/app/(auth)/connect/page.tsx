import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { hasSessionCookie } from "@/lib/auth/session";
import { ConnectApp } from "@/components/auth/ConnectApp";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign in to the app" };

type Params = { client_id?: string; redirect_uri?: string; code_challenge?: string; code_challenge_method?: string; state?: string };

/**
 * Where Folevi's native apps send people to sign in (Authorization Code + PKCE, convex/lib/nativeAuth.ts).
 * Signed-out visitors sign in first (password, then two-step verification) and come back here.
 */
export default async function ConnectPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  if (!(await hasSessionCookie())) {
    const query = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => typeof e[1] === "string"));
    redirect(`/signin?returnTo=${encodeURIComponent(`/connect?${query}`)}`);
  }
  return (
    <ConnectApp
      clientId={params.client_id ?? ""}
      redirectUri={params.redirect_uri ?? ""}
      codeChallenge={params.code_challenge ?? ""}
      codeChallengeMethod={params.code_challenge_method ?? ""}
      state={params.state ?? ""}
    />
  );
}
