import type { Metadata } from "next";
import { CheckInbox } from "@/components/auth/CheckInbox";
import { Alert } from "@/components/auth/fields";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Confirm your email" };

export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <>
      {error ? (
        <div className="mb-4">
          <Alert>That confirmation link is invalid or has expired. Send yourself a new one below.</Alert>
        </div>
      ) : null}
      <CheckInbox />
    </>
  );
}
