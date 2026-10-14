import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { ProductApp } from "@/components/app/ProductApp";
import { APP_ROUTE_HEADS } from "@/lib/app/routes";
import { hasSessionCookie } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: { absolute: "Folevi" }, robots: { index: false, follow: false } };

/**
 * Every product URL (/documents, /d/:id, /tasks/today, /settings/security, …) renders the same client
 * shell; routing inside it is client-side so the app keeps working offline. The HTML carries no
 * private data. Everything is loaded through the authenticated Convex connection.
 */
export default async function ProductPage({ params, searchParams }: { params: Promise<{ path: string[] }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { path } = await params;
  const head = path[0] ?? "";
  if (!APP_ROUTE_HEADS.has(head)) notFound();
  if (!(await hasSessionCookie())) {
    // The query comes along: a connected app's sign-in (/oauth/consent?…) needs every parameter back.
    const query = new URLSearchParams();
    for (const [k, v] of Object.entries(await searchParams)) for (const one of Array.isArray(v) ? v : v === undefined ? [] : [v]) query.append(k, one);
    const returnTo = `/${path.map(encodeURIComponent).join("/")}${query.size ? `?${query}` : ""}`;
    redirect(`/signin?returnTo=${encodeURIComponent(returnTo)}`);
  }
  return <ProductApp />;
}
