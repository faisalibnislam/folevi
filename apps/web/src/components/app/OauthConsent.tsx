"use client";

import { useMutation, useQuery } from "convex/react";
import { useMemo, useState } from "react";
import { ShieldAlert } from "lucide-react";
import { api } from "@/lib/convex/api";
import { authClient } from "@/lib/auth/client";
import { useAppRouter } from "@/lib/app/router";
import { FoleviLogo } from "@/components/brand/FoleviMark";
import { Checkbox } from "@/components/ui/Checkbox";
import { Switch } from "@/components/ui/Switch";
import { Button } from "@/components/ui/Button";
import { errorMessage } from "@/components/ui/Toast";

/** What each scope lets an app do, in the order they're shown. */
const SCOPES: { scope: string; label: string; required?: boolean }[] = [
  { scope: "notes:read", label: "Search and read your notes", required: true },
  { scope: "notes:write", label: "Create notes and add to them" },
  { scope: "tasks:read", label: "See your tasks" },
  { scope: "tasks:write", label: "Add tasks, check them off and change their dates" },
];

/**
 * Connecting an app (Claude, ChatGPT, Cursor, …) to Folevi: the OAuth consent screen at /oauth/consent.
 * Better Auth's OAuth provider sends people here with a signed query (and the sign-in page brings them
 * back with it). The person sees the app as it named itself and where it will send them back, chooses
 * what it may do and in which places, and then approves (saving the grant first: convex/mcp.ts) or
 * cancels. Either way Better Auth answers with where to go next: back to the app, with a code or an error.
 *
 * An app that asks only to write (Folevi Web Clipper asks for notes:write alone) isn't offered reading,
 * and its grant only ever adds new things (saveGrant enforces that too).
 */
export function OauthConsent() {
  const { search } = useAppRouter();
  const clientId = search.get("client_id") ?? "";
  const requested = useMemo(() => new Set((search.get("scope") ?? "notes:read").split(/\s+/).filter(Boolean)), [search]);
  const info = useQuery(api.mcp.consentInfo, clientId ? { clientId } : "skip");
  const saveGrant = useMutation(api.mcp.saveGrant);
  const writeOnly = [...requested].some((s) => s.endsWith(":write")) && !requested.has("notes:read") && !requested.has("tasks:read");
  const offered = SCOPES.filter((s) => (writeOnly ? requested.has(s.scope) : s.required || requested.has(s.scope)));
  const [scopes, setScopes] = useState<Set<string> | null>(null);
  const [places, setPlaces] = useState<{ personal: boolean; workspaceIds: string[] } | null>(null);
  const [includeShared, setIncludeShared] = useState(false);
  const [createOnly, setCreateOnly] = useState(false);
  const [busy, setBusy] = useState<"allow" | "deny" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const chosenScopes = scopes ?? new Set(offered.map((s) => s.scope));
  const chosenPlaces = places ?? { personal: info?.current?.personal ?? true, workspaceIds: info?.current?.workspaceIds ?? [] };
  const signed = search.has("sig");

  const finish = async (accept: boolean) => {
    setBusy(accept ? "allow" : "deny");
    setError(null);
    try {
      if (accept) {
        await saveGrant({ clientId, scopes: [...chosenScopes], personal: chosenPlaces.personal, workspaceIds: chosenPlaces.workspaceIds, includeShared: includeShared && !writeOnly, createOnly: createOnly || writeOnly });
      }
      const scope = accept ? [...chosenScopes, ...(requested.has("offline_access") ? ["offline_access"] : [])].join(" ") : undefined;
      const res = await authClient.$fetch<{ redirect_uri?: string; url?: string }>("/oauth2/consent", { method: "POST", body: { accept, ...(scope ? { scope } : {}) } });
      const next = res.data?.redirect_uri ?? res.data?.url;
      if (!next) throw new Error(res.error?.message ?? "This sign-in request expired. Start connecting again from the app.");
      window.location.assign(next);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(null);
    }
  };

  const card = (children: React.ReactNode) => (
    <div className="ui-canvas ui-neutral-chrome grid min-h-dvh place-items-center px-4 py-12">
      <div className="w-full max-w-md">
        <span className="mb-6 inline-flex items-center gap-2 text-ink">
          <FoleviLogo height={28} title="Folevi" />
        </span>
        {/* The sign-in pages' card ((auth)/layout.tsx), with the sheet behind it. */}
        <main id="main" className="relative">
          <div aria-hidden className="absolute inset-0 translate-x-2 translate-y-2 ui-card rounded-control" />
          <div className="relative ui-card rounded-control p-8">{children}</div>
        </main>
      </div>
    </div>
  );

  if (!clientId || !signed) {
    return card(
      <>
        <h1 className="ui-display text-large-title leading-[1.08]">This link doesn’t work</h1>
        <p className="mt-2 text-body leading-relaxed text-muted">Start connecting again from the app you were using.</p>
      </>,
    );
  }
  if (info === undefined) return card(<p className="text-body text-muted">Loading…</p>);
  if (info === null) {
    return card(
      <>
        <h1 className="ui-display text-large-title leading-[1.08]">This app isn’t registered</h1>
        <p className="mt-2 text-body leading-relaxed text-muted">Start connecting again from the app you were using.</p>
      </>,
    );
  }

  const togglePlace = (id: string, on: boolean) =>
    setPlaces({ ...chosenPlaces, workspaceIds: on ? [...chosenPlaces.workspaceIds, id] : chosenPlaces.workspaceIds.filter((w) => w !== id) });
  const nothingChosen = !chosenPlaces.personal && chosenPlaces.workspaceIds.length === 0;
  const noScopes = chosenScopes.size === 0;
  const writes = chosenScopes.has("notes:write") || chosenScopes.has("tasks:write");

  return card(
    <>
      <h1 className="ui-display text-large-title leading-[1.08]">Connect {info.name} to Folevi</h1>
      <p className="mt-2 text-body leading-relaxed text-muted">
        <strong className="text-ink">{info.name}</strong> wants to {writeOnly ? "add notes to Folevi" : "use your notes"} as <strong className="text-ink">{info.email}</strong>. It will send you back to{" "}
        <strong className="text-ink">{info.redirectHosts.join(", ") || "the app"}</strong>.
      </p>
      <p className="mt-2 inline-flex items-start gap-1.5 rounded-chip bg-[color-mix(in_oklab,var(--color-ink)_6%,transparent)] px-2 py-0.5 text-footnote text-muted">
        <ShieldAlert size={12} aria-hidden className="mt-[calc((1lh-12px)/2)] flex-none" /> The app named itself. Folevi hasn’t checked it.
      </p>

      <fieldset className="mt-6">
        <legend className="ui-caps mb-2">What it can do</legend>
        <div className="space-y-2">
          {offered.map((s) => (
            <Checkbox
              key={s.scope}
              className="text-body"
              checked={chosenScopes.has(s.scope)}
              disabled={s.required}
              onChange={(on) => {
                const next = new Set(chosenScopes);
                if (on) next.add(s.scope);
                else next.delete(s.scope);
                setScopes(next);
              }}
            >
              <span className="text-ink">{s.label}</span>
            </Checkbox>
          ))}
        </div>
      </fieldset>

      <fieldset className="mt-5">
        <legend className="ui-caps mb-2">Where</legend>
        <div className="space-y-2">
          <Checkbox className="text-body" checked={chosenPlaces.personal} onChange={(on) => setPlaces({ ...chosenPlaces, personal: on })}>
            <span className="text-ink">Personal</span>
          </Checkbox>
          {info.workspaces.map((w) => (
            <Checkbox key={w.id} className="text-body" checked={chosenPlaces.workspaceIds.includes(w.id)} onChange={(on) => togglePlace(w.id, on)}>
              <span className="text-ink">{w.name}</span>
            </Checkbox>
          ))}
        </div>
      </fieldset>

      <div className="mt-5 space-y-3">
        {writeOnly ? null : (
          <label className="flex items-center justify-between gap-3">
            <span className="min-w-0">
              <span className="block text-body text-ink">Pages shared with you</span>
              <span id="consent-shared-hint" className="block text-footnote text-muted">
                Read pages other people shared with you from elsewhere.
              </span>
            </span>
            <Switch checked={includeShared} onChange={setIncludeShared} label="Pages shared with you" describedBy="consent-shared-hint" />
          </label>
        )}
        {writes ? (
          <label className="flex items-center justify-between gap-3">
            <span className="min-w-0">
              <span className="block text-body text-ink">Only add new things</span>
              <span id="consent-add-only-hint" className="block text-footnote text-muted">
                {writeOnly ? "It asked only to add, so it can’t read your notes or change what’s already there." : "It can create notes and tasks and add to notes, but never change what’s already there."}
              </span>
            </span>
            <Switch checked={createOnly || writeOnly} onChange={setCreateOnly} disabled={writeOnly} label="Only add new things" describedBy="consent-add-only-hint" />
          </label>
        ) : null}
      </div>

      <p className="mt-5 text-subheadline leading-relaxed text-muted">
        {writeOnly ? `${info.name} can’t read your notes.` : `Notes can hold text other people wrote, and ${info.name} may act on what it reads.`} Every change it makes is saved in the note’s version history. You can disconnect it any time in Settings → Connected apps.
      </p>

      {error ? (
        <p role="alert" className="mt-4 text-subheadline text-danger">
          {error}
        </p>
      ) : null}

      <div className="mt-6 flex gap-2">
        <Button className="flex-1" onClick={() => void finish(false)} disabled={busy !== null} aria-busy={busy === "deny" || undefined}>
          Cancel
        </Button>
        <Button className="flex-1" variant="primary" onClick={() => void finish(true)} disabled={busy !== null || nothingChosen || noScopes} aria-busy={busy === "allow" || undefined}>
          Allow
        </Button>
      </div>
      {nothingChosen ? <p className="mt-2 text-footnote text-muted">Choose at least one place.</p> : null}
    </>,
  );
}
