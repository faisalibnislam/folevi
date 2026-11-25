"use client";

// "Your own server" on Folevi's sign-in screens (docs/SELF_HOSTING_PLAN.md §8): type a server's address, see its
// name, and go there; and, for someone signed in to Folevi Cloud, the servers linked to their account
// (connect:myServers, CONTRACT §7). Going there is lib/server-edition/handoff.ts: the browser opens the server's
// own sign-in page; the Mac, iPhone and iPad apps add it as a place.
import { useEffect, useState } from "react";
import { useAction, useConvexAuth } from "convex/react";
import { ArrowRight, Loader2, QrCode, Server } from "lucide-react";
import { shell } from "@/lib/shell";
import { ConvexClientProvider } from "@/lib/convex/provider";
import { addressFromCode, checkServerAddress, connectOrigin } from "@/lib/server-edition/address";
import { appVersion, lookUpServer, openServer } from "@/lib/server-edition/handoff";
import { compareVersions, type ServerInfo } from "@/lib/server-edition/info";
import { connectRefs, type LinkedServer } from "@/lib/server-edition/refs";
import { Alert, Field } from "@/components/auth/fields";

function Found({ origin, info, onBack }: { origin: string; info: ServerInfo; onBack: () => void }) {
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const tooOld = info.minAppVersion && compareVersions(appVersion(), info.minAppVersion) < 0;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 rounded-control bg-[var(--glass-hover)] p-3">
        <span className="grid size-9 flex-none place-items-center rounded-chip bg-surface text-heading">
          <Server size={17} aria-hidden />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-body font-semibold text-heading">{info.kind === "folevi-cloud" ? "Folevi Cloud" : info.name}</span>
          <span className="block truncate text-footnote text-muted">{origin.replace(/^https?:\/\//, "")}</span>
        </span>
      </div>
      {info.kind === "folevi-cloud" ? <Alert tone="info">That&apos;s Folevi Cloud. Sign in above.</Alert> : null}
      {refused ? <Alert>{refused}</Alert> : null}
      {tooOld ? <Alert tone="info">This server needs a newer version of Folevi. Update Folevi to sign in there.</Alert> : null}
      <div className="flex gap-2">
        <button type="button" onClick={onBack} className="ui-btn ui-btn-ghost h-11 px-4 text-body">
          Back
        </button>
        <button
          type="button"
          disabled={busy || info.kind === "folevi-cloud" || Boolean(tooOld)}
          aria-busy={busy}
          className="ui-btn ui-btn-primary h-11 flex-1 text-body"
          onClick={() => {
            setBusy(true);
            setRefused(null);
            void openServer(origin, info)
              .then(setRefused)
              .finally(() => setBusy(false));
          }}
        >
          {busy ? <Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden /> : null}
          {info.needsSetup ? `Set up ${info.name}` : `Sign in to ${info.name}`}
        </button>
      </div>
    </div>
  );
}

/** The address field alone (the apps' own sign-in screen uses it too). */
export function OwnServerAddress() {
  return <AddressForm />;
}

function AddressForm() {
  const [address, setAddress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [unreachable, setUnreachable] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [found, setFound] = useState<{ origin: string; info: ServerInfo } | null>(null);
  const scan = shell()?.places?.scanCode;
  const go = async (value: string) => {
    if (busy) return;
    setError(null);
    setUnreachable(null);
    const checked = checkServerAddress(value);
    if (!checked.ok) {
      setError(checked.reason);
      return;
    }
    setBusy(true);
    const r = await lookUpServer(checked.origin);
    setBusy(false);
    if (r.ok) setFound({ origin: checked.origin, info: r.info });
    else {
      setError(r.reason);
      setUnreachable(checked.origin);
    }
  };
  if (found) return <Found origin={found.origin} info={found.info} onBack={() => setFound(null)} />;
  return (
    <form
      className="space-y-3"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void go(address);
      }}
    >
      <Field
        label="Server address"
        name="server-address"
        inputMode="url"
        autoComplete="url"
        autoCapitalize="none"
        spellCheck={false}
        placeholder="notes.example.com"
        value={address}
        onChange={(e) => setAddress(e.target.value)}
        error={error}
        hint={error ? undefined : "The address the person who runs it gave you, or the one on your NAS's Folevi page."}
        autoFocus
      />
      {unreachable ? (
        <p className="text-subheadline text-muted">
          A browser can&apos;t always check a server on your home network from here.{" "}
          <button type="button" className="font-medium text-accent underline underline-offset-2 hover:decoration-current" onClick={() => void openServer(unreachable, null).then((why) => why && setError(why))}>
            Open it anyway
          </button>
        </p>
      ) : null}
      <button type="submit" disabled={busy} aria-busy={busy} className="ui-btn ui-btn-secondary h-11 w-full text-body">
        {busy ? <Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden /> : <ArrowRight size={16} aria-hidden />}
        Continue
      </button>
      {scan ? (
        <button
          type="button"
          disabled={busy}
          className="ui-btn ui-btn-ghost h-11 w-full text-body"
          onClick={async () => {
            // A refusal (camera access off) says why; the address field stays for typing.
            const text = await scan().catch((e: unknown) => {
              const message = (e as { message?: unknown } | null)?.message;
              setError(typeof message === "string" && message ? message : "Folevi couldn't scan here. Type the server's address instead.");
              return null;
            });
            if (!text) return;
            const value = addressFromCode(text);
            setAddress(value);
            void go(value);
          }}
        >
          <QrCode size={16} aria-hidden />
          Scan QR code
        </button>
      ) : null}
    </form>
  );
}

function LinkedServers() {
  const { isAuthenticated } = useConvexAuth();
  const myServers = useAction(connectRefs.myServers);
  const [servers, setServers] = useState<LinkedServer[] | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    if (!isAuthenticated) return;
    let live = true;
    myServers({}).then(
      (list) => live && setServers(Array.isArray(list) ? list : []),
      () => live && setServers([]),
    );
    return () => {
      live = false;
    };
  }, [isAuthenticated, myServers]);
  if (!servers || servers.length === 0) return null;
  return (
    <section aria-labelledby="your-servers" className="mt-6">
      <h2 id="your-servers" className="mb-2 text-subheadline font-semibold text-heading">
        Your servers
      </h2>
      {problem ? (
        <div className="mb-2">
          <Alert>{problem}</Alert>
        </div>
      ) : null}
      <ul className="space-y-1">
        {servers.map((s) => (
          <li key={s.serverId}>
            <button
              type="button"
              disabled={opening !== null}
              onClick={() => {
                const origin = connectOrigin(s.hostname);
                setOpening(s.serverId);
                setProblem(null);
                void lookUpServer(origin)
                  .then((r) => openServer(origin, r.ok ? r.info : null))
                  .then(setProblem)
                  .finally(() => setOpening(null));
              }}
              className="flex w-full items-center gap-3 rounded-control p-2.5 text-left transition-colors hover:bg-[var(--glass-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-60"
            >
              <span className="grid size-9 flex-none place-items-center rounded-chip bg-[var(--glass-hover)] text-heading">
                {opening === s.serverId ? <Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden /> : <Server size={17} aria-hidden />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body font-semibold text-heading">{s.name}</span>
                <span className="block truncate text-footnote text-muted">
                  {s.role === "owner" ? "Yours" : "Shared with you"} · {s.online ? "Online" : "Offline"}
                </span>
              </span>
              <span aria-hidden className={`size-2 flex-none rounded-tiny ${s.online ? "bg-success" : "bg-[color-mix(in_oklab,var(--color-ink)_25%,transparent)]"}`} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Below Folevi Cloud's sign-in form. `signedIn`: someone already signed in here (adding an account). */
export function OwnServerSignIn({ signedIn }: { signedIn: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {signedIn ? (
        <ConvexClientProvider>
          <LinkedServers />
        </ConvexClientProvider>
      ) : null}
      <div className="mt-6 border-t border-line pt-5">
        {open ? (
          <>
            <h2 className="mb-3 text-body font-semibold text-heading">Your own server</h2>
            <AddressForm />
          </>
        ) : (
          <button type="button" onClick={() => setOpen(true)} className="ui-btn ui-btn-ghost h-11 w-full text-body">
            <Server size={16} aria-hidden /> Sign in to your own server
          </button>
        )}
      </div>
    </>
  );
}
