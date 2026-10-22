"use client";

import { useEffect, useId, useRef, useState } from "react";
import { scopeIdKey } from "@folevi/editor-schema";
import { Check, KeyRound, LockKeyhole, ScrollText, ShieldCheck, Smartphone } from "lucide-react";
import type { WireScope } from "@folevi/editor-schema";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { useAppState } from "@/lib/app/state";
import { desktop } from "@/lib/desktop";
import { copy, type LevelId, type MethodId, type SwitchId } from "@/lib/e2ee/copy";
import { passkeysPossible, passphraseProblem, setup, useKeySession, type MethodSummary } from "@/lib/e2ee/keys";
import { DEFAULT_SWITCHES, FULL_SWITCHES, e2eeActions, useMigrationProgress, type Switches } from "./__stubs__";
import { RecoveryKeyPanel } from "./RecoveryKeyPanel";
import { MigrationBar } from "./MigrationProgress";

type Step = "start" | "methods" | "recovery" | "passphrase" | "confirm" | "done";
type RecoveryInProgress = { text: string; confirm(groups: [string, string]): Promise<boolean> };

/**
 * Where an open wizard is, kept outside React: creating the account's keys swaps the app's Convex client for
 * the encrypted-notes router (lib/convex/provider.tsx), which remounts everything below it. The screen that
 * opened the wizard reopens it from here (`pendingWizard`), at the same step with the same recovery key.
 */
export interface WizardResume {
  scopeKey: string;
  level: Exclude<LevelId, "standard">;
  mode: "space" | "methods";
  step: Step;
  recovery: RecoveryInProgress | null;
  /** What the opener needs to carry on (LockDialogHost: the folder or note to lock). */
  extra?: unknown;
}
let resume: WizardResume | null = null;
export function pendingWizard(scope: WireScope, mode: "space" | "methods"): WizardResume | null {
  return resume && resume.scopeKey === scopeIdKey(scope) && resume.mode === mode ? resume : null;
}

/** Kinds that count toward the two-method rule (§4.7.5): devices only once there are two. */
export function methodKinds(methods: MethodSummary[]): Set<MethodId> {
  const kinds = new Set<MethodId>();
  for (const m of methods) if (m.kind !== "device") kinds.add(m.kind);
  if (methods.filter((m) => m.kind === "device").length >= 2) kinds.add("device");
  return kinds;
}

/** The strength line under the passphrase: WP6's check (length, common passwords and their patterns), then a rough measure. */
export function passphraseStrength(p: string): "short" | "common" | "fine" | "strong" {
  const v = p.normalize("NFC");
  const problem = passphraseProblem(v);
  if (problem) return problem;
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(v)).length;
  const words = v.trim().split(/\s+/).length;
  return v.length >= 20 || words >= 4 || (v.length >= 14 && classes >= 3) ? "strong" : "fine";
}

const METHOD_ICON: Record<MethodId, React.ReactNode> = {
  recoveryKey: <ScrollText size={17} aria-hidden />,
  passkey: <KeyRound size={17} aria-hidden />,
  passphrase: <LockKeyhole size={17} aria-hidden />,
  device: <Smartphone size={17} aria-hidden />,
};

/**
 * Turning on encryption (§10.4): before you start, ways to unlock (at least two kinds), the recovery key
 * and passphrase when chosen, confirm, done. `mode: "methods"` stops after the ways to unlock: marking a
 * folder or note Always fully encrypted in a Standard space needs keys but doesn't change the level.
 */
export function SetupWizard({
  open,
  onClose,
  scope,
  workspaceName = null,
  level = "selected",
  switches,
  mode = "space",
  reason,
  onDone,
  resumeExtra,
}: {
  open: boolean;
  onClose: () => void;
  scope: WireScope;
  workspaceName?: string | null;
  level?: Exclude<LevelId, "standard">;
  switches?: Switches;
  mode?: "space" | "methods";
  /** A line on the first step saying why the wizard opened (e.g. to lock a folder). */
  reason?: string;
  onDone?: () => void;
  /** Kept with the resume point for the opener (see WizardResume). */
  resumeExtra?: unknown;
}) {
  const { profile } = useAppState();
  const { state, methods } = useKeySession();
  const toast = useToast();
  const scopeKey = scopeIdKey(scope);
  const [step, setStep] = useState<Step>(() => pendingWizard(scope, mode)?.step ?? "start");
  const [busy, setBusy] = useState(false);
  const [recovery, setRecovery] = useState<RecoveryInProgress | null>(() => pendingWizard(scope, mode)?.recovery ?? null);
  const [passkeyNote, setPasskeyNote] = useState<string | null>(null);
  const progress = useMigrationProgress(scope);
  // Opening again starts over; a wizard mounted open (first open, or resumed after a remount) keeps its state.
  const wasOpen = useRef(open);
  useEffect(() => {
    if (open && !wasOpen.current) {
      setStep("start");
      setRecovery(null);
      setPasskeyNote(null);
    }
    wasOpen.current = open;
  }, [open]);
  // Kept outside React while open, so a remount carries on here.
  useEffect(() => {
    if (open) resume = { scopeKey, level, mode, step, recovery, extra: resumeExtra };
  }, [open, scopeKey, level, mode, step, recovery, resumeExtra]);
  const close = () => {
    resume = null;
    onClose();
  };
  const kinds = methodKinds(methods);
  const enough = kinds.size >= 2;
  const onMac = desktop() !== null;
  // Where WebAuthn isn't there at all, the passkey row says so instead of offering Add.
  const passkeyHere = passkeysPossible();
  const chosen = level === "full" ? FULL_SWITCHES : (switches ?? DEFAULT_SWITCHES);
  const w = copy.wizard;
  const stepNumber = step === "start" ? 1 : step === "methods" || step === "recovery" || step === "passphrase" ? 2 : step === "confirm" ? 3 : 4;
  const total = mode === "methods" ? 2 : 4;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast.show(errorMessage(e), { tone: "error" });
    } finally {
      setBusy(false);
    }
  };
  const afterMethods = () => {
    if (mode === "methods") {
      onDone?.();
      close();
    } else setStep("confirm");
  };

  const title = workspaceName ? w.workspaceTitle : w.title;
  let body: React.ReactNode = null;
  let footer: React.ReactNode = null;
  if (step === "start") {
    const things = copy.meaning.things(copy.meaning.backupDays);
    body = (
      <div className="space-y-4 text-sm">
        <h3 className="ui-display text-[17px]">{w.start.heading}</h3>
        {reason ? <p className="font-medium text-heading">{reason}</p> : null}
        <p className="text-muted">{w.start.body}</p>
        {workspaceName ? <p className="text-muted">{w.start.workspace}</p> : null}
        <ul className="space-y-2">
          {[things[0]!, things[4]!].map((line) => (
            <li key={line} className="flex items-start gap-2 text-muted">
              <ShieldCheck size={15} aria-hidden className="mt-0.5 flex-none text-heading" />
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </div>
    );
    footer = (
      <>
        <Button onClick={close}>{w.cancel}</Button>
        <Button
          variant="primary"
          disabled={busy}
          aria-busy={busy || undefined}
          onClick={() =>
            void run(async () => {
              if (state === "none") {
                // Creating the keys remounts the app (see WizardResume): it carries on at the ways to unlock.
                if (resume) resume = { ...resume, step: "methods" };
                try {
                  await setup.createAccount();
                } catch (e) {
                  if (resume) resume = { ...resume, step: "start" };
                  throw e;
                }
              }
              // Someone who already has two kinds goes straight on.
              if (methodKinds(methods).size >= 2 && state !== "none") afterMethods();
              else setStep("methods");
            })
          }
        >
          {w.continue}
        </Button>
      </>
    );
  } else if (step === "methods") {
    const rows: MethodId[] = ["recoveryKey", ...(onMac ? [] : (["passkey"] as const)), "passphrase", "device"];
    const devices = methods.filter((m) => m.kind === "device").length;
    body = (
      <div className="space-y-4 text-sm">
        <h3 className="ui-display text-[17px]">{w.methods.heading}</h3>
        <p className="text-muted">{w.methods.body}</p>
        <ul className="divide-y divide-line rounded-control border border-line">
          {rows.map((kind) => {
            const done = kinds.has(kind);
            return (
              <li key={kind} className="flex items-center gap-3 px-3 py-3 sm:px-4">
                <span aria-hidden className="grid h-9 w-9 flex-none place-items-center rounded-control bg-[var(--glass-hover)] text-heading">
                  {METHOD_ICON[kind]}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-heading">{w.methods[kind].label}</span>
                  <span className="block text-[13px] text-muted">{kind === "device" ? `${w.methods.device.body} ${w.methods.deviceCount(devices)}.` : w.methods[kind].body}</span>
                  {kind === "passkey" && (passkeyNote || !passkeyHere) ? <span className="mt-1 block text-[13px] text-muted">{passkeyNote ?? w.methods.passkeyUnsupported}</span> : null}
                </span>
                {done ? (
                  <span className="inline-flex h-8 flex-none items-center gap-1 rounded-chip px-2 text-[13px] font-medium text-heading">
                    <Check size={15} aria-hidden /> {w.methods.added}
                    <span className="sr-only">: {w.methods[kind].label}</span>
                  </span>
                ) : kind === "device" || (kind === "passkey" && (!passkeyHere || passkeyNote)) ? null : (
                  <Button
                    size="sm"
                    disabled={busy}
                    aria-label={`${copy.privacy.add} ${w.methods[kind].label}`}
                    onClick={() => {
                      if (kind === "recoveryKey")
                        void run(async () => {
                          setRecovery(await setup.addRecoveryKey());
                          setStep("recovery");
                        });
                      else if (kind === "passphrase") setStep("passphrase");
                      else
                        void run(async () => {
                          const r = await setup.addPasskey("Passkey");
                          if (r === "unsupported") setPasskeyNote(w.methods.passkeyUnsupported);
                          else if (r === "ok") toast.show(copy.privacy.methodAdded(w.methods.passkey.label));
                        });
                    }}
                  >
                    {copy.privacy.add}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
        {onMac ? <p className="text-[13px] text-muted">{w.methods.passkeyMac}</p> : null}
      </div>
    );
    footer = (
      <>
        <span role="status" className="mr-auto self-center text-[13px] font-medium text-muted">
          {w.methods.counter(kinds.size, 2)}
        </span>
        <Button onClick={() => setStep("start")}>{w.back}</Button>
        <Button variant="primary" disabled={!enough} onClick={afterMethods}>
          {w.continue}
        </Button>
      </>
    );
  } else if (step === "recovery" && recovery) {
    body = (
      <div className="space-y-3">
        <h3 className="ui-display text-[17px]">{w.recovery.heading}</h3>
        <RecoveryKeyPanel
          text={recovery.text}
          email={profile.email ?? ""}
          onConfirm={(g) => recovery.confirm(g)}
          onDone={() => {
            toast.show(copy.privacy.methodAdded(w.methods.recoveryKey.label));
            setStep("methods");
          }}
        />
      </div>
    );
    footer = <Button onClick={() => setStep("methods")}>{w.back}</Button>;
  } else if (step === "passphrase") {
    body = <PassphraseForm onSaved={() => setStep("methods")} onCancel={() => setStep("methods")} />;
  } else if (step === "confirm") {
    const on = (Object.keys(copy.switches) as SwitchId[]).filter((k) => (k === "foliAi" ? chosen.foliAi !== "off" : chosen[k]));
    body = (
      <div className="space-y-4 text-sm">
        <h3 className="ui-display text-[17px]">{w.confirm.heading(workspaceName)}</h3>
        <dl className="divide-y divide-line rounded-control border border-line">
          <div className="px-4 py-3">
            <dt className="text-[12px] font-semibold uppercase tracking-[0.06em] text-faint">{w.confirm.level}</dt>
            <dd className="mt-0.5 font-medium text-heading">{copy.privacy.levels[level].title}</dd>
          </div>
          {level === "selected" ? (
            <div className="px-4 py-3">
              <dt className="text-[12px] font-semibold uppercase tracking-[0.06em] text-faint">{w.confirm.features}</dt>
              <dd className="mt-0.5 text-ink">
                {on.length ? on.map((k) => (k === "foliAi" ? `${copy.switches.foliAi.label} (${copy.switches.foliAi.options[chosen.foliAi].toLowerCase()})` : copy.switches[k].label)).join(", ") : w.confirm.none}
              </dd>
            </div>
          ) : null}
          <div className="px-4 py-3">
            <dt className="text-[12px] font-semibold uppercase tracking-[0.06em] text-faint">{w.confirm.methods}</dt>
            <dd className="mt-0.5 text-ink">{[...kinds].map((k) => w.methods[k].label).join(", ")}</dd>
          </div>
        </dl>
      </div>
    );
    footer = (
      <>
        <Button onClick={() => setStep("methods")}>{w.back}</Button>
        <Button
          variant="primary"
          disabled={busy}
          aria-busy={busy || undefined}
          onClick={() =>
            void run(async () => {
              await setup.setUpSpace(scope);
              await e2eeActions.enable(scope, level, chosen);
              setStep("done");
            })
          }
        >
          {busy ? w.confirm.busy : w.confirm.button}
        </Button>
      </>
    );
  } else if (step === "done") {
    body = (
      <div className="space-y-4 text-sm">
        <div className="flex items-center gap-3">
          <span aria-hidden className="grid h-10 w-10 flex-none place-items-center rounded-control bg-heading text-canvas">
            <LockKeyhole size={18} />
          </span>
          <h3 className="ui-display text-[19px]">{w.done.heading}</h3>
        </div>
        <p className="text-muted">{w.done.body}</p>
        {progress ? <MigrationBar progress={progress} /> : null}
      </div>
    );
    footer = (
      <Button
        variant="primary"
        onClick={() => {
          onDone?.();
          close();
        }}
      >
        {w.done.close}
      </Button>
    );
  }

  return (
    <Dialog open={open} onClose={close} title={title} description={<span className="text-[12.5px]">{w.stepOf(Math.min(stepNumber, total), total)}</span>} size="md" footer={footer}>
      <div data-e2ee-step={step}>{body}</div>
    </Dialog>
  );
}

export function PassphraseForm({ onSaved, onCancel }: { onSaved: () => void; onCancel: () => void }) {
  const c = copy.wizard.passphrase;
  const uid = useId();
  const toast = useToast();
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const strength = passphraseStrength(p1);
  const ok = strength === "fine" || strength === "strong";
  return (
    <form
      className="space-y-4 text-sm"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy || !ok) return;
        if (p1 !== p2) {
          setError(c.mismatch);
          return;
        }
        setBusy(true);
        try {
          await setup.addPassphrase(p1.normalize("NFC"));
          toast.show(copy.privacy.methodAdded(copy.wizard.methods.passphrase.label));
          onSaved();
        } catch (err) {
          setError(errorMessage(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <h3 className="ui-display text-[17px]">{c.heading}</h3>
      <p id={`${uid}-hint`} className="text-muted">
        {c.body}
      </p>
      <label className="block font-medium text-heading">
        {c.field}
        <input
          type="password"
          autoComplete="new-password"
          autoFocus
          value={p1}
          onChange={(e) => {
            setP1(e.target.value);
            setError(null);
          }}
          aria-describedby={`${uid}-hint ${uid}-strength`}
          className="ui-input mt-1 block h-10 w-full rounded-control px-3 text-sm font-normal pointer-coarse:h-11"
        />
      </label>
      <p id={`${uid}-strength`} aria-live="polite" className={`-mt-2 text-[13px] ${p1 ? (ok ? "text-heading" : "text-danger") : "text-muted"}`}>
        {p1 ? c.strength[strength] : c.strength.short}
      </p>
      <label className="block font-medium text-heading">
        {c.again}
        <input
          type="password"
          autoComplete="new-password"
          value={p2}
          onChange={(e) => {
            setP2(e.target.value);
            setError(null);
          }}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${uid}-error` : undefined}
          className="ui-input mt-1 block h-10 w-full rounded-control px-3 text-sm font-normal pointer-coarse:h-11"
        />
      </label>
      {error ? (
        <p id={`${uid}-error`} role="alert" className="text-danger">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button onClick={onCancel}>{copy.wizard.back}</Button>
        <Button type="submit" variant="primary" disabled={!ok || !p2 || busy} aria-busy={busy || undefined}>
          {busy ? c.saving : c.save}
        </Button>
      </div>
    </form>
  );
}

