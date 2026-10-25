// Revision 12's commands: sharing folders (R14.4, docs/SHARING.md, convex/folderSharing.ts). Only a folder's
// managers add people, change roles and remove people or invitations (the server checks); anyone may remove
// themselves (leave a folder shared with them). Declining a folder invitation is `invite.decline { kind: "folder" }`.
import { api } from "@/lib/convex/api";
import type { CommandDef } from "./commands";
import { BridgeError, id, oneOf, only, text } from "./validate";
import type { CommandName, FolderInviteAcceptResult, ShareInviteResult } from "./protocol";

const ROLES = ["editor", "commenter", "viewer"] as const;

function requireAccount(mode: string) {
  if (mode !== "account") throw new BridgeError("unavailable", "Sharing needs a Folevi account.");
}

export const FOLDER_COMMANDS = {
  "folderSharing.invite": {
    // A verified account gets access at once (and is told); any other address gets an invitation by email.
    async run(deps, args): Promise<ShareInviteResult> {
      only(args, ["folderId", "email", "role"]);
      requireAccount(deps.app.mode);
      const r = (await deps.client.mutation(api.folderSharing.grant, { folderId: id(args, "folderId"), email: text(args, "email", { max: 254 }) as string, role: oneOf(args, "role", ROLES) })) as { status: string };
      return { status: r.status };
    },
  },

  "folderSharing.setRole": {
    async run(deps, args) {
      only(args, ["folderId", "profileId", "role"]);
      requireAccount(deps.app.mode);
      await deps.client.mutation(api.folderSharing.setRole, { folderId: id(args, "folderId"), profileId: id(args, "profileId"), role: oneOf(args, "role", ROLES) });
      return { ok: true };
    },
  },

  "folderSharing.revoke": {
    // Their own profile id: they leave the folder.
    async run(deps, args) {
      only(args, ["folderId", "profileId"]);
      requireAccount(deps.app.mode);
      await deps.client.mutation(api.folderSharing.revoke, { folderId: id(args, "folderId"), profileId: id(args, "profileId") });
      return { ok: true };
    },
  },

  "folderSharing.cancelInvite": {
    async run(deps, args) {
      only(args, ["inviteId"]);
      requireAccount(deps.app.mode);
      await deps.client.mutation(api.folderSharing.revokeInvite, { inviteId: id(args, "inviteId") });
      return { ok: true };
    },
  },

  "folderInvite.accept": {
    // From the bell (`NotificationRow.folderInviteId`); a link's token goes through `invite.acceptLink { kind: "folder" }`.
    async run(deps, args): Promise<FolderInviteAcceptResult> {
      only(args, ["inviteId"]);
      requireAccount(deps.app.mode);
      const r = (await deps.client.mutation(api.folderSharing.acceptInvite, { inviteId: id(args, "inviteId") })) as { folderId: string };
      return { folderId: r.folderId };
    },
  },
} satisfies Partial<Record<CommandName, CommandDef>>;
