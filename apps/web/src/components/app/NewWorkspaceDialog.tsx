"use client";

import { useMutation } from "convex/react";
import { api } from "@/lib/convex/api";
import { useAppState, type WorkspaceRole } from "@/lib/app/state";
import { PromptDialog } from "@/components/ui/PromptDialog";
import { useToast, errorMessage } from "@/components/ui/Toast";

/** How a role reads in the switcher and settings: Owner, Admin or Member (a member's access restriction is shown separately). */
export function workspaceRoleLabel(role: WorkspaceRole): string {
  return role === "owner" ? "Owner" : role === "admin" ? "Admin" : "Member";
}

/**
 * Names and creates a team workspace, then switches to it. Personal is never a workspace: this only makes
 * team workspaces (with members, their own plan and storage).
 */
export function NewWorkspaceDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated?: (workspaceId: string) => void }) {
  const { setContext } = useAppState();
  const create = useMutation(api.workspaces.createTeamWorkspace);
  const toast = useToast();
  return (
    <PromptDialog
      open={open}
      title="New workspace"
      label="Workspace name"
      confirmLabel="Create workspace"
      onClose={onClose}
      onSubmit={async (name) => {
        try {
          const r = await create({ name });
          setContext({ kind: "workspace", workspaceId: r.id });
          onCreated?.(r.id);
          toast.show(`Created ${name}`, { tone: "success" });
        } catch (e) {
          toast.show(errorMessage(e), { tone: "error" });
        }
      }}
    />
  );
}
