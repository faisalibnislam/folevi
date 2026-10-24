"use client";

import { useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { Copy, Plus, Webhook } from "lucide-react";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Dialog } from "@/components/ui/Dialog";
import { Switch } from "@/components/ui/Switch";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { ageText, formatRelative } from "@/lib/format";
import { Card } from "./Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { useIphoneLook } from "@/lib/iphone";
import { ActionRow, DestructiveRow, IosRow, IosSection, IosText, Subscreen, SwitchRow, TextRow, useSettingsScreens } from "@/components/iphone/SettingsKit";
import { RowIcon } from "@/components/iphone/Grouped";
import { GlassTextButton } from "@/components/iphone/Glass";

const MAX_WEBHOOKS = 5;

export const EVENT_LABELS: { event: string; label: string }[] = [
  { event: "note.created", label: "A note is created" },
  { event: "note.updated", label: "A note is changed (at most once a minute per note)" },
  { event: "note.deleted", label: "A note is moved to Trash" },
  { event: "task.created", label: "A task is added" },
  { event: "task.completed", label: "A task is completed" },
  { event: "comment.created", label: "A comment is written" },
];

/** Settings → Connected apps: outbound webhooks (convex/webhooks.ts). */
export function WebhooksCard() {
  const hooks = useQuery(api.webhooks.list, {});
  const setEnabled = useMutation(api.webhooks.setEnabled);
  const remove = useMutation(api.webhooks.remove);
  const sendTest = useMutation(api.webhooks.sendTest);
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [logOpen, setLogOpen] = useState<string | null>(null);
  const fail = (e: unknown) => toast.show(errorMessage(e), { tone: "error" });
  const iphone = useIphoneLook();
  if (iphone) {
    const full = hooks !== undefined && hooks.length >= MAX_WEBHOOKS;
    const what = (h: NonNullable<typeof hooks>[number]) => `${h.events.length === EVENT_LABELS.length ? "Every event" : h.events.join(", ")} in ${h.places.join(", ") || "no places"}`;
    return (
      <>
        <IosSection header="Webhooks" footer="Folevi tells your server when notes, tasks and comments change, with a signed request to an https address. Events carry a note's title and link, never its content.">
          <IosRow icon={<RowIcon><Webhook /></RowIcon>} label="Webhooks" value={hooks === undefined ? "" : String(hooks.length)} screen="webhooks" />
          <IosRow label="How webhooks work" chevron onClick={() => window.open("https://folevi.com/docs/webhooks", "_blank", "noopener")} />
        </IosSection>
        <Subscreen id="webhooks" title="Webhooks">
          <IosSection label="Your webhooks">
            {hooks === undefined ? <IosText muted>Loading…</IosText> : null}
            {hooks?.length === 0 ? <IosText muted>No webhooks yet</IosText> : null}
            {hooks?.map((h) => (
              <IosRow key={h.id} label={<span className="font-mono text-subheadline">{h.url}</span>} description={what(h)} value={h.enabled ? "On" : "Off"} screen={`webhooks.${h.id}`} />
            ))}
          </IosSection>
          <IosSection footer={full ? `You can have up to ${MAX_WEBHOOKS} webhooks.` : undefined}>
            <IosRow label="Add webhook" disabled={hooks === undefined || full} screen="webhooks.new" />
          </IosSection>
        </Subscreen>
        {hooks?.map((h) => {
          const last = h.attempts[0];
          return (
            <Subscreen key={h.id} id={`webhooks.${h.id}`} title="Webhook">
              <IosSection
                footer={`${h.disabledAt ? `Turned off ${formatRelative(h.disabledAt)} because deliveries kept failing. ` : ""}${last ? `Last attempt ${formatRelative(last.at)}: ${last.ok ? `delivered (${last.statusCode})` : `failed (${last.statusCode ?? last.error})`}.` : "Nothing sent yet."}`}
              >
                <IosRow label="Address" description={<span className="font-mono">{h.url}</span>} />
                <IosRow label="Sends" description={what(h)} />
                <SwitchRow label="Send events" checked={h.enabled} onChange={(on) => void setEnabled({ webhookId: h.id, enabled: on }).catch(fail)} />
              </IosSection>
              <IosSection>
                <ActionRow label="Send test event" onClick={() => void sendTest({ webhookId: h.id }).then(() => toast.show("Test event sent"), fail)} />
                <IosRow label="Recent deliveries" value={String(h.attempts.length)} screen={`webhooks.${h.id}.log`} />
              </IosSection>
              <IosSection>
                <DestructiveRow label="Delete webhook" confirm="Delete" message="Folevi stops sending events to this address." onConfirm={() => void remove({ webhookId: h.id }).then(() => history.back(), fail)} />
              </IosSection>
              <Subscreen id={`webhooks.${h.id}.log`} title="Recent deliveries">
                <IosSection label={`Recent deliveries to ${h.url}`}>
                  {h.attempts.length ? (
                    h.attempts.map((a, i) => (
                      <IosRow
                        key={i}
                        label={<span className="font-mono text-subheadline">{a.type}</span>}
                        description={<span className={a.ok ? undefined : "text-danger"}>{`${a.ok ? `${a.statusCode} delivered` : a.statusCode ? `${a.statusCode}${a.error ? `, ${a.error}` : ""}` : (a.error ?? "failed")} · ${a.durationMs} ms`}</span>}
                        value={ageText(a.at)}
                      />
                    ))
                  ) : (
                    <IosText muted>No deliveries yet. Send a test event to try it.</IosText>
                  )}
                </IosSection>
              </Subscreen>
            </Subscreen>
          );
        })}
        <IphoneNewWebhook />
      </>
    );
  }

  return (
    <Card
      title="Webhooks"
      description={
        <>
          Folevi tells your server when notes, tasks and comments change, with a signed request to an https address. Events carry a note’s title and link, never its content.{" "}
          <a className="underline underline-offset-2" href="https://folevi.com/docs/webhooks" target="_blank" rel="noreferrer">
            How webhooks work
          </a>
        </>
      }
    >
      {hooks === undefined ? (
        <p className="text-subheadline text-muted">Loading…</p>
      ) : hooks.length === 0 ? (
        <EmptyState size="inline" icon={Webhook} title="No webhooks yet" />
      ) : (
        <ul className="divide-y divide-line/70">
          {hooks.map((h) => {
            const last = h.attempts[0];
            return (
              <li key={h.id} aria-label={h.url} className="py-4 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
                  <div className="min-w-0 flex-1 basis-64">
                    <p className="truncate font-mono text-subheadline text-heading" title={h.url}>
                      {h.url}
                    </p>
                    <p className="mt-1 text-subheadline text-ink">
                      {h.events.length === EVENT_LABELS.length ? "Every event" : h.events.join(", ")} in {h.places.join(", ") || "no places"}
                    </p>
                    <p className="mt-0.5 text-subheadline text-muted">
                      {h.disabledAt ? <span className="text-danger">Turned off {formatRelative(h.disabledAt)} because deliveries kept failing. </span> : null}
                      {last ? `Last attempt ${formatRelative(last.at)}: ${last.ok ? `delivered (${last.statusCode})` : `failed (${last.statusCode ?? last.error})`}` : "Nothing sent yet"}
                    </p>
                  </div>
                  <div className="flex flex-none items-center gap-2">
                    <span className="text-subheadline text-muted">{h.enabled ? "On" : "Off"}</span>
                    <Switch checked={h.enabled} onChange={(on) => void setEnabled({ webhookId: h.id, enabled: on }).catch(fail)} label={`Send events to ${h.url}`} />
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Button size="sm" onClick={() => void sendTest({ webhookId: h.id }).then(() => toast.show("Test event sent"), fail)}>
                    Send test event
                  </Button>
                  <Button size="sm" variant="quiet" aria-expanded={logOpen === h.id} onClick={() => setLogOpen(logOpen === h.id ? null : h.id)}>
                    {logOpen === h.id ? "Hide deliveries" : "Recent deliveries"}
                  </Button>
                  {confirming === h.id ? (
                    <>
                      <Button size="sm" onClick={() => setConfirming(null)}>
                        Keep
                      </Button>
                      <Button size="sm" variant="primary" className="bg-danger" onClick={() => void remove({ webhookId: h.id }).then(() => setConfirming(null), fail)}>
                        Delete
                      </Button>
                    </>
                  ) : (
                    <Button size="sm" variant="quiet" className="text-danger" onClick={() => setConfirming(h.id)}>
                      Delete…
                    </Button>
                  )}
                </div>
                {logOpen === h.id ? (
                  h.attempts.length ? (
                    <table className="mt-3 w-full text-left text-subheadline" aria-label={`Recent deliveries to ${h.url}`}>
                      <thead className="text-muted">
                        <tr>
                          <th className="py-1 pr-3 font-medium">When</th>
                          <th className="py-1 pr-3 font-medium">Event</th>
                          <th className="py-1 font-medium">Result</th>
                        </tr>
                      </thead>
                      <tbody>
                        {h.attempts.map((a, i) => (
                          <tr key={i} className="border-t border-line/60">
                            <td className="py-1 pr-3 text-muted">{ageText(a.at)}</td>
                            <td className="py-1 pr-3 font-mono text-footnote">{a.type}</td>
                            <td className={`py-1 ${a.ok ? "text-ink" : "text-danger"}`}>
                              {a.ok ? `${a.statusCode} delivered` : a.statusCode ? `${a.statusCode}${a.error ? `, ${a.error}` : ""}` : (a.error ?? "failed")} · {a.durationMs} ms
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p className="mt-3 text-subheadline text-muted">No deliveries yet. Send a test event to try it.</p>
                  )
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      <div className="mt-4">
        <Button size="sm" onClick={() => setAdding(true)} disabled={hooks === undefined || hooks.length >= MAX_WEBHOOKS} title={hooks && hooks.length >= MAX_WEBHOOKS ? `You can have up to ${MAX_WEBHOOKS} webhooks.` : undefined}>
          <Plus size={14} aria-hidden /> Add webhook
        </Button>
      </div>
      {adding ? <NewWebhookDialog onClose={() => setAdding(false)} /> : null}
    </Card>
  );
}

function NewWebhookDialog({ onClose }: { onClose: () => void }) {
  const { workspaces } = useAppState();
  const create = useMutation(api.webhooks.create);
  const toast = useToast();
  const [url, setUrl] = useState("https://");
  const [events, setEvents] = useState<Set<string>>(new Set(["note.created", "task.completed"]));
  const [personal, setPersonal] = useState(true);
  const [workspaceIds, setWorkspaceIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await create({ url, events: [...events], personal, workspaceIds });
      setSecret(r.secret);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (secret) {
    return (
      <Dialog
        open
        onClose={onClose}
        title="Copy the signing secret"
        description="Your server uses it to check that a request really came from Folevi (the Folevi-Signature header). It’s shown only now."
        footer={
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        }
      >
        <div className="flex gap-2">
          <input readOnly value={secret} aria-label="Signing secret" onFocus={(e) => e.target.select()} className="h-9 min-w-0 flex-1 ui-well rounded-chip px-3 font-mono text-subheadline" />
          <Button onClick={() => void navigator.clipboard.writeText(secret).then(() => toast.show("Secret copied"))}>
            <Copy size={13} aria-hidden /> Copy
          </Button>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Add a webhook"
      footer={
        <>
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={busy || !/^https:\/\/./.test(url.trim()) || !events.size || (!personal && !workspaceIds.length)} onClick={() => void submit()}>
            Add webhook
          </Button>
        </>
      }
    >
      <label htmlFor="webhook-url" className="ui-caps mb-1.5 block">
        Endpoint address
      </label>
      <input id="webhook-url" autoFocus type="url" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} maxLength={2000} className="h-9 w-full ui-input rounded-chip px-3 font-mono text-callout outline-none" />
      <fieldset className="mt-5">
        <legend className="ui-caps mb-2">Events</legend>
        <div className="space-y-2">
          {EVENT_LABELS.map((e) => (
            <Checkbox
              key={e.event}
              checked={events.has(e.event)}
              onChange={(on) => {
                const next = new Set(events);
                if (on) next.add(e.event);
                else next.delete(e.event);
                setEvents(next);
              }}
            >
              <span className="text-body text-ink">{e.label}</span>
            </Checkbox>
          ))}
        </div>
      </fieldset>
      <fieldset className="mt-5">
        <legend className="ui-caps mb-2">Where</legend>
        <div className="space-y-2">
          <Checkbox checked={personal} onChange={setPersonal}>
            <span className="text-body text-ink">Personal</span>
          </Checkbox>
          {workspaces.map((w) => (
            <Checkbox key={w.id} checked={workspaceIds.includes(w.id)} onChange={(on) => setWorkspaceIds(on ? [...workspaceIds, w.id] : workspaceIds.filter((x) => x !== w.id))}>
              <span className="text-body text-ink">{w.name}</span>
            </Checkbox>
          ))}
        </div>
      </fieldset>
      {error ? (
        <p role="alert" className="mt-3 text-subheadline text-danger">
          {error}
        </p>
      ) : null}
    </Dialog>
  );
}

/** Adding a webhook in the iPhone app: a screen with Add in its bar, then the signing secret once, with Copy. */
function IphoneNewWebhook() {
  const { workspaces } = useAppState();
  const create = useMutation(api.webhooks.create);
  const toast = useToast();
  const screens = useSettingsScreens();
  const [url, setUrl] = useState("https://");
  const [events, setEvents] = useState<Set<string>>(new Set(["note.created", "task.completed"]));
  const [personal, setPersonal] = useState(true);
  const [workspaceIds, setWorkspaceIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  // Leaving the screen starts the next one afresh.
  const open = screens?.screen === "webhooks.new";
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !open) {
      setUrl("https://");
      setEvents(new Set(["note.created", "task.completed"]));
      setPersonal(true);
      setWorkspaceIds([]);
      setError(null);
      setSecret(null);
    }
    wasOpen.current = open;
  }, [open]);
  const ready = !busy && /^https:\/\/./.test(url.trim()) && events.size > 0 && (personal || workspaceIds.length > 0);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await create({ url, events: [...events], personal, workspaceIds });
      setSecret(r.secret);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Subscreen
      id="webhooks.new"
      title={secret ? "Signing secret" : "Add webhook"}
      trailing={
        secret ? (
          <GlassTextButton strong onClick={() => screens?.back()}>
            Done
          </GlassTextButton>
        ) : (
          <GlassTextButton strong disabled={!ready} onClick={() => void submit()}>
            {busy ? "Adding…" : "Add"}
          </GlassTextButton>
        )
      }
    >
      {secret ? (
        <IosSection footer="Your server uses it to check that a request really came from Folevi (the Folevi-Signature header). It's shown only now.">
          <IosRow label="Secret" description={<span className="select-all font-mono">{secret}</span>} />
          <ActionRow label="Copy secret" onClick={() => void navigator.clipboard.writeText(secret).then(() => toast.show("Secret copied"))} />
        </IosSection>
      ) : (
        <>
          {error ? <IosSection><IosText><span role="alert" className="text-danger">{error}</span></IosText></IosSection> : null}
          <IosSection>
            <TextRow stacked label="Endpoint address" type="url" inputMode="url" value={url} onChange={setUrl} maxLength={2000} />
          </IosSection>
          <IosSection header="Events" role="group" label="Events">
            {EVENT_LABELS.map((e) => (
              <IosRow
                key={e.event}
                label={e.label}
                checked={events.has(e.event)}
                onClick={() => {
                  const next = new Set(events);
                  if (next.has(e.event)) next.delete(e.event);
                  else next.add(e.event);
                  setEvents(next);
                }}
              />
            ))}
          </IosSection>
          <IosSection header="Where" role="group" label="Where">
            <IosRow label="Personal" checked={personal} onClick={() => setPersonal(!personal)} />
            {workspaces.map((w) => (
              <IosRow key={w.id} label={w.name} checked={workspaceIds.includes(w.id)} onClick={() => setWorkspaceIds(workspaceIds.includes(w.id) ? workspaceIds.filter((x) => x !== w.id) : [...workspaceIds, w.id])} />
            ))}
          </IosSection>
        </>
      )}
    </Subscreen>
  );
}
