"use client";

// Settings > Foli AI > Your own AI key (Folevi Cloud and Folevi Server; local libraries have LocalAiSection):
// a provider, its key, the model, Test key, and a switch to use it. The key stays on this device (lib/ai/ownKey.ts)
// and goes with each Foli AI request; the server uses it for that request only (convex/lib/ai/ownKey.ts).
import { useEffect, useId, useState } from "react";
import { useAction } from "convex/react";
import { api } from "@/lib/convex/api";
import { OWN_KEY_INFO, OWN_KEY_PROVIDERS, cleanOwnKey, hasOwnKey, onOwnKeyChange, ownKeyChoice, ownKeyForRequest, removeOwnKey, saveOwnKey, setOwnKeyChoice, type OwnKeyProvider } from "@/lib/ai/ownKey";
import { useOwnKeyChoice } from "@/components/ai/useAiAction";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { Switch } from "@/components/ui/Switch";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { Card } from "./Card";

export function OwnKeyCard() {
  const choice = useOwnKeyChoice();
  const [provider, setProvider] = useState<OwnKeyProvider>(() => ownKeyChoice()?.provider ?? "anthropic");
  const [model, setModel] = useState(() => ownKeyChoice()?.model ?? OWN_KEY_INFO[provider].defaultModel);
  const [stored, setStored] = useState<boolean | null>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const test = useAction(api.ai.testOwnKey);
  const toast = useToast();
  const providerId = useId();
  const modelId = useId();
  const keyId = useId();
  const switchDesc = useId();
  const info = OWN_KEY_INFO[provider];
  const on = choice?.provider === provider;

  useEffect(() => {
    let live = true;
    const read = () => void hasOwnKey(provider).then((has) => live && setStored(has), () => live && setStored(false));
    read();
    const off = onOwnKeyChange(read);
    return () => {
      live = false;
      off();
    };
  }, [provider]);

  const pickProvider = (next: OwnKeyProvider) => {
    setProvider(next);
    setModel(choice?.provider === next ? choice.model : OWN_KEY_INFO[next].defaultModel);
    setValue("");
    setResult(null);
  };

  const pickModel = (next: string) => {
    setModel(next);
    setResult(null);
    if (on) setOwnKeyChoice({ provider, model: next });
  };

  const save = async () => {
    const key = cleanOwnKey(value);
    if (!key) {
      setResult({ ok: false, text: `That doesn't look like a ${info.label} key.` });
      return;
    }
    setBusy(true);
    try {
      await saveOwnKey(provider, key);
      setValue("");
      setResult(null);
      toast.show(`${info.label} key saved on this device.`);
    } catch (e) {
      toast.show(errorMessage(e), { tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  const check = async () => {
    setBusy(true);
    setResult(null);
    try {
      const k = await ownKeyForRequest({ provider, model });
      if (!k) {
        setResult({ ok: false, text: `Add your ${info.label} key first.` });
        return;
      }
      const r = await test({ ownKey: k });
      setResult(r.ok ? { ok: true, text: `Your key works with ${modelName(provider, r.model)}.` } : { ok: false, text: r.message });
    } catch (e) {
      setResult({ ok: false, text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await removeOwnKey(provider);
      setResult(null);
      toast.show(`${info.label} key removed from this device.`);
    } catch (e) {
      toast.show(errorMessage(e), { tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title="Your own AI key"
      description={
        <>
          Use Foli AI with your own Anthropic, OpenAI or Google Gemini key. It works on every plan and uses no AI credits; your provider bills you. The key stays on this device and is sent with each Foli AI request. Our server uses it for that request and never saves or logs it. Scheduled digests, routines and deep research still use credits.
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor={providerId} className="text-footnote font-medium text-muted">
              Provider
            </label>
            <Select id={providerId} value={provider} onChange={(e) => pickProvider(e.target.value as OwnKeyProvider)} className="ui-input mt-1 h-control w-full px-3 text-callout">
              {OWN_KEY_PROVIDERS.map((p) => (
                <option key={p} value={p}>
                  {OWN_KEY_INFO[p].label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label htmlFor={modelId} className="text-footnote font-medium text-muted">
              Model
            </label>
            <Select id={modelId} value={model} onChange={(e) => pickModel(e.target.value)} className="ui-input mt-1 h-control w-full px-3 text-callout">
              {info.models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                  {m.id === info.defaultModel ? " (default)" : ""}
                </option>
              ))}
            </Select>
          </div>
        </div>

        {stored ? (
          <div className="flex flex-wrap items-center gap-2">
            <p className="mr-auto text-subheadline text-heading">Your {info.label} key is saved on this device.</p>
            <Button onClick={() => void check()} disabled={busy}>
              Test key
            </Button>
            <Button variant="ghost" onClick={() => void remove()} disabled={busy}>
              Remove
            </Button>
          </div>
        ) : (
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <label htmlFor={keyId} className="sr-only">
              {info.label} key
            </label>
            <input
              id={keyId}
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={`Paste your ${info.label} key`}
              className="ui-input h-control min-w-0 flex-1 px-3 text-callout"
            />
            <Button variant="primary" type="submit" disabled={busy || !value.trim()}>
              Save
            </Button>
            {info.keyUrl ? (
              <a href={info.keyUrl} target="_blank" rel="noreferrer" className="text-subheadline text-heading underline underline-offset-2">
                Get a key
              </a>
            ) : null}
          </form>
        )}

        {result ? (
          <p role="status" className={`text-subheadline ${result.ok ? "text-heading" : "text-danger"}`}>
            {result.text}
          </p>
        ) : null}

        <div className="flex items-start justify-between gap-6 border-t border-line/70 pt-3.5">
          <div className="min-w-0 max-w-prose">
            <p className="text-subheadline font-medium text-heading">Use my own key</p>
            <p id={switchDesc} className="mt-0.5 text-subheadline text-muted">
              {on ? `Foli AI answers with ${modelName(provider, model)} on your ${info.label} key.` : "Off: Foli AI uses your AI credits."}
            </p>
          </div>
          <span className="mt-0.5 flex-none">
            <Switch checked={on} disabled={busy || !stored} label="Use my own key" describedBy={switchDesc} onChange={(next) => setOwnKeyChoice(next ? { provider, model } : null)} />
          </span>
        </div>
      </div>
    </Card>
  );
}

const modelName = (p: OwnKeyProvider, id: string) => OWN_KEY_INFO[p].models.find((m) => m.id === id)?.label ?? id;
