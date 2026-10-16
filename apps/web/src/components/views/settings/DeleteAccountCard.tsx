"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { formatDateTime } from "@/lib/format";
import { Card } from "./Card";
import { useIphoneApp } from "@/lib/iphone";
import { ActionRow, DestructiveRow, IosRow, IosSection, Subscreen, TextRow } from "@/components/iphone/SettingsKit";

/** Delete account (Settings → Security): scheduled with a 7-day grace period, cancelable. */
export function DeleteAccountCard() {
  const { profile } = useAppState();
  const requestDeletion = useMutation(api.users.requestAccountDeletion);
  const cancelDeletion = useMutation(api.users.cancelAccountDeletion);
  // Workspaces other people use must be handed on or deleted first (the server refuses otherwise).
  const blockers = useQuery(api.users.deletionBlockers, profile.status === "pending_deletion" ? "skip" : {});
  const toast = useToast();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState("");
  const iphone = useIphoneApp();
  const schedule = () =>
    requestDeletion({ confirmEmail }).then(
      () => {
        setDeleteOpen(false);
        toast.show("Account deletion scheduled");
      },
      (e) => toast.show(errorMessage(e), { tone: "error" }),
    );
  if (iphone) {
    const explain = "Deletes your account, your Personal and everything in it after a 7-day grace period, along with workspaces you own that nobody else is in. Export your data first if you want to keep it.";
    return (
      <IosSection footer={profile.status === "pending_deletion" ? "You can cancel until then by signing in." : undefined}>
        {profile.status === "pending_deletion" ? (
          <>
            <IosRow label="Deletion scheduled" value={profile.deletionScheduledFor ? formatDateTime(profile.deletionScheduledFor) : "Soon"} />
            <ActionRow label="Cancel deletion" onClick={() => void cancelDeletion({}).then(() => toast.show("Deletion canceled", { tone: "success" }))} />
          </>
        ) : (
          <IosRow label="Delete account" danger screen="delete-account" chevron />
        )}
        <Subscreen id="delete-account" title="Delete account">
          {blockers && blockers.workspaces.length > 0 ? (
            <IosSection
              header={`You own ${blockers.workspaces.length === 1 ? "a workspace" : "workspaces"} other people use`}
              footer={`Your account can't be deleted until you make another member the owner (Members, Make owner) or delete ${blockers.workspaces.length === 1 ? "it" : "them"} (General, Delete workspace).`}
            >
              {blockers.workspaces.map((w) => (
                <IosRow key={w.id} label={w.name} value={`${w.otherMembers} other ${w.otherMembers === 1 ? "member" : "members"}`} />
              ))}
            </IosSection>
          ) : (
            <>
              <IosSection footer={explain}>
                <TextRow stacked label={`Type ${profile.email} to confirm`} type="email" autoComplete="off" value={confirmEmail} onChange={setConfirmEmail} />
              </IosSection>
              <IosSection footer="You can cancel within 7 days by signing in. After that, deletion is permanent and cannot be undone. We'll email you a confirmation.">
                <DestructiveRow label="Schedule deletion" message="Your account and everything in it will be deleted in 7 days." confirm="Delete my account" disabled={confirmEmail.trim().toLowerCase() !== profile.email} onConfirm={() => void schedule().then(() => history.back())} />
              </IosSection>
            </>
          )}
        </Subscreen>
      </IosSection>
    );
  }
  return (
    <>
      <Card title="Delete account" description="Deletes your account, your Personal and everything in it after a 7-day grace period, along with workspaces you own that nobody else is in. Export your data first if you want to keep it.">
        {profile.status === "pending_deletion" ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm">Scheduled for {profile.deletionScheduledFor ? formatDateTime(profile.deletionScheduledFor) : "soon"}.</p>
            <Button onClick={() => void cancelDeletion({}).then(() => toast.show("Deletion canceled", { tone: "success" }))}>Cancel deletion</Button>
          </div>
        ) : blockers && blockers.workspaces.length > 0 ? (
          <div role="status" className="max-w-xl text-sm">
            <p>You own {blockers.workspaces.length === 1 ? "a workspace" : "workspaces"} other people use. Your account can’t be deleted until you make another member the owner (Members → Make owner) or delete {blockers.workspaces.length === 1 ? "it" : "them"} (General → Delete workspace):</p>
            <ul className="mt-2 list-disc space-y-0.5 pl-5 text-muted">
              {blockers.workspaces.map((w) => (
                <li key={w.id}>
                  {w.name} · {w.otherMembers} other {w.otherMembers === 1 ? "member" : "members"}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <Button variant="danger" onClick={() => setDeleteOpen(true)}>
            Delete my account…
          </Button>
        )}
      </Card>
      <Dialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Delete your account?"
        description="You can cancel within 7 days by signing in. After that, deletion is permanent and cannot be undone. We'll email you a confirmation."
        size="sm"
        footer={
          <>
            <Button onClick={() => setDeleteOpen(false)}>Keep my account</Button>
            <Button
              variant="danger"
              disabled={confirmEmail.trim().toLowerCase() !== profile.email}
              onClick={() => void schedule()}
            >
              Schedule deletion
            </Button>
          </>
        }
      >
        <label className="text-sm" htmlFor="confirm-email">
          Type <strong>{profile.email}</strong> to confirm
        </label>
        <input id="confirm-email" value={confirmEmail} onChange={(e) => setConfirmEmail(e.target.value)} className="mt-2 h-10 w-full ui-input rounded-chip px-3 text-sm" autoComplete="off" />
      </Dialog>
    </>
  );
}
