// How Folevi for Windows was started. Windows hands a folevi:// link to the app as a command-line argument (to the
// first copy at launch, or to the running copy through second-instance), and a start at sign-in carries
// --hidden (main.ts sets it as the login item's argument) so the window stays put away.
import { SCHEME } from "./urls";

/** The argument that marks a start at sign-in (Settings > Desktop app, "Open when you sign in"). */
export const HIDDEN_ARG = "--hidden";

/** The folevi:// link among the arguments, or null. Only the first one counts, and only a short one. */
export function linkFromArgs(argv: readonly string[]): string | null {
  for (const arg of argv) {
    if (typeof arg !== "string" || arg.length > 2000) continue;
    if (arg.toLowerCase().startsWith(`${SCHEME}:`)) return arg;
  }
  return null;
}

/** Whether the app was started at sign-in (and so opens without showing its window). */
export function startedHidden(argv: readonly string[]): boolean {
  return argv.includes(HIDDEN_ARG);
}
