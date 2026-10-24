"use client";

import { useCallback, useEffect, useState } from "react";
import { useQuery } from "convex/react";
import { authClient, authErrorMessage } from "@/lib/auth/client";
import { PROVIDER_NAMES, isSocialProvider, socialError, type SocialProvider } from "@/lib/auth/socialErrors";
import { api } from "@/lib/convex/api";
import { desktop } from "@/lib/desktop";
import { formatDateTime } from "@/lib/format";
import { nativeApp } from "@/lib/nativeApp";
import { useIphoneLook } from "@/lib/iphone";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { useToast } from "@/components/ui/Toast";
import { signOutNow } from "@/components/auth/SignOut";
import { Alert } from "@/components/auth/fields";
import { AppleMark, GoogleMark } from "@/components/auth/SocialSignIn";
import { ActionRow, DestructiveRow, IosRow, IosSection, IosText, Subscreen } from "@/components/iphone/SettingsKit";
import { RowIcon } from "@/components/iphone/Grouped";
import { Card } from "./Card";

type LinkedAccount = { id: string; providerId: string; accountId: string; createdAt?: string | Date | null };

const ORDER: SocialProvider[] = ["apple", "google"];
const HERE = "/settings/security";

const mark = (p: SocialProvider) => (p === "apple" ? <AppleMark size={16} /> : <GoogleMark />);

/**
 * Settings > Security > Sign-in methods: Apple and Google linked to this account, to sign in with. Linking
 * goes through the provider's page and back here; any of its addresses will do (Apple's "Hide My Email"
 * included). Removing one needs a recent sign-in, and the last way to sign in can't be removed (Better Auth
 * refuses both, and this says why).
 */
export function SignInMethodsCard() {
  const toast = useToast();
  const offered = useQuery(api.signInOptions.options, {});
  const [accounts, setAccounts] = useState<LinkedAccount[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [removing, setRemoving] = useState<SocialProvider | null>(null);
  const [signInAgain, setSignInAgain] = useState(false);
  const [busy, setBusy] = useState<SocialProvider | null>(null);
  const iphone = useIphoneLook();
  // Linking opens the provider's page, which the apps' windows don't show (Google refuses web views).
  const inApp = Boolean(nativeApp() || desktop());

  const load = useCallback(async () => {
    const { data, error } = await authClient.listAccounts();
    if (error) setProblem(authErrorMessage(error));
    else setAccounts((data ?? []) as LinkedAccount[]);
  }, []);

  useEffect(() => {
    void load();
    // Back from a link that didn't work: ?error=…&via=apple (Better Auth adds the error).
    const params = new URLSearchParams(window.location.search);
    const error = params.get("error");
    const via = params.get("via");
    if (error && isSocialProvider(via)) {
      setProblem(error === "email_doesn't_match" ? `That ${PROVIDER_NAMES[via]} account couldn't be linked. Try again.` : (socialError(error, via) ?? null));
      params.delete("error");
      params.delete("error_description");
      params.delete("via");
      const rest = params.toString();
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${rest ? `?${rest}` : ""}`);
    }
  }, [load]);

  const linked = (p: SocialProvider) => accounts?.find((a) => a.providerId === p) ?? null;
  // Shown: what this server offers, and anything already linked even if it no longer is.
  const providers = ORDER.filter((p) => offered?.[p] === true || linked(p));
  if (offered === undefined || (accounts !== null && providers.length === 0)) return null;

  async function link(p: SocialProvider) {
    if (busy) return;
    setProblem(null);
    setBusy(p);
    const { error } = await authClient.linkSocial({ provider: p, callbackURL: HERE, errorCallbackURL: `${HERE}?via=${p}` });
    // On success the browser is on its way to the provider.
    if (error) {
      setBusy(null);
      setProblem(authErrorMessage(error));
    }
  }

  async function unlink(p: SocialProvider) {
    setRemoving(null);
    setBusy(p);
    const { error } = await authClient.unlinkAccount({ providerId: p });
    setBusy(null);
    if (error) {
      if ((error as { code?: string }).code === "SESSION_NOT_FRESH") setSignInAgain(true);
      else setProblem(authErrorMessage(error));
      return;
    }
    toast.show(`${PROVIDER_NAMES[p]} removed`, { tone: "success" });
    await load();
  }

  const facts = (p: SocialProvider) => {
    const a = linked(p);
    if (!a) return "Not linked";
    return a.createdAt ? `Linked ${formatDateTime(new Date(a.createdAt).getTime())}` : "Linked";
  };
  const description = "Sign in with Apple or Google instead of your password. You can use any address there, including Apple's Hide My Email.";
  const appNote = "To link one, open Settings > Security in your browser.";
  const removeMessage = (p: SocialProvider) => `You won't be able to sign in with ${PROVIDER_NAMES[p]} until you link it again. Your notes stay as they are.`;

  const dialogs = (
    <>
      <Dialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title={removing ? `Remove ${PROVIDER_NAMES[removing]}?` : ""}
        description={removing ? removeMessage(removing) : undefined}
        size="sm"
        footer={
          <>
            <Button onClick={() => setRemoving(null)}>Cancel</Button>
            <Button variant="danger" onClick={() => removing && void unlink(removing)}>
              Remove
            </Button>
          </>
        }
      />
      <Dialog
        open={signInAgain}
        onClose={() => setSignInAgain(false)}
        title="Sign in again to remove it"
        description="For your security, removing a way to sign in needs a sign-in from the last 10 minutes. Sign in again and you'll come back here."
        size="sm"
        footer={
          <>
            <Button onClick={() => setSignInAgain(false)}>Cancel</Button>
            <Button variant="primary" onClick={() => void signOutNow(`/signin?returnTo=${encodeURIComponent(HERE)}`)}>
              Sign in again
            </Button>
          </>
        }
      />
    </>
  );

  if (iphone)
    return (
      <>
        <IosRow icon={<RowIcon>{mark("apple")}</RowIcon>} label="Sign-in methods" value={accounts === null ? "" : String(providers.filter((p) => linked(p)).length || "None")} screen="sign-in-methods" />
        <Subscreen id="sign-in-methods" title="Sign-in methods">
          {problem ? (
            <div className="px-4">
              <Alert>{problem}</Alert>
            </div>
          ) : null}
          <IosSection footer={inApp ? `${description} ${appNote}` : description} label="Sign-in methods">
            {accounts === null ? <IosText muted>Loading…</IosText> : null}
            {accounts !== null
              ? providers.map((p) =>
                  linked(p) ? (
                    <IosRow key={p} icon={<RowIcon>{mark(p)}</RowIcon>} label={PROVIDER_NAMES[p]} description={facts(p)} screen={`sign-in-methods.${p}`} />
                  ) : inApp ? (
                    <IosRow key={p} icon={<RowIcon>{mark(p)}</RowIcon>} label={PROVIDER_NAMES[p]} value="Not linked" />
                  ) : (
                    <ActionRow key={p} icon={<RowIcon>{mark(p)}</RowIcon>} label={`Link ${PROVIDER_NAMES[p]}`} busy={busy === p ? "Opening…" : null} onClick={() => void link(p)} />
                  ),
                )
              : null}
          </IosSection>
        </Subscreen>
        {providers
          .filter((p) => linked(p))
          .map((p) => (
            <Subscreen key={p} id={`sign-in-methods.${p}`} title={PROVIDER_NAMES[p]}>
              <IosSection footer={facts(p)}>
                <IosRow label="Status" value="Linked" />
              </IosSection>
              <IosSection>
                <DestructiveRow
                  label={`Remove ${PROVIDER_NAMES[p]}`}
                  confirm="Remove"
                  message={removeMessage(p)}
                  onConfirm={() => {
                    void unlink(p);
                    history.back();
                  }}
                />
              </IosSection>
            </Subscreen>
          ))}
        {dialogs}
      </>
    );

  return (
    <Card title="Sign-in methods" description={description}>
      {problem ? (
        <div className="mb-3">
          <Alert>{problem}</Alert>
        </div>
      ) : null}
      <ul className="ui-card divide-y divide-line overflow-hidden rounded-control" aria-label="Sign-in methods" aria-busy={accounts === null || undefined}>
        {accounts === null ? <li className="px-4 py-3 text-subheadline text-muted">Loading…</li> : null}
        {accounts !== null
          ? providers.map((p) => (
              <li key={p} className="flex min-h-14 items-center gap-3 px-4 py-2.5">
                <span aria-hidden className="grid h-9 w-9 flex-none place-items-center rounded-control bg-[var(--glass-hover)] text-heading">
                  {mark(p)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-subheadline font-medium text-heading">{PROVIDER_NAMES[p]}</span>
                  <span className="block text-footnote text-muted">{facts(p)}</span>
                </span>
                {linked(p) ? (
                  <Button size="sm" className="min-h-11 sm:min-h-0" aria-label={`Remove ${PROVIDER_NAMES[p]}`} disabled={busy !== null} onClick={() => setRemoving(p)}>
                    Remove
                  </Button>
                ) : inApp ? null : (
                  <Button size="sm" className="min-h-11 sm:min-h-0" aria-label={`Link ${PROVIDER_NAMES[p]}`} disabled={busy !== null} onClick={() => void link(p)}>
                    Link
                  </Button>
                )}
              </li>
            ))
          : null}
      </ul>
      {inApp ? <p className="mt-3 text-subheadline text-muted">{appNote}</p> : null}
      {dialogs}
    </Card>
  );
}
