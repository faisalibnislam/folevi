"use client";

import { useState } from "react";
import { AiIcon } from "@/components/ai/AiIcon";
import { ChevronsUpDown, CreditCard, HelpCircle, LogOut, Monitor, Moon, Sun, Plus, Settings, Shield, ShieldCheck, UserPlus, Users, MonitorSmartphone } from "lucide-react";
import type { WireScope } from "@folevi/editor-schema";
import { PLANS } from "@/lib/plans";
import { useAppState, type Profile, type Workspace } from "@/lib/app/state";
import { useAppRouter } from "@/lib/app/router";
import { MenuButton, type MenuEntry } from "@/components/ui/Menu";
import { useSafeSignOut } from "@/components/auth/SignOut";
import { InviteDialog } from "./InviteDialog";
import { NewWorkspaceDialog, workspaceRoleLabel } from "./NewWorkspaceDialog";

/** A team workspace's mark: its square logo, or its initial on a neutral tile. */
export function WorkspaceLogo({ workspace, size = 24, className = "" }: { workspace: Pick<Workspace, "name" | "logoUrl">; size?: number; className?: string }) {
  return <Mark src={workspace.logoUrl ?? null} initial={workspace.name} shape="rounded-[6px]" size={size} className={className} />;
}

/** Personal's mark: your profile picture (or your initial), drawn round. Personal is you, not a workspace. */
export function PersonalMark({ size = 24, className = "" }: { size?: number; className?: string }) {
  const { profile } = useAppState();
  return <Mark src={profile.avatarUrl ?? null} initial={profile.displayName} shape="rounded-full" size={size} className={className} />;
}

function Mark({ src, initial, shape, size, className }: { src: string | null; initial: string; shape: string; size: number; className: string }) {
  const letter = initial.trim().slice(0, 1).toUpperCase() || "·";
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element -- a tiny signed storage URL, not an optimisable asset
    <img src={src} alt="" width={size} height={size} className={`flex-none object-cover ${shape} ${className}`} style={{ width: size, height: size }} />
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

/** Your Personal plan as the switcher shows it: "Pro", "Pro trial · 5 days", "Free". */
export function personalPlanLabel(profile: Profile, now = Date.now()): string | null {
  const ent = (profile as { entitlements?: { trialing: boolean; trialEndsAt: number | null; plan: keyof typeof PLANS } }).entitlements;
  if (!ent) return null;
  if (ent.trialing) {
    const days = ent.trialEndsAt ? Math.max(1, Math.ceil((ent.trialEndsAt - now) / 86_400_000)) : 0;
    return days ? `Pro trial · ${days} ${days === 1 ? "day" : "days"}` : "Pro trial";
  }
  return PLANS[ent.plan]?.name ?? null;
}

/**
 * The bottom of the sidebar: where you are (Personal or a team workspace) and you. One menu holds
 * everything — Personal first, then your workspaces with your role in each, "New workspace…", the
 * current workspace's people and settings, your account, help, appearance and sign out.
 */
export function WorkspaceMenu({ onNavigate }: { onNavigate?: () => void }) {
  const { context, workspace, workspaces, setContext, profile, appearance, setAppearance } = useAppState();
  const { navigate, route } = useAppRouter();
  const safeSignOut = useSafeSignOut(profile.id);
  const [creating, setCreating] = useState(false);
  const [inviting, setInviting] = useState(false);
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

  const items: MenuEntry[] = [
    {
      label: "Personal",
      description: plan ? `${profile.displayName} · ${plan}` : profile.displayName,
      icon: <PersonalMark size={18} />,
      checked: context.kind === "personal",
      onSelect: () => switchTo({ kind: "personal" }),
    },
    { heading: "Workspaces" },
    ...workspaces.map((w) => ({
      label: w.name,
      // "Owner · Team": your role here, and this workspace's own plan.
      description: `${workspaceRoleLabel(w.role)} · ${w.plan.shortName}`,
      icon: <WorkspaceLogo workspace={w} size={18} />,
      checked: context.kind === "workspace" && context.workspaceId === w.id,
      onSelect: () => switchTo({ kind: "workspace", workspaceId: w.id }),
    })),
    { label: "New workspace…", icon: <Plus size={14} />, onSelect: () => setCreating(true) },
    "separator",
    // People and settings of the current workspace. Personal has no members: pages are shared one by one.
    ...(workspace
      ? ([
          ...(canManage ? [{ label: "Invite people…", icon: <UserPlus size={14} />, onSelect: () => setInviting(true) }] : []),
          { label: "Members", icon: <Users size={14} />, onSelect: () => go("/settings/members") },
          { label: "Workspace settings", icon: <Settings size={14} />, onSelect: () => go("/settings/workspace") },
          "separator",
        ] satisfies MenuEntry[])
      : []),
    { label: "Account settings", icon: <Settings size={14} />, onSelect: () => go("/settings/account") },
    { label: "Plan & billing", icon: <CreditCard size={14} />, onSelect: () => go("/settings/billing") },
    { label: "Security", icon: <ShieldCheck size={14} />, onSelect: () => go("/settings/security") },
    { label: "Devices", icon: <MonitorSmartphone size={14} />, onSelect: () => go("/settings/devices") },
    { label: "Help", icon: <HelpCircle size={14} />, onSelect: () => go("/help") },
    ...(profile.platformRole ? [{ label: "Admin console", icon: <Shield size={14} />, onSelect: () => (window.location.href = "/admin") }] : []),
    "separator",
    { label: "Light", icon: <Sun size={14} />, checked: appearance === "light", onSelect: () => setAppearance("light") },
    { label: "Dark", icon: <Moon size={14} />, checked: appearance === "dark", onSelect: () => setAppearance("dark") },
    { label: "Match system", icon: <Monitor size={14} />, checked: appearance === "system", onSelect: () => setAppearance("system") },
    "separator",
    // Warns (and asks for an explicit choice) if anything on this device hasn't synced yet.
    { label: "Sign out", icon: <LogOut size={14} />, onSelect: () => void safeSignOut.request() },
  ];

  // Personal plan: trial days left, or an upgrade nudge on Free; nothing once they're paying. Only shown in
  // Personal — a Personal plan doesn't change what a team workspace includes.
  const ent = (profile as { entitlements?: { trialing: boolean; trialEndsAt: number | null; paid?: boolean } }).entitlements;
  const trialDays = ent?.trialing && ent.trialEndsAt ? Math.max(1, Math.ceil((ent.trialEndsAt - Date.now()) / 86_400_000)) : 0;
  const pill = !ent || context.kind !== "personal" ? null : ent.trialing ? `Pro trial · ${trialDays} ${trialDays === 1 ? "day" : "days"} left` : ent.paid === false ? "Upgrade to Pro" : null;
  const title = workspace ? workspace.name : profile.displayName;

  return (
    <>
      {pill ? (
        <button
          type="button"
          onClick={() => go("/settings/billing")}
          className="mb-1.5 flex h-8 w-full items-center gap-2 rounded-[8px] bg-[linear-gradient(100deg,color-mix(in_oklab,#8b7cf6_14%,transparent),color-mix(in_oklab,#f58ab8_12%,transparent))] px-2.5 text-left text-[12.5px] font-medium text-heading shadow-[inset_0_0_0_1px_var(--glass-border)] transition-[filter] hover:brightness-[1.03]"
        >
          <AiIcon size={13} aria-hidden className="text-[#7c6cf0]" />
          <span className="flex-1 truncate">{pill}</span>
          <span className="text-[11.5px] text-muted">{ent?.trialing ? "Choose plan" : "See plans"}</span>
        </button>
      ) : null}
      <MenuButton
        label={`${workspace ? workspace.name : "Personal"} — Personal, workspaces and account`}
        side="top"
        align="start"
        className="w-full"
        menuClassName="w-full min-w-64"
        triggerClassName="flex h-12 w-full items-center gap-2.5 rounded-[6px] px-2 text-left transition-colors hover:bg-[color-mix(in_oklab,var(--color-accent-soft)_75%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus aria-expanded:bg-[color-mix(in_oklab,var(--color-accent-soft)_75%,transparent)]"
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
      {safeSignOut.dialog}
    </>
  );
}
