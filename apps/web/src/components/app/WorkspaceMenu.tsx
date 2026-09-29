"use client";

import { useMutation } from "convex/react";
import { useState } from "react";
import { AiIcon } from "@/components/ai/AiIcon";
import { ChevronsUpDown, CreditCard, HelpCircle, LogOut, Monitor, Moon, Sun, Plus, Settings, Shield, ShieldCheck, UserPlus, Users, MonitorSmartphone } from "lucide-react";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { useAppRouter } from "@/lib/app/router";
import { MenuButton, type MenuItem } from "@/components/ui/Menu";
import { PromptDialog } from "@/components/ui/PromptDialog";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { useSafeSignOut } from "@/components/auth/SignOut";
import { InviteDialog } from "./InviteDialog";

interface LogoWorkspace {
  name: string;
  kind: "personal" | "team";
  role?: string;
  ownerName?: string | null;
  logoUrl?: string | null;
}

/**
 * A workspace's mark: team workspaces use their square logo (or their initial on a neutral tile); the
 * personal workspace uses the person's profile picture (or their initial), drawn round.
 */
export function WorkspaceLogo({ workspace, size = 24, className = "" }: { workspace: LogoWorkspace; size?: number; className?: string }) {
  const { profile } = useAppState();
  const personal = workspace.kind === "personal";
  // A personal workspace's logoUrl is its owner's profile picture (set by the server).
  const src = workspace.logoUrl ?? null;
  const initial = (personal ? (workspace.ownerName ?? profile.displayName) : workspace.name).trim().slice(0, 1).toUpperCase() || "·";
  const shape = personal ? "rounded-full" : "rounded-[6px]";
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element -- a tiny signed storage URL, not an optimisable asset
    <img src={src} alt="" width={size} height={size} className={`flex-none object-cover ${shape} ${className}`} style={{ width: size, height: size }} />
  ) : (
    <span
      aria-hidden
      className={`grid flex-none place-items-center bg-heading font-semibold text-canvas ${shape} ${className}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.46) }}
    >
      {initial}
    </span>
  );
}

/**
 * The bottom of the sidebar: the current workspace (logo + name) and you. One menu holds everything —
 * switch workspace or make a new one, invite people, workspace and account settings, help, sign out —
 * grouped with dividers.
 */
export function WorkspaceMenu({ onNavigate }: { onNavigate?: () => void }) {
  const { workspace, workspaces, setWorkspace, profile, appearance, setAppearance } = useAppState();
  const { navigate } = useAppRouter();
  const safeSignOut = useSafeSignOut(profile.id);
  const createWorkspace = useMutation(api.workspaces.createTeamWorkspace);
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const [inviting, setInviting] = useState(false);
  const canManage = workspace.role === "owner" || workspace.role === "admin";
  const go = (href: string) => {
    onNavigate?.();
    navigate(href);
  };

  const items: (MenuItem | "separator")[] = [
    ...workspaces.map((w) => ({
      label: w.ownerName ? `${w.name} · ${w.ownerName}` : w.name,
      icon: <WorkspaceLogo workspace={w} size={18} />,
      checked: w.id === workspace.id,
      onSelect: () => setWorkspace(w.id),
    })),
    { label: "New team workspace…", icon: <Plus size={14} />, onSelect: () => setCreating(true) },
    "separator",
    ...(canManage ? [{ label: "Invite people…", icon: <UserPlus size={14} />, onSelect: () => setInviting(true) }] : []),
    { label: "Members", icon: <Users size={14} />, onSelect: () => go("/settings/members") },
    { label: "Workspace settings", icon: <Settings size={14} />, onSelect: () => go("/settings/workspace") },
    "separator",
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
  // your own Personal — a Personal plan doesn't change what a team workspace includes.
  const ent = (profile as { entitlements?: { trialing: boolean; trialEndsAt: number | null; paid?: boolean } }).entitlements;
  const inPersonal = (workspace as { plan?: { scope: string } | null }).plan?.scope === "personal";
  const trialDays = ent?.trialing && ent.trialEndsAt ? Math.max(1, Math.ceil((ent.trialEndsAt - Date.now()) / 86_400_000)) : 0;
  const pill = !ent || !inPersonal ? null : ent.trialing ? `Pro trial · ${trialDays} ${trialDays === 1 ? "day" : "days"} left` : ent.paid === false ? "Upgrade to Pro" : null;

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
        label={`${workspace.name} — workspace and account`}
        side="top"
        align="start"
        className="w-full"
        menuClassName="w-full min-w-64"
        triggerClassName="flex h-12 w-full items-center gap-2.5 rounded-[6px] px-2 text-left transition-colors hover:bg-[color-mix(in_oklab,var(--color-accent-soft)_75%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus aria-expanded:bg-[color-mix(in_oklab,var(--color-accent-soft)_75%,transparent)]"
        items={items}
        trigger={
          <>
            <WorkspaceLogo workspace={workspace} size={28} />
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate text-[13.5px] font-semibold text-heading">{workspace.name}</span>
              <span className="block truncate text-[11.5px] text-muted">{workspace.ownerName ? `Shared by ${workspace.ownerName}` : profile.displayName}</span>
            </span>
            <ChevronsUpDown size={14} aria-hidden className="flex-none text-faint" />
          </>
        }
      />
      <PromptDialog
        open={creating}
        title="New team workspace"
        label="Workspace name"
        confirmLabel="Create workspace"
        onClose={() => setCreating(false)}
        onSubmit={async (name) => {
          try {
            const r = await createWorkspace({ name });
            setWorkspace(r.id);
            go("/documents");
            toast.show(`Created ${name}`, { tone: "success" });
          } catch (e) {
            toast.show(errorMessage(e), { tone: "error" });
          }
        }}
      />
      {inviting ? <InviteDialog open onClose={() => setInviting(false)} /> : null}
      {safeSignOut.dialog}
    </>
  );
}
