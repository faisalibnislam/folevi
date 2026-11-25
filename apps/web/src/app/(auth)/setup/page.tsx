import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { hasSessionCookie } from "@/lib/auth/session";
import { isServerEdition } from "@/lib/edition";
import { serverInfoCore } from "@/lib/server-edition/serverInfo";
import { SetupFlow, type Step } from "@/components/server/SetupFlow";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Set up your server", referrer: "no-referrer" };

const STEPS = new Set(["name", "account", "claim", "ready", "remote", "email", "ai", "backups", "invite", "apps"]);

/** Folevi Server's first run (`/setup?token=…`, the link folevid prints). Not part of Folevi Cloud. */
export default async function SetupPage({ searchParams }: { searchParams: Promise<{ token?: string; step?: string }> }) {
  if (!isServerEdition()) notFound();
  const params = await searchParams;
  const token = typeof params.token === "string" && /^[A-Za-z0-9_-]{8,200}$/.test(params.token) ? params.token : "";
  const info = await serverInfoCore();
  const step = typeof params.step === "string" && STEPS.has(params.step) ? (params.step as Step | "ready") : null;
  // Unknown (the backend still starting) counts as "needs setup": claimOwner refuses anyway once there's an owner.
  return <SetupFlow token={token} signedIn={await hasSessionCookie()} needsSetup={info ? info.needsSetup : true} initialStep={step} />;
}
