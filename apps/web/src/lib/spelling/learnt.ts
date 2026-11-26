// The words taught to the spelling checker in this browser ("Learn spelling", lib/spelling/settings.ts keeps
// them). On its own, with nothing imported, so signing out can forget them without loading the checker.

/** Words learnt on this device only (settings.ts LOCAL_KEY). */
export const LEARNT_KEY = "folevi:spelling:learnt";
/** The account's own learnt and ignored words, kept here between visits (settings.ts SYNCED_KEY). */
export const ACCOUNT_WORDS_KEY = "folevi:spelling:words";

/**
 * Forgets the words learnt here. They came from an account's notes (names, project words), so they go when the
 * last account signs out of this browser (components/auth/SignOut.tsx), not on to whoever signs in next. The
 * account's own list comes back from the account at its next sign-in.
 */
export function forgetLearntSpelling(): void {
  try {
    localStorage.removeItem(LEARNT_KEY);
    localStorage.removeItem(ACCOUNT_WORDS_KEY);
  } catch {
    /* storage unavailable: nothing was kept */
  }
}
