import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { hasSessionCookie } from "@/lib/auth/session";
import { SignUpForm } from "@/components/auth/SignUpForm";
import { socialSignInOptions } from "@/lib/auth/signInOptions";
import { safeReturnTo } from "@/lib/auth/returnTo";
import { isServerEdition } from "@/lib/edition";
import { serverInfoCore } from "@/lib/server-edition/serverInfo";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Create your account" };

export default async function SignUpPage({ searchParams }: { searchParams: Promise<{ template?: string | string[]; add?: string | string[]; returnTo?: string | string[]; email?: string | string[] }> }) {
  // "Use this template" on folevi.com: keep the template key (checked against the built-in list later).
  const params = await searchParams;
  const raw = params.template;
  const template = typeof raw === "string" && /^[a-z0-9-]{1,64}$/.test(raw) ? raw : undefined;
  // `add=1`: a new account beside the ones this browser is signed in to (docs/MULTI_ACCOUNT_PLAN.md §2.1).
  const adding = params.add === "1";
  if (!adding && (await hasSessionCookie())) redirect(template ? `/documents?template=${template}` : "/documents");
  if (isServerEdition()) {
    // Folevi Server: back to the invite (or wherever) afterwards; confirmed by email only when the server sends email.
    const info = await serverInfoCore();
    const returnTo = typeof params.returnTo === "string" ? safeReturnTo(params.returnTo) : undefined;
    const email = typeof params.email === "string" && params.email.length <= 200 ? params.email : undefined;
    const server = { serverName: info?.name ?? null, returnTo, email, confirmByEmail: info?.features.email === true };
    return <SignUpForm adding={adding} social={await socialSignInOptions()} server={server} />;
  }
  return <SignUpForm adding={adding} template={template} social={await socialSignInOptions()} />;
}
