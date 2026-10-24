// Revision 10's commands (R13.3, R14.4): the device copy's switches, and changing a person's role on a note.
import { api } from "@/lib/convex/api";
import { deviceCopyOf, setKeepAllNotes } from "@/lib/sync/deviceCopyHost";
import type { CommandDef } from "./commands";
import { waitingCount } from "./viewsDevice";
import { BridgeError, bool, id, oneOf, only } from "./validate";
import type { CommandName, DeviceRemoveCopyResult } from "./protocol";

const notRunning = () => new BridgeError("unavailable", "There's no copy of the notes on this device here (a library, or a public computer).");

type SharingData = { people: { profileId: string; email: string | null }[] };

export const DEVICE_COMMANDS = {
  "device.keepAll": {
    async run(deps, args) {
      only(args, ["on"]);
      setKeepAllNotes(deps.app.accountKey, bool(args, "on"));
      return { ok: true };
    },
  },

  "device.download": {
    // "Download now": the copy goes on at once, the space shown first.
    async run(deps, args) {
      only(args, []);
      const h = deviceCopyOf(deps.app.accountKey);
      if (!h) throw notRunning();
      setKeepAllNotes(deps.app.accountKey, true);
      h.copy.foreground();
      return { ok: true };
    },
  },

  "device.removeCopy": {
    // Never removes what waits to sync (that's the engine's and the outbox's); asks first when anything waits.
    async run(deps, args): Promise<DeviceRemoveCopyResult> {
      only(args, ["force"]);
      const h = deviceCopyOf(deps.app.accountKey);
      if (!h) throw notRunning();
      const waiting = waitingCount(deps);
      if (waiting && !bool(args, "force", false)) return { removed: false, waiting };
      await h.copy.clear();
      await h.files.clear();
      return { removed: true, waiting };
    },
  },

  "device.removeFiles": {
    async run(deps, args) {
      only(args, []);
      const h = deviceCopyOf(deps.app.accountKey);
      if (!h) throw notRunning();
      await h.files.clear();
      return { ok: true };
    },
  },

  "sharing.setRole": {
    // A grant changes by granting again (sharing.grant keeps the person and changes the role).
    async run(deps, args) {
      only(args, ["noteId", "profileId", "role"]);
      const noteId = id(args, "noteId");
      const profileId = id(args, "profileId");
      const role = oneOf(args, "role", ["editor", "commenter", "viewer"] as const);
      const data = (await deps.client.query(api.sharing.get, { documentId: noteId })) as SharingData;
      const email = data.people.find((p) => p.profileId === profileId)?.email;
      if (!email) throw new BridgeError("forbidden", "Only someone who manages this note can change this person's access.");
      await deps.client.mutation(api.sharing.grant, { documentId: noteId, email, role });
      return { ok: true };
    },
  },
} satisfies Partial<Record<CommandName, CommandDef>>;
