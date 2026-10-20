// "Sign in to Folevi" from a local library (Settings > Library). Moving the library into an account is WP12
// (docs/LOCAL_MODE_PLAN.md §6.1, lib/migrate/): its flow is the one here.
type SignInFlow = () => Promise<void>;

/**
 * WP12's flow (lib/migrate/session.ts): signing in happens in the browser, then the app opens signed in and
 * the library goes up into the account (components/migrate/MigrationGate.tsx).
 */
const moveToAccount: SignInFlow = async () => {
  const [{ startMoveToAccount }, { closeLocalLibrary }] = await Promise.all([import("@/lib/migrate/session"), import("./index")]);
  const ok = await startMoveToAccount({ versions: true, beforeSwitch: closeLocalLibrary });
  if (!ok) throw new Error("Signing in didn’t finish. Nothing changed.");
};

let flow: SignInFlow | null = moveToAccount;

/** WP12's entry: signs in and uploads the library. Null clears it (tests). */
export function setSignInToFolevi(next: SignInFlow | null): void {
  flow = next;
}

/** The registered flow, or null when this build doesn't have one yet. */
export function signInToFolevi(): SignInFlow | null {
  return flow;
}
