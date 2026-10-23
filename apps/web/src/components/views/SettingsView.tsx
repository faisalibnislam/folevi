"use client";

import { useEffect, useState } from "react";
import { AppWindowMac, ArrowDownUp, Bell, Building2, CreditCard, LockKeyhole, MonitorSmartphone, Palette, Plug, Plus, RefreshCw, LibraryBig, ShieldCheck, Smartphone, Sparkles, UserRound, UserRoundPlus, Users, type LucideIcon } from "lucide-react";
import { AppLink, useAppRouter } from "@/lib/app/router";
import { useAppState } from "@/lib/app/state";
import { ViewChrome } from "@/components/app/Shell";
import { NewWorkspaceDialog } from "@/components/app/NewWorkspaceDialog";
import { Button } from "@/components/ui/Button";
import { AccountSection } from "./settings/AccountSection";
import { AiSection } from "./settings/AiSection";
import { LocalAiSection } from "./settings/LocalAiSection";
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
import { LibrarySection } from "./settings/LibrarySection";
import { DataSection } from "./settings/DataSection";
import { DesktopSection } from "./settings/DesktopSection";
import { ThisDeviceSection } from "./settings/ThisDeviceSection";
import { ConnectedAppsSection } from "./settings/ConnectedAppsSection";
import { PrivacySection } from "./settings/PrivacySection";
import { WorkspacePrivacySection } from "./settings/WorkspacePrivacySection";
import { Card } from "./settings/Card";
import { useCapabilities, type Capability } from "@/lib/mode";
import { desktop } from "@/lib/desktop";
import { nativeApp } from "@/lib/nativeApp";
import { IphoneLookContext, useIpadLayout, useIphoneApp, useIphoneLook } from "@/lib/iphone";
import { ChevronLeft } from "lucide-react";
import { PillButton } from "@/components/iphone/Glass";
import { RowIcon } from "@/components/iphone/Grouped";
import { inMacApp } from "@/lib/desktop/mac";
import { IosRow, IosSection, IosText, SettingsScreensHost, VersionFooter, useSettingsScreens } from "@/components/iphone/SettingsKit";

type Section = "account" | "ai" | "billing" | "security" | "privacy" | "devices" | "connected-apps" | "appearance" | "notifications" | "workspace" | "members" | "workspace-guests" | "workspace-billing" | "workspace-data" | "workspace-privacy" | "sync" | "library" | "data" | "desktop" | "this-device";
type Item = { id: Section; label: string; icon: LucideIcon };
/** Things about you (your account and your Personal), the same whichever context is open. */
const YOU: Item[] = [
  { id: "account", label: "Account", icon: UserRound },
  { id: "ai", label: "AI", icon: Sparkles },
  { id: "billing", label: "Plan & billing", icon: CreditCard },
  { id: "security", label: "Security", icon: ShieldCheck },
  // End-to-end encryption (docs/E2EE_DESIGN.md §10.1).
  { id: "privacy", label: "Privacy", icon: LockKeyhole },
  { id: "devices", label: "Devices", icon: MonitorSmartphone },
  { id: "connected-apps", label: "Connected apps", icon: Plug },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "sync", label: "Offline & sync", icon: RefreshCw },
  // Local mode's library: where it is, devices, health, passphrase, the lock (WP10). Only in local mode.
  { id: "library", label: "Library", icon: LibraryBig },
  { id: "data", label: "Import & export", icon: ArrowDownUp },
  { id: "desktop", label: "Desktop app", icon: AppWindowMac },
  { id: "this-device", label: "This device", icon: Smartphone },
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
  // The workspace's end-to-end encryption: owners and admins change it, members read it (§10.1).
  { id: "workspace-privacy", label: "Privacy", icon: LockKeyhole, who: "everyone" },
  { id: "workspace-guests", label: "Guests", icon: UserRoundPlus, who: "managers" },
  { id: "workspace-billing", label: "Plan & billing", icon: CreditCard, who: "billing" },
  { id: "workspace-data", label: "Import & export", icon: ArrowDownUp, who: "managers" },
];
const WORKSPACE_SECTIONS = new Set<Section>(WORKSPACE.map((i) => i.id));
/**
 * Sections only an account has (docs/LOCAL_MODE_PLAN.md §5.2): in local mode they're not listed, and opened by
 * address they show the "Sign in to Folevi" note. Settings > AI stays: in local mode it sets up Foli AI on the
 * device (Apple's model, the person's own keys; LocalAiSection, WP11).
 */
const NEEDS: Partial<Record<Section, Capability>> = {
  account: "account",
  billing: "billing",
  security: "account",
  privacy: "account",
  devices: "account",
  "connected-apps": "connectedApps",
  notifications: "notifications",
  // The account's offline copy; a library's own section takes its place (WP10).
  sync: "account",
  ...Object.fromEntries([...WORKSPACE_SECTIONS].map((id) => [id, "workspaces"])),
};
/** Where Settings opens when the account's first section, Account, isn't there (local mode). */
const LOCAL_FIRST: Section = "library";
const HEADINGS: Partial<Record<Section, string>> = { workspace: "Workspace", "workspace-privacy": "Workspace privacy" };

export function SettingsView({ section: asked }: { section: Section }) {
  const { workspace } = useAppState();
  const { pathname, navigate, search } = useAppRouter();
  // Folevi for Mac's Settings window (/settings/<section>?window=1): the section alone (its toolbar lists them).
  const settingsWindow = search.get("window") === "1" && inMacApp();
  const caps = useCapabilities();
  const here = (id: Section) => !NEEDS[id] || caps[NEEDS[id]!];
  // A section this backend doesn't have (plain /settings opens on Account; an old link) shows the first one
  // it has, and the address follows.
  const section = here(asked) ? asked : LOCAL_FIRST;
  const bare = pathname.replace(/\/+$/, "") === "/settings";
  useEffect(() => {
    if (!here(asked) && !bare) navigate(`/settings/${LOCAL_FIRST}`, { replace: true });
  }, [asked, bare]); // eslint-disable-line react-hooks/exhaustive-deps
  const iphone = useIphoneApp();
  const ipad = useIpadLayout();
  const allowed = (who: (typeof WORKSPACE)[number]["who"]) => who === "everyone" || (who === "managers" ? workspace?.canManage === true : workspace?.canManageBilling === true);
  const workspaceItems = WORKSPACE.filter((i) => allowed(i.who));
  // Desktop app: only in the Mac app; This device: only in the iPhone and iPad app (or opened by its address).
  const you = YOU.filter((i) => here(i.id) && (i.id !== "library" || !caps.account) && (i.id !== "desktop" || desktop() !== null || section === "desktop") && (i.id !== "this-device" || nativeApp() !== null || section === "this-device"))
    // In local mode the library comes first: it's where Settings opens (LOCAL_FIRST).
    .sort((a, b) => Number(b.id === "library") - Number(a.id === "library"));
  const groups = [{ label: "You", items: you }, ...(workspace ? [{ label: workspace.name, items: workspaceItems }] : [])];
  const item = [...YOU, ...WORKSPACE].find((s) => s.id === section);
  const heading = (WORKSPACE_SECTIONS.has(section) && HEADINGS[section]) || item?.label;
  // A workspace section opened in Personal (a bookmark, or right after leaving a workspace).
  const noWorkspace = WORKSPACE_SECTIONS.has(section) && !workspace;
  // A workspace section this role can't use (opened by URL): the page doesn't exist for them.
  const workspaceItem = WORKSPACE.find((i) => i.id === section);
  const sectionHidden = workspace !== null && workspaceItem !== undefined && !allowed(workspaceItem.who);
  // The iPhone app: Settings is a grouped list, and each section its own screen pushed from it.
  if (iphone && pathname.replace(/\/+$/, "") === "/settings") {
    return (
      <ViewChrome title="Settings" tabTitle="Settings" iphone={{ title: "Settings", grouped: true, back: "/documents" }}>
        <div className="space-y-7 pb-4 pt-3">
          {groups.map((g) => (
            <IosSection key={g.label} header={g.label}>
              {g.items.map((s) => {
                const Icon = s.icon;
                return (
                  <IosRow
                    key={s.id}
                    href={`/settings/${s.id}`}
                    icon={
                      <RowIcon>
                        <Icon />
                      </RowIcon>
                    }
                    label={s.label}
                  />
                );
              })}
            </IosSection>
          ))}
          {!workspace && caps.workspaces ? <IphoneCreateWorkspace /> : null}
          <VersionFooter />
        </div>
      </ViewChrome>
    );
  }
  if (iphone) {
    const title = noWorkspace ? "Workspace" : sectionHidden ? "Not found" : (heading ?? "Settings");
    // A section and its pushed screens (a choice, an edit, a group of settings): SettingsKit.tsx.
    return (
      <SettingsScreensHost
        render={({ active, chrome, slot, actions }) =>
          active ? (
            <ViewChrome title={chrome?.title ?? title} tabTitle={`Settings · ${chrome?.title ?? title}`} iphone={{ title: chrome?.title ?? "", grouped: true, back: pathname, trailing: <span ref={actions} className="contents" /> }}>
              <div ref={slot} />
            </ViewChrome>
          ) : null
        }
      >
        <IphoneSection section={section} title={title} noWorkspace={noWorkspace} sectionHidden={sectionHidden} />
      </SettingsScreensHost>
    );
  }
  if (ipad) {
    // The iPad: iPadOS Settings' two columns. The sections as a grouped list beside the open one, which is drawn
    // as on the iPhone (its grouped lists, switches, choices on screens of their own, IphoneLookContext).
    const title = noWorkspace ? "Workspace" : sectionHidden ? "Not found" : (heading ?? "Settings");
    return (
      <ViewChrome title={<h1 className="text-sm font-semibold">Settings</h1>} tabTitle="Settings">
        <div className="-mt-[68px] min-h-[calc(100%+68px)] bg-[var(--iphone-grouped)] pt-[68px]" data-ipad-settings="">
          <div className="mx-auto grid max-w-5xl grid-cols-[minmax(0,280px)_minmax(0,1fr)] gap-2 pb-16 pr-2 pt-4 [@media(min-width:1200px)]:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
            <nav aria-label="Settings sections" className="sticky top-4 space-y-7 self-start">
              {groups.map((g) => (
                <IosSection key={g.label} header={g.label}>
                  {g.items.map((s) => {
                    const Icon = s.icon;
                    return (
                      <IosRow
                        key={s.id}
                        href={`/settings/${s.id}`}
                        current={section === s.id}
                        icon={
                          <RowIcon>
                            <Icon />
                          </RowIcon>
                        }
                        label={s.label}
                      />
                    );
                  })}
                </IosSection>
              ))}
              {!workspace && caps.workspaces ? <IphoneCreateWorkspace /> : null}
              <VersionFooter />
            </nav>
            <IphoneLookContext.Provider value>
              <SettingsScreensHost
                render={({ active, chrome, slot, actions }) =>
                  active ? (
                    <div className="min-w-0">
                      <IpadSubscreenBar title={chrome?.title ?? ""} actions={actions} />
                      <div ref={slot} />
                    </div>
                  ) : null
                }
              >
                <div className="min-w-0">
                  <h2 className="ui-large-title px-5 pb-1 pt-1">{title}</h2>
                  <SectionBody section={section} noWorkspace={noWorkspace} sectionHidden={sectionHidden} />
                </div>
              </SettingsScreensHost>
            </IphoneLookContext.Provider>
          </div>
        </div>
      </ViewChrome>
    );
  }
  return (
    <ViewChrome title={<h1 className="text-sm font-semibold">Settings</h1>} tabTitle="Settings">
      <div data-mac-settings-window={settingsWindow ? "" : undefined} className="mx-auto grid max-w-5xl grid-cols-[minmax(0,1fr)] gap-8 px-4 pb-[max(6rem,var(--fab-clearance))] pt-6 sm:px-8 md:grid-cols-[216px_minmax(0,1fr)] md:gap-10">
        <nav aria-label="Settings sections" hidden={settingsWindow} className="md:sticky md:top-6 md:self-start">
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
                          className={`group flex h-8 items-center gap-2.5 whitespace-nowrap rounded-chip px-2.5 text-[13.5px] outline-none transition-[background-color,box-shadow,color] duration-150 focus-visible:ring-2 focus-visible:ring-focus pointer-coarse:h-11 ${
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
            {!workspace && caps.workspaces ? <CreateWorkspaceNudge /> : null}
          </div>
        </nav>
        <div className="min-w-0 space-y-5">
          <h2 className={settingsWindow ? "sr-only" : "ui-display text-[34px] leading-tight"}>{noWorkspace ? "Workspace" : sectionHidden ? "Not found" : heading}</h2>
          {section === "account" ? <AccountSection /> : null}
          {section === "ai" ? caps.account ? <AiSection /> : <LocalAiSection /> : null}
          {section === "billing" ? <BillingSection /> : null}
          {section === "security" ? <SecuritySection /> : null}
          {section === "privacy" ? <PrivacySection /> : null}
          {section === "devices" ? <DevicesSection /> : null}
          {section === "connected-apps" ? <ConnectedAppsSection /> : null}
          {section === "appearance" ? <AppearanceSection /> : null}
          {section === "notifications" ? <NotificationsSection /> : null}
          {noWorkspace ? <NoWorkspaceCard /> : null}
          {section === "workspace" && workspace ? <WorkspaceSection /> : null}
          {section === "members" && workspace ? <MembersSection key={workspace.id} workspace={workspace} /> : null}
          {section === "workspace-privacy" && workspace ? <WorkspacePrivacySection key={workspace.id} workspace={workspace} /> : null}
          {section === "workspace-guests" && workspace && !sectionHidden ? <GuestsSection key={workspace.id} workspace={workspace} /> : null}
          {section === "workspace-billing" && workspace && !sectionHidden ? <WorkspaceBillingSection key={workspace.id} workspace={workspace} /> : null}
          {sectionHidden ? (
            <Card title="This page isn't available">
              {section === "workspace-billing" ? "There's nothing here for you. Switch to Personal to see your own plan and billing." : "Only this workspace's owner and admins can open this page."}
            </Card>
          ) : null}
          {section === "workspace-data" && workspace && !sectionHidden ? <DataSection key={workspace.id} target={{ kind: "workspace", workspaceId: workspace.id, name: workspace.name }} /> : null}
          {section === "sync" ? <SyncSection /> : null}
          {section === "library" ? <LibrarySection /> : null}
          {section === "data" ? <DataSection key="personal" target={{ kind: "personal" }} /> : null}
          {section === "desktop" ? <DesktopSection /> : null}
          {section === "this-device" ? <ThisDeviceSection /> : null}
          <VersionFooter className="pt-4 text-[12px] leading-4 text-muted" />
        </div>
      </div>
    </ViewChrome>
  );
}

/**
 * A Settings section as a screen of the iPhone app (its own large title, a grouped list). While one of its
 * pushed screens is on show it stays mounted, hidden under it, so the rows that open those screens keep their
 * state and handlers.
 */
function IphoneSection({ section, title, noWorkspace, sectionHidden }: { section: Section; title: string; noWorkspace: boolean; sectionHidden: boolean }) {
  // (The same tree whether one of its screens is pushed or not, so the section keeps its state under it.)
  return (
    <ViewChrome title={title} tabTitle={`Settings · ${title}`} iphone={{ title, grouped: true, back: "/settings" }}>
      <SectionBody section={section} noWorkspace={noWorkspace} sectionHidden={sectionHidden} />
    </ViewChrome>
  );
}

/** A pushed screen's bar on the iPad (the iPhone's is the screen's own top bar): Back, its title, its actions. */
function IpadSubscreenBar({ title, actions }: { title: string; actions: (el: HTMLElement | null) => void }) {
  const screens = useSettingsScreens();
  return (
    <div className="flex items-center gap-2 px-3 pb-1">
      <PillButton label="Back" onClick={() => screens?.back()}>
        <ChevronLeft size={24} strokeWidth={2.2} aria-hidden />
      </PillButton>
      <h2 className="ui-large-title min-w-0 flex-1 truncate !text-[28px]">{title}</h2>
      <span ref={actions} className="contents" />
    </div>
  );
}

/** A section's grouped lists (the iPhone's screen, and the iPad's column beside the list of sections). */
function SectionBody({ section, noWorkspace, sectionHidden }: { section: Section; noWorkspace: boolean; sectionHidden: boolean }) {
  const { workspace } = useAppState();
  const caps = useCapabilities();
  return (
    <div className="space-y-7 pb-4 pt-3 [&_.ui-btn]:min-h-11 [&_.ui-btn]:text-[15px]">
      {section === "account" ? <AccountSection /> : null}
      {section === "ai" ? caps.account ? <AiSection /> : <LocalAiSection /> : null}
      {section === "billing" ? <BillingSection /> : null}
      {section === "security" ? <SecuritySection /> : null}
      {section === "privacy" ? <PrivacySection /> : null}
      {section === "devices" ? <DevicesSection /> : null}
      {section === "connected-apps" ? <ConnectedAppsSection /> : null}
      {section === "appearance" ? <AppearanceSection /> : null}
      {section === "notifications" ? <NotificationsSection /> : null}
      {noWorkspace ? <NoWorkspaceCard /> : null}
      {section === "workspace" && workspace ? <WorkspaceSection /> : null}
      {section === "members" && workspace ? <MembersSection key={workspace.id} workspace={workspace} /> : null}
      {section === "workspace-privacy" && workspace ? <WorkspacePrivacySection key={workspace.id} workspace={workspace} /> : null}
      {section === "workspace-guests" && workspace && !sectionHidden ? <GuestsSection key={workspace.id} workspace={workspace} /> : null}
      {section === "workspace-billing" && workspace && !sectionHidden ? <WorkspaceBillingSection key={workspace.id} workspace={workspace} /> : null}
      {sectionHidden ? (
        <IosSection header="This page isn't available">
          <IosText muted>{section === "workspace-billing" ? "There's nothing here for you. Switch to Personal to see your own plan and billing." : "Only this workspace's owner and admins can open this page."}</IosText>
        </IosSection>
      ) : null}
      {section === "workspace-data" && workspace && !sectionHidden ? <DataSection key={workspace.id} target={{ kind: "workspace", workspaceId: workspace.id, name: workspace.name }} /> : null}
      {section === "sync" ? <SyncSection /> : null}
      {section === "library" ? <LibrarySection /> : null}
      {section === "data" ? <DataSection key="personal" target={{ kind: "personal" }} /> : null}
      {section === "desktop" ? <DesktopSection /> : null}
      {section === "this-device" ? <ThisDeviceSection /> : null}
    </div>
  );
}

/** In the iPhone app's Settings, where a workspace's group would be: a way to start one. */
function IphoneCreateWorkspace() {
  const [open, setOpen] = useState(false);
  const { navigate } = useAppRouter();
  return (
    <IosSection header="Workspace" footer="Work with a team: shared notes, folders and tasks, with its own plan and members.">
      <IosRow
        icon={
          <RowIcon>
            <Plus />
          </RowIcon>
        }
        label="Create a workspace"
        onClick={() => setOpen(true)}
      />
      <NewWorkspaceDialog open={open} onClose={() => setOpen(false)} onCreated={() => navigate("/settings/workspace")} />
    </IosSection>
  );
}

/** Where the Workspace group would be, in Personal: a small way to start one. */
function CreateWorkspaceNudge() {
  const [open, setOpen] = useState(false);
  const { navigate } = useAppRouter();
  return (
    <div className="hidden flex-none rounded-control border border-line p-3 md:mt-1 md:block">
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
  const iphone = useIphoneLook();
  if (iphone)
    return (
      <IosSection header="You're in Personal" footer="Personal is just yours: it has no members or workspace settings. Switch to a workspace from your account (the avatar on Home), or create one for your team.">
        <IosRow label="Create a workspace" onClick={() => setOpen(true)} />
        <NewWorkspaceDialog open={open} onClose={() => setOpen(false)} onCreated={() => navigate("/settings/workspace")} />
      </IosSection>
    );
  return (
    <Card title="You're in Personal" description="Personal is just yours: it has no members or workspace settings. Switch to a workspace from the menu at the bottom of the sidebar, or create one for your team.">
      <Button variant="primary" onClick={() => setOpen(true)}>
        <Plus size={14} aria-hidden /> Create a workspace
      </Button>
      <NewWorkspaceDialog open={open} onClose={() => setOpen(false)} onCreated={() => navigate("/settings/workspace")} />
    </Card>
  );
}
