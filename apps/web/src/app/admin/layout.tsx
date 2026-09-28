import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { fetchQuery } from "convex/nextjs";
import { ConvexError } from "convex/values";
import { api } from "@/lib/convex/api";
import { hasSessionCookie } from "@/lib/auth/session";
import { getToken } from "@/lib/auth/server";
import { AdminApp } from "@/components/admin/AdminApp";

export const dynamic = "force-dynamic";
// Neutral title: nothing in the HTML hints at an admin area before the role is confirmed.
export const metadata: Metadata = { title: { absolute: "Folevi" }, robots: { index: false, follow: false } };

/**
 * Server gate for /admin. Signed-out people are sent to sign in; signed-in people without a platform
 * role get the ordinary 404 (Convex answers `not_found` for every admin function). The client gate
 * in AdminApp re-checks reactively, and every Convex admin function enforces roles regardless.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  if (!(await hasSessionCookie())) redirect(`/signin?returnTo=${encodeURIComponent("/admin")}`);

  let rejected = false;
  try {
    const token = await getToken();
    if (!token) rejected = true;
    else await fetchQuery(api.admin.whoami, {}, { token });
  } catch (error) {
    // An application error (not_found, suspended, profile_missing…) means "not an admin".
    // Transport errors fall through to the client gate, which fails closed on its own.
    if (error instanceof ConvexError) rejected = true;
  }
  if (rejected) notFound();

  return <AdminApp>{children}</AdminApp>;
}
