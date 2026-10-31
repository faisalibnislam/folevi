"use client";
// Signing in from the apps' built-in interface (docs/LOCAL_MODE_PLAN.md §1, WP4). The interface has no
// sign-in pages of its own: the app asks how (Continue with Apple, Continue with Google, or Sign in with email),
// then the sign-in sheet opens (shell().auth.signIn()) straight on that provider's page, or on the website's
// sign-in page for email, passkeys and the rest, and the app comes back signed in. Shown wherever the website
// would send someone to /signin. Signed out, the app always offers both ways in (ModeChoice): signing in, or
// keeping notes on this person's devices instead, even for someone the app started in account mode because it
// found an earlier account on this Mac.
import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { APPLE_BUTTON, AppleMark, GoogleMark } from "@/components/auth/SocialSignIn";
import { appleSheetHere, signInWithAppleSheet } from "@/lib/auth/appleSheet";
import { signInOptionsFor, type SignInWay } from "@/lib/auth/shellSignInWay";
import { Button } from "@/components/ui/Button";
import { FullPageMessage } from "@/lib/app/state";
import { shellSignIn } from "@/lib/auth/shellFetch";
import { setShellMode } from "@/lib/shell";
import { deviceWords } from "@/lib/shell/words";
import { FoleviLogo } from "@/components/brand/FoleviMark";
import { ModeChoice, PRE_APP_PAGE, mobileApp, preAppBackground, preAppTitle, useSystemTheme } from "./ModeChoice";
import { MOBILE_TEXT_BUTTON } from "./LibrarySetup";
import { NativeGate, type NativeGateAction } from "@/lib/engine/NativeGate";

/** The phone and tablet apps' sign-in buttons: full width, 50 tall, 17 pt (12 apart, from the grid). */
const MOBILE_BUTTON = "!h-[50px] w-full !rounded-control !text-headline font-semibold";
const MAC_BUTTON = "h-11 w-full text-body";

const WAY_NAMES: Record<SignInWay, string> = { apple: "Apple", google: "Google", email: "Folevi" };

export function ShellSignIn() {
  // The phone and tablet screen isn't a FullPageMessage: it follows the system's appearance itself.
  useSystemTheme();
  // "choose": Apple, Google or email, before anything opens.
  const [state, setState] = useState<"idle" | "choose" | "waiting" | "failed">("idle");
  const [way, setWay] = useState<SignInWay>("email");
  const [apple, setApple] = useState<"idle" | "busy" | { error: string }>("idle");
  // Opening the sheet again replaces the attempt before it, which then answers false: only the latest counts.
  const attempt = useRef(0);
  const start = async (w: SignInWay) => {
    const mine = ++attempt.current;
    setWay(w);
    setState("waiting");
    // On success the page reloads with the new session.
    const ok = await shellSignIn(signInOptionsFor(w)).catch(() => false);
    if (!ok && mine === attempt.current) setState("failed");
  };
  // Keeping notes on this device instead: the app reloads in local mode and asks where the library goes.
  const keepLocally = () => setShellMode("local");
  // In the iPhone and iPad app the website opens in iOS's sign-in sheet, not a browser.
  const sheet = deviceWords().ios;
  // The iPhone and iPad app: Apple's own sheet, no web page at all.
  const appleHere = sheet && appleSheetHere();
  // "Sign in to Folevi" on the first-launch choice already chose: go on to how, without asking twice.
  useEffect(() => {
    if (takeSignInNext()) setState("choose");
  }, []);
  const withApple = async () => {
    if (!appleHere) return void start("apple");
    setApple("busy");
    const r = await signInWithAppleSheet().catch(() => ({ error: "Signing in with Apple didn't work. Try again." }));
    if (r === "signed-in") {
      // The app keeps the new session; every query starts again with it.
      window.location.reload();
      return;
    }
    setApple(r === "cancelled" ? "idle" : r);
  };
  const place = sheet ? "the sign-in sheet" : "your browser";
  const body =
    state === "waiting"
      ? `${sheet ? "The sign-in sheet is open" : "Your browser is open"}${way === "email" ? "" : ` on ${WAY_NAMES[way]}'s page`}. Finish signing in there, and Folevi comes back here by itself.`
      : `Continue with Apple or Google, or sign in with your email in ${place}. You come back here signed in.`;
  const mobile = mobileApp();
  const buttonClass = mobile ? MOBILE_BUTTON : MAC_BUTTON;
  const spinner = <Loader2 size={mobile ? 18 : 16} className="animate-spin motion-reduce:animate-none" aria-hidden />;
  const waiting = state === "waiting";
  const choices = (
    <>
      {waiting ? (
        <>
          <Button variant="primary" className={buttonClass} disabled>
            {sheet ? "Waiting for the sign-in sheet…" : "Waiting for your browser…"}
          </Button>
          <Button variant="secondary" className={buttonClass} onClick={() => void start(way)}>
            {sheet ? "Open the sign-in sheet again" : "Open the browser again"}
          </Button>
          <Button variant="secondary" className={buttonClass} onClick={() => setState("choose")}>
            Sign in another way
          </Button>
        </>
      ) : (
        <>
          <button type="button" className={`${APPLE_BUTTON} ${mobile ? MOBILE_BUTTON : ""}`} disabled={apple === "busy"} aria-busy={apple === "busy"} onClick={() => void withApple()}>
            {apple === "busy" ? spinner : <AppleMark />}
            Continue with Apple
          </button>
          <Button variant="secondary" className={`${buttonClass} gap-2.5`} disabled={apple === "busy"} onClick={() => void start("google")}>
            <GoogleMark />
            Continue with Google
          </Button>
          <Button variant="secondary" className={buttonClass} disabled={apple === "busy"} onClick={() => void start("email")}>
            Sign in with email
          </Button>
        </>
      )}
      {typeof apple === "object" && !waiting ? (
        <p role="alert" className={mobile ? "text-center text-subheadline leading-[20px] text-danger" : "text-body text-muted"}>
          {apple.error}
        </p>
      ) : null}
      {state === "failed" ? (
        <p role="alert" className={mobile ? "text-center text-subheadline leading-[20px] text-muted" : "text-body text-muted"}>
          Signing in didn’t finish. Try again.
        </p>
      ) : null}
    </>
  );
  // Native chrome mode (the Mac's native frame): native draws these screens and presses the same buttons.
  const nativeActions: NativeGateAction[] = waiting
    ? [
        { id: "waiting", label: sheet ? "Waiting for the sign-in sheet…" : "Waiting for your browser…", style: "primary", enabled: false, run: () => undefined },
        { id: "again", label: sheet ? "Open the sign-in sheet again" : "Open the browser again", style: "secondary", run: () => void start(way) },
        { id: "another", label: "Sign in another way", style: "secondary", run: () => setState("choose") },
        { id: "local", label: "Keep notes on my devices instead", style: "quiet", run: () => void keepLocally() },
      ]
    : [
        { id: "apple", label: "Continue with Apple", style: "primary", enabled: apple !== "busy", run: () => void withApple() },
        { id: "google", label: "Continue with Google", style: "secondary", enabled: apple !== "busy", run: () => void start("google") },
        { id: "email", label: "Sign in with email", style: "secondary", enabled: apple !== "busy", run: () => void start("email") },
        { id: "local", label: "Keep notes on my devices instead", style: "quiet", run: () => void keepLocally() },
      ];
  const nativeError = typeof apple === "object" && !waiting ? { code: "failed", message: apple.error } : state === "failed" ? { code: "failed", message: "Signing in didn’t finish. Try again." } : null;
  if (state === "idle")
    return (
      <div data-testid="shell-sign-in">
        <NativeGate
          gate="modeChoice"
          title="Where should your notes live?"
          actions={[
            { id: "account", label: "Sign in to Folevi", style: "primary", run: () => setState("choose") },
            { id: "local", label: "Keep notes on my devices", style: "secondary", run: () => void keepLocally() },
          ]}
        />
        <ModeChoice
          onChoose={async (mode) => {
            if (mode === "local") await keepLocally();
            else setState("choose");
          }}
        />
      </div>
    );
  if (mobile)
    // The phone and tablet apps: a screen of the app's own (no web card), the buttons iOS's size.
    return (
      <main id="main" tabIndex={-1} data-pre-app="" className={`${PRE_APP_PAGE} ${preAppBackground()}`}>
        {/* The iPhone and iPad's native frame draws this screen too, with the same buttons. */}
        <NativeGate gate="signedOut" title="Sign in to Folevi" message={body} actions={nativeActions} error={nativeError} />
        <div className="grid w-full max-w-md gap-8">
          <div className="grid justify-items-center gap-5 text-center">
            <FoleviLogo height={26} className="text-ink" />
            <h1 className={preAppTitle()}>Sign in to Folevi</h1>
            <p className="px-2 text-body leading-[20px] text-muted">{body}</p>
          </div>
          <div className="grid gap-3" data-testid="shell-sign-in">
            {choices}
            <button type="button" className={MOBILE_TEXT_BUTTON} onClick={() => void keepLocally()}>
              Keep notes on my devices instead
            </button>
          </div>
        </div>
      </main>
    );
  return (
    <FullPageMessage title="Sign in to Folevi" body={body} gate="signedOut" actions={nativeActions} error={nativeError}>
      <div className="grid gap-3" data-testid="shell-sign-in">
        {choices}
        <Button variant="ghost" className={MAC_BUTTON} onClick={() => void keepLocally()}>
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
