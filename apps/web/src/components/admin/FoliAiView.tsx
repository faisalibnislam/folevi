"use client";

// Admin > Foli AI (convex/aiConfig.ts): the providers' keys, each provider's fast, main and heavy models, and
// which provider each feature uses. Keys go to the server once and are never shown again: the page sees
// only whether one is set and its last four characters. Every change needs a reason and is audited.
import { useState } from "react";
import { useAction, useMutation } from "convex/react";
import { useQuery } from "@/lib/convex/queries";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/lib/convex/api";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { ActionDialog } from "./ActionDialog";
import { useAdmin } from "./AdminApp";
import { rolesFor } from "./permissions";
import { Badge, Callout, DataTable, DocTitle, LoadingRows, Mono, PageHeader, Panel, Time, selectCls, tdMid, th } from "./ui";

type Overview = FunctionReturnType<typeof api.aiConfig.overview>;
type Provider = Overview["providers"][number];
type ProviderId = Provider["id"];
type Feature = Overview["features"][number];

type Pending =
  | { kind: "key"; provider: Provider }
  | { kind: "removeKey"; provider: Provider }
  | { kind: "models"; provider: Provider }
  | { kind: "route"; feature: Feature; to: ProviderId };

const SLOT_LABELS = { fast: "Fast", main: "Main", heavy: "Heavy" } as const;
const SLOT_NOTES = {
  fast: "Titles, search terms, short rewrites.",
  main: "Normal answers.",
  heavy: "The agent's tools, web search, files and images, very long notes.",
} as const;

const money = (perMillion: number) => `$${perMillion < 1 ? perMillion.toFixed(2) : perMillion.toFixed(perMillion % 1 ? 2 : 0)}`;

function KeyBadge({ p }: { p: Provider }) {
  if (p.key.source === "saved") return <Badge tone="success">Saved, ends in {p.key.last4}</Badge>;
  if (p.key.source === "environment") return <Badge tone="success">From {p.envVar}</Badge>;
  return <Badge tone="warning">Not set</Badge>;
}

export function FoliAiView() {
  const admin = useAdmin();
  const data = useQuery(api.aiConfig.overview, {});
  const setKey = useAction(api.aiConfig.setKey);
  const removeKey = useMutation(api.aiConfig.removeKey);
  const setModels = useMutation(api.aiConfig.setModels);
  const setRoute = useMutation(api.aiConfig.setRoute);
  const [pending, setPending] = useState<Pending | null>(null);
  const close = () => setPending(null);
  const canEdit = admin.can("ai.edit");
  const canKeys = admin.can("ai.keys");
  const byId = (id: ProviderId) => data?.providers.find((p) => p.id === id);
  const keyless = data ? data.features.filter((f) => byId(f.provider)?.key.source === null) : [];

  return (
    <>
      <DocTitle>Foli AI</DocTitle>
      <PageHeader
        title="Foli AI"
        description="Which AI provider each feature uses, the models it runs on, and the providers' keys. Changes apply to the next request; every change needs a reason."
      />
      {!canEdit ? (
        <div className="mb-4">
          <Callout>Read-only for your role. {rolesFor("ai.edit")}</Callout>
        </div>
      ) : null}
      {keyless.length ? (
        <div className="mb-4">
          <Callout tone="warning" title="Some features have no key">
            {keyless.map((f) => f.label).join(", ")} {keyless.length === 1 ? "uses a provider" : "use providers"} without a key, so {keyless.length === 1 ? "it shows" : "they show"} “Foli AI isn&apos;t set up” to people. There is no fallback to another provider.
          </Callout>
        </div>
      ) : null}

      <div className="grid gap-4">
        <Panel
          title="Features"
          description="Each feature uses one provider. Transcribing recordings and search embeddings always use Gemini. Credits follow each provider's real price."
          flush
        >
          <DataTable caption="Provider per feature" minWidth={640}>
            <thead>
              <tr>
                <th scope="col" className={th}>
                  Feature
                </th>
                <th scope="col" className={th}>
                  Provider
                </th>
              </tr>
            </thead>
            <tbody>
              {data === undefined ? (
                <LoadingRows colSpan={2} />
              ) : (
                <>
                  {data.features.map((f) => (
                    <tr key={f.feature}>
                      <th scope="row" className={`${tdMid} text-left font-normal`}>
                        <p className="font-medium text-heading">{f.label}</p>
                        <p className="text-footnote text-muted">{f.note}</p>
                      </th>
                      <td className={`${tdMid} w-64`}>
                        <Select
                          aria-label={`Provider for ${f.label}`}
                          value={f.provider}
                          disabled={!canEdit}
                          className={`${selectCls} w-56`}
                          onChange={(e) => {
                            const to = e.target.value as ProviderId;
                            if (to !== f.provider) setPending({ kind: "route", feature: f, to });
                          }}
                        >
                          {data.providers.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.label}
                            </option>
                          ))}
                        </Select>
                      </td>
                    </tr>
                  ))}
                  {[
                    { label: "Transcription", note: "Recordings to text (reads audio)." },
                    { label: "Search embeddings", note: "Search by meaning across notes." },
                  ].map((f) => (
                    <tr key={f.label}>
                      <th scope="row" className={`${tdMid} text-left font-normal`}>
                        <p className="font-medium text-heading">{f.label}</p>
                        <p className="text-footnote text-muted">{f.note}</p>
                      </th>
                      <td className={tdMid}>
                        <Badge>Google Gemini, always</Badge>
                      </td>
                    </tr>
                  ))}
                </>
              )}
            </tbody>
          </DataTable>
        </Panel>

        <Panel title="Models" description="Three models per provider. A request uses Fast when it asks for speed, Heavy for tools, web search, files or very long notes, and Main otherwise." flush>
          <DataTable caption="Models per provider" minWidth={760}>
            <thead>
              <tr>
                <th scope="col" className={th}>
                  Provider
                </th>
                {(["fast", "main", "heavy"] as const).map((slot) => (
                  <th key={slot} scope="col" className={th} title={SLOT_NOTES[slot]}>
                    {SLOT_LABELS[slot]}
                  </th>
                ))}
                <th scope="col" className={th}>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data === undefined ? (
                <LoadingRows colSpan={5} />
              ) : (
                data.providers.map((p) => (
                  <tr key={p.id}>
                    <th scope="row" className={`${tdMid} text-left font-medium text-heading`}>
                      {p.label}
                    </th>
                    {(["fast", "main", "heavy"] as const).map((slot) => {
                      const info = p.modelInfo[slot]!;
                      return (
                        <td key={slot} className={tdMid}>
                          <Mono>{p.models[slot]}</Mono>
                          <p className="text-footnote text-muted">
                            {money(info.inputPerMillion)} in / {money(info.outputPerMillion)} out per 1M
                            {slot === "heavy" && !info.searchGrounding ? ", can't search the web" : ""}
                          </p>
                        </td>
                      );
                    })}
                    <td className={`${tdMid} text-right`}>
                      <Button disabled={!canEdit} onClick={() => setPending({ kind: "models", provider: p })} aria-label={`Edit ${p.label} models`}>
                        Edit…
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </DataTable>
        </Panel>

        <Panel
          title="Keys"
          description="A saved key is encrypted on the server and never shown again, only its last four characters. Without a saved key, the provider's environment variable is used."
          flush
        >
          {!canKeys ? (
            <div className="px-4 pt-3">
              <Callout>Only the owner can add or remove keys. {rolesFor("ai.keys")}</Callout>
            </div>
          ) : null}
          <DataTable caption="Provider keys" minWidth={640}>
            <thead>
              <tr>
                <th scope="col" className={th}>
                  Provider
                </th>
                <th scope="col" className={th}>
                  Key
                </th>
                <th scope="col" className={th}>
                  Saved
                </th>
                <th scope="col" className={th}>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data === undefined ? (
                <LoadingRows colSpan={4} />
              ) : (
                data.providers.map((p) => (
                  <tr key={p.id}>
                    <th scope="row" className={`${tdMid} text-left font-medium text-heading`}>
                      {p.label}
                    </th>
                    <td className={tdMid}>
                      <KeyBadge p={p} />
                    </td>
                    <td className={tdMid}>{p.key.updatedAt ? <Time ts={p.key.updatedAt} /> : <span className="text-muted">Not saved here</span>}</td>
                    <td className={`${tdMid} text-right`}>
                      <span className="inline-flex gap-1.5">
                        <Button disabled={!canKeys} onClick={() => setPending({ kind: "key", provider: p })} aria-label={`${p.key.source === "saved" ? "Replace" : "Add"} the ${p.label} key`}>
                          {p.key.source === "saved" ? "Replace…" : "Add key…"}
                        </Button>
                        {p.key.source === "saved" ? (
                          <Button variant="ghost" disabled={!canKeys} onClick={() => setPending({ kind: "removeKey", provider: p })} aria-label={`Remove the saved ${p.label} key`}>
                            Remove…
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
      </div>

      <ActionDialog
        open={pending?.kind === "route"}
        onClose={close}
        title={pending?.kind === "route" ? `Use ${byId(pending.to)?.label} for ${pending.feature.label}?` : ""}
        description={
          pending?.kind === "route" ? (
            <>
              The next {pending.feature.label.toLowerCase()} requests go to {byId(pending.to)?.label} and are charged at its prices.
              {byId(pending.to)?.key.source === null ? " This provider has no key yet, so the feature will stop working until one is added." : ""}
            </>
          ) : null
        }
        confirmLabel="Switch provider"
        tone={pending?.kind === "route" && byId(pending.to)?.key.source === null ? "danger" : "primary"}
        onSubmit={async ({ reason, meta }) => {
          if (pending?.kind !== "route") return "";
          await setRoute({ feature: pending.feature.feature, provider: pending.to, reason, ...meta });
          return `${pending.feature.label} now uses ${byId(pending.to)?.label}`;
        }}
      />
      <ActionDialog
        open={pending?.kind === "models"}
        onClose={close}
        title={pending?.kind === "models" ? `${pending.provider.label} models` : ""}
        description="Model ids as the provider writes them. A model of another provider is refused."
        confirmLabel="Save models"
        fields={
          pending?.kind === "models"
            ? (["fast", "main", "heavy"] as const).map((slot) => ({
                name: slot,
                label: SLOT_LABELS[slot],
                type: "text" as const,
                initial: pending.provider.models[slot],
                maxLength: 80,
                hint: (
                  <>
                    {SLOT_NOTES[slot]} Default <Mono>{pending.provider.defaults[slot]}</Mono>. Known: {pending.provider.suggestions.map((s) => s.id).join(", ")}.
                  </>
                ),
                validate: (v: string) => (/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/.test(v.trim()) ? null : "Use the model id, like the ones listed."),
              }))
            : []
        }
        onSubmit={async ({ reason, fields, meta }) => {
          if (pending?.kind !== "models") return "";
          await setModels({ provider: pending.provider.id, models: { fast: fields.fast!.trim(), main: fields.main!.trim(), heavy: fields.heavy!.trim() }, reason, ...meta });
          return `${pending.provider.label} models saved`;
        }}
      />
      <ActionDialog
        open={pending?.kind === "key"}
        onClose={close}
        title={pending?.kind === "key" ? `${pending.provider.key.source === "saved" ? "Replace" : "Add"} the ${pending.provider.label} key` : ""}
        description="The key is encrypted on the server and can't be read back. Features set to this provider use it from their next request."
        confirmLabel="Save key"
        fields={
          pending?.kind === "key"
            ? [
                {
                  name: "key",
                  label: "API key",
                  type: "secret",
                  initial: "",
                  maxLength: 512,
                  validate: (v: string) => (v.trim().length >= 20 && !/\s/.test(v.trim()) ? null : "Paste the whole key, without spaces."),
                },
              ]
            : []
        }
        onSubmit={async ({ reason, fields, meta }) => {
          if (pending?.kind !== "key") return "";
          const { last4 } = await setKey({ provider: pending.provider.id, key: fields.key!, reason, ...meta });
          return `${pending.provider.label} key saved (ends in ${last4})`;
        }}
      />
      <ActionDialog
        open={pending?.kind === "removeKey"}
        onClose={close}
        title={pending?.kind === "removeKey" ? `Remove the saved ${pending.provider.label} key?` : ""}
        description={
          pending?.kind === "removeKey"
            ? `Features set to ${pending.provider.label} then use ${pending.provider.envVar} if it's set, and stop working if it isn't.`
            : null
        }
        confirmLabel="Remove key"
        tone="danger"
        onSubmit={async ({ reason, meta }) => {
          if (pending?.kind !== "removeKey") return "";
          await removeKey({ provider: pending.provider.id, reason, ...meta });
          return `${pending.provider.label} key removed`;
        }}
      />
    </>
  );
}
