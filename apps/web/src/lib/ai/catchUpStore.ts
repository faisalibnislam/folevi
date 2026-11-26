// Where Home's "Catch me up" brief (components/ai/CatchUp.tsx) is kept for a visit: this tab's sessionStorage,
// under the account it was written for. A brief is an account's notes in summary, so it is never kept under a
// name another account shares (every account's Personal is "personal"), and it goes when the account signs out
// or the tab moves to another account (lib/sync/db.ts, lib/places/web.ts).

const PREFIX = "folevi:catchup:";

/** The key of one account's brief for one place ("personal" or a workspace id). */
export const catchUpKey = (profileId: string, scopeKey: string) => `${PREFIX}${profileId}:${scopeKey}`;

/** Forgets every brief this tab holds, whoever's (also ones kept by an earlier build, which had no account in the key). */
export function clearCatchUps(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k?.startsWith(PREFIX)) keys.push(k);
    }
    for (const k of keys) sessionStorage.removeItem(k);
  } catch {
    /* storage unavailable: nothing was kept */
  }
}
