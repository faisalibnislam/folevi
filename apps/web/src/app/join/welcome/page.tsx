import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { hasSessionCookie } from "@/lib/auth/session";
import { isServerEdition } from "@/lib/edition";
import { serverInfoCore } from "@/lib/server-edition/serverInfo";
import { JoinedWelcome } from "@/components/server/JoinedWelcome";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Welcome", robots: { index: false, follow: false } };

/** After joining a server from an invite: how to get the server into the apps, then on into Folevi. */
export default async function JoinedPage() {
  if (!isServerEdition()) notFound();
  if (!(await hasSessionCookie())) redirect("/signin?returnTo=%2Fjoin%2Fwelcome");
  const info = await serverInfoCore();
  return <JoinedWelcome serverName={info?.name ?? "Folevi"} />;
}
