"use client";
// Signing in from the apps' built-in interface (docs/LOCAL_MODE_PLAN.md §1, WP4). The interface has no
// sign-in pages of its own: the website opens in the browser (shell().auth.signIn()), the person signs in
// there as usual (password, two-step verification, Google, passkeys) and approves the app, and the app comes
// back signed in. Shown wherever the website would send someone to /signin. Signed out, the app always offers
// both ways in (ModeChoice): signing in, or keeping notes on this person's devices instead, even for someone
// the app started in account mode because it found an earlier account on this Mac.
import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { APPLE_BUTTON, AppleMark } from "@/components/auth/SocialSignIn";
import { appleSheetHere, signInWithAppleSheet } from "@/lib/auth/appleSheet";
import { Button } from "@/components/ui/Button";
import { FullPageMessage } from "@/lib/app/state";
import { shellSignIn } from "@/lib/auth/shellFetch";
import { setShellMode } from "@/lib/shell";
import { deviceWords } from "@/lib/shell/words";
import { FoleviLogo } from "@/components/brand/FoleviMark";
import { ModeChoice, PRE_APP_PAGE, mobileApp, preAppBackground, preAppTitle } from "./ModeChoice";
import { MOBILE_TEXT_BUTTON } from "./LibrarySetup";

/** The phone and tablet apps' sign-in buttons: full width, 50 tall, 17 pt (12 apart, from the grid). */
const MOBILE_BUTTON = "!h-[50px] w-full !rounded-control !text-[17px] font-semibold";

export function ShellSignIn() {
  // "choose": the iPhone and iPad app offers Apple's own sheet next to the website's sign-in.
  const [state, setState] = useState<"idle" | "choose" | "waiting" | "failed">("idle");
  const [apple, setApple] = useState<"idle" | "busy" | { error: string }>("idle");
  // Opening the browser again replaces the attempt before it, which then answers false: only the latest counts.
  const attempt = useRef(0);
  const start = async () => {
    const mine = ++attempt.current;
    setState("waiting");
    // On success the page reloads with the new session.
    const ok = await shellSignIn().catch(() => false);
    if (!ok && mine === attempt.current) setState("failed");
  };
  // Keeping notes on this device instead: the app reloads in local mode and asks where the library goes.
  const keepLocally = () => setShellMode("local");
  // In the iPhone and iPad app the website opens in iOS's sign-in sheet, not a browser.
  const sheet = deviceWords().ios;
  const appleHere = sheet && appleSheetHere();
  const signIn = () => (appleHere ? setState("choose") : void start());
  // "Sign in to Folevi" on the first-launch choice already chose: go on without asking twice.
  useEffect(() => {
    if (!takeSignInNext()) return;
    if (appleHere) setState("choose");
    else void start();
    // Once, on the first render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const withApple = async () => {
    setApple("busy");
    const r = await signInWithAppleSheet().catch(() => ({ error: "Signing in with Apple didn't work. Try again." }));
    if (r === "signed-in") {
      // The app keeps the new session; every query starts again with it.
      window.location.reload();
      return;
    }
    setApple(r === "cancelled" ? "idle" : r);
  };
  const body =
    state === "waiting"
      ? sheet
        ? "The sign-in sheet is open. Finish signing in there, and Folevi comes back here by itself."
        : "Your browser is open. Finish signing in there, and Folevi comes back here by itself."
      : appleHere
        ? "Continue with Apple, or sign in with your email or Google in a sign-in sheet. You come back here signed in."
        : sheet
          ? "Folevi opens a sign-in sheet. Sign in there, and you come back here signed in."
          : "Folevi opens in your browser. Sign in there, and you come back here signed in.";
  if (state !== "idle" && mobileApp())
    // The phone and tablet apps: a screen of the app's own (no web card), the buttons iOS's size.
    return (
      <main id="main" tabIndex={-1} data-pre-app="" className={`${PRE_APP_PAGE} ${preAppBackground()}`}>
        <div className="grid w-full max-w-md gap-8">
          <div className="grid justify-items-center gap-5 text-center">
            <FoleviLogo height={26} className="text-ink" />
            <h1 className={preAppTitle()}>Sign in to Folevi</h1>
            <p className="px-2 text-[15px] leading-[20px] text-muted">{body}</p>
          </div>
          <div className="grid gap-3" data-testid="shell-sign-in">
            {appleHere && state !== "waiting" ? (
              <button type="button" className={`${APPLE_BUTTON} ${MOBILE_BUTTON}`} disabled={apple === "busy"} aria-busy={apple === "busy"} onClick={() => void withApple()}>
                {apple === "busy" ? <Loader2 size={18} className="animate-spin motion-reduce:animate-none" aria-hidden /> : <AppleMark />}
                Continue with Apple
              </button>
            ) : null}
            {typeof apple === "object" ? (
              <p role="alert" className="text-center text-[15px] leading-[20px] text-danger">
                {apple.error}
              </p>
            ) : null}
            <Button variant={appleHere && state !== "waiting" ? "secondary" : "primary"} className={MOBILE_BUTTON} disabled={state === "waiting"} onClick={() => void start()}>
              {state === "waiting" ? (sheet ? "Waiting for the sign-in sheet…" : "Waiting for your browser…") : appleHere ? "Sign in with email or Google" : "Sign in to Folevi"}
            </Button>
            {state === "waiting" ? (
              <Button variant="secondary" className={MOBILE_BUTTON} onClick={() => void start()}>
                {sheet ? "Open the sign-in sheet again" : "Open the browser again"}
              </Button>
            ) : null}
            {state === "failed" ? (
              <p role="alert" className="text-center text-[15px] leading-[20px] text-muted">
                Signing in didn’t finish. Try again.
              </p>
            ) : null}
            <button type="button" className={MOBILE_TEXT_BUTTON} onClick={() => void keepLocally()}>
              Keep notes on my devices instead
            </button>
          </div>
        </div>
      </main>
    );
  if (state === "idle")
    return (
      <div data-testid="shell-sign-in">
        <ModeChoice
        onChoose={async (mode) => {
          if (mode === "local") await keepLocally();
          else signIn();
        }}
        />
      </div>
    );
  return (
    <FullPageMessage
      title="Sign in to Folevi"
      body={body}
    >
      <div className="grid gap-3" data-testid="shell-sign-in">
        {appleHere && state !== "waiting" ? (
          <button type="button" className={APPLE_BUTTON} disabled={apple === "busy"} aria-busy={apple === "busy"} onClick={() => void withApple()}>
            {apple === "busy" ? <Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden /> : <AppleMark />}
            Continue with Apple
          </button>
        ) : null}
        {typeof apple === "object" ? (
          <p role="alert" className="text-[14px] text-muted">
            {apple.error}
          </p>
        ) : null}
        <Button
          variant={appleHere && state !== "waiting" ? "secondary" : "primary"}
          className="h-11 w-full text-[15px]"
          disabled={state === "waiting"}
          onClick={() => void start()}
        >
          {state === "waiting" ? (sheet ? "Waiting for the sign-in sheet…" : "Waiting for your browser…") : appleHere ? "Sign in with email or Google" : "Sign in to Folevi"}
        </Button>
        {state === "waiting" ? (
          <Button
            variant="secondary"
            className="h-11 w-full text-[15px]"
            onClick={() => void start()}
          >
            {sheet ? "Open the sign-in sheet again" : "Open the browser again"}
          </Button>
        ) : null}
        {state === "failed" ? (
          <p role="alert" className="text-[14px] text-muted">
            Signing in didn’t finish. Try again.
          </p>
        ) : null}
        <Button variant="ghost" className="h-11 w-full text-[15px]" onClick={() => void keepLocally()}>
          Keep notes on my devices instead
        </Button>
      </div>
    </FullPageMessage>
  );
}

const SIGN_IN_NEXT = "folevi:shell-sign-in-next";

/** The first-launch choice picked "Sign in to Folevi": the app restarts in account mode and goes straight on. */
export function rememberSignInNext(): void {
  try {
    sessionStorage.setItem(SIGN_IN_NEXT, "1");
  } catch {
    // Without storage the choice is offered once more.
  }
}

function takeSignInNext(): boolean {
  try {
    const v = sessionStorage.getItem(SIGN_IN_NEXT) === "1";
    sessionStorage.removeItem(SIGN_IN_NEXT);
    return v;
  } catch {
    return false;
  }
}
