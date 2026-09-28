import type { Metadata } from "next";
import { TwoFactorChallenge } from "@/components/auth/TwoFactor";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Two-step verification" };

export default async function TwoFactorPage({ searchParams }: { searchParams: Promise<{ returnTo?: string }> }) {
  const { returnTo } = await searchParams;
  return <TwoFactorChallenge returnTo={returnTo} />;
}
