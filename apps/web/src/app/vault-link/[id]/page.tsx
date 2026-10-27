import type { Metadata } from "next";
import { VaultLinkView } from "./VaultLinkView";

export const dynamic = "force-dynamic";

// Never indexed, never previewed, never sent as a referrer: the page says nothing about what the link holds.
export const metadata: Metadata = {
  title: "Something shared with you",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export default async function VaultLinkPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <VaultLinkView linkId={id} />;
}
