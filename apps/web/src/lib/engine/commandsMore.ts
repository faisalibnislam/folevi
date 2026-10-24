// Revision 4's commands (docs/NATIVE_APP_PLAN.md sections 5.4 to 5.6): more note actions, folders through the
// outbox, Trash, Changes and proposals, notifications and invitations. The same paths the web's own controls use.
import { DEFAULT_COVER, DEFAULT_DOCUMENT_STYLE, folderMoveProblem, ulid } from "@folevi/editor-schema";
import type { FunctionReference } from "convex/server";
import { api } from "@/lib/convex/api";
import { requireOutbox } from "@/lib/app/folders";
import { overlaySidebar, type SidebarData } from "@/lib/sync/overlays";
import type { EngineDeps } from "./context";
import { bulk, spaceArg, type CommandDef } from "./commands";
import { toEngineError } from "./live";
import { BridgeError, bool, id, ids, nullableId, oneOf, only, text } from "./validate";
import { NOTES_LIST_VIEWS, type BulkResult, type CommandName } from "./protocol";

/** A one-off query that gives up after `ms` (offline the client would wait for the connection): undefined then. */
async function quickly<T>(deps: EngineDeps, ref: FunctionReference<"query">, args: Record<string, unknown>, ms = 1500): Promise<T | undefined> {
  return Promise.race([deps.client.query(ref, args) as Promise<T>, new Promise<undefined>((r) => setTimeout(() => r(undefined), ms))]).catch(() => undefined);
}

const MOVE_CODES = { self: "folder_self", descendant: "folder_descendant", depth: "folder_depth" } as const;
const MOVE_WORDS = { self: "A folder can't go inside itself.", descendant: "A folder can't go inside one of its subfolders.", depth: "Folders can be nested only so deep." } as const;

export const MORE_COMMANDS = {
  "note.deleteForever": {
    async run(deps, args) {
      only(args, ["ids"]);
      return bulk(deps, ids(args), { kind: "delete" });
    },
  },

  "note.duplicate": {
    async run(deps, args) {
      only(args, ["id"]);
      const r = (await deps.client.mutation(api.documents.duplicate, { documentId: id(args, "id") })) as { id: string };
      return { id: r.id };
    },
  },

  "note.copyTo": {
    async run(deps, args): Promise<BulkResult> {
      only(args, ["ids", "space", "folderId"]);
      const notes = ids(args, "ids", 50);
      const space = spaceArg(deps, args);
      const folderId = nullableId(args, "folderId") ?? null;
      const done: string[] = [];
      let skipped = 0;
      for (const documentId of notes) {
        try {
          const r = (await deps.client.mutation(api.copies.copyTo, { documentId, destination: space.scope, folderId, includeSubpages: true })) as { id: string };
          done.push(r.id);
        } catch (e) {
          const err = toEngineError(e);
          if (err.code === "forbidden" || err.code === "not_found") skipped++;
          else throw new BridgeError(err.code, err.message);
        }
      }
      return { done, skipped, queued: false };
    },
  },

  "note.reorder": {
    // documents.reorder takes both neighbours: the one after which it goes, and the one that then follows it.
    async run(deps, args) {
      only(args, ["id", "afterId", "view", "folderId", "space"]);
      const noteId = id(args, "id");
      if (args.afterId === undefined) throw new BridgeError("invalid_args", "afterId must be a note id or null.");
      const afterId = nullableId(args, "afterId") ?? null;
      const view = oneOf(args, "view", NOTES_LIST_VIEWS);
      const folderId = view === "folder" ? id(args, "folderId") : undefined;
      const space = spaceArg(deps, args);
      const list = await quickly<{ page: { id: string }[] }>(deps, api.documents.list, { scope: space.scope, view, sort: "manual", ...(folderId ? { folderId } : {}), paginationOpts: { numItems: 1000, cursor: null } });
      const order = (list?.page ?? []).map((d) => d.id).filter((x) => x !== noteId);
      const at = afterId ? order.indexOf(afterId) : -1;
      const beforeId = order[at + 1] ?? null;
      await deps.client.mutation(api.documents.reorder, { documentId: noteId, afterDocumentId: afterId, beforeDocumentId: beforeId });
      return { ok: true };
    },
  },

  "note.showInRecent": {
    async run(deps, args) {
      only(args, ["ids"]);
      const list = ids(args, "ids", 50);
      await deps.client.mutation(api.documents.showInRecent, { documentIds: list });
      // (The count of notes put back.)
      return { hidden: list.length };
    },
  },

  "template.create": {
    async run(deps, args) {
      only(args, ["space", "title", "open"]);
      const engine = deps.app.engine;
      if (!engine) throw new BridgeError("engine_not_ready", "Folevi is still starting. Try again in a moment.");
      const space = spaceArg(deps, args);
      if (!space.canEdit) throw new BridgeError("forbidden", `You can't add templates in ${space.name}.`);
      const templateId = ulid();
      engine.createDocument({ id: templateId, parentDocumentId: null, folderId: null, kind: "template", title: (text(args, "title", { optional: true, allowEmpty: true, max: 500 }) ?? "").trim(), icon: null, style: DEFAULT_DOCUMENT_STYLE, cover: DEFAULT_COVER, templateId: null, scope: space.scope });
      await engine.persisted();
      if (bool(args, "open", false)) deps.navigate(`/d/${templateId}?new=1`);
      return { id: templateId };
    },
  },

  "trash.empty": {
    async run(deps, args) {
      only(args, ["space"]);
      const space = spaceArg(deps, args);
      const summary = await quickly<{ total: number; deletable: number }>(deps, api.documents.trashSummary, { scope: space.scope });
      const r = (await deps.client.mutation(api.documents.emptyTrash, { scope: space.scope })) as { scheduled: number; continuing: boolean };
      return { deleted: r.scheduled, skipped: summary ? Math.max(0, summary.total - summary.deletable) : 0, continuing: r.continuing };
    },
  },

  "folder.rename": {
    async run(deps, args) {
      only(args, ["id", "name"]);
      const folderId = id(args, "id");
      const name = (text(args, "name", { max: 80 }) as string).trim();
      requireOutbox(deps.app.outbox).enqueue("organization.renameFolder", { folderId, name }, { keys: [`folder:${folderId}`], label: `Rename folder to “${name}”` });
      await deps.app.outbox!.persisted();
      return { ok: true };
    },
  },

  "folder.setColor": {
    async run(deps, args) {
      only(args, ["id", "color"]);
      const folderId = id(args, "id");
      if (args.color === undefined) throw new BridgeError("invalid_args", "color must be a colour key or null.");
      const color = args.color === null ? null : (text(args, "color", { max: 32 }) as string);
      requireOutbox(deps.app.outbox).enqueue("organization.setFolderColor", { folderId, color }, { keys: [`folder:${folderId}`], label: "Folder color" });
      await deps.app.outbox!.persisted();
      return { ok: true };
    },
  },

  "folder.move": {
    // Nest, un-nest or reorder; refused as the server and folderDrop.ts refuse (checked on this device's copy).
    async run(deps, args) {
      only(args, ["id", "parentId", "afterId", "space"]);
      const folderId = id(args, "id");
      if (args.parentId === undefined || args.afterId === undefined) throw new BridgeError("invalid_args", "parentId and afterId must be folder ids or null.");
      const parentId = nullableId(args, "parentId") ?? null;
      const afterId = nullableId(args, "afterId") ?? null;
      const outbox = requireOutbox(deps.app.outbox);
      const space = spaceArg(deps, args);
      const tree = await quickly<SidebarData>(deps, api.organization.sidebar, { scope: space.scope });
      if (tree) {
        const folders = overlaySidebar(tree, outbox.entries, space.scope).folders;
        const problem = folderMoveProblem(folders, folderId, parentId);
        if (problem) throw new BridgeError(MOVE_CODES[problem], MOVE_WORDS[problem]);
      }
      outbox.enqueue("organization.moveFolder", { folderId, parentFolderId: parentId, afterFolderId: afterId }, { keys: [`folder:${folderId}`, ...(parentId ? [`folder:${parentId}`] : [])], label: "Move folder" });
      await outbox.persisted();
      return { ok: true };
    },
  },

  "folder.delete": {
    async run(deps, args) {
      only(args, ["id"]);
      const folderId = id(args, "id");
      requireOutbox(deps.app.outbox).enqueue("organization.deleteFolder", { folderId }, { keys: [`folder:${folderId}`], label: "Delete a folder" });
      await deps.app.outbox!.persisted();
      return { ok: true };
    },
  },

  "changes.markSeen": {
    async run(deps, args) {
      only(args, ["ids"]);
      await deps.client.mutation(api.changes.markSeen, { documentIds: ids(args, "ids", 100) });
      return { ok: true };
    },
  },

  "proposal.accept": {
    async run(deps, args) {
      only(args, ["id"]);
      await deps.client.mutation(api.proposals.accept, { proposalId: id(args, "id") });
      return { ok: true };
    },
  },

  "proposal.reject": {
    async run(deps, args) {
      only(args, ["id"]);
      await deps.client.mutation(api.proposals.reject, { proposalId: id(args, "id") });
      return { ok: true };
    },
  },

  "notification.markRead": {
    async run(deps, args) {
      only(args, ["ids", "read"]);
      const list = ids(args, "ids", 100);
      if (bool(args, "read")) await deps.client.mutation(api.notifications.markRead, { ids: list });
      else await deps.client.mutation(api.notifications.markUnread, { ids: list });
      return { ok: true };
    },
  },

  "notification.markAllRead": {
    async run(deps, args) {
      only(args, []);
      await deps.client.mutation(api.notifications.markRead, {});
      return { ok: true };
    },
  },

  "notification.remove": {
    async run(deps, args) {
      only(args, ["ids"]);
      await deps.client.mutation(api.notifications.remove, { ids: ids(args, "ids", 100) });
      return { ok: true };
    },
  },

  "invite.accept": {
    async run(deps, args) {
      only(args, ["inviteId"]);
      await deps.client.mutation(api.workspaces.acceptInvite, { inviteId: id(args, "inviteId") });
      return { ok: true };
    },
  },

  "pageInvite.accept": {
    async run(deps, args) {
      only(args, ["inviteId"]);
      const r = (await deps.client.mutation(api.sharing.acceptPageInvite, { inviteId: id(args, "inviteId") })) as { documentId: string };
      return { noteId: r.documentId };
    },
  },
} satisfies Partial<Record<CommandName, CommandDef>>;
