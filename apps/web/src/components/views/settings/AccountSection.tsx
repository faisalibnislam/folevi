"use client";

import { useMutation } from "convex/react";
import { useState } from "react";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { formatDateTime } from "@/lib/format";
import { Card } from "./Card";

export function AccountSection() {
  const { profile, timeZone } = useAppState();
  const update = useMutation(api.users.updateProfile);
  const requestDeletion = useMutation(api.users.requestAccountDeletion);
  const cancelDeletion = useMutation(api.users.cancelAccountDeletion);
  const toast = useToast();
  const [name, setName] = useState(profile.displayName);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState("");
  const zones = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [timeZone];
  return (
    <>
      <Card title="Profile">
        <form
          className="grid gap-4 sm:max-w-md"
          onSubmit={(e) => {
            e.preventDefault();
            update({ displayName: name }).then(() => toast.show("Saved", { tone: "success" }), (err) => toast.show(errorMessage(err), { tone: "error" }));
          }}
        >
          <label className="text-sm">
            <span className="mb-1 block font-medium">Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className="h-9 w-full ui-input rounded-full px-3" />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium">Email</span>
            <input value={profile.email} readOnly aria-describedby="email-hint" className="h-9 w-full ui-well rounded-full px-3 text-muted" />
            <span id="email-hint" className="mt-1 block text-xs text-muted">
              Your sign-in address. Contact support to change it.
            </span>
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium">Time zone</span>
            <select value={timeZone} onChange={(e) => void update({ timeZone: e.target.value })} className="h-9 w-full ui-input rounded-full px-2">
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-muted">Used for Today, the calendar and reminders.</span>
          </label>
          <div>
            <Button type="submit" variant="primary">
              Save
            </Button>
          </div>
        </form>
      </Card>
      <Card title="Delete account" description="Deletes your account, your personal workspace and everything in it after a 7-day grace period. Team workspaces you own pass to an admin if there is one. Export your data first if you want to keep it.">
        {profile.status === "pending_deletion" ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm">Scheduled for {profile.deletionScheduledFor ? formatDateTime(profile.deletionScheduledFor) : "soon"}.</p>
            <Button onClick={() => void cancelDeletion({}).then(() => toast.show("Deletion canceled", { tone: "success" }))}>Cancel deletion</Button>
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
              onClick={() =>
                requestDeletion({ confirmEmail }).then(
                  () => {
                    setDeleteOpen(false);
                    toast.show("Account deletion scheduled");
                  },
                  (e) => toast.show(errorMessage(e), { tone: "error" }),
                )
              }
            >
              Schedule deletion
            </Button>
          </>
        }
      >
        <label className="text-sm" htmlFor="confirm-email">
          Type <strong>{profile.email}</strong> to confirm
        </label>
        <input id="confirm-email" value={confirmEmail} onChange={(e) => setConfirmEmail(e.target.value)} className="mt-2 h-10 w-full ui-input rounded-full px-3" autoComplete="off" />
      </Dialog>
    </>
  );
}
