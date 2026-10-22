"use client";

import { useState } from "react";
import { AiIcon } from "@/components/ai/AiIcon";
import { ArrowRightLeft, ChevronsUpDown, CreditCard, HelpCircle, Laptop, LifeBuoy, LogIn, LogOut, Monitor, Moon, Smartphone, Sun, Plus, Settings, Shield, ShieldCheck, Tablet, UserPlus, Users, MonitorSmartphone } from "lucide-react";
import type { WireScope } from "@folevi/editor-schema";
import { PLANS, TIER_NAMES, TRIAL_TIER } from "@/lib/plans";
import { useAppState, type Profile, type Workspace } from "@/lib/app/state";
import { useAppRouter } from "@/lib/app/router";
import { MenuButton, type MenuEntry } from "@/components/ui/Menu";
import { useSafeSignOut } from "@/components/auth/SignOut";
import { SupportDialog } from "@/components/support/SupportDialog";
import { InviteDialog } from "./InviteDialog";
import { NewWorkspaceDialog, workspaceRoleLabel } from "./NewWorkspaceDialog";
import { canPurchaseHere } from "@/lib/nativeApp";
import { isShell } from "@/lib/shell";
import { APP_URL } from "@/lib/env";
import { currentBackendMode, useCapabilities } from "@/lib/mode";
import { SignInToCollaborate } from "./SignInToCollaborate";
import { flushBeforeSwitch, placesAvailable, signInToAnotherAccount, switchToPlace, usePlaces, type Place } from "@/lib/places";
import { MAX_BROWSER_ACCOUNTS } from "@/lib/places/web";
import { errorMessage, useToast } from "@/components/ui/Toast";
import { deviceWords } from "@/lib/shell/words";
import { openMovePlaces } from "@/components/places/MovePlaces";

// The console is part of the website; the bundled app shell has no /admin, so it opens there in the browser.
const openAdminConsole = () => (isShell() ? void window.open(`${APP_URL}/admin`, "_blank", "noopener") : void (window.location.href = "/admin"));

/** A team workspace's mark: its square logo, or its initial on a neutral tile. */
export function WorkspaceLogo({ workspace, size = 24, className = "" }: { workspace: Pick<Workspace, "name" | "logoUrl">; size?: number; className?: string }) {
  return <Mark src={workspace.logoUrl ?? null} initial={workspace.name} shape="rounded-chip" size={size} className={className} />;
}

/** Personal's mark: your profile picture (or your initial), drawn round. Personal is you, not a workspace. */
export function PersonalMark({ size = 24, className = "" }: { size?: number; className?: string }) {
  const { profile } = useAppState();
  return <Mark src={profile.avatarUrl ?? null} initial={profile.displayName} shape="rounded-chip" size={size} className={className} />;
}

function Mark({ src, initial, shape, size, className }: { src: string | null; initial: string; shape: string; size: number; className: string }) {
  const letter = initial.trim().slice(0, 1).toUpperCase() || "·";
  // A picture whose link ran out (another account's, remembered from when it was open) shows the initial.
  const [broken, setBroken] = useState<string | null>(null);
  return src && broken !== src ? (
    // eslint-disable-next-line @next/next/no-img-element -- a tiny signed storage URL, not an optimisable asset
    <img src={src} alt="" width={size} height={size} onError={() => setBroken(src)} className={`flex-none object-cover ${shape} ${className}`} style={{ width: size, height: size }} />
  ) : (
    <span
      aria-hidden
      className={`grid flex-none place-items-center bg-heading font-semibold text-canvas ${shape} ${className}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.46) }}
    >
      {letter}
    </span>
  );
}

/** Your Personal plan as the switcher shows it: "Pro", "Pro AI trial · 5 days", "Free". */
export function personalPlanLabel(profile: Profile, now = Date.now()): string | null {
  // A local library has no plan (lib/local/functions/users.ts LOCAL_ENTITLEMENTS is only a shape).
  if (currentBackendMode() === "local") return null;
  const ent = (profile as { entitlements?: { trialing: boolean; trialEndsAt: number | null; plan: keyof typeof PLANS } }).entitlements;
  if (!ent) return null;
  if (ent.trialing) {
    const days = ent.trialEndsAt ? Math.max(1, Math.ceil((ent.trialEndsAt - now) / 86_400_000)) : 0;
    return days ? `${TIER_NAMES[TRIAL_TIER]} trial · ${days} ${days === 1 ? "day" : "days"}` : `${TIER_NAMES[TRIAL_TIER]} trial`;
  }
  return PLANS[ent.plan]?.name ?? null;
}

/** Another account's mark (its picture or initial), for the switcher. */
export function AccountMark({ name, avatarUrl, size = 26 }: { name: string; avatarUrl: string | null; size?: number }) {
  return <Mark src={avatarUrl} initial={name || "?"} shape="rounded-chip" size={size} className="" />;
}

/** The library's mark: the device it lives on. */
export function LibraryMark({ size = 16 }: { size?: number }) {
  const noun = deviceWords().noun;
  return noun === "Mac" ? <Laptop size={size} /> : noun === "iPad" || noun === "tablet" ? <Tablet size={size} /> : <Smartphone size={size} />;
}

/**
 * The places other than the open one, for the switcher (docs/MULTI_ACCOUNT_PLAN.md, Owner decisions): each account
 * with its picture, name and email and its workspaces under it, and the library ("On this Mac", where it syncs),
 * each with a dot for what's new there. Picking one opens it (this tab reloads into it).
 */
export function otherPlaceEntries(places: Place[], current: string | null, open: (place: Place, workspaceId?: string | null) => void): MenuEntry[] {
  const out: MenuEntry[] = [];
  const here = deviceWords().here;
  for (const p of places) {
    if (p.id === current) continue;
    if (p.kind === "library") {
      out.push({ label: `On ${here}`, description: p.syncs, icon: <LibraryMark size={16} />, dot: p.reminders > 0 || p.waiting > 0, onSelect: () => open(p) });
      continue;
    }
    out.push({ label: p.name || p.email || "Folevi account", description: p.email || undefined, icon: <AccountMark name={p.name || p.email} avatarUrl={p.avatarUrl} />, badge: p.unread, dot: p.reminders > 0, onSelect: () => open(p, null) });
    for (const w of p.workspaces) out.push({ label: w.name, indent: true, icon: <WorkspaceLogo workspace={w} size={20} />, onSelect: () => open(p, w.id) });
  }
  return out;
}

/** Opens another place, writing out what's waiting here first. */
function usePlaceSwitch() {
  const { engine, outbox } = useAppState();
  const toast = useToast();
  return (place: Place, workspaceId?: string | null) =>
    void switchToPlace(place, { workspaceId, flush: () => flushBeforeSwitch({ engine, outbox }) }).catch((e: unknown) => toast.show(errorMessage(e), { tone: "error" }));
}

/**
 * The bottom of the sidebar: where you are (Personal or a team workspace) and you. One menu holds
 * everything: Personal first, then your workspaces with your role in each, "New workspace…", the
 * current workspace's people and settings, your account, help, appearance and sign out.
 */
export function WorkspaceMenu({ onNavigate }: { onNavigate?: () => void }) {
  // Local mode has no workspaces, account or plan: the library's own menu instead (docs/LOCAL_MODE_PLAN.md §5.2).
  if (!useCapabilities().workspaces) return <LibraryMenu onNavigate={onNavigate} />;
  return <AccountMenu onNavigate={onNavigate} />;
}

/** Local mode's foot of the sidebar: you, Settings, help and appearance, under the one "Sign in" note. */
function LibraryMenu({ onNavigate }: { onNavigate?: () => void }) {
  const { profile, appearance, setAppearance } = useAppState();
  const { navigate } = useAppRouter();
  const { places, current } = usePlaces();
  const open = usePlaceSwitch();
  const several = placesAvailable();
  const go = (href: string) => {
    onNavigate?.();
    navigate(href);
  };
  const others = several ? otherPlaceEntries(places, current, open) : [];
  const items: MenuEntry[] = [
    ...(others.length ? ([...others, "separator"] satisfies MenuEntry[]) : []),
    { label: "Help", icon: <HelpCircle size={14} />, onSelect: () => go("/help") },
    { label: "Contact support…", icon: <LifeBuoy size={14} />, onSelect: () => void window.open("mailto:support@folevi.com", "_blank", "noopener") },
    "separator",
    { label: "Light", icon: <Sun size={14} />, checked: appearance === "light", onSelect: () => setAppearance("light") },
    { label: "Dark", icon: <Moon size={14} />, checked: appearance === "dark", onSelect: () => setAppearance("dark") },
    { label: "Match system", icon: <Monitor size={14} />, checked: appearance === "system", onSelect: () => setAppearance("system") },
    "separator",
    ...(several ? [{ label: "Sign in to another account", icon: <LogIn size={14} />, onSelect: () => void signInToAnotherAccount() }] : []),
    ...(others.length ? [{ label: "Move or copy notes…", icon: <ArrowRightLeft size={14} />, onSelect: () => openMovePlaces() }] : []),
    { label: "Settings", icon: <Settings size={14} />, onSelect: () => go("/settings") },
  ];
  return (
    <>
      <SignInToCollaborate className="mb-1.5" />
      <MenuButton
        label={`${profile.displayName}: settings and help`}
        side="top"
        align="start"
        className="w-full"
        menuClassName="w-full min-w-64"
        triggerClassName="flex h-12 w-full items-center gap-2.5 rounded-chip px-2 text-left transition-colors hover:bg-[color-mix(in_oklab,var(--color-accent-soft)_75%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus aria-expanded:bg-[color-mix(in_oklab,var(--color-accent-soft)_75%,transparent)]"
        items={items}
        trigger={
          <>
            <PersonalMark size={28} />
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate text-[13.5px] font-semibold text-heading">{profile.displayName}</span>
              <span className="block truncate text-[11.5px] text-muted">On your devices</span>
            </span>
            <ChevronsUpDown size={14} aria-hidden className="flex-none text-faint" />
          </>
        }
      />
    </>
  );
}

function AccountMenu({ onNavigate }: { onNavigate?: () => void }) {
  const { context, workspace, workspaces, setContext, profile, appearance, setAppearance } = useAppState();
  const { navigate, route } = useAppRouter();
  const safeSignOut = useSafeSignOut(profile.id);
  const { places, current } = usePlaces();
  const open = usePlaceSwitch();
  const several = placesAvailable();
  const others = several ? otherPlaceEntries(places, current, open) : [];
  const accounts = places.filter((p) => p.kind === "account").length;
  const full = !isShell() && accounts >= MAX_BROWSER_ACCOUNTS;
  const [creating, setCreating] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [contacting, setContacting] = useState(false);
  const canManage = workspace !== null && (workspace.role === "owner" || workspace.role === "admin");
  const go = (href: string) => {
    onNavigate?.();
    navigate(href);
  };
  const plan = personalPlanLabel(profile);
  // A page, folder or tag belongs to one context (and each context has its own tabs): switching away from
  // one goes to the new context's Home instead of leaving the old context's page open without a tab.
  const switchTo = (next: WireScope) => {
    const same = next.kind === context.kind && (next.kind === "personal" || (context.kind === "workspace" && context.workspaceId === next.workspaceId));
    setContext(next);
    if (!same && (route.name === "doc" || route.name === "folder" || route.name === "tag")) go("/documents");
  };

  const who = [profile.displayName, profile.email, plan].filter(Boolean).join(" · ");
  const items: MenuEntry[] = [
    {
      label: "Personal",
      // You (picture, name and email) and your Personal plan: the account this is, with its workspaces under it.
      description: who || profile.displayName,
      icon: <PersonalMark size={26} />,
      checked: context.kind === "personal",
      onSelect: () => switchTo({ kind: "personal" }),
    },
    ...(others.length ? [] : ([{ heading: "Workspaces" }] satisfies MenuEntry[])),
    ...workspaces.map((w) => ({
      label: w.name,
      // "Owner · Pro": your role here, and this workspace's own plan.
      description: `${workspaceRoleLabel(w.role)} · ${w.plan.shortName}`,
      icon: <WorkspaceLogo workspace={w} size={26} />,
      checked: context.kind === "workspace" && context.workspaceId === w.id,
      indent: others.length > 0,
      onSelect: () => switchTo({ kind: "workspace", workspaceId: w.id }),
    })),
    { label: "New workspace…", icon: <Plus size={14} />, indent: others.length > 0, onSelect: () => setCreating(true) },
    "separator",
    // The other places: accounts with their workspaces, and the library on this device.
    ...(others.length ? ([...others, "separator"] satisfies MenuEntry[]) : []),
    // People and settings of the current workspace. Personal has no members: pages are shared one by one.
    ...(workspace
      ? ([
          ...(canManage ? [{ label: "Invite people…", icon: <UserPlus size={14} />, onSelect: () => setInviting(true) }] : []),
          { label: "Members", icon: <Users size={14} />, onSelect: () => go("/settings/members") },
          { label: "Workspace settings", icon: <Settings size={14} />, onSelect: () => go("/settings/workspace") },
          "separator",
        ] satisfies MenuEntry[])
      : []),
    { label: "Plan & billing", icon: <CreditCard size={14} />, onSelect: () => go("/settings/billing") },
    { label: "Security", icon: <ShieldCheck size={14} />, onSelect: () => go("/settings/security") },
    { label: "Devices", icon: <MonitorSmartphone size={14} />, onSelect: () => go("/settings/devices") },
    { label: "Help", icon: <HelpCircle size={14} />, onSelect: () => go("/help") },
    { label: "Contact support…", icon: <LifeBuoy size={14} />, onSelect: () => setContacting(true) },
    ...(profile.platformRole ? [{ label: "Admin console", icon: <Shield size={14} />, onSelect: openAdminConsole }] : []),
    "separator",
    { label: "Light", icon: <Sun size={14} />, checked: appearance === "light", onSelect: () => setAppearance("light") },
    { label: "Dark", icon: <Moon size={14} />, checked: appearance === "dark", onSelect: () => setAppearance("dark") },
    { label: "Match system", icon: <Monitor size={14} />, checked: appearance === "system", onSelect: () => setAppearance("system") },
    "separator",
    ...(several
      ? [
          {
            label: "Sign in to another account",
            icon: <LogIn size={14} />,
            disabled: full,
            ...(full ? { description: `Up to ${MAX_BROWSER_ACCOUNTS} accounts in one browser` } : {}),
            onSelect: () => void signInToAnotherAccount(),
          },
        ]
      : []),
    ...(others.length ? [{ label: "Move or copy notes…", icon: <ArrowRightLeft size={14} />, onSelect: () => openMovePlaces() }] : []),
    { label: "Settings", icon: <Settings size={14} />, onSelect: () => go("/settings/account") },
    // Only this account: the others stay signed in. Warns (and asks for an explicit choice) if anything of it on
    // this device hasn't synced yet.
    { label: `Sign out of ${profile.displayName || "this account"}`, icon: <LogOut size={14} />, onSelect: () => void safeSignOut.request() },
  ];

  // Personal plan: trial days left, or an upgrade nudge on Free; nothing once they're paying. Only shown in
  // Personal, since a Personal plan doesn't change what a team workspace includes. In the iOS app only the
  // trial's days, and not as a way to plans (no buying there).
  const store = canPurchaseHere();
  const ent = (profile as { entitlements?: { trialing: boolean; trialEndsAt: number | null; paid?: boolean } }).entitlements;
  const trialDays = ent?.trialing && ent.trialEndsAt ? Math.max(1, Math.ceil((ent.trialEndsAt - Date.now()) / 86_400_000)) : 0;
  const pill = !ent || context.kind !== "personal" ? null : ent.trialing ? `${TIER_NAMES[TRIAL_TIER]} trial · ${trialDays} ${trialDays === 1 ? "day" : "days"} left` : ent.paid === false && store ? "Upgrade to Pro" : null;
  const title = workspace ? workspace.name : profile.displayName;

  return (
    <>
      {pill && !store ? (
        <p className="mb-1.5 flex h-8 w-full items-center gap-1.5 rounded-chip bg-[linear-gradient(100deg,color-mix(in_oklab,#8b7cf6_14%,transparent),color-mix(in_oklab,#f58ab8_12%,transparent))] px-2 text-xs font-medium text-heading shadow-[inset_0_0_0_1px_var(--glass-border)]">
          <AiIcon size={13} aria-hidden className="text-[#7c6cf0]" />
          <span className="flex-1 truncate">{pill}</span>
        </p>
      ) : pill ? (
        <button
          type="button"
          onClick={() => go("/settings/billing")}
          className="mb-1.5 flex h-8 w-full items-center gap-1.5 rounded-chip bg-[linear-gradient(100deg,color-mix(in_oklab,#8b7cf6_14%,transparent),color-mix(in_oklab,#f58ab8_12%,transparent))] px-2 text-left text-xs font-medium text-heading shadow-[inset_0_0_0_1px_var(--glass-border)] transition-[filter] hover:brightness-[1.03]"
        >
          <AiIcon size={13} aria-hidden className="text-[#7c6cf0]" />
          <span className="flex-1 truncate">{pill}</span>
          <span className="flex-none text-[11.5px] text-muted">{ent?.trialing ? "Choose plan" : "See plans"}</span>
        </button>
      ) : null}
      <MenuButton
        label={`${workspace ? workspace.name : "Personal"}: Personal, workspaces and account`}
        side="top"
        align="start"
        className="w-full"
        menuClassName="w-full min-w-64 pt-3"
        triggerClassName="flex h-12 w-full items-center gap-2.5 rounded-chip px-2 text-left transition-colors hover:bg-[color-mix(in_oklab,var(--color-accent-soft)_75%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus aria-expanded:bg-[color-mix(in_oklab,var(--color-accent-soft)_75%,transparent)]"
        items={items}
        trigger={
          <>
            {workspace ? <WorkspaceLogo workspace={workspace} size={28} /> : <PersonalMark size={28} />}
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate text-[13.5px] font-semibold text-heading">{title}</span>
              <span className="block truncate text-[11.5px] text-muted">{workspace ? profile.displayName : "Personal"}</span>
            </span>
            <ChevronsUpDown size={14} aria-hidden className="flex-none text-faint" />
          </>
        }
      />
      <NewWorkspaceDialog open={creating} onClose={() => setCreating(false)} onCreated={() => go("/documents")} />
      {inviting && workspace ? <InviteDialog workspace={workspace} open onClose={() => setInviting(false)} /> : null}
      <SupportDialog open={contacting} onClose={() => setContacting(false)} />
      {safeSignOut.dialog}
    </>
  );
}
