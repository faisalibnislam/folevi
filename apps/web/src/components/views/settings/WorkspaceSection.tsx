"use client";

import { useMutation } from "convex/react";
import { useState } from "react";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { Button } from "@/components/ui/Button";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { formatBytes } from "@/lib/format";
import { Card } from "./Card";

export function WorkspaceSection() {
  const { workspace, setWorkspace } = useAppState();
  const rename = useMutation(api.workspaces.rename);
  const create = useMutation(api.workspaces.createTeamWorkspace);
  const toast = useToast();
  const [name, setName] = useState(workspace.name);
  const [teamName, setTeamName] = useState("");
  const canAdmin = workspace.role === "owner" || workspace.role === "admin";
  return (
    <>
      <Card title="Workspace" description={`${workspace.kind === "personal" ? "Personal" : "Team"} workspace · you are ${workspace.role === "owner" ? "the owner" : `an ${workspace.role}`}.`}>
        <form
          className="flex max-w-md gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            rename({ workspaceId: workspace.id, name }).then(() => toast.show("Renamed", { tone: "success" }), (err) => toast.show(errorMessage(err), { tone: "error" }));
          }}
        >
          <label className="sr-only" htmlFor="ws-name">
            Workspace name
          </label>
          <input id="ws-name" disabled={!canAdmin} value={name} onChange={(e) => setName(e.target.value)} className="h-9 flex-1 ui-input rounded-full px-3 disabled:opacity-60" />
          <Button type="submit" disabled={!canAdmin}>
            Rename
          </Button>
        </form>
        <p className="mt-4 text-sm text-muted">
          Storage: {formatBytes(workspace.storageUsedBytes)} of {formatBytes(workspace.storageQuotaBytes)} used
        </p>
        <div className="mt-2 h-1.5 max-w-md overflow-hidden rounded-full bg-sunken" role="img" aria-label={`${Math.round((workspace.storageUsedBytes / workspace.storageQuotaBytes) * 100)}% of storage used`}>
          <div className="h-full bg-accent" style={{ width: `${Math.min(100, (workspace.storageUsedBytes / workspace.storageQuotaBytes) * 100)}%` }} />
        </div>
      </Card>
      <Card title="New team workspace" description="Share folders, documents and tasks with other people. Your personal workspace stays private.">
        <form
          className="flex max-w-md gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            create({ name: teamName }).then(
              (r) => {
                setWorkspace(r.id);
                toast.show("Workspace created", { tone: "success" });
              },
              (err) => toast.show(errorMessage(err), { tone: "error" }),
            );
          }}
        >
          <label className="sr-only" htmlFor="team-name">
            Team workspace name
          </label>
          <input id="team-name" value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder="e.g. Ashgrove Gardens" className="h-9 flex-1 ui-input rounded-full px-3" />
          <Button type="submit" variant="primary" disabled={!teamName.trim()}>
            Create
          </Button>
        </form>
      </Card>
    </>
  );
}
