import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { isAuth0Configured, isDevAuthEnabled } from "@/lib/env";
import { getViewerSession } from "@/lib/auth/session";
import { DevSignInForm } from "@/components/app/DevSignInForm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Create your account" };

export default async function SignUpPage() {
  if (await getViewerSession()) redirect("/documents");
  if (isAuth0Configured()) redirect(`/auth/login?screen_hint=signup&returnTo=${encodeURIComponent("/onboarding")}`);
  return (
    <>
      <h1 className="ui-display text-4xl leading-tight">Start writing</h1>
      <p className="mt-2 text-muted">Folevi is free during the preview. You’ll verify your email and set up an authenticator app — two quick steps that keep your notes yours.</p>
      {isDevAuthEnabled() ? <DevSignInForm returnTo="/onboarding" mode="signup" /> : <p className="mt-6 text-sm text-muted">Sign-up isn’t configured for this environment. See docs/DEPLOYMENT.md.</p>}
      <p className="mt-6 text-sm text-muted">
        Already have an account?{" "}
        <a href="/signin" className="text-accent underline underline-offset-2">
          Sign in
        </a>
      </p>
    </>
  );
}
