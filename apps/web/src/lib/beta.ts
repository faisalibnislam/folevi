// The products that are still in beta (owner, 2026-11-26): Folevi for Linux and Folevi Server. Every Beta badge,
// on the website, in the Linux app and in Folevi Server's own pages, shows the same note and feedback link from here,
// so they stay alike. Keep the Snap and AppStream listings (packaging/linux) in step with BETA_NOTE.
import { shell } from "@/lib/shell";

/** The badge's one-line note. */
export const BETA_NOTE = "Beta: works, but expect rough edges.";
/** Where feedback goes: Folevi's support page (the same link the Linux packages give as their bug tracker). */
export const BETA_FEEDBACK_URL = "https://folevi.com/support";
export const BETA_FEEDBACK_LABEL = "Send feedback";

/** Whether this page runs in Folevi for Linux (apps/desktop on Linux). Windows, the Mac and browsers: false. */
export function isLinuxApp(): boolean {
  return shell()?.platform === "linux";
}
