import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { hasSessionCookie } from "@/lib/auth/session";
import { SignUpForm } from "@/components/auth/SignUpForm";
import { socialSignInOptions } from "@/lib/auth/signInOptions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Create your account" };

export default async function SignUpPage({ searchParams }: { searchParams: Promise<{ template?: string | string[]; add?: string | string[] }> }) {
  // "Use this template" on folevi.com: keep the template key (checked against the built-in list later).
  const params = await searchParams;
  const raw = params.template;
  const template = typeof raw === "string" && /^[a-z0-9-]{1,64}$/.test(raw) ? raw : undefined;
  // `add=1`: a new account beside the ones this browser is signed in to (docs/MULTI_ACCOUNT_PLAN.md §2.1).
  const adding = params.add === "1";
  if (!adding && (await hasSessionCookie())) redirect(template ? `/documents?template=${template}` : "/documents");
  return <SignUpForm adding={adding} template={template} social={await socialSignInOptions()} />;
}
