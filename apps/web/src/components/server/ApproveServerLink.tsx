"use client";

// Approving a Folevi server's link to this account (connect:approveLink, CONTRACT §7). Once linked, the server
// shows under "Your servers" in every app signed in here, with its secure folevi.app address.
import { useState } from "react";
import { useAction, useConvexAuth } from "convex/react";
import { ConvexClientProvider } from "@/lib/convex/provider";
import { connectRefs } from "@/lib/server-edition/refs";
import { errorMessage } from "@/components/ui/Toast";
import { Alert, AuthHeading, SubmitButton, TextLink } from "@/components/auth/fields";

function Approve({ code }: { code: string }) {
  const { isAuthenticated } = useConvexAuth();
  const approve = useAction(connectRefs.approveLink);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  if (done !== null) {
    return (
      <>
        <AuthHeading title="Server linked" lede={`${done || "Your server"} is now linked to your Folevi account. It shows up in Folevi on your devices under Your servers. You can close this page.`} />
        <TextLink href="/documents">Open Folevi</TextLink>
      </>
    );
  }
  if (!code) {
    return <AuthHeading title="Open the link from your server" lede="This page needs the code your server shows under Remote access in its admin panel." />;
  }
  return (
    <>
      <AuthHeading title="Link a server to your account" lede="Your Folevi server asked to be linked to this account. Check that the code matches the one on your server's Remote access page." />
      <p className="mb-6 rounded-control bg-[var(--glass-hover)] py-4 text-center font-mono text-title-2 tracking-[0.2em] text-heading">{code}</p>
      {error ? (
        <div className="mb-4">
          <Alert>{error}</Alert>
        </div>
      ) : null}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (busy) return;
          setBusy(true);
          setError(null);
          approve({ code })
            .then((r) => setDone(r?.name ?? ""))
            .catch((err: unknown) => setError(errorMessage(err)))
            .finally(() => setBusy(false));
        }}
      >
        <SubmitButton busy={busy} disabled={!isAuthenticated}>
          Link this server
        </SubmitButton>
      </form>
      <p className="mt-4 text-footnote text-muted">Folevi only learns the server&apos;s name and address. Your notes stay on the server.</p>
    </>
  );
}

export function ApproveServerLink({ code }: { code: string }) {
  return (
    <ConvexClientProvider>
      <Approve code={code} />
    </ConvexClientProvider>
  );
}
