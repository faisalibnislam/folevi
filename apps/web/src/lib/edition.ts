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
