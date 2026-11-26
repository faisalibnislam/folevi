"use client";

// A member's first screen after joining from an invite (`/join/welcome`): you're in, here's how to add the server
// in the Mac, iPhone, iPad and Android apps, then on into Folevi.
import { Check } from "lucide-react";
import { FoleviLogo } from "@/components/brand/FoleviMark";
import { AuthHeading } from "@/components/auth/fields";
import { ConnectApps } from "./ConnectApps";

export function JoinedWelcome({ serverName }: { serverName: string }) {
  return (
    <div className="ui-canvas ui-neutral-chrome grid min-h-dvh place-items-center px-4 py-12">
      <div className="w-full max-w-lg">
        <span className="mb-6 inline-flex items-center gap-2 text-ink">
          <FoleviLogo height={28} title={null} />
        </span>
        <main id="main" className="relative">
          <div aria-hidden className="absolute inset-0 translate-x-2 translate-y-2 ui-card rounded-control" />
          <div className="relative ui-card rounded-control p-6 sm:p-8">
            <span className="mb-4 grid size-11 place-items-center rounded-container bg-heading text-canvas" aria-hidden>
              <Check size={22} strokeWidth={2.5} />
            </span>
            <AuthHeading title={`You're in ${serverName}`} lede="Your notes live on this server. Use Folevi right here in the browser, or add the server in the app on your phone, tablet or computer." />
            <ConnectApps serverName={serverName} stacked />
            <a href="/documents" className="ui-btn ui-btn-primary mt-6 h-control w-full text-body">
              Open Folevi
            </a>
          </div>
        </main>
      </div>
    </div>
  );
}
