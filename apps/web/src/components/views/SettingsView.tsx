"use client";

import { isServerEdition } from "@/lib/edition";
import { useEffect, useRef, useState, type ComponentType } from "react";
import { SETTINGS_INDEX, searchSettings } from "@/lib/app/settingsSearch";
import { useAiEnabled } from "@/components/ai/useAi";
import { useAiAction } from "@/components/ai/useAiAction";
import { AiProblemNotice, aiProblem, type AiProblem } from "@/components/ai/AiCredits";
import { api } from "@/lib/convex/api";
import { AppWindowMac, Info, ArrowDownUp, Bell, Building2, CreditCard, HelpCircle, LifeBuoy, LockKeyhole, Search, X, MonitorSmartphone, Palette, Plug, Plus, RefreshCw, LibraryBig, Shield, ShieldCheck, Smartphone, SpellCheck2, UserRound, UserRoundPlus, Users } from "lucide-react";
import { AiIcon } from "@/components/ai/AiIcon";
import { AppLink, useAppRouter } from "@/lib/app/router";
import { useAppState } from "@/lib/app/state";
import { ViewChrome } from "@/components/app/Shell";
import { NewWorkspaceDialog } from "@/components/app/NewWorkspaceDialog";
import { openAdminConsole } from "@/components/app/WorkspaceMenu";
import { SupportDialog } from "@/components/support/SupportDialog";
import { Button } from "@/components/ui/Button";
import { AccountSection } from "./settings/AccountSection";
import { AiSection } from "./settings/AiSection";
import { LocalAiSection } from "./settings/LocalAiSection";
import { SecuritySection } from "./settings/SecuritySection";
import { DevicesSection } from "./settings/DevicesSection";
import { AppearanceSection } from "./settings/AppearanceSection";
import { WritingSection } from "./settings/WritingSection";
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
import { AboutSection } from "./settings/AboutSection";
import { useCapabilities, type Capability } from "@/lib/mode";
import { desktop } from "@/lib/desktop";
import { nativeApp } from "@/lib/nativeApp";
import { IphoneLookContext, useIpadLayout, useIphoneApp, useIphoneLook } from "@/lib/iphone";
import { ChevronLeft } from "lucide-react";
import { PillButton } from "@/components/iphone/Glass";
import { RowIcon } from "@/components/iphone/Grouped";
import { inMacApp } from "@/lib/desktop/mac";
import { IosRow, IosSection, IosText, SettingsScreensHost, useSettingsScreens } from "@/components/iphone/SettingsKit";

type Section = "account" | "ai" | "billing" | "security" | "privacy" | "devices" | "connected-apps" | "appearance" | "writing" | "notifications" | "workspace" | "members" | "workspace-guests" | "workspace-billing" | "workspace-data" | "workspace-privacy" | "sync" | "library" | "data" | "desktop" | "this-device" | "about";
// (A section's icon: a Lucide icon, or Foli AI's flower, which keeps its colours.)
type Item = { id: Section; label: string; icon: ComponentType<{ size?: number; className?: string; "aria-hidden"?: boolean }> };
/** Things about you (your account and your Personal), the same whichever context is open. */
const YOU: Item[] = [
  { id: "account", label: "Account", icon: UserRound },
  { id: "ai", label: "Foli AI", icon: AiIcon },
  { id: "billing", label: "Plan & billing", icon: CreditCard },
  { id: "security", label: "Security", icon: ShieldCheck },
  // End-to-end encryption (docs/E2EE_DESIGN.md §10.1).
  { id: "privacy", label: "Privacy", icon: LockKeyhole },
  { id: "devices", label: "Devices", icon: MonitorSmartphone },
  { id: "connected-apps", label: "Connected apps", icon: Plug },
  { id: "appearance", label: "Appearance", icon: Palette },
  // Spell check, next-word prediction and the personal dictionary (WritingSection.tsx).
  { id: "writing", label: "Writing", icon: SpellCheck2 },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "sync", label: "Offline & sync", icon: RefreshCw },
  // Local mode's library: where it is, devices, health, passphrase, the lock (WP10). Only in local mode.
  { id: "library", label: "Library", icon: LibraryBig },
  { id: "data", label: "Import & export", icon: ArrowDownUp },
  { id: "desktop", label: "Desktop app", icon: AppWindowMac },
  { id: "this-device", label: "This device", icon: Smartphone },
];
/** How "You" is grouped in the list (in this order); a section not named here goes under App. */
const YOU_GROUPS: { label: string; ids: Section[] }[] = [
  { label: "Account", ids: ["library", "account", "billing", "devices"] },
  { label: "Security", ids: ["security", "privacy"] },
  { label: "App", ids: ["appearance", "writing", "notifications", "ai"] },
  { label: "Data", ids: ["sync", "data", "connected-apps", "desktop", "this-device"] },
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
/** About (the version and the policies): in the Support group, at the end of the list. */
const ABOUT: Item = { id: "about", label: "About", icon: Info };
/**
 * Sections only an account has (docs/LOCAL_MODE_PLAN.md §5.2): in local mode they're not listed, and opened by
 * address they show the "Sign in to Folevi" note. Settings > Foli AI stays: in local mode it sets up Foli AI on the
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
  // Folevi Server: no plans to buy, and Foli AI's settings only once the owner set it up (lib/mode.ts).
  const serverHides = (id: Section) => isServerEdition() && ((id === "ai" && !caps.foliAi) || ((id === "billing" || id === "workspace-billing") && !caps.billing));
  const here = (id: Section) => (!NEEDS[id] || caps[NEEDS[id]!]) && !serverHides(id);
  // A section this backend doesn't have (plain /settings opens on Account; an old link) shows the first one
  // it has, and the address follows.
  // (Account mode only gets here on a server, for a section it leaves out: Account is there.)
  const first: Section = caps.account ? "account" : LOCAL_FIRST;
  const section = here(asked) ? asked : first;
  const bare = pathname.replace(/\/+$/, "") === "/settings";
  useEffect(() => {
    if (!here(asked) && !bare) navigate(`/settings/${first}`, { replace: true });
  }, [asked, bare]); // eslint-disable-line react-hooks/exhaustive-deps
  const iphone = useIphoneApp();
  const ipad = useIpadLayout();
  const [query, setQuery] = useState("");
  // A search result opens its section at the setting: ?find=<card title> scrolls to that card.
  const find = search.get("find");
  useEffect(() => {
    if (!find) return;
    const t = window.setTimeout(() => {
      const h = [...document.querySelectorAll("#main h3")].find((el) => el.textContent?.trim() === find);
      const card = h?.closest("section");
      if (!card) return;
      card.scrollIntoView({ block: "start", behavior: "smooth" });
      card.setAttribute("data-found", "");
      window.setTimeout(() => card.removeAttribute("data-found"), 1600);
    }, 120);
    return () => window.clearTimeout(t);
  }, [find, section]);
  const allowed = (who: (typeof WORKSPACE)[number]["who"]) => who === "everyone" || (who === "managers" ? workspace?.canManage === true : workspace?.canManageBilling === true);
  const workspaceItems = WORKSPACE.filter((i) => allowed(i.who) && !serverHides(i.id));
  // Desktop app: only in the Mac app; This device: only in the iPhone and iPad app (or opened by its address).
  const you = YOU.filter((i) => here(i.id) && (i.id !== "library" || !caps.account) && (i.id !== "desktop" || desktop() !== null || section === "desktop") && (i.id !== "this-device" || nativeApp() !== null || section === "this-device"))
    // In local mode the library comes first: it's where Settings opens (LOCAL_FIRST).
    .sort((a, b) => Number(b.id === "library") - Number(a.id === "library"));
  // "You" in smaller groups (the owner, 28 November 2026: "divide you into more categories").
  const groupOf = (id: Section) => YOU_GROUPS.find((g) => g.ids.includes(id))?.label ?? "App";
  const youGroups = YOU_GROUPS.map((g) => ({ label: g.label, items: you.filter((i) => groupOf(i.id) === g.label) })).filter((g) => g.items.length);
  const groups = [...youGroups, ...(workspace ? [{ label: workspace.name, items: workspaceItems }] : [])];
  const item = [...YOU, ...WORKSPACE, ABOUT].find((s) => s.id === section);
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
          <SupportGroup look="ios" current={section} />
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
      <ViewChrome title={<h1 className="text-subheadline font-semibold">Settings</h1>} tabTitle="Settings">
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
              <SupportGroup look="ios" current={section} />
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
    <ViewChrome title={<h1 className="text-subheadline font-semibold">Settings</h1>} tabTitle="Settings">
      {/* Two columns (sections, then the page) only where the view itself is wide enough (a container query, not the
          window: beside the app sidebar at tablet widths the sections become a row above the page). */}
      <div className="@container">
      <div data-mac-settings-window={settingsWindow ? "" : undefined} className="mx-auto grid max-w-5xl grid-cols-[minmax(0,1fr)] gap-8 px-4 pb-[max(6rem,var(--fab-clearance))] pt-6 sm:px-8 @3xl:grid-cols-[216px_minmax(0,1fr)] @3xl:gap-10">
        <nav aria-label="Settings sections" hidden={settingsWindow} className="@3xl:sticky @3xl:top-6 @3xl:self-start">
          <p aria-hidden className="ui-display mb-4 px-1 text-title-1 leading-tight">Settings</p>
          <SettingsSearch items={[...groups.flatMap((g) => g.items), ABOUT]} query={query} setQuery={setQuery} />
          <div hidden={query.trim() !== ""} className="flex gap-6 overflow-x-auto pb-1 @3xl:flex-col @3xl:gap-5 @3xl:overflow-visible @3xl:pb-0">
            {groups.map((g) => (
              <div key={g.label} className="flex-none">
                <p className="mb-1.5 truncate px-2.5 text-caption-2 font-semibold uppercase tracking-[0.07em] text-faint">{g.label}</p>
                <ul className="flex gap-0.5 @3xl:flex-col">
                  {g.items.map((s) => {
                    const active = section === s.id;
                    const Icon = s.icon;
                    return (
                      <li key={s.id}>
                        <AppLink
                          href={`/settings/${s.id}`}
                          aria-current={active ? "page" : undefined}
                          className={`group flex h-8 items-center gap-2.5 whitespace-nowrap rounded-chip px-2.5 text-body outline-none transition-[background-color,box-shadow,color] duration-150 focus-visible:ring-2 focus-visible:ring-focus pointer-coarse:h-11 ${
                            active ? "bg-[var(--glass-active)] font-semibold text-heading shadow-[var(--glass-edge),var(--shadow-raised)]" : "text-ink/90 hover:bg-[var(--glass-hover)] hover:text-heading"
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
            <SupportGroup look="web" current={section} />
          </div>
        </nav>
        <div className="min-w-0 space-y-5">
          <h2 className="sr-only">{noWorkspace ? "Workspace" : sectionHidden ? "Not found" : heading}</h2>
          {section === "account" ? <AccountSection /> : null}
          {section === "ai" ? caps.account ? <AiSection /> : <LocalAiSection /> : null}
          {section === "billing" ? <BillingSection /> : null}
          {section === "security" ? <SecuritySection /> : null}
          {section === "privacy" ? <PrivacySection /> : null}
          {section === "devices" ? <DevicesSection /> : null}
          {section === "connected-apps" ? <ConnectedAppsSection /> : null}
          {section === "appearance" ? <AppearanceSection /> : null}
          {section === "writing" ? <WritingSection /> : null}
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
          {section === "about" ? <AboutSection /> : null}
        </div>
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
      <PillButton label="Back" data-back="" onClick={() => screens?.back()}>
        <ChevronLeft size={24} strokeWidth={2.2} aria-hidden />
      </PillButton>
      <h2 className="ui-large-title min-w-0 flex-1 truncate !text-title-1">{title}</h2>
      <span ref={actions} className="contents" />
    </div>
  );
}

/** A section's grouped lists (the iPhone's screen, and the iPad's column beside the list of sections). */
function SectionBody({ section, noWorkspace, sectionHidden }: { section: Section; noWorkspace: boolean; sectionHidden: boolean }) {
  const { workspace } = useAppState();
  const caps = useCapabilities();
  return (
    <div className="space-y-7 pb-4 pt-3 [&_.ui-btn]:min-h-11 [&_.ui-btn]:text-subheadline">
      {section === "account" ? <AccountSection /> : null}
      {section === "ai" ? caps.account ? <AiSection /> : <LocalAiSection /> : null}
      {section === "billing" ? <BillingSection /> : null}
      {section === "security" ? <SecuritySection /> : null}
      {section === "privacy" ? <PrivacySection /> : null}
      {section === "devices" ? <DevicesSection /> : null}
      {section === "connected-apps" ? <ConnectedAppsSection /> : null}
      {section === "appearance" ? <AppearanceSection /> : null}
          {section === "writing" ? <WritingSection /> : null}
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
      {section === "about" ? <AboutSection /> : null}
    </div>
  );
}

/**
 * Help, Contact support and (for Folevi's own admins) the Admin console, at the end of the list of sections: the
 * account menu keeps only Help, so these live here.
 */
function SupportGroup({ look, current }: { look: "web" | "ios"; current?: Section }) {
  const { profile } = useAppState();
  const caps = useCapabilities();
  const [contacting, setContacting] = useState(false);
  // Without an account (the library) there's no support form: an email instead.
  const contact = () => (caps.account ? setContacting(true) : void window.open("mailto:support@folevi.com", "_blank", "noopener"));
  const admin = Boolean((profile as { platformRole?: unknown }).platformRole);
  const dialog = <SupportDialog open={contacting} onClose={() => setContacting(false)} />;
  if (look === "ios")
    return (
      <IosSection header="Support">
        <IosRow icon={<RowIcon><HelpCircle /></RowIcon>} label="Help" href="/help" />
        <IosRow icon={<RowIcon><LifeBuoy /></RowIcon>} label="Contact support" onClick={contact} />
        <IosRow icon={<RowIcon><Info /></RowIcon>} label="About" href="/settings/about" current={current === "about"} />
        {admin ? <IosRow icon={<RowIcon><Shield /></RowIcon>} label="Admin console" onClick={openAdminConsole} /> : null}
        {dialog}
      </IosSection>
    );
  const row = "group flex h-8 w-full items-center gap-2.5 whitespace-nowrap rounded-chip px-2.5 text-left text-body text-ink/90 outline-none transition-[background-color,color] duration-150 hover:bg-[var(--glass-hover)] hover:text-heading focus-visible:ring-2 focus-visible:ring-focus pointer-coarse:h-11";
  const icon = "flex-none text-muted transition-colors group-hover:text-heading";
  return (
    <div className="flex-none">
      <p className="mb-1.5 truncate px-2.5 text-caption-2 font-semibold uppercase tracking-[0.07em] text-faint">Support</p>
      <ul className="flex gap-0.5 @3xl:flex-col">
        <li>
          <AppLink href="/help" className={row}>
            <HelpCircle size={16} aria-hidden className={icon} />
            Help
          </AppLink>
        </li>
        <li>
          <button type="button" onClick={contact} className={row}>
            <LifeBuoy size={16} aria-hidden className={icon} />
            Contact support…
          </button>
        </li>
        <li>
          <AppLink href="/settings/about" className={row} aria-current={current === "about" ? "page" : undefined}>
            <Info size={16} aria-hidden className={icon} />
            About
          </AppLink>
        </li>
        {admin ? (
          <li>
            <button type="button" onClick={openAdminConsole} className={row}>
              <Shield size={16} aria-hidden className={icon} />
              Admin console
            </button>
          </li>
        ) : null}
      </ul>
      {dialog}
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
  // A plain row under its own Workspace heading, like the sections (the owner, 28 November 2026).
  return (
    <div className="hidden flex-none @3xl:block">
      <p className="mb-1.5 truncate px-2.5 text-caption-2 font-semibold uppercase tracking-[0.07em] text-faint">Workspace</p>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Work with a team: shared notes, folders and tasks, with its own plan and members"
        className="group flex h-8 w-full items-center gap-2.5 whitespace-nowrap rounded-chip px-2.5 text-left text-body text-ink/90 outline-none transition-colors hover:bg-[var(--glass-hover)] hover:text-heading focus-visible:ring-2 focus-visible:ring-focus pointer-coarse:h-11"
      >
        <Plus size={16} aria-hidden className="flex-none text-muted group-hover:text-heading" />
        Create a workspace
      </button>
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

/**
 * Settings search: one field above the sections. Typing swaps the section list for the matching settings
 * (lib/app/settingsSearch.ts); a result opens its section at that setting. Arrow keys move, Return opens,
 * Escape clears. While Foli AI is on, "Ask Foli AI" under the matches sends the words and the settings this person
 * has to Foli AI (ai.settingsSearch), which picks the ones that do it and says what to change; it's the first row
 * when nothing matches, so Return asks.
 */
function SettingsSearch({ items, query, setQuery }: { items: Item[]; query: string; setQuery: (q: string) => void }) {
  const { navigate } = useAppRouter();
  const { scope } = useAppState();
  // "Ask Foli AI" asks Folevi's server: not in a local library (lib/local/registry.ts, LOCAL_HIDDEN).
  const aiOn = useAiEnabled() && useCapabilities().aiServer;
  const askAi = useAiAction(api.ai.settingsSearch);
  const [at, setAt] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const byId = new Map(items.map((i) => [i.id as string, i]));
  const hits = searchSettings(query, (id) => byId.get(id as Section)?.label).slice(0, 12);
  const typing = query.trim() !== "";
  type Hit = (typeof hits)[number];
  const [ai, setAi] = useState<{ query: string; busy: boolean; answer: string; picks: Hit[]; error: AiProblem | null } | null>(null);
  const aiFor = ai && ai.query === query.trim() ? ai : null;
  const canAsk = aiOn && query.trim().length >= 2;
  // The rows Return and the arrows move through: Ask Foli AI first when nothing matches, else last.
  const askAt = canAsk && !aiFor ? (hits.length ? hits.length : 0) : -1;
  const count = hits.length + (askAt >= 0 ? 1 : 0);
  const open = (h: Hit) => {
    setQuery("");
    setAi(null);
    navigate(`/settings/${h.section}?find=${encodeURIComponent(h.title)}`);
  };
  const ask = async () => {
    const q = query.trim();
    if (!q || aiFor?.busy) return;
    setAi({ query: q, busy: true, answer: "", picks: [], error: null });
    const offered = SETTINGS_INDEX.filter((h) => byId.has(h.section));
    try {
      const r = await askAi({ scope, query: q, options: offered.map((h) => ({ key: `${h.section}/${h.title}`, title: h.title, section: byId.get(h.section as Section)!.label })) });
      const picks = r.keys.map((k) => offered.find((h) => `${h.section}/${h.title}` === k)).filter((h): h is Hit => !!h);
      setAi({ query: q, busy: false, answer: r.answer, picks, error: null });
    } catch (e) {
      setAi({ query: q, busy: false, answer: "", picks: [], error: aiProblem(e) });
    }
  };
  const row = (h: Hit, i: number, active: boolean) => {
    const it = byId.get(h.section);
    const Icon = it?.icon ?? Search;
    return (
      <li key={h.section + h.title}>
        <button
          type="button"
          onClick={() => open(h)}
          onMouseEnter={() => i >= 0 && setAt(i)}
          className={`flex w-full items-center gap-2.5 rounded-chip px-2.5 py-1.5 text-left outline-none pointer-coarse:py-2.5 hover:bg-[var(--glass-hover)] ${active ? "bg-[var(--glass-hover)] text-heading" : "text-ink/90"}`}
        >
          <Icon size={16} aria-hidden className="flex-none text-muted" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-body">{h.title}</span>
            <span className="block truncate text-footnote text-muted">{it?.label}</span>
          </span>
        </button>
      </li>
    );
  };
  return (
    <div className="mb-5 @3xl:mb-4">
      <label className="flex h-8 items-center gap-2 rounded-chip bg-[var(--glass-hover)] px-2.5 text-callout text-muted focus-within:ring-2 focus-within:ring-focus pointer-coarse:h-11">
        <Search size={15} aria-hidden className="flex-none" />
        <input
          ref={input}
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setAt(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") setAt((a) => Math.min(a + 1, count - 1));
            else if (e.key === "ArrowUp") setAt((a) => Math.max(a - 1, 0));
            else if (e.key === "Enter" && at === askAt) void ask();
            else if (e.key === "Enter" && hits[at]) open(hits[at]);
            else if (e.key === "Escape") setQuery("");
            else return;
            e.preventDefault();
          }}
          placeholder={aiOn ? "Search or describe a setting" : "Search settings"}
          aria-label="Search settings"
          aria-controls="settings-search-results"
          className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-muted [&::-webkit-search-cancel-button]:hidden"
        />
        {typing ? (
          <button type="button" aria-label="Clear search" title="Clear search" onClick={() => { setQuery(""); input.current?.focus(); }} className="flex-none text-muted hover:text-heading">
            <X size={14} aria-hidden />
          </button>
        ) : null}
      </label>
      {typing ? (
        <div id="settings-search-results" className="mt-2 flex flex-col gap-2">
          {aiFor ? (
            <section aria-label="Foli AI’s answer" aria-live="polite" className="rounded-control border border-[var(--color-line)] bg-surface p-2">
              <div className="flex items-start gap-2 px-1 pb-1 text-footnote text-ink">
                <AiIcon size={14} aria-hidden className="mt-0.5 flex-none" />
                {aiFor.error ? (
                  <AiProblemNotice problem={aiFor.error} className="text-footnote text-muted" />
                ) : (
                  <span>{aiFor.busy ? "Looking through your settings…" : aiFor.answer || "Foli AI couldn’t find a setting for that."}</span>
                )}
              </div>
              {aiFor.picks.length ? <ul className="flex flex-col gap-0.5">{aiFor.picks.map((h) => row(h, -1, false))}</ul> : null}
            </section>
          ) : null}
          {hits.length || askAt >= 0 ? (
            <ul className="flex flex-col gap-0.5" aria-label="Matching settings">
              {askAt === 0 ? <AskRow query={query.trim()} active={at === 0} onAsk={() => void ask()} onHover={() => setAt(0)} /> : null}
              {hits.map((h, i) => row(h, askAt === 0 ? i + 1 : i, (askAt === 0 ? i + 1 : i) === at))}
              {askAt > 0 ? <AskRow query={query.trim()} active={at === askAt} onAsk={() => void ask()} onHover={() => setAt(askAt)} /> : null}
            </ul>
          ) : !aiFor ? (
            <p className="px-2.5 py-1.5 text-footnote text-muted">No settings match. Try another word.</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** "Ask Foli AI" in the search results: sends what was typed to Foli AI. */
function AskRow({ query, active, onAsk, onHover }: { query: string; active: boolean; onAsk: () => void; onHover: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onAsk}
        onMouseEnter={onHover}
        className={`flex w-full items-center gap-2.5 rounded-chip px-2.5 py-1.5 text-left outline-none pointer-coarse:py-2.5 hover:bg-[var(--glass-hover)] ${active ? "bg-[var(--glass-hover)] text-heading" : "text-ink/90"}`}
      >
        <AiIcon size={16} aria-hidden className="flex-none" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-body">Ask Foli AI</span>
          <span className="block truncate text-footnote text-muted">“{query}”</span>
        </span>
      </button>
    </li>
  );
}
