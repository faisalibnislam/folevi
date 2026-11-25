import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { hasSessionCookie } from "@/lib/auth/session";
import { isServerEdition } from "@/lib/edition";
import { ApproveServerLink } from "@/components/server/ApproveServerLink";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Link a server" };

/**
 * Folevi Cloud only: where a Folevi server's "Link to a Folevi account" sends its owner (Folevi Connect,
 * docs/self-hosting/CONTRACT.md §9, `approveUrl`). Signed out, sign in first and come back.
 */
export default async function ApproveLinkPage({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  if (isServerEdition()) notFound();
  const { code } = await searchParams;
  const clean = typeof code === "string" && /^[A-Za-z0-9-]{4,32}$/.test(code) ? code : "";
  if (!(await hasSessionCookie())) redirect(`/signin?returnTo=${encodeURIComponent(`/connect/approve?code=${encodeURIComponent(clean)}`)}`);
  return <ApproveServerLink code={clean} />;
}
