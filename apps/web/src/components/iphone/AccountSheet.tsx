"use client";

import { useState } from "react";
import { HelpCircle, LifeBuoy, LogOut, Plus, Settings, Shield, UserPlus, Users } from "lucide-react";
import type { WireScope } from "@folevi/editor-schema";
import { useAppState } from "@/lib/app/state";
import { useAppRouter } from "@/lib/app/router";
import { useSafeSignOut } from "@/components/auth/SignOut";
import { SupportDialog } from "@/components/support/SupportDialog";
import { InviteDialog } from "@/components/app/InviteDialog";
import { NewWorkspaceDialog, workspaceRoleLabel } from "@/components/app/NewWorkspaceDialog";
import { PersonalMark, WorkspaceLogo, personalPlanLabel } from "@/components/app/WorkspaceMenu";
import { Sheet } from "./Sheet";
import { GroupedRow, GroupedSection, RowIcon } from "./Grouped";

/**
 * The avatar's sheet (top left of Home, Tasks and Calendar): where you are (Personal or a workspace, with a
 * check), the workspace's people and settings, Settings, Help, appearance and Sign out. The same things as
 * the sidebar's switcher menu on the web.
 */
export function AccountSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { context, workspace, workspaces, setContext, profile, appearance, setAppearance } = useAppState();
  const { navigate, route } = useAppRouter();
  const safeSignOut = useSafeSignOut(profile.id);
  const [creating, setCreating] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [contacting, setContacting] = useState(false);
  const canManage = workspace !== null && (workspace.role === "owner" || workspace.role === "admin");
  const plan = personalPlanLabel(profile);
  const go = (href: string) => {
    onClose();
    navigate(href);
  };
  const switchTo = (next: WireScope) => {
    const same = next.kind === context.kind && (next.kind === "personal" || (context.kind === "workspace" && context.workspaceId === next.workspaceId));
    setContext(next);
    onClose();
    if (!same && route.name !== "documents" && route.name !== "tasks" && route.name !== "calendar") navigate("/documents");
  };
  const email = (profile as { email?: string }).email;
  return (
    <>
      <Sheet open={open} onClose={onClose} title="Account" size="medium" bodyClassName="pb-6">
        <div className="flex items-center gap-3 px-5 pb-5 pt-2">
          <PersonalMark size={52} className="!rounded-capsule" />
          <div className="min-w-0">
            <p className="truncate text-[19px] font-semibold text-heading">{profile.displayName}</p>
            {email ? <p className="truncate text-[14px] text-muted">{email}</p> : null}
          </div>
        </div>
        <GroupedSection title="Places">
          <GroupedRow icon={<PersonalMark size={30} className="!rounded-capsule" />} label="Personal" description={plan ?? undefined} checked={context.kind === "personal"} onClick={() => switchTo({ kind: "personal" })} />
          {workspaces.map((w) => (
            <GroupedRow
              key={w.id}
              icon={<WorkspaceLogo workspace={w} size={30} />}
              label={w.name}
              description={`${workspaceRoleLabel(w.role)} · ${w.plan.shortName}`}
              checked={context.kind === "workspace" && context.workspaceId === w.id}
              onClick={() => switchTo({ kind: "workspace", workspaceId: w.id })}
            />
          ))}
          <GroupedRow icon={<RowIcon><Plus /></RowIcon>} label="New workspace" onClick={() => setCreating(true)} />
        </GroupedSection>
        {workspace ? (
          <GroupedSection title={workspace.name} className="mt-6">
            {canManage ? <GroupedRow icon={<RowIcon><UserPlus /></RowIcon>} label="Invite people" onClick={() => setInviting(true)} /> : null}
            <GroupedRow icon={<RowIcon><Users /></RowIcon>} label="Members" chevron onClick={() => go("/settings/members")} />
            <GroupedRow icon={<RowIcon><Settings /></RowIcon>} label="Workspace settings" chevron onClick={() => go("/settings/workspace")} />
          </GroupedSection>
        ) : null}
        <GroupedSection className="mt-6">
          <GroupedRow icon={<RowIcon><Settings /></RowIcon>} label="Settings" chevron onClick={() => go("/settings")} />
          <GroupedRow icon={<RowIcon><HelpCircle /></RowIcon>} label="Help" chevron onClick={() => go("/help")} />
          <GroupedRow icon={<RowIcon><LifeBuoy /></RowIcon>} label="Contact support" onClick={() => setContacting(true)} />
          {profile.platformRole ? <GroupedRow icon={<RowIcon><Shield /></RowIcon>} label="Admin console" onClick={() => (window.location.href = "/admin")} /> : null}
        </GroupedSection>
        <GroupedSection title="Appearance" className="mt-6">
          <div role="radiogroup" aria-label="Appearance" className="ui-seg m-2 bg-[color-mix(in_oklab,var(--color-ink)_7%,transparent)] [&>*]:min-h-9 [&>*]:text-[15px]">
            {(
              [
                ["light", "Light"],
                ["dark", "Dark"],
                ["system", "Automatic"],
              ] as const
            ).map(([value, label]) => (
              <button key={value} type="button" role="radio" aria-checked={appearance === value} data-active={appearance === value} onClick={() => setAppearance(value)}>
                {label}
              </button>
            ))}
          </div>
        </GroupedSection>
        <GroupedSection className="mt-6">
          <GroupedRow icon={<RowIcon tone="color-mix(in oklab, var(--color-destructive) 14%, transparent)"><LogOut className="text-danger" /></RowIcon>} label="Sign out" danger onClick={() => void safeSignOut.request()} />
        </GroupedSection>
      </Sheet>
      <NewWorkspaceDialog open={creating} onClose={() => setCreating(false)} onCreated={() => go("/documents")} />
      {inviting && workspace ? <InviteDialog workspace={workspace} open onClose={() => setInviting(false)} /> : null}
      <SupportDialog open={contacting} onClose={() => setContacting(false)} />
      {safeSignOut.dialog}
    </>
  );
}
