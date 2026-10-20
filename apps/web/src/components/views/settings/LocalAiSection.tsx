"use client";

// Settings > AI in local mode (WP11): Foli AI on or off, Apple's model on this Mac, the person's own OpenAI,
// Anthropic and Google keys (added, tested and removed here, kept in the Keychain and never shown again, not
// even to this page), which model answers, and the settings that still mean something on a device
// (conversations, memory). Requests go from this Mac straight to the provider; nothing goes through Folevi.
import { useId, useState } from "react";
import { useMutation } from "convex/react";
import { Check, KeyRound, Laptop, Loader2 } from "lucide-react";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { useLocalAi } from "@/lib/mode";
import { KEY_PROVIDERS, PROVIDERS, PROVIDER_ORDER, modelLabel } from "@/lib/local/ai/catalog";
import { localAiHost, refreshLocalAi, setLocalAiChoice, usable, type LocalAiState } from "@/lib/local/ai/state";
import type { AiKeyProvider, AiProviderId, OnDeviceStatus } from "@/lib/shell/types";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { Switch } from "@/components/ui/Switch";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { Card } from "./Card";
import { AiMemoryCard } from "./AiMemory";

/** What Apple Intelligence's state means for the person, in a sentence. */
export const ON_DEVICE_COPY: Record<OnDeviceStatus, string> = {
  available: "Apple Intelligence is on. Foli AI can run on this Mac, and nothing leaves it.",
  notEnabled: "Turn on Apple Intelligence in System Settings to use Foli AI on this Mac without a key.",
  notReady: "Apple Intelligence is still getting ready on this Mac. Try again in a little while.",
  notSupported: "This Mac can't run Apple Intelligence. Add one of your own keys below to use Foli AI.",
  unknown: "Folevi couldn't check Apple Intelligence on this Mac. Add one of your own keys below to use Foli AI.",
};

function onDeviceStatus(state: LocalAiState | null): OnDeviceStatus {
  if (!state?.caps) return "unknown";
  if (state.caps.onDevice) return "available";
  return state.caps.onDeviceStatus && state.caps.onDeviceStatus !== "available" ? state.caps.onDeviceStatus : "unknown";
}

/** A key as people paste it: no spaces inside, a plausible length. The provider decides for real (Test). */
export function cleanKey(raw: string): string | null {
  const key = raw.trim();
  return /^[\x21-\x7e]{20,400}$/.test(key) ? key : null;
}

function OnOffCard() {
  const { profile } = useAppState();
  const on = (profile as { aiEnabled?: boolean }).aiEnabled !== false;
  const update = useMutation(api.users.updateProfile);
  const toast = useToast();
  const descId = useId();
  return (
    <Card title="Foli AI">
      <div className="flex items-start justify-between gap-6">
        <p id={descId} className="max-w-prose text-sm text-muted">
          Foli AI helps you write, answers from your notes and sums them up. In a library on your devices it runs on Apple Intelligence on this Mac, or on your own key with OpenAI, Anthropic or Google, called straight from this Mac. Nothing goes through Folevi, and nothing is sent while it&apos;s off.
        </p>
        <Switch
          checked={on}
          label="Foli AI"
          describedBy={descId}
          onChange={(next) =>
            void update({ aiEnabled: next }).then(
              () => toast.show(next ? "Foli AI turned on" : "Foli AI turned off"),
              (e) => toast.show(errorMessage(e), { tone: "error" }),
            )
          }
        />
      </div>
    </Card>
  );
}

function OnDeviceCard({ state }: { state: LocalAiState | null }) {
  const status = onDeviceStatus(state);
  return (
    <Card title="On this Mac">
      <div className="flex items-start gap-3" data-testid="local-ai-on-device" data-status={status}>
        <span className="mt-0.5 grid h-8 w-8 flex-none place-items-center rounded-chip bg-[var(--glass-hover)] text-muted shadow-[inset_0_0_0_1px_var(--glass-border)]" aria-hidden>
          <Laptop size={16} />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium text-heading">{status === "available" ? "Apple Intelligence" : "Apple Intelligence isn't available"}</p>
          <p className="mt-0.5 text-sm text-muted">{ON_DEVICE_COPY[status]}</p>
          {status === "available" ? <p className="mt-1 text-sm text-muted">It&apos;s a small model: it does writing help, questions about your notes, chats and the smaller block tools. Long notes are cut to what it can read, and wireframes and flowcharts need your own key.</p> : null}
        </div>
      </div>
    </Card>
  );
}

function KeyRow({ provider, stored, busy, onBusy }: { provider: AiKeyProvider; stored: boolean; busy: boolean; onBusy: (b: boolean) => void }) {
  const info = PROVIDERS[provider];
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [value, setValue] = useState("");
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const inputId = useId();
  const host = localAiHost();
  const secrets = host.secrets;
  const save = async () => {
    const key = cleanKey(value);
    if (!key) {
      setResult({ ok: false, text: `That doesn't look like a whole ${info.label} key. Paste it again.` });
      return;
    }
    if (!secrets || !info.secret) return;
    onBusy(true);
    try {
      await secrets.set(info.secret, key);
      setValue("");
      setAdding(false);
      setResult(null);
      await refreshLocalAi();
      toast.show(`${info.label} key added`, { tone: "success" });
    } catch (e) {
      toast.show(errorMessage(e), { tone: "error" });
    } finally {
      onBusy(false);
    }
  };
  const remove = async () => {
    if (!secrets || !info.secret) return;
    onBusy(true);
    try {
      await secrets.delete(info.secret);
      setResult(null);
      await refreshLocalAi();
      toast.show(`${info.label} key removed`);
    } catch (e) {
      toast.show(errorMessage(e), { tone: "error" });
    } finally {
      onBusy(false);
    }
  };
  const test = async () => {
    if (!host.ai?.testKey) return;
    onBusy(true);
    setResult(null);
    try {
      const r = await host.ai.testKey(provider);
      setResult(r.ok ? { ok: true, text: `Your ${info.label} key works.` } : { ok: false, text: r.error });
    } catch (e) {
      setResult({ ok: false, text: errorMessage(e) });
    } finally {
      onBusy(false);
    }
  };
  return (
    <div className="py-3.5 first:pt-0 last:pb-0" data-testid={`local-ai-key-${provider}`} data-stored={stored ? "true" : "false"}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-medium text-heading">
            <KeyRound size={14} className="text-muted" aria-hidden />
            {info.label}
          </p>
          <p className="mt-0.5 text-sm text-muted">{stored ? "Key added. It's kept in this Mac's Keychain and can't be shown again." : "No key."}</p>
        </div>
        <div className="flex flex-none items-center gap-2">
          {stored ? (
            <>
              {host.ai?.testKey ? (
                <Button size="sm" onClick={() => void test()} disabled={busy}>
                  Test
                </Button>
              ) : null}
              <Button size="sm" variant="ghost" onClick={() => void remove()} disabled={busy}>
                Remove
              </Button>
            </>
          ) : !adding ? (
            <Button size="sm" onClick={() => setAdding(true)} disabled={busy || !secrets}>
              Add key…
            </Button>
          ) : null}
        </div>
      </div>
      {adding && !stored ? (
        <form
          className="mt-3 flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label htmlFor={inputId} className="sr-only">
            {info.label} key
          </label>
          <input
            id={inputId}
            type="password"
            autoComplete="off"
            spellCheck={false}
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={`Paste your ${info.label} key`}
            className="ui-input h-9 min-w-0 flex-1 rounded-chip px-3 text-sm"
          />
          <Button size="sm" variant="primary" type="submit" disabled={busy || !value.trim()}>
            Save
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setAdding(false);
              setValue("");
              setResult(null);
            }}
          >
            Cancel
          </Button>
          {info.keyUrl ? (
            <a href={info.keyUrl} target="_blank" rel="noreferrer" className="w-full text-[13px] text-muted underline underline-offset-2">
              Get a key from {info.label}
            </a>
          ) : null}
        </form>
      ) : null}
      {result ? (
        <p role="status" className={`mt-2 flex items-center gap-1.5 text-[13px] ${result.ok ? "text-heading" : "text-muted"}`}>
          {result.ok ? <Check size={14} aria-hidden /> : null}
          {result.text}
        </p>
      ) : null}
    </div>
  );
}

function KeysCard({ state }: { state: LocalAiState | null }) {
  const [busy, setBusy] = useState(false);
  return (
    <Card title="Your own keys" description="With your own key, Foli AI uses that provider's models, called straight from this Mac under your account with them. Your keys stay in this Mac's Keychain: Folevi never sees them.">
      <div className="divide-y divide-line/70">
        {KEY_PROVIDERS.map((p) => (
          <KeyRow key={p} provider={p} stored={Boolean(state?.caps?.keys[PROVIDERS[p].secret!])} busy={busy} onBusy={setBusy} />
        ))}
      </div>
    </Card>
  );
}

const AUTO = "auto";

function ModelCard({ state }: { state: LocalAiState | null }) {
  const toast = useToast();
  const providerId = useId();
  const modelId = useId();
  const caps = state?.caps ?? null;
  const choices = PROVIDER_ORDER.filter((p) => usable(caps, p));
  const picked = state?.choice && usable(caps, state.choice.provider) ? state.choice : null;
  const active = state?.active ?? null;
  const set = (next: { provider: AiProviderId; model: string } | null) =>
    void setLocalAiChoice(next).then(
      (s) => toast.show(s.active ? `Foli AI uses ${modelLabel(s.active.provider, s.active.model)}` : "Saved"),
      (e) => toast.show(errorMessage(e), { tone: "error" }),
    );
  if (!choices.length)
    return (
      <Card title="Model">
        <p className="text-sm text-muted" data-testid="local-ai-model-none">
          Foli AI has no model on this Mac yet. Turn on Apple Intelligence, or add one of your own keys.
        </p>
      </Card>
    );
  const shownProvider = picked?.provider ?? AUTO;
  const modelsFor = active && active.provider !== "on-device" ? PROVIDERS[active.provider].models : [];
  return (
    <Card title="Model" description="Which model answers. Folevi picks Apple Intelligence when it's on, and otherwise the first key you added.">
      <div className="grid gap-4 sm:max-w-md" data-testid="local-ai-model" data-active={active ? `${active.provider}:${active.model}` : ""}>
        <label className="text-sm" htmlFor={providerId}>
          <span className="mb-1 block font-medium">Provider</span>
          <Select
            id={providerId}
            value={shownProvider}
            onChange={(e) => {
              const v = e.target.value;
              if (v === AUTO) return set(null);
              const p = v as AiProviderId;
              set({ provider: p, model: PROVIDERS[p].defaultModel });
            }}
            className="ui-input h-9 w-full rounded-chip px-3 text-sm"
          >
            <option value={AUTO}>Let Folevi pick</option>
            {choices.map((p) => (
              <option key={p} value={p}>
                {PROVIDERS[p].label}
              </option>
            ))}
          </Select>
        </label>
        {modelsFor.length ? (
          <label className="text-sm" htmlFor={modelId}>
            <span className="mb-1 block font-medium">{PROVIDERS[active!.provider].label} model</span>
            <Select id={modelId} value={active!.model} onChange={(e) => set({ provider: active!.provider, model: e.target.value })} className="ui-input h-9 w-full rounded-chip px-3 text-sm">
              {modelsFor.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
              {!modelsFor.some((m) => m.id === active!.model) ? <option value={active!.model}>{active!.model}</option> : null}
            </Select>
            <span className="mt-1 block text-xs text-muted">{modelsFor.find((m) => m.id === active!.model)?.note ?? ""}</span>
          </label>
        ) : null}
        {active ? (
          <p className="text-sm text-muted" role="status">
            Answering now: {active.provider === "on-device" ? "Apple Intelligence, on this Mac" : `${modelLabel(active.provider, active.model)} (${PROVIDERS[active.provider].label})`}.
          </p>
        ) : null}
      </div>
    </Card>
  );
}

function HistoryCard() {
  const { profile } = useAppState();
  const update = useMutation(api.users.updateProfile);
  const toast = useToast();
  const descId = useId();
  const history = (profile as { aiPrefs?: { history?: boolean } }).aiPrefs?.history !== false;
  return (
    <Card title="Conversations">
      <div className="flex items-start justify-between gap-6">
        <p id={descId} className="max-w-prose text-sm text-muted">
          Your Foli AI conversations are kept on this Mac so you can come back to them, rename, pin and search them. They stay on this device and aren&apos;t synced with your library. When this is off, a conversation is deleted as soon as you close it.
        </p>
        <Switch
          checked={history}
          label="Keep conversations"
          describedBy={descId}
          onChange={(next) =>
            void update({ aiPrefs: { history: next } }).then(
              () => toast.show(next ? "Conversations are kept" : "New conversations aren't kept"),
              (e) => toast.show(errorMessage(e), { tone: "error" }),
            )
          }
        />
      </div>
    </Card>
  );
}

/** Settings > AI in local mode. */
export function LocalAiSection() {
  const state = useLocalAi();
  const host = localAiHost();
  if (!host.ai)
    return (
      <>
        <OnOffCard />
        <Card title="On this device">
          <p className="text-sm text-muted" data-testid="local-ai-no-host">
            Foli AI in a library on your devices needs Folevi for Mac: it runs on Apple Intelligence there, or on your own key.
          </p>
        </Card>
      </>
    );
  return (
    <>
      <OnOffCard />
      {state?.loaded ? null : (
        <p className="flex items-center gap-2 text-sm text-muted">
          <Loader2 size={14} className="animate-spin motion-reduce:animate-none" aria-hidden /> Checking Foli AI on this Mac…
        </p>
      )}
      <OnDeviceCard state={state} />
      <KeysCard state={state} />
      <ModelCard state={state} />
      <HistoryCard />
      {state?.active ? <AiMemoryCard /> : null}
    </>
  );
}
