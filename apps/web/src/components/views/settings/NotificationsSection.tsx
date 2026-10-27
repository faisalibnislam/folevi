"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { Switch } from "@/components/ui/Switch";
import { Select } from "@/components/ui/Select";
import { Card } from "./Card";
import { PushCard } from "./PushCard";
import { useIphoneLook } from "@/lib/iphone";
import { useCapabilities } from "@/lib/mode";
import { ChoiceRow, IosRow, IosSection, IosText, Subscreen, SwitchRow } from "@/components/iphone/SettingsKit";

type Prefs = ReturnType<typeof useAppState>["profile"]["notificationPrefs"];
type Topic = "comments" | "replies" | "mentions" | "shares" | "access" | "reminders";

const ROWS: { topic: Topic; label: string; hint: string }[] = [
  { topic: "comments", label: "Comments", hint: "On notes you created or follow" },
  { topic: "replies", label: "Replies", hint: "In comment threads you took part in" },
  { topic: "mentions", label: "Mentions", hint: "When someone @mentions you in a note or a comment" },
  { topic: "shares", label: "Shares and invitations", hint: "Pages shared with you and workspace invitations" },
  { topic: "access", label: "Access changes", hint: "When your access to a page or workspace changes" },
  { topic: "reminders", label: "Task reminders", hint: "When a reminder you set on a to-do is due. The email shows that to-do line." },
];

const VAULT_HINT = "Items added, changed or shared, and people added. They never show what's in the Vault. Custodians always hear about security events.";

const ALL_IN_APP = { comments: true, replies: true, mentions: true, shares: true, access: true, reminders: true };

/** The email switch for a topic (replies and access changes follow comments and shares until set). */
function emailOn(prefs: Prefs, topic: Topic): boolean {
  switch (topic) {
    case "comments":
      return prefs.comments;
    case "replies":
      return prefs.replies ?? prefs.comments;
    case "mentions":
      return prefs.mentions;
    case "shares":
      return prefs.shares && prefs.invites;
    case "access":
      return prefs.access ?? prefs.shares;
    case "reminders":
      return prefs.reminders ?? true;
  }
}

function emailPatch(topic: Topic, on: boolean): Partial<Prefs> {
  return topic === "shares" ? { shares: on, invites: on } : { [topic]: on };
}

export function NotificationsSection() {
  const { profile } = useAppState();
  const update = useMutation(api.users.updateProfile);
  const toast = useToast();
  const prefs = profile.notificationPrefs;
  const iphone = useIphoneLook();
  const inApp = { ...ALL_IN_APP, ...prefs.inApp };
  // The Vault's row, where there's a Vault (its flag on). Bell and push only: Vault changes aren't emailed yet.
  const { scope } = useAppState();
  const caps = useCapabilities();
  const hasVault = Boolean(useQuery(api.vault.get, caps.sharing ? { scope } : "skip"));
  const vaultOn = prefs.inApp?.vault ?? true;
  const setVault = (on: boolean) => void set({ inApp: { ...inApp, vault: on } });
  const set = (patch: Partial<Prefs>) =>
    update({ notificationPrefs: { ...prefs, ...patch } }).then(
      () => toast.show("Saved"),
      (e) => toast.show(errorMessage(e), { tone: "error" }),
    );
  if (iphone)
    return (
      <>
        <PushCard />
        <IosSection
          header="Notify me about"
          footer="Emails say who did what and where, with a link. They never include your notes or comment text; a reminder shows only its own to-do line. Security emails (new sign-ins, account deletion) can't be turned off."
        >
          {ROWS.map((r) => {
            const app = inApp[r.topic] ?? true;
            const mail = emailOn(prefs, r.topic);
            return <IosRow key={r.topic} label={r.label} value={app && mail ? "In app, email" : app ? "In app" : mail ? "Email" : "Off"} screen={`topic-${r.topic}`} />;
          })}
        </IosSection>
        {ROWS.map((r) => (
          <Subscreen key={r.topic} id={`topic-${r.topic}`} title={r.label}>
            <IosSection footer={r.hint}>
              <SwitchRow label="In the app" checked={inApp[r.topic] ?? true} onChange={(on) => void set({ inApp: { ...inApp, [r.topic]: on } })} />
              <SwitchRow label="By email" checked={emailOn(prefs, r.topic)} onChange={(on) => void set(emailPatch(r.topic, on))} />
            </IosSection>
          </Subscreen>
        ))}
        {hasVault ? (
          <IosSection header="Vault" footer={VAULT_HINT}>
            <SwitchRow label="Changes in the Vault" checked={vaultOn} onChange={setVault} />
          </IosSection>
        ) : null}
        <IosSection header="Email delivery" footer="The daily digest lists what you haven't read yet, by page title only, once a day. Shares, invitations and access changes are always sent as they happen.">
          <ChoiceRow
            screen="digest"
            label="Comment emails"
            value={prefs.digest}
            choices={[
              { value: "off", label: "As they happen" },
              { value: "daily", label: "In a daily digest" },
            ]}
            onChange={(v) => void set({ digest: v as Prefs["digest"] })}
          />
        </IosSection>
        <IosSection header="Muted notes" footer="Nobody is ever notified about their own actions, or about pages they can't open.">
          <IosText muted>To stop hearing about comments on one note, open its … menu and choose Mute comment notifications. You&apos;ll still hear when someone @mentions you there. Follow a note the same way to hear about every comment on it.</IosText>
        </IosSection>
      </>
    );
  return (
    <div className="space-y-5">
      <Card
        title="Notifications"
        description="Choose what reaches you in the app (the bell) and by email. Emails say who did what and where, with a link. They never include your notes or comment text; a reminder shows only its own to-do line. Security emails (new sign-ins, account deletion) can't be turned off."
      >
        <div role="table" aria-label="Notification preferences" className="max-w-xl">
          <div role="row" className="grid grid-cols-[1fr_72px_72px] items-end gap-2 border-b border-line pb-2 text-footnote font-medium text-muted">
            <span role="columnheader">Notify me about</span>
            <span role="columnheader" className="text-center">
              In app
            </span>
            <span role="columnheader" className="text-center">
              Email
            </span>
          </div>
          {ROWS.map((r) => (
            <div key={r.topic} role="row" className="grid grid-cols-[1fr_72px_72px] items-center gap-2 border-b border-line/70 py-3 last:border-b-0">
              <span role="rowheader" className="min-w-0">
                <span className="block text-subheadline text-ink">{r.label}</span>
                <span id={`notify-${r.topic}-hint`} className="block text-footnote text-muted">
                  {r.hint}
                </span>
              </span>
              <span role="cell" className="flex justify-center">
                <Switch checked={inApp[r.topic] ?? true} label={`${r.label} in the app`} describedBy={`notify-${r.topic}-hint`} onChange={(on) => void set({ inApp: { ...inApp, [r.topic]: on } })} />
              </span>
              <span role="cell" className="flex justify-center">
                <Switch checked={emailOn(prefs, r.topic)} label={`${r.label} by email`} describedBy={`notify-${r.topic}-hint`} onChange={(on) => void set(emailPatch(r.topic, on))} />
              </span>
            </div>
          ))}
          {hasVault ? (
            <div role="row" className="grid grid-cols-[1fr_72px_72px] items-center gap-2 border-t border-line/70 py-3">
              <span role="rowheader" className="min-w-0">
                <span className="block text-subheadline text-ink">Vault</span>
                <span id="notify-vault-hint" className="block text-footnote text-muted">
                  {VAULT_HINT}
                </span>
              </span>
              <span role="cell" className="flex justify-center">
                <Switch checked={vaultOn} label="Vault in the app" describedBy="notify-vault-hint" onChange={setVault} />
              </span>
              <span role="cell" className="text-center text-footnote text-faint">
                Not yet
              </span>
            </div>
          ) : null}
        </div>
      </Card>
      <PushCard />
      <Card title="Email delivery" description="How comment, reply and mention emails arrive. Shares, invitations and access changes are always sent as they happen.">
        <div className="flex max-w-xl items-center justify-between gap-4">
          <label htmlFor="notify-digest" className="text-subheadline">
            Send comment emails
            <span className="block text-footnote text-muted">The daily digest lists what you haven’t read yet, by page title only, once a day.</span>
          </label>
          <Select id="notify-digest" value={prefs.digest} onChange={(e) => void set({ digest: e.target.value as Prefs["digest"] })} className="ui-input h-9 w-44 flex-none rounded-chip px-3 text-callout">
            <option value="off">As they happen</option>
            <option value="daily">In a daily digest</option>
          </Select>
        </div>
      </Card>
      <Card title="Muted notes" description="To stop hearing about comments on one note, open its … menu and choose Mute comment notifications. You’ll still hear when someone @mentions you there. Follow a note the same way to hear about every comment on it.">
        <p className="text-footnote text-muted">Nobody is ever notified about their own actions, or about pages they can’t open.</p>
      </Card>
    </div>
  );
}
