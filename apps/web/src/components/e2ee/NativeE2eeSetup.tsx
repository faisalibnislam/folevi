"use client";

// Setting encryption up from the native apps (native chrome mode): the gate screen E2eeGate shows when a space is
// encrypted and this account has no keys yet, as steps native draws and actions it presses (lib/engine/gates.ts):
// make the account's keys, then add two ways to unlock (a recovery key, shown once and confirmed with two of its
// groups, and a passphrase). The web shows SetupWizard for the same steps; both call lib/e2ee/keys setup.
import { useState } from "react";
import { setup, useKeySession } from "@/lib/e2ee/keys";
import { copy } from "@/lib/e2ee/copy";
import { NativeGate, type NativeGateAction } from "@/lib/engine/NativeGate";
import { e2eeInfo } from "@/lib/engine/gates";
import { BridgeError } from "@/lib/engine/validate";
import type { EngineError, GateField } from "@/lib/engine/protocol";
import { methodKinds } from "./SetupWizard";

type Step = "start" | "methods" | "recovery" | "done";

export function NativeE2eeSetup({ space, spaceName, extra = [] }: { space: string; spaceName: string; extra?: NativeGateAction[] }) {
  const { state, methods } = useKeySession();
  const [step, setStep] = useState<Step>(state === "none" ? "start" : "methods");
  const [recovery, setRecovery] = useState<Awaited<ReturnType<typeof setup.addRecoveryKey>> | null>(null);
  const [error, setError] = useState<EngineError | null>(null);
  const kinds = [...methodKinds(methods)];
  const enough = kinds.length >= 2;
  const fail = (code: string, message: string): never => {
    setError({ code, message });
    throw new BridgeError(code, message);
  };
  const guard = async (fn: () => Promise<void>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      if (e instanceof BridgeError) throw e;
      const err = e as { code?: string; message?: string };
      fail(err.code ?? "failed", err.message ?? copy.errors.generic);
    }
  };
  const fields: GateField[] =
    step === "recovery"
      ? [
          { id: "group3", kind: "code", label: "Group 3", placeholder: "XXXX" },
          { id: "group7", kind: "code", label: "Group 7", placeholder: "XXXX" },
        ]
      : step === "methods"
        ? [{ id: "passphrase", kind: "secret", label: copy.unlock.passphraseField, placeholder: "" }]
        : [];
  const actions: NativeGateAction[] =
    step === "start"
      ? [{ id: "begin", label: copy.unlock.setUp, style: "primary", run: () => guard(async () => { await setup.createAccount(); setStep("methods"); }) }]
      : step === "recovery"
        ? [
            { id: "confirmRecovery", label: "Confirm", style: "primary", run: (v) => guard(async () => { if (!recovery || !(await recovery.confirm([(v.group3 ?? "").trim(), (v.group7 ?? "").trim()]))) fail("wrong_groups", "Those groups don't match the recovery key. Check them and try again."); setRecovery(null); setStep("methods"); }) },
            { id: "back", label: "Back", style: "quiet", run: () => { setRecovery(null); setStep("methods"); } },
          ]
        : step === "methods"
          ? [
              ...(kinds.includes("recoveryKey") ? [] : [{ id: "recoveryKey", label: copy.unlock.recoveryKey, style: "secondary" as const, run: () => guard(async () => { setRecovery(await setup.addRecoveryKey()); setStep("recovery"); }) }]),
              ...(kinds.includes("passphrase") ? [] : [{ id: "passphrase", label: copy.unlock.passphrase, style: "secondary" as const, run: (v: Record<string, string>) => guard(() => setup.addPassphrase((v.passphrase ?? "").normalize("NFC"))) }]),
              { id: "finish", label: "Done", style: "primary", enabled: enough, run: () => setStep("done") },
            ]
          : [];
  return (
    <NativeGate
      gate="e2eeSetup"
      title={copy.unlock.lockedSpace}
      message={copy.unlock.needsSetup}
      e2ee={e2eeInfo({ space, spaceName, view: "needsSetup", methods: [], setupStep: step, recoveryKey: step === "recovery" ? (recovery?.text ?? null) : null, methodsAdded: kinds })}
      fields={fields}
      actions={[...actions, ...extra]}
      error={error}
    />
  );
}
