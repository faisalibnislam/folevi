"use client";

import { useId, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/lib/convex/api";
import { Button } from "@/components/ui/Button";
import { ActionDialog } from "./ActionDialog";
import { useAdmin } from "./AdminApp";
import { rolesFor } from "./permissions";
import { Badge, Callout, DataTable, DocTitle, LoadingRows, Mono, PageHeader, Panel, Switch, Time, inputCls, tdMid, th, thNum } from "./ui";

type Config = FunctionReturnType<typeof api.admin.configuration>;
type RateRule = Config["rateLimits"][number];

type Pending =
  | { kind: "flag"; key: string; enabled: boolean }
  | { kind: "template"; key: string; name: string; enabled: boolean }
  | { kind: "maintenance"; bannerMessage: string; readOnly: boolean }
  | { kind: "rate"; rule: RateRule }
  | { kind: "rateReset"; rule: RateRule };

export function formatWindow(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s % 3600 === 0) return `${s / 3600} h`;
  if (s % 60 === 0) return `${s / 60} min`;
  return `${s} s`;
}

export function ConfigurationView() {
  const admin = useAdmin();
  const config = useQuery(api.admin.configuration, {});
  const setFlag = useMutation(api.admin.setFlag);
  const setMaintenance = useMutation(api.admin.setMaintenance);
  const setRateLimit = useMutation(api.admin.setRateLimit);
  const setTemplate = useMutation(api.admin.setTemplateEnabled);
  const [pending, setPending] = useState<Pending | null>(null);
  const canEdit = admin.can("config.edit");
  const close = () => setPending(null);

  return (
    <>
      <DocTitle>Configuration</DocTitle>
      <PageHeader title="Configuration" description="Platform-wide switches. Every change needs a reason and takes effect immediately for everyone." />
      {!canEdit ? (
        <div className="mb-4">
          <Callout>Read-only for your role. {rolesFor("config.edit")}</Callout>
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Feature flags" description="Kill switches for product capabilities." flush>
          <ul className="divide-y divide-line">
            {config === undefined ? (
              <li className="px-4 py-6 text-sm text-muted">Loading…</li>
            ) : (
              config.flags.map((f) => {
                const descId = `flag-${f.key}-desc`;
                return (
                  <li key={f.key} className="flex items-start gap-4 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-[13.5px] font-medium">
                        <Mono>{f.key}</Mono>
                      </p>
                      <p id={descId} className="mt-1 text-[12.5px] text-muted">
                        {f.description} {f.updatedAt ? <>Changed <Time ts={f.updatedAt} />.</> : "Default setting."}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 pt-0.5">
                      <span className="w-7 text-right text-xs text-muted" aria-hidden>
                        {f.enabled ? "On" : "Off"}
                      </span>
                      <Switch
                        checked={f.enabled}
                        label={f.key}
                        describedBy={descId}
                        disabled={!canEdit}
                        onChange={(enabled) => setPending({ kind: "flag", key: f.key, enabled })}
                      />
                    </div>
                  </li>
                );
              })
            )}
          </ul>
        </Panel>

        <Panel title="Maintenance" description="A banner shown at the top of the product, and an optional read-only mode.">
          {config === undefined ? (
            <p className="text-sm text-muted">Loading…</p>
          ) : (
            <MaintenanceForm
              key={`${config.maintenance.bannerMessage ?? ""}|${String(config.maintenance.readOnly ?? false)}`}
              current={{ bannerMessage: config.maintenance.bannerMessage ?? "", readOnly: config.maintenance.readOnly ?? false }}
              disabled={!canEdit}
              onSave={(v) => setPending({ kind: "maintenance", ...v })}
            />
          )}
        </Panel>

        <Panel title="Rate limits" description="Fixed-window limits per subject. Overrides replace the built-in default until reset." flush className="xl:col-span-2">
          <DataTable caption="Rate limit rules" minWidth={640}>
            <thead>
              <tr>
                <th scope="col" className={th}>Rule</th>
                <th scope="col" className={thNum}>Limit</th>
                <th scope="col" className={thNum}>Window</th>
                <th scope="col" className={th}>Source</th>
                <th scope="col" className={th}>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {config === undefined ? (
                <LoadingRows colSpan={5} />
              ) : (
                config.rateLimits.map((r) => (
                  <tr key={r.name}>
                    <th scope="row" className={`${tdMid} text-left font-normal`}>
                      <Mono>{r.name}</Mono>
                    </th>
                    <td className={`${tdMid} text-right tabular-nums`}>{r.limit.toLocaleString()}</td>
                    <td className={`${tdMid} text-right tabular-nums`}>{formatWindow(r.windowMs)}</td>
                    <td className={tdMid}>{r.overridden ? <Badge tone="warning">Override</Badge> : <Badge>Default</Badge>}</td>
                    <td className={`${tdMid} text-right`}>
                      <span className="inline-flex gap-1.5">
                        <Button size="sm" disabled={!canEdit} onClick={() => setPending({ kind: "rate", rule: r })} aria-label={`Edit ${r.name} limit`}>
                          Edit…
                        </Button>
                        {r.overridden ? (
                          <Button size="sm" variant="quiet" disabled={!canEdit} onClick={() => setPending({ kind: "rateReset", rule: r })} aria-label={`Reset ${r.name} to default`}>
                            Reset to default…
                          </Button>
                        ) : null}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </DataTable>
        </Panel>

        <Panel title="Built-in templates" description="Starter templates offered when creating a document. Disabling hides a template for new documents only." flush className="xl:col-span-2">
          <ul className="grid divide-y divide-line md:grid-cols-2 md:divide-y-0">
            {config === undefined ? (
              <li className="px-4 py-6 text-sm text-muted">Loading…</li>
            ) : (
              config.templates.map((t) => {
                const descId = `tpl-${t.key}-desc`;
                return (
                  <li key={t.key} className="flex items-start gap-3 border-line px-4 py-3 md:border-b">
                    <span aria-hidden className="grid h-8 w-8 flex-none place-items-center rounded-[8px] border border-line bg-surface text-base">
                      {t.icon}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13.5px] font-medium">{t.name}</p>
                      <p id={descId} className="mt-0.5 text-[12.5px] text-muted">
                        {t.description}
                      </p>
                    </div>
                    <Switch
                      checked={t.enabled}
                      label={`${t.name} template`}
                      describedBy={descId}
                      disabled={!canEdit}
                      onChange={(enabled) => setPending({ kind: "template", key: t.key, name: t.name, enabled })}
                    />
                  </li>
                );
              })
            )}
          </ul>
        </Panel>
      </div>

      <ActionDialog
        open={pending?.kind === "flag"}
        onClose={close}
        title={pending?.kind === "flag" ? `${pending.enabled ? "Turn on" : "Turn off"} “${pending.key}”?` : ""}
        description="This changes the product for every user immediately."
        confirmLabel={pending?.kind === "flag" && !pending.enabled ? "Turn off" : "Turn on"}
        tone={pending?.kind === "flag" && !pending.enabled ? "danger" : "primary"}
        onSubmit={async ({ reason, meta }) => {
          if (pending?.kind !== "flag") return "";
          await setFlag({ key: pending.key, enabled: pending.enabled, reason, ...meta });
          return `${pending.key} is now ${pending.enabled ? "on" : "off"}`;
        }}
      />
      <ActionDialog
        open={pending?.kind === "template"}
        onClose={close}
        title={pending?.kind === "template" ? `${pending.enabled ? "Enable" : "Disable"} the “${pending.name}” template?` : ""}
        description="Existing documents made from it are not affected."
        confirmLabel={pending?.kind === "template" && !pending.enabled ? "Disable" : "Enable"}
        onSubmit={async ({ reason, meta }) => {
          if (pending?.kind !== "template") return "";
          await setTemplate({ key: pending.key, enabled: pending.enabled, reason, ...meta });
          return `Template ${pending.enabled ? "enabled" : "disabled"}`;
        }}
      />
      <ActionDialog
        open={pending?.kind === "maintenance"}
        onClose={close}
        title="Update maintenance settings?"
        description={
          pending?.kind === "maintenance" ? (
            <>
              {pending.bannerMessage ? <>Banner: “{pending.bannerMessage}”. </> : "No banner. "}
              {pending.readOnly ? "Read-only mode ON: people can't save changes to the server until it's turned off (edits stay on their devices)." : "Read-only mode off."}
            </>
          ) : null
        }
        confirmLabel="Apply"
        tone={pending?.kind === "maintenance" && pending.readOnly ? "danger" : "primary"}
        onSubmit={async ({ reason, meta }) => {
          if (pending?.kind !== "maintenance") return "";
          await setMaintenance({ bannerMessage: pending.bannerMessage, readOnly: pending.readOnly, reason, ...meta });
          return "Maintenance settings updated";
        }}
      />
      <ActionDialog
        open={pending?.kind === "rate"}
        onClose={close}
        title={pending?.kind === "rate" ? `Edit “${pending.rule.name}” rate limit` : ""}
        description="Requests above the limit within one window are rejected with “Too many requests”."
        confirmLabel="Save override"
        fields={
          pending?.kind === "rate"
            ? [
                { name: "limit", label: "Limit", type: "number", initial: String(pending.rule.limit), min: 1, max: 100_000, step: 1, suffix: "requests", validate: (v) => (Number.isInteger(Number(v)) ? null : "Use a whole number.") },
                { name: "window", label: "Window", type: "number", initial: String(pending.rule.windowMs / 1000), min: 1, max: 86_400, step: 1, suffix: "seconds", hint: "Between 1 second and 24 hours (86400)." },
              ]
            : []
        }
        onSubmit={async ({ reason, fields, meta }) => {
          if (pending?.kind !== "rate") return "";
          await setRateLimit({ name: pending.rule.name, limit: Number(fields.limit), windowMs: Math.round(Number(fields.window) * 1000), reason, ...meta });
          return `${pending.rule.name} limit saved`;
        }}
      />
      <ActionDialog
        open={pending?.kind === "rateReset"}
        onClose={close}
        title={pending?.kind === "rateReset" ? `Reset “${pending.rule.name}” to its default?` : ""}
        description="Removes the override so the built-in limit applies again."
        confirmLabel="Reset to default"
        onSubmit={async ({ reason, meta }) => {
          if (pending?.kind !== "rateReset") return "";
          await setRateLimit({ name: pending.rule.name, limit: null, reason, ...meta });
          return `${pending.rule.name} reset to default`;
        }}
      />
    </>
  );
}

function MaintenanceForm({ current, disabled, onSave }: { current: { bannerMessage: string; readOnly: boolean }; disabled: boolean; onSave: (v: { bannerMessage: string; readOnly: boolean }) => void }) {
  const uid = useId();
  const [message, setMessage] = useState(current.bannerMessage);
  const [readOnly, setReadOnly] = useState(current.readOnly);
  const dirty = message.trim() !== current.bannerMessage || readOnly !== current.readOnly;
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ bannerMessage: message.trim(), readOnly });
      }}
    >
      <div className="text-sm">
        <label htmlFor={`${uid}-msg`} className="mb-1 block font-medium">
          Banner message
        </label>
        <textarea
          id={`${uid}-msg`}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          maxLength={280}
          rows={3}
          disabled={disabled}
          aria-describedby={`${uid}-msg-hint`}
          placeholder="e.g. Scheduled maintenance Sunday 02:00–02:30 UTC."
          className={`${inputCls} h-auto py-2`}
        />
        <p id={`${uid}-msg-hint`} className="mt-1 text-xs text-muted">
          {message.length}/280 characters. Leave empty to hide the banner.
        </p>
      </div>
      <div className="flex items-start gap-3">
        <Switch checked={readOnly} onChange={setReadOnly} label="Read-only mode" describedBy={`${uid}-ro-hint`} disabled={disabled} />
        <div className="text-sm">
          <p className="font-medium" aria-hidden>
            Read-only mode
          </p>
          <p id={`${uid}-ro-hint`} className="text-xs text-muted">
            Blocks all writes from non-admins. Edits stay queued on people&apos;s devices and sync when it&apos;s turned off.
          </p>
        </div>
      </div>
      {current.readOnly ? <Callout tone="warning">Read-only mode is currently ON.</Callout> : null}
      <div>
        <Button type="submit" variant="primary" disabled={disabled || !dirty}>
          Save maintenance settings…
        </Button>
      </div>
    </form>
  );
}
