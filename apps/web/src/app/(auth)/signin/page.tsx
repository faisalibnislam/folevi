import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { isAuth0Configured, isDevAuthEnabled } from "@/lib/env";
import { getViewerSession } from "@/lib/auth/session";
import { DevSignInForm } from "@/components/app/DevSignInForm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  invalid_email: "Enter a valid email address.",
  auth_not_configured: "Sign-in isn't configured for this environment yet.",
  access_denied: "Sign-in was canceled or not allowed.",
};

function safeReturn(value: string | undefined): string {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "/documents";
}

export default async function SignInPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const returnTo = safeReturn(params.returnTo);
  if (await getViewerSession()) redirect(returnTo);
  if (isAuth0Configured() && !params.error) redirect(`/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
  const error = params.error ? (ERRORS[params.error] ?? "We couldn't sign you in. Please try again.") : null;
  return (
    <>
      <h1 className="ui-display text-4xl leading-tight">Welcome back</h1>
      <p className="mt-2 text-muted">Sign in with your email, password and authenticator app.</p>
      {error ? (
        <p role="alert" className="mt-4 rounded-[11px] border border-danger/30 bg-danger-soft p-3 text-sm">
          {error}
        </p>
      ) : null}
      {isAuth0Configured() ? (
        <a href={`/auth/login?returnTo=${encodeURIComponent(returnTo)}`} className="mt-6 flex h-10 items-center justify-center ui-btn ui-btn-primary text-sm font-medium ">
          Continue to sign in
        </a>
      ) : isDevAuthEnabled() ? (
        <DevSignInForm returnTo={returnTo} mode="signin" />
      ) : (
        <p className="mt-6 text-sm text-muted">Sign-in isn’t configured for this environment. See docs/DEPLOYMENT.md.</p>
      )}
      <p className="mt-6 text-sm text-muted">
        New to Folevi?{" "}
        <a href="/signup" className="text-accent underline underline-offset-2">
          Create an account
        </a>
      </p>
    </>
  );
}
