// Revision 19: unlocking this device's encryption in place, for a screen that needs the account's keys first (the
// Vault), without the full-page gate: the state (`e2ee.state`), the passphrase and the recovery key
// (`e2ee.unlock`), and approving this device from another one (`e2ee.approval.*`). The same key session the web's
// UnlockScreen uses (lib/e2ee/keys); in the apps an unlocked device is trusted at once.
import { copy } from "@/lib/e2ee/copy";
import { getKeySession } from "@/lib/e2ee/keys/session";
import { inNativeApp, thisDevice } from "@/lib/e2ee/keys/macBridge";
import type { ApprovalHandle } from "@/lib/e2ee/keys/session";
import type { CommandDef } from "./commands";
import { signalOf } from "./live";
import type { CommandName, E2eeApprovalState, E2eeStateValue, E2eeUnlockMethod, E2eeUnlockResult, OkResult, ViewName } from "./protocol";
import { oneOf, only, text } from "./validate";
import type { ValueViewDef } from "./views";

// ---- approving from another device: one at a time, for this page ----

let approval: { state: E2eeApprovalState; code: string | null; handle: ApprovalHandle | null } = { state: "idle", code: null, handle: null };
const listeners = new Set<() => void>();
function setApproval(next: typeof approval) {
  approval = next;
  for (const l of listeners) l();
}

/** In the apps the device keeps its key (the trust choice is the web's: a browser can be shared). */
async function trustHere() {
  if (inNativeApp()) await getKeySession().trust("browser");
}

const u = copy.unlock;

function stateValue(): E2eeStateValue {
  const methods: E2eeUnlockMethod[] = ["approve", "passphrase", "recovery"];
  return { state: getKeySession().state(), approval: approval.state, approvalCode: approval.code, methods, device: inNativeApp() ? thisDevice() : "this browser" };
}

const state: ValueViewDef = {
  kind: "value",
  parse: (args) => (only(args, []), {}),
  create: () => ({
    signals: [signalOf((cb) => getKeySession().subscribe(cb)), signalOf((cb) => (listeners.add(cb), () => listeners.delete(cb)))],
    compute: () => ({ value: stateValue(), stale: false, error: null }),
  }),
};

export const E2EE_VALUE_VIEWS = { "e2ee.state": state } satisfies Partial<Record<ViewName, ValueViewDef>>;

export const E2EE_COMMANDS = {
  "e2ee.unlock": {
    async run(_deps, args): Promise<E2eeUnlockResult> {
      only(args, ["method", "secret"]);
      const method = oneOf(args, "method", ["passphrase", "recovery"] as const);
      const secret = text(args, "secret", { max: 1000 }) as string;
      const session = getKeySession();
      if (method === "passphrase") {
        const r = await session.unlockWithPassphrase(secret.normalize("NFC"));
        if (r === "ok") return (await trustHere(), { status: "ok", message: null });
        return r === "rate_limited" ? { status: "rateLimited", message: u.rateLimited } : { status: "wrong", message: u.wrongPassphrase };
      }
      const r = await session.unlockWithRecoveryKey(secret);
      if (r === "ok") return (await trustHere(), { status: "ok", message: null });
      if (r === "rate_limited") return { status: "rateLimited", message: u.rateLimited };
      return r === "bad_format" ? { status: "badFormat", message: u.badFormat } : { status: "wrong", message: u.wrongRecovery };
    },
  },

  "e2ee.approval.start": {
    async run(_deps, args): Promise<OkResult> {
      only(args, []);
      approval.handle?.cancel();
      setApproval({ state: "waiting", code: null, handle: null });
      try {
        const h = await getKeySession().requestApproval();
        setApproval({ state: "waiting", code: null, handle: h });
        void h.code.then((c) => approval.handle === h && setApproval({ ...approval, state: "compare", code: c }), () => undefined);
        void h.done.then(
          async (ok) => {
            if (approval.handle !== h) return;
            if (ok) await trustHere();
            setApproval(ok ? { state: "idle", code: null, handle: null } : { state: "failed", code: null, handle: null });
          },
          () => approval.handle === h && setApproval({ state: "failed", code: null, handle: null }),
        );
      } catch {
        setApproval({ state: "failed", code: null, handle: null });
      }
      return { ok: true };
    },
  },

  "e2ee.approval.cancel": {
    async run(_deps, args): Promise<OkResult> {
      only(args, []);
      approval.handle?.cancel();
      setApproval({ state: "idle", code: null, handle: null });
      return { ok: true };
    },
  },
} satisfies Partial<Record<CommandName, CommandDef>>;
