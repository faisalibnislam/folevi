"use client";

import { useId, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { AppLink } from "@/lib/app/router";
import { Select } from "@/components/ui/Select";
import { Switch } from "@/components/ui/Switch";
import { Button } from "@/components/ui/Button";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { Card } from "./Card";
import { hourLabel, nextLabel } from "./AiDigest";
import { canPurchaseHere } from "@/lib/nativeApp";
import { useIphoneLook } from "@/lib/iphone";
import { useAppRouter } from "@/lib/app/router";
import { ActionRow, ChoiceRow, IosRow, IosSection, Subscreen, SwitchRow } from "@/components/iphone/SettingsKit";

type Routine = FunctionReturnType<typeof api.routines.list>["routines"][number];
type SaveArgs = FunctionArgs<typeof api.routines.save>;

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
/** Monday first, as most calendars here show it. */
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

/** What each routine does, in a sentence. */
const DESCRIPTIONS: Record<Routine["kind"], string> = {
  morning: "Every morning, a short note with your to-dos due today, what other people changed and their new comments. Skipped when there's nothing to tell.",
  openLoops: "Once a week, up to 7 things left open: old and overdue to-dos, questions in notes you edited and contradictions between notes, each linking to its line.",
};

const credits = (n: number) => `${n} ${n === 1 ? "credit" : "credits"}`;

/** "About 2 credits a run, up to 62 a month. Capped at 30 a month." */
export function estimateSentence(r: Pick<Routine, "estimate" | "monthlyCap">): string {
  return `About ${credits(r.estimate.perRun)} a run, up to ${r.estimate.perMonth} a month. Capped at ${r.monthlyCap} a month.`;
}

function RoutineRow({ routine: r, capChoices, timeZone }: { routine: Routine; capChoices: number[]; timeZone: string }) {
  const { workspaces, profile } = useAppState();
  const save = useMutation(api.routines.save);
  const runNow = useMutation(api.routines.runNow);
  const toast = useToast();
  const [running, setRunning] = useState(false);
  const descId = useId();
  const locale = (profile as { locale?: string }).locale;
  const places = workspaces.filter((w) => w.canEdit !== false);
  const where = r.context.kind === "workspace" ? r.context.workspaceId : "personal";
  const change = (patch: Omit<SaveArgs, "kind">, done = `${r.name} saved`) =>
    void save({ kind: r.kind, ...patch }).then(
      () => toast.show(done),
      (e) => toast.show(errorMessage(e), { tone: "error" }),
    );
  const run = () => {
    setRunning(true);
    void runNow({ kind: r.kind })
      .then(
        () => toast.show(`${r.name} started. It lands in your Inbox in a minute if there's anything to tell.`),
        (e) => toast.show(errorMessage(e), { tone: "error" }),
      )
      .finally(() => setRunning(false));
  };
  const locked = !r.available;
  const iphone = useIphoneLook();
  const { navigate } = useAppRouter();
  if (iphone) {
    const screen = `routine-${r.kind}`;
    const status = `Used ${r.spent} of ${credits(r.monthlyCap)} this month. ${r.nextAt ? `Next one: ${nextLabel(r.nextAt, timeZone, locale)} (${timeZone}).` : "Not scheduled yet."}`;
    return (
      <>
        <IosRow label={r.name} value={r.enabled ? "On" : "Off"} screen={screen} />
        <Subscreen id={screen} title={r.name}>
          <IosSection footer={`${DESCRIPTIONS[r.kind]} ${estimateSentence(r)}`}>
            <SwitchRow label={r.name} checked={r.enabled} disabled={locked && !r.enabled} onChange={(next) => change({ enabled: next }, next ? `${r.name} turned on` : `${r.name} turned off`)} />
          </IosSection>
          {r.enabled ? (
            <>
              <IosSection header="When and what" footer={status}>
                {r.kind === "openLoops" ? (
                  <ChoiceRow screen={`${screen}.day`} label="Day" value={String(r.weekday)} choices={DAY_ORDER.map((d) => ({ value: String(d), label: DAYS[d]! }))} onChange={(v) => change({ weekday: Number(v) })} />
                ) : null}
                <ChoiceRow screen={`${screen}.time`} label="Time" value={String(r.hour)} choices={Array.from({ length: 24 }, (_, h) => ({ value: String(h), label: hourLabel(h, locale) }))} onChange={(v) => change({ hour: Number(v) })} />
                <ChoiceRow
                  screen={`${screen}.about`}
                  label="About"
                  value={where}
                  choices={[{ value: "personal", label: "Personal" }, ...places.map((w) => ({ value: w.id, label: w.name }))]}
                  onChange={(v) => change({ scope: v === "personal" ? { kind: "personal" } : { kind: "workspace", workspaceId: v } })}
                />
                <ChoiceRow screen={`${screen}.cap`} label="Monthly limit" value={String(r.monthlyCap)} choices={capChoices.map((c) => ({ value: String(c), label: credits(c) }))} onChange={(v) => change({ monthlyCap: Number(v) })} />
              </IosSection>
              <IosSection>
                <ActionRow label="Run now" busy={running ? "Starting…" : null} disabled={locked} onClick={run} />
                {r.lastNoteId ? <IosRow label="Open the last one" chevron onClick={() => navigate(`/d/${r.lastNoteId}`)} /> : null}
              </IosSection>
            </>
          ) : null}
        </Subscreen>
      </>
    );
  }
  return (
    <div className="py-3.5 first:pt-0 last:pb-0">
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0 max-w-prose">
          <p className="text-subheadline font-medium text-heading">{r.name}</p>
          <p id={descId} className="mt-0.5 text-subheadline text-muted">
            {DESCRIPTIONS[r.kind]}
          </p>
          <p className="mt-1 text-subheadline text-muted">{estimateSentence(r)}</p>
        </div>
        <span className="mt-0.5 flex-none">
          <Switch checked={r.enabled} disabled={locked && !r.enabled} label={r.name} describedBy={descId} onChange={(next) => change({ enabled: next }, next ? `${r.name} turned on` : `${r.name} turned off`)} />
        </span>
      </div>
      {r.enabled ? (
        <>
          <div className="mt-3 grid max-w-xl gap-3 sm:grid-cols-2">
            {r.kind === "openLoops" ? (
              <label className="space-y-1 text-subheadline">
                <span className="block font-medium text-heading">Day</span>
                <Select value={String(r.weekday)} onChange={(e) => change({ weekday: Number(e.target.value) })} aria-label={`${r.name} day`} className="ui-input h-9 rounded-chip px-3 text-callout w-full">
                  {DAY_ORDER.map((d) => (
                    <option key={d} value={String(d)}>
                      {DAYS[d]}
                    </option>
                  ))}
                </Select>
              </label>
            ) : null}
            <label className="space-y-1 text-subheadline">
              <span className="block font-medium text-heading">Time</span>
              <Select value={String(r.hour)} onChange={(e) => change({ hour: Number(e.target.value) })} aria-label={`${r.name} time`} className="ui-input h-9 rounded-chip px-3 text-callout w-full">
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={String(h)}>
                    {hourLabel(h, locale)}
                  </option>
                ))}
              </Select>
            </label>
            <label className="space-y-1 text-subheadline">
              <span className="block font-medium text-heading">About</span>
              <Select value={where} onChange={(e) => change({ scope: e.target.value === "personal" ? { kind: "personal" } : { kind: "workspace", workspaceId: e.target.value } })} aria-label={`${r.name} about`} className="ui-input h-9 rounded-chip px-3 text-callout w-full">
                <option value="personal">Personal</option>
                {places.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </Select>
            </label>
            <label className="space-y-1 text-subheadline">
              <span className="block font-medium text-heading">Monthly limit</span>
              <Select value={String(r.monthlyCap)} onChange={(e) => change({ monthlyCap: Number(e.target.value) })} aria-label={`${r.name} monthly limit`} className="ui-input h-9 rounded-chip px-3 text-callout w-full">
                {capChoices.map((c) => (
                  <option key={c} value={String(c)}>
                    {credits(c)}
                  </option>
                ))}
              </Select>
            </label>
          </div>
          <p className="mt-3 text-subheadline text-muted">
            Used {r.spent} of {credits(r.monthlyCap)} this month.{" "}
            {r.nextAt ? `Next one: ${nextLabel(r.nextAt, timeZone, locale)} (${timeZone}).` : "Not scheduled yet."}
            {r.lastNoteId ? (
              <>
                {" "}
                <AppLink href={`/d/${r.lastNoteId}`} className="font-medium text-heading underline underline-offset-2">
                  Open the last one
                </AppLink>
              </>
            ) : null}
          </p>
          <div className="mt-3">
            <Button size="sm" onClick={run} disabled={running || locked}>
              Run now
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}

/**
 * Settings > AI: Foli AI routines (the Morning brief and Open loops), on Pro and Pro AI. Each shows what it
 * would cost before it's turned on; each change saves at once, and the server works out when it's next due.
 */
export function AiRoutinesCard() {
  const { profile } = useAppState();
  const data = useQuery(api.routines.list, {});
  const iphone = useIphoneLook();
  if ((profile as { aiEnabled?: boolean }).aiEnabled === false || !data) return null;
  const locked = data.routines.every((r) => !r.available);
  if (iphone)
    return (
      <IosSection header="Routines" footer={`Foli AI writes a new note in your Inbox on a schedule and lets you know. Each run uses AI credits, up to the monthly limit you pick.${locked ? " Routines are part of Pro and Pro AI." : ""}`}>
        {data.routines.map((r) => (
          <RoutineRow key={r.kind} routine={r} capChoices={data.capChoices} timeZone={data.timeZone} />
        ))}
      </IosSection>
    );
  return (
    <Card title="Routines" description="Foli AI writes a new note in your Inbox on a schedule and lets you know. Each run uses AI credits, up to the monthly limit you pick.">
      {locked ? (
        <p className="mb-3 text-subheadline text-muted">
          Routines are part of Pro and Pro AI.{" "}
          {canPurchaseHere() ? (
            <AppLink href="/settings/billing" className="font-medium text-heading underline underline-offset-2">
              See plans
            </AppLink>
          ) : null}
        </p>
      ) : null}
      <div className="divide-y divide-line/70">
        {data.routines.map((r) => (
          <RoutineRow key={r.kind} routine={r} capChoices={data.capChoices} timeZone={data.timeZone} />
        ))}
      </div>
    </Card>
  );
}
