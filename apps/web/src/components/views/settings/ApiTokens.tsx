"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { Copy, KeyRound, Plus } from "lucide-react";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Dialog } from "@/components/ui/Dialog";
import { Select } from "@/components/ui/Select";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { formatRelative } from "@/lib/format";
import { Card } from "./Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { useNativeDevice } from "@/lib/nativeDevice";

const MAX_TOKENS = 20;

export const SCOPE_LABELS: { scope: string; label: string }[] = [
  { scope: "notes:read", label: "Search and read notes" },
  { scope: "notes:write", label: "Create notes and add to them" },
  { scope: "tasks:read", label: "See tasks" },
  { scope: "tasks:write", label: "Add, change and complete tasks" },
];

const EXPIRY: { value: string; label: string }[] = [
  { value: "30", label: "In 30 days" },
  { value: "90", label: "In 90 days" },
  { value: "365", label: "In a year" },
  { value: "never", label: "Never" },
];

function describeScopes(scopes: string[]): string {
  const has = (s: string) => scopes.includes(s);
  const notes = has("notes:read") ? (has("notes:write") ? "reads and adds to notes" : "reads notes") : has("notes:write") ? "adds notes" : null;
  const tasks = has("tasks:read") ? (has("tasks:write") ? "reads and changes tasks" : "reads tasks") : has("tasks:write") ? "adds and changes tasks" : null;
  const text = [notes, tasks].filter(Boolean).join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Settings → Connected apps: personal access tokens for the REST API (convex/apiTokens.ts). */
export function ApiTokensCard() {
  const all = useQuery(api.apiTokens.list, {});
  const here = useNativeDevice();
  // The 20-token limit counts the tokens you made; the iPhone and iPad app's own (one per device) are extra.
  const tokens = all?.filter((t) => !t.deviceId);
  const revoke = useMutation(api.apiTokens.revoke);
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const now = Date.now();

  return (
    <Card
      title="Personal access tokens"
      description={
        <>
          For your own scripts and automation tools (Zapier, n8n, Make) through Folevi’s REST API at <span className="font-mono text-[12.5px]">/api/v1</span>. A token works as you, only in the places
          and for the things you choose. Treat it like a password.{" "}
          <a className="underline underline-offset-2" href="https://folevi.com/docs/rest-api" target="_blank" rel="noreferrer">
            How to use the API
          </a>
        </>
      }
    >
      {all === undefined ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : all.length === 0 ? (
        <EmptyState size="inline" icon={KeyRound} title="No tokens yet" />
      ) : (
        <ul className="divide-y divide-line/70">
          {all.map((t) => {
            const expired = t.expiresAt !== null && t.expiresAt <= now;
            return (
              <li key={t.id} aria-label={t.name} className="flex flex-wrap items-start gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1 basis-64">
                  <p className="text-[14px] font-semibold text-heading">
                    {t.name} <span className="ml-1 font-mono text-[12px] font-normal text-muted">{t.hint}…</span>
                    {t.deviceId && t.deviceId === here?.id ? <span className="ml-2 rounded-chip bg-sunken px-1.5 py-0.5 text-[11.5px] font-medium text-muted">This device</span> : null}
                  </p>
                  <p className="mt-0.5 text-[13px] text-ink">
                    {t.deviceId ? "The app’s widgets, share sheet, Shortcuts and Spotlight: " : ""}
                    {t.deviceId ? describeScopes(t.scopes).toLowerCase() : describeScopes(t.scopes)} in {t.places.join(", ") || "no places"}
                  </p>
                  <p className="mt-0.5 text-[12.5px] text-muted">
                    Made {formatRelative(t.createdAt)} · {t.lastUsedAt ? `last used ${formatRelative(t.lastUsedAt)}` : "not used yet"} ·{" "}
                    {expired ? <span className="text-danger">expired</span> : t.expiresAt ? `expires ${new Date(t.expiresAt).toLocaleDateString()}` : "never expires"}
                  </p>
                </div>
                {confirming === t.id ? (
                  <div className="flex flex-none items-center gap-2">
                    <Button size="sm" onClick={() => setConfirming(null)}>
                      Keep
                    </Button>
                    <Button
                      size="sm"
                      variant="primary"
                      className="bg-danger"
                      onClick={() =>
                        void revoke({ tokenId: t.id }).then(
                          () => {
                            setConfirming(null);
                            toast.show(`“${t.name}” was revoked`);
                          },
                          (e) => toast.show(errorMessage(e), { tone: "error" }),
                        )
                      }
                    >
                      Revoke
                    </Button>
                  </div>
                ) : (
                  <Button size="sm" variant="quiet" className="flex-none text-danger" onClick={() => setConfirming(t.id)}>
                    Revoke…
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <div className="mt-4">
        <Button size="sm" onClick={() => setCreating(true)} disabled={tokens === undefined || tokens.length >= MAX_TOKENS} title={tokens && tokens.length >= MAX_TOKENS ? `You can have up to ${MAX_TOKENS} tokens.` : undefined}>
          <Plus size={14} aria-hidden /> New token
        </Button>
      </div>
      {creating ? <NewTokenDialog onClose={() => setCreating(false)} /> : null}
    </Card>
  );
}

function NewTokenDialog({ onClose }: { onClose: () => void }) {
  const { workspaces } = useAppState();
  const create = useMutation(api.apiTokens.create);
  const toast = useToast();
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<Set<string>>(new Set(["notes:read"]));
  const [personal, setPersonal] = useState(true);
  const [workspaceIds, setWorkspaceIds] = useState<string[]>([]);
  const [expiry, setExpiry] = useState("90");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await create({ name, scopes: [...scopes], personal, workspaceIds, expiresInDays: expiry === "never" ? null : Number(expiry) });
      setToken(r.token);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (token) {
    return (
      <Dialog
        open
        onClose={onClose}
        title="Copy your new token"
        description="This is the only time it’s shown. Folevi keeps only a fingerprint of it, so if you lose it, revoke it and make another."
        footer={
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        }
      >
        <div className="flex gap-2">
          <input readOnly value={token} aria-label="Your new token" onFocus={(e) => e.target.select()} className="h-9 min-w-0 flex-1 ui-well rounded-chip px-3 font-mono text-[13px]" />
          <Button onClick={() => void navigator.clipboard.writeText(token).then(() => toast.show("Token copied"))}>
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
      title="New personal access token"
      footer={
        <>
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={busy || !name.trim() || !scopes.size || (!personal && !workspaceIds.length)} onClick={() => void submit()}>
            Create token
          </Button>
        </>
      }
    >
      <label htmlFor="token-name" className="ui-caps mb-1.5 block">
        Name
      </label>
      <input id="token-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Zapier, my backup script…" className="h-9 w-full ui-input rounded-chip px-3 text-sm outline-none" />
      <fieldset className="mt-5">
        <legend className="ui-caps mb-2">What it can do</legend>
        <div className="space-y-2">
          {SCOPE_LABELS.map((s) => (
            <Checkbox
              key={s.scope}
              checked={scopes.has(s.scope)}
              onChange={(on) => {
                const next = new Set(scopes);
                if (on) next.add(s.scope);
                else next.delete(s.scope);
                setScopes(next);
              }}
            >
              <span className="text-[14px] text-ink">{s.label}</span>
            </Checkbox>
          ))}
        </div>
      </fieldset>
      <fieldset className="mt-5">
        <legend className="ui-caps mb-2">Where</legend>
        <div className="space-y-2">
          <Checkbox checked={personal} onChange={setPersonal}>
            <span className="text-[14px] text-ink">Personal</span>
          </Checkbox>
          {workspaces.map((w) => (
            <Checkbox key={w.id} checked={workspaceIds.includes(w.id)} onChange={(on) => setWorkspaceIds(on ? [...workspaceIds, w.id] : workspaceIds.filter((x) => x !== w.id))}>
              <span className="text-[14px] text-ink">{w.name}</span>
            </Checkbox>
          ))}
        </div>
      </fieldset>
      <label id="token-expiry-label" className="ui-caps mt-5 mb-1.5 block">
        Expires
      </label>
      <Select value={expiry} onChange={(e) => setExpiry(e.target.value)} aria-labelledby="token-expiry-label" className="h-9 w-full ui-input rounded-chip px-3">
        {EXPIRY.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
      {error ? (
        <p role="alert" className="mt-3 text-[13px] text-danger">
          {error}
        </p>
      ) : null}
    </Dialog>
  );
}
