"use client";

import { useMutation, useQuery } from "convex/react";
import { useId, useState } from "react";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Select } from "@/components/ui/Select";
import { useToast, errorMessage } from "@/components/ui/Toast";

type Role = "admin" | "editor" | "commenter" | "viewer";

/** Invite someone to the current workspace by email, with a role. Used in settings and the invite modal. */
export function InviteForm({ onSent }: { onSent?: () => void }) {
  const { workspace } = useAppState();
  const data = useQuery(api.workspaces.members, { workspaceId: workspace.id });
  const invite = useMutation(api.workspaces.invite);
  const toast = useToast();
  const uid = useId();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("editor");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const isOwner = data?.yourRole === "owner";
  return (
    <>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (sending) return;
          setError(null);
          setSending(true);
          try {
            await invite({ workspaceId: workspace.id, email, role });
            toast.show(`Invitation sent to ${email.trim()}`, { tone: "success" });
            setEmail("");
            onSent?.();
          } catch (err) {
            setError(errorMessage(err));
          } finally {
            setSending(false);
          }
        }}
      >
        <label className="sr-only" htmlFor={`${uid}-email`}>
          Email
        </label>
        <input
          id={`${uid}-email`}
          type="email"
          required
          autoFocus
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setError(null);
          }}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${uid}-error` : undefined}
          placeholder="name@example.com"
          className="h-9 min-w-0 flex-1 ui-input rounded-[6px] px-3"
        />
        <Select aria-label="Role" value={role} onChange={(e) => setRole(e.target.value as Role)} className="h-9 ui-input rounded-[6px] px-3">
          {isOwner ? <option value="admin">Admin</option> : null}
          <option value="editor">Editor</option>
          <option value="commenter">Commenter</option>
          <option value="viewer">Viewer</option>
        </Select>
        <Button type="submit" variant="primary" aria-busy={sending || undefined}>
          {sending ? "Sending…" : "Invite"}
        </Button>
      </form>
      {error ? (
        <p id={`${uid}-error`} role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </>
  );
}

/** "Invite people…" as a modal: collaborators join the whole workspace (notes and folders). */
export function InviteDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { workspace } = useAppState();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Invite people to ${workspace.name}`}
      description="Collaborators can work on the notes and folders in this workspace. Invitations are tied to the email address you enter and expire after 7 days."
      size="md"
    >
      <InviteForm />
    </Dialog>
  );
}
