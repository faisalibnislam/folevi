"use client";

import { useState } from "react";
import { ArrowDownUp, Bell, Building2, CreditCard, MonitorSmartphone, Palette, Plus, RefreshCw, ShieldCheck, UserRound, UserRoundPlus, Users, type LucideIcon } from "lucide-react";
import { AppLink, useAppRouter } from "@/lib/app/router";
import { useAppState } from "@/lib/app/state";
import { ViewChrome } from "@/components/app/Shell";
import { NewWorkspaceDialog } from "@/components/app/NewWorkspaceDialog";
import { Button } from "@/components/ui/Button";
import { AccountSection } from "./settings/AccountSection";
import { SecuritySection } from "./settings/SecuritySection";
import { DevicesSection } from "./settings/DevicesSection";
import { AppearanceSection } from "./settings/AppearanceSection";
import { BillingSection } from "./settings/BillingSection";
import { NotificationsSection } from "./settings/NotificationsSection";
import { WorkspaceSection } from "./settings/WorkspaceSection";
import { MembersSection } from "./settings/MembersSection";
import { GuestsSection } from "./settings/GuestsSection";
import { WorkspaceBillingSection } from "./settings/WorkspaceBillingSection";
import { SyncSection } from "./settings/SyncSection";
import { DataSection } from "./settings/DataSection";
import { Card } from "./settings/Card";

type Section = "account" | "billing" | "security" | "devices" | "appearance" | "notifications" | "workspace" | "members" | "workspace-guests" | "workspace-billing" | "workspace-data" | "sync" | "data";
type Item = { id: Section; label: string; icon: LucideIcon };
/** Things about you (your account and your Personal), the same whichever context is open. */
const YOU: Item[] = [
  { id: "account", label: "Account", icon: UserRound },
  { id: "billing", label: "Plan & billing", icon: CreditCard },
  { id: "security", label: "Security", icon: ShieldCheck },
  { id: "devices", label: "Devices", icon: MonitorSmartphone },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "sync", label: "Offline & sync", icon: RefreshCw },
  { id: "data", label: "Import & export", icon: ArrowDownUp },
];
/**
 * The current team workspace's settings, only when a workspace is open. Personal has none of these.
 * Each is listed only for the roles that may use it (the server checks every action again):
 *   General and Members: everyone in the workspace (members read; owners and admins change);
 *   Guests and Import & export: owners and admins;
 *   Plan & billing: the owner, and admins the owner allowed.
 */
const WORKSPACE: (Item & { who: "everyone" | "managers" | "billing" })[] = [
  { id: "workspace", label: "General", icon: Building2, who: "everyone" },
  { id: "members", label: "Members", icon: Users, who: "everyone" },
  { id: "workspace-guests", label: "Guests", icon: UserRoundPlus, who: "managers" },
  { id: "workspace-billing", label: "Plan & billing", icon: CreditCard, who: "billing" },
  { id: "workspace-data", label: "Import & export", icon: ArrowDownUp, who: "managers" },
];
const WORKSPACE_SECTIONS = new Set<Section>(WORKSPACE.map((i) => i.id));
const HEADINGS: Partial<Record<Section, string>> = { workspace: "Workspace" };

export function SettingsView({ section }: { section: Section }) {
  const { workspace } = useAppState();
  const allowed = (who: (typeof WORKSPACE)[number]["who"]) => who === "everyone" || (who === "managers" ? workspace?.canManage === true : workspace?.canManageBilling === true);
  const workspaceItems = WORKSPACE.filter((i) => allowed(i.who));
  const groups = [{ label: "You", items: YOU }, ...(workspace ? [{ label: workspace.name, items: workspaceItems }] : [])];
  const item = [...YOU, ...WORKSPACE].find((s) => s.id === section);
  const heading = (WORKSPACE_SECTIONS.has(section) && HEADINGS[section]) || item?.label;
  // A workspace section opened in Personal (a bookmark, or right after leaving a workspace).
  const noWorkspace = WORKSPACE_SECTIONS.has(section) && !workspace;
  // A workspace section this role can't use (opened by URL): the page doesn't exist for them.
  const workspaceItem = WORKSPACE.find((i) => i.id === section);
  const sectionHidden = workspace !== null && workspaceItem !== undefined && !allowed(workspaceItem.who);
  return (
    <ViewChrome title={<h1 className="text-sm font-semibold">Settings</h1>} tabTitle="Settings">
      <div className="mx-auto grid max-w-5xl gap-8 px-4 pb-24 pt-6 sm:px-8 md:grid-cols-[216px_1fr] md:gap-10">
        <nav aria-label="Settings sections" className="md:sticky md:top-[76px] md:self-start">
          <div className="flex gap-6 overflow-x-auto pb-1 md:flex-col md:gap-5 md:overflow-visible md:pb-0">
            {groups.map((g) => (
              <div key={g.label} className="flex-none">
                <p className="mb-1.5 truncate px-2.5 text-[11px] font-semibold uppercase tracking-[0.07em] text-faint">{g.label}</p>
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
            {!workspace ? <CreateWorkspaceNudge /> : null}
          </div>
        </nav>
        <div className="min-w-0 space-y-5">
          <h2 className="ui-display text-[34px] leading-tight">{noWorkspace ? "Workspace" : sectionHidden ? "Not found" : heading}</h2>
          {section === "account" ? <AccountSection /> : null}
          {section === "billing" ? <BillingSection /> : null}
          {section === "security" ? <SecuritySection /> : null}
          {section === "devices" ? <DevicesSection /> : null}
          {section === "appearance" ? <AppearanceSection /> : null}
          {section === "notifications" ? <NotificationsSection /> : null}
          {noWorkspace ? <NoWorkspaceCard /> : null}
          {section === "workspace" && workspace ? <WorkspaceSection /> : null}
          {section === "members" && workspace ? <MembersSection key={workspace.id} workspace={workspace} /> : null}
          {section === "workspace-guests" && workspace && !sectionHidden ? <GuestsSection key={workspace.id} workspace={workspace} /> : null}
          {section === "workspace-billing" && workspace && !sectionHidden ? <WorkspaceBillingSection key={workspace.id} workspace={workspace} /> : null}
          {sectionHidden ? (
            <Card title="This page isn't available">
              {section === "workspace-billing" ? "There's nothing here for you. Switch to Personal to see your own plan and billing." : "Only this workspace's owner and admins can open this page."}
            </Card>
          ) : null}
          {section === "workspace-data" && workspace && !sectionHidden ? <DataSection key={workspace.id} target={{ kind: "workspace", workspaceId: workspace.id, name: workspace.name }} /> : null}
          {section === "sync" ? <SyncSection /> : null}
          {section === "data" ? <DataSection key="personal" target={{ kind: "personal" }} /> : null}
        </div>
      </div>
    </ViewChrome>
  );
}

/** Where the Workspace group would be, in Personal: a small way to start one. */
function CreateWorkspaceNudge() {
  const [open, setOpen] = useState(false);
  const { navigate } = useAppRouter();
  return (
    <div className="flex-none rounded-[8px] border border-line p-3 md:mt-1">
      <p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-faint">Workspace</p>
      <p className="mt-1 max-w-52 text-[12.5px] text-muted">Work with a team: shared notes, folders and tasks, with its own plan and members.</p>
      <Button size="sm" className="mt-2" onClick={() => setOpen(true)}>
        <Plus size={14} aria-hidden /> Create a workspace
      </Button>
      <NewWorkspaceDialog open={open} onClose={() => setOpen(false)} onCreated={() => navigate("/settings/workspace")} />
    </div>
  );
}

function NoWorkspaceCard() {
  const [open, setOpen] = useState(false);
  const { navigate } = useAppRouter();
  return (
    <Card title="You're in Personal" description="Personal is just yours: it has no members or workspace settings. Switch to a workspace from the menu at the bottom of the sidebar, or create one for your team.">
      <Button variant="primary" onClick={() => setOpen(true)}>
        <Plus size={14} aria-hidden /> Create a workspace
      </Button>
      <NewWorkspaceDialog open={open} onClose={() => setOpen(false)} onCreated={() => navigate("/settings/workspace")} />
    </Card>
  );
}
