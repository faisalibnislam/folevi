"use client";

import { useMutation, useQuery } from "convex/react";
import { useId, useState } from "react";
import { api } from "@/lib/convex/api";
import type { Workspace } from "@/lib/app/state";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Select } from "@/components/ui/Select";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { formatPrice } from "@/lib/plans";

type Role = "admin" | "editor" | "commenter" | "viewer";
type InviteWorkspace = Pick<Workspace, "id" | "name">;

/** Invite someone to a team workspace by email, with a role. Used in settings and the invite modal. Personal has no members. */
export function InviteForm({ workspace, onSent }: { workspace: InviteWorkspace; onSent?: () => void }) {
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
      {/* On a paid plan, what one more member costs (the server bills it once they accept). */}
      {data?.seats?.paid && data.seats.interval ? (
        <p className="mt-2 text-[12.5px] text-muted">
          Adds a seat when they accept: +{formatPrice(data.seats.seatPriceCents)}/{data.seats.interval === "year" ? "year" : "month"} on {data.seats.planName}.
        </p>
      ) : null}
    </>
  );
}

/** "Invite people…" as a modal: collaborators join the whole workspace (notes and folders). */
export function InviteDialog({ workspace, open, onClose }: { workspace: InviteWorkspace; open: boolean; onClose: () => void }) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Invite people to ${workspace.name}`}
      description="Collaborators can work on the notes and folders in this workspace. Invitations are tied to the email address you enter and expire after 7 days."
      size="md"
    >
      <InviteForm workspace={workspace} />
    </Dialog>
  );
}
