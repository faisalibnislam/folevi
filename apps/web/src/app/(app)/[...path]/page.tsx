import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { ProductApp } from "@/components/app/ProductApp";
import { APP_ROUTE_HEADS } from "@/lib/app/routes";
import { getViewerSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: { absolute: "Folevi" }, robots: { index: false, follow: false } };

/**
 * Every product URL (/documents, /d/:id, /tasks/today, /settings/security, …) renders the same client
 * shell; routing inside it is client-side so the app keeps working offline. The HTML carries no
 * private data — everything is loaded through the authenticated Convex connection.
 */
export default async function ProductPage({ params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const head = path[0] ?? "";
  if (!APP_ROUTE_HEADS.has(head)) notFound();
  const session = await getViewerSession();
  if (!session) {
    const returnTo = `/${path.map(encodeURIComponent).join("/")}`;
    redirect(`/signin?returnTo=${encodeURIComponent(returnTo)}`);
  }
  return <ProductApp />;
}
