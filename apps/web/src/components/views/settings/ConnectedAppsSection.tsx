"use client";

import { useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { Copy, Plug } from "lucide-react";
import { api } from "@/lib/convex/api";
import { Button } from "@/components/ui/Button";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { formatRelative } from "@/lib/format";
import { Card } from "./Card";
import { ApiTokensCard } from "./ApiTokens";

/** How each tool reads in the activity list. */
const TOOL_LABELS: Record<string, string> = {
  list_places: "Listed places",
  search_notes: "Searched notes",
  get_note: "Read a note",
  list_recent_notes: "Listed recent notes",
  list_folders: "Listed folders",
  list_tags: "Listed tags",
  list_tasks: "Listed tasks",
  create_note: "Created a note",
  append_to_note: "Added to a note",
  add_task: "Added a task",
  complete_task: "Checked off a task",
  update_task: "Changed a task",
  "resources/read": "Read a note",
};

/** The connection steps for the common apps (the server URL is the same for all). */
const HOW: { app: string; steps: string }[] = [
  { app: "Claude", steps: "Settings → Connectors → Add custom connector, paste the address, then Connect." },
  { app: "ChatGPT", steps: "Settings → Apps → Advanced → Developer mode, then Create app with the address." },
  { app: "Claude Code", steps: "Run: claude mcp add --transport http folevi <address>, then /mcp to sign in." },
  { app: "Cursor and VS Code", steps: "Add an HTTP MCP server with the address; they open Folevi to sign in." },
];

/**
 * Settings → Connected apps: what Folevi's MCP server is, its address, and every app connected to this
 * account with what it may do, where, its recent activity and a Disconnect button (convex/mcp.ts).
 */
export function ConnectedAppsSection() {
  const grants = useQuery(api.mcp.listGrants, {});
  const revoke = useMutation(api.mcp.revokeGrant);
  const toast = useToast();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [address, setAddress] = useState("https://app.folevi.com/mcp");
  useEffect(() => setAddress(`${window.location.origin}/mcp`), []);

  return (
    <div className="space-y-4">
      <Card
        title="Use Folevi from other apps"
        description="AI apps like Claude, ChatGPT and Cursor can search and read your notes, add new ones and manage tasks through Folevi’s MCP server. You choose what each one may do and where when you connect it. It uses the app’s own AI, so no Folevi AI credits are spent."
      >
        <div className="flex max-w-xl items-center gap-2">
          <input readOnly value={address} aria-label="MCP server address" onFocus={(e) => e.target.select()} className="h-9 min-w-0 flex-1 ui-well rounded-chip px-3 font-mono text-[13px]" />
          <Button size="sm" onClick={() => void navigator.clipboard.writeText(address).then(() => toast.show("Address copied"))}>
            <Copy size={13} aria-hidden /> Copy
          </Button>
        </div>
        <dl className="mt-4 grid max-w-xl gap-2 text-[13px]">
          {HOW.map((h) => (
            <div key={h.app} className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-2">
              <dt className="font-medium text-ink">{h.app}</dt>
              <dd className="text-muted">{h.steps}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card title="Connected apps" description="Disconnecting stops an app at once; it has to ask again to come back. Everything an app changes is in the note’s version history.">
        {grants === undefined ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : grants.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-muted">
            <Plug size={15} aria-hidden /> No apps are connected.
          </p>
        ) : (
          <ul className="divide-y divide-line/70">
            {grants.map((g) => (
              <li key={g.id} aria-label={g.name} className="py-4 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
                  <div className="min-w-0 flex-1 basis-64">
                    <p className="text-[14px] font-semibold text-heading">{g.name}</p>
                    <p className="mt-0.5 text-[12.5px] text-muted">
                      {g.redirectHost ? `Returns to ${g.redirectHost} · ` : ""}Connected {formatRelative(g.connectedAt)}
                      {g.lastUsedAt ? ` · last used ${formatRelative(g.lastUsedAt)}` : " · not used yet"}
                    </p>
                    <p className="mt-1.5 text-[13px] text-ink">
                      {!g.canRead ? "Only adds new things" : g.canWrite ? (g.createOnly ? "Reads and adds new things" : "Reads and makes changes") : "Reads only"} in {g.places.join(", ") || "no places"}
                      {g.includeShared ? ", plus pages shared with you" : ""}
                    </p>
                    {g.recent.length ? (
                      <ul className="mt-2 space-y-0.5 text-[12.5px] text-muted">
                        {g.recent.slice(0, 5).map((e, i) => (
                          <li key={i}>
                            {TOOL_LABELS[e.tool] ?? e.tool}
                            {e.outcome === "ok" ? "" : e.outcome === "denied" ? " (not allowed)" : " (failed)"} · {formatRelative(e.at)}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                  {confirming === g.id ? (
                    <div className="flex flex-none items-center gap-2">
                      <Button size="sm" onClick={() => setConfirming(null)}>
                        Keep
                      </Button>
                      <Button
                        size="sm"
                        variant="primary"
                        className="bg-danger"
                        onClick={() =>
                          void revoke({ grantId: g.id }).then(
                            () => {
                              setConfirming(null);
                              toast.show(`${g.name} was disconnected`);
                            },
                            (e) => toast.show(errorMessage(e), { tone: "error" }),
                          )
                        }
                      >
                        Disconnect
                      </Button>
                    </div>
                  ) : (
                    <Button size="sm" variant="quiet" className="flex-none text-danger" onClick={() => setConfirming(g.id)}>
                      Disconnect…
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <ApiTokensCard />
    </div>
  );
}
