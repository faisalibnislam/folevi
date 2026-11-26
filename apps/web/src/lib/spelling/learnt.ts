// The words taught to the spelling checker in this browser ("Learn spelling", lib/spelling/web.ts). On its own,
// with nothing imported, so signing out can forget them without loading the checker.

export const LEARNT_KEY = "folevi:spelling:learnt";

/**
 * Forgets the words learnt here. They came from an account's notes (names, project words), so they go when the
 * last account signs out of this browser (components/auth/SignOut.tsx), not on to whoever signs in next.
 */
export function forgetLearntSpelling(): void {
  try {
    localStorage.removeItem(LEARNT_KEY);
  } catch {
    /* storage unavailable: nothing was kept */
  }
}
