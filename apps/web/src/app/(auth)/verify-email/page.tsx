import type { Metadata } from "next";
import { headers } from "next/headers";
import { createHash } from "node:crypto";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/lib/convex/api";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Verify your email" };

async function resend(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "").slice(0, 254);
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  const secret = process.env.FOLEVI_SERVER_SECRET;
  if (!url || !secret || !email) return;
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? "unknown";
  const client = new ConvexHttpClient(url);
  try {
    await client.mutation(api.authSupport.requestVerificationEmail, { email, serverSecret: secret, clientKey: createHash("sha256").update(ip).digest("hex") });
  } catch {
    // Same response regardless (rate limits included) so the page never reveals account existence.
  }
}

export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ sent?: string }> }) {
  const { sent } = await searchParams;
  return (
    <>
      <h1 className="font-display text-4xl leading-tight">Check your inbox</h1>
      <p className="mt-2 text-muted">
        We sent a verification link to your email address. Open it to activate your account, then sign in again. Links expire after a few days and can only be used once.
      </p>
      {sent ? (
        <p role="status" className="mt-4 rounded-[8px] border border-success/30 bg-success-soft p-3 text-sm">
          If an unverified account exists for that address, a new link is on its way.
        </p>
      ) : null}
      <form
        action={async (fd) => {
          "use server";
          await resend(fd);
          const { redirect } = await import("next/navigation");
          redirect("/verify-email?sent=1");
        }}
        className="mt-6 space-y-3"
      >
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Didn’t get it? Send a new link to</span>
          <input name="email" type="email" required autoComplete="email" className="h-10 w-full rounded-[8px] border border-line bg-surface px-3" />
        </label>
        <button type="submit" className="h-10 w-full rounded-[8px] border border-line bg-surface text-sm font-medium hover:border-line-strong">
          Send a new verification link
        </button>
      </form>
      <p className="mt-6 text-sm text-muted">
        Verified already?{" "}
        <a href="/signin" className="text-accent underline-offset-2 hover:underline">
          Sign in
        </a>
      </p>
    </>
  );
}
