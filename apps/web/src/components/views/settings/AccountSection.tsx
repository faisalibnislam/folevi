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
import { Switch } from "@/components/ui/Switch";
import { useAiAccess } from "@/components/ai/useAi";
import { AppLink } from "@/lib/app/router";

export function AccountSection() {
  const { profile, timeZone } = useAppState();
  const convex = useConvex();
  const update = useMutation(api.users.updateProfile);
  const setAvatar = useMutation(api.users.setAvatar);
  const removeAvatar = useMutation(api.users.removeAvatar);
  const toast = useToast();
  const [name, setName] = useState(profile.displayName);
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
  return (
    <Card title="Foli">
      <div className="flex items-start justify-between gap-6">
        <p id={descId} className="max-w-prose text-sm text-muted">
          {core ? (
            <>
              <span className="font-medium text-heading">Not included in Core.</span> Your notes stay yours: nothing is sent to an AI model. Pro and Pro AI include Foli.{" "}
              <AppLink href="/settings/billing" className="underline underline-offset-2">
                See plans
              </AppLink>
            </>
          ) : (
            "Foli answers from your notes, helps you write and sums notes up, powered by Google Gemini. When you use it, your request and the notes it needs are sent to Google; nothing is sent while it's off, and Foli's buttons are hidden."
          )}
        </p>
        <Switch
          checked={on && !core}
          disabled={core}
          label="Foli"
          describedBy={descId}
          onChange={(next) => {
            void update({ aiEnabled: next }).then(
              () => toast.show(next ? "Foli turned on" : "Foli turned off"),
              (e) => toast.show(errorMessage(e), { tone: "error" }),
            );
          }}
        />
      </div>
    </Card>
  );
}
