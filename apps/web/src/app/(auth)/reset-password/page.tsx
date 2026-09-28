import type { Metadata } from "next";
import { ResetPasswordForm } from "@/components/auth/PasswordResetForms";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Choose a new password" };

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string; error?: string }> }) {
  const { token, error } = await searchParams;
  return <ResetPasswordForm token={token ?? null} linkError={error ?? null} />;
}
