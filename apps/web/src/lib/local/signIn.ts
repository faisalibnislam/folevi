// "Sign in to Folevi" from a local library (Settings > Library). Moving the library into an account is WP12
// (docs/LOCAL_MODE_PLAN.md §6.1, lib/migrate/): it registers its flow here. Until it does, the button says
// that's still to come and nothing changes.
type SignInFlow = () => Promise<void>;

let flow: SignInFlow | null = null;

/** WP12's entry: signs in and uploads the library. Null clears it (tests). */
export function setSignInToFolevi(next: SignInFlow | null): void {
  flow = next;
}

/** The registered flow, or null when this build doesn't have one yet. */
export function signInToFolevi(): SignInFlow | null {
  return flow;
}
