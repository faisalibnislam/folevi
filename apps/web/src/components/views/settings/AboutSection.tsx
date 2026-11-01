"use client";
// Settings > About: which Folevi this is (its version, never a build number) and the pages people look for about
// it (what's new, privacy, terms, the AI policy, security, status). The version lives here only; Settings has no
// version line at its foot any more (the owner, 2026-11-01).
import { ExternalLink } from "lucide-react";
import { MARKETING_URL } from "@/lib/env";
import { useIphoneLook } from "@/lib/iphone";
import { versionLabel } from "@/lib/version";
import { IosRow, IosSection, useShownVersion } from "@/components/iphone/SettingsKit";
import { Card } from "./Card";

/** The pages About links to, on the website. */
export const ABOUT_LINKS: { label: string; path: string }[] = [
  { label: "What's new", path: "/changelog" },
  { label: "Privacy policy", path: "/privacy" },
  { label: "Terms of service", path: "/terms" },
  { label: "AI policy", path: "/ai-policy" },
  { label: "Security", path: "/security" },
  { label: "Service status", path: "/status" },
];

export function AboutSection() {
  const version = useShownVersion();
  const iphone = useIphoneLook();
  if (iphone) {
    return (
      <>
        <IosSection>
          <IosRow label="Version" value={version} />
        </IosSection>
        <IosSection>
          {ABOUT_LINKS.map((l) => (
            <IosRow key={l.path} label={l.label} trailing={<ExternalLink size={15} aria-hidden className="text-muted" />} onClick={() => void window.open(`${MARKETING_URL}${l.path}`, "_blank", "noopener")} />
          ))}
        </IosSection>
      </>
    );
  }
  return (
    <div className="space-y-5">
      <Card title={versionLabel(version)}>
        <ul className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          {ABOUT_LINKS.map((l) => (
            <li key={l.path}>
              <a href={`${MARKETING_URL}${l.path}`} target="_blank" rel="noopener" className="inline-flex items-center gap-1.5 text-body text-ink underline decoration-line underline-offset-4 hover:text-heading">
                {l.label}
                <ExternalLink size={13} aria-hidden className="text-muted" />
              </a>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
