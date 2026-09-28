"use client";

import { useConvex, useMutation } from "convex/react";
import { useId, useState } from "react";
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

export function AccountSection() {
  const { profile, timeZone, workspace } = useAppState();
  const convex = useConvex();
  const update = useMutation(api.users.updateProfile);
  const setAvatar = useMutation(api.users.setAvatar);
  const removeAvatar = useMutation(api.users.removeAvatar);
  const toast = useToast();
  const [name, setName] = useState(profile.displayName);
  const zones = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [timeZone];
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
              // The server stores it in your personal workspace whatever workspace is open.
              const fileId = await uploadIdentityImage(convex, { kind: "avatar", workspaceId: workspace.id, file });
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
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className="h-9 w-full ui-input rounded-[6px] px-3" />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium">Email</span>
            <input value={profile.email} readOnly aria-describedby="email-hint" className="h-9 w-full ui-well rounded-[6px] px-3 text-muted" />
            <span id="email-hint" className="mt-1 block text-xs text-muted">
              Your sign-in address. Contact support to change it.
            </span>
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium">Time zone</span>
            <Select value={timeZone} onChange={(e) => void update({ timeZone: e.target.value })} className="h-9 w-full ui-input rounded-[6px] px-3">
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </Select>
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
function AiSettingCard() {
  const { setting: on, entitled } = useAiAccess();
  const update = useMutation(api.users.updateProfile);
  const toast = useToast();
  const descId = useId();
  return (
    <Card title="AI Assistant">
      <div className="flex max-w-xl items-start justify-between gap-6">
        <p id={descId} className="text-sm text-muted">
          Ask AI, writing help and note summaries, powered by Google Gemini. When you use it, your request and the notes it needs are sent to Google; nothing is sent while it's off, and all AI buttons are hidden.
          {!entitled ? (
            <>
              {" "}
              <span className="font-medium text-heading">AI is part of Pro.</span>{" "}
              <a href="/settings/billing" className="underline underline-offset-2">
                See plans
              </a>
            </>
          ) : null}
        </p>
        <Switch
          checked={on}
          label="AI Assistant"
          describedBy={descId}
          onChange={(next) => {
            void update({ aiEnabled: next }).then(
              () => toast.show(next ? "AI Assistant turned on" : "AI Assistant turned off"),
              (e) => toast.show(errorMessage(e), { tone: "error" }),
            );
          }}
        />
      </div>
    </Card>
  );
}
