import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ConvexHttpClient } from "convex/browser";
import { ProductApp } from "@/components/app/ProductApp";
import { hasSessionCookie } from "@/lib/auth/session";
import { isServerEdition } from "@/lib/edition";
import { internalConvexUrl } from "@/lib/runtime/internal";
import { serverInviteRefs } from "@/lib/server-edition/refs";
import { ServerInvite } from "@/components/server/ServerInvite";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: { absolute: "Folevi" }, robots: { index: false, follow: false } };

const TOKEN_RE = /^[A-Za-z0-9_-]{8,200}$/;

/** A server invite (serverInvites:preview, CONTRACT §7), or null when the token isn't one. */
async function serverInvite(token: string) {
  const url = internalConvexUrl();
  if (!url || !TOKEN_RE.test(token)) return null;
  try {
    return await new ConvexHttpClient(url).query(serverInviteRefs.preview, { token });
  } catch {
    return null;
  }
}

/**
 * /invite/<token>. In Folevi Cloud, and for a workspace invitation on a server, the product's own page, exactly as
 * the catch-all route ([...path]) renders it. On Folevi Server, an invitation to the server itself is shown here,
 * signed out too: create an account or sign in, then join.
 */
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const signedIn = await hasSessionCookie();
  if (isServerEdition()) {
    const invite = await serverInvite(token);
    if (invite) return <ServerInvite token={token} invite={invite} signedIn={signedIn} />;
  }
  if (!signedIn) redirect(`/signin?returnTo=${encodeURIComponent(`/invite/${encodeURIComponent(token)}`)}`);
  return <ProductApp />;
}
