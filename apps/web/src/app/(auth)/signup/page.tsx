import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { hasSessionCookie } from "@/lib/auth/session";
import { SignUpForm } from "@/components/auth/SignUpForm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Create your account" };

export default async function SignUpPage() {
  if (await hasSessionCookie()) redirect("/documents");
  return <SignUpForm />;
}
