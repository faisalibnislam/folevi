"use client";

import { copy } from "@/lib/e2ee/copy";
import { PrivacyPanel } from "@/components/e2ee/PrivacyPanel";

/**
 * Settings > Privacy (docs/E2EE_DESIGN.md §10.1): how much of your Personal space Folevi's servers can read,
 * the feature switches, and the ways to unlock. For a Standard account this is the only new screen.
 */
export function PrivacySection() {
  return (
    <>
      <p className="max-w-prose text-sm text-muted">{copy.privacy.intro}</p>
      <PrivacyPanel scope={{ kind: "personal" }} />
    </>
  );
}
