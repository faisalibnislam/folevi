"use client";
// Settings > About: which Folevi this is (its version, never a build number) and the pages people look for about
// it (what's new, privacy, terms, the AI policy, security, status). The version lives here only; Settings has no
// version line at its foot any more (the owner, 2026-11-01). It is also where the terms and privacy links live, so it
// names the company that operates Folevi with its postal address and the copyright line (the owner, 2026-11-27).
import { ExternalLink } from "lucide-react";
import { isLinuxApp } from "@/lib/beta";
import { websiteUrl } from "@/lib/env";
import { BetaNote } from "@/components/ui/Beta";
import { useIphoneLook } from "@/lib/iphone";
import { versionLabel } from "@/lib/version";
import { IosRow, IosSection, useShownVersion } from "@/components/iphone/SettingsKit";
import { OPERATOR, OPERATOR_ADDRESS, OPERATOR_COPYRIGHT } from "@/components/marketing/site";
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
  // Folevi for Linux is in beta (lib/beta.ts); Windows, the Mac and browsers show no badge.
  const linux = isLinuxApp();
  if (iphone) {
    return (
      <>
        <IosSection>
          <IosRow label="Version" value={version} />
        </IosSection>
        <IosSection>
          {ABOUT_LINKS.map((l) => (
            <IosRow key={l.path} label={l.label} trailing={<ExternalLink size={15} aria-hidden className="text-muted" />} onClick={() => void window.open(`${websiteUrl()}${l.path}`, "_blank", "noopener")} />
          ))}
        </IosSection>
        <IosSection
          label="Operator"
          data={{ "data-testid": "about-operator" }}
          footer={
            <>
              {OPERATOR_ADDRESS}
              <br />
              {OPERATOR_COPYRIGHT}
            </>
          }
        >
          <IosRow label="Operated by" value={OPERATOR.name} trailing={<ExternalLink size={15} aria-hidden className="text-muted" />} onClick={() => void window.open(OPERATOR.url, "_blank", "noopener")} />
        </IosSection>
      </>
    );
  }
  return (
    <div className="space-y-5">
      <Card title={versionLabel(version)} description={linux ? <BetaNote badge /> : undefined}>
        <ul className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          {ABOUT_LINKS.map((l) => (
            <li key={l.path}>
              <a href={`${websiteUrl()}${l.path}`} target="_blank" rel="noopener" className="inline-flex items-center gap-1.5 text-body text-ink underline decoration-line underline-offset-4 hover:text-heading">
                {l.label}
                <ExternalLink size={13} aria-hidden className="text-muted" />
              </a>
            </li>
          ))}
        </ul>
        <div data-testid="about-operator" className="mt-4 border-t border-line pt-3 text-footnote leading-relaxed text-muted">
          <p>
            Operated by{" "}
            <a href={OPERATOR.url} target="_blank" rel="noopener" className="text-ink underline decoration-line underline-offset-4 hover:text-heading">
              {OPERATOR.name}
            </a>
          </p>
          <p>{OPERATOR_ADDRESS}</p>
          <p>{OPERATOR_COPYRIGHT}</p>
        </div>
      </Card>
    </div>
  );
}
