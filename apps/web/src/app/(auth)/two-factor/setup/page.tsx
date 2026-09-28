import type { Metadata } from "next";
import { TwoFactorSetup } from "@/components/auth/TwoFactor";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Set up two-step verification" };

export default async function TwoFactorSetupPage({ searchParams }: { searchParams: Promise<{ returnTo?: string }> }) {
  const { returnTo } = await searchParams;
  return <TwoFactorSetup returnTo={returnTo} />;
}
