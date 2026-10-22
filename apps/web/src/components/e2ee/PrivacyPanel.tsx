"use client";

import { useId, useState } from "react";
import { KeyRound, LockKeyhole, MoreHorizontal, Plus, ScrollText, ShieldCheck, Smartphone, TriangleAlert } from "lucide-react";
import type { WireScope } from "@folevi/editor-schema";
import { Card } from "@/components/views/settings/Card";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { MenuButton, type MenuItem } from "@/components/ui/Menu";
import { Select } from "@/components/ui/Select";
import { Switch } from "@/components/ui/Switch";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { useRadioGroup } from "@/lib/a11y/radioGroup";
import { AppLink } from "@/lib/app/router";
import { useAppState } from "@/lib/app/state";
import { desktop } from "@/lib/desktop";
import { formatRelative } from "@/lib/format";
import { copy, e2eeErrorMessage, type LevelId, type SwitchId } from "@/lib/e2ee/copy";
import { setup, useKeySession, type MethodSummary } from "@/lib/e2ee/keys";
import { DEFAULT_SWITCHES, useE2eeActions, useE2eeSpace, useE2eeSpaceStatus, type Switches } from "./hooks";
import { WhatEachChoiceMeans } from "./WhatEachChoiceMeans";
import { SetupWizard, PassphraseForm, pendingWizard } from "./SetupWizard";
import { LowerLevelDialog } from "./LowerLevelDialog";
import { MigrationRow } from "./MigrationProgress";
import { RecoveryKeyPanel } from "./RecoveryKeyPanel";

const LEVELS: LevelId[] = ["standard", "selected", "full"];
const LEVEL_ICON: Record<LevelId, React.ReactNode> = {
  standard: <ShieldCheck size={18} aria-hidden />,
  selected: <LockKeyhole size={18} aria-hidden />,
  full: <LockKeyhole size={18} aria-hidden strokeWidth={2.4} />,
};
const SWITCH_ROWS: Exclude<SwitchId, "foliAi">[] = ["backgroundAi", "searchEverywhere", "apps", "emailToNote", "webClipper", "notificationPreviews"];

/**
 * The level, the switches, the ways to unlock and the migration's progress for one space (§10.1, §10.2):
 * Settings > Privacy for Personal, Settings > Workspace > Privacy for a workspace (members read only).
 */
export function PrivacyPanel({ scope, workspaceName = null, canChange = true }: { scope: WireScope; workspaceName?: string | null; canChange?: boolean }) {
  const status = useE2eeSpaceStatus(scope);
  const space = useE2eeSpace(scope);
  const { state } = useKeySession();
  // The server's row is the truth for this screen (this device's router may not have the space yet).
  const current: LevelId = space?.level ?? status.level;
  const switches = space?.switches ?? status.switches;
  // A wizard the app remounted under (creating the keys swaps the Convex client) opens again where it was.
  const [picked, setPicked] = useState<LevelId | null>(() => pendingWizard(scope, "space")?.level ?? null);
  const choice = picked ?? current;
  const [meaning, setMeaning] = useState(false);
  const [wizard, setWizard] = useState(() => pendingWizard(scope, "space") !== null);
  const [lowering, setLowering] = useState(false);
  const group = useRadioGroup();
  const p = copy.privacy;
  const changing = choice !== current;
  return (
    <>
      <Card title={p.cardTitle}>
        <div role="radiogroup" aria-label={p.cardTitle} ref={group.ref} onKeyDown={group.onKeyDown} className="grid gap-2">
          {LEVELS.map((level) => {
            const on = choice === level;
            return (
              <button
                key={level}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={!canChange}
                onClick={() => setPicked(level)}
                className={`flex items-start gap-3 rounded-control border p-4 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-default ${
                  on ? "border-heading bg-[var(--glass-active)] shadow-[var(--glass-edge),0_1px_3px_rgb(0_0_0/0.06)]" : "border-line hover:bg-[var(--glass-hover)] disabled:hover:bg-transparent"
                }`}
              >
                <span aria-hidden className={`mt-0.5 grid h-4 w-4 flex-none place-items-center rounded-tiny ${on ? "bg-heading" : "shadow-[inset_0_0_0_1.5px_color-mix(in_oklab,var(--color-ink)_35%,transparent)]"}`}>
                  {on ? <span className="h-1.5 w-1.5 rounded-tiny bg-canvas" /> : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2 text-sm font-semibold text-heading">
                    <span className="text-muted">{LEVEL_ICON[level]}</span>
                    {p.levels[level].title}
                    {level === current ? <span className="ui-chip h-5 bg-[color-mix(in_oklab,var(--color-ink)_10%,transparent)] px-1.5 text-[11px] font-medium text-ink">{p.current}</span> : null}
                  </span>
                  <span className="mt-1 block text-[13px] leading-snug text-muted">{p.levels[level].body}</span>
                </span>
              </button>
            );
          })}
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <button type="button" onClick={() => setMeaning(true)} className="inline-flex h-8 items-center rounded-chip px-1 text-[13px] font-medium text-heading underline decoration-line-strong underline-offset-2 outline-none hover:decoration-heading focus-visible:ring-2 focus-visible:ring-focus pointer-coarse:h-11">
            {p.whatEachMeans}
          </button>
          {changing && canChange ? (
            <span className="flex gap-2">
              <Button onClick={() => setPicked(null)}>{copy.wizard.cancel}</Button>
              <Button variant={choice === "standard" ? "danger" : "primary"} onClick={() => (current === "standard" ? setWizard(true) : setLowering(true))}>
                {current === "standard" ? p.turnOn : p.changeTo(choice)}
              </Button>
            </span>
          ) : null}
        </div>
        {current === "standard" && state === "none" && !workspaceName ? <p className="mt-3 text-[13px] text-muted">{p.lockHint}</p> : null}
        {space && space.lockedCount > 0 ? <p className="mt-3 text-[13px] text-muted">{p.lockedCount(space.lockedCount)}</p> : null}
      </Card>

      <MigrationRow scope={scope} />

      {current === "selected" ? <SwitchesCard scope={scope} switches={switches} canChange={canChange} /> : null}

      {workspaceName && space && current !== "standard" ? (
        <Card title={p.keyHolders(space.keyHolders)}>
          {space.keyHolders <= 1 ? (
            <p role="note" className="flex items-start gap-2 rounded-control bg-[var(--glass-hover)] p-3 text-[13px] text-ink">
              <TriangleAlert size={15} aria-hidden className="mt-0.5 flex-none" />
              <span>{p.keyHolderWarning}</span>
            </p>
          ) : (
            <p className="text-[13px] text-muted">{copy.invite.encryptedWorkspace}</p>
          )}
        </Card>
      ) : null}

      {!workspaceName && state !== "none" ? <MethodsCard /> : null}

      <WhatEachChoiceMeans open={meaning} onClose={() => setMeaning(false)} />
      {wizard && choice !== "standard" ? (
        <SetupWizard open onClose={() => setWizard(false)} scope={scope} workspaceName={workspaceName} level={choice} switches={DEFAULT_SWITCHES} onDone={() => setPicked(null)} />
      ) : null}
      <LowerLevelDialog open={lowering} onClose={() => setLowering(false)} scope={scope} to={choice} onDone={() => setPicked(null)} />
    </>
  );
}

function SwitchesCard({ scope, switches, canChange }: { scope: WireScope; switches: Switches; canChange: boolean }) {
  const toast = useToast();
  const actions = useE2eeActions();
  const uid = useId();
  const s = copy.switches;
  const save = (next: Switches, label: string, turnedOff: boolean) => {
    if (turnedOff) toast.show(copy.privacy.switchOffDeleting);
    void actions.setSwitches(scope, next).then(
      () => toast.show(turnedOff ? copy.privacy.switchOffDone : copy.privacy.switchOn(label), { tone: "success" }),
      (e) => toast.show(errorMessage(e), { tone: "error" }),
    );
  };
  return (
    <Card title={copy.privacy.switchesTitle}>
      <div className="divide-y divide-line/70">
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2 py-3.5 first:pt-0">
          <div className="min-w-0 max-w-prose flex-1">
            <p id={`${uid}-foliAi`} className="text-sm font-medium text-heading">
              {s.foliAi.label}
            </p>
            <p id={`${uid}-foliAi-desc`} className="mt-0.5 text-sm text-muted">
              {s.foliAi.body}
            </p>
          </div>
          <Select
            aria-labelledby={`${uid}-foliAi`}
            aria-describedby={`${uid}-foliAi-desc`}
            value={switches.foliAi}
            disabled={!canChange}
            onChange={(e) => {
              const v = e.target.value as Switches["foliAi"];
              save({ ...switches, foliAi: v }, s.foliAi.label, v === "off" && switches.foliAi !== "off");
            }}
            className="h-9 ui-input rounded-control px-3 text-sm pointer-coarse:h-11"
          >
            <option value="off">{s.foliAi.options.off}</option>
            <option value="ask">{s.foliAi.options.ask}</option>
            <option value="auto">{s.foliAi.options.auto}</option>
          </Select>
        </div>
        {SWITCH_ROWS.map((key) => (
          <div key={key} className="flex items-start justify-between gap-6 py-3.5 last:pb-0">
            <div className="min-w-0 max-w-prose">
              <p className="text-sm font-medium text-heading">{s[key].label}</p>
              <p id={`${uid}-${key}`} className="mt-0.5 text-sm text-muted">
                {s[key].body}
              </p>
            </div>
            {/* On touch screens the 44 pt box around the switch toggles it too (the switch is the control). */}
            <span
              className="mt-0.5 grid flex-none place-items-end pointer-coarse:-my-2.5 pointer-coarse:min-h-11 pointer-coarse:min-w-14 pointer-coarse:place-items-center"
              onClick={(e) => {
                if (e.target === e.currentTarget && canChange) save({ ...switches, [key]: !switches[key] }, s[key].label, switches[key]);
              }}
            >
              <Switch checked={switches[key]} disabled={!canChange} label={s[key].label} describedBy={`${uid}-${key}`} onChange={(on) => save({ ...switches, [key]: on }, s[key].label, !on)} />
            </span>
          </div>
        ))}
      </div>
      <p className="mt-4 text-[13px] text-muted">{copy.privacy.switchesFooter}</p>
    </Card>
  );
}

const METHOD_ICON: Record<MethodSummary["kind"], React.ReactNode> = {
  recoveryKey: <ScrollText size={17} aria-hidden />,
  passkey: <KeyRound size={17} aria-hidden />,
  passphrase: <LockKeyhole size={17} aria-hidden />,
  device: <Smartphone size={17} aria-hidden />,
};

/** "Ways to unlock" (§10.1): each method with Replace and Remove, devices as one row, and Add. */
function MethodsCard() {
  const { methods } = useKeySession();
  const { profile } = useAppState();
  const toast = useToast();
  const [adding, setAdding] = useState<"recoveryKey" | "passphrase" | null>(null);
  const [recovery, setRecovery] = useState<{ text: string; confirm(groups: [string, string]): Promise<boolean> } | null>(null);
  const p = copy.privacy;
  const w = copy.wizard.methods;
  const onMac = desktop() !== null;
  const devices = methods.filter((m) => m.kind === "device");
  const others = methods.filter((m) => m.kind !== "device");
  const fail = (e: unknown) => toast.show(e2eeErrorMessage(e) ?? errorMessage(e), { tone: "error" });
  const startRecovery = () =>
    void setup.addRecoveryKey().then((r) => {
      setRecovery(r);
      setAdding("recoveryKey");
    }, fail);
  const addPasskey = (replacing?: MethodSummary) =>
    void setup.addPasskey("Passkey").then(async (r) => {
      if (r === "unsupported") toast.show(w.passkeyUnsupported, { tone: "error" });
      else if (r === "ok") {
        if (replacing) await setup.removeMethod(replacing.publicId).catch(fail);
        toast.show(p.methodAdded(w.passkey.label));
      }
    }, fail);
  const remove = (m: MethodSummary) => void setup.removeMethod(m.publicId).then(() => toast.show(p.removed(m.label)), fail);
  const has = new Set(methods.map((m) => m.kind));
  const addItems: MenuItem[] = [
    ...(has.has("recoveryKey") ? [] : [{ label: w.recoveryKey.label, icon: <ScrollText size={14} />, onSelect: startRecovery }]),
    ...(onMac ? [] : [{ label: w.passkey.label, icon: <KeyRound size={14} />, onSelect: () => addPasskey() }]),
    ...(has.has("passphrase") ? [] : [{ label: w.passphrase.label, icon: <LockKeyhole size={14} />, onSelect: () => setAdding("passphrase") }]),
  ];
  return (
    <Card title={p.methodsTitle} description={p.methodsBody}>
      <ul className="ui-card divide-y divide-line overflow-hidden rounded-control">
        {others.map((m) => (
          <li key={m.publicId} className="flex items-center gap-3 px-4 py-3">
            <span aria-hidden className="grid h-9 w-9 flex-none place-items-center rounded-control bg-[var(--glass-hover)] text-heading">
              {METHOD_ICON[m.kind]}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-heading">{m.label}</span>
              <span className="block text-xs text-muted">{p.addedWhen(formatRelative(m.createdAt))}</span>
            </span>
            <MenuButton
              label={`${m.label} options`}
              trigger={<MoreHorizontal size={15} aria-hidden />}
              items={[
                {
                  label: p.replace,
                  onSelect: () => (m.kind === "recoveryKey" ? startRecovery() : m.kind === "passphrase" ? setAdding("passphrase") : addPasskey(m)),
                },
                { label: p.remove, danger: true, onSelect: () => remove(m) },
              ]}
            />
          </li>
        ))}
        <li className="flex items-center gap-3 px-4 py-3">
          <span aria-hidden className="grid h-9 w-9 flex-none place-items-center rounded-control bg-[var(--glass-hover)] text-heading">
            {METHOD_ICON.device}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-heading">{w.device.label}</span>
            <span className="block text-xs text-muted">{p.trustedDevices(devices.length)}</span>
          </span>
          <AppLink href="/settings/devices" className="ui-btn ui-btn-quiet h-8 px-3 text-[13px] pointer-coarse:h-11">
            {p.devicesLink}
          </AppLink>
        </li>
      </ul>
      {addItems.length ? (
        <MenuButton
          label={p.addWhich}
          align="start"
          className="mt-3 inline-block"
          triggerClassName="ui-btn ui-btn-secondary h-9 gap-1.5 px-4 text-sm pointer-coarse:h-11"
          trigger={
            <>
              <Plus size={14} aria-hidden /> {p.add}
            </>
          }
          items={addItems}
        />
      ) : null}
      <Dialog open={adding === "passphrase"} onClose={() => setAdding(null)} title={copy.wizard.passphrase.heading} size="sm">
        {adding === "passphrase" ? <PassphraseForm onSaved={() => setAdding(null)} onCancel={() => setAdding(null)} /> : null}
      </Dialog>
      <Dialog
        open={adding === "recoveryKey" && recovery !== null}
        onClose={() => {
          setAdding(null);
          setRecovery(null);
        }}
        title={copy.wizard.recovery.heading}
        size="md"
      >
        {recovery ? (
          <RecoveryKeyPanel
            text={recovery.text}
            email={profile.email ?? ""}
            onConfirm={(g) => recovery.confirm(g)}
            onDone={() => {
              toast.show(p.methodAdded(w.recoveryKey.label));
              setAdding(null);
              setRecovery(null);
            }}
          />
        ) : null}
      </Dialog>
    </Card>
  );
}
