"use client";
// Signing in from the apps' built-in interface (docs/LOCAL_MODE_PLAN.md §1, WP4). The interface has no
// sign-in pages of its own: the website opens in the browser (shell().auth.signIn()), the person signs in
// there as usual (password, two-step verification, Google, passkeys) and approves the app, and the app comes
// back signed in. Shown wherever the website would send someone to /signin.
import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { FullPageMessage } from "@/lib/app/state";
import { shellSignIn } from "@/lib/auth/shellFetch";

export function ShellSignIn() {
  const [state, setState] = useState<"idle" | "waiting" | "failed">("idle");
  // Opening the browser again replaces the attempt before it, which then answers false: only the latest counts.
  const attempt = useRef(0);
  const start = async () => {
    const mine = ++attempt.current;
    setState("waiting");
    // On success the page reloads with the new session.
    const ok = await shellSignIn().catch(() => false);
    if (!ok && mine === attempt.current) setState("failed");
  };
  return (
    <FullPageMessage
      title="Sign in to Folevi"
      body={
        state === "waiting"
          ? "Your browser is open. Finish signing in there, and Folevi comes back here by itself."
          : "Folevi opens in your browser. Sign in there, and you come back here signed in."
      }
    >
      <div className="grid gap-3" data-testid="shell-sign-in">
        <Button
          variant="primary"
          className="h-11 w-full text-[15px]"
          disabled={state === "waiting"}
          onClick={() => void start()}
        >
          {state === "waiting" ? "Waiting for your browser…" : "Sign in to Folevi"}
        </Button>
        {state === "waiting" ? (
          <Button
            variant="secondary"
            className="h-11 w-full text-[15px]"
            onClick={() => void start()}
          >
            Open the browser again
          </Button>
        ) : null}
        {state === "failed" ? (
          <p role="alert" className="text-[14px] text-muted">
            Signing in didn’t finish. Try again.
          </p>
        ) : null}
      </div>
    </FullPageMessage>
  );
}
