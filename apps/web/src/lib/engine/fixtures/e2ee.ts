// Revision 19's fixtures: unlocking this device's encryption in place (lib/engine/commandsE2ee.ts). Made-up values
// only: nothing here is anyone's passphrase or recovery key.
import type { CommandFixture, ViewFixture } from "./source";
import type { CommandName, ViewName } from "../protocol";
import { copy } from "@/lib/e2ee/copy";

const view = <N extends ViewName>(f: Omit<ViewFixture<N>, "kind">): ViewFixture<N> => ({ kind: "view", ...f });
const command = <N extends CommandName>(f: Omit<CommandFixture<N>, "kind">): CommandFixture<N> => ({ kind: "command", ...f });

export const E2EE_FIXTURES = {
  "view.e2ee.state": view({
    name: "e2ee.state",
    description: "This Mac hasn't got the account's encryption keys yet.",
    args: {},
    value: { state: "locked", approval: "idle", approvalCode: null, methods: ["approve", "passphrase", "recovery"], device: "this Mac" },
  }),
  "view.e2ee.state.compare": view({
    name: "e2ee.state",
    description: "Approving from another device: the code both show.",
    args: {},
    value: { state: "locked", approval: "compare", approvalCode: "482 913", methods: ["approve", "passphrase", "recovery"], device: "this Mac" },
  }),
  "command.e2ee.unlock": command({ name: "e2ee.unlock", description: "The passphrase unlocks this Mac (and it's trusted).", args: { method: "passphrase", secret: "correct horse battery staple" }, result: { status: "ok", message: null } }),
  "command.e2ee.unlock.badFormat": command({ name: "e2ee.unlock", description: "Not shaped like a recovery key.", args: { method: "recovery", secret: "ABCD" }, result: { status: "badFormat", message: copy.unlock.badFormat } }),
  "command.e2ee.approval.start": command({ name: "e2ee.approval.start", description: "Ask another device to approve this one.", args: {}, result: { ok: true } }),
  "command.e2ee.approval.cancel": command({ name: "e2ee.approval.cancel", description: "Stop asking.", args: {}, result: { ok: true } }),
};
