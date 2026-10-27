"use client";
// A Vault one-time link (docs/VAULT_PLAN.md §6). Nothing is fetched until the visitor presses Reveal, so link previews
// don't use up a view. The item comes back sealed and opens here with the key in the link's fragment (#k=…), which
// browsers never send to a server. The fragment is cleared from the address bar once read.
import { useEffect, useRef, useState } from "react";
import { Copy, Eye, KeyRound, ShieldCheck } from "lucide-react";
import { fromBase64Url } from "@folevi/local-store/e2ee";
import { FoleviLogo } from "@/components/brand/FoleviMark";
import { Button } from "@/components/ui/Button";
import { ITEM_KINDS, type ItemKind, type ItemSecrets, type ItemSummary } from "@/lib/vault/items";
import { linkSecret, openLinkItem } from "@/lib/vault/shares";

type State =
  | { at: "ready" }
  | { at: "password"; wrong: boolean }
  | { at: "gone" }
  | { at: "noKey" }
  | { at: "error"; message: string }
  | { at: "open"; summary: ItemSummary & { kind: ItemKind }; secrets: ItemSecrets; viewsLeft: number };

const buf = (s: string) => fromBase64Url(s).buffer as ArrayBuffer;

export function VaultLinkView({ linkId }: { linkId: string }) {
  const secret = useRef<Uint8Array | null>(null);
  const [state, setState] = useState<State>({ at: "ready" });
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (secret.current) return;
    secret.current = linkSecret(window.location.hash);
    if (!secret.current) setState({ at: "noKey" });
    else history.replaceState(null, "", window.location.pathname);
  }, []);

  const reveal = async () => {
    if (!secret.current) return;
    setBusy(true);
    try {
      const res = await fetch("/api/vault-link", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ linkId, password: password || undefined }) });
      const r = (await res.json()) as { status: string; wrong?: boolean; message?: string; vaultId?: string; itemId?: string; sealedSummary?: string; sealed?: string; wrappedKey?: string; viewsLeft?: number };
      if (r.status === "gone") return setState({ at: "gone" });
      if (r.status === "password") return setState({ at: "password", wrong: Boolean(r.wrong) });
      if (r.status !== "ok") return setState({ at: "error", message: r.message ?? "The link couldn't be opened." });
      const opened = await openLinkItem<ItemSummary & { kind: ItemKind }, ItemSecrets>({ vaultId: r.vaultId!, itemId: r.itemId!, wrappedKey: buf(r.wrappedKey!), sealedSummary: buf(r.sealedSummary!), sealed: buf(r.sealed!) }, linkId, secret.current);
      setState({ at: "open", summary: opened.summary, secrets: opened.secrets!, viewsLeft: r.viewsLeft ?? 0 });
    } catch {
      setState({ at: "error", message: "This link didn't open. It may have been copied incompletely." });
    } finally {
      setBusy(false);
    }
  };

  const copy = async (label: string, value: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(label);
  };

  return (
    <main className="min-h-dvh bg-canvas px-4 py-12 text-ink">
      <div className="mx-auto max-w-md">
        <div className="mb-8 flex justify-center">
          <FoleviLogo />
        </div>
        <div className="rounded-panel ui-card px-6 py-7">
          {state.at === "open" ? (
            <Opened state={state} copied={copied} onCopy={copy} />
          ) : (
            <>
              <div className="mb-4 grid h-11 w-11 place-items-center rounded-control bg-sunken text-heading" aria-hidden>
                {state.at === "password" ? <KeyRound size={20} /> : <ShieldCheck size={20} />}
              </div>
              <h1 className="text-title-3 font-semibold text-heading">{state.at === "gone" ? "This link has ended" : state.at === "noKey" ? "This link is incomplete" : "Someone shared something with you"}</h1>
              <div className="mt-2 space-y-4 text-subheadline text-muted">
                {state.at === "gone" ? <p>It was used up, ended by whoever made it, or it expired. Ask them for a new one.</p> : null}
                {state.at === "noKey" ? <p>The part after the # is missing, and that's where its key is. Copy the whole link again.</p> : null}
                {state.at === "ready" || state.at === "password" || state.at === "error" ? (
                  <form
                    className="space-y-3"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void reveal();
                    }}
                  >
                    <p>It's end-to-end encrypted and opens only in this browser. Revealing it counts as one of the times the link works.</p>
                    {state.at === "password" ? (
                      <label htmlFor="vault-link-password" className="block">
                        <span className="mb-1 block text-footnote font-medium text-ink">Password</span>
                        <input id="vault-link-password" type="password" autoFocus autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} className="h-10 w-full ui-input rounded-chip px-3 text-body text-ink" />
                      </label>
                    ) : null}
                    {state.at === "password" && state.wrong ? <p role="alert" className="text-footnote text-danger">That password isn't right.</p> : null}
                    {state.at === "error" ? <p role="alert" className="text-footnote text-danger">{state.message}</p> : null}
                    <Button type="submit" variant="primary" disabled={busy || (state.at === "password" && !password)}>
                      <Eye size={14} aria-hidden /> {busy ? "Opening…" : "Reveal"}
                    </Button>
                  </form>
                ) : null}
              </div>
            </>
          )}
        </div>
        <p className="mt-6 text-center text-footnote text-faint">Shared from a Folevi Vault. Folevi can't read what's in it.</p>
      </div>
    </main>
  );
}

function Opened({ state, copied, onCopy }: { state: Extract<State, { at: "open" }>; copied: string | null; onCopy: (label: string, value: string) => void }) {
  const def = ITEM_KINDS[state.summary.kind];
  const value = (key: string) => state.summary.fields[key] ?? state.secrets.fields[key] ?? "";
  return (
    <section aria-label={state.summary.title}>
      <h1 className="text-title-3 font-semibold text-heading">{state.summary.title}</h1>
      <p className="text-footnote text-muted">
        {def?.label} · {state.viewsLeft ? `the link works ${state.viewsLeft} more ${state.viewsLeft === 1 ? "time" : "times"}` : "the link has now ended"}. Save what you need: it won't show again once you leave.
      </p>
      <dl className="mt-4 divide-y divide-line">
        {(def?.fields ?? []).map((f) => {
          const v = value(f.key);
          if (!v) return null;
          return (
            <div key={f.key} className="flex items-start gap-3 py-2.5">
              <dt className="w-32 flex-none text-footnote text-muted">{f.label}</dt>
              <dd className={`min-w-0 flex-1 whitespace-pre-wrap break-words text-ink ${f.type === "secret" || f.type === "multiline" || f.type === "totp" ? "font-mono" : ""}`}>{v}</dd>
              <Button size="sm" variant="quiet" aria-label={`Copy ${f.label}`} onClick={() => onCopy(f.label, v)}>
                <Copy size={13} aria-hidden /> {copied === f.label ? "Copied" : ""}
              </Button>
            </div>
          );
        })}
        {state.secrets.notes ? (
          <div className="py-2.5">
            <dt className="text-footnote text-muted">Notes</dt>
            <dd className="whitespace-pre-wrap text-ink">{state.secrets.notes}</dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}
