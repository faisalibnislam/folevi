import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { hasSessionCookie } from "@/lib/auth/session";
import { SignInForm } from "@/components/auth/SignInForm";
import { safeReturnTo } from "@/lib/auth/returnTo";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign in" };

const NOTICES: Record<string, string> = {
  signed_out: "You're signed out.",
  password_changed: "Your password was changed. Sign in with the new one.",
  session_ended: "Your session ended. Sign in again to keep writing. Anything you wrote offline is still on this device.",
};

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ returnTo?: string; notice?: string }> }) {
  const params = await searchParams;
  const returnTo = safeReturnTo(params.returnTo);
  if (await hasSessionCookie()) redirect(returnTo);
  return <SignInForm returnTo={returnTo} notice={params.notice ? NOTICES[params.notice] : undefined} />;
}
