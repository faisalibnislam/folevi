"use client";

import { AppLink } from "@/lib/app/router";
import { ViewChrome } from "@/components/app/Shell";
import { AccountSection } from "./settings/AccountSection";
import { SecuritySection } from "./settings/SecuritySection";
import { AppearanceSection } from "./settings/AppearanceSection";
import { NotificationsSection } from "./settings/NotificationsSection";
import { WorkspaceSection } from "./settings/WorkspaceSection";
import { MembersSection } from "./settings/MembersSection";
import { SyncSection } from "./settings/SyncSection";
import { DataSection } from "./settings/DataSection";

type Section = "account" | "security" | "appearance" | "notifications" | "workspace" | "members" | "sync" | "data";
const SECTIONS: { id: Section; label: string }[] = [
  { id: "account", label: "Account" },
  { id: "security", label: "Security & sessions" },
  { id: "appearance", label: "Appearance" },
  { id: "notifications", label: "Notifications" },
  { id: "workspace", label: "Workspace" },
  { id: "members", label: "Members" },
  { id: "sync", label: "Offline & sync" },
  { id: "data", label: "Import & export" },
];

export function SettingsView({ section }: { section: Section }) {
  return (
    <ViewChrome title={<h1 className="text-sm font-semibold">Settings</h1>} tabTitle="Settings">
      <div className="mx-auto grid max-w-5xl gap-8 px-4 pb-24 pt-6 sm:px-8 md:grid-cols-[200px_1fr]">
        <nav aria-label="Settings sections">
          <ul className="flex gap-1 overflow-x-auto md:flex-col">
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <AppLink href={`/settings/${s.id}`} aria-current={section === s.id ? "page" : undefined} className={`block whitespace-nowrap rounded-[10px] px-3 py-1.5 text-sm ${section === s.id ? "ui-raised font-semibold text-heading" : "text-muted transition-colors hover:bg-accent-soft hover:text-heading"}`}>
                  {s.label}
                </AppLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className="min-w-0 space-y-5">
          <h2 className="ui-display text-[34px] leading-tight">{SECTIONS.find((s) => s.id === section)?.label}</h2>
          {section === "account" ? <AccountSection /> : null}
          {section === "security" ? <SecuritySection /> : null}
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

