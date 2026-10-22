"use client";

import { useState } from "react";
import { ArrowRightLeft, HelpCircle, LifeBuoy, LogIn, LogOut, Plus, Settings, Shield, UserPlus, Users } from "lucide-react";
import type { WireScope } from "@folevi/editor-schema";
import { useAppState } from "@/lib/app/state";
import { useAppRouter } from "@/lib/app/router";
import { useSafeSignOut } from "@/components/auth/SignOut";
import { SupportDialog } from "@/components/support/SupportDialog";
import { InviteDialog } from "@/components/app/InviteDialog";
import { NewWorkspaceDialog, workspaceRoleLabel } from "@/components/app/NewWorkspaceDialog";
import { AccountMark, LibraryMark, PersonalMark, WorkspaceLogo, personalPlanLabel } from "@/components/app/WorkspaceMenu";
import { flushBeforeSwitch, placesAvailable, signInToAnotherAccount, switchToPlace, usePlaces, type Place } from "@/lib/places";
import { openMovePlaces } from "@/components/places/MovePlaces";
import { deviceWords } from "@/lib/shell/words";
import { currentBackendMode } from "@/lib/backendMode";
import { inAndroidApp } from "@/lib/nativeApp";
import { isIpadApp } from "@/lib/iphone";
import { Sheet } from "./Sheet";
import { GroupedRow, GroupedSection, RowIcon } from "./Grouped";

/**
 * The avatar's sheet (top left of Home, Tasks and Calendar): where you are (Personal or a workspace, with a
 * check), the workspace's people and settings, Settings, Help, appearance and Sign out. The same things as
 * the sidebar's switcher menu on the web.
 */
export function AccountSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { context, workspace, workspaces, setContext, profile, appearance, setAppearance, engine, outbox } = useAppState();
  // Several places (docs/MULTI_ACCOUNT_PLAN.md): the other accounts and the library on this device.
  const { places, current } = usePlaces();
  const several = placesAvailable();
  const others = several ? places.filter((p) => p.id !== current) : [];
  const openPlace = (p: Place, workspaceId?: string | null) => {
    onClose();
    void switchToPlace(p, { workspaceId, flush: () => flushBeforeSwitch({ engine, outbox }) });
  };
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
  // Without an account (notes kept on the device) the row says where they are rather than nothing.
  const detail = email ?? (currentBackendMode() === "local" ? `Notes on this ${inAndroidApp() ? "phone" : isIpadApp() ? "iPad" : "iPhone"}` : null);
  return (
    <>
      {/* The medium detent ends after a whole group (not part way through Appearance). */}
      <Sheet open={open} onClose={onClose} title="Account" size="medium" snapMedium="section" bodyClassName="pb-6">
        <div className="flex items-center gap-3 px-5 pb-5 pt-2">
          <PersonalMark size={52} className="!rounded-capsule" />
          <div className="min-w-0">
            <p className="truncate text-[19px] font-semibold text-heading">{profile.displayName}</p>
            {detail ? <p className="truncate text-[15px] leading-5 text-muted">{detail}</p> : null}
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
        {others.length ? (
          <GroupedSection title="Other places" className="mt-6">
            {others.map((p) =>
              p.kind === "library" ? (
                <GroupedRow key={p.id} icon={<RowIcon><LibraryMark /></RowIcon>} label={`On ${deviceWords().here}`} description={p.syncs} onClick={() => openPlace(p)} />
              ) : (
                [
                  <GroupedRow key={p.id} icon={<AccountMark name={p.name || p.email} avatarUrl={p.avatarUrl} size={30} />} label={p.name || p.email} description={[p.email, p.unread ? `${p.unread} unread` : null].filter(Boolean).join(" · ") || undefined} onClick={() => openPlace(p, null)} />,
                  ...p.workspaces.map((w) => <GroupedRow key={`${p.id}:${w.id}`} icon={<WorkspaceLogo workspace={w} size={30} />} label={w.name} description={`In ${p.name || p.email}`} onClick={() => openPlace(p, w.id)} />),
                ]
              ),
            )}
          </GroupedSection>
        ) : null}
        {several ? (
          <GroupedSection className="mt-6">
            <GroupedRow icon={<RowIcon><LogIn /></RowIcon>} label="Sign in to another account" onClick={() => { onClose(); void signInToAnotherAccount(); }} />
            {others.length ? <GroupedRow icon={<RowIcon><ArrowRightLeft /></RowIcon>} label="Move or copy notes" onClick={() => { onClose(); openMovePlaces(); }} /> : null}
          </GroupedSection>
        ) : null}
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
          <GroupedRow icon={<RowIcon tone="color-mix(in oklab, var(--color-destructive) 14%, transparent)"><LogOut className="text-danger" /></RowIcon>} label={currentBackendMode() === "local" ? "Sign out" : `Sign out of ${profile.displayName || "this account"}`} danger onClick={() => void safeSignOut.request()} />
        </GroupedSection>
      </Sheet>
      <NewWorkspaceDialog open={creating} onClose={() => setCreating(false)} onCreated={() => go("/documents")} />
      {inviting && workspace ? <InviteDialog workspace={workspace} open onClose={() => setInviting(false)} /> : null}
      <SupportDialog open={contacting} onClose={() => setContacting(false)} />
      {safeSignOut.dialog}
    </>
  );
}
