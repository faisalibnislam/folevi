"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "@/lib/convex/api";
import type { Workspace } from "@/lib/app/state";
import { AppLink } from "@/lib/app/router";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { formatRelative } from "@/lib/format";
import { Card } from "./Card";
import { Select } from "@/components/ui/Select";
import { InviteForm } from "@/components/app/InviteDialog";
import { Switch } from "@/components/ui/Switch";
import { formatPrice } from "@/lib/plans";
import { canPurchaseHere } from "@/lib/nativeApp";
import { useIphoneLook } from "@/lib/iphone";
import { useAppRouter } from "@/lib/app/router";
import { ActionSheet, ChoiceRow, DestructiveRow, IosRow, IosSection, IosText, Subscreen, SwitchRow, TextRow, useSettingsScreens, type Choice as RowChoice } from "@/components/iphone/SettingsKit";
import { RowIcon } from "@/components/iphone/Grouped";
import { GlassTextButton } from "@/components/iphone/Glass";
import { UserRoundPlus } from "lucide-react";
import { copy } from "@/lib/e2ee/copy";
import { useMemberSecurityCode, useRotationProgress, useWorkspaceKeys } from "@/components/e2ee/hooks";

type MemberAccess = "edit" | "comment" | "view";
/** A role choice in the member list: Member with an access, or Admin. */
type Choice = "member:edit" | "member:comment" | "member:view" | "admin";
type Confirm = { kind: "remove" | "owner" | "guest"; profileId: string; name: string } | null;

const ROLE_LABEL: Record<string, string> = { owner: "Owner", admin: "Admin", member: "Member" };
/** The chip next to a member who can't edit (they're still a Member, and still a seat). */
const ACCESS_CHIP: Record<MemberAccess, string | null> = { edit: null, comment: "Can comment", view: "View only" };

function choiceOf(role: string, access: MemberAccess): Choice {
  return role === "admin" ? "admin" : (`member:${access}` as Choice);
}

function RoleChip({ access }: { access: MemberAccess }) {
  const chip = ACCESS_CHIP[access];
  return chip ? <span className="ml-1.5 rounded-chip border border-line px-1.5 py-px text-[11px] font-medium text-muted">{chip}</span> : null;
}

/** Members of the current team workspace. Only shown when a workspace is open: Personal has no members. */
export function MembersSection({ workspace }: { workspace: Workspace }) {
  const data = useQuery(api.workspaces.members, { workspaceId: workspace.id });
  const revokeInvite = useMutation(api.workspaces.revokeInvite);
  const changeRole = useMutation(api.workspaces.changeRole);
  const remove = useMutation(api.workspaces.removeMember);
  const transfer = useMutation(api.workspaces.transferOwnership);
  const toGuest = useMutation(api.workspaces.convertMemberToGuest);
  const setBillingManager = useMutation(api.workspaces.setBillingManager);
  const toast = useToast();
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [busy, setBusy] = useState(false);
  const [revoking, setRevoking] = useState<NonNullable<typeof data>["invites"][number]["id"] | null>(null);
  const iphone = useIphoneLook();
  const { navigate } = useAppRouter();
  // End-to-end encryption (docs/E2EE_DESIGN.md §8): null unless this workspace is encrypted.
  const wsScope = { kind: "workspace" as const, workspaceId: workspace.id };
  const keys = useWorkspaceKeys(wsScope, useRotationProgress(wsScope));
  const [codeFor, setCodeFor] = useState<{ profileId: string; name: string } | null>(null);
  const canAdmin = data?.canManage === true;
  const isOwner = data?.yourRole === "owner";
  const act = (p: Promise<unknown>, ok: string) => p.then(() => toast.show(ok, { tone: "success" }), (e) => toast.show(errorMessage(e), { tone: "error" }));
  const setChoice = (profileId: string, name: string, choice: Choice) => {
    const args = choice === "admin" ? { workspaceId: workspace.id, profileId, role: "admin" as const } : { workspaceId: workspace.id, profileId, role: "member" as const, memberAccess: choice.slice("member:".length) as MemberAccess };
    const label = choice === "admin" ? "an admin" : choice === "member:edit" ? "a member" : choice === "member:comment" ? "a member who can comment" : "a view-only member";
    void act(changeRole(args), `${name} is now ${label}`);
  };

  const seatLine = data?.seats
    ? data.seats.paid && data.seats.interval && canPurchaseHere()
      ? `Billable seats: ${data.seats.billable} × ${formatPrice(data.seats.seatPriceCents)} per ${data.seats.interval === "year" ? "year" : "month"} on ${data.seats.planName}. Owners, admins and members each take a seat; guests and pending invitations are free.`
      : data.seats.paid
        ? // The iOS app shows no prices: how many seats, and who takes one.
          `Billable seats: ${data.seats.billable} on ${data.seats.planName}. Owners, admins and members each take a seat; guests and pending invitations are free.`
        : `Billable seats: ${data.seats.billable} (the ${data.seats.planName} plan is free). Guests and pending invitations never take a seat.`
    : undefined;

  const doConfirm = async (c: NonNullable<Confirm>) => {
    setBusy(true);
    try {
      if (c.kind === "owner") {
        await transfer({ workspaceId: workspace.id, profileId: c.profileId });
        toast.show(`${c.name} now owns ${workspace.name}`, { tone: "success" });
      } else if (c.kind === "guest") {
        await toGuest({ workspaceId: workspace.id, profileId: c.profileId });
        toast.show(`${c.name} is now a guest`, { tone: "success" });
      } else {
        await remove({ workspaceId: workspace.id, profileId: c.profileId });
        toast.show(`Removed ${c.name}`, { tone: "success" });
      }
      setConfirm(null);
      return true;
    } catch (e) {
      toast.show(errorMessage(e), { tone: "error" });
      return false;
    } finally {
      setBusy(false);
    }
  };
  if (iphone) {
    const roleChoices: RowChoice<Choice>[] = [
      { value: "member:edit", label: "Member" },
      { value: "member:comment", label: "Member, can comment" },
      { value: "member:view", label: "Member, view only" },
      ...(isOwner ? [{ value: "admin" as Choice, label: "Admin" }] : []),
    ];
    const roleLabel = (role: string, access: MemberAccess) => (role === "member" && ACCESS_CHIP[access] ? `Member, ${ACCESS_CHIP[access]!.toLowerCase()}` : (ROLE_LABEL[role] ?? "Member"));
    return (
      <>
        {canAdmin ? (
          <IosSection footer="Members can open everything in this workspace that isn't restricted. Invitations are tied to the email address you enter and expire after 7 days.">
            <IosRow icon={<RowIcon><UserRoundPlus /></RowIcon>} label="Invite people" screen="invite" />
          </IosSection>
        ) : null}
        {canAdmin ? <IphoneInvite workspace={workspace} isOwner={isOwner} /> : null}
        <IosSection header="Members" footer={`${seatLine ?? ""}${data && !canAdmin ? " Only owners and admins can invite people or change roles." : ""}`.trim() || undefined}>
          {data === undefined ? <IosText muted>Loading…</IosText> : null}
          {data?.members.map((m) => (
            <IosRow key={m.profileId} label={`${m.displayName}${m.isYou ? " (you)" : ""}`} description={m.email} value={roleLabel(m.role, m.memberAccess)} screen={`member-${m.profileId}`} />
          ))}
          {data?.guests !== null && data?.guests !== undefined ? <IosRow label="Guests" value={`${data.guests}, not billed`} onClick={() => navigate("/settings/workspace-guests")} chevron /> : null}
        </IosSection>
        {data?.members.map((m) => (
          <Subscreen key={m.profileId} id={`member-${m.profileId}`} title={m.displayName}>
            <IosSection>
              <IosRow label="Email" value={m.email} />
              {m.canManage ? (
                <ChoiceRow screen={`member-${m.profileId}.role`} label="Role" value={choiceOf(m.role, m.memberAccess)} choices={roleChoices} onChange={(c) => setChoice(m.profileId, m.displayName, c)} />
              ) : (
                <IosRow label="Role" value={roleLabel(m.role, m.memberAccess)} />
              )}
            </IosSection>
            {isOwner && m.role === "admin" ? (
              <IosSection footer="The owner decides which admins may manage the plan and billing.">
                <SwitchRow
                  label="Can manage billing"
                  checked={m.canManageBilling}
                  onChange={(next) => void act(setBillingManager({ workspaceId: workspace.id, profileId: m.profileId, allowed: next }), next ? `${m.displayName} can manage billing` : `${m.displayName} can no longer manage billing`)}
                />
              </IosSection>
            ) : m.role === "admin" && m.canManageBilling ? (
              <IosSection>
                <IosRow label="Can manage billing" value="Yes" />
              </IosSection>
            ) : null}
            {m.canManage ? (
              <>
                {isOwner ? (
                  <IosSection footer={`${m.displayName} will own ${workspace.name}, and be the only one who can manage admins, billing, or hand it on again. You'll stay on as an admin. The workspace's plan stays with the workspace.`}>
                    <IosRow label="Make owner" onClick={() => setConfirm({ kind: "owner", profileId: m.profileId, name: m.displayName })} />
                  </IosSection>
                ) : null}
                <IosSection footer={`${m.displayName} leaves the workspace's members (one seat less) and keeps access only to pages they created or were given, except restricted ones.`}>
                  <DestructiveRow label="Convert to guest" onConfirm={() => void doConfirm({ kind: "guest", profileId: m.profileId, name: m.displayName }).then((ok) => ok && history.back())} />
                </IosSection>
                <IosSection footer={`${m.displayName} will lose access to ${workspace.name} and any pages shared with them here. Their pages stay in the workspace, and their Personal isn't affected.`}>
                  <DestructiveRow label={`Remove ${m.displayName}`} confirm="Remove" onConfirm={() => void doConfirm({ kind: "remove", profileId: m.profileId, name: m.displayName }).then((ok) => ok && history.back())} />
                </IosSection>
              </>
            ) : null}
          </Subscreen>
        ))}
        {data?.invites.length ? (
          <IosSection header="Pending invitations">
            {data.invites.map((i) => (
              <IosRow
                key={i.id}
                label={i.email}
                description={`${ROLE_LABEL[i.role] ?? "Member"}${i.role === "member" && ACCESS_CHIP[i.memberAccess] ? `, ${ACCESS_CHIP[i.memberAccess]!.toLowerCase()}` : ""} · ${i.expired ? "expired" : `expires ${formatRelative(i.expiresAt)}`}`}
                trailing={
                  <button type="button" aria-label={`Revoke the invitation to ${i.email}`} onClick={() => setRevoking(i.id)} className="-mr-2 flex h-11 items-center px-2 text-[17px] text-danger outline-none">
                    Revoke
                  </button>
                }
              />
            ))}
          </IosSection>
        ) : null}
        <ActionSheet
          open={revoking !== null}
          onClose={() => setRevoking(null)}
          message="The link in the email stops working."
          actions={[{ label: "Revoke invitation", danger: true, onSelect: () => revoking && void act(revokeInvite({ inviteId: revoking }), "Invitation revoked") }]}
        />
        <ActionSheet
          open={confirm?.kind === "owner"}
          onClose={() => setConfirm(null)}
          title={confirm ? `Make ${confirm.name} the owner?` : undefined}
          message="You'll stay on as an admin."
          actions={[{ label: "Transfer ownership", onSelect: () => confirm && void doConfirm(confirm) }]}
        />
      </>
    );
  }
  return (
    <>
      {canAdmin ? (
        <Card title="Invite people" description="Members can open everything in this workspace that isn't restricted. Invitations are tied to the email address you enter and expire after 7 days.">
          <InviteForm workspace={workspace} />
        </Card>
      ) : null}
      <Card
        title="Members"
        description={
          seatLine || data?.guests !== null ? (
            <>
              {seatLine}
              {data?.guests !== null && data?.guests !== undefined ? (
                <>
                  {seatLine ? " " : null}
                  <AppLink href="/settings/workspace-guests" className="font-medium text-heading underline decoration-line-strong underline-offset-2 hover:decoration-heading">
                    Guests: {data.guests} · Not billed
                  </AppLink>
                </>
              ) : null}
            </>
          ) : undefined
        }
      >
        {keys?.rotation ? (
          <p role="status" className="mb-3 text-[13px] font-medium text-heading">
            {copy.members.rotating(keys.rotation.done, keys.rotation.total)}
          </p>
        ) : null}
        {keys && canAdmin && keys.pending.size ? (
          <p role="status" className="mb-3 text-[13px] text-muted">
            <span className="font-medium text-heading">{copy.members.waitingBadge(keys.pending.size)}</span>. {copy.members.waitingHint}
          </p>
        ) : null}
        <ul className="divide-y divide-line rounded-control border border-line">
          {data?.members.map((m) => (
            <li key={m.profileId} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">
                  {m.displayName} {m.isYou ? <span className="text-xs text-muted">(you)</span> : null}
                  {keys?.pending.has(m.profileId) ? <span className="ml-1.5 rounded-chip border border-line px-1.5 py-px text-[11px] font-medium text-muted">{copy.members.waiting}</span> : null}
                </span>
                <span className="block text-xs text-muted">{m.email}</span>
                {keys?.keyChanged.has(m.profileId) ? <span className="mt-0.5 block text-xs text-ink">{copy.members.keyChanged(m.displayName)}</span> : null}
                {/* The owner decides which admins may manage the plan and billing. */}
                {isOwner && m.role === "admin" ? (
                  <span className="mt-1.5 flex items-center gap-2 text-xs text-muted">
                    <Switch
                      checked={m.canManageBilling}
                      label={`${m.displayName} can manage billing`}
                      onChange={(next) =>
                        void act(setBillingManager({ workspaceId: workspace.id, profileId: m.profileId, allowed: next }), next ? `${m.displayName} can manage billing` : `${m.displayName} can no longer manage billing`)
                      }
                    />
                    Can manage billing
                  </span>
                ) : m.role === "admin" && m.canManageBilling ? (
                  <span className="mt-0.5 block text-xs text-muted">Can manage billing</span>
                ) : null}
              </span>
              {keys && !m.isYou && !keys.pending.has(m.profileId) ? (
                <Button size="sm" variant="quiet" onClick={() => setCodeFor({ profileId: m.profileId, name: m.displayName })}>
                  {copy.members.securityCode}
                </Button>
              ) : null}
              {m.canManage ? (
                <>
                  <Select
                    aria-label={`Role for ${m.displayName}`}
                    value={choiceOf(m.role, m.memberAccess)}
                    onChange={(e) => setChoice(m.profileId, m.displayName, e.target.value as Choice)}
                    className="h-8 ui-input rounded-chip px-3 text-sm"
                  >
                    <option value="member:edit">Member</option>
                    <option value="member:comment">Member · can comment</option>
                    <option value="member:view">Member · view only</option>
                    {isOwner ? <option value="admin">Admin</option> : null}
                  </Select>
                  {isOwner ? (
                    <Button size="sm" variant="quiet" onClick={() => setConfirm({ kind: "owner", profileId: m.profileId, name: m.displayName })}>
                      Make owner
                    </Button>
                  ) : null}
                  <Button size="sm" variant="quiet" onClick={() => setConfirm({ kind: "guest", profileId: m.profileId, name: m.displayName })}>
                    Convert to guest
                  </Button>
                  <Button size="sm" variant="quiet" className="text-danger" onClick={() => setConfirm({ kind: "remove", profileId: m.profileId, name: m.displayName })}>
                    Remove
                  </Button>
                </>
              ) : (
                <span className="text-sm text-muted">
                  {ROLE_LABEL[m.role] ?? "Member"}
                  {m.role === "member" ? <RoleChip access={m.memberAccess} /> : null}
                </span>
              )}
            </li>
          ))}
        </ul>
        {data?.invites.length ? (
          <>
            <h4 className="mb-2 mt-5 text-sm font-semibold">Pending invitations</h4>
            <ul className="divide-y divide-line rounded-control border border-line">
              {data.invites.map((i) => (
                <li key={i.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <span className="flex-1">{i.email}</span>
                  <span className="text-xs text-muted">
                    {ROLE_LABEL[i.role] ?? "Member"}
                    {i.role === "member" && ACCESS_CHIP[i.memberAccess] ? ` · ${ACCESS_CHIP[i.memberAccess]!.toLowerCase()}` : ""} · {i.expired ? "expired" : `expires ${formatRelative(i.expiresAt)}`}
                  </span>
                  <Button size="sm" variant="quiet" onClick={() => void act(revokeInvite({ inviteId: i.id }), "Invitation revoked")}>
                    Revoke
                  </Button>
                </li>
              ))}
            </ul>
          </>
        ) : null}
        {data && !canAdmin ? <p className="mt-3 text-sm text-muted">Only owners and admins can invite people or change roles.</p> : null}
      </Card>
      <SecurityCodeDialog member={codeFor} onClose={() => setCodeFor(null)} />
      <Dialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={confirm?.kind === "owner" ? `Make ${confirm.name} the owner?` : confirm?.kind === "guest" ? `Make ${confirm.name} a guest?` : `Remove ${confirm?.name ?? ""}?`}
        description={
          confirm?.kind === "owner"
            ? `${confirm.name} will own ${workspace.name}, and be the only one who can manage admins, billing, or hand it on again. You’ll stay on as an admin. The workspace’s plan stays with the workspace.`
            : confirm?.kind === "guest"
              ? `${confirm.name} leaves the workspace's members (one seat less) and keeps access only to pages they created or were given, except restricted ones. They won't see anything else here.`
              : `${confirm?.name ?? "They"} will lose access to ${workspace.name} and any pages shared with them here. Their pages stay in the workspace, and their Personal isn’t affected.`
        }
        size="sm"
        footer={
          <>
            <Button onClick={() => setConfirm(null)}>Cancel</Button>
            <Button
              variant={confirm?.kind === "owner" ? "primary" : "danger"}
              disabled={busy}
              onClick={() => confirm && void doConfirm(confirm)}
            >
              {confirm?.kind === "owner" ? "Transfer ownership" : confirm?.kind === "guest" ? "Convert to guest" : "Remove"}
            </Button>
          </>
        }
      />
    </>
  );
}

/** Inviting someone in the iPhone app: their email and role on a screen of its own, with Invite in its bar. */
function IphoneInvite({ workspace, isOwner }: { workspace: Workspace; isOwner: boolean }) {
  const invite = useMutation(api.workspaces.invite);
  const toast = useToast();
  const screens = useSettingsScreens();
  const [email, setEmail] = useState("");
  const [offer, setOffer] = useState<Choice>("member:edit");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const send = async () => {
    if (sending || !email.trim()) return;
    setError(null);
    setSending(true);
    try {
      await invite(offer === "admin" ? { workspaceId: workspace.id, email, role: "admin" } : { workspaceId: workspace.id, email, role: "member", memberAccess: offer.slice("member:".length) as MemberAccess });
      toast.show(`Invitation sent to ${email.trim()}`, { tone: "success" });
      setEmail("");
      screens?.back();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSending(false);
    }
  };
  return (
    <Subscreen
      id="invite"
      title="Invite people"
      trailing={
        <GlassTextButton strong disabled={sending || !email.trim()} onClick={() => void send()}>
          {sending ? "Sending…" : "Invite"}
        </GlassTextButton>
      }
    >
      {error ? <IosSection><IosText><span role="alert" className="text-danger">{error}</span></IosText></IosSection> : null}
      <IosSection footer="Invitations are tied to the email address you enter and expire after 7 days. To share just one page, use Share on that page instead: guests are never billed.">
        <TextRow label="Email" type="email" inputMode="email" autoComplete="email" placeholder="name@example.com" value={email} onChange={(v) => {
          setEmail(v);
          setError(null);
        }} />
        <ChoiceRow
          screen="invite.role"
          label="Role"
          value={offer}
          choices={[
            { value: "member:edit", label: "Member" },
            { value: "member:comment", label: "Member, can comment" },
            { value: "member:view", label: "Member, view only" },
            ...(isOwner ? [{ value: "admin" as Choice, label: "Admin" }] : []),
          ]}
          onChange={setOffer}
        />
      </IosSection>
    </Subscreen>
  );
}

/** A member's security code (§8.6): 12 digits in four groups of three, to compare in person or on a call. */
function SecurityCodeDialog({ member, onClose }: { member: { profileId: string; name: string } | null; onClose: () => void }) {
  const code = useMemberSecurityCode(member?.profileId ?? null);
  return (
    <Dialog open={member !== null} onClose={onClose} title={member ? copy.members.securityTitle(member.name) : ""} description={member ? copy.members.securityBody(member.name) : undefined} size="sm" footer={<Button onClick={onClose}>{copy.members.close}</Button>}>
      {code ? (
        <p className="py-2 text-center font-mono text-[26px] font-semibold tracking-[0.1em] text-heading tabular-nums" aria-label={code.split("").join(" ")}>
          {code.match(/.{3}/g)?.join(" ")}
        </p>
      ) : (
        <p className="text-sm text-muted">Loading…</p>
      )}
    </Dialog>
  );
}
