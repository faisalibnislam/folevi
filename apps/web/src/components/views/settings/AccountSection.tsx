"use client";

import { useConvex, useMutation } from "convex/react";
import { useId, useMemo, useState } from "react";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { Button } from "@/components/ui/Button";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { Card } from "./Card";
import { Select } from "@/components/ui/Select";
import { uploadIdentityImage } from "@/lib/app/identityImages";
import { IdentityImageField } from "./IdentityImageField";
import { IdentityImageRows } from "@/components/iphone/IdentityImageRows";
import { useIphoneLook } from "@/lib/iphone";
import { ChoiceRow, IosRow, IosSection, SwitchRow, TextRow } from "@/components/iphone/SettingsKit";
import { RowIcon } from "@/components/iphone/Grouped";
import { Sparkles } from "lucide-react";
import { Switch } from "@/components/ui/Switch";
import { useAiAccess } from "@/components/ai/useAi";
import { AppLink } from "@/lib/app/router";
import { canPurchaseHere } from "@/lib/nativeApp";

export function AccountSection() {
  const { profile, timeZone } = useAppState();
  const convex = useConvex();
  const update = useMutation(api.users.updateProfile);
  const setAvatar = useMutation(api.users.setAvatar);
  const removeAvatar = useMutation(api.users.removeAvatar);
  const toast = useToast();
  const [name, setName] = useState(profile.displayName);
  const iphone = useIphoneLook();
  // About 400 zones: built once per change of zone, not on every keystroke in the name field.
  const zoneField = useMemo(() => {
    const zones = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [timeZone];
    return (
      <Select value={timeZone} onChange={(e) => void update({ timeZone: e.target.value })} className="h-9 w-full ui-input rounded-chip px-3">
        {zones.map((z) => (
          <option key={z} value={z}>
            {z}
          </option>
        ))}
      </Select>
    );
  }, [timeZone, update]);
  if (iphone) {
    const zones = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [timeZone];
    return (
      <>
        <IdentityImageRows
          label="Profile picture"
          shape="circle"
          src={profile.avatarUrl ?? null}
          initial={profile.displayName}
          name={profile.displayName || "Your name"}
          detail={profile.email}
          onUpload={async (file) => {
            const fileId = await uploadIdentityImage(convex, { kind: "avatar", file });
            await setAvatar({ fileId });
          }}
          onRemove={async () => {
            await removeAvatar({});
          }}
        />
        <IosSection header="Profile" footer="Your email is your sign-in address. Contact support to change it.">
          <TextRow
            label="Name"
            value={name}
            maxLength={80}
            autoComplete="name"
            onChange={setName}
            onCommit={(v) => {
              const next = v.trim();
              if (!next || next === profile.displayName) return;
              update({ displayName: next }).then(() => toast.show("Saved", { tone: "success" }), (err) => toast.show(errorMessage(err), { tone: "error" }));
            }}
          />
          <IosRow label="Email" value={profile.email} />
        </IosSection>
        <IosSection footer="Used for Today, the calendar and reminders.">
          <ChoiceRow screen="time-zone" label="Time zone" value={timeZone} filter choices={zones.map((z) => ({ value: z, label: z.replace(/_/g, " ") }))} onChange={(z) => void update({ timeZone: z })} />
        </IosSection>
        <AiSettingCard />
      </>
    );
  }
  return (
    <>
      <Card title="Profile">
        <div className="mb-5">
          <p className="mb-2 text-sm font-medium">Profile picture</p>
          <IdentityImageField
            label="Profile picture"
            shape="circle"
            src={profile.avatarUrl ?? null}
            initial={profile.displayName}
            onUpload={async (file) => {
              // The server stores it in your Personal (your personal storage), whichever context is open.
              const fileId = await uploadIdentityImage(convex, { kind: "avatar", file });
              await setAvatar({ fileId });
            }}
            onRemove={async () => {
              await removeAvatar({});
            }}
          />
        </div>
        <form
          className="grid gap-4 sm:max-w-md"
          onSubmit={(e) => {
            e.preventDefault();
            update({ displayName: name }).then(() => toast.show("Saved", { tone: "success" }), (err) => toast.show(errorMessage(err), { tone: "error" }));
          }}
        >
          <label className="text-sm">
            <span className="mb-1 block font-medium">Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className="h-9 w-full ui-input rounded-chip px-3" />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium">Email</span>
            <input value={profile.email} readOnly aria-describedby="email-hint" className="h-9 w-full ui-well rounded-chip px-3 text-muted" />
            <span id="email-hint" className="mt-1 block text-xs text-muted">
              Your sign-in address. Contact support to change it.
            </span>
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium">Time zone</span>
            {zoneField}
            <span className="mt-1 block text-xs text-muted">Used for Today, the calendar and reminders.</span>
          </label>
          <div>
            <Button type="submit" variant="primary">
              Save
            </Button>
          </div>
        </form>
      </Card>
      <AiSettingCard />
    </>
  );
}

/** Turns the AI assistant on or off for this person (the server enforces it). */
export function AiSettingCard() {
  // Your own setting and Personal plan. Core has no AI, so there's nothing to turn on.
  const { setting: on, personalCore: core } = useAiAccess();
  const update = useMutation(api.users.updateProfile);
  const toast = useToast();
  const descId = useId();
  const iphone = useIphoneLook();
  const turn = (next: boolean) => {
    void update({ aiEnabled: next }).then(
      () => toast.show(next ? "Foli AI turned on" : "Foli AI turned off"),
      (e) => toast.show(errorMessage(e), { tone: "error" }),
    );
  };
  if (iphone)
    return (
      <IosSection
        footer={
          core
            ? "Not included in Core. Your notes stay yours: nothing is sent to an AI model. Pro and Pro AI include Foli AI."
            : "Foli AI answers from your notes, helps you write and sums notes up, powered by Google Gemini. When you use it, your request and the notes it needs are sent to Google; nothing is sent while it's off, and Foli AI's buttons are hidden."
        }
      >
        <SwitchRow label="Foli AI" icon={<RowIcon><Sparkles /></RowIcon>} checked={on && !core} disabled={core} onChange={turn} />
      </IosSection>
    );
  return (
    <Card title="Foli AI">
      <div className="flex items-start justify-between gap-6">
        <p id={descId} className="max-w-prose text-sm text-muted">
          {core ? (
            <>
              <span className="font-medium text-heading">Not included in Core.</span> Your notes stay yours: nothing is sent to an AI model. Pro and Pro AI include Foli AI.{" "}
              {canPurchaseHere() ? (
                <AppLink href="/settings/billing" className="underline underline-offset-2">
                  See plans
                </AppLink>
              ) : null}
            </>
          ) : (
            "Foli AI answers from your notes, helps you write and sums notes up, powered by Google Gemini. When you use it, your request and the notes it needs are sent to Google; nothing is sent while it's off, and Foli AI's buttons are hidden."
          )}
        </p>
        <Switch
          checked={on && !core}
          disabled={core}
          label="Foli AI"
          describedBy={descId}
          onChange={turn}
        />
      </div>
    </Card>
  );
}
