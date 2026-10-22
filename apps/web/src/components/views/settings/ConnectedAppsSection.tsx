"use client";

import { useMutation, useQuery } from "convex/react";
import { useEffect, useId, useState } from "react";
import { Copy, Plug } from "lucide-react";
import { api } from "@/lib/convex/api";
import { Button } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Switch";
import { useAppState } from "@/lib/app/state";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { formatRelative } from "@/lib/format";
import { Card } from "./Card";
import { ApiTokensCard } from "./ApiTokens";
import { WebhooksCard } from "./Webhooks";
import { EmptyState } from "@/components/ui/EmptyState";
import { useIphoneLook } from "@/lib/iphone";
import { ActionRow, DestructiveRow, IosRow, IosSection, IosText, Subscreen, SwitchRow } from "@/components/iphone/SettingsKit";
import { RowIcon } from "@/components/iphone/Grouped";

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
  const iphone = useIphoneLook();
  const copy = () => void navigator.clipboard.writeText(address).then(() => toast.show("Address copied"));
  const disconnect = (g: { id: (typeof grants & object)[number]["id"]; name: string }) =>
    void revoke({ grantId: g.id }).then(
      () => {
        setConfirming(null);
        toast.show(`${g.name} was disconnected`);
      },
      (e) => toast.show(errorMessage(e), { tone: "error" }),
    );
  if (iphone) {
    const does = (g: NonNullable<typeof grants>[number]) =>
      `${!g.canRead ? "Only adds new things" : g.canWrite ? (g.createOnly ? "Reads and adds new things" : "Reads and makes changes") : "Reads only"} in ${g.places.join(", ") || "no places"}${g.includeShared ? ", plus pages shared with you" : ""}`;
    return (
      <>
        <IosSection
          header="Use Folevi from other apps"
          footer="AI apps like Claude, ChatGPT and Cursor can search and read your notes, add new ones and manage tasks through Folevi's MCP server. You choose what each one may do and where when you connect it. It uses the app's own AI, so no Folevi AI credits are spent."
        >
          <IosRow label="Server address" description={<span className="font-mono">{address}</span>} />
          <ActionRow label="Copy address" onClick={copy} />
          <IosRow label="How to connect" screen="how" />
        </IosSection>
        <Subscreen id="how" title="How to connect">
          <IosSection footer="Each one opens Folevi to sign in and choose what it may do.">
            {HOW.map((h) => (
              <IosRow key={h.app} label={h.app} description={h.steps.replace(/ → /g, ", ")} />
            ))}
          </IosSection>
        </Subscreen>
        <IosSection header="Connected apps" footer="Disconnecting stops an app at once; it has to ask again to come back. Everything an app changes is in the note's version history.">
          {grants === undefined ? <IosText muted>Loading…</IosText> : null}
          {grants?.length === 0 ? <IosText muted>No apps are connected</IosText> : null}
          {grants?.map((g) => (
            <IosRow key={g.id} icon={<RowIcon><Plug /></RowIcon>} label={g.name} description={g.lastUsedAt ? `Last used ${formatRelative(g.lastUsedAt)}` : "Not used yet"} screen={`app-${g.id}`} />
          ))}
        </IosSection>
        {grants?.map((g) => (
          <Subscreen key={g.id} id={`app-${g.id}`} title={g.name}>
            <IosSection footer={g.redirectHost ? `Returns to ${g.redirectHost}.` : undefined}>
              <IosRow label="Connected" value={formatRelative(g.connectedAt)} />
              <IosRow label="Last used" value={g.lastUsedAt ? formatRelative(g.lastUsedAt) : "Not yet"} />
              <IosRow label="Can" description={does(g)} />
            </IosSection>
            {g.recent.length ? (
              <IosSection header="Recently">
                {g.recent.slice(0, 5).map((e, i) => (
                  <IosRow key={i} label={`${TOOL_LABELS[e.tool] ?? e.tool}${e.outcome === "ok" ? "" : e.outcome === "denied" ? " (not allowed)" : " (failed)"}`} value={formatRelative(e.at)} />
                ))}
              </IosSection>
            ) : null}
            <IosSection>
              <DestructiveRow
                label={`Disconnect ${g.name}`}
                confirm="Disconnect"
                message="It stops at once and has to ask again to come back."
                onConfirm={() => {
                  disconnect(g);
                  history.back();
                }}
              />
            </IosSection>
          </Subscreen>
        ))}
        <ReviewChangesCard />
        <ApiTokensCard />
        <WebhooksCard />
      </>
    );
  }

  return (
    <div className="space-y-5">
      <Card
        title="Use Folevi from other apps"
        description="AI apps like Claude, ChatGPT and Cursor can search and read your notes, add new ones and manage tasks through Folevi’s MCP server. You choose what each one may do and where when you connect it. It uses the app’s own AI, so no Folevi AI credits are spent."
      >
        <div className="flex max-w-xl items-center gap-2">
          <input readOnly value={address} aria-label="MCP server address" onFocus={(e) => e.target.select()} className="h-9 min-w-0 flex-1 ui-well rounded-chip px-3 font-mono text-[13px]" />
          <Button onClick={() => void navigator.clipboard.writeText(address).then(() => toast.show("Address copied"))}>
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
          <EmptyState size="inline" icon={Plug} title="No apps are connected" />
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
                        onClick={() => disconnect(g)}
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

      <ReviewChangesCard />
      <ApiTokensCard />
      <WebhooksCard />
    </div>
  );
}

/**
 * "Ask me before changes are made to existing notes": an app's addition to a note you already have waits in
 * Changes until you accept or reject it (convex/proposals.ts). New notes and tasks, and a task's own changes,
 * are still made at once.
 */
function ReviewChangesCard() {
  const { profile } = useAppState();
  const update = useMutation(api.users.updateProfile);
  const toast = useToast();
  const descId = useId();
  const on = profile.reviewAppEdits === true;
  const iphone = useIphoneLook();
  const turn = (next: boolean) =>
    void update({ reviewAppEdits: next }).then(
      () => toast.show(next ? "Apps will ask before changing your notes" : "Apps will change your notes directly"),
      (e) => toast.show(errorMessage(e), { tone: "error" }),
    );
  if (iphone)
    return (
      <IosSection
        header="Review changes"
        footer="When an app or a token adds to a note you already have, it waits in Changes for you to accept or reject, and the app is told so. New notes and tasks, and checking off or rescheduling a task, still happen at once. A change you don't answer expires after 14 days."
      >
        <SwitchRow label="Ask before changing notes" checked={on} onChange={turn} />
      </IosSection>
    );
  return (
    <Card title="Review changes">
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0 max-w-prose">
          <p className="text-sm font-medium text-heading">Ask me before changes are made to existing notes</p>
          <p id={descId} className="mt-0.5 text-sm text-muted">
            When an app or a token adds to a note you already have, it waits in Changes for you to accept or reject, and the app is told so. New notes and tasks, and checking off or rescheduling a task, still happen at once. A change you don’t answer expires after 14 days.
          </p>
        </div>
        <span className="mt-0.5 flex-none">
          <Switch
            checked={on}
            label="Ask me before changes are made to existing notes"
            describedBy={descId}
            onChange={turn}
          />
        </span>
      </div>
    </Card>
  );
}
