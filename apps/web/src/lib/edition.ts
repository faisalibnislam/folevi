// Which product this build is (docs/self-hosting/CONTRACT.md §1): Folevi Cloud, or Folevi Server (self-hosted).
//
// The edition is chosen when the web app is built: `FOLEVI_EDITION=server next build` makes the server build
// (next.config.ts inlines NEXT_PUBLIC_FOLEVI_EDITION from it), so in the cloud build every
// `if (isServerEdition())` branch is dead code. Addresses are never chosen at build time in the server edition:
// they come from the runtime environment (lib/runtime/config.ts).

export type Edition = "cloud" | "server";

/** True in the Folevi Server build; false in Folevi Cloud (and in tests unless they set the variable). */
export function isServerEdition(): boolean {
  return process.env.NEXT_PUBLIC_FOLEVI_EDITION === "server";
}

export function edition(): Edition {
  return isServerEdition() ? "server" : "cloud";
}

/**
 * Whether this deployment may answer development-only pages (/dev/*, the dev mailbox): never Folevi Cloud's
 * production, and never a Folevi server. A server is always production, but its web process isn't told so
 * (folevid sets FOLEVI_ENV for the backend only), so the edition is asked as well.
 */
export function devPagesAvailable(): boolean {
  return process.env.VERCEL_ENV !== "production" && process.env.FOLEVI_ENV !== "production" && !isServerEdition();
}
