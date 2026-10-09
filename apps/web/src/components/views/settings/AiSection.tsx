"use client";

import { useId } from "react";
import { useMutation } from "convex/react";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { Switch } from "@/components/ui/Switch";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { useAiAccess } from "@/components/ai/useAi";
import { Card } from "./Card";
import { AiSettingCard } from "./AccountSection";
import { AiMemoryCard } from "./AiMemory";
import { AiDigestCard } from "./AiDigest";
import { AiUsageCard } from "./AiUsage";
import { AiExportCard } from "./AiExport";

type PrefKey = "history" | "memory" | "suggestions" | "attachments" | "webResearch" | "digests";
type Prefs = Record<PrefKey, boolean>;

/** What each setting does, in a sentence. "soon" marks one whose feature hasn't arrived yet. */
const SETTINGS: { key: PrefKey; label: string; body: string; on: string; off: string; soon?: boolean }[] = [
  {
    key: "history",
    label: "Keep conversations",
    body: "Your AI conversations are saved so you can come back to them, rename, pin and search them. Only you can see them, unless you share one with your workspace. When this is off, a conversation is deleted as soon as you close it. Conversations you already have stay until you delete them.",
    on: "Conversations are kept",
    off: "New conversations aren't kept",
  },
  {
    key: "memory",
    label: "Memory",
    body: "Let the assistant remember things you approve, like the tone you like or words you use. You'll see and edit everything it remembers below.",
    on: "Memory turned on",
    off: "Memory turned off",
  },
  {
    key: "suggestions",
    label: "Suggestions",
    body: "Quiet hints at the end of a note, such as related notes, possible duplicates, open questions and action items. They're found without sending anything to AI.",
    on: "Suggestions turned on",
    off: "Suggestions turned off",
  },
  {
    key: "attachments",
    label: "Read attachments",
    body: "Let the assistant read files you add to a question, such as PDFs, images, text and spreadsheets, and transcribe recordings when you ask. Files are only read when you send them.",
    on: "Attachments turned on",
    off: "Attachments turned off",
  },
  {
    key: "webResearch",
    label: "Web research",
    body: "Let the assistant search the web and read pages you link when you ask it to, with links to what it found. This also turns on Research. Searches go through Google Search.",
    on: "Web research turned on",
    off: "Web research turned off",
  },
  {
    key: "digests",
    label: "Digests",
    body: "A daily or weekly summary of what changed in your notes, saved as a note in your Inbox. It uses your AI credits and is never emailed.",
    on: "Digests turned on",
    off: "Digests turned off",
  },
];

const DEFAULTS: Prefs = { history: true, memory: true, suggestions: true, attachments: true, webResearch: true, digests: false };

function PrefRow({ item, checked, disabled, onChange }: { item: (typeof SETTINGS)[number]; checked: boolean; disabled: boolean; onChange: (next: boolean) => void }) {
  const descId = useId();
  return (
    <div className="flex max-w-xl items-start justify-between gap-6 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <p className="flex items-center gap-2 text-sm font-medium text-heading">
          {item.label}
          {item.soon ? <span className="rounded-full bg-[var(--glass-hover)] px-2 py-0.5 text-[11px] font-medium text-muted shadow-[inset_0_0_0_1px_var(--glass-border)]">Coming soon</span> : null}
        </p>
        <p id={descId} className="mt-0.5 text-sm text-muted">
          {item.body}
        </p>
      </div>
      <Switch checked={checked} disabled={disabled} label={item.label} describedBy={descId} onChange={onChange} />
    </div>
  );
}

/** Settings > AI: the assistant on or off, and how it works for you. The server enforces each one. */
export function AiSection() {
  const { profile } = useAppState();
  const { personalCore: core } = useAiAccess();
  const update = useMutation(api.users.updateProfile);
  const saveDigest = useMutation(api.aiDigest.save);
  const toast = useToast();
  const prefs: Prefs = { ...DEFAULTS, ...((profile as { aiPrefs?: Partial<Prefs> }).aiPrefs ?? {}) };
  const set = (item: (typeof SETTINGS)[number], next: boolean) => {
    // Digests also schedule (or stop) the next one on the server.
    const saved = item.key === "digests" ? saveDigest({ enabled: next }) : update({ aiPrefs: { [item.key]: next } });
    void saved.then(
      () => toast.show(next ? item.on : item.off),
      (e) => toast.show(errorMessage(e), { tone: "error" }),
    );
  };
  return (
    <>
      <AiSettingCard />
      <AiUsageCard />
      <Card title="Conversations">
        <PrefRow item={SETTINGS[0]!} checked={prefs.history} disabled={core} onChange={(next) => set(SETTINGS[0]!, next)} />
      </Card>
      <Card title="How the assistant works for you" description="The server checks each of these wherever the feature runs.">
        <div className="divide-y divide-line/70">
          {SETTINGS.slice(1).map((item) => (
            <PrefRow key={item.key} item={item} checked={prefs[item.key]} disabled={core} onChange={(next) => set(item, next)} />
          ))}
        </div>
      </Card>
      <AiMemoryCard />
      <AiDigestCard />
      <AiExportCard />
    </>
  );
}
