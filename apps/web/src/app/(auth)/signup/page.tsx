import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { hasSessionCookie } from "@/lib/auth/session";
import { SignUpForm } from "@/components/auth/SignUpForm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Create your account" };

export default async function SignUpPage({ searchParams }: { searchParams: Promise<{ template?: string | string[] }> }) {
  // "Use this template" on folevi.com: keep the template key (checked against the built-in list later).
  const raw = (await searchParams).template;
  const template = typeof raw === "string" && /^[a-z0-9-]{1,64}$/.test(raw) ? raw : undefined;
  if (await hasSessionCookie()) redirect(template ? `/documents?template=${template}` : "/documents");
  return <SignUpForm template={template} />;
}
