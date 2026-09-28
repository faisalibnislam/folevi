"use client";

import { ArrowDownUp, Bell, Building2, CreditCard, MonitorSmartphone, Palette, RefreshCw, ShieldCheck, UserRound, Users, type LucideIcon } from "lucide-react";
import { AppLink } from "@/lib/app/router";
import { ViewChrome } from "@/components/app/Shell";
import { AccountSection } from "./settings/AccountSection";
import { SecuritySection } from "./settings/SecuritySection";
import { DevicesSection } from "./settings/DevicesSection";
import { AppearanceSection } from "./settings/AppearanceSection";
import { BillingSection } from "./settings/BillingSection";
import { NotificationsSection } from "./settings/NotificationsSection";
import { WorkspaceSection } from "./settings/WorkspaceSection";
import { MembersSection } from "./settings/MembersSection";
import { SyncSection } from "./settings/SyncSection";
import { DataSection } from "./settings/DataSection";

type Section = "account" | "billing" | "security" | "devices" | "appearance" | "notifications" | "workspace" | "members" | "sync" | "data";
type Item = { id: Section; label: string; icon: LucideIcon };
/** Grouped like the app sidebar: things about you, then things about the current workspace. */
const GROUPS: { label: string; items: Item[] }[] = [
  {
    label: "You",
    items: [
      { id: "account", label: "Account", icon: UserRound },
      { id: "billing", label: "Plan & billing", icon: CreditCard },
      { id: "security", label: "Security", icon: ShieldCheck },
      { id: "devices", label: "Devices", icon: MonitorSmartphone },
      { id: "appearance", label: "Appearance", icon: Palette },
      { id: "notifications", label: "Notifications", icon: Bell },
    ],
  },
  {
    label: "Workspace",
    items: [
      { id: "workspace", label: "Workspace", icon: Building2 },
      { id: "members", label: "Members", icon: Users },
      { id: "sync", label: "Offline & sync", icon: RefreshCw },
      { id: "data", label: "Import & export", icon: ArrowDownUp },
    ],
  },
];
const SECTIONS = GROUPS.flatMap((g) => g.items);

export function SettingsView({ section }: { section: Section }) {
  return (
    <ViewChrome title={<h1 className="text-sm font-semibold">Settings</h1>} tabTitle="Settings">
      <div className="mx-auto grid max-w-5xl gap-8 px-4 pb-24 pt-6 sm:px-8 md:grid-cols-[216px_1fr] md:gap-10">
        <nav aria-label="Settings sections" className="md:sticky md:top-[76px] md:self-start">
          <div className="flex gap-6 overflow-x-auto pb-1 md:flex-col md:gap-5 md:overflow-visible md:pb-0">
            {GROUPS.map((g) => (
              <div key={g.label} className="flex-none">
                <p className="mb-1.5 px-2.5 text-[11px] font-semibold uppercase tracking-[0.07em] text-faint">{g.label}</p>
                <ul className="flex gap-0.5 md:flex-col">
                  {g.items.map((s) => {
                    const active = section === s.id;
                    const Icon = s.icon;
                    return (
                      <li key={s.id}>
                        <AppLink
                          href={`/settings/${s.id}`}
                          aria-current={active ? "page" : undefined}
                          className={`group flex h-8 items-center gap-2.5 whitespace-nowrap rounded-[6px] px-2.5 text-[13.5px] outline-none transition-[background-color,box-shadow,color] duration-150 focus-visible:ring-2 focus-visible:ring-focus pointer-coarse:h-11 ${
                            active ? "bg-[var(--glass-active)] font-semibold text-heading shadow-[var(--glass-edge),0_1px_3px_rgb(0_0_0/0.06)]" : "text-ink/90 hover:bg-[var(--glass-hover)] hover:text-heading"
                          }`}
                        >
                          <Icon size={16} aria-hidden className={`flex-none transition-colors ${active ? "text-heading" : "text-muted group-hover:text-heading"}`} />
                          {s.label}
                        </AppLink>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </nav>
        <div className="min-w-0 space-y-5">
          <h2 className="ui-display text-[34px] leading-tight">{SECTIONS.find((s) => s.id === section)?.label}</h2>
          {section === "account" ? <AccountSection /> : null}
          {section === "billing" ? <BillingSection /> : null}
          {section === "security" ? <SecuritySection /> : null}
          {section === "devices" ? <DevicesSection /> : null}
          {section === "appearance" ? <AppearanceSection /> : null}
          {section === "notifications" ? <NotificationsSection /> : null}
          {section === "workspace" ? <WorkspaceSection /> : null}
          {section === "members" ? <MembersSection /> : null}
          {section === "sync" ? <SyncSection /> : null}
          {section === "data" ? <DataSection /> : null}
        </div>
      </div>
    </ViewChrome>
  );
}

