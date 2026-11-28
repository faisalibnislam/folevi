// The products that are still in beta: Folevi Server, labeled "Early Beta" (owner, 2026-11-28), and Folevi for Linux
// (Beta since 2026-11-26, paused 2026-11-28). Every badge,
// on the website, in the Linux app and in Folevi Server's own pages, shows the same note and feedback link from here,
// so they stay alike. Keep the Snap and AppStream listings (packaging/linux) in step with BETA_NOTE.
import { shell } from "@/lib/shell";

/** The badge's one-line note. */
export const BETA_NOTE = "Early Beta: works, but expect rough edges.";
/** The badge's label (owner, 2026-11-28: Folevi Server is "Early Beta"). */
export const BETA_LABEL = "Early Beta";
/** Where feedback goes: Folevi's support page (the same link the Linux packages give as their bug tracker). */
export const BETA_FEEDBACK_URL = "https://folevi.com/support";
export const BETA_FEEDBACK_LABEL = "Send feedback";

/** Whether this page runs in Folevi for Linux (apps/desktop on Linux). Windows, the Mac and browsers: false. */
export function isLinuxApp(): boolean {
  return shell()?.platform === "linux";
}
