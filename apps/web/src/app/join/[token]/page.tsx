import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ConvexHttpClient } from "convex/browser";
import { hasSessionCookie } from "@/lib/auth/session";
import { isServerEdition } from "@/lib/edition";
import { internalConvexUrl } from "@/lib/runtime/internal";
import { serverInviteRefs } from "@/lib/server-edition/refs";
import { ServerInvite } from "@/components/server/ServerInvite";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Join", referrer: "no-referrer", robots: { index: false, follow: false } };

const TOKEN_RE = /^[A-Za-z0-9_-]{8,200}$/;

/**
 * An invitation to a Folevi server (`<origin>/join/<token>`, CONTRACT §7.1; `/invite/` is workspace invites).
 * Signed out too: create an account (the sign-up carries the invite) or sign in, then join. Server edition only.
 */
export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  if (!isServerEdition()) notFound();
  const { token } = await params;
  const url = internalConvexUrl();
  if (!url || !TOKEN_RE.test(token)) notFound();
  let invite = null;
  try {
    invite = await new ConvexHttpClient(url).query(serverInviteRefs.preview, { token });
  } catch {
    invite = null;
  }
  if (!invite) notFound();
  return <ServerInvite token={token} invite={invite} signedIn={await hasSessionCookie()} />;
}
